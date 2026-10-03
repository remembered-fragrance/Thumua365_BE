#!/usr/bin/env node
/**
 * Nghiệm thu BE4 (kết nối bằng mã kết nối) trên staging bằng HAI tài khoản thử có thật — bạn tự
 * chạy trên máy mình. Cần build gói trước: `npm run build:packages`.
 *
 *   npm run smoke:links
 *   npm run smoke:links -- https://thumua365-api-staging.onrender.com   (đổi API)
 *
 * Script hỏi tài khoản vựa (hoặc doanh nghiệp) và tài khoản nông dân — SĐT, tên đăng nhập hay email
 * đều được, gõ mật khẩu không hiện chữ. Mật khẩu và token KHÔNG bao giờ được in ra, ghi file hay gửi
 * đi đâu ngoài Supabase Auth và API. Không in thân phản hồi (có thể chứa SĐT) — chỉ mã lỗi.
 *
 * Kịch bản = "Xong khi" của BE4 (KH §7):
 *   1. Đăng nhập hai tài khoản, chọn tổ chức (vựa/DN có `partner:manage`; nông dân)
 *   2. Vựa ghi phiếu mua có nợ cho một người bán KHÔNG có SĐT (qua /sync/push, tổng tính bằng core)
 *   3. Vựa mời → nhận mã; mời lại → đúng mã cũ
 *   4. Vựa nhập chính mã của mình → 422
 *   5. Nông dân nhập mã (gõ chữ thường, có gạch) → kết nối active
 *   6. Nông dân thấy đúng phiếu, đúng tổng / đã trả / còn nợ; công nợ có vựa đó
 *   7. Nhập lại mã đã dùng, mã bịa → cùng một lỗi 404
 *   8. Vựa huỷ kết nối → nông dân mất quyền xem ngay
 *   9. Đăng xuất cả hai phiên
 *
 * Dữ liệu thử để lại trong sổ vựa: một người bán "Nghiệm thu BE4 <giờ>", một phiếu, một lần trả, một
 * kết nối đã huỷ — tên rõ ràng để đối chiếu database.
 *
 * Biến môi trường (không bắt buộc — thiếu thì script hỏi; tự đọc apps/api/.env nếu có):
 *   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TRADER_ID, TRADER_PASSWORD, FARMER_ID, FARMER_PASSWORD
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

const STAGING_API = 'https://thumua365-api-staging.onrender.com';
const STAGING_SUPABASE = 'https://bldlrkmszjmhifubxjvl.supabase.co';

if (existsSync('apps/api/.env')) process.loadEnvFile('apps/api/.env');

const apiUrl = (process.argv[2] ?? process.env.API_URL ?? STAGING_API).replace(/\/+$/, '');
const supabaseUrl = (process.env.SUPABASE_URL || STAGING_SUPABASE).replace(/\/+$/, '');

// ─── Nhập liệu (như smoke-me.mjs) ────────────────────────────────────────────

let muted = false;
let rl = null;
let ended = false;
const lines = [];
const waiters = [];

const reader = () => {
  if (rl) return rl;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY === true });
  rl.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    ended = true;
    for (const waiter of waiters.splice(0)) waiter.reject(new Error('Đầu vào kết thúc trước khi trả lời đủ câu hỏi'));
  });
  return rl;
};

const nextLine = () => {
  if (lines.length > 0) return Promise.resolve(lines.shift());
  if (ended) return Promise.reject(new Error('Đầu vào kết thúc trước khi trả lời đủ câu hỏi'));
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
};

const ask = async (question, { hidden = false } = {}) => {
  reader();
  process.stdout.write(question);
  muted = hidden;
  try {
    return (await nextLine()).trim();
  } finally {
    muted = false;
    if (hidden) process.stdout.write('\n');
  }
};

// ─── In kết quả ──────────────────────────────────────────────────────────────

let failed = 0;
const pass = (label, detail = '') => console.warn(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail = '') => {
  failed++;
  console.warn(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
};
const check = (ok, label, detail = '') => (ok ? pass(label, detail) : fail(label, detail));
const money = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
const mask = (id) => (typeof id === 'string' && id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
const showCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Lỗi API → "MÃ (HTTP, requestId)". Không in thân phản hồi. */
const describe = (err) =>
  err && typeof err === 'object' && 'code' in err
    ? `${err.code} (HTTP ${err.status}${err.requestId ? `, requestId ${err.requestId}` : ''})`
    : err instanceof Error
      ? err.message
      : String(err);

