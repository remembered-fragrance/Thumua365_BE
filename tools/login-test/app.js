/**
 * Trang thử luồng tài khoản — cũng là VÍ DỤ cho frontend thật:
 *
 *   1. Đăng ký / đăng nhập: trình duyệt ↔ Supabase Auth (supabase-js). Mật khẩu KHÔNG đi qua API.
 *      Đăng nhập một ô: `sdk.resolveIdentifier` đổi tên/SĐT/email thành email đăng nhập.
 *   2. "Bác là ai?": `sdk.meBootstrap` — tạo tổ chức, vai trò chủ, gói dùng thử.
 *   3. OTP: `supabase.auth.updateUser({ phone })` → `verifyOtp({ type: 'phone_change' })`,
 *      rồi `sdk.discoverLinks()` với header tổ chức.
 *   4. Lỗi: bắt ApiError và rẽ nhánh theo `code`, không theo câu chữ.
 */

import { createClient as createSupabase } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
import { normalizePhone } from '@mambo/core/identifier';
import { ApiError, createClient } from '@mambo/sdk';

const DEFAULTS = {
  apiUrl: 'https://thumua365-api-staging.onrender.com',
  supabaseUrl: 'https://bldlrkmszjmhifubxjvl.supabase.co',
  publishableKey: '',
};
const STORE_KEY = 'thumua365-login-test';
/** Giống `data/auth.ts` của frontend. */
const SIGN_IN_ERROR = 'Tài khoản hoặc mật khẩu không đúng';
const INTERNAL_EMAIL_DOMAIN = 'id.thumua365.vn';

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
/** Tổ chức đang làm việc — SDK gửi làm header X-Organization-Id. */
let currentOrgId = null;
let lastMe = null;

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
    const fields = err.details?.fields ? ` (${Object.entries(err.details.fields).map(([k, v]) => `${k}: ${v}`).join('; ')})` : '';
    const byCode = {
      UNAUTHENTICATED: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn — đăng nhập lại.',
      NOT_A_MEMBER: 'Bác không thuộc tổ chức này — chọn tổ chức khác.',
      FORBIDDEN: 'Vai trò này không được làm việc đó.',
      PHONE_NOT_VERIFIED: 'Cần xác thực số điện thoại bằng mã OTP trước.',
      VALIDATION_FAILED: `Dữ liệu chưa đúng${fields}.`,
      RATE_LIMITED: 'Gọi quá nhiều lần, chờ một phút.',
      CONTRACT_MISMATCH: 'API trả sai hợp đồng — báo cho backend.',
      INTERNAL: 'API gặp lỗi — báo cho backend kèm requestId.',
    };
    return `${err.code} (HTTP ${err.status}) — ${byCode[err.code] ?? err.message}${err.requestId ? ` · requestId ${err.requestId}` : ''}`;
  }
  if (err instanceof TypeError) return 'Không gọi được API — kiểm tra mạng, URL, hoặc CORS (trang phải mở ở localhost:5174).';
  return err instanceof Error ? err.message : String(err);
};

const errorBody = (err) =>
  err instanceof ApiError ? { code: err.code, status: err.status, details: err.details, requestId: err.requestId } : String(err);

/** Chạy một việc gọi API: khoá nút, báo kết quả, bắt lỗi theo `code`. */
const run = async (button, title, work) => {
  button.disabled = true;
  try {
    return await work();
  } catch (err) {
    show(`${title} — lỗi`, errorBody(err));
    say(explain(err), 'error');
    return undefined;
  } finally {
    button.disabled = false;
  }
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
    getOrganizationId: () => currentOrgId,
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
    render(null);
    $('signed-out').hidden = true;
    return;
  }

  supabase = createSupabase(config.supabaseUrl, config.publishableKey);
  supabase.auth.onAuthStateChange((_event, session) => render(session));
  supabase.auth.getSession().then(({ data }) => {
    render(data.session);
    if (data.session) void refreshMe();
  });
};

