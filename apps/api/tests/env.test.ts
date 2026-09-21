import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { decoyEmail } from '../src/auth/auth.controller';
import { phoneFromLoginEmail } from '../src/auth/login-email';
import { meUserFrom } from '../src/me/me.controller';

const base = {
  SUPABASE_URL: 'https://x.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'k',
  SUPABASE_SECRET_KEY: 's',
  DATABASE_URL: 'postgresql://api_service:p@localhost:5432/db',
};

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

  it('BE2: bắt buộc DATABASE_URL (postgresql://) và khoá secret', () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...base, SUPABASE_SECRET_KEY: '' })).toThrow(/SUPABASE_SECRET_KEY/);
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

describe('email đăng nhập', () => {
  it('lấy số điện thoại từ email nội bộ; email thật thì không', () => {
    expect(phoneFromLoginEmail('84912345678@id.thumua365.vn')).toBe('+84912345678');
    expect(phoneFromLoginEmail('84912345678@ID.THUMUA365.VN')).toBe('+84912345678');
    expect(phoneFromLoginEmail('mai@gmail.com')).toBeNull();
    expect(phoneFromLoginEmail('84912345678@id.thumua365.vn.evil.com')).toBeNull();
    expect(phoneFromLoginEmail(null)).toBeNull();
  });

  it('email mồi cùng hình dạng email thật, cố định cho cùng đầu vào, không đoán được khi thiếu khoá', () => {
    expect(decoyEmail('0912 345 678', 'k')).toBe('84912345678@id.thumua365.vn');
    expect(decoyEmail(' Mai@Gmail.com ', 'k')).toBe('mai@gmail.com');

    const a = decoyEmail('vuatuhung', 'k1');
    expect(a).toMatch(/^849\d{8}@id\.thumua365\.vn$/);
    expect(decoyEmail('VuaTuHung', 'k1')).toBe(a);
    expect(decoyEmail('vuatuhung', 'k2')).not.toBe(a);
  });
});
