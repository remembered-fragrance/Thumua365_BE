import { describe, expect, it } from 'vitest';
import { emptyData, normalize } from '../src/normalize';
import { normalizeTransaction } from '../src/normalizeTransaction';
import { DEFAULT_PRODUCTS } from '../src/catalog';

// ─── Ảnh chụp dữ liệu thật của ba đời định dạng ─────────────────────────────

const V1_TX = {
  id: 'tx-v1',
  date: '2026-08-01T02:00:00.000Z',
  supplierId: 'sup-1',
  supplierName: 'Cô Lê Thị Mai',
  crop: 'cashew',
  grossWeight: 300,
  deductionPercent: 10,
  pricePerKg: 28_000,
  amountPaid: 5_000_000,
};

const V2_TX = {
  id: 'tx-v2',
  date: '2026-08-02T02:00:00.000Z',
  supplierId: 'sup-1',
  supplierName: 'Cô Lê Thị Mai',
  lines: [
    {
      id: 'line-1',
      productName: 'Cao su',
      unit: 'kg',
      formulaType: 'rubberLatex',
      grossWeight: 320,
      qualityPercent: 31,
      pricePerKg: 14_500,
    },
  ],
  amountPaid: 1_000_000,
  note: 'trả tiếp cuối tuần',
};

const V3_TX = {
  ...V2_TX,
  id: 'tx-v3',
  kind: 'sale',
  counterpartyId: 'buy-1',
  payments: [
    { id: 'pay-1', date: '2026-08-02T02:00:00.000Z', amount: 600_000 },
    { id: 'pay-2', date: '2026-08-05T02:00:00.000Z', amount: 400_000, note: 'trả nốt' },
  ],
  adjustments: [{ id: 'adj-1', kind: 'logistics', label: 'Phí xe đến lấy', amount: -50_000 }],
  creditTerms: [{ dueDate: '2026-08-10T02:00:00.000Z', amount: 400_000 }],
  attachmentIds: ['att-1', 'att-2'],
};

describe('L1 — không bao giờ tự gieo dữ liệu mẫu', () => {
  it('sổ chưa có gì → 0 giao dịch, 0 nông hộ', () => {
    const d = normalize(null);
    expect(d.transactions).toEqual([]);
    expect(d.suppliers).toEqual([]);
    expect(d.buyers).toEqual([]);
    expect(d.notes).toEqual([]);
  });

  it('dữ liệu hỏng vẫn ra sổ rỗng, không dựng số giả', () => {
    expect(normalize('{{hỏng')).toEqual(emptyData());
    expect(normalize(42)).toEqual(emptyData());
  });

  it('sổ rỗng vẫn có sẵn bốn mặt hàng gợi ý', () => {
    expect(normalize(null).products.map((p) => p.id)).toEqual(
      DEFAULT_PRODUCTS.map((p) => p.id),
    );
  });
});

describe('migrate v1 — phiếu một dòng, trừ bì theo phần trăm', () => {
  const t = normalizeTransaction(V1_TX);

  it('sinh đúng một dòng hàng, giữ nguyên số cân', () => {
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]?.grossWeight).toBe(300);
  });

  it('đổi 10% hao thành số kg bì cụ thể', () => {
    expect(t.lines[0]?.formulaType).toBe('netAfterTare');
    expect(t.lines[0]?.tareWeight).toBe(30);
  });

  it('giữ đơn giá cũ ghi ở pricePerKg', () => {
    expect(t.lines[0]?.pricePerUnit).toBe(28_000);
  });

  it('phiếu cũ mặc định là phiếu MUA', () => {
    expect(t.kind).toBe('purchase');
    expect(t.counterpartyId).toBe('sup-1');
  });
});

describe('migrate v2 — phiếu chưa có lịch sử trả tiền', () => {
  const t = normalizeTransaction(V2_TX);

  it('sinh đúng MỘT lần trả bằng số đã trả cũ', () => {
    expect(t.payments).toHaveLength(1);
    expect(t.payments[0]?.amount).toBe(1_000_000);
    expect(t.payments[0]?.date).toBe(V2_TX.date);
  });

  it('đã trả bằng tổng các lần trả', () => {
    expect(t.amountPaid).toBe(1_000_000);
  });

  it('phiếu chưa trả đồng nào thì không sinh lần trả rỗng', () => {
    expect(normalizeTransaction({ ...V2_TX, amountPaid: 0 }).payments).toEqual([]);
  });

  it('giữ ghi chú và đóng băng tiền của dòng', () => {
    expect(t.note).toBe('trả tiếp cuối tuần');
    expect(t.lines[0]?.roundedTotal).toBe(1_438_000);
  });
});

