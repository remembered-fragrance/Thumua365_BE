import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  can,
  parseSyncOp,
  SYNC_ENTITIES,
  SYNC_OP_DATA,
  SYNC_PUSH_MAX_OPS,
  SyncOp,
  SyncPullQuery,
  SyncPullResult,
  SyncPushInput,
  syncOpPermission,
  type MemberRole,
  type OrgType,
  type SyncEntity,
  type SyncOpEnvelope,
  type SyncOpKind,
} from '../src/index.js';

const id = () => randomUUID();
const NOW = '2026-09-28T03:00:00.000Z';

const line = {
  id: 'l1',
  productId: 'prod-rubber',
  productName: 'Cao su',
  unit: 'kg',
  formulaType: 'rubberLatex',
  grossWeight: 100,
  qualityPercent: 30,
  pricePerUnit: 47_940,
  rawTotal: 1_438_200,
  roundedTotal: 1_438_000,
} as const;

const transaction = {
  date: NOW,
  kind: 'purchase',
  counterpartyId: null,
  supplierName: 'Khách lẻ',
  lines: [line],
} as const;

const op = (entity: string, kind: string, data?: unknown, recordId: string = id()): SyncOpEnvelope => ({
  opId: id(),
  seq: 1,
  entity,
  kind,
  recordId,
  ...(data === undefined ? {} : { data }),
});

