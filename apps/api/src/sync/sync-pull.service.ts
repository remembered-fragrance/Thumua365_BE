/**
 * GET /v1/sync/pull — KH backend §4.2. Cursor: xem sync-cursor.ts.
 *
 * Một trang lấy tối đa `limit` bản ghi, cộng mọi loại, đi lần lượt qua tám bảng. Gồm cả bản
 * ghi đã xoá mềm. Phạm vi: người không gắn chi nhánh kéo cả tổ chức; người gắn chi nhánh kéo
 * phiếu, nháp, lần trả của chi nhánh mình + danh mục chung.
 *
 * 🔴 Lần trả tiền không bao giờ mồ côi (quy tắc số 5): bảng `payment` đi SAU `transaction`,
 * nên phiếu cha đổi trong lượt đã được trả ở trang trước. Riêng phiếu cha vừa đổi SAU mốc
 * `until` (bị lượt này bỏ qua) thì được kèm luôn vào trang có lần trả của nó.
 */

import {
  SYNC_CHANGE_KEY,
  SYNC_ENTITIES,
  SYNC_PULL_DEFAULT_LIMIT,
  type SyncChanges,
  type SyncPullQuery,
  type SyncPullResult,
} from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { DATABASE, type Database, type Tx } from '../db/database';
import { decodeCursor, encodeCursor, PULL_OVERLAP_MS, type PullCursor, startCursor } from './sync-cursor';
import { branchFilter, delegateOf, SYNC_TABLES } from './sync-tables';

const emptyChanges = (): SyncChanges => ({
  suppliers: [],
  buyers: [],
  products: [],
  pricingRules: [],
  notes: [],
  drafts: [],
  transactions: [],
  payments: [],
});

interface Key {
  readonly at: Date;
  readonly id: string;
}

@Injectable()
export class SyncPullService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  async pull(user: AuthUser, membership: MembershipContext, query: SyncPullQuery): Promise<SyncPullResult> {
    const orgId = membership.organizationId;
    const scope = membership.branchId;
    const cursor = query.cursor ? decodeCursor(query.cursor, orgId) : startCursor(orgId, scope);

    // Đổi chi nhánh: sổ cục bộ đang giữ phạm vi cũ — app xả hàng đợi, xoá sổ, kéo lại.
    if (cursor.b !== scope) {
      return { cursor: encodeCursor(startCursor(orgId, scope)), hasMore: true, resetRequired: true, changes: emptyChanges() };
    }

    return this.db.scoped({ userId: user.id, orgId }, (tx) =>
      this.page(tx, orgId, scope, cursor, query.limit ?? SYNC_PULL_DEFAULT_LIMIT),
    );
  }

  private async page(tx: Tx, orgId: string, scope: string | null, cursor: PullCursor, limit: number) {
    const until = cursor.u ? new Date(cursor.u) : await databaseNow(tx);
    const since = cursor.s ? new Date(cursor.s) : null;
    const changes = emptyChanges();

    let t = cursor.t;
    let after: Key | null = cursor.k ? { at: new Date(cursor.k.at), id: cursor.k.id } : null;
    let remaining = limit;

    while (t < SYNC_ENTITIES.length) {
      const entity = SYNC_ENTITIES[t] ?? 'payment';
      const table = SYNC_TABLES[entity];
      const rows = await delegateOf(tx, entity).findMany({
        where: {
          AND: [
            { organizationId: orgId },
            { updatedAt: since ? { gt: since, lte: until } : { lte: until } },
            after ? { OR: [{ updatedAt: { gt: after.at } }, { updatedAt: after.at, id: { gt: after.id } }] } : {},
            branchFilter(table.branch, scope),
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: remaining,
      });
      (changes[SYNC_CHANGE_KEY[entity]] as unknown[]).push(...rows.map((row) => table.toRecord(row as never)));
      remaining -= rows.length;

      const last = rows.at(-1);
      if (remaining === 0 && last) {
        // Trang đầy: có thể bảng này còn nữa — trang sau đi tiếp từ đúng bản ghi cuối.
        after = { at: last.updatedAt, id: last.id };
        break;
      }
      t += 1;
      after = null;
    }

    await this.addLateParents(tx, orgId, scope, until, changes);

    const done = t >= SYNC_ENTITIES.length;
    const next: PullCursor = done
      ? { ...cursor, s: new Date(until.getTime() - PULL_OVERLAP_MS).toISOString(), u: null, t: 0, k: null }
      : { ...cursor, u: until.toISOString(), t, k: after ? { at: after.at.toISOString(), id: after.id } : null };
    return { cursor: encodeCursor(next), hasMore: !done, resetRequired: false, changes };
  }

  /** Phiếu cha đổi sau mốc `until` — lượt này đã bỏ qua nó ở bảng `transaction`. */
  private async addLateParents(tx: Tx, orgId: string, scope: string | null, until: Date, changes: SyncChanges) {
    const have = new Set(changes.transactions.map((t) => t.id));
    const missing = [...new Set(changes.payments.map((p) => p.transactionId))].filter((id) => !have.has(id));
    if (missing.length === 0) return;

    const table = SYNC_TABLES.transaction;
    const rows = await delegateOf(tx, 'transaction').findMany({
      where: {
        AND: [{ organizationId: orgId }, { id: { in: missing } }, { updatedAt: { gt: until } }, branchFilter(table.branch, scope)],
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: missing.length,
    });
    changes.transactions.push(...rows.map((row) => table.toRecord(row as never) as SyncChanges['transactions'][number]));
  }
}

/** Giờ của DATABASE (cùng đồng hồ đặt `updated_at`), cắt về mili-giây như cột. */
const databaseNow = async (tx: Tx): Promise<Date> => {
  const [row] = await tx.$queryRaw<{ now: Date }[]>`select date_trunc('milliseconds', clock_timestamp()) as now`;
  if (!row) throw new Error('Không đọc được giờ database');
  return row.now;
};