describe('v3 — đọc lại KHÔNG được làm mất field nào', () => {
  const t = normalizeTransaction(V3_TX);

  it('giữ nguyên cả hai lần trả tiền', () => {
    expect(t.payments.map((p) => p.amount)).toEqual([600_000, 400_000]);
    expect(t.payments[1]?.note).toBe('trả nốt');
  });

  it('đã trả được tính lại từ các lần trả, không lấy số cũ', () => {
    expect(t.amountPaid).toBe(1_000_000);
  });

  it('giữ chiều giao dịch, đối tác, khoản cộng/trừ, kỳ hạn, ảnh chứng từ', () => {
    expect(t.kind).toBe('sale');
    expect(t.counterpartyId).toBe('buy-1');
    expect(t.adjustments).toHaveLength(1);
    expect(t.creditTerms).toEqual([{ dueDate: '2026-08-10T02:00:00.000Z', amount: 400_000 }]);
    expect(t.attachmentIds).toEqual(['att-1', 'att-2']);
  });

  it('chuẩn hoá hai lần cho kết quả y hệt (mở app lần thứ n không mất gì)', () => {
    const once = normalizeTransaction(V3_TX);
    const twice = normalizeTransaction(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it('khoản cộng/trừ lạ được quy về "điều chỉnh tay" thay vì làm hỏng phiếu', () => {
    const weird = normalizeTransaction({
      ...V3_TX,
      adjustments: [{ id: 'x', kind: 'không-biết', label: 'Lạ', amount: 1_000 }],
    });
    expect(weird.adjustments?.[0]?.kind).toBe('manual');
  });
});

describe('normalize toàn sổ — đi một vòng không rơi rớt', () => {
  const raw = {
    suppliers: [{ id: 'sup-1', name: ' Cô Lê Thị Mai ', phone: '0905112233' }],
    buyers: [{ id: 'buy-1', name: 'Nhà máy Bình Long' }],
    products: [{ id: 'prod-rubber', name: 'Cao su', unit: 'kg', formulaType: 'rubberLatex', lastPricePerUnit: 14_500 }],
    transactions: [V1_TX, V2_TX, V3_TX],
    drafts: [{ id: 'draft-1', status: 'waiting', supplierName: 'Chú Bảy', lines: [], amountPaid: 0 }],
    notes: [{ id: 'note-1', body: 'Gọi cô Mai', pinned: true, done: false }],
    settings: { defaultWeightUnit: 'hg', displayMode: 'outdoor' },
    pricingRules: [{ id: 'r1', name: 'Phí xe', kind: 'logistics', active: true, fixedAmount: -50_000 }],
  };

  const first = normalize(raw);
  const second = normalize(JSON.parse(JSON.stringify(first)));

  it('đủ ba phiếu của cả ba đời định dạng', () => {
    expect(first.transactions.map((t) => t.id)).toEqual(['tx-v1', 'tx-v2', 'tx-v3']);
  });

  it('cắt khoảng trắng thừa trong tên người bán', () => {
    expect(first.suppliers[0]?.name).toBe('Cô Lê Thị Mai');
  });

  it('giữ cài đặt người dùng đã chọn', () => {
    expect(first.settings).toEqual({ defaultWeightUnit: 'hg', displayMode: 'outdoor' });
  });

  it('giữ nháp, ghi chú và quy tắc giá', () => {
    expect(first.drafts[0]?.status).toBe('waiting');
    expect(first.notes[0]?.pinned).toBe(true);
    expect(first.pricingRules).toHaveLength(1);
  });

  it('nhớ giá lần trước của mặt hàng', () => {
    expect(first.products.find((p) => p.id === 'prod-rubber')?.lastPricePerUnit).toBe(14_500);
  });

  it('chạy lại lần hai không đổi gì — đây là điều kiện để dám viết lại tầng dữ liệu', () => {
    expect(second).toEqual(first);
  });
});
