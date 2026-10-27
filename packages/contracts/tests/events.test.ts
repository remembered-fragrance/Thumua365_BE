import { describe, expect, it } from 'vitest';
import { SERVER_EVENT_NAMES, TrackedEvent } from '../src/events';

const base = { anonId: 'a1b2c3d4e5', at: '2026-10-03T03:00:00.000+07:00', platform: 'pwa' };

describe('danh mục sự kiện', () => {
  it('nhận đúng bộ thuộc tính của từng tên', () => {
    expect(TrackedEvent.safeParse({ ...base, name: 'app_opened', props: {} }).success).toBe(true);
    expect(
      TrackedEvent.safeParse({ ...base, name: 'receipt_created', props: { kind: 'purchase', lines: 2, offline: true, fromOrder: false } }).success,
    ).toBe(true);
  });

  it('🔴 thuộc tính lạ — số tiền, số điện thoại, tên — làm hỏng cả sự kiện', () => {
    const leaks = [
      { name: 'receipt_created', props: { kind: 'purchase', lines: 1, offline: false, fromOrder: false, amount: 1_438_000 } },
      { name: 'contact_clicked', props: { channel: 'zalo', phone: '0912345678' } },
      { name: 'app_opened', props: {}, userName: 'Cô Mai' },
    ];
    for (const e of leaks) expect(TrackedEvent.safeParse({ ...base, ...e }).success).toBe(false);
  });

  it('UTM (0.26.0): app_opened và sign_up_completed nhận nguồn khách tới; giá trị lạ hỏng cả sự kiện', () => {
    const utm = { source: 'facebook', medium: 'social', campaign: 'mua-ca-phe-2026' };
    expect(TrackedEvent.safeParse({ ...base, name: 'app_opened', props: { utm } }).success).toBe(true);
    expect(TrackedEvent.safeParse({ ...base, name: 'sign_up_completed', props: { orgType: 'trader', utm: { source: 'zalo' } } }).success).toBe(true);
    for (const bad of [{ medium: 'social' }, { source: 'Facebook' }, { source: 'cô mai' }, { source: 'x'.repeat(65) }, { source: 'zalo', phone: '0912345678' }]) {
      expect(TrackedEvent.safeParse({ ...base, name: 'app_opened', props: { utm: bad } }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('app không gửi được sự kiện của server, cũng không tự đặt tên mới', () => {
    for (const name of [...SERVER_EVENT_NAMES, 'receipt_deleted_secretly']) {
      expect(TrackedEvent.safeParse({ ...base, name, props: {} }).success).toBe(false);
    }
  });
});
