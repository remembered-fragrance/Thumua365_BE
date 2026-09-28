/**
 * Trang thử ĐỒNG BỘ SỔ — nghiệm thu BE3: "hai máy, một máy mất mạng, ghi phiếu + trả nợ + huỷ lần
 * trả → sau khi đồng bộ khớp từng đồng". Cũng là VÍ DỤ cho frontend:
 *
 *   1. Ghi cục bộ TRƯỚC, rồi thêm op vào hàng đợi (op kiểm bằng `parseSyncOp` trước khi vào).
 *   2. Đồng bộ: `sdk.sync.push` theo `seq`, tối đa SYNC_PUSH_MAX_OPS op một lô → xoá op
 *      applied/duplicate, dừng ở op rejected; rồi `sdk.sync.pull` theo cursor tới hasMore = false.
 *   3. Hợp nhất theo id; bản ghi còn op trong hàng đợi thì giữ bản cục bộ.
 *   4. Số đã trả của phiếu = tổng các lần trả chưa huỷ; tổng phiếu tính bằng @mambo/core/calc.
 *
 * "Máy": `?may=A` / `?may=B` — mỗi máy một sổ, một hàng đợi, một deviceId, một cursor (localStorage),
 * để thử hai máy ngay trên một trình duyệt. "Mất mạng": ô trên trang, hoặc tắt mạng thật.
 * Đơn giản hoá app thật (sổ nằm trong localStorage, không IndexedDB); phần đồng bộ thì đúng hợp đồng.
 */

import { createClient as createSupabase } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
import { freezeLineTotals, transactionTotals } from '@mambo/core/calc';
import { normalizePhone } from '@mambo/core/identifier';
import { isRetryable, parseSyncOp, SYNC_PUSH_MAX_OPS } from '@mambo/contracts';
import { ApiError, createClient } from '@mambo/sdk';

const CONFIG_KEY = 'thumua365-login-test'; // cùng cấu hình với trang đăng nhập
const DEFAULTS = {
  apiUrl: 'https://thumua365-api-staging.onrender.com',
  supabaseUrl: 'https://bldlrkmszjmhifubxjvl.supabase.co',
  publishableKey: '',
};
const SLOT = (new URLSearchParams(location.search).get('may') ?? 'A').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'A';
const EXTRA_LABEL = { rubberLatex: 'Hàm lượng (%)', netAfterTare: 'Bì (kg)', lossPercent: 'Hao hụt (%)' };

const $ = (id) => document.getElementById(id);
const money = (n) => `${Math.round(n).toLocaleString('vi-VN')}đ`;
const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Trình duyệt chặn lưu — trang vẫn chạy cho lần mở này.
  }
};

const config = { ...DEFAULTS, ...readJson(CONFIG_KEY, {}) };
const deviceKey = `thumua365-sync:${SLOT}:device`;
/** Sinh MỘT lần cho mỗi máy. */
const deviceId = readJson(deviceKey, null) ?? crypto.randomUUID();
writeJson(deviceKey, deviceId);
const offlineKey = `thumua365-sync:${SLOT}:offline`;

let supabase = null;
let api = null;
let orgId = null;
let memberships = [];
/** Sổ + hàng đợi + cursor của (máy, tổ chức). */
let state = null;

const emptyBook = () => ({ suppliers: {}, buyers: {}, products: {}, pricingRules: {}, notes: {}, drafts: {}, transactions: {}, payments: {} });
const bookKey = () => `thumua365-sync:${SLOT}:${orgId}`;
const loadState = () => {
  state = { seq: 0, queue: [], cursor: null, lastSyncedAt: null, book: emptyBook(), ...readJson(bookKey(), {}) };
};
const save = () => writeJson(bookKey(), state);
const isOffline = () => $('offline').checked;

// ─── Hiển thị ────────────────────────────────────────────────────────────────

const say = (text, tone = 'info') => {
  $('message').textContent = text;
  $('message').dataset.tone = tone;
};

