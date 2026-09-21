import { describe, expect, it } from 'vitest';
import {
  addTransaction,
  deleteTransaction,
  recordPayment,
  removePayment,
  updateTransactionAttachments,
} from '../src/receiptActions';
import { transactionTotals } from '../src/calc';
import { GUEST_BUYER_ID, GUEST_SUPPLIER_ID } from '../src/normalizeTransaction';
import { data, line, product, supplier } from './fixtures';

const input = (patch = {}) => ({
  date: '2026-08-08T03:00:00.000Z',
  kind: 'purchase' as const,
  counterpartyId: '',
  supplierName: 'Cô Lê Thị Mai',
  lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })],
  amountPaid: 0,
  payments: [],
  ...patch,
});

describe('addTransaction — lập phiếu', () => {
  it('gõ tên người bán chưa có thì tự tạo hồ sơ, không bắt khai trước', () => {
    const result = addTransaction(data(), input());
    expect(result.data.suppliers.map((s) => s.name)).toEqual(['Cô Lê Thị Mai']);
    expect(result.transaction.counterpartyId).toBe(result.data.suppliers[0]?.id);
  });

  it('chọn người bán đã có thì không tạo trùng', () => {
    const before = data({ suppliers: [supplier()] });
    const result = addTransaction(before, input({ counterpartyId: 'sup-1' }));
    expect(result.data.suppliers).toHaveLength(1);
    expect(result.transaction.supplierName).toBe('Cô Lê Thị Mai');
  });

  it('để trống tên thì là Khách lẻ, không sinh hồ sơ rác', () => {
    const result = addTransaction(data(), input({ supplierName: '   ' }));
    expect(result.data.suppliers).toEqual([]);
    expect(result.transaction.counterpartyId).toBe(GUEST_SUPPLIER_ID);
    expect(result.transaction.supplierName).toBe('Khách lẻ');
  });

  it('phiếu bán tạo hồ sơ người mua, không phải người bán', () => {
    const result = addTransaction(
      data(),
      input({ kind: 'sale', supplierName: 'Nhà máy Bình Long' }),
    );
    expect(result.data.buyers.map((b) => b.name)).toEqual(['Nhà máy Bình Long']);
    expect(result.data.suppliers).toEqual([]);
  });

  it('phiếu bán không ghi tên thì là Khách lẻ bên mua', () => {
    const result = addTransaction(data(), input({ kind: 'sale', supplierName: '' }));
    expect(result.transaction.counterpartyId).toBe(GUEST_BUYER_ID);
  });

  it('đóng băng tiền của từng dòng ngay lúc chốt', () => {
    const result = addTransaction(data(), input());
    expect(result.transaction.lines[0]?.roundedTotal).toBe(1_000_000);
  });

  it('số đã trả trên form thành một lần trả có ngày giờ', () => {
    const result = addTransaction(data(), input({ amountPaid: 400_000 }));
    expect(result.transaction.payments).toHaveLength(1);
    expect(result.transaction.payments[0]?.amount).toBe(400_000);
    expect(result.transaction.amountPaid).toBe(400_000);
  });

  it('chưa trả đồng nào thì không sinh lần trả rỗng', () => {
    expect(addTransaction(data(), input()).transaction.payments).toEqual([]);
  });

  it('nhớ giá lần này cho mặt hàng, lần sau gợi ý sẵn', () => {
    const before = data({ products: [product({ id: 'prod-1' })] });
    const result = addTransaction(
      before,
      input({ lines: [line({ productId: 'prod-1', pricePerUnit: 14_500 })] }),
    );
    expect(result.data.products[0]?.lastPricePerUnit).toBe(14_500);
  });

  it('phiếu mới nằm đầu sổ', () => {
    const first = addTransaction(data(), input());
    const second = addTransaction(first.data, input({ supplierName: 'Chú Bảy' }));
    expect(second.data.transactions[0]?.id).toBe(second.transaction.id);
  });
});

