import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { meUserFrom } from '../src/me/me.controller';

const base = { SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'k' };

describe('loadEnv', () => {
  it('mặc định hợp lý cho máy dev, bỏ "/" cuối URL', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ APP_ENV: 'development', PORT: 3000, SUPABASE_URL: 'https://x.supabase.co' });
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('staging/production bắt buộc CORS_ORIGINS', () => {
    expect(() => loadEnv({ ...base, APP_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
    expect(loadEnv({ ...base, APP_ENV: 'production', CORS_ORIGINS: 'https://a.vn, https://b.vn' }).CORS_ORIGINS).toEqual([
      'https://a.vn',
      'https://b.vn',
    ]);
  });

  it('báo đúng tên biến thiếu', () => {
    expect(() => loadEnv({})).toThrow(/SUPABASE_URL[\s\S]*SUPABASE_PUBLISHABLE_KEY/);
  });

  it('SENTRY_DSN rỗng = tắt, không phải lỗi', () => {
    expect(loadEnv({ ...base, SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
    expect(() => loadEnv({ ...base, SENTRY_DSN: 'khong-phai-url' })).toThrow(/SENTRY_DSN/);
  });
});

describe('meUserFrom', () => {
  it('email thật được giữ; không có số thì phone null, chưa xác thực', () => {
    expect(
      meUserFrom({ id: 'u', email: 'mai@gmail.com', phone: '', phone_confirmed_at: null, user_metadata: {} }),
    ).toEqual({ id: 'u', name: null, phone: null, email: 'mai@gmail.com', phoneVerified: false });
  });
});