const explain = (err) => {
  if (err instanceof ApiError) {
    return `${err.code} (HTTP ${err.status}) — ${err.message}${err.requestId ? ` · requestId ${err.requestId}` : ''}`;
  }
  if (err instanceof TypeError) return 'Không gọi được API (mất mạng thật?) — hàng đợi vẫn giữ nguyên.';
  return err instanceof Error ? err.message : String(err);
};

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const live = (records) => Object.values(records).filter((r) => r.deletedAt === null);
const paymentsOf = (txId) => live(state.book.payments).filter((p) => p.transactionId === txId);
const totalsOf = (tx) => {
  const paid = paymentsOf(tx.id).reduce((s, p) => s + p.amount, 0);
  return transactionTotals({ lines: tx.lines, adjustments: tx.adjustments ?? undefined, amountPaid: paid });
};

/** FNV-1a — chỉ để hai máy so bằng mắt. */
const fingerprint = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

const render = () => {
  const m = memberships.find((x) => x.organization.id === orgId);
  for (const id of ['book-box', 'new-receipt', 'totals-box', 'receipts-box']) $(id).hidden = !m;
  if (!m) return;

  const pending = new Set(state.queue.map((op) => op.recordId));
  const stuck = state.queue.find((op) => op.conflict);
  $('device').textContent = `Máy ${SLOT} · deviceId ${deviceId.slice(0, 8)}… · ${m.role} · cursor: ${state.cursor ? 'đã có' : 'chưa kéo lần nào'}`;
  $('queue').replaceChildren(
    `Hàng đợi: ${state.queue.length} op chờ gửi${state.lastSyncedAt ? ` · đồng bộ lần cuối ${new Date(state.lastSyncedAt).toLocaleTimeString('vi-VN')}` : ''}`,
    ...(stuck
      ? [
          el('br'),
          el('strong', { textContent: `Kẹt: ${stuck.entity} ${stuck.kind} → ${stuck.conflict.code}: ${stuck.conflict.message}. ` }),
          el('button', { type: 'button', className: 'secondary', textContent: 'Bỏ op bị từ chối', onclick: dropStuck }),
        ]
      : []),
  );

  // Mặt hàng
  const products = live(state.book.products).filter((p) => p.isActive).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const chosen = $('r-product').value;
  $('r-product').replaceChildren(
    ...(products.length === 0
      ? [new Option(syncing ? 'Đang kéo mặt hàng từ server…' : 'Chưa có mặt hàng — bấm "Đồng bộ" để kéo từ server', '')]
      : products.map((p) => new Option(`${p.name} · ${p.formulaType}`, p.id))),
  );
  if (products.some((p) => p.id === chosen)) $('r-product').value = chosen;
  $('receipt-btn').disabled = products.length === 0;
  renderExtra();

  renderParties();

  // Phiếu
  const txs = live(state.book.transactions).sort((a, b) => b.date.localeCompare(a.date));
  $('receipts').replaceChildren(
    ...(txs.length === 0 ? [el('p', { className: 'hint', textContent: 'Chưa có phiếu.' })] : []),
    ...txs.map((tx) => {
      const t = totalsOf(tx);
      const badge = pending.has(tx.id) ? ' · ⏳ chờ gửi' : '';
      return el(
        'div',
        { className: 'receipt' },
        el('p', {}, el('strong', { textContent: `${tx.supplierName} · ${tx.lines.map((l) => l.productName).join(', ')}` }), badge),
        el('p', { className: 'hint', textContent: `${new Date(tx.date).toLocaleString('vi-VN')} · tổng ${money(t.total)} · đã trả ${money(t.total - t.debt)} · còn nợ ${money(t.debt)}` }),
        ...paymentsOf(tx.id).map((p) =>
          el(
            'p',
            { className: 'payment' },
            `Trả ${money(p.amount)}${pending.has(p.id) ? ' ⏳' : ''} `,
            el('button', { type: 'button', className: 'secondary', textContent: 'Huỷ lần trả', onclick: () => voidPayment(p.id) }),
          ),
        ),
        el(
          'div',
          { className: 'row' },
          el('button', { type: 'button', className: 'secondary', textContent: 'Trả tiền', onclick: () => payPrompt(tx.id) }),
          el('button', { type: 'button', className: 'secondary', textContent: 'Xoá phiếu', onclick: () => deleteReceipt(tx.id) }),
        ),
      );
    }),
  );

  // Tổng + dấu sổ
  const rows = txs.map((tx) => ({ tx, t: totalsOf(tx) })).sort((a, b) => a.tx.id.localeCompare(b.tx.id));
  const sum = (f) => rows.reduce((s, r) => s + f(r.t), 0);
  // Chỉ đếm lần trả của phiếu còn hiệu lực — lần trả của phiếu đã xoá vẫn lưu nhưng không hiện.
  const voided = Object.values(state.book.payments).filter(
    (p) => p.deletedAt !== null && state.book.transactions[p.transactionId]?.deletedAt === null,
  ).length;
  const print = fingerprint(rows.map((r) => `${r.tx.id}:${r.t.total}:${r.t.debt}`).join('|') + `#${paymentsCount()}`);
  $('totals').textContent = [
    `Phiếu: ${rows.length} · Lần trả còn hiệu lực: ${paymentsCount()} · đã huỷ: ${voided}`,
    `Tổng: ${money(sum((t) => t.total))} · Đã trả: ${money(sum((t) => t.total - t.debt))} · Còn nợ: ${money(sum((t) => t.debt))}`,
    `Dấu sổ: ${print}${state.queue.length > 0 ? '  (còn op chờ gửi — chưa so được)' : ''}`,
  ].join('\n');
};

