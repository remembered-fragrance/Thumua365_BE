/**
 * Bậc gói dịch vụ — suy ra từ NGÀY THÁNG, không đọc từ một cột chữ.
 *
 * Database chỉ lưu bốn trạng thái ý định (`trialing · active · past_due ·
 * canceled`) cùng hai mốc thời gian. "Đang ân hạn" và "đã hết hạn" là kết quả
 * so sánh với hiện tại, không phải chữ ai đó phải nhớ cập nhật: dự án không có
 * tiến trình chạy định kỳ, mà một cột nói 'active' trong khi kỳ đã hết từ
 * tháng trước còn nguy hiểm hơn không có cột nào.
 *
 * `supabase/migrations/0008_quyen_dong_bo.sql` tính đúng phép so sánh này bằng
 * SQL. Hai nơi phải cho cùng một câu trả lời — đó là lý do cả hai đều chỉ dựa
 * vào ngày tháng chứ không dựa vào trạng thái lưu sẵn.
 */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

/**
 * Bậc gói mà giao diện nói với người dùng:
 *   trial   — đang dùng thử, đầy đủ tính năng
 *   premium — đã trả tiền, còn hạn
 *   grace   — vừa hết hạn, còn đồng bộ thêm mấy ngày, có banner nhắc
 *   free    — hạn mức miễn phí: một máy, dữ liệu nằm tại máy
 */
export type PlanTier = 'trial' | 'premium' | 'grace' | 'free';

export interface Subscription {
  readonly id: string;
  readonly status: SubscriptionStatus;
  readonly trialEndsAt?: string;
  readonly currentPeriodEnd?: string;
}

export type PaymentIntentStatus = 'pending' | 'paid' | 'failed' | 'expired';

/**
 * Một lần định trả tiền. `code` là 6 ký tự người dùng gõ vào nội dung chuyển
 * khoản — cũng chính là thứ webhook dò lại để biết tiền này của ai.
 */
export interface PaymentIntent {
  readonly id: string;
  readonly amount: number;
  readonly status: PaymentIntentStatus;
  readonly code: string;
  readonly createdAt: string;
}

export interface PlanState {
  readonly tier: PlanTier;
  /** Có được dùng tính năng trả phí không. Ân hạn vẫn tính là có. */
  readonly premium: boolean;
  /** Ngày hết hiệu lực của bậc hiện tại. Không có với bậc `free`. */
  readonly endsAt?: string;
  /** Số ngày còn lại, làm tròn LÊN. 0 với bậc `free`. */
  readonly daysLeft: number;
}

const MS_PER_DAY = 86_400_000;

const time = (iso?: string): number | null => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Làm tròn LÊN: còn 3 tiếng vẫn là "còn 1 ngày". Làm tròn xuống thì người dùng
 * thấy "còn 0 ngày" trong khi vẫn đang dùng được — con số đó không giải thích
 * được cho ai.
 */
export const daysBetween = (fromMs: number, toMs: number): number =>
  Math.max(Math.ceil((toMs - fromMs) / MS_PER_DAY), 0);

const FREE: PlanState = { tier: 'free', premium: false, daysLeft: 0 };

/**
 * @param graceDays Số ngày còn được đồng bộ sau khi kỳ đã trả tiền kết thúc.
 *   Truyền từ `config.ts` — `core/` không import ra ngoài, kể cả hằng số.
 */
export const planFor = (
  subscription: Subscription | null | undefined,
  now: Date,
  graceDays: number,
): PlanState => {
  if (!subscription) return FREE;

  const at = now.getTime();

  if (subscription.status === 'trialing') {
    const trialEnd = time(subscription.trialEndsAt);
    if (trialEnd === null || trialEnd <= at) return FREE;
    return {
      tier: 'trial',
      premium: true,
      endsAt: subscription.trialEndsAt,
      daysLeft: daysBetween(at, trialEnd),
    };
  }

  if (subscription.status === 'active' || subscription.status === 'past_due') {
    const periodEnd = time(subscription.currentPeriodEnd);
    if (periodEnd === null) return FREE;

    if (periodEnd > at) {
      return {
        tier: 'premium',
        premium: true,
        endsAt: subscription.currentPeriodEnd,
        daysLeft: daysBetween(at, periodEnd),
      };
    }

    const graceEnd = periodEnd + graceDays * MS_PER_DAY;
    if (graceEnd > at) {
      return {
        tier: 'grace',
        premium: true,
        endsAt: new Date(graceEnd).toISOString(),
        daysLeft: daysBetween(at, graceEnd),
      };
    }
  }

  return FREE;
};

/**
 * Mốc kết thúc kỳ mới khi cộng thêm một kỳ đã trả tiền.
 *
 * Cộng dồn vào mốc CŨ nếu mốc đó còn hạn — trả tiền sớm không được mất ngày.
 * Hết hạn rồi thì tính từ hôm nay, không truy hồi khoảng thời gian không dùng.
 */
export const extendPeriod = (currentEnd: string | undefined, now: Date, months: number): string => {
  const end = time(currentEnd);
  const from = end !== null && end > now.getTime() ? new Date(end) : new Date(now);
  const next = new Date(from);
  next.setMonth(next.getMonth() + months);
  return next.toISOString();
};
