/**
 * POST /v1/sync/push — KH backend §4.1.
 *
 * Tuần tự theo `seq`, MỖI OP MỘT TRANSACTION có ngữ cảnh RLS. Gặp op bị từ chối thì dừng:
 * các op sau có thể phụ thuộc nó (lần trả cần phiếu). Trong transaction của một op:
 *
 *   1. khoá advisory theo tổ chức — hai máy của một vựa đẩy cùng lúc thì lần lượt, "ghi sau
 *      thắng" theo đúng thứ tự server nhận;
 *   2. `opId` đã có trong `sync_ops` → `duplicate` (máy gửi lại vì mất phản hồi);
 *   3. làm op; 4. ghi `sync_ops` — CÙNG transaction, nên op hoặc đã làm và đã ghi, hoặc chưa gì.
 *
 * Phiếu lập theo đơn (`orderId`, BE5): đơn sang `fulfilled` + `order_events` trong CÙNG transaction
 * với phiếu; sau commit phát `order.fulfilled`. Đơn đã huỷ → phiếu vẫn ghi, gỡ `orderId`, cảnh báo
 * `ORDER_NOT_OPEN` — phiếu là việc đã cân thật ngoài đời, không bao giờ bị từ chối vì đơn.
 */

import { computeReceiptTotal, freezeLineTotals, totalAdjustments } from '@mambo/core/calc';
import type { PriceAdjustment, TransactionLine } from '@mambo/core/types';
import {
  can,
  type ErrorCode,
  type ParsedSyncOp,
  parseSyncOp,
  type SyncOpResult,
  type SyncPushResult,
  syncOpPermission,
  type SyncPushInput,
  type SyncWarning,
} from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Logger } from 'winston';
import type { z } from 'zod';
import { recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { planSummary } from '../auth/prisma-memberships';
import { ApiException } from '../common/api-exception';
import { DATABASE, type Database, type Tx } from '../db/database';
import { DomainEvents, LOGGER, type OrderChanged } from '../events/domain-events';
import { Prisma } from '../generated/prisma/client';
import { changeOf, logStep } from '../orders/order-records';
import { type BranchRule, delegateOf, SYNC_TABLES } from './sync-tables';

type Input = z.output<typeof SyncPushInput>;
type Outcome = Pick<SyncOpResult, 'status' | 'warning'> & {
  /** Đơn vừa hoàn thành nhờ op này — phát sự kiện SAU KHI transaction commit. */
  readonly fulfilled?: OrderChanged;
};

/** Op bị từ chối — ném trong transaction để rollback, bắt lại thành kết quả `rejected`. */
class OpRejected extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

interface PushContext {
  readonly user: AuthUser;
  readonly membership: MembershipContext;
  readonly deviceId: string;
  readonly requestId: string;
}

const APPLIED: Outcome = { status: 'applied' };
const DUPLICATE: Outcome = { status: 'duplicate' };

@Injectable()
export class SyncPushService {
  private readonly db: Database;
  private readonly logger: Logger;
  private readonly events: DomainEvents;

  constructor(@Inject(DATABASE) db: Database, @Inject(LOGGER) logger: Logger, events: DomainEvents) {
    this.db = db;
    this.logger = logger;
    this.events = events;
  }

  async push(user: AuthUser, membership: MembershipContext, input: Input, requestId: string): Promise<SyncPushResult> {
    await this.assertPlan(user, membership);

    const ctx: PushContext = { user, membership, deviceId: input.deviceId, requestId };
    const results: SyncOpResult[] = [];
    for (const raw of input.ops) {
      const result = await this.one(ctx, raw);
      results.push(result);
      if (result.status === 'rejected') break;
    }

    this.logger.info('sync.push', {
      requestId,
      orgId: membership.organizationId,
      deviceId: input.deviceId,
      sent: input.ops.length,
      applied: results.filter((r) => r.status === 'applied').length,
      duplicate: results.filter((r) => r.status === 'duplicate').length,
      rejected: results.find((r) => r.status === 'rejected')?.error?.code,
    });
    return { results };
  }

  /** Vựa/DN hết gói: không ghi gì, cả lượt dừng — app giữ nguyên hàng đợi, không đốt lượt thử. */
  private async assertPlan(user: AuthUser, membership: MembershipContext): Promise<void> {
    const sub = await this.db.scoped({ userId: user.id, orgId: membership.organizationId }, (tx) =>
      tx.subscription.findFirst({
        where: { organizationId: membership.organizationId, deletedAt: null },
        select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true, branchLimit: true },
      }),
    );
    const plan = planSummary(sub ?? undefined, new Date());
    if (!plan || plan.tier === 'free') {
      throw new ApiException('PLAN_EXPIRED', 'Gói đã hết hạn — sổ vẫn đọc và xuất file được, nhưng chưa gửi lên mạng được');
    }
  }

  private async one(ctx: PushContext, raw: Input['ops'][number]): Promise<SyncOpResult> {
    const check = parseSyncOp(raw);
    if (!check.ok) {
      return rejected(raw.opId, 'VALIDATION_FAILED', 'Dữ liệu của thao tác chưa đúng', { fields: check.fields });
    }
    const op = check.op;

    const permission = syncOpPermission(op);
    if (!permission || !can(ctx.membership.orgType, ctx.membership.role, permission)) {
      return rejected(op.opId, 'FORBIDDEN', 'Không có quyền làm việc này', { permission });
    }

    try {
      const { fulfilled, ...outcome } = await this.db.scoped(
        { userId: ctx.user.id, orgId: ctx.membership.organizationId },
        (tx) => this.inTransaction(tx, ctx, op),
      );
      if (fulfilled) this.events.emit('order.fulfilled', fulfilled);
      return { opId: op.opId, ...outcome };
    } catch (err) {
      return this.toRejection(op, err, ctx.requestId);
    }
  }

  private async inTransaction(tx: Tx, ctx: PushContext, op: ParsedSyncOp): Promise<Outcome> {
    const orgId = ctx.membership.organizationId;
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${orgId}, 1))`;

    const seen = await tx.syncOp.findUnique({ where: { opId: op.opId }, select: { opId: true } });
    if (seen) return DUPLICATE;

    const outcome = await this.apply(tx, ctx, op);

    await tx.syncOp.create({
      data: {
        opId: op.opId,
        organizationId: orgId,
        userId: ctx.user.id,
        deviceId: ctx.deviceId,
        seq: BigInt(op.seq),
        kind: op.kind,
        entity: op.entity,
        recordId: op.recordId,
      },
      select: { opId: true },
    });
    return outcome;
  }

  private async apply(tx: Tx, ctx: PushContext, op: ParsedSyncOp): Promise<Outcome> {
    const table = SYNC_TABLES[op.entity];
    const model = delegateOf(tx, op.entity);
    const existing = await model.findUnique({
      where: { id: op.recordId },
      select: selectFor(table.branch),
    });

    if (op.kind === 'insert') {
      // Id đã có TRONG tổ chức này = gửi lại. Id của tổ chức khác thì RLS giấu, và insert
      // bên dưới vỡ khoá chính → rejected (không phải duplicate — không thì máy xoá op, mất phiếu).
      if (existing) return DUPLICATE;
      const { data, warning, fulfilled } = await this.prepareInsert(tx, ctx, op);
      await model.create({
        data: {
          ...table.defaults,
          ...table.toDb(data),
          id: op.recordId,
          organizationId: ctx.membership.organizationId,
          createdBy: ctx.user.id,
        },
        select: { id: true },
      });
      return { status: 'applied', ...(warning ? { warning } : {}), ...(fulfilled ? { fulfilled } : {}) };
    }

    if (!existing) {
      throw new OpRejected('PARENT_MISSING', 'Bản ghi chưa có trên máy chủ — thử lại sau khi thao tác tạo nó lên xong');
    }
    assertBranch(ctx.membership, branchOf(table.branch, existing));
    const deletedAt = existing.deletedAt as Date | null;

    if (op.kind === 'update') {
      // Xoá thắng: sửa đến sau không làm bản ghi sống lại (quy tắc số 3).
      if (deletedAt) return { status: 'applied', warning: 'RECORD_DELETED' };
      if (op.entity === 'draft' && typeof op.data?.orderId === 'string') {
        await findOrderFor(tx, ctx, op.data.orderId, (op.data.kind ?? null) as string | null);
      }
      await model.update({ where: { id: op.recordId }, data: table.toDb(op.data ?? {}), select: { id: true } });
      return APPLIED;
    }

    if (deletedAt) return DUPLICATE;
    await model.update({ where: { id: op.recordId }, data: { deletedAt: new Date() }, select: { id: true } });
    await this.auditDelete(tx, ctx, op);
    return APPLIED;
  }

  /** Việc riêng trước khi thêm: chi nhánh, tổng tiền phiếu, phiếu cha của lần trả. */
  private async prepareInsert(
    tx: Tx,
    ctx: PushContext,
    op: ParsedSyncOp,
  ): Promise<{ data: Record<string, unknown>; warning?: SyncWarning; fulfilled?: OrderChanged }> {
    const data = { ...(op.data ?? {}) };

    if (op.entity === 'transaction' || op.entity === 'draft') {
      data.branchId = resolveBranch(ctx.membership, data.branchId as string | null | undefined);
    }

    if (op.entity === 'transaction') {
      data.lines = verifyLineTotals(data.lines as TransactionLine[]);
      if (typeof data.orderId === 'string') return this.fulfil(tx, ctx, data);
    }

    if (op.entity === 'draft' && typeof data.orderId === 'string') {
      await findOrderFor(tx, ctx, data.orderId, (data.kind ?? null) as string | null);
    }

    if (op.entity === 'payment') {
      const parent = await tx.transaction.findUnique({
        where: { id: data.transactionId as string },
        select: { deletedAt: true, branchId: true },
      });
      if (!parent) throw new OpRejected('PARENT_MISSING', 'Phiếu của lần trả này chưa có trên máy chủ');
      assertBranch(ctx.membership, parent.branchId);
      // Tiền đã trả ngoài đời thì vẫn lưu, kể cả khi phiếu đã bị xoá ở máy khác.
      if (parent.deletedAt) return { data, warning: 'RECORD_DELETED' };
    }

    return { data };
  }

  /** Phiếu theo đơn (KH §4.1 mục 8). Đơn còn mở → `fulfilled`; đã huỷ → gỡ khỏi đơn; đã xong → chỉ gắn. */
  private async fulfil(
    tx: Tx,
    ctx: PushContext,
    data: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown>; warning?: SyncWarning; fulfilled?: OrderChanged }> {
    const order = await findOrderFor(tx, ctx, data.orderId as string, data.kind as string);
    if (order.status === 'cancelled') return { data: { ...data, orderId: null }, warning: 'ORDER_NOT_OPEN' };
    if (order.status === 'fulfilled') return { data };

    const done = await tx.order.update({
      where: { id: order.id },
      data: { status: 'fulfilled', version: { increment: 1 } },
    });
    await logStep(tx, order.id, order.status, 'fulfilled', ctx.user.id, ctx.membership.organizationId, null);
    return { data, fulfilled: changeOf(done, ctx.user, ctx.membership.organizationId) };
  }

  /** Xoá phiếu, huỷ lần trả → nhật ký trong CÙNG transaction. */
  private async auditDelete(tx: Tx, ctx: PushContext, op: ParsedSyncOp): Promise<void> {
    const base = {
      organizationId: ctx.membership.organizationId,
      actorUserId: ctx.user.id,
      entityId: op.recordId,
      requestId: ctx.requestId,
    };
    if (op.entity === 'transaction') {
      const row = await tx.transaction.findUniqueOrThrow({
        where: { id: op.recordId },
        select: { date: true, kind: true, counterpartyId: true, lines: true, adjustments: true },
      });
      const lines = row.lines as unknown as TransactionLine[];
      const adjustments = (row.adjustments ?? undefined) as PriceAdjustment[] | undefined;
      const total = computeReceiptTotal(lines).total + totalAdjustments(adjustments);
      await recordAudit(tx, {
        ...base,
        action: 'receipt.deleted',
        entity: 'transaction',
        before: { date: row.date.toISOString(), kind: row.kind, counterpartyId: row.counterpartyId, total },
      });
    } else if (op.entity === 'payment') {
      const row = await tx.payment.findUniqueOrThrow({
        where: { id: op.recordId },
        select: { transactionId: true, amount: true, date: true },
      });
      await recordAudit(tx, {
        ...base,
        action: 'payment.voided',
        entity: 'payment',
        before: { transactionId: row.transactionId, amount: Number(row.amount), date: row.date.toISOString() },
      });
    }
  }

  private toRejection(op: ParsedSyncOp, err: unknown, requestId: string): SyncOpResult {
    if (err instanceof OpRejected) return rejected(op.opId, err.code, err.message, err.details);
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return rejected(op.opId, 'VALIDATION_FAILED', 'Id của bản ghi hoặc thao tác đã được dùng ở nơi khác — sinh id mới');
      }
      if (err.code === 'P2003') {
        return rejected(op.opId, 'VALIDATION_FAILED', 'Tham chiếu không thuộc tổ chức này (chi nhánh hoặc phiếu)');
      }
    }
    // Lỗi không lường trước: không lộ chi tiết ra ngoài; thử lại được theo lịch giãn cách.
    this.logger.error('sync.op_failed', {
      requestId,
      opId: op.opId,
      entity: op.entity,
      kind: op.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    if (Sentry.isInitialized()) Sentry.captureException(err, { tags: { requestId } });
    return rejected(op.opId, 'INTERNAL', 'Máy chủ gặp lỗi khi ghi thao tác này — sẽ thử lại');
  }
}

const rejected = (opId: string, code: ErrorCode, message: string, details?: Record<string, unknown>): SyncOpResult => ({
  opId,
  status: 'rejected',
  error: { code, message, ...(details ? { details } : {}) },
});

const selectFor = (rule: BranchRule): Record<string, unknown> => ({
  deletedAt: true,
  ...(rule === 'own' ? { branchId: true } : {}),
  ...(rule === 'parent' ? { transaction: { select: { branchId: true } } } : {}),
});

/** Chi nhánh của bản ghi đang có; `undefined` = bảng không theo chi nhánh. */
const branchOf = (rule: BranchRule, row: Record<string, unknown>): string | null | undefined => {
  if (rule === 'own') return row.branchId as string | null;
  if (rule === 'parent') return (row.transaction as { branchId: string | null }).branchId;
  return undefined;
};

/** Người gắn với một chi nhánh chỉ đụng được phiếu của chi nhánh đó. */
const assertBranch = (membership: MembershipContext, recordBranch: string | null | undefined): void => {
  if (recordBranch === undefined || membership.branchId === null) return;
  if (recordBranch !== membership.branchId) {
    throw new OpRejected('FORBIDDEN', 'Chỉ làm việc được với phiếu của chi nhánh mình');
  }
};

/** Phiếu/nháp mới: người gắn chi nhánh thì LUÔN là chi nhánh đó; chủ để trống = cả tổ chức. */
const resolveBranch = (membership: MembershipContext, requested: string | null | undefined): string | null => {
  if (membership.branchId === null) return requested ?? null;
  if (requested && requested !== membership.branchId) {
    throw new OpRejected('FORBIDDEN', 'Chỉ ghi được phiếu cho chi nhánh của mình');
  }
  return membership.branchId;
};

/**
 * Server tính lại từng dòng bằng ĐÚNG hàm của app (`freezeLineTotals`). Lệch là app đang dùng
 * cách tính khác — từ chối, không lặng lẽ lưu một con số khác với con số người dùng đã thấy.
 */
const verifyLineTotals = (lines: TransactionLine[]): TransactionLine[] => {
  const frozen = lines.map(freezeLineTotals);
  const wrong = frozen.findIndex((line, i) => line.roundedTotal !== lines[i]?.roundedTotal);
  if (wrong >= 0) {
    throw new OpRejected('VALIDATION_FAILED', 'Tổng tiền dòng hàng lệch với cách tính của máy chủ', {
      fields: { [`data.lines.${wrong}.roundedTotal`]: `Máy chủ tính ra ${frozen[wrong]?.roundedTotal}` },
    });
  }
  return frozen;
};

/**
 * Đơn mà tổ chức là ĐÚNG bên: phiếu mua ↔ bên mua, phiếu bán ↔ bên bán, nháp chưa chọn chiều ↔ bên
 * nào cũng được. Sai thì từ chối op có giải thích (app đang gắn nhầm đơn) — trigger
 * `book_order_guard` giữ cùng luật ở database.
 */
const findOrderFor = async (tx: Tx, ctx: PushContext, orderId: string, kind: string | null) => {
  const orgId = ctx.membership.organizationId;
  const order = await tx.order.findFirst({
    where: {
      id: orderId,
      OR: [
        ...(kind !== 'sale' ? [{ buyerOrgId: orgId }] : []),
        ...(kind !== 'purchase' ? [{ sellerOrgId: orgId }] : []),
      ],
    },
    select: { id: true, status: true },
  });
  if (!order) {
    throw new OpRejected('VALIDATION_FAILED', 'Không có đơn này, hoặc tổ chức không phải đúng bên của đơn', {
      fields: { orderId: 'Không có đơn này cho phía mua/bán của phiếu' },
    });
  }
  return order;
};
