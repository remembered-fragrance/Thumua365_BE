/**
 * Các kỳ báo cáo dựng sẵn.
 *
 * `taxReport.ts` nhận một khoảng thời gian và tính số; file này lo việc dựng
 * ra khoảng đó. Tách vì màn Báo cáo cần thêm bảng 12 tháng của một năm — thêm
 * selector, không sửa hàm đang có (E §4.4).
 */

import type { TaxReportRange } from './taxReport.js';

export type PeriodKind = 'month' | 'quarter' | 'year';

const MONTH_NAMES = [
  'Tháng 1',
  'Tháng 2',
  'Tháng 3',
  'Tháng 4',
  'Tháng 5',
  'Tháng 6',
  'Tháng 7',
  'Tháng 8',
  'Tháng 9',
  'Tháng 10',
  'Tháng 11',
  'Tháng 12',
] as const;

const startOf = (year: number, month: number): Date => new Date(year, month, 1, 0, 0, 0, 0);

/** Cuối kỳ lấy mili giây cuối cùng của ngày cuối — `isInRange` tính cả hai mốc. */
const endOf = (year: number, month: number): Date =>
  new Date(year, month + 1, 0, 23, 59, 59, 999);

export const monthRange = (year: number, month: number): TaxReportRange => ({
  from: startOf(year, month),
  to: endOf(year, month),
  label: `${MONTH_NAMES[month] ?? ''}/${year}`,
});

export const quarterRange = (year: number, quarter: number): TaxReportRange => ({
  from: startOf(year, quarter * 3),
  to: endOf(year, quarter * 3 + 2),
  label: `Quý ${quarter + 1}/${year}`,
});

export const yearRange = (year: number): TaxReportRange => ({
  from: startOf(year, 0),
  to: endOf(year, 11),
  label: `Năm ${year}`,
});

/** Kỳ đang diễn ra, tính theo hôm nay. */
export const currentRange = (kind: PeriodKind, now: Date = new Date()): TaxReportRange => {
  const year = now.getFullYear();
  if (kind === 'year') return yearRange(year);
  if (kind === 'quarter') return quarterRange(year, Math.floor(now.getMonth() / 3));
  return monthRange(year, now.getMonth());
};

export const monthsOfYear = (year: number): TaxReportRange[] =>
  MONTH_NAMES.map((_, month) => monthRange(year, month));
