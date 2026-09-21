/**
 * Phiếu nháp — "Đang cân" (`draft`) và "Để dành" (`waiting`).
 *
 * Nháp là thứ người dùng gõ dở khi đang cân hàng: chưa chốt tiền, chưa đóng
 * băng dòng nào. Chỉ khi hoàn thành mới trở thành phiếu thật.
 */

import { newId } from './id.js';
import { GUEST_BUYER_ID, GUEST_SUPPLIER_ID } from './normalizeTransaction.js';
import { addTransaction } from './receiptActions.js';
import type { AppData, DraftReceipt, Transaction, TransactionLine } from './types.js';

export type DraftInput = Omit<DraftReceipt, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<DraftReceipt, 'id' | 'createdAt'>>;

export const upsertDraft = (
  data: AppData,
  input: DraftInput,
): { data: AppData; draft: DraftReceipt } => {
  const now = new Date().toISOString();
  const draft: DraftReceipt = {
    ...input,
    id: input.id ?? newId(),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
  const exists = data.drafts.some((d) => d.id === draft.id);

  return {
    data: {
      ...data,
      drafts: exists
        ? data.drafts.map((d) => (d.id === draft.id ? draft : d))
        : [draft, ...data.drafts],
    },
    draft,
  };
};

export const deleteDraft = (data: AppData, draftId: string): AppData => ({
  ...data,
  drafts: data.drafts.filter((d) => d.id !== draftId),
});

/** Dòng đủ thông tin để tính tiền. Dòng thiếu bị bỏ khi chốt phiếu. */
const isComplete = (line: TransactionLine): boolean => {
  if (!line.productName.trim() || line.grossWeight <= 0 || line.pricePerUnit <= 0) return false;
  if (line.formulaType === 'rubberLatex') return (line.qualityPercent ?? 0) > 0;
  return true;
};

/**
 * Chốt nháp thành phiếu thật.
 * Trả `transaction: null` khi nháp không có dòng nào đủ thông tin — nháp được
 * GIỮ NGUYÊN, không xoá mất công cân của người dùng.
 */
export const completeDraft = (
  data: AppData,
  draftId: string,
): { data: AppData; transaction: Transaction | null } => {
  const draft = data.drafts.find((d) => d.id === draftId);
  if (!draft) return { data, transaction: null };

  const lines = draft.lines.filter(isComplete);
  if (lines.length === 0) return { data, transaction: null };

  const kind = draft.kind ?? 'purchase';
  const fallbackParty = kind === 'sale' ? GUEST_BUYER_ID : GUEST_SUPPLIER_ID;

  const result = addTransaction(data, {
    date: new Date().toISOString(),
    kind,
    supplierId: draft.supplierId,
    supplierName: draft.supplierName || 'Khách lẻ',
    counterpartyId: draft.counterpartyId ?? draft.supplierId ?? fallbackParty,
    lines,
    amountPaid: draft.amountPaid,
    payments: [],
    note: draft.note,
    attachmentIds: draft.attachmentIds,
  });

  return { data: deleteDraft(result.data, draftId), transaction: result.transaction };
};
