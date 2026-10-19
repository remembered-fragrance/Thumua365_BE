import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { decoyEmail } from '../src/auth/auth.controller';
import { phoneFromLoginEmail } from '../src/auth/login-email';
import { meUserFrom } from '../src/me/me.controller';

const prodSecrets = {
  PRIVILEGED_DATABASE_URL: 'postgresql://api_privileged:p@localhost:5432/db',
  BANK_WEBHOOK_SECRET: 'bi-mat-webhook-dai-it-nhat-24-ky-tu',
  METRICS_TOKEN: 'token-prometheus-dai-it-nhat-24',
};

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
    expect(() => loadEnv({ ...base, APP_ENV: 'production', ...prodSecrets })).toThrow(/CORS_ORIGINS/);
    expect(() => loadEnv({ ...base, APP_ENV: 'staging' })).toThrow(/CORS_ORIGINS/);
    expect(loadEnv({ ...base, APP_ENV: 'production', ...prodSecrets, CORS_ORIGINS: 'https://a.vn, https://b.vn' }).CORS_ORIGINS).toEqual([
      'https://a.vn',
      'https://b.vn',
    ]);
  });

  it('BE10: production chỉ domain https thật; bí mật thu tiền / quản trị / giám sát bắt buộc', () => {
    const prod = { ...base, APP_ENV: 'production', CORS_ORIGINS: 'https://app.thumua365.vn', ...prodSecrets };
    expect(() => loadEnv(prod)).not.toThrow();
    expect(() => loadEnv({ ...prod, CORS_ORIGINS: 'https://app.thumua365.vn,http://localhost:5173' })).toThrow(/https/);
    expect(() => loadEnv({ ...prod, CORS_ORIGINS: 'http://app.thumua365.vn' })).toThrow(/https/);
    for (const key of ['PRIVILEGED_DATABASE_URL', 'BANK_WEBHOOK_SECRET', 'METRICS_TOKEN']) {
      expect(() => loadEnv({ ...prod, [key]: '' })).toThrow(new RegExp(key));
    }
    // Staging vẫn chạy khi chưa điền — chỉ ba việc đặc quyền báo lỗi.
    expect(() => loadEnv({ ...base, APP_ENV: 'staging', CORS_ORIGINS: 'http://localhost:5173' })).not.toThrow();
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

  it('0.16.0: gửi thư tuỳ chọn; có BREVO_API_KEY thì bắt buộc MAIL_FROM và APP_URL', () => {
    const none = loadEnv(base);
    expect(none.BREVO_API_KEY).toBeUndefined();
    expect(none.MAIL_FROM_NAME).toBe('THUMUA365');
    const mail = { BREVO_API_KEY: 'xkeysib-abc', MAIL_FROM: 'no-reply@thumua365.id.vn', APP_URL: 'https://www.thumua365.id.vn/' };
    expect(loadEnv({ ...base, ...mail }).APP_URL).toBe('https://www.thumua365.id.vn');
    expect(() => loadEnv({ ...base, ...mail, MAIL_FROM: '' })).toThrow(/MAIL_FROM/);
    expect(() => loadEnv({ ...base, ...mail, APP_URL: '' })).toThrow(/APP_URL/);
    expect(() => loadEnv({ ...base, ...mail, MAIL_FROM: 'khong-phai-email' })).toThrow(/MAIL_FROM/);
    const prod = { ...base, ...prodSecrets, APP_ENV: 'production', CORS_ORIGINS: 'https://app.thumua365.vn' };
    expect(() => loadEnv({ ...prod, ...mail, APP_URL: 'http://www.thumua365.id.vn' })).toThrow(/APP_URL/);
    // Production chưa có khoá Brevo vẫn lên — chỉ xác nhận email / quên mật khẩu báo EMAIL_UNAVAILABLE.
    expect(() => loadEnv(prod)).not.toThrow();
  });
});

describe('meUserFrom', () => {
  it('email thật được giữ; không có số thì phone null, chưa xác thực', () => {
    expect(
      meUserFrom({ id: 'u', email: 'mai@gmail.com', phone: '', phone_confirmed_at: null, user_metadata: {} }),
    ).toEqual({ id: 'u', name: null, phone: null, email: 'mai@gmail.com', phoneVerified: false });
  });

  it('đăng ký bằng SĐT: số lấy từ email nội bộ, email = email khôi phục khai lúc đăng ký', () => {
    expect(
      meUserFrom({
        id: 'u',
        email: '84912345678@id.thumua365.vn',
        phone: null,
        phone_confirmed_at: null,
        user_metadata: { name: 'Mai', recoveryEmail: 'Mai@Gmail.com' },
      }),
    ).toEqual({ id: 'u', name: 'Mai', phone: '+84912345678', email: 'mai@gmail.com', phoneVerified: false });
  });

  it('có hồ sơ: email lấy từ hồ sơ, không từ email khai lúc đăng ký (C4)', () => {
    const account = { id: 'u', email: '84912345678@id.thumua365.vn', phone: null, phone_confirmed_at: null, user_metadata: { recoveryEmail: 'cu@gmail.com' } };
    expect(meUserFrom(account, 'Moi@Gmail.com')).toMatchObject({ email: 'moi@gmail.com' });
    expect(meUserFrom(account, null)).toMatchObject({ email: null });
  });

  it('đăng ký bằng SĐT, không khai email → email null (email nội bộ vẫn bị giấu)', () => {
    expect(
      meUserFrom({ id: 'u', email: '84912345678@id.thumua365.vn', phone: null, phone_confirmed_at: null, user_metadata: {} }),
    ).toMatchObject({ phone: '+84912345678', email: null });
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
