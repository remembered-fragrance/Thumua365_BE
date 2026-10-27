/**
 * (V15) Hợp đồng mùa vụ: thêm / sửa / xoá trong sổ và tiến độ giao.
 *
 * Hợp đồng không gắn vào phiếu. Lượng đã giao = Σ lượng tính tiền của các dòng phiếu cùng chiều (mua / bán), cùng
 * người, cùng mặt hàng, ngày phiếu nằm trong khoảng hợp đồng (tính cả ngày kết thúc). Người và mặt hàng khớp theo id
 * khi hợp đồng có id, không thì theo tên (bỏ dấu, không phân biệt hoa thường).
 */

import { lineNetWeight } from './calc.js';
import { newId } from './id.js';
import type { AppData, SeasonContract, Transaction, TransactionLine } from './types.js';
import { fold } from './vietnameseFold.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type NewSeasonContract = Omit<SeasonContract, 'id' | 'closed' | 'createdAt' | 'updatedAt'>;

export const addSeasonContract = (
  data: AppData,
  input: NewSeasonContract,
): { data: AppData; contract: SeasonContract } => {
  const now = new Date().toISOString();
  const contract: SeasonContract = { ...input, id: newId(), closed: false, createdAt: now, updatedAt: now };
  return { data: { ...data, seasonContracts: [contract, ...(data.seasonContracts ?? [])] }, contract };
};

export const updateSeasonContract = (data: AppData, id: string, patch: Partial<SeasonContract>): AppData => ({
  ...data,
  seasonContracts: (data.seasonContracts ?? []).map((c) =>
    c.id === id ? { ...c, ...patch, id: c.id, updatedAt: new Date().toISOString() } : c,
  ),
});

export const deleteSeasonContract = (data: AppData, id: string): AppData => ({
  ...data,
  seasonContracts: (data.seasonContracts ?? []).filter((c) => c.id !== id),
});

// ─── Tiến độ ─────────────────────────────────────────────────────────────────

const sameName = (a: string, b: string): boolean => fold(a.trim()) === fold(b.trim());

const matchesParty = (c: SeasonContract, t: Transaction): boolean =>
  c.counterpartyId ? t.counterpartyId === c.counterpartyId : sameName(t.supplierName, c.counterpartyName);

const matchesProduct = (c: SeasonContract, line: TransactionLine): boolean =>
  c.productId ? line.productId === c.productId : sameName(line.productName, c.productName);

const inPeriod = (c: SeasonContract, isoDate: string): boolean => {
  const ms = new Date(isoDate).getTime();
  return ms >= new Date(c.startDate).getTime() && ms < new Date(c.endDate).getTime() + DAY_MS;
};

/** Hợp đồng còn mở mà phiếu này giao vào (cùng chiều, cùng người, có dòng cùng mặt hàng, trong khoảng ngày). */
export const contractsForTransaction = (data: AppData, t: Transaction): SeasonContract[] =>
  (data.seasonContracts ?? []).filter(
    (c) =>
      !c.closed &&
      c.kind === t.kind &&
      inPeriod(c, t.date) &&
      matchesParty(c, t) &&
      t.lines.some((line) => matchesProduct(c, line)),
  );

export interface ContractProgress {
  readonly delivered: number;
  /** Không âm: giao dư thì còn 0. */
  readonly remaining: number;
  /** 0–100, làm tròn; giao dư vẫn là 100. */
  readonly percent: number;
  readonly receiptCount: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const contractProgress = (data: AppData, c: SeasonContract): ContractProgress => {
  let delivered = 0;
  let receiptCount = 0;
  for (const t of data.transactions) {
    if (t.kind !== c.kind || !inPeriod(c, t.date) || !matchesParty(c, t)) continue;
    const lines = t.lines.filter((line) => matchesProduct(c, line));
    if (lines.length === 0) continue;
    receiptCount += 1;
    for (const line of lines) delivered += lineNetWeight(line);
  }
  delivered = round2(delivered);
  return {
    delivered,
    remaining: round2(Math.max(c.quantity - delivered, 0)),
    percent: c.quantity > 0 ? Math.min(Math.round((delivered / c.quantity) * 100), 100) : 0,
    receiptCount,
  };
};
