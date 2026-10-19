/**
 * B3 — gõ tên trùng thì phiếu tự gắn vào hồ sơ cũ. Hai "Anh Ba" bị gộp công nợ; hồ sơ đã kết nối với tài
 * khoản nông dân thì nông dân thật thấy phiếu của người kia (`linked_receipts` lọc theo `counterparty_id`).
 */

import { describe, expect, it } from 'vitest';
import { addBuyer, addSupplier, partiesNamed, resolveSupplier } from '../src/partyActions';
import { addTransaction } from '../src/receiptActions';
import { importReceipts, importSuppliers } from '../src/importActions';
import { buyer, data, line, supplier } from './fixtures';

const anhBa = supplier({ id: 'sup-ba', name: 'Anh Ba', phone: '0905000111' });

describe('partiesNamed', () => {
  it('tìm hồ sơ trùng tên, không phân biệt hoa thường và khoảng trắng hai đầu', () => {
    const book = data({ suppliers: [anhBa, supplier({ id: 'sup-2', name: 'Anh Ba Lớn' })] });
    expect(partiesNamed(book.suppliers, '  anh ba ').map((s) => s.id)).toEqual(['sup-ba']);
    expect(partiesNamed(book.suppliers, '')).toEqual([]);
  });
});

describe('tạo người mới trùng tên', () => {
  it('asNew: ra hồ sơ thứ hai, không dùng lại hồ sơ cũ', () => {
    const result = addSupplier(data({ suppliers: [anhBa] }), { name: 'Anh Ba' }, { asNew: true });
    expect(result.supplier.id).not.toBe('sup-ba');
    expect(result.data.suppliers).toHaveLength(2);
  });

  it('asNew cho người mua', () => {
    const result = addBuyer(data({ buyers: [buyer()] }), { name: buyer().name }, { asNew: true });
    expect(result.data.buyers).toHaveLength(2);
  });

  it('lập phiếu với asNew: phiếu gắn vào hồ sơ mới', () => {
    const { data: next, transaction } = addTransaction(
      data({ suppliers: [anhBa] }),
      { date: '2026-10-19T03:00:00.000Z', kind: 'purchase', counterpartyId: '', supplierName: 'Anh Ba', lines: [line()], amountPaid: 0, payments: [] },
      { asNew: true },
    );
    expect(transaction.counterpartyId).not.toBe('sup-ba');
    expect(next.suppliers.map((s) => s.id)).toContain(transaction.counterpartyId);
  });
});

describe('hồ sơ không được gộp theo tên (keepApart)', () => {
  it('hồ sơ đang kết nối với nông dân: gõ trùng tên thì tạo hồ sơ khác', () => {
    const resolved = resolveSupplier(data({ suppliers: [anhBa] }), undefined, 'anh ba', { keepApart: new Set(['sup-ba']) });
    expect(resolved.id).not.toBe('sup-ba');
  });

  it('nhập phiếu từ file: không gắn vào hồ sơ đang kết nối, các dòng cùng tên vẫn về chung một hồ sơ mới', () => {
    const row = { date: '2026-10-19T03:00:00.000Z', partyName: 'Anh Ba', productName: 'Cà phê', unit: 'kg', grossWeight: 10, pricePerUnit: 1000, amountPaid: 0 };
    const { added, data: next } = importReceipts(data({ suppliers: [anhBa] }), [row, row], { keepApart: new Set(['sup-ba']) });
    expect(added.map((t) => t.counterpartyId)).not.toContain('sup-ba');
    expect(new Set(added.map((t) => t.counterpartyId)).size).toBe(1);
    expect(next.suppliers).toHaveLength(2);
  });

  it('nhập danh bạ từ file: tên trùng hồ sơ đang kết nối thì thêm hồ sơ mới', () => {
    const { added } = importSuppliers(data({ suppliers: [anhBa] }), [{ name: 'Anh Ba' }], { keepApart: new Set(['sup-ba']) });
    expect(added).toHaveLength(1);
  });

  it('không có tuỳ chọn: giữ cách cũ, dùng lại hồ sơ cùng tên', () => {
    expect(resolveSupplier(data({ suppliers: [anhBa] }), undefined, 'Anh Ba').id).toBe('sup-ba');
  });
});
