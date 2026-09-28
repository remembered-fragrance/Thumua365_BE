/**
 * POST /v1/sync/push trên Postgres thật — năm quy tắc chống mất tiền (KH §4.4), quyền từng op,
 * chi nhánh, gói. Mỗi quy tắc một test; kịch bản VAN_HANH §6 ghi kèm số.
 */

import { ErrorBody, isRetryable, SyncPushResult } from '@mambo/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, createOrg, newId, service, truncateAll } from './db';
import {
  addMember,
  buildSyncApp,
  createBranch,
  giveTrial,
  opMaker,
  paymentData,
  pushAs,
  rubberLine,
  type SyncApp,
  txData,
} from './sync-fixture';

let s: SyncApp;
let owner: string;
let staff: string;
let org: string;
let ownerToken: string;
let staffToken: string;

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
  staff = newId();
  org = await createOrg('trader', owner, 'Vựa Tư Hùng');
  await giveTrial(org);
  await addMember(org, staff, 'staff');
  ownerToken = await s.tokenFor(owner);
  staffToken = await s.tokenFor(staff);
});

const push = async (token: string, ops: unknown[], deviceId?: string, orgId = org) => {
  const res = await pushAs(s.app, token, orgId, ops, deviceId).expect(200);
  return SyncPushResult.parse(res.body).results;
};