/** Chạy `work`, mong nó ném ApiError mang đúng `code`. Trả lỗi bắt được (hoặc null nếu không ném). */
const expectError = async (work) => {
  try {
    await work();
    return null;
  } catch (err) {
    return err;
  }
};

// ─── Chạy ────────────────────────────────────────────────────────────────────

const loadPackages = async () => {
  try {
    const sdk = await import('@mambo/sdk');
    const calc = await import('@mambo/core/calc');
    const contracts = await import('@mambo/contracts');
    return { sdk, calc, contracts };
  } catch {
    throw new Error('Chưa build gói dùng chung — chạy `npm run build:packages` rồi chạy lại');
  }
};

const main = async () => {
  const { sdk, calc, contracts } = await loadPackages();
  console.warn(`API:      ${apiUrl}`);
  console.warn(`Supabase: ${supabaseUrl}\n`);

  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || (await ask('Publishable key của Supabase staging (sb_publishable_…): '));
  const traderId = process.env.TRADER_ID || (await ask('Tài khoản VỰA / DOANH NGHIỆP (SĐT, tên đăng nhập hoặc email): '));
  const traderPassword = process.env.TRADER_PASSWORD || (await ask('Mật khẩu vựa (không hiện khi gõ): ', { hidden: true }));
  const farmerId = process.env.FARMER_ID || (await ask('Tài khoản NÔNG DÂN (SĐT, tên đăng nhập hoặc email): '));
  const farmerPassword = process.env.FARMER_PASSWORD || (await ask('Mật khẩu nông dân (không hiện khi gõ): ', { hidden: true }));
  rl?.close();
  if (!publishableKey || !traderId || !traderPassword || !farmerId || !farmerPassword) {
    throw new Error('Thiếu publishable key, tài khoản hoặc mật khẩu');
  }

  process.stdout.write('\nĐánh thức API… ');
  const health = await fetch(`${apiUrl}/v1/health`).then((r) => r.json());
  console.warn(`${health.env} · commit ${health.commit} · ${health.version}\n`);

  const anon = sdk.createClient({ baseUrl: apiUrl, getAccessToken: () => null });
  const sessions = [];

  /** Đăng nhập một ô như app: SĐT / tên / email → email đăng nhập → Supabase Auth. */
  const signIn = async (identifier, password) => {
    const { email } = await anon.resolveIdentifier({ identifier });
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const session = await res.json().catch(() => ({}));
    if (!res.ok || !session.access_token) {
      throw new Error(`đăng nhập hỏng (HTTP ${res.status}: ${session.error_description ?? session.msg ?? 'không rõ'})`);
    }
    sessions.push(session.access_token);
    return { token: session.access_token, userId: session.user?.id };
  };

  const clientFor = (token, orgId) =>
    sdk.createClient({ baseUrl: apiUrl, getAccessToken: () => token, getOrganizationId: () => orgId });

  try {
    // 1. Đăng nhập, chọn tổ chức
    console.warn('1. Đăng nhập hai tài khoản, chọn tổ chức');
    let trader;
    let farmer;
    try {
      const t = await signIn(traderId, traderPassword);
      const me = await clientFor(t.token, null).me();
      const m = me.memberships.find(
        (x) => x.organization.type !== 'farmer' && x.permissions.includes('partner:manage') && x.permissions.includes('book:sync'),
      );
      if (!m) throw new Error('tài khoản này không có tổ chức vựa / DN nào được mời kết nối (cần partner:manage)');
      trader = { ...t, org: m.organization, api: clientFor(t.token, m.organization.id) };
      pass('Vựa đăng nhập', `${m.organization.name} (${m.organization.type}, ${m.role})`);
    } catch (err) {
      fail('Vựa đăng nhập', describe(err));
      return;
    }
    try {
      const f = await signIn(farmerId, farmerPassword);
      const me = await clientFor(f.token, null).me();
      const m = me.memberships.find((x) => x.organization.type === 'farmer');
      if (!m) throw new Error('tài khoản này chưa có tổ chức nông dân — đăng ký, chọn "Nông dân" ở bước "Bác là ai?"');
      farmer = { ...f, org: m.organization, api: clientFor(f.token, m.organization.id) };
      pass('Nông dân đăng nhập', `${m.organization.name}`);
    } catch (err) {
      fail('Nông dân đăng nhập', describe(err));
      return;
    }
    if (trader.userId === farmer.userId) {
      fail('Hai tài khoản phải là hai người khác nhau');
      return;
    }

    // 2. Vựa ghi phiếu có nợ
    console.warn('\n2. Vựa ghi phiếu mua có nợ cho người bán KHÔNG có số điện thoại');
    const products = [];
    for (let cursor; ; ) {
      const page = await trader.api.sync.pull(cursor ? { cursor } : {});
      products.push(...page.changes.products);
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    const product = products.find((p) => !p.deletedAt && p.isActive !== false);
    if (!product) {
      fail('Sổ vựa chưa có mặt hàng nào');
      return;
    }
    const extra = { rubberLatex: { qualityPercent: 30 }, netAfterTare: { tareWeight: 2 }, lossPercent: { lossPercent: 1 } }[
      product.formulaType
    ];
    const line = calc.freezeLineTotals({
      id: randomUUID(),
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      formulaType: product.formulaType,
      ...(product.crop ? { crop: product.crop } : {}),
      grossWeight: 120,
      ...extra,
      pricePerUnit: 47_940,
    });
    const supplierId = randomUUID();
    const txId = randomUUID();
    const sellerName = `Nghiệm thu BE4 ${new Date().toLocaleString('vi-VN')}`;
    const paid = Math.max(1_000, Math.floor(line.roundedTotal / 3 / 1_000) * 1_000);
    const expected = calc.transactionTotals({ lines: [line], adjustments: [], amountPaid: paid });
    const now = new Date().toISOString();
    const ops = [
      { entity: 'supplier', kind: 'insert', recordId: supplierId, data: { name: sellerName } },
      {
        entity: 'transaction',
        kind: 'insert',
        recordId: txId,
        data: { date: now, kind: 'purchase', counterpartyId: supplierId, supplierName: sellerName, lines: [line] },
      },
      { entity: 'payment', kind: 'insert', recordId: randomUUID(), data: { transactionId: txId, date: now, amount: paid } },
    ].map((op, i) => ({ opId: randomUUID(), seq: i + 1, ...op }));
    // Kiểm từng op bằng đúng hợp đồng TRƯỚC khi gửi — sai thì hỏng ở đây, không để lại rác trên staging.
    for (const op of ops) {
      const parsed = contracts.parseSyncOp(op);
      if (!parsed.ok) {
        fail(`Op ${op.entity} sai hợp đồng`, JSON.stringify(parsed.fields));
        return;
      }
    }
    const pushed = await trader.api.sync.push({ deviceId: randomUUID(), ops });
    const statuses = pushed.results.map((r) => r.status);
    check(
      statuses.length === 3 && statuses.every((s) => s === 'applied'),
      'Đẩy người bán + phiếu + lần trả',
      statuses.length === 3 ? statuses.join(', ') : `${statuses.join(', ')} · lỗi ${pushed.results.find((r) => r.error)?.error?.code}`,
    );
    if (failed > 0) return;
    console.warn(
      `     ${product.name} · ${line.grossWeight} ${line.unit} · tổng ${money(expected.total)} · trả ${money(paid)} · còn nợ ${money(expected.debt)}`,
    );

    // 3. Mời → mã; mời lại → đúng mã cũ
    console.warn('\n3. Vựa mời kết nối');
    const invited = await trader.api.links.invite({ partnerKind: 'supplier', partnerId: supplierId });
    const code = invited.inviteCode?.code;
    check(invited.status === 'pending' && Boolean(code), 'Mời → kết nối chờ, kèm mã', code ? `mã ${showCode(code)}, hết hạn ${new Date(invited.inviteCode.expiresAt).toLocaleString('vi-VN')}` : 'không có mã');
    check(invited.invitedPhone === null, 'Người bán không có SĐT vẫn mời được');
    if (!code) return;
    const again = await trader.api.links.invite({ partnerKind: 'supplier', partnerId: supplierId });
    check(again.id === invited.id && again.inviteCode?.code === code, 'Mời lại → đúng kết nối, đúng mã cũ');

    // 4. Vựa nhập chính mã của mình
    console.warn('\n4. Vựa nhập chính mã của mình');
    const own = await expectError(() => trader.api.links.claim({ code }));
    check(own?.code === 'VALIDATION_FAILED', 'Mã của chính sổ mình → 422 VALIDATION_FAILED', own ? describe(own) : 'không lỗi');

    // 5. Nông dân nhập mã như người dùng gõ
    console.warn('\n5. Nông dân nhập mã');
    const typed = showCode(code).toLowerCase();
    let claimed;
    try {
      claimed = await farmer.api.links.claim({ code: typed });
      check(claimed.status === 'active' && claimed.side === 'linked', `Gõ "${typed}" → kết nối active`);
      check(claimed.counterpart?.id === trader.org.id, 'Kết nối đúng với sổ của vựa', claimed.counterpart?.name ?? '—');
      check(claimed.inviteCode === null, 'Bên được mời không thấy mã');
    } catch (err) {
      fail('Nhập mã', describe(err));
      return;
    }

    // 6. Đúng phiếu, đúng số nợ
    console.warn('\n6. Nông dân xem phiếu và công nợ');
    const receipts = [];
    for (let cursor; ; ) {
      const page = await farmer.api.linked.receipts({ orgId: trader.org.id, ...(cursor ? { cursor } : {}) });
      receipts.push(...page.receipts);
      cursor = page.cursor;
      if (!cursor) break;
    }
    const mine = receipts.find((r) => r.id === txId);
    check(Boolean(mine), 'Thấy phiếu vừa ghi', `${receipts.length} phiếu của vựa này`);
    if (mine) {
      check(mine.total === expected.total, 'Tổng tiền khớp', `${money(mine.total)} / mong ${money(expected.total)}`);
      check(mine.paid === paid, 'Đã trả khớp', money(mine.paid));
      check(mine.debt === expected.debt, 'Còn nợ khớp', `${money(mine.debt)} / mong ${money(expected.debt)}`);
      check(mine.lines.length === 1 && mine.lines[0].total === line.roundedTotal, 'Dòng hàng khớp (cân, giá, thành tiền)');
      const extraKeys = Object.keys(mine).filter((k) => ['note', 'createdBy', 'branchId', 'attachmentIds', 'supplierId'].includes(k));
      check(extraKeys.length === 0, 'Không lộ ghi chú nội bộ, người lập, chi nhánh, ảnh', extraKeys.join(', '));
    }
    const balance = await farmer.api.linked.balance();
    const item = balance.items.find((i) => i.organization.id === trader.org.id);
    check(Boolean(item) && item.theyOwe >= expected.debt, 'Công nợ có vựa này', item ? `vựa còn nợ ${money(item.theyOwe)} · ${item.receiptCount} phiếu` : 'không có');

    // 7. Mã đã dùng, mã bịa
    console.warn('\n7. Nhập lại mã đã dùng, nhập mã bịa');
    const reused = await expectError(() => farmer.api.links.claim({ code: typed }));
    const bogus = await expectError(() => farmer.api.links.claim({ code: 'ZZZZ-ZZZZ' }));
    check(reused?.code === 'NOT_FOUND', 'Mã đã dùng → 404 NOT_FOUND', reused ? describe(reused) : 'không lỗi');
    check(bogus?.code === 'NOT_FOUND', 'Mã bịa → 404 NOT_FOUND', bogus ? describe(bogus) : 'không lỗi');
    check(Boolean(reused && bogus) && reused.message === bogus.message, 'Hai trường hợp cùng một câu — không dò được mã nào từng có');

    // 8. Vựa huỷ → nông dân mất quyền
    console.warn('\n8. Vựa huỷ kết nối');
    const revoked = await trader.api.links.revoke(invited.id);
    check(revoked.status === 'revoked', 'Huỷ → revoked');
    const after = await expectError(async () => {
      const page = await farmer.api.linked.receipts({ orgId: trader.org.id });
      if (page.receipts.some((r) => r.id === txId)) throw new Error('VẪN THẤY phiếu sau khi huỷ');
    });
    check(
      !after || after.code === 'LINK_REQUIRED',
      'Nông dân không còn thấy phiếu',
      after ? describe(after) : 'phiếu đã biến mất (còn kết nối khác với vựa này)',
    );
    const balanceAfter = await farmer.api.linked.balance();
    const itemAfter = balanceAfter.items.find((i) => i.organization.id === trader.org.id);
    check(!itemAfter || itemAfter.theyOwe < (item?.theyOwe ?? Infinity), 'Công nợ không còn tính phiếu này', itemAfter ? money(itemAfter.theyOwe) : 'không còn vựa này');

    console.warn(`\n     Đối chiếu database: kết nối ${mask(invited.id)}, phiếu ${mask(txId)}, người bán "${sellerName}"`);
  } finally {
    // 9. Đăng xuất mọi phiên vừa mở
    for (const token of sessions) {
      await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
  }
};

main()
  .catch((err) => fail('Lỗi không lường trước', describe(err)))
  .finally(() => {
    console.warn(failed === 0 ? '\nKết quả: ĐẠT\n' : `\nKết quả: ${failed} mục KHÔNG ĐẠT\n`);
    process.exitCode = failed === 0 ? 0 : 1;
  });