const paymentsCount = () => live(state.book.payments).filter((p) => state.book.transactions[p.transactionId]?.deletedAt === null).length;

const renderExtra = () => {
  const product = state.book.products[$('r-product').value];
  const label = EXTRA_LABEL[product?.formulaType];
  $('r-extra-label').hidden = !label;
  if (label) $('r-extra-label').firstChild.textContent = `${label} `;
};

// ─── Ghi cục bộ + hàng đợi ───────────────────────────────────────────────────

const enqueue = (entity, kind, recordId, data) => {
  const op = { opId: crypto.randomUUID(), seq: state.seq + 1, entity, kind, recordId, ...(data === undefined ? {} : { data }) };
  const check = parseSyncOp(op);
  if (!check.ok) throw new Error(`Op sai hợp đồng: ${JSON.stringify(check.fields)}`);
  state.seq = op.seq;
  state.queue.push(op);
};

const localMeta = (id) => {
  const now = new Date().toISOString();
  return { id, createdBy: 'máy này', createdAt: now, updatedAt: now, deletedAt: null };
};

const addPayment = (transactionId, amount) => {
  const id = crypto.randomUUID();
  const data = { transactionId, date: new Date().toISOString(), amount };
  enqueue('payment', 'insert', id, data);
  state.book.payments[id] = { ...localMeta(id), ...data, note: null };
};

const commit = (message) => {
  save();
  render();
  say(`${message} — đã ghi trên máy ${SLOT}, ${state.queue.length} op chờ gửi.`, 'ok');
  if (!isOffline()) void sync();
};

const digits = (id) => Number($(id).value.replace(/\D/g, ''));
const decimal = (id) => Number($(id).value.replace(',', '.'));

