import { describe, expect, it } from 'vitest';
import { extendPeriod, planFor, type Subscription } from '../src/subscription';

const GRACE = 7;
const NOW = new Date('2026-08-10T00:00:00.000Z');

const sub = (patch: Partial<Subscription> = {}): Subscription => ({
  id: 'sub-1',
  status: 'trialing',
  trialEndsAt: '2026-09-09T00:00:00.000Z',
  ...patch,
});

describe('planFor', () => {
  it('chưa có gói thì là bậc miễn phí', () => {
    expect(planFor(null, NOW, GRACE)).toEqual({ tier: 'free', premium: false, daysLeft: 0 });
  });

  it('đang dùng thử thì được dùng đầy đủ và đếm ngược đúng số ngày', () => {
    const plan = planFor(sub(), NOW, GRACE);
    expect(plan.tier).toBe('trial');
    expect(plan.premium).toBe(true);
    expect(plan.daysLeft).toBe(30);
  });

  it('hết hạn dùng thử thì rơi về miễn phí, không rơi vào ân hạn', () => {
    const plan = planFor(sub({ trialEndsAt: '2026-08-09T00:00:00.000Z' }), NOW, GRACE);
    expect(plan.tier).toBe('free');
  });

  it('đã trả tiền và còn hạn thì là bậc trả phí', () => {
    const plan = planFor(
      sub({ status: 'active', trialEndsAt: undefined, currentPeriodEnd: '2026-09-10T00:00:00.000Z' }),
      NOW,
      GRACE,
    );
    expect(plan.tier).toBe('premium');
    expect(plan.daysLeft).toBe(31);
  });

  it('vừa hết kỳ thì còn ân hạn, vẫn đồng bộ được', () => {
    const plan = planFor(
      sub({ status: 'active', trialEndsAt: undefined, currentPeriodEnd: '2026-08-08T00:00:00.000Z' }),
      NOW,
      GRACE,
    );
    expect(plan.tier).toBe('grace');
    expect(plan.premium).toBe(true);
    expect(plan.daysLeft).toBe(5);
  });

  it('quá ân hạn thì hết quyền đồng bộ', () => {
    const plan = planFor(
      sub({ status: 'active', trialEndsAt: undefined, currentPeriodEnd: '2026-08-01T00:00:00.000Z' }),
      NOW,
      GRACE,
    );
    expect(plan.tier).toBe('free');
    expect(plan.premium).toBe(false);
  });

  it('còn vài tiếng vẫn đếm là một ngày, không phải không ngày', () => {
    const plan = planFor(sub({ trialEndsAt: '2026-08-10T03:00:00.000Z' }), NOW, GRACE);
    expect(plan.daysLeft).toBe(1);
  });

  it('trạng thái huỷ thì không có bậc nào, dù ngày còn hạn', () => {
    const plan = planFor(
      sub({ status: 'canceled', currentPeriodEnd: '2027-01-01T00:00:00.000Z' }),
      NOW,
      GRACE,
    );
    expect(plan.tier).toBe('free');
  });
});

describe('extendPeriod', () => {
  it('trả tiền sớm thì cộng dồn vào mốc cũ, không mất ngày', () => {
    const next = extendPeriod('2026-09-10T00:00:00.000Z', NOW, 1);
    expect(next.slice(0, 10)).toBe('2026-10-10');
  });

  it('đã hết hạn thì tính từ hôm nay, không truy hồi', () => {
    const next = extendPeriod('2026-06-01T00:00:00.000Z', NOW, 1);
    expect(next.slice(0, 10)).toBe('2026-09-10');
  });

  it('chưa từng trả tiền thì cũng tính từ hôm nay', () => {
    expect(extendPeriod(undefined, NOW, 12).slice(0, 10)).toBe('2027-08-10');
  });

  it('trả tiền giữa kỳ dùng thử thì giữ ngày dùng thử còn lại', () => {
    expect(extendPeriod(undefined, NOW, 1, '2026-08-20T00:00:00.000Z').slice(0, 10)).toBe('2026-09-20');
  });

  it('dùng thử đã hết thì không cộng gì thêm', () => {
    expect(extendPeriod(undefined, NOW, 1, '2026-08-01T00:00:00.000Z').slice(0, 10)).toBe('2026-09-10');
  });

  it('cuối tháng không tràn sang tháng sau: 31/01 + 1 tháng = 28/02', () => {
    // 31/01/2027 10:00 giờ Việt Nam
    const end = extendPeriod('2027-01-31T03:00:00.000Z', new Date('2027-01-01T00:00:00.000Z'), 1);
    expect(end).toBe('2027-02-28T03:00:00.000Z');
  });

  it('năm nhuận: 31/01/2028 + 1 tháng = 29/02/2028', () => {
    expect(extendPeriod('2028-01-31T03:00:00.000Z', new Date('2028-01-01T00:00:00.000Z'), 1)).toBe('2028-02-29T03:00:00.000Z');
  });

  it('ngày cuối tháng theo giờ Việt Nam, không theo UTC', () => {
    // 01/02/2027 02:00 giờ Việt Nam = 31/01 19:00 UTC → + 1 tháng = 01/03 giờ Việt Nam
    expect(extendPeriod('2027-01-31T19:00:00.000Z', new Date('2027-01-01T00:00:00.000Z'), 1)).toBe('2027-02-28T19:00:00.000Z');
  });
});
