/**
 * Tìm kiếm toàn cục — dòng #15 của ma trận parity, chức năng duy nhất hoàn
 * toàn mới trong ma trận đó.
 *
 * Hàm thuần: nhận sổ và chuỗi tìm, trả về danh sách kết quả đã xếp hạng.
 * KHÔNG biết route — `features/` quyết định bấm vào một kết quả thì đi đâu.
 */

import { transactionTotals } from './calc.js';
import type { AppData, Transaction } from './types.js';
import { fold } from './vietnameseFold.js';

export type SearchHitKind = 'transaction' | 'supplier' | 'buyer' | 'product';

export interface SearchHit {
  readonly kind: SearchHitKind;
  readonly id: string;
  readonly title: string;
  /** Dòng phụ đã ĐỊNH DẠNG SẴN thì `core/` phải biết tiếng Việt — nên chỉ trả số. */
  readonly amount?: number;
  readonly date?: string;
  readonly detail?: string;
}

/**
 * Bỏ dấu để gõ "co mai" vẫn ra "Cô Mai" — người dùng gõ trên bàn phím điện
 * thoại giữa trời nắng, không ai bật bộ gõ dấu để tìm một cái tên.
 */
const matches = (haystack: string, needle: string): boolean => fold(haystack).includes(needle);

const txHit = (tx: Transaction): SearchHit => ({
  kind: 'transaction',
  id: tx.id,
  title: tx.supplierName,
  amount: transactionTotals(tx).total,
  date: tx.date,
  detail: [...new Set(tx.lines.map((l) => l.productName))].join(', '),
});

/**
 * Kết quả xếp theo thứ tự hữu ích chứ không theo điểm khớp: đối tác và mặt
 * hàng trước (ít, tìm thấy là dùng ngay), phiếu sau và chỉ lấy những phiếu
 * gần đây nhất.
 */
export const searchBook = (data: AppData, query: string, limit = 8): SearchHit[] => {
  const q = fold(query.trim());
  if (q.length < 2) return [];

  const suppliers: SearchHit[] = data.suppliers
    .filter((s) => matches(s.name, q) || matches(s.phone ?? '', q) || matches(s.location ?? '', q))
    .map((s) => ({ kind: 'supplier', id: s.id, title: s.name, detail: s.phone }));

  const buyers: SearchHit[] = data.buyers
    .filter((b) => matches(b.name, q) || matches(b.phone ?? '', q) || matches(b.location ?? '', q))
    .map((b) => ({ kind: 'buyer', id: b.id, title: b.name, detail: b.phone }));

  const products: SearchHit[] = data.products
    .filter((p) => p.isActive && matches(p.name, q))
    .map((p) => ({ kind: 'product', id: p.id, title: p.name, detail: p.unit }));

  const transactions: SearchHit[] = [...data.transactions]
    .filter(
      (t) =>
        matches(t.supplierName, q) ||
        matches(t.note ?? '', q) ||
        t.lines.some((l) => matches(l.productName, q)),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(txHit);

  return [...suppliers, ...buyers, ...products, ...transactions].slice(0, limit);
};
