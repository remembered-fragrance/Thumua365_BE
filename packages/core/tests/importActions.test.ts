import { describe, expect, it } from 'vitest';
import { transactionTotals } from '../src/calc';
import { importReceipts, importSuppliers } from '../src/importActions';
import type { ReceiptImport } from '../src/sheetImport';
import { data, supplier } from './fixtures';

const receipt = (patch: Partial<ReceiptImport> = {}): ReceiptImport => ({
  date: '2026-08-01T00:00:00.000Z',
  partyName: 'Cô Lê Thị Mai',
  productName: 'Mủ nước',
  unit: 'kg',
  grossWeight: 320,
  pricePerUnit: 14_500,
  amountPaid: 0,
  ...patch,
});

describe('importSuppliers', () => {
  it('thêm hồ sơ mới và đếm đúng số đã thêm', () => {
    const result = importSuppliers(data(), [
      { name: 'Cô Mai' },
      { name: 'Chú Bảy', phone: '0900000000' },
    ]);
    expect(result.added).toHaveLength(2);
    expect(result.data.suppliers).toHaveLength(2);
  });

  it('tên đã có thì dùng lại hồ sơ cũ, không tạo hồ sơ thứ hai', () => {
    const before = data({ suppliers: [supplier({ name: 'Cô Mai' })] });
    const result = importSuppliers(before, [{ name: 'cô mai' }, { name: 'Chú Bảy' }]);
    expect(result.data.suppliers).toHaveLength(2);
    expect(result.added).toHaveLength(1);
  });
});

describe('importReceipts', () => {
  it('lập phiếu và tự tạo hồ sơ nông hộ theo tên', () => {
    const result = importReceipts(data(), [receipt()]);
    expect(result.data.transactions).toHaveLength(1);
    expect(result.data.suppliers).toHaveLength(1);
    expect(result.data.suppliers[0]?.name).toBe('Cô Lê Thị Mai');
  });

  it('hai phiếu cùng một người chỉ tạo một hồ sơ', () => {
    const result = importReceipts(data(), [receipt(), receipt({ grossWeight: 100 })]);
    expect(result.data.transactions).toHaveLength(2);
    expect(result.data.suppliers).toHaveLength(1);
  });

  it('giữ nguyên con số của sổ cũ: 320 × 14.500 = 4.640.000', () => {
    const result = importReceipts(data(), [receipt()]);
    const tx = result.data.transactions[0];
    expect(tx).toBeDefined();
    if (!tx) return;
    expect(transactionTotals(tx).total).toBe(4_640_000);
  });

  it('số đã trả thành một lần trả tiền, đúng bất biến amountPaid = sum(payments)', () => {
    const result = importReceipts(data(), [receipt({ amountPaid: 2_000_000 })]);
    const tx = result.data.transactions[0];
    expect(tx?.payments).toHaveLength(1);
    expect(tx?.amountPaid).toBe(2_000_000);
    expect(tx && transactionTotals(tx).debt).toBe(2_640_000);
  });
});