$('receipt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const product = state.book.products[$('r-product').value];
  if (!product) return say('Chưa có mặt hàng — bấm "Đồng bộ" để lấy mặt hàng từ server.', 'error');
  const weight = decimal('r-weight');
  const extra = decimal('r-extra') || 0;
  const price = digits('r-price');
  const paid = $('r-paid').value.trim() ? digits('r-paid') : 0;
  if (!(weight > 0) || !(price >= 0)) return say('Khối lượng, đơn giá chưa đúng.', 'error');

  const line = freezeLineTotals({
    id: crypto.randomUUID(),
    productId: product.id,
    productName: product.name,
    unit: product.unit,
    formulaType: product.formulaType,
    ...(product.crop ? { crop: product.crop } : {}),
    grossWeight: weight,
    ...(product.formulaType === 'rubberLatex' ? { qualityPercent: extra } : {}),
    ...(product.formulaType === 'netAfterTare' ? { tareWeight: extra } : {}),
    ...(product.formulaType === 'lossPercent' ? { lossPercent: extra } : {}),
    pricePerUnit: price,
  });
  const txId = crypto.randomUUID();
  const sellerName = $('r-seller').value.trim() || 'Khách lẻ';
  const rawPhone = $('r-phone').value.trim();
  if (rawPhone && !normalizePhone(rawPhone)) return say('Số điện thoại người bán chưa đúng.', 'error');
  const data = { date: new Date().toISOString(), kind: 'purchase', counterpartyId: null, supplierName: sellerName, lines: [line] };

  try {
    // Như derivedOps của app: việc phụ (người bán mới, giá gần nhất) trước, phiếu sau, lần trả cuối.
    if (sellerName !== 'Khách lẻ') data.counterpartyId = supplierFor(sellerName, rawPhone);
    if (price !== product.lastPricePerUnit) {
      enqueue('product', 'update', product.id, { lastPricePerUnit: price });
      product.lastPricePerUnit = price;
    }
    enqueue('transaction', 'insert', txId, data);
    state.book.transactions[txId] = { ...localMeta(txId), ...data, supplierId: null, creditTerms: null, adjustments: null, attachmentIds: [], note: null, branchId: null };
    if (paid > 0) addPayment(txId, paid);
  } catch (err) {
    return say(explain(err), 'error');
  }
  $('r-paid').value = '';
  $('r-phone').value = '';
  commit(`Lập phiếu ${money(line.roundedTotal)}`);
});

