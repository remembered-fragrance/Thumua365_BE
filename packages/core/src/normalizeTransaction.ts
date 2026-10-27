/**
 * Chuẩn hoá / migrate MỘT phiếu từ dữ liệu đã lưu (v1 · v2 · v3).
 *
 * Chạy lại trên MỌI lần đọc, kể cả dữ liệu v3 đã đầy đủ — vì vậy phải ĐỌC LẠI
 * field v3 nếu đã có (payments, kind, counterpartyId, creditTerms, adjustments,
 * attachmentIds) và chỉ tự sinh mặc định khi field thực sự chưa tồn tại.
 * Ghi đè vô điều kiện = mất lịch sử trả nợ ngay sau lần tải lại đầu tiên.
 */

import { freezeLineTotals } from './calc.js';
import { newId } from './id.js';
import type {
  CreditTerm,
  CropType,
  Payment,
  PriceAdjustment,
  ProductFormulaType,
  RubberKind,
  Transaction,
  TransactionKind,
  TransactionLine,
} from './types.js';
import { productNameFromCrop } from './catalog.js';

export const GUEST_SUPPLIER_ID = 'guest';
export const GUEST_BUYER_ID = 'guest-buyer';

const CROPS: readonly CropType[] = ['rubber', 'cashew', 'coffee', 'pepper'];
const FORMULAS: readonly ProductFormulaType[] = [
  'standard',
  'netAfterTare',
  'rubberLatex',
  'lossPercent',
];
const ADJUSTMENT_KINDS: readonly PriceAdjustment['kind'][] = [
  'logistics',
  'volumeDiscount',
  'manual',
];

export const cropFrom = (value: unknown): CropType | undefined =>
  CROPS.includes(value as CropType) ? (value as CropType) : undefined;

export const formulaFrom = (value: unknown): ProductFormulaType =>
  FORMULAS.includes(value as ProductFormulaType)
    ? (value as ProductFormulaType)
    : 'netAfterTare';

export const rubberKindFrom = (value: unknown): RubberKind | undefined =>
  value === 'latex' || value === 'cuplump' ? value : undefined;

/** Số đọc từ JSON — không phải input người dùng, nên Number() ở đây là đúng chỗ. */
const num = (value: unknown): number => Number(value) || 0;

const optionalNum = (value: unknown): number | undefined =>
  value === undefined ? undefined : num(value);

export const normalizeLine = (raw: Record<string, unknown>, freeze = true): TransactionLine => {
  const crop = cropFrom(raw.crop);
  const productName = String(raw.productName || productNameFromCrop(crop)).trim() || 'Mặt hàng';
  const price = num(raw.pricePerUnit ?? raw.pricePerKg);
  const line: TransactionLine = {
    id: String(raw.id || newId()),
    crop,
    productId: raw.productId ? String(raw.productId) : undefined,
    productName,
    unit: String(raw.unit || 'kg'),
    formulaType: formulaFrom(raw.formulaType),
    grossWeight: num(raw.grossWeight),
    tareWeight: num(raw.tareWeight),
    qualityPercent: optionalNum(raw.qualityPercent),
    lossPercent: optionalNum(raw.lossPercent),
    pricePerUnit: price,
    pricePerKg: price,
    rawTotal: optionalNum(raw.rawTotal),
    roundedTotal: optionalNum(raw.roundedTotal),
    qualityGrade: raw.qualityGrade ? String(raw.qualityGrade) : undefined,
    rubberKind: rubberKindFrom(raw.rubberKind),
    bulkDensity: optionalNum(raw.bulkDensity),
    moisturePercent: optionalNum(raw.moisturePercent),
    impurityPercent: optionalNum(raw.impurityPercent),
    kor: optionalNum(raw.kor),
    greenRatio: num(raw.greenRatio) > 1 ? num(raw.greenRatio) : undefined,
  };
  return freeze ? freezeLineTotals(line) : line;
};

export const normalizePayment = (raw: Record<string, unknown>): Payment => ({
  id: String(raw.id || newId()),
  date: String(raw.date || new Date().toISOString()),
  amount: num(raw.amount),
  note: raw.note ? String(raw.note) : undefined,
  method: raw.method === 'cash' || raw.method === 'transfer' ? raw.method : undefined,
});

const normalizeCreditTerm = (raw: Record<string, unknown>): CreditTerm => ({
  dueDate: String(raw.dueDate || new Date().toISOString()),
  amount: num(raw.amount),
});

export const normalizeAdjustment = (raw: Record<string, unknown>): PriceAdjustment => ({
  id: String(raw.id || newId()),
  kind: ADJUSTMENT_KINDS.includes(raw.kind as PriceAdjustment['kind'])
    ? (raw.kind as PriceAdjustment['kind'])
    : 'manual',
  label: String(raw.label || ''),
  amount: num(raw.amount),
  ruleId: raw.ruleId ? String(raw.ruleId) : undefined,
});

export const normalizeTransaction = (raw: Record<string, unknown>): Transaction => {
  const date = String(raw.date || new Date().toISOString());
  const supplierId = String(raw.supplierId || GUEST_SUPPLIER_ID);
  const supplierName = String(raw.supplierName || 'Khách lẻ');

  // v1/v2 chỉ có amountPaid; v3 có payments[]. Bất biến: amountPaid = sum(payments).
  const rawPayments = Array.isArray(raw.payments) ? raw.payments : undefined;
  const legacyAmountPaid = num(raw.amountPaid);
  const payments: Payment[] = rawPayments
    ? rawPayments.map((p) => normalizePayment(p as Record<string, unknown>))
    : legacyAmountPaid > 0
      ? [{ id: newId(), date, amount: legacyAmountPaid }]
      : [];

  const common = {
    id: String(raw.id || newId()),
    date,
    supplierId,
    supplierName,
    amountPaid: payments.reduce((s, p) => s + p.amount, 0),
    note: raw.note ? String(raw.note) : undefined,
    kind: (raw.kind === 'sale' ? 'sale' : 'purchase') as TransactionKind,
    counterpartyId: raw.counterpartyId ? String(raw.counterpartyId) : supplierId,
    payments,
    creditTerms: Array.isArray(raw.creditTerms)
      ? raw.creditTerms.map((c) => normalizeCreditTerm(c as Record<string, unknown>))
      : undefined,
    adjustments: Array.isArray(raw.adjustments)
      ? raw.adjustments.map((a) => normalizeAdjustment(a as Record<string, unknown>))
      : undefined,
    attachmentIds: Array.isArray(raw.attachmentIds)
      ? (raw.attachmentIds as unknown[]).map(String)
      : undefined,
    orderId: raw.orderId ? String(raw.orderId) : undefined,
    syncState: raw.syncState === 'pending' || raw.syncState === 'conflict' ? raw.syncState : undefined,
  } satisfies Omit<Transaction, 'lines'>;

  if (Array.isArray(raw.lines)) {
    return { ...common, lines: raw.lines.map((l) => normalizeLine(l as Record<string, unknown>)) };
  }

  // v1: một dòng duy nhất, trừ bì bằng phần trăm
  const gross = num(raw.grossWeight);
  const deduction = num(raw.deductionPercent);
  return {
    ...common,
    lines: [
      normalizeLine({
        id: `line-${common.id}`,
        crop: raw.crop,
        productName: productNameFromCrop(cropFrom(raw.crop)),
        formulaType: 'netAfterTare',
        grossWeight: gross,
        tareWeight: Math.round(gross * (deduction / 100) * 100) / 100,
        pricePerUnit: num(raw.pricePerKg),
      }),
    ],
  };
};
