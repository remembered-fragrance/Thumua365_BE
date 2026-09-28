/**
 * GET /v1/sync/pull trên Postgres thật — cursor do server cấp, phân trang không mất và không
 * mồ côi lần trả (quy tắc số 5), bản ghi đã xoá vẫn về, phạm vi chi nhánh.
 */

import { ErrorBody, type SyncChanges, SyncPullResult } from '@mambo/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, createOrg, newId, service, truncateAll } from './db';
import {
  addMember,
  buildSyncApp,
  createBranch,
  giveTrial,
  opMaker,
  paymentData,
  pullAs,
  pushAs,
  type SyncApp,
  txData,
} from './sync-fixture';

let s: SyncApp;
let owner: string;
let org: string;
let token: string;

beforeAll(async () => {
  s = await buildSyncApp();
});

afterAll(async () => {
  await s.app.close();
  await admin.end();
  await service.end();
});

beforeEach(async () => {
  await truncateAll();
  owner = newId();
  org = await createOrg('trader', owner, 'Vựa Tư Hùng');
  await giveTrial(org);
  token = await s.tokenFor(owner);
});

const push = async (ops: unknown[], as = token, orgId = org) => {
  const res = await pushAs(s.app, as, orgId, ops).expect(200);
  expect(res.body.results.every((r: { status: string }) => r.status !== 'rejected')).toBe(true);
};

const page = async (query: Record<string, string | number> = {}, as = token, orgId = org) =>
  SyncPullResult.parse((await pullAs(s.app, as, orgId, query).expect(200)).body);

/** Kéo tới khi hasMore = false. Trả mọi trang + cursor cuối. */
const pullAll = async (limit: number, cursor?: string, as = token, orgId = org) => {
  const pages: SyncChanges[] = [];
  let next = cursor;
  for (let i = 0; i < 100; i++) {
    const res = await page({ limit, ...(next ? { cursor: next } : {}) }, as, orgId);
    pages.push(res.changes);
    next = res.cursor;
    if (!res.hasMore) return { pages, cursor: next };
  }
  throw new Error('Kéo mãi không hết — cursor không tiến');
};

const ids = (pages: SyncChanges[], key: keyof SyncChanges): string[] => pages.flatMap((p) => p[key].map((r) => r.id));

/** Ba phiếu, mỗi phiếu một lần trả, một người bán, một ghi chú. */
const seedBook = async () => {
  const op = opMaker();
  const txIds = [newId(), newId(), newId()];
  await push([
    op('supplier', 'insert', newId(), { name: 'Cô Mai' }),
    op('note', 'insert', newId(), { body: 'Gọi cô Mai' }),
    ...txIds.flatMap((id, i) => [op('transaction', 'insert', id, txData()), op('payment', 'insert', newId(), paymentData(id, (i + 1) * 100_000))]),
  ]);
  return txIds;
};

describe('kéo về', () => {
  it('lần đầu: đủ mọi loại, đúng hợp đồng, tiền là số nguyên đồng', async () => {
    const txIds = await seedBook();
    const res = await page();
    expect(res.hasMore).toBe(false);
    expect(res.changes.suppliers).toHaveLength(1);
    expect(res.changes.notes).toHaveLength(1);
    expect(res.changes.transactions.map((t) => t.id).sort()).toEqual([...txIds].sort());
    expect(res.changes.payments.map((p) => p.amount).sort()).toEqual([100_000, 200_000, 300_000]);
    expect(res.changes.transactions[0]).toMatchObject({ counterpartyId: null, lines: [{ roundedTotal: 1_438_000 }], deletedAt: null });
  });

  it('🔴 #5 phân trang: mỗi lần trả đều đã có phiếu cha ở trang này hoặc trước đó; không mất, không trùng', async () => {
    await seedBook();
    for (const limit of [1, 2, 3]) {
      const { pages } = await pullAll(limit);
      const seen = new Set<string>();
      for (const p of pages) {
        for (const t of p.transactions) seen.add(t.id);
        for (const pay of p.payments) expect(seen.has(pay.transactionId), `limit ${limit}`).toBe(true);
      }
      expect(ids(pages, 'transactions')).toHaveLength(3);
      expect(new Set(ids(pages, 'payments')).size).toBe(3);
      expect(ids(pages, 'payments')).toHaveLength(3);
    }
  });

  it('🔴 phiếu cha đổi GIỮA lượt kéo (sau mốc until) vẫn đi kèm lần trả của nó', async () => {
    const [txId] = await seedBook();
    // Trang 1 dừng ở danh mục — mốc until của lượt đã chốt, bảng phiếu chưa đọc.
    const first = await page({ limit: 1 });
    expect(first.changes.suppliers).toHaveLength(1);

    // Giữa lượt: máy khác sửa phiếu → updated_at của nó vượt mốc until, lượt này bỏ qua ở bảng phiếu.
    await push([opMaker()('transaction', 'update', txId as string, { note: 'đã giao đủ' })]);

    const { pages } = await pullAll(100, first.cursor);
    const seen = new Set<string>();
    for (const p of pages) {
      for (const t of p.transactions) seen.add(t.id);
      for (const pay of p.payments) expect(seen.has(pay.transactionId)).toBe(true);
    }
    expect(pages.flatMap((p) => p.transactions).find((t) => t.id === txId)?.note).toBe('đã giao đủ');
  });

  it('bản ghi đã xoá mềm vẫn về, kèm deletedAt; lần trả bị huỷ cũng vậy (lỗi #1 của bản cũ)', async () => {
    const [txId] = await seedBook();
    const { cursor } = await pullAll(500);
    const payId = (await admin.query<{ id: string }>('select id from payments where transaction_id = $1', [txId])).rows[0]?.id as string;
    await push([opMaker()('payment', 'softDelete', payId)]);

    const res = await page({ cursor });
    expect(res.changes.payments.find((p) => p.id === payId)?.deletedAt).not.toBeNull();
  });

  it('cursor nghỉ: lượt sau chỉ lấy phần đổi gần đây, không tải lại cả sổ', async () => {
    // Bản ghi cũ một giờ trước (ghi thẳng bằng admin — insert không chạy trigger updated_at).
    await admin.query(
      `insert into suppliers (id, organization_id, created_by, name, updated_at)
       values ($1, $2, $3, 'Cũ', now() - interval '1 hour')`,
      [newId(), org, owner],
    );
    const { cursor } = await pullAll(500);
    const noteId = newId();
    await push([opMaker()('note', 'insert', noteId, { body: 'Mới' })]);

    const res = await page({ cursor });
    expect(res.changes.suppliers).toEqual([]);
    expect(res.changes.notes.map((n) => n.id)).toEqual([noteId]);
  });

  it('mặt hàng mặc định do /me/bootstrap tạo có id UUID và về cùng sổ', async () => {
    // Mô phỏng đúng thứ bootstrap ghi — test bootstrap thật nằm ở api.db.test.ts.
    await admin.query(
      `insert into products (id, organization_id, created_by, name, formula_type, is_suggested, crop)
       values ($1, $2, $3, 'Cao su', 'rubberLatex', true, 'rubber')`,
      [newId(), org, owner],
    );
    const res = await page();
    expect(res.changes.products[0]).toMatchObject({ name: 'Cao su', isSuggested: true, qualityGrades: [], unit: 'kg' });
  });
});