/** Người bán cùng tên (không phân biệt hoa thường) thì dùng lại; chưa có thì tạo — op `supplier insert`. */
const supplierFor = (name, phone) => {
  const found = live(state.book.suppliers).find((sp) => sp.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const id = crypto.randomUUID();
  const data = { name, ...(phone ? { phone } : {}) };
  enqueue('supplier', 'insert', id, data);
  state.book.suppliers[id] = { ...localMeta(id), name, phone: phone || null, location: null, note: null };
  return id;
};

/** Trạng thái kết nối của từng người bán — lấy từ `sdk.links.list()` sau mỗi lần đồng bộ. */
let linksByPartner = new Map();

const refreshLinks = async () => {
  try {
    const { links } = await api.links.list();
    linksByPartner = new Map(links.filter((l) => l.side === 'owner').map((l) => [l.partner.id, l]));
  } catch {
    linksByPartner = new Map(); // người cân không có quyền xem kết nối — bỏ qua
  }
};

const invite = async (partnerId) => {
  try {
    const link = await api.links.invite({ partnerKind: 'supplier', partnerId });
    linksByPartner.set(partnerId, link);
    say(`Đã mời — chờ ${link.invitedPhone} xác thực số và đồng ý.`, 'ok');
  } catch (err) {
    say(explain(err), 'error');
  }
  render();
};

const renderParties = () => {
  const suppliers = live(state.book.suppliers).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  $('parties-box').hidden = suppliers.length === 0;
  const pending = new Set(state.queue.map((op) => op.recordId));
  $('parties').replaceChildren(
    ...suppliers.map((sp) => {
      const link = linksByPartner.get(sp.id);
      const status = link
        ? { pending: link.counterpart ? `chờ ${link.counterpart.name} đồng ý` : 'đã mời, chờ nhận', active: `đã kết nối với ${link.counterpart?.name}`, revoked: 'đã huỷ' }[link.status]
        : 'chưa kết nối';
      const canInvite = sp.phone && !pending.has(sp.id) && (!link || link.status === 'revoked');
      return el(
        'p',
        { className: 'payment' },
        `${sp.name}${sp.phone ? ` · ${sp.phone}` : ''} · ${status} `,
        ...(canInvite ? [el('button', { type: 'button', className: 'secondary', textContent: 'Mời kết nối', onclick: () => invite(sp.id) })] : []),
      );
    }),
  );
};

const payPrompt = (txId) => {
  const amount = Number((prompt('Trả bao nhiêu (đồng)?') ?? '').replace(/\D/g, ''));
  if (!(amount > 0)) return;
  addPayment(txId, amount);
  commit(`Trả ${money(amount)}`);
};

const voidPayment = (id) => {
  enqueue('payment', 'softDelete', id);
  state.book.payments[id].deletedAt = new Date().toISOString();
  commit('Huỷ lần trả');
};

const deleteReceipt = (id) => {
  enqueue('transaction', 'softDelete', id);
  state.book.transactions[id].deletedAt = new Date().toISOString();
  commit('Xoá phiếu');
};

function dropStuck() {
  state.queue = state.queue.filter((op) => !op.conflict);
  save();
  render();
  say('Đã bỏ op bị từ chối. Sổ máy này có thể lệch — "Xoá sổ của máy này" rồi đồng bộ để kéo lại.', 'error');
}

// ─── Đồng bộ ─────────────────────────────────────────────────────────────────

/** Hợp nhất theo id. Giữ cả bản ghi đã xoá (deletedAt) — phần hiển thị tự bỏ qua. */
const merge = (changes) => {
  const pending = new Set(state.queue.map((op) => op.recordId));
  let n = 0;
  for (const [key, records] of Object.entries(changes)) {
    for (const record of records) {
      if (pending.has(record.id)) continue; // còn op chưa gửi → giữ bản cục bộ
      state.book[key][record.id] = record;
      n++;
    }
  }
  return n;
};

/** Op gửi đi đúng hợp đồng — bỏ dấu `conflict` chỉ máy này dùng. */
const toWire = (op) => ({
  opId: op.opId,
  seq: op.seq,
  entity: op.entity,
  kind: op.kind,
  recordId: op.recordId,
  ...(op.data === undefined ? {} : { data: op.data }),
});

let syncing = false;
const sync = async () => {
  if (syncing) return;
  if (isOffline()) return say('Máy đang mất mạng — thao tác nằm trong hàng đợi. Bỏ đánh dấu rồi bấm "Đồng bộ".', 'error');
  syncing = true;
  $('sync-btn').disabled = true;
  render();
  const log = { pushed: [], pulledPages: 0, merged: 0 };
  try {
    // Đẩy — lô theo seq, dừng ở op kẹt.
    for (;;) {
      const batch = [];
      for (const op of state.queue) {
        if (op.conflict || batch.length === SYNC_PUSH_MAX_OPS) break;
        batch.push(op);
      }
      if (batch.length === 0) break;
      const { results } = await api.sync.push({ deviceId, ops: batch.map(toWire) });
      log.pushed.push(...results);
      let stop = results.length < batch.length;
      for (const r of results) {
        if (r.status !== 'rejected') {
          state.queue = state.queue.filter((op) => op.opId !== r.opId);
          continue;
        }
        stop = true;
        // Thử lại được (PARENT_MISSING, RATE_LIMITED, INTERNAL) thì giữ nguyên; không thì đánh dấu kẹt.
        if (!isRetryable(r.error.code)) state.queue.find((op) => op.opId === r.opId).conflict = r.error;
      }
      save();
      if (stop) break;
    }

    // Kéo — tới khi hasMore = false.
    for (let page = 0; page < 200; page++) {
      const res = await api.sync.pull(state.cursor ? { cursor: state.cursor } : {});
      log.pulledPages++;
      if (res.resetRequired) {
        if (state.queue.length > 0) {
          say('Server yêu cầu kéo lại từ đầu nhưng hàng đợi chưa xả hết — đồng bộ lại sau.', 'error');
          break;
        }
        state.book = emptyBook();
        state.cursor = res.cursor;
        save();
        continue;
      }
      log.merged += merge(res.changes);
      state.cursor = res.cursor;
      save();
      if (!res.hasMore) break;
    }
    state.lastSyncedAt = new Date().toISOString();
    save();
    await refreshLinks();
    const warnings = log.pushed.filter((r) => r.warning).map((r) => r.warning);
    const rejected = log.pushed.find((r) => r.status === 'rejected');
    say(
      rejected
        ? `Đồng bộ dừng ở op bị từ chối: ${rejected.error.code} — ${rejected.error.message}`
        : `Đồng bộ xong: đẩy ${log.pushed.length} op, kéo ${log.pulledPages} trang (${log.merged} bản ghi)${warnings.length ? ` · cảnh báo: ${warnings.join(', ')}` : ''}.`,
      rejected ? 'error' : 'ok',
    );
    $('result').textContent = JSON.stringify(log.pushed, null, 2);
    $('result-box').hidden = log.pushed.length === 0;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'PLAN_EXPIRED') say('Gói hết hạn — hàng đợi giữ nguyên, không tính lần thử.', 'error');
    else say(explain(err), 'error');
  } finally {
    syncing = false;
    $('sync-btn').disabled = false;
    render();
  }
};

