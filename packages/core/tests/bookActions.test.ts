import { describe, expect, it } from 'vitest';
import { addBuyer, addSupplier, deleteBuyer, updateBuyer } from '../src/partyActions';
import { addProduct, updateProduct } from '../src/productActions';
import { addPricingRule, deletePricingRule, updatePricingRule } from '../src/pricingRuleActions';
import { addNote, deleteNote, updateNote, updateSettings } from '../src/noteActions';
import { completeDraft, deleteDraft, upsertDraft } from '../src/draftActions';
import { buyer, data, line, supplier } from './fixtures';

describe('đối tác', () => {
  it('thêm người bán, cắt khoảng trắng thừa', () => {
    const result = addSupplier(data(), { name: '  Chú Bảy  ', phone: ' 0905112233 ' });
    expect(result.supplier.name).toBe('Chú Bảy');
    expect(result.supplier.phone).toBe('0905112233');
  });

  it('trùng tên (không phân biệt hoa thường) thì dùng lại hồ sơ cũ', () => {
    const first = addSupplier(data(), { name: 'Chú Bảy' });
    const second = addSupplier(first.data, { name: 'chú bảy' });
    expect(second.data.suppliers).toHaveLength(1);
    expect(second.supplier.id).toBe(first.supplier.id);
  });

  it('trường để trống thành undefined, không thành chuỗi rỗng', () => {
    const result = addSupplier(data(), { name: 'Chú Bảy', location: '   ' });
    expect(result.supplier.location).toBeUndefined();
  });

  it('thêm, sửa, xoá người mua', () => {
    const added = addBuyer(data(), { name: 'Nhà máy Bình Long' });
    const renamed = updateBuyer(added.data, added.buyer.id, { name: 'Nhà máy Bình Long 2' });
    expect(renamed.buyers[0]?.name).toBe('Nhà máy Bình Long 2');
    expect(deleteBuyer(renamed, added.buyer.id).buyers).toEqual([]);
  });

  it('sửa người mua không đổi được id', () => {
    const added = addBuyer(data({ buyers: [buyer()] }), { name: 'Nhà máy Bình Long' });
    const next = updateBuyer(added.data, 'buy-1', { id: 'id-gia' });
    expect(next.buyers[0]?.id).toBe('buy-1');
  });
});

describe('mặt hàng', () => {
  it('thêm mặt hàng mới với đơn vị mặc định là kg', () => {
    const result = addProduct(data({ products: [] }), {
      name: 'Sầu riêng',
      unit: '  ',
      formulaType: 'standard',
    });
    expect(result.product.unit).toBe('kg');
    expect(result.product.isActive).toBe(true);
  });

  it('trùng tên thì dùng lại, không tạo hai mặt hàng cùng tên', () => {
    const first = addProduct(data({ products: [] }), {
      name: 'Sầu riêng',
      unit: 'kg',
      formulaType: 'standard',
    });
    const second = addProduct(first.data, { name: 'sầu riêng', unit: 'kg', formulaType: 'standard' });
    expect(second.data.products).toHaveLength(1);
  });

  it('sửa mặt hàng, giữ nguyên id', () => {
    const first = addProduct(data({ products: [] }), {
      name: 'Sầu riêng',
      unit: 'kg',
      formulaType: 'standard',
    });
    const next = updateProduct(first.data, first.product.id, { isActive: false, id: 'id-gia' });
    expect(next.products[0]?.isActive).toBe(false);
    expect(next.products[0]?.id).toBe(first.product.id);
  });
});

describe('quy tắc giá', () => {
  const rule = { name: 'Phí xe', kind: 'logistics' as const, fixedAmount: -50_000, active: true };

  it('thêm, bật/tắt, xoá', () => {
    const added = addPricingRule(data(), rule);
    expect(added.data.pricingRules).toHaveLength(1);

    const off = updatePricingRule(added.data, added.rule.id, { active: false });
    expect(off.pricingRules?.[0]?.active).toBe(false);

    expect(deletePricingRule(off, added.rule.id).pricingRules).toEqual([]);
  });

  it('sổ cũ chưa có mục quy tắc giá vẫn thêm được', () => {
    const old = { ...data(), pricingRules: undefined };
    expect(addPricingRule(old, rule).data.pricingRules).toHaveLength(1);
  });
});