describe('recordPayment — ghi trả nợ', () => {
  const withDebt = () => addTransaction(data(), input({ amountPaid: 400_000 }));

  it('cộng thêm một lần trả, không sửa lần trả cũ', () => {
    const { data: book, transaction } = withDebt();
    const result = recordPayment(book, transaction.id, 300_000);

    const updated = result.data.transactions[0];
    expect(updated?.payments.map((p) => p.amount)).toEqual([400_000, 300_000]);
    expect(updated?.amountPaid).toBe(700_000);
  });

  it('trả quá số còn nợ thì chỉ ghi đúng phần còn thiếu', () => {
    const { data: book, transaction } = withDebt();
    const result = recordPayment(book, transaction.id, 99_000_000);

    expect(result.payment?.amount).toBe(600_000);
    expect(transactionTotals(result.data.transactions[0] ?? transaction).debt).toBe(0);
  });

  it('phiếu đã trả đủ thì không ghi thêm gì', () => {
    const { data: book, transaction } = withDebt();
    const paid = recordPayment(book, transaction.id, 600_000);
    const again = recordPayment(paid.data, transaction.id, 100_000);
    expect(again.payment).toBeNull();
    expect(again.data).toBe(paid.data);
  });

  it('số tiền ≤ 0 hoặc phiếu không tồn tại → báo không ghi được, không im lặng', () => {
    const { data: book, transaction } = withDebt();
    expect(recordPayment(book, transaction.id, 0).payment).toBeNull();
    expect(recordPayment(book, transaction.id, -5_000).payment).toBeNull();
    expect(recordPayment(book, 'khong-co-phieu-nay', 100_000).payment).toBeNull();
  });
});

describe('hoàn tác một lần trả tiền', () => {
  const withDebt = () => addTransaction(data(), input({ amountPaid: 400_000 }));

  it('bỏ đúng khoản vừa ghi, nợ quay về như cũ', () => {
    const { data: book, transaction } = withDebt();
    const debtBefore = transactionTotals(transaction).debt;

    const paid = recordPayment(book, transaction.id, 600_000);
    expect(paid.payment).not.toBeNull();

    const undone = removePayment(paid.data, transaction.id, paid.payment?.id ?? '');
    const after = undone.transactions.find((t) => t.id === transaction.id);

    expect(after?.amountPaid).toBe(400_000);
    expect(transactionTotals(after ?? transaction).debt).toBe(debtBefore);
  });

  it('không ghi khoản âm — lịch sử trả tiền chỉ có số dương', () => {
    const { data: book, transaction } = withDebt();
    const paid = recordPayment(book, transaction.id, 600_000);
    const undone = removePayment(paid.data, transaction.id, paid.payment?.id ?? '');
    const after = undone.transactions.find((t) => t.id === transaction.id);

    expect(after?.payments.every((p) => p.amount > 0)).toBe(true);
    expect(after?.payments).toHaveLength(1);
  });

  it('id không tồn tại thì sổ không đổi số', () => {
    const { data: book, transaction } = withDebt();
    const after = removePayment(book, transaction.id, 'khong-co-khoan-nay');
    expect(after.transactions.find((t) => t.id === transaction.id)?.amountPaid).toBe(400_000);
  });
});

describe('sửa và xoá phiếu', () => {
  it('gắn ảnh chứng từ vào đúng phiếu', () => {
    const { data: book, transaction } = addTransaction(data(), input());
    const next = updateTransactionAttachments(book, transaction.id, ['att-1', 'att-2']);
    expect(next.transactions[0]?.attachmentIds).toEqual(['att-1', 'att-2']);
  });

  it('xoá phiếu khỏi sổ', () => {
    const { data: book, transaction } = addTransaction(data(), input());
    expect(deleteTransaction(book, transaction.id).transactions).toEqual([]);
  });

  it('xoá phiếu không tồn tại không làm hỏng sổ', () => {
    const { data: book } = addTransaction(data(), input());
    expect(deleteTransaction(book, 'khong-co').transactions).toHaveLength(1);
  });
});