const render = (session) => {
  $('signed-out').hidden = Boolean(session);
  $('signed-in').hidden = !session;
  $('who').textContent = session?.user.email ?? session?.user.phone ?? '';
  if (!session) {
    for (const id of ['bootstrap-box', 'org-box', 'otp-box']) $(id).hidden = true;
    // Xoá sạch lựa chọn của người trước — không thì tài khoản sau "thừa hưởng" loại tổ
    // chức cũ và bấm "Xong" là tạo nhầm loại (đã gặp khi nghiệm thu BE2).
    for (const id of ['bootstrap', 'signup', 'otp-send', 'otp-verify']) $(id).reset();
    $('otp-verify').hidden = true;
    lastMe = null;
    currentOrgId = null;
  }
};

/** Vẽ lại phần sau đăng nhập theo /v1/me: chưa có tổ chức → "Bác là ai?". */
const renderMe = (me) => {
  lastMe = me;
  const hasOrg = me.memberships.length > 0;
  $('bootstrap-box').hidden = hasOrg;
  $('org-box').hidden = !hasOrg;
  $('otp-box').hidden = !hasOrg;

  const select = $('org-select');
  select.replaceChildren(
    ...me.memberships.map((m) => new Option(`${m.organization.name} · ${m.organization.type} · ${m.role}`, m.organization.id)),
  );
  if (!me.memberships.some((m) => m.organization.id === currentOrgId)) currentOrgId = me.memberships[0]?.organization.id ?? null;
  select.value = currentOrgId ?? '';
  renderOrgSummary();

  if (!$('otp-phone').value && me.user.phone) $('otp-phone').value = me.user.phone;
};

const renderOrgSummary = () => {
  const m = lastMe?.memberships.find((x) => x.organization.id === currentOrgId);
  if (!m) {
    $('org-summary').textContent = '';
    return;
  }
  const plan = m.plan ? `gói ${m.plan.tier} tới ${m.plan.periodEnd?.slice(0, 10) ?? '—'}` : 'không có gói (nông dân)';
  $('org-summary').textContent = `${m.permissions.length} quyền · ${plan} · số đã xác thực: ${lastMe.user.phoneVerified ? 'có' : 'chưa'} · lời mời chờ: ${lastMe.pendingLinks}`;
};

const refreshMe = async () => {
  try {
    const me = await api.me();
    renderMe(me);
    return me;
  } catch (err) {
    say(explain(err), 'error');
    return undefined;
  }
};

// ─── Hành động ───────────────────────────────────────────────────────────────

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

const selectTab = (tab) => {
  const login = tab === 'login';
  $('tab-login').setAttribute('aria-selected', String(login));
  $('tab-signup').setAttribute('aria-selected', String(!login));
  $('login').hidden = !login;
  $('signup').hidden = login;
};
$('tab-login').addEventListener('click', () => selectTab('login'));
$('tab-signup').addEventListener('click', () => selectTab('signup'));

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('password').value;
  $('password').value = '';
  say('Đang đăng nhập…');
  await run($('login-btn'), 'Đăng nhập', async () => {
    const { email } = await api.resolveIdentifier({ identifier: $('identifier').value });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Sai tài khoản hay sai mật khẩu: MỘT câu. Chỉ lỗi cấu hình mới nói rõ.
      const setupErrors = {
        'Invalid API key': 'Publishable key sai — mở "Cấu hình" và dán lại.',
        'Email not confirmed': 'Tài khoản chưa xác nhận email — tắt "Confirm email" trên staging.',
      };
      say(setupErrors[error.message] ?? SIGN_IN_ERROR, 'error');
      return;
    }
    say('Đăng nhập thành công.', 'ok');
    const me = await refreshMe();
    if (me) show('GET /v1/me — 200', me);
  });
});