describe('parseSyncOp — kiểm từng op', () => {
  it('op hợp lệ: data được chuẩn hoá (cắt khoảng trắng)', () => {
    const res = parseSyncOp(op('supplier', 'insert', { name: '  Cô Mai ', phone: '0912 345 678' }));
    expect(res).toMatchObject({ ok: true, op: { entity: 'supplier', kind: 'insert', data: { name: 'Cô Mai' } } });
  });

  it('không nhận organizationId / createdBy từ client — server tự điền', () => {
    const res = parseSyncOp(op('supplier', 'insert', { name: 'Cô Mai', organizationId: id() }));
    expect(res.ok).toBe(false);
  });

  it('lần trả tiền không sửa được — không bao giờ sửa số tiền', () => {
    expect(parseSyncOp(op('payment', 'update', { amount: 1 }))).toEqual({
      ok: false,
      fields: { kind: 'payment không có thao tác update' },
    });
  });

  it('id mặt hàng mặc định kiểu cũ (`prod-rubber`) bị từ chối với lời giải thích', () => {
    const res = parseSyncOp(op('product', 'update', { lastPricePerUnit: 48_000 }, 'prod-rubber'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fields.recordId).toContain('prod-');
  });

  it('phiếu đã chốt phải mang tổng đã đóng băng; chỉ ra đúng trường thiếu', () => {
    const { roundedTotal: _, ...unfrozen } = line;
    const res = parseSyncOp(op('transaction', 'insert', { ...transaction, lines: [unfrozen] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.fields)).toEqual(['data.lines.0.roundedTotal']);
  });

  it('phiếu không mang amountPaid hay payments — số đã trả là tổng các payment', () => {
    expect(parseSyncOp(op('transaction', 'insert', { ...transaction, amountPaid: 0 })).ok).toBe(false);
    expect(parseSyncOp(op('transaction', 'insert', { ...transaction, payments: [] })).ok).toBe(false);
  });

  it('phiếu đã chốt chỉ sửa được chứng từ và ghi chú', () => {
    expect(parseSyncOp(op('transaction', 'update', { note: 'đã giao đủ' })).ok).toBe(true);
    expect(parseSyncOp(op('transaction', 'update', { lines: [line] })).ok).toBe(false);
  });

  it('patch rỗng bị từ chối; null = xoá giá trị', () => {
    expect(parseSyncOp(op('note', 'update', {})).ok).toBe(false);
    expect(parseSyncOp(op('supplier', 'update', { phone: null })).ok).toBe(true);
    expect(parseSyncOp(op('supplier', 'update', { name: null })).ok).toBe(false);
  });

  it('softDelete không mang data; insert/update bắt buộc có', () => {
    expect(parseSyncOp(op('transaction', 'softDelete')).ok).toBe(true);
    expect(parseSyncOp(op('transaction', 'softDelete', {})).ok).toBe(false);
    expect(parseSyncOp(op('note', 'insert')).ok).toBe(false);
  });

  it('tiền là số nguyên đồng; thời gian phải có múi giờ', () => {
    const tx = id();
    expect(parseSyncOp(op('payment', 'insert', { transactionId: tx, date: NOW, amount: 1_000.5 })).ok).toBe(false);
    expect(parseSyncOp(op('payment', 'insert', { transactionId: tx, date: NOW, amount: 0 })).ok).toBe(false);
    expect(parseSyncOp(op('payment', 'insert', { transactionId: tx, date: '2026-09-28', amount: 1 })).ok).toBe(false);
    expect(parseSyncOp(op('payment', 'insert', { transactionId: tx, date: NOW, amount: 1_438_000 })).ok).toBe(true);
  });

  it('loại bản ghi, loại thao tác lạ bị từ chối', () => {
    expect(parseSyncOp(op('transactions', 'insert', transaction)).ok).toBe(false);
    expect(parseSyncOp(op('transaction', 'upsert', transaction)).ok).toBe(false);
  });
});

describe('SyncOp — hình dạng đầy đủ khớp SYNC_OP_DATA', () => {
  const samples: Record<SyncEntity, unknown> = {
    supplier: { name: 'Cô Mai' },
    buyer: { name: 'Nhà máy Đồng Phú' },
    product: { name: 'Cao su', formulaType: 'rubberLatex' },
    pricingRule: { name: 'Phí xe', kind: 'logistics', active: true, fixedAmount: -50_000 },
    note: { body: 'Gọi cô Mai' },
    draft: { status: 'draft', supplierName: '', lines: [], amountPaid: 0 },
    transaction,
    payment: { transactionId: id(), date: NOW, amount: 500_000 },
  };

  for (const entity of SYNC_ENTITIES) {
    it(`${entity}: insert và softDelete qua được cả hai đường kiểm`, () => {
      const insert = op(entity, 'insert', samples[entity]);
      expect(parseSyncOp(insert).ok).toBe(true);
      expect(SyncOp.safeParse(insert).success).toBe(true);
      expect(SyncOp.safeParse(op(entity, 'softDelete')).success).toBe(true);
    });
  }

  it('payment là loại duy nhất không có update', () => {
    const noUpdate = SYNC_ENTITIES.filter((e) => SYNC_OP_DATA[e].update === null);
    expect(noUpdate).toEqual(['payment']);
    expect(SyncOp.safeParse(op('payment', 'update', { note: 'x' })).success).toBe(false);
  });
});

describe('SyncPushInput — vỏ của lô', () => {
  const body = (ops: SyncOpEnvelope[]) => ({ deviceId: id(), ops });

  it('cổng chỉ kiểm vỏ: data sai vẫn qua để bị từ chối theo từng op', () => {
    expect(SyncPushInput.safeParse(body([op('note', 'insert', { body: 42 })])).success).toBe(true);
  });

  it('seq phải tăng dần; opId không trùng trong lô', () => {
    const a = { ...op('note', 'softDelete'), seq: 5 };
    const b = { ...op('note', 'softDelete'), seq: 5 };
    expect(SyncPushInput.safeParse(body([a, b])).success).toBe(false);
    expect(SyncPushInput.safeParse(body([a, { ...a, seq: 6 }])).success).toBe(false);
    expect(SyncPushInput.safeParse(body([a, { ...b, seq: 6 }])).success).toBe(true);
  });

  it(`lô rỗng hoặc quá ${SYNC_PUSH_MAX_OPS} op bị từ chối`, () => {
    expect(SyncPushInput.safeParse(body([])).success).toBe(false);
    const many = Array.from({ length: SYNC_PUSH_MAX_OPS + 1 }, (_, i) => ({ ...op('note', 'softDelete'), seq: i }));
    expect(SyncPushInput.safeParse(body(many)).success).toBe(false);
  });
});

describe('SyncPullQuery', () => {
  it('ép limit từ chuỗi; tham số lạ bị từ chối', () => {
    expect(SyncPullQuery.parse({ limit: '200' })).toEqual({ limit: 200 });
    expect(SyncPullQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(SyncPullQuery.safeParse({ limit: 'abc' }).success).toBe(false);
    expect(SyncPullQuery.safeParse({ since: NOW }).success).toBe(false);
  });

  it('phản hồi rỗng hợp lệ', () => {
    const empty = { suppliers: [], buyers: [], products: [], pricingRules: [], notes: [], drafts: [], transactions: [], payments: [] };
    expect(SyncPullResult.safeParse({ cursor: 'c', hasMore: false, resetRequired: false, changes: empty }).success).toBe(true);
  });
});

/**
 * Ma trận quyền của từng op, viết lại theo NGƯỜI (không đọc lại SYNC_PERMISSION) — sửa nhầm một ô
 * ở một bên là test đỏ. ✅ = được, ❌ = không.
 */
describe('quyền của từng op', () => {
  type Row = readonly [SyncEntity, SyncOpKind, string, boolean, boolean, boolean, boolean, boolean];
  //                                              vựa owner, vựa staff, DN owner, DN manager, DN staff
  const table: Row[] = [
    ['transaction', 'insert', 'lập phiếu', true, true, true, true, true],
    ['supplier', 'insert', 'người bán mới khi lập phiếu', true, true, true, true, true],
    ['buyer', 'insert', 'người mua mới khi lập phiếu', true, true, true, true, true],
    ['product', 'insert', 'mặt hàng mới khi lập phiếu', true, true, true, true, true],
    ['payment', 'insert', 'ghi lần trả', true, true, true, true, true],
    ['draft', 'update', 'sửa phiếu nháp', true, true, true, true, true],
    ['note', 'insert', 'ghi chú', true, true, true, true, true],
    ['transaction', 'softDelete', 'xoá phiếu', true, false, true, true, false],
    ['payment', 'softDelete', 'huỷ lần trả', true, false, true, true, false],
    ['supplier', 'update', 'sửa người bán', true, false, true, true, false],
    ['buyer', 'softDelete', 'xoá người mua', true, false, true, true, false],
    ['product', 'softDelete', 'xoá mặt hàng', true, false, true, true, false],
    ['pricingRule', 'insert', 'thêm quy tắc giá', true, false, true, true, false],
  ];
  const people: readonly (readonly [OrgType, MemberRole])[] = [
    ['trader', 'owner'],
    ['trader', 'staff'],
    ['enterprise', 'owner'],
    ['enterprise', 'manager'],
    ['enterprise', 'staff'],
  ];

  for (const [entity, kind, label, ...allowed] of table) {
    it(label, () => {
      const permission = syncOpPermission({ entity, kind, data: kind === 'softDelete' ? undefined : {} });
      expect(permission).not.toBeNull();
      people.forEach(([type, role], i) => {
        expect(can(type, role, permission ?? 'book:sync'), `${type} ${role}`).toBe(allowed[i]);
      });
    });
  }

  it('sửa mặt hàng: CHỈ đổi giá gần nhất thì người cân làm được; đổi thứ khác thì không', () => {
    const priceOnly = syncOpPermission({ entity: 'product', kind: 'update', data: { lastPricePerUnit: 48_000 } });
    const rename = syncOpPermission({ entity: 'product', kind: 'update', data: { lastPricePerUnit: 1, name: 'x' } });
    expect(can('trader', 'staff', priceOnly ?? 'book:sync')).toBe(true);
    expect(can('trader', 'staff', rename ?? 'book:sync')).toBe(false);
  });

  it('nông dân không đồng bộ sổ', () => {
    expect(can('farmer', 'owner', 'book:sync')).toBe(false);
  });
});