const count = async (table: string): Promise<number> =>
  Number((await admin.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

const paidOf = async (txId: string): Promise<number> =>
  Number(
    (
      await admin.query<{ s: string }>(
        'select coalesce(sum(amount), 0) as s from payments where transaction_id = $1 and deleted_at is null',
        [txId],
      )
    ).rows[0]?.s,
  );

describe('năm quy tắc chống mất tiền', () => {
  it('#1 lần trả chỉ ghi thêm: hai máy trả cùng phiếu song song → tổng bằng cả hai (VAN_HANH 4)', async () => {
    const op = opMaker();
    const txId = newId();
    await push(ownerToken, [op('transaction', 'insert', txId, txData())]);

    const [a, b] = await Promise.all([
      push(ownerToken, [opMaker()('payment', 'insert', newId(), paymentData(txId, 3_000_000))], newId()),
      push(staffToken, [opMaker()('payment', 'insert', newId(), paymentData(txId, 5_000_000))], newId()),
    ]);
    expect([a[0]?.status, b[0]?.status]).toEqual(['applied', 'applied']);
    expect(await paidOf(txId)).toBe(8_000_000);
  });

  it('#2 gửi trùng: cả lô gửi lại → duplicate; cùng phiếu, op khác (bấm "Hoàn thành" hai lần) → vẫn một phiếu (VAN_HANH 1, 3)', async () => {
    const op = opMaker();
    const txId = newId();
    const ops = [op('transaction', 'insert', txId, txData()), op('payment', 'insert', newId(), paymentData(txId, 500_000))];

    expect((await push(ownerToken, ops)).map((r) => r.status)).toEqual(['applied', 'applied']);
    expect((await push(ownerToken, ops)).map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    expect((await push(ownerToken, [op('transaction', 'insert', txId, txData())]))[0]?.status).toBe('duplicate');

    expect([await count('transactions'), await count('payments'), await paidOf(txId)]).toEqual([1, 1, 500_000]);
  });

  it('#3 xoá thắng: xoá rồi sửa đến sau → vẫn xoá, op được nhận kèm cảnh báo (VAN_HANH 5)', async () => {
    const id = newId();
    const a = opMaker();
    await push(ownerToken, [a('supplier', 'insert', id, { name: 'Cô Mai' }), a('supplier', 'softDelete', id)]);

    // Máy B sửa lúc mất mạng, lên sau.
    const late = await push(ownerToken, [opMaker()('supplier', 'update', id, { name: 'Cô Mai (sửa)' })], newId());
    expect(late[0]).toMatchObject({ status: 'applied', warning: 'RECORD_DELETED' });

    const { rows } = await admin.query('select name, deleted_at from suppliers where id = $1', [id]);
    expect(rows[0]?.name).toBe('Cô Mai');
    expect(rows[0]?.deleted_at).not.toBeNull();
    // Xoá lần nữa: đã xoá rồi.
    expect((await push(ownerToken, [opMaker()('supplier', 'softDelete', id)]))[0]?.status).toBe('duplicate');
  });

  it('#4 theo seq: phiếu + lần trả cùng lô, cùng mili-giây → cả hai vào; lần trả đến trước phiếu → PARENT_MISSING, dừng lô', async () => {
    const op = opMaker();
    const txId = newId();
    const ok = await push(ownerToken, [op('transaction', 'insert', txId, txData()), op('payment', 'insert', newId(), paymentData(txId, 1))]);
    expect(ok.map((r) => r.status)).toEqual(['applied', 'applied']);

    const orphan = opMaker();
    const noteId = newId();
    const res = await push(ownerToken, [
      orphan('payment', 'insert', newId(), paymentData(newId(), 1_000)),
      orphan('note', 'insert', noteId, { body: 'không được xử lý' }),
    ]);
    expect(res).toHaveLength(1);
    expect(res[0]?.error?.code).toBe('PARENT_MISSING');
    expect(isRetryable('PARENT_MISSING')).toBe(true);
    expect(await count('notes')).toBe(0);
  });
});

describe('kiểm từng op', () => {
  it('một op sai chỉ làm op đó bị từ chối, kèm đúng trường sai; op trước vẫn vào', async () => {
    const op = opMaker();
    const res = await push(ownerToken, [op('note', 'insert', newId(), { body: 'ok' }), op('note', 'insert', newId(), { body: 42 })]);
    expect(res[0]?.status).toBe('applied');
    expect(res[1]).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED' } });
    expect(Object.keys(res[1]?.error?.details?.fields as object)).toEqual(['data.body']);
  });

  it('tổng tiền dòng lệch với core → VALIDATION_FAILED chỉ đúng dòng, không ghi gì', async () => {
    const bad = { ...rubberLine(), roundedTotal: 1_500_000 };
    const res = await push(ownerToken, [opMaker()('transaction', 'insert', newId(), txData({ lines: [rubberLine(), bad] }))]);
    expect(res[0]?.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: { 'data.lines.1.roundedTotal': 'Máy chủ tính ra 1438000' } },
    });
    expect(await count('transactions')).toBe(0);
  });

  it('server lưu dòng đã đóng băng bằng core và điền người tạo, tổ chức', async () => {
    const txId = newId();
    await push(staffToken, [opMaker()('transaction', 'insert', txId, txData())]);
    const { rows } = await admin.query('select organization_id, created_by, lines from transactions where id = $1', [txId]);
    expect(rows[0]).toMatchObject({ organization_id: org, created_by: staff });
    expect(rows[0]?.lines[0]).toMatchObject({ rawTotal: 1_438_200, roundedTotal: 1_438_000 });
  });

  it('🔴 id đã có ở tổ chức khác → rejected, KHÔNG phải duplicate (không thì máy xoá op, mất phiếu)', async () => {
    const other = await createOrg('trader', newId(), 'Vựa khác');
    const txId = newId();
    await admin.query(
      `insert into transactions (id, organization_id, created_by, date, kind, supplier_name, lines)
       values ($1, $2, $3, now(), 'purchase', 'x', '[]')`,
      [txId, other, newId()],
    );
    const res = await push(ownerToken, [opMaker()('transaction', 'insert', txId, txData())]);
    expect(res[0]).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED' } });
  });

  it('lần trả cho phiếu đã bị xoá ở máy khác: tiền vẫn được lưu, kèm cảnh báo', async () => {
    const txId = newId();
    const op = opMaker();
    await push(ownerToken, [op('transaction', 'insert', txId, txData()), op('transaction', 'softDelete', txId)]);
    const res = await push(staffToken, [opMaker()('payment', 'insert', newId(), paymentData(txId, 200_000))]);
    expect(res[0]).toMatchObject({ status: 'applied', warning: 'RECORD_DELETED' });
    expect(await count('payments')).toBe(1);
  });
});

describe('quyền từng op', () => {
  it('người cân: lập phiếu kèm người bán mới, mặt hàng mới, sửa giá gần nhất — được', async () => {
    const productId = newId();
    const op = opMaker();
    const res = await push(staffToken, [
      op('supplier', 'insert', newId(), { name: 'Cô Mai', phone: '0912345678' }),
      op('product', 'insert', productId, { name: 'Mủ chén', formulaType: 'standard' }),
      op('product', 'update', productId, { lastPricePerUnit: 18_000 }),
      op('transaction', 'insert', newId(), txData()),
    ]);
    expect(res.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
  });

  it('người cân: xoá phiếu, huỷ lần trả, đổi tên mặt hàng → FORBIDDEN, dừng ở đó', async () => {
    const txId = newId();
    const payId = newId();
    const productId = newId();
    const o = opMaker();
    await push(ownerToken, [
      o('transaction', 'insert', txId, txData()),
      o('payment', 'insert', payId, paymentData(txId, 1_000)),
      o('product', 'insert', productId, { name: 'Mủ chén', formulaType: 'standard' }),
    ]);

    const forbidden: [string, string, string, unknown?][] = [
      ['transaction', 'softDelete', txId],
      ['payment', 'softDelete', payId],
      ['product', 'update', productId, { name: 'Mủ dây', lastPricePerUnit: 1 }],
    ];
    for (const [entity, kind, id, data] of forbidden) {
      const op = opMaker();
      const res = await push(staffToken, [op(entity, kind, id, data), op('note', 'insert', newId(), { body: 'x' })]);
      expect(res).toHaveLength(1);
      expect(res[0]?.error?.code).toBe('FORBIDDEN');
    }
    expect(await count('notes')).toBe(0);
  });

  it('xoá phiếu và huỷ lần trả ghi nhật ký trong cùng transaction', async () => {
    const txId = newId();
    const payId = newId();
    const op = opMaker();
    await push(ownerToken, [
      op('transaction', 'insert', txId, txData()),
      op('payment', 'insert', payId, paymentData(txId, 700_000)),
      op('payment', 'softDelete', payId),
      op('transaction', 'softDelete', txId),
    ]);
    const { rows } = await admin.query<{ action: string; entity_id: string; before: Record<string, unknown>; request_id: string }>(
      `select action, entity_id, before, request_id from audit_log where organization_id = $1 order by created_at`,
      [org],
    );
    expect(rows.map((r) => [r.action, r.entity_id])).toEqual([
      ['payment.voided', payId],
      ['receipt.deleted', txId],
    ]);
    expect(rows[0]?.before).toMatchObject({ transactionId: txId, amount: 700_000 });
    expect(rows[1]?.before).toMatchObject({ kind: 'purchase', total: 1_438_000 });
    expect(rows.every((r) => r.request_id)).toBe(true);
  });

  it('nông dân không đồng bộ sổ → 403 FORBIDDEN', async () => {
    const farmer = newId();
    const farm = await createOrg('farmer', farmer, 'Hộ cô Mai');
    const res = await pushAs(s.app, await s.tokenFor(farmer), farm, [opMaker()('note', 'insert', newId(), { body: 'x' })]).expect(403);
    expect(ErrorBody.parse(res.body).error.code).toBe('FORBIDDEN');
  });
});

describe('gói', () => {
  it('hết gói → 402 PLAN_EXPIRED cho cả lượt, không ghi gì', async () => {
    await admin.query(`update subscriptions set trial_ends_at = now() - interval '1 day' where organization_id = $1`, [org]);
    const res = await pushAs(s.app, ownerToken, org, [opMaker()('note', 'insert', newId(), { body: 'x' })]).expect(402);
    expect(ErrorBody.parse(res.body).error.code).toBe('PLAN_EXPIRED');
    expect([await count('notes'), await count('sync_ops')]).toEqual([0, 0]);
  });
});

describe('chi nhánh (doanh nghiệp)', () => {
  let dn: string;
  let branchA: string;
  let branchB: string;
  let staffA: string;
  let staffB: string;

  beforeEach(async () => {
    const boss = newId();
    dn = await createOrg('enterprise', boss, 'Công ty Đồng Phú');
    await giveTrial(dn);
    branchA = await createBranch(dn, 'Chi nhánh A');
    branchB = await createBranch(dn, 'Chi nhánh B');
    staffA = newId();
    staffB = newId();
    await addMember(dn, staffA, 'staff', branchA);
    await addMember(dn, staffB, 'staff', branchB);
  });

  it('nhân viên gắn chi nhánh: phiếu tự mang chi nhánh mình; ghi cho chi nhánh khác → FORBIDDEN', async () => {
    const tokenA = await s.tokenFor(staffA);
    const txId = newId();
    await push(tokenA, [opMaker()('transaction', 'insert', txId, txData())], undefined, dn);
    const { rows } = await admin.query('select branch_id from transactions where id = $1', [txId]);
    expect(rows[0]?.branch_id).toBe(branchA);

    const res = await push(tokenA, [opMaker()('transaction', 'insert', newId(), txData({ branchId: branchB }))], undefined, dn);
    expect(res[0]?.error?.code).toBe('FORBIDDEN');
  });

  it('nhân viên chi nhánh B không trả tiền, không sửa được phiếu chi nhánh A', async () => {
    const txId = newId();
    await push(await s.tokenFor(staffA), [opMaker()('transaction', 'insert', txId, txData())], undefined, dn);
    const tokenB = await s.tokenFor(staffB);
    for (const bad of [
      opMaker()('payment', 'insert', newId(), paymentData(txId, 1_000)),
      opMaker()('transaction', 'update', txId, { note: 'sửa hộ' }),
    ]) {
      expect((await push(tokenB, [bad], undefined, dn))[0]?.error?.code).toBe('FORBIDDEN');
    }
  });

  it('chi nhánh của tổ chức khác → bị từ chối ở khoá ngoại ghép', async () => {
    const foreign = await createBranch(org, 'Chi nhánh của vựa');
    const boss = (await admin.query<{ user_id: string }>(`select user_id from memberships where organization_id = $1 and role = 'owner'`, [dn]))
      .rows[0]?.user_id as string;
    const res = await push(await s.tokenFor(boss), [opMaker()('transaction', 'insert', newId(), txData({ branchId: foreign }))], undefined, dn);
    expect(res[0]).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED' } });
  });
});
