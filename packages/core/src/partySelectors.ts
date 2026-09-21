/**
 * Người bán và người mua nhìn từ một khuôn duy nhất.
 *
 * `supplierSummaries` gọi cột tiền là `totalSpent`, `buyerSummaries` gọi là
 * `totalRevenue`. Khác tên nhưng cùng vai trò, và màn Đối tác vẽ hai bên bằng
 * MỘT component (E §3.3) — nên quy về `total` ở đây thay vì bắt màn hình đi
 * phân biệt. Hai hàm cũ giữ nguyên.
 */

import { buyerSummaries } from './buyerSelectors';
import { supplierSummaries } from './supplierSelectors';
import type { AppData, Transaction } from './types';

export type PartyRole = 'supplier' | 'buyer';

export interface PartySummary {
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
  readonly location?: string;
  readonly txCount: number;
  /** Tổng tiền đã mua của họ (người bán) hoặc đã bán cho họ (người mua). */
  readonly total: number;
  readonly debt: number;
  readonly lastDate?: string;
  /**
   * Có hồ sơ trong danh bạ hay không. Phiếu ghi cho "Khách lẻ" vẫn hiện trong
   * thống kê nhưng không có gì để sửa hay xoá.
   */
  readonly hasProfile: boolean;
}

export const partySummaries = (data: AppData, role: PartyRole): PartySummary[] => {
  const known = new Set(
    (role === 'supplier' ? data.suppliers : data.buyers).map((p) => p.id),
  );

  const rows =
    role === 'supplier'
      ? supplierSummaries(data).map((s) => ({ ...s, total: s.totalSpent }))
      : buyerSummaries(data).map((b) => ({ ...b, total: b.totalRevenue }));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    location: r.location,
    txCount: r.txCount,
    total: r.total,
    debt: r.debt,
    lastDate: r.lastDate,
    hasProfile: known.has(r.id),
  }));
};

/** Phiếu của một đối tác, mới nhất trước — dùng cho pane chi tiết. */
export const partyTransactions = (
  data: AppData,
  partyId: string,
  limit = 20,
): readonly Transaction[] =>
  data.transactions
    .filter((t) => t.counterpartyId === partyId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
