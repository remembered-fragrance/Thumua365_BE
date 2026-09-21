/**
 * Trang thử đăng nhập — cũng là VÍ DỤ cho frontend thật:
 *
 *   1. Đăng nhập: trình duyệt ↔ Supabase Auth (supabase-js). Mật khẩu KHÔNG đi qua API.
 *   2. Gọi API: @mambo/sdk tự gắn access_token của phiên hiện tại.
 *   3. Lỗi: bắt ApiError và rẽ nhánh theo `code`, không theo câu chữ.
 */

import { createClient as createSupabase } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
import { ApiError, createClient } from '@mambo/sdk';

const DEFAULTS = {
  apiUrl: 'https://thumua365-api-staging.onrender.com',
  supabaseUrl: 'https://bldlrkmszjmhifubxjvl.supabase.co',
  publishableKey: '',
};
const STORE_KEY = 'thumua365-login-test';

const $ = (id) => document.getElementById(id);

const loadConfig = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
};

const config = loadConfig();
let supabase = null;
let api = null;

// ─── Hiển thị ────────────────────────────────────────────────────────────────

const say = (text, tone = 'info') => {
  $('message').textContent = text;
  $('message').dataset.tone = tone;
};

const show = (title, value) => {
  $('result-title').textContent = title;
  $('result').textContent = JSON.stringify(value, null, 2);
  $('result-box').hidden = false;
};

/** Câu cho người đọc, suy từ `code` của hợp đồng. */
const explain = (err) => {
  if (err instanceof ApiError) {
    const byCode = {
      UNAUTHENTICATED: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn — đăng nhập lại.',
      RATE_LIMITED: 'Gọi quá nhiều lần, chờ một phút.',
      CONTRACT_MISMATCH: 'API trả sai hợp đồng — báo cho backend.',
      INTERNAL: 'API gặp lỗi — báo cho backend kèm requestId.',
    };
    return `${err.code} (HTTP ${err.status}) — ${byCode[err.code] ?? err.message}${err.requestId ? ` · requestId ${err.requestId}` : ''}`;
  }
  if (err instanceof TypeError) return 'Không gọi được API — kiểm tra mạng, URL, hoặc CORS (trang phải mở ở localhost:5174).';
  return err instanceof Error ? err.message : String(err);
};

// ─── Khởi tạo ────────────────────────────────────────────────────────────────

const init = () => {
  $('apiUrl').value = config.apiUrl;
  $('supabaseUrl').value = config.supabaseUrl;
  $('publishableKey').value = config.publishableKey;

  api = createClient({
    baseUrl: config.apiUrl.replace(/\/+$/, ''),
    // Luôn lấy token của phiên HIỆN TẠI — supabase-js tự làm mới khi sắp hết hạn.
    getAccessToken: async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null,
  });

  api
    .health()
    .then((h) => {
      $('health').textContent = `API ${h.env} · v${h.version} · commit ${h.commit ?? '—'}`;
      $('health').dataset.tone = 'ok';
    })
    .catch((err) => {
      $('health').textContent = `API không trả lời: ${explain(err)}`;
      $('health').dataset.tone = 'error';
    });

  if (!config.publishableKey) {
    $('config-box').open = true;
    say('Điền publishable key của Supabase staging rồi bấm "Lưu cấu hình".');
    $('signed-out').hidden = true;
    $('signed-in').hidden = true;
    return;
  }

  supabase = createSupabase(config.supabaseUrl, config.publishableKey);
  supabase.auth.onAuthStateChange((_event, session) => render(session));
  supabase.auth.getSession().then(({ data }) => render(data.session));
};

const render = (session) => {
  $('signed-out').hidden = Boolean(session);
  $('signed-in').hidden = !session;
  $('who').textContent = session?.user.email ?? session?.user.phone ?? '';
};

// ─── Hành động ───────────────────────────────────────────────────────────────

const callMe = async () => {
  say('Đang gọi /v1/me…');
  try {
    const me = await api.me();
    show('GET /v1/me — 200', me);
    say(`/v1/me trả đúng hợp đồng. Thuộc ${me.memberships.length} tổ chức.`, 'ok');
  } catch (err) {
    show('GET /v1/me — lỗi', err instanceof ApiError ? { code: err.code, status: err.status, requestId: err.requestId } : String(err));
    say(explain(err), 'error');
  }
};

$('config').addEventListener('submit', (e) => {
  e.preventDefault();
  Object.assign(config, {
    apiUrl: $('apiUrl').value.trim(),
    supabaseUrl: $('supabaseUrl').value.trim(),
    publishableKey: $('publishableKey').value.trim(),
  });
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(config));
  } catch {
    // Trình duyệt chặn lưu — vẫn dùng được cho lần mở này.
  }
  $('config-box').open = false;
  say('Đã lưu cấu hình.', 'ok');
  init();
});

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-btn').disabled = true;
  say('Đang đăng nhập…');
  const { error } = await supabase.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value,
  });
  $('password').value = '';
  $('login-btn').disabled = false;
  if (error) {
    const known = {
      'Invalid login credentials': 'Sai email hoặc mật khẩu.',
      'Invalid API key': 'Publishable key sai — mở "Cấu hình" và dán lại khoá Publishable của project staging.',
      'Email not confirmed': 'Tài khoản chưa xác nhận email — tạo lại với "Auto Confirm User".',
    };
    say(known[error.message] ?? error.message, 'error');
    return;
  }
  say('Đăng nhập thành công.', 'ok');
  await callMe();
});

$('me-btn').addEventListener('click', callMe);

$('logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  $('result-box').hidden = true;
  say('Đã đăng xuất.', 'ok');
});

init();
