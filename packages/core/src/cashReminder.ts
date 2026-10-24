/**
 * Nhắc trả tiền mặt lớn — KE_HOACH_GOI_PRO V13, §4.2. Khoản mua từ 5 triệu đồng/ngày của một người bán cần
 * chứng từ thanh toán không dùng tiền mặt để được trừ chi phí. App chỉ NHẮC trước khi lưu, không chặn: ghi
 * tiền mặt vẫn được, người dùng tự chịu trách nhiệm.
 *
 * "Một ngày" theo giờ của máy (vựa ở Việt Nam). Lần trả không ghi hình thức (trước V13) coi như tiền mặt.
 */

import type { AppData, PaymentMethod } from './types.js';

export const CASH_REMINDER_THRESHOLD = 5_000_000;

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Tiền mặt đã trả cho người bán này trong ngày `day`, qua mọi phiếu mua. */
export const cashPaidOnDay = (data: AppData, counterpartyId: string, day: Date): number => {
  let sum = 0;
  for (const tx of data.transactions) {
    if (tx.kind === 'sale' || tx.counterpartyId !== counterpartyId) continue;
    for (const p of tx.payments) {
      if (p.method !== 'transfer' && sameDay(new Date(p.date), day)) sum += p.amount;
    }
  }
  return sum;
};

/** Lưu thêm lần trả này thì tiền mặt trong ngày cho người này có chạm ngưỡng không. */
export const needsCashReminder = (
  data: AppData,
  counterpartyId: string | undefined,
  amount: number,
  method: PaymentMethod | undefined,
  now: Date = new Date(),
): boolean => {
  if (method === 'transfer' || amount <= 0) return false;
  const before = counterpartyId ? cashPaidOnDay(data, counterpartyId, now) : 0;
  return before + amount >= CASH_REMINDER_THRESHOLD;
};