$('signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = normalizePhone($('su-phone').value);
  if (!phone) {
    say('Số điện thoại chưa đúng.', 'error');
    return;
  }
  const realEmail = $('su-email').value.trim().toLowerCase();
  // Có email thật thì đăng nhập bằng nó; không thì email nội bộ từ số — giống frontend.
  const email = realEmail || `${phone.replace('+', '')}@${INTERNAL_EMAIL_DOMAIN}`;
  const password = $('su-password').value;
  $('su-password').value = '';
  say('Đang tạo tài khoản…');
  await run($('signup-btn'), 'Đăng ký', async () => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      say(`Supabase: ${error.message}`, 'error');
      return;
    }
    if (!data.session) {
      say('Đã tạo tài khoản nhưng Supabase đang bắt xác nhận email — tắt "Confirm email" trên staging rồi thử lại.', 'error');
      return;
    }
    $('otp-phone').value = phone;
    $('personName').focus();
    say('Đã tạo tài khoản. Tiếp: "Bác là ai?".', 'ok');
    await refreshMe();
  });
});

$('bootstrap').addEventListener('submit', async (e) => {
  e.preventDefault();
  const orgType = new FormData($('bootstrap')).get('orgType');
  const username = $('username').value.trim();
  const phone = $('otp-phone').value.trim();
  say('Đang tạo tổ chức…');
  await run($('bootstrap-btn'), 'POST /v1/me/bootstrap', async () => {
    const me = await api.meBootstrap({
      orgType,
      orgName: $('orgName').value,
      name: $('personName').value,
      ...(username ? { username } : {}),
      ...(phone ? { phone } : {}),
    });
    show('POST /v1/me/bootstrap — 200', me);
    $('bootstrap').reset();
    renderMe(me);
    const org = me.memberships[0]?.organization;
    say(`Xong: ${org?.name} · loại ${org?.type}. Bác thuộc ${me.memberships.length} tổ chức.`, 'ok');
  });
});

$('org-select').addEventListener('change', () => {
  currentOrgId = $('org-select').value || null;
  renderOrgSummary();
});

$('otp-send').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = normalizePhone($('otp-phone').value);
  if (!phone) {
    say('Số điện thoại chưa đúng.', 'error');
    return;
  }
  say('Đang gửi mã…');
  await run($('otp-send-btn'), 'Gửi OTP', async () => {
    const { error } = await supabase.auth.updateUser({ phone });
    if (error) {
      say(`Supabase: ${error.message}`, 'error');
      return;
    }
    $('otp-verify').hidden = false;
    $('otp-code').focus();
    say('Đã gửi mã. Nhập mã OTP.', 'ok');
  });
});

$('otp-verify').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = normalizePhone($('otp-phone').value);
  say('Đang xác thực…');
  await run($('otp-verify-btn'), 'Xác thực OTP', async () => {
    const { error } = await supabase.auth.verifyOtp({ phone, token: $('otp-code').value.trim(), type: 'phone_change' });
    $('otp-code').value = '';
    if (error) {
      say(`Supabase: ${error.message}`, 'error');
      return;
    }
    $('otp-verify').hidden = true;
    const me = await refreshMe();
    say(`Đã xác thực số. phoneVerified = ${me?.user.phoneVerified}. Tiếp: "Dò kết nối".`, 'ok');
  });
});

$('discover-btn').addEventListener('click', () =>
  run($('discover-btn'), 'POST /v1/links/discover', async () => {
    const res = await api.discoverLinks();
    show('POST /v1/links/discover — 200', res);
    say(`Tạo ${res.created} lời mời mới · đang chờ ${res.pending}.`, 'ok');
    await refreshMe();
  }),
);

$('me-btn').addEventListener('click', () =>
  run($('me-btn'), 'GET /v1/me', async () => {
    const me = await api.me();
    renderMe(me);
    show('GET /v1/me — 200', me);
    say(`/v1/me trả đúng hợp đồng. Thuộc ${me.memberships.length} tổ chức.`, 'ok');
  }),
);

$('logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  $('result-box').hidden = true;
  say('Đã đăng xuất.', 'ok');
});

init();