describe('ghi chú và cài đặt', () => {
  it('ghi chú trống thì không lưu', () => {
    const result = addNote(data(), '   ');
    expect(result.note).toBeNull();
    expect(result.data.notes).toEqual([]);
  });

  it('ghi chú mới nằm trên cùng', () => {
    const first = addNote(data(), 'Gọi cô Mai');
    const second = addNote(first.data, 'Đổ xăng xe tải');
    expect(second.data.notes[0]?.body).toBe('Đổ xăng xe tải');
  });

  it('đánh dấu xong cập nhật thời điểm sửa', () => {
    const added = addNote(data(), 'Gọi cô Mai');
    const done = updateNote(added.data, added.note?.id ?? '', { done: true });
    expect(done.notes[0]?.done).toBe(true);
    expect(done.notes[0]?.createdAt).toBe(added.note?.createdAt);
  });

  it('xoá ghi chú', () => {
    const added = addNote(data(), 'Gọi cô Mai');
    expect(deleteNote(added.data, added.note?.id ?? '').notes).toEqual([]);
  });

  it('đổi cài đặt chỉ ghi đè phần được đổi', () => {
    const next = updateSettings(data(), { defaultWeightUnit: 'hg' });
    expect(next.settings).toEqual({ defaultWeightUnit: 'hg', displayMode: 'normal' });
  });
});

describe('phiếu nháp', () => {
  const draftInput = (patch = {}) => ({
    status: 'draft' as const,
    kind: 'purchase' as const,
    supplierName: 'Cô Lê Thị Mai',
    lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })],
    amountPaid: 0,
    ...patch,
  });

  it('lưu nháp mới rồi lưu đè lên chính nó, không sinh nháp thứ hai', () => {
    const first = upsertDraft(data(), draftInput());
    const second = upsertDraft(first.data, { ...draftInput(), id: first.draft.id });
    expect(second.data.drafts).toHaveLength(1);
    expect(second.draft.createdAt).toBe(first.draft.createdAt);
  });

  it('xoá nháp', () => {
    const first = upsertDraft(data(), draftInput());
    expect(deleteDraft(first.data, first.draft.id).drafts).toEqual([]);
  });

  it('chốt nháp thành phiếu thật và dọn nháp đi', () => {
    const first = upsertDraft(data({ suppliers: [supplier()] }), draftInput());
    const result = completeDraft(first.data, first.draft.id);

    expect(result.transaction).not.toBeNull();
    expect(result.data.drafts).toEqual([]);
    expect(result.data.transactions).toHaveLength(1);
  });

  it('bỏ dòng chưa đủ thông tin, giữ dòng đủ', () => {
    const first = upsertDraft(
      data(),
      draftInput({
        lines: [
          line({ id: 'l1', grossWeight: 100, pricePerUnit: 10_000 }),
          line({ id: 'l2', grossWeight: 0, pricePerUnit: 10_000 }),
          line({ id: 'l3', grossWeight: 100, pricePerUnit: 0 }),
        ],
      }),
    );
    expect(completeDraft(first.data, first.draft.id).transaction?.lines).toHaveLength(1);
  });

  it('cao su chưa nhập hàm lượng mủ thì chưa đủ để chốt', () => {
    const first = upsertDraft(
      data(),
      draftInput({
        lines: [line({ formulaType: 'rubberLatex', grossWeight: 320, pricePerUnit: 14_500 })],
      }),
    );
    const result = completeDraft(first.data, first.draft.id);
    expect(result.transaction).toBeNull();
    // Nháp phải còn nguyên — không xoá mất công cân của người dùng.
    expect(result.data.drafts).toHaveLength(1);
  });

  it('nháp không tồn tại thì không làm gì', () => {
    expect(completeDraft(data(), 'khong-co').transaction).toBeNull();
  });

  it('nháp phiếu bán chốt ra phiếu BÁN — thiếu kind là lỗi #4 của bản demo', () => {
    const first = upsertDraft(
      data(),
      draftInput({ kind: 'sale', supplierName: 'Nhà máy Bình Long' }),
    );
    const result = completeDraft(first.data, first.draft.id);
    expect(result.transaction?.kind).toBe('sale');
    expect(result.data.buyers).toHaveLength(1);
  });
});
