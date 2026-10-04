#!/usr/bin/env node
/**
 * Nghiệm thu BE5 (đơn, đặt lịch, thông báo — luồng R2) trên staging bằng HAI tài khoản thử có thật —
 * bạn tự chạy trên máy mình. Cần build gói trước: `npm run build:packages`.
 *
 *   npm run smoke:orders
 *   npm run smoke:orders -- https://thumua365-api-staging.onrender.com   (đổi API)
 *
 * Script hỏi tài khoản vựa (hoặc doanh nghiệp) và tài khoản nông dân — SĐT, tên đăng nhập hay email
 * đều được, gõ mật khẩu không hiện chữ. Mật khẩu và token KHÔNG bao giờ được in ra, ghi file hay gửi
 * đi đâu ngoài Supabase Auth và API. Không in thân phản hồi (có thể chứa SĐT) — chỉ mã lỗi.
 *
 * Kịch bản = "Xong khi" của BE5 (KH §7, luồng R2):
 *   1. Đăng nhập hai tài khoản, chọn tổ chức (vựa/DN có `order:respond`; nông dân)
 *   2. Vựa thêm người bán mới, mời kết nối; nông dân nhập mã → kết nối active
 *   3. Nông dân gửi đơn BÁN cho vựa → `submitted` v1; vựa thấy đơn, `partnerId` = người bán trong sổ
 *   4. Vựa nhận → `accepted` v2; hẹn lịch → `scheduled` v3; nông dân thấy lịch
 *   5. Vựa đẩy phiếu THEO ĐƠN + một lần trả → đơn tự `fulfilled` v4, lịch sử 4 mốc đúng bên
 *   6. Nông dân thấy đơn hoàn thành, thấy phiếu, đúng tổng / đã trả / còn nợ
 *   7. Thông báo: vựa có `order.submitted`; nông dân có `order.accepted`, `order.scheduled`, `order.fulfilled`
 *   8. Đơn thứ hai: nông dân huỷ; vựa bấm nhận bằng version cũ → 409 `ORDER_STATE_CHANGED`
 *   9. Vựa huỷ kết nối thử, đăng xuất cả hai phiên
 *
 * Dữ liệu thử để lại: trong sổ vựa một người bán "Nghiệm thu BE5 <giờ>", một phiếu, một lần trả, một
 * kết nối đã huỷ; hai đơn (một hoàn thành, một đã huỷ) và thông báo của chúng — tên rõ ràng để đối chiếu.
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

// ─── Nhập liệu (như smoke-links.mjs) ─────────────────────────────────────────

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

/** Chạy `work`, trả lỗi bắt được (hoặc null nếu không ném). */
const expectError = async (work) => {
  try {
    await work();
    return null;
  } catch (err) {
    return err;
  }
};