// ─── Khởi tạo ────────────────────────────────────────────────────────────────

/** Mở sổ của tổ chức; có mạng thì đồng bộ ngay — mặt hàng, phiếu của máy khác về luôn. */
const selectOrg = (id) => {
  orgId = id;
  loadState();
  render();
  if (!isOffline()) void sync();
};

const init = async () => {
  $('slot').textContent = `máy ${SLOT}`;
  document.title = `Máy ${SLOT} · thử đồng bộ sổ`;
  $('other-slot').href = `/sync.html?may=${SLOT === 'A' ? 'B' : 'A'}`;
  $('other-slot').target = '_blank';
  $('offline').checked = readJson(offlineKey, false);

  api = createClient({
    baseUrl: config.apiUrl.replace(/\/+$/, ''),
    getAccessToken: async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null,
    getOrganizationId: () => orgId,
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
    $('need-login').hidden = false;
    return say('Chưa có cấu hình — mở trang đăng nhập, điền publishable key, đăng nhập rồi quay lại.', 'error');
  }
  supabase = createSupabase(config.supabaseUrl, config.publishableKey);
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    $('need-login').hidden = false;
    return;
  }

  try {
    const me = await api.me();
    memberships = me.memberships.filter((m) => m.permissions.includes('book:sync'));
  } catch (err) {
    return say(explain(err), 'error');
  }
  if (memberships.length === 0) return say('Tài khoản này không có tổ chức nào có sổ (vựa / doanh nghiệp).', 'error');

  $('org-select').replaceChildren(
    ...memberships.map((m) => new Option(`${m.organization.name} · ${m.organization.type} · ${m.role}`, m.organization.id)),
  );
  selectOrg(memberships[0].organization.id);
};

$('org-select').addEventListener('change', () => selectOrg($('org-select').value));
$('r-product').addEventListener('change', renderExtra);
$('sync-btn').addEventListener('click', () => void sync());
$('offline').addEventListener('change', () => {
  writeJson(offlineKey, isOffline());
  say(isOffline() ? `Máy ${SLOT} mất mạng — ghi gì cũng chỉ vào hàng đợi.` : `Máy ${SLOT} có mạng lại — bấm "Đồng bộ".`, 'ok');
});
$('reset-btn').addEventListener('click', () => {
  if (state.queue.length > 0 && !confirm(`Còn ${state.queue.length} op chưa gửi — xoá là mất chúng. Tiếp tục?`)) return;
  localStorage.removeItem(bookKey());
  loadState();
  render();
  say(`Đã xoá sổ của máy ${SLOT}. Bấm "Đồng bộ" để kéo lại từ server.`, 'ok');
});

void init();
