/**
 * Kết nối giữa tổ chức — KH backend §1.4, BE4.
 *
 * Việc nhìn xuyên tổ chức (tên bên kia, phiếu trong sổ bên kia) CHỈ đi qua hai hàm security
 * definer hẹp của migration BE4: `my_links()` và `linked_receipts()`. Mọi thứ khác đọc/ghi qua
 * RLS như thường. Luật chuyển trạng thái được trigger `partner_links_guard` giữ thêm một lớp.
 */

import { lineTotals, linePrice, transactionTotals } from '@mambo/core/calc';
import { normalizePhone } from '@mambo/core/identifier';
import type { PriceAdjustment, TransactionLine } from '@mambo/core/types';
import {
  can,
  type LinkedBalance,
  type LinkedReceipt,
  type LinkedReceiptsQuery,
  type LinkedReceiptsResult,
  type LinkClaimInput,
  type LinkInviteInput,
  type LinkSummary,
  OrgType,
} from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { type AuditAction, recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { SUPABASE_USERS, type SupabaseAccount, type SupabaseUsers } from '../auth/supabase-users';
import { ApiException } from '../common/api-exception';
import { DATABASE, type Database, type Tx } from '../db/database';
import { DomainEvents } from '../events/domain-events';
import type { Prisma } from '../generated/prisma/client';
import { freshLinkCode, needsFreshCode, withFreshCodeRetry } from './link-code';

const RECEIPTS_DEFAULT_LIMIT = 50;

/** Số điện thoại ĐÃ XÁC THỰC OTP của người gọi, dạng +84… — rỗng nếu chưa. Lấy từ Auth ngay lúc gọi. */
export const verifiedPhone = (account: SupabaseAccount): string =>
  account.phone_confirmed_at && account.phone ? normalizePhone(account.phone) : '';

interface MyLinkRow {
  id: string;
  side: string;
  status: string;
  partner_kind: string;
  partner_id: string;
  partner_name: string;
  invited_phone: string | null;
  invite_code: string | null;
  invite_code_expires_at: Date | null;
  counterpart_id: string | null;
  counterpart_name: string | null;
  counterpart_type: string | null;
  created_at: Date;
  decided_at: Date | null;
}

interface LinkedRow {
  id: string;
  organization_id: string;
  date: Date;
  kind: string;
  party_name: string;
  lines: unknown;
  adjustments: unknown;
  payments: { id: string; date: string; amount: number }[];
}

const toSummary = (row: MyLinkRow): LinkSummary => ({
  id: row.id,
  side: row.side as LinkSummary['side'],
  status: row.status as LinkSummary['status'],
  partnerKind: row.partner_kind as LinkSummary['partnerKind'],
  partner: { id: row.partner_id, name: row.partner_name },
  counterpart:
    row.counterpart_id && row.counterpart_name && row.counterpart_type
      ? { id: row.counterpart_id, name: row.counterpart_name, type: OrgType.parse(row.counterpart_type) }
      : null,
  invitedPhone: row.invited_phone,
  inviteCode:
    row.invite_code && row.invite_code_expires_at
      ? { code: row.invite_code, expiresAt: row.invite_code_expires_at.toISOString() }
      : null,
  createdAt: row.created_at.toISOString(),
  decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
});

/** Một phiếu như in trên biên nhận — tổng, số tính tiền, còn nợ tính bằng đúng hàm của app. */
const toReceipt = (row: LinkedRow): LinkedReceipt => {
  const lines = row.lines as TransactionLine[];
  const adjustments = (row.adjustments ?? []) as PriceAdjustment[];
  const payments = row.payments.map((p) => ({ id: p.id, date: new Date(p.date).toISOString(), amount: Number(p.amount) }));
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const totals = transactionTotals({ lines, adjustments, amountPaid: paid });
  return {
    id: row.id,
    organizationId: row.organization_id,
    date: row.date.toISOString(),
    kind: row.kind as LinkedReceipt['kind'],
    partyName: row.party_name,
    lines: lines.map((line) => {
      const t = lineTotals(line);
      return {
        productName: line.productName,
        unit: line.unit,
        formulaType: line.formulaType,
        grossWeight: line.grossWeight,
        ...(line.tareWeight !== undefined ? { tareWeight: line.tareWeight } : {}),
        ...(line.qualityPercent !== undefined ? { qualityPercent: line.qualityPercent } : {}),
        ...(line.lossPercent !== undefined ? { lossPercent: line.lossPercent } : {}),
        netWeight: t.netWeight,
        pricePerUnit: linePrice(line),
        total: t.total,
      };
    }),
    adjustments: adjustments.map((a) => ({ label: a.label, amount: a.amount })),
    payments,
    netWeight: totals.netWeight,
    total: totals.total,
    paid,
    debt: totals.debt,
  };
};

const Cursor = z.strictObject({ d: z.iso.datetime(), i: z.uuid() });
const encodeCursor = (row: LinkedRow): string =>
  Buffer.from(JSON.stringify({ d: row.date.toISOString(), i: row.id })).toString('base64url');
const decodeCursor = (raw: string): z.infer<typeof Cursor> => {
  try {
    return Cursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new ApiException('VALIDATION_FAILED', 'Cursor không hợp lệ — tải lại từ đầu', { fields: { cursor: 'Cursor không hợp lệ' } });
  }
};

const notFound = (): ApiException => new ApiException('NOT_FOUND', 'Không có kết nối này');

@Injectable()
export class LinksService {
  private readonly db: Database;
  private readonly users: SupabaseUsers;
  private readonly events: DomainEvents;

  constructor(@Inject(DATABASE) db: Database, @Inject(SUPABASE_USERS) users: SupabaseUsers, events: DomainEvents) {
    this.db = db;
    this.users = users;
    this.events = events;
  }

  async list(user: AuthUser, m: MembershipContext): Promise<LinkSummary[]> {
    if (!can(m.orgType, m.role, 'linked:read') && !can(m.orgType, m.role, 'partner:manage')) {
      throw new ApiException('FORBIDDEN', 'Không có quyền xem kết nối', { permission: 'linked:read' });
    }
    const rows = await this.db.scoped({ userId: user.id, orgId: m.organizationId }, (tx) => myLinks(tx));
    return rows.map(toSummary);
  }

  /**
   * Bên sổ mời một dòng danh bạ — kèm mã kết nối để đưa tận tay. Gọi lại không tạo thêm: kết nối
   * đang sống được trả lại; còn chờ mà mã đã (sắp) hết hạn thì cấp mã mới, mã cũ hết dùng được.
   * Số điện thoại của dòng danh bạ không bắt buộc — chỉ lưu lại cho đường dò bằng OTP (tạm ẩn).
   */
  async invite(user: AuthUser, m: MembershipContext, input: LinkInviteInput, requestId: string): Promise<LinkSummary> {
    const orgId = m.organizationId;
    return withFreshCodeRetry(() =>
      this.db.scoped({ userId: user.id, orgId }, async (tx) => {
        const where = { id: input.partnerId, organizationId: orgId, deletedAt: null };
        const partner =
          input.partnerKind === 'supplier'
            ? await tx.supplier.findFirst({ where, select: { phone: true } })
            : await tx.buyer.findFirst({ where, select: { phone: true } });
        if (!partner) throw new ApiException('NOT_FOUND', 'Không có dòng danh bạ này trong sổ');
        const ref = { partnerKind: input.partnerKind, partnerId: input.partnerId };

        const live = await tx.partnerLink.findFirst({
          where: { ownerOrgId: orgId, ...ref, status: { not: 'revoked' } },
          select: { id: true, status: true, inviteCodeExpiresAt: true },
        });
        if (live) {
          if (live.status === 'pending' && needsFreshCode(live.inviteCodeExpiresAt)) {
            await tx.partnerLink.update({ where: { id: live.id }, data: freshLinkCode(), select: { id: true } });
            await audit(tx, user, orgId, 'link.invited', live.id, requestId, { ...ref, renewed: true });
          }
          return findSummary(tx, live.id);
        }

        const created = await tx.partnerLink.create({
          data: { ownerOrgId: orgId, ...ref, invitedPhone: normalizePhone(partner.phone ?? '') || null, ...freshLinkCode() },
          select: { id: true },
        });
        await audit(tx, user, orgId, 'link.invited', created.id, requestId, ref);
        return findSummary(tx, created.id);
      }),
    );
  }

  /**
   * Bên được mời nhập mã kết nối → active ngay; nhập mã là bấm đồng ý. Mã sai, đã dùng, hết hạn
   * đều ra cùng một câu — không dò được mã nào đang sống. Mã của chính mình thì nói rõ (bên sổ
   * vốn thấy mã của mình, không lộ gì thêm).
   */
  async claim(user: AuthUser, m: MembershipContext, input: LinkClaimInput, requestId: string): Promise<LinkSummary> {
    const orgId = m.organizationId;
    const { summary, ownerOrgId } = await this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const own = await tx.partnerLink.findFirst({ where: { ownerOrgId: orgId, inviteCode: input.code }, select: { id: true } });
      if (own) {
        throw new ApiException('VALIDATION_FAILED', 'Đây là mã do chính sổ này cấp — đưa mã cho người được mời nhập', {
          fields: { code: 'Mã của chính sổ này' },
        });
      }

      const rows = await tx.$queryRaw<{ id: string | null }[]>`select public.claim_link(${input.code}) as id`;
      const linkId = rows[0]?.id;
      if (!linkId) throw new ApiException('NOT_FOUND', 'Mã kết nối không đúng, đã dùng hoặc đã hết hạn — xin bên mời lấy mã mới');

      const link = await findSummary(tx, linkId);
      await audit(tx, user, orgId, 'link.accepted', linkId, requestId, { ownerOrgId: link.counterpart?.id ?? null, via: 'code' });
      return { summary: link, ownerOrgId: link.counterpart?.id ?? '' };
    });

    this.events.emit('link.accepted', { linkId: summary.id, ownerOrgId, linkedOrgId: orgId });
    return summary;
  }

  /**
   * Đường OTP (tạm ẩn): CHÍNH bên được liên kết đồng ý lời mời đã dò được, với số điện thoại đã
   * xác thực OTP TRÙNG số được mời — không thì ai đăng ký bằng số người khác cũng xem được công
   * nợ của họ.
   */
  async accept(user: AuthUser, m: MembershipContext, linkId: string, requestId: string): Promise<LinkSummary> {
    const phone = verifiedPhone(await this.users.fetch(user.token));
    const orgId = m.organizationId;

    const { summary, accepted, ownerOrgId } = await this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const link = await tx.partnerLink.findFirst({
        where: { id: linkId, linkedOrgId: orgId, status: { not: 'revoked' } },
        select: { id: true, status: true, invitedPhone: true, ownerOrgId: true },
      });
      if (!link) throw notFound();
      if (link.status === 'active') return { summary: await findSummary(tx, link.id), accepted: false, ownerOrgId: link.ownerOrgId };
      if (!phone || phone !== link.invitedPhone) {
        throw new ApiException('PHONE_NOT_VERIFIED', 'Cần xác thực bằng mã OTP đúng số điện thoại được mời');
      }

      await tx.partnerLink.update({
        where: { id: link.id },
        data: { status: 'active', decidedBy: user.id, decidedAt: new Date() },
        select: { id: true },
      });
      await audit(tx, user, orgId, 'link.accepted', link.id, requestId, { ownerOrgId: link.ownerOrgId });
      return { summary: await findSummary(tx, link.id), accepted: true, ownerOrgId: link.ownerOrgId };
    });

    if (accepted) this.events.emit('link.accepted', { linkId, ownerOrgId, linkedOrgId: orgId, actorUserId: user.id });
    return summary;
  }

  /** Một trong hai bên huỷ — mất quyền xem ngay. Phía sổ cần partner:manage, phía được xem cần linked:read. */
  async revoke(user: AuthUser, m: MembershipContext, linkId: string, requestId: string): Promise<LinkSummary> {
    const orgId = m.organizationId;
    const result = await this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const link = await tx.partnerLink.findFirst({
        where: { id: linkId, OR: [{ ownerOrgId: orgId }, { linkedOrgId: orgId }] },
        select: { id: true, status: true, ownerOrgId: true, linkedOrgId: true },
      });
      if (!link) throw notFound();
      const side: 'owner' | 'linked' = link.ownerOrgId === orgId ? 'owner' : 'linked';
      const permission = side === 'owner' ? 'partner:manage' : 'linked:read';
      if (!can(m.orgType, m.role, permission)) {
        throw new ApiException('FORBIDDEN', 'Không có quyền huỷ kết nối này', { permission });
      }
      if (link.status === 'revoked') return { summary: await findSummary(tx, link.id), revoked: null };

      await tx.partnerLink.update({
        where: { id: link.id },
        data: { status: 'revoked', decidedBy: user.id, decidedAt: new Date() },
        select: { id: true },
      });
      await audit(tx, user, orgId, 'link.revoked', link.id, requestId, { side, from: link.status });
      return { summary: await findSummary(tx, link.id), revoked: { ...link, side } };
    });

    if (result.revoked) {
      this.events.emit('link.revoked', {
        linkId,
        ownerOrgId: result.revoked.ownerOrgId,
        linkedOrgId: result.revoked.linkedOrgId,
        by: result.revoked.side,
        actorUserId: user.id,
      });
    }
    return result.summary;
  }

  async receipts(user: AuthUser, m: MembershipContext, query: LinkedReceiptsQuery): Promise<LinkedReceiptsResult> {
    const limit = query.limit ?? RECEIPTS_DEFAULT_LIMIT;
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const links = await myLinks(tx);
      const linked = links.some((l) => l.side === 'linked' && l.status === 'active' && l.counterpart_id === query.orgId);
      if (!linked) throw new ApiException('LINK_REQUIRED', 'Chưa kết nối với tổ chức này, hoặc kết nối đã huỷ');

      const rows = await linkedReceipts(tx, query.orgId, before ? new Date(before.d) : null, before?.i ?? null, limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return { receipts: page.map(toReceipt), cursor: rows.length > limit && last ? encodeCursor(last) : null };
    });
  }

  async balance(user: AuthUser, m: MembershipContext): Promise<LinkedBalance> {
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const owners = new Map<string, MyLinkRow>();
      for (const link of await myLinks(tx)) {
        if (link.side === 'linked' && link.status === 'active' && link.counterpart_id) owners.set(link.counterpart_id, link);
      }
      if (owners.size === 0) return { items: [] };

      const receipts = (await linkedReceipts(tx, null, null, null, null)).map(toReceipt);
      return {
        items: [...owners.values()].map((owner) => {
          const mine = receipts.filter((r) => r.organizationId === owner.counterpart_id);
          const debtOf = (kind: LinkedReceipt['kind']) =>
            mine.filter((r) => r.kind === kind).reduce((sum, r) => sum + r.debt, 0);
          return {
            organization: {
              id: owner.counterpart_id ?? '',
              name: owner.counterpart_name ?? '',
              type: OrgType.parse(owner.counterpart_type),
            },
            theyOwe: debtOf('purchase'),
            youOwe: debtOf('sale'),
            receiptCount: mine.length,
            lastReceiptAt: mine[0]?.date ?? null,
          };
        }),
      };
    });
  }
}

const myLinks = (tx: Tx): Promise<MyLinkRow[]> => tx.$queryRaw<MyLinkRow[]>`select * from public.my_links()`;

const findSummary = async (tx: Tx, id: string): Promise<LinkSummary> => {
  const row = (await myLinks(tx)).find((l) => l.id === id);
  if (!row) throw notFound();
  return toSummary(row);
};

const linkedReceipts = (
  tx: Tx,
  owner: string | null,
  beforeDate: Date | null,
  beforeId: string | null,
  limit: number | null,
): Promise<LinkedRow[]> =>
  tx.$queryRaw<LinkedRow[]>`
    select * from public.linked_receipts(${owner}::uuid, ${beforeDate}::timestamptz, ${beforeId}::uuid, ${limit}::int)`;

const audit = (
  tx: Tx,
  user: AuthUser,
  orgId: string,
  action: AuditAction,
  linkId: string,
  requestId: string,
  after: Prisma.InputJsonValue,
): Promise<void> =>
  recordAudit(tx, { organizationId: orgId, actorUserId: user.id, action, entity: 'partner_link', entityId: linkId, after, requestId });
