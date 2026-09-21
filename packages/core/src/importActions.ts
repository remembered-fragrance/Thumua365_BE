/**
 * Đưa dữ liệu đã đọc từ file Excel vào sổ. Hàm thuần.
 *
 * Không tự viết lại việc tạo hồ sơ hay lập phiếu: gấp `addSupplier` và
 * `addTransaction` trên bản sổ đang lớn dần. Nhờ vậy phiếu nhập từ file đi qua
 * đúng những bất biến của phiếu gõ tay — đóng băng dòng hàng, `amountPaid =
 * sum(payments)`, trùng tên thì dùng lại hồ sơ cũ chứ không tạo hồ sơ thứ hai.
 *
 * KHÔNG tạo mặt hàng mới cho từng dòng. Sổ cũ ghi tên hàng bằng chữ, mỗi người
 * một kiểu ("mủ nước", "mu nuoc", "mủ"); tạo hồ sơ mặt hàng từ đó là gieo vào
 * danh mục hàng chục mục trùng nhau ngay ngày đầu dùng app.
 */

import { newId } from './id';
import { addSupplier } from './partyActions';
import { addTransaction } from './receiptActions';
import type { ReceiptImport, SupplierImport } from './sheetImport';
import type { AppData, Supplier, Transaction, TransactionLine } from './types';

export const importSuppliers = (
  data: AppData,
  rows: readonly SupplierImport[],
): { data: AppData; added: readonly Supplier[] } => {
  let next = data;
  const added: Supplier[] = [];

  for (const row of rows) {
    const before = next;
    const result = addSupplier(next, row);
    next = result.data;
    // Tên đã có thì `addSupplier` trả lại hồ sơ cũ và sổ không đổi — lúc đó
    // không có gì để đẩy lên, và cũng không được đếm là "đã nhập thêm".
    if (next !== before) added.push(result.supplier);
  }

  return { data: next, added };
};

const lineFrom = (row: ReceiptImport): TransactionLine => ({
  id: newId(),
  productName: row.productName,
  unit: row.unit,
  // Sổ cũ chỉ ghi số cuối cùng đã thống nhất với nông hộ. Áp công thức trừ bì
  // hay quy đổi hàm lượng lên con số đó là tự bịa ra một phép tính chưa từng
  // xảy ra — 'standard' giữ nguyên đúng thứ họ đã viết.
  formulaType: 'standard',
  grossWeight: row.grossWeight,
  pricePerUnit: row.pricePerUnit,
});

export const importReceipts = (
  data: AppData,
  rows: readonly ReceiptImport[],
): { data: AppData; added: readonly Transaction[] } => {
  let next = data;
  const added: Transaction[] = [];

  for (const row of rows) {
    const result = addTransaction(next, {
      date: row.date,
      kind: 'purchase',
      counterpartyId: '',
      supplierName: row.partyName,
      lines: [lineFrom(row)],
      amountPaid: row.amountPaid,
      payments: [],
      note: row.note,
    });
    next = result.data;
    added.push(result.transaction);
  }

  return { data: next, added };
};
