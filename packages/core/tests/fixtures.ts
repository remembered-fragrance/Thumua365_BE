/**
 * Dữ liệu mẫu cho test — dựng từ VÍ DỤ SỐ THẬT ngoài vựa, không chép lại code.
 * Ví dụ gốc: cao su 320 kg, hàm lượng 31%, 14.500 đ/kg.
 */

import type {
  AppData,
  Buyer,
  Product,
  Supplier,
  Transaction,
  TransactionLine,
} from '../src/types';
import { emptyData } from '../src/normalize';

export const line = (patch: Partial<TransactionLine> = {}): TransactionLine => ({
  id: 'line-1',
  productName: 'Cao su',
  unit: 'kg',
  formulaType: 'standard',
  grossWeight: 100,
  pricePerUnit: 10_000,
  ...patch,
});

export const tx = (patch: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  date: '2026-08-08T03:00:00.000Z',
  supplierId: 'sup-1',
  supplierName: 'Cô Lê Thị Mai',
  lines: [line()],
  amountPaid: 0,
  kind: 'purchase',
  counterpartyId: 'sup-1',
  payments: [],
  ...patch,
});

export const supplier = (patch: Partial<Supplier> = {}): Supplier => ({
  id: 'sup-1',
  name: 'Cô Lê Thị Mai',
  ...patch,
});

export const buyer = (patch: Partial<Buyer> = {}): Buyer => ({
  id: 'buy-1',
  name: 'Nhà máy Bình Long',
  ...patch,
});

export const product = (patch: Partial<Product> = {}): Product => ({
  id: 'prod-1',
  name: 'Cao su',
  unit: 'kg',
  formulaType: 'rubberLatex',
  isSuggested: false,
  isActive: true,
  ...patch,
});

export const data = (patch: Partial<AppData> = {}): AppData => ({
  ...emptyData(),
  ...patch,
});
