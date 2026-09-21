/**
 * Hạn mức phiếu của gói miễn phí.
 *
 * 🔴 Chặn ở CLIENT là cố ý, không phải làm cho xong. Gói Free chạy hoàn toàn
 * trên máy người dùng: ai mở DevTools để ghi thêm phiếu **trên máy của chính
 * họ** thì ta không mất gì cả. Thứ có chạm máy chủ (đồng bộ, công nợ đám mây,
 * sao lưu) mới chặn ở database bằng `has_active_sync()`. Nhầm hai loại này là
 * vừa tốn công vừa vẫn thủng — xem F §3.1.
 *
 * Đếm MỌI phiếu, cả mua lẫn bán: câu người dùng đọc được là "tháng này bác đã
 * ghi 30 phiếu", và họ đếm cả hai loại như nhau.
 */

import type { AppData, Transaction } from './types.js';

export interface QuotaState {
  /** Số phiếu đã ghi trong tháng dương lịch hiện tại. */
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  /** Đã chạm trần: phiếu tiếp theo không lập được cho tới đầu tháng sau. */
  readonly blocked: boolean;
}

/** Cùng tháng dương lịch theo GIỜ MÁY — người dùng nghĩ theo tháng của họ. */
const sameMonth = (iso: string, now: Date): boolean => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

export const receiptsThisMonth = (
  transactions: readonly Pick<Transaction, 'date'>[],
  now: Date,
): number => transactions.filter((t) => sameMonth(t.date, now)).length;

/**
 * @param premium Đang ở bậc có trả tiền (kể cả dùng thử và ân hạn) → không giới hạn.
 * @param limit   `FREE_RECEIPTS_PER_MONTH` của `config.ts`.
 */
export const quotaFor = (
  data: Pick<AppData, 'transactions'>,
  now: Date,
  { premium, limit }: { premium: boolean; limit: number },
): QuotaState => {
  const used = receiptsThisMonth(data.transactions, now);

  if (premium) {
    return { used, limit: Infinity, remaining: Infinity, blocked: false };
  }

  return {
    used,
    limit,
    remaining: Math.max(limit - used, 0),
    blocked: used >= limit,
  };
};