describe('cursor', () => {
  it('cursor hỏng hoặc của tổ chức khác → 422, chỉ trường cursor', async () => {
    const other = await createOrg('trader', owner, 'Vựa thứ hai');
    await giveTrial(other);
    const { cursor } = await pullAll(500, undefined, token, other);

    for (const bad of ['không-phải-cursor', cursor]) {
      const res = await pullAs(s.app, token, org, { cursor: bad }).expect(422);
      expect(ErrorBody.parse(res.body).error.details).toEqual({ fields: { cursor: 'Cursor không hợp lệ' } });
    }
  });

  it('limit ngoài khoảng hoặc tham số lạ → 422', async () => {
    await pullAs(s.app, token, org, { limit: 0 }).expect(422);
    await pullAs(s.app, token, org, { since: '2026-09-01T00:00:00Z' }).expect(422);
  });

  it('nông dân không kéo sổ → 403', async () => {
    const farmer = newId();
    const farm = await createOrg('farmer', farmer, 'Hộ cô Mai');
    await pullAs(s.app, await s.tokenFor(farmer), farm).expect(403);
  });
});

describe('phạm vi chi nhánh (doanh nghiệp)', () => {
  let dn: string;
  let boss: string;
  let branchA: string;
  let branchB: string;
  let staffA: string;

  beforeEach(async () => {
    boss = newId();
    dn = await createOrg('enterprise', boss, 'Công ty Đồng Phú');
    await giveTrial(dn);
    branchA = await createBranch(dn, 'Chi nhánh A');
    branchB = await createBranch(dn, 'Chi nhánh B');
    staffA = newId();
    await addMember(dn, staffA, 'staff', branchA);
  });

  it('nhân viên chỉ thấy phiếu và lần trả chi nhánh mình; chủ thấy cả hai; danh mục chung ai cũng thấy', async () => {
    const bossToken = await s.tokenFor(boss);
    const op = opMaker();
    const [txA, txB] = [newId(), newId()];
    await push(
      [
        op('supplier', 'insert', newId(), { name: 'Nhà cung cấp chung' }),
        op('transaction', 'insert', txA, txData({ branchId: branchA })),
        op('payment', 'insert', newId(), paymentData(txA, 1_000)),
        op('transaction', 'insert', txB, txData({ branchId: branchB })),
        op('payment', 'insert', newId(), paymentData(txB, 2_000)),
      ],
      bossToken,
      dn,
    );

    const mine = await page({}, await s.tokenFor(staffA), dn);
    expect(mine.changes.transactions.map((t) => t.id)).toEqual([txA]);
    expect(mine.changes.payments.map((p) => p.transactionId)).toEqual([txA]);
    expect(mine.changes.suppliers).toHaveLength(1);

    const all = await page({}, bossToken, dn);
    expect(all.changes.transactions.map((t) => t.id).sort()).toEqual([txA, txB].sort());
  });

  it('đổi chi nhánh → resetRequired, changes rỗng, cursor mới cho phạm vi mới', async () => {
    const tokenA = await s.tokenFor(staffA);
    const { cursor } = await pullAll(500, undefined, tokenA, dn);
    await admin.query('update memberships set branch_id = $1 where user_id = $2', [branchB, staffA]);

    const res = await page({ cursor }, tokenA, dn);
    expect(res).toMatchObject({ resetRequired: true, hasMore: true });
    expect(Object.values(res.changes).every((list) => list.length === 0)).toBe(true);

    const again = await page({ cursor: res.cursor }, tokenA, dn);
    expect(again.resetRequired).toBe(false);
  });
});