/** Thông báo ghi SAU khi API trả lời (listener sau commit) — đợi tối đa ~10 giây cho đủ loại cần thấy. */
const waitForKinds = async (api, orderId, kinds) => {
  let seen = new Set();
  for (let i = 0; i < 20; i++) {
    const page = await api.notifications.list({ limit: 200 });
    seen = new Set(page.notifications.filter((n) => n.orderId === orderId).map((n) => n.kind));
    if (kinds.every((k) => seen.has(k))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return seen;
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

  let linkId = null;
  let trader;
  try {
    // 1. Đăng nhập, chọn tổ chức
    console.warn('1. Đăng nhập hai tài khoản, chọn tổ chức');
    let farmer;
    try {
      const t = await signIn(traderId, traderPassword);
      const me = await clientFor(t.token, null).me();
      const need = ['order:respond', 'partner:manage', 'book:sync'];
      const m = me.memberships.find((x) => x.organization.type !== 'farmer' && need.every((p) => x.permissions.includes(p)));
      if (!m) throw new Error(`tài khoản này không có tổ chức vựa / DN nào đủ quyền ${need.join(', ')}`);
      trader = { ...t, org: m.organization, api: clientFor(t.token, m.organization.id) };
      pass('Vựa đăng nhập', `${m.organization.name} (${m.organization.type}, ${m.role})`);
    } catch (err) {
      fail('Vựa đăng nhập', describe(err));
      return;
    }
    try {
      const f = await signIn(farmerId, farmerPassword);
      const me = await clientFor(f.token, null).me();
      const m = me.memberships.find((x) => x.organization.type === 'farmer' && x.permissions.includes('order:create'));
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

    // 2. Kết nối mới cho riêng lần chạy này
    console.warn('\n2. Vựa thêm người bán, mời kết nối; nông dân nhập mã');
    const supplierId = randomUUID();
    const sellerName = `Nghiệm thu BE5 ${new Date().toLocaleString('vi-VN')}`;
    const addSupplier = { opId: randomUUID(), seq: 1, entity: 'supplier', kind: 'insert', recordId: supplierId, data: { name: sellerName } };
    if (!contracts.parseSyncOp(addSupplier).ok) {
      fail('Op người bán sai hợp đồng');
      return;
    }
    const added = await trader.api.sync.push({ deviceId: randomUUID(), ops: [addSupplier] });
    check(added.results[0]?.status === 'applied', 'Thêm người bán', added.results[0]?.status);
    const invited = await trader.api.links.invite({ partnerKind: 'supplier', partnerId: supplierId });
    linkId = invited.id;
    const code = invited.inviteCode?.code;
    if (!code) {
      fail('Mời → có mã kết nối');
      return;
    }
    try {
      const claimed = await farmer.api.links.claim({ code: showCode(code).toLowerCase() });
      check(claimed.status === 'active' && claimed.counterpart?.id === trader.org.id, 'Nông dân nhập mã → kết nối active với vựa');
    } catch (err) {
      fail('Nhập mã', describe(err));
      return;
    }

    // 3. Nông dân gửi đơn bán
    console.warn('\n3. Nông dân gửi đơn BÁN cho vựa');
    const note = `${sellerName} — mủ chén, 1 tấn`;
    let order;
    try {
      order = await farmer.api.orders.create({
        role: 'seller',
        counterpartOrgId: trader.org.id,
        crop: 'rubber',
        estQuantity: 1000,
        offeredPrice: 47_940,
        note,
      });
      check(order.status === 'submitted' && order.version === 1 && order.createdByMe, 'Gửi đơn → submitted v1', mask(order.id));
    } catch (err) {
      fail('Gửi đơn', describe(err));
      return;
    }
    const seen = await trader.api.orders.get(order.id);
    check(seen.status === 'submitted' && seen.role === 'buyer' && !seen.createdByMe, 'Vựa thấy đơn, mình là bên mua', seen.counterpart?.name ?? '—');
    check(seen.partnerId === supplierId, 'partnerId = người bán trong sổ vựa (ô "Theo đơn" điền sẵn được)');

    // 4. Vựa nhận, hẹn lịch
    console.warn('\n4. Vựa nhận đơn, hẹn lịch');
    const pickupAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    pickupAt.setSeconds(0, 0);
    try {
      const accepted = await trader.api.orders.accept(order.id, { version: 1 });
      check(accepted.status === 'accepted' && accepted.version === 2, 'Nhận → accepted v2');
      const scheduled = await trader.api.orders.schedule(order.id, {
        version: 2,
        pickupAt: pickupAt.toISOString(),
        pickupAddress: 'Vựa — cân tại chỗ',
      });
      check(scheduled.status === 'scheduled' && scheduled.version === 3, 'Hẹn lịch → scheduled v3', pickupAt.toLocaleString('vi-VN'));
    } catch (err) {
      fail('Nhận / hẹn lịch', describe(err));
      return;
    }
    const farmerSees = await farmer.api.orders.get(order.id);
    check(
      farmerSees.status === 'scheduled' && farmerSees.pickupAt !== null && Date.parse(farmerSees.pickupAt) === pickupAt.getTime(),
      'Nông dân thấy lịch hẹn',
    );

    // 5. Vựa cân, đẩy phiếu theo đơn + một lần trả
    console.warn('\n5. Vựa đẩy phiếu THEO ĐƠN và một lần trả');
    const products = [];
    for (let cursor; ; ) {
      const page = await trader.api.sync.pull(cursor ? { cursor } : {});
      products.push(...page.changes.products);
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    const product = products.find((p) => !p.deletedAt && p.isActive !== false && p.crop === 'rubber') ?? products.find((p) => !p.deletedAt && p.isActive !== false);
    if (!product) {
      fail('Sổ vựa chưa có mặt hàng nào');
      return;
    }
    const extra = { rubberLatex: { qualityPercent: 30 }, netAfterTare: { tareWeight: 2 }, lossPercent: { lossPercent: 1 } }[product.formulaType];
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
    const txId = randomUUID();
    const paid = Math.max(1_000, Math.floor(line.roundedTotal / 3 / 1_000) * 1_000);
    const expected = calc.transactionTotals({ lines: [line], adjustments: [], amountPaid: paid });
    const now = new Date().toISOString();
    const ops = [
      {
        entity: 'transaction',
        kind: 'insert',
        recordId: txId,
        data: { date: now, kind: 'purchase', counterpartyId: supplierId, supplierName: sellerName, lines: [line], orderId: order.id },
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
    const results = pushed.results.map((r) => (r.warning ? `${r.status} (${r.warning})` : r.status));
    check(
      pushed.results.length === 2 && pushed.results.every((r) => r.status === 'applied' && !r.warning),
      'Đẩy phiếu theo đơn + lần trả',
      `${results.join(', ')}${pushed.results.find((r) => r.error) ? ` · lỗi ${pushed.results.find((r) => r.error).error.code}` : ''}`,
    );
    if (failed > 0) return;
    console.warn(`     ${product.name} · ${line.grossWeight} ${line.unit} · tổng ${money(expected.total)} · trả ${money(paid)} · còn nợ ${money(expected.debt)}`);

    const done = await trader.api.orders.get(order.id);
    check(done.status === 'fulfilled' && done.version === 4, 'Đơn tự hoàn thành → fulfilled v4', `${done.status} v${done.version}`);
    const steps = done.events.map((e) => `${e.fromStatus ?? '∅'}→${e.toStatus}:${e.by}`);
    const wantSteps = ['∅→submitted:counterpart', 'submitted→accepted:me', 'accepted→scheduled:me', 'scheduled→fulfilled:me'];
    check(JSON.stringify(steps) === JSON.stringify(wantSteps), 'Lịch sử 4 mốc đúng thứ tự, đúng bên (nhìn từ vựa)', steps.join(' · '));

    // 6. Nông dân thấy đơn hoàn thành và phiếu
    console.warn('\n6. Nông dân xem đơn và phiếu');
    const farmerDone = await farmer.api.orders.get(order.id);
    check(farmerDone.status === 'fulfilled', 'Nông dân thấy đơn đã hoàn thành');
    const receipts = [];
    for (let cursor; ; ) {
      const page = await farmer.api.linked.receipts({ orgId: trader.org.id, ...(cursor ? { cursor } : {}) });
      receipts.push(...page.receipts);
      cursor = page.cursor;
      if (!cursor) break;
    }
    const mine = receipts.find((r) => r.id === txId);
    check(Boolean(mine), 'Thấy phiếu vừa cân');
    if (mine) {
      check(mine.total === expected.total, 'Tổng tiền khớp', `${money(mine.total)} / mong ${money(expected.total)}`);
      check(mine.paid === paid, 'Đã trả khớp', money(mine.paid));
      check(mine.debt === expected.debt, 'Còn nợ khớp', `${money(mine.debt)} / mong ${money(expected.debt)}`);
    }

    // 7. Thông báo (ghi sau commit — đợi một chút)
    console.warn('\n7. Thông báo');
    const traderKinds = await waitForKinds(trader.api, order.id, ['order.submitted']);
    check(traderKinds.has('order.submitted'), 'Vựa có thông báo đơn mới', [...traderKinds].join(', ') || 'không có');
    const farmerWant = ['order.accepted', 'order.scheduled', 'order.fulfilled'];
    const farmerKinds = await waitForKinds(farmer.api, order.id, farmerWant);
    check(farmerWant.every((k) => farmerKinds.has(k)), 'Nông dân có thông báo nhận, hẹn lịch, hoàn thành', [...farmerKinds].join(', ') || 'không có');
    check(!farmerKinds.has('order.submitted'), 'Nông dân không bị báo việc chính mình làm (gửi đơn)');

    // 8. Đơn thứ hai: huỷ, rồi bấm nhận bằng version cũ
    console.warn('\n8. Đơn thứ hai: nông dân huỷ; vựa bấm nhận bằng version cũ');
    try {
      const second = await farmer.api.orders.create({ role: 'seller', counterpartOrgId: trader.org.id, crop: 'rubber', estQuantity: 500, note: `${sellerName} — đơn huỷ` });
      const cancelled = await farmer.api.orders.cancel(second.id, { version: 1 });
      check(cancelled.status === 'cancelled' && cancelled.version === 2, 'Nông dân huỷ → cancelled v2');
      const stale = await expectError(() => trader.api.orders.accept(second.id, { version: 1 }));
      check(stale?.code === 'ORDER_STATE_CHANGED', 'Vựa nhận bằng version cũ → 409 ORDER_STATE_CHANGED', stale ? describe(stale) : 'không lỗi');
      const traderCancelKinds = await waitForKinds(trader.api, second.id, ['order.cancelled']);
      check(traderCancelKinds.has('order.cancelled'), 'Vựa được báo đơn bị huỷ');
    } catch (err) {
      fail('Đơn thứ hai', describe(err));
    }

    console.warn(`\n     Đối chiếu database: đơn ${mask(order.id)}, phiếu ${mask(txId)}, người bán "${sellerName}"`);
  } finally {
    // 9. Dọn kết nối thử, đăng xuất mọi phiên vừa mở
    if (linkId && trader) {
      await trader.api.links.revoke(linkId).then(
        () => console.warn('\n9. Đã huỷ kết nối thử'),
        (err) => fail('Huỷ kết nối thử', describe(err)),
      );
    }
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
