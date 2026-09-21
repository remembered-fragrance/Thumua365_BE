/**
 * Sổ mẫu cho CHẾ ĐỘ TRÌNH DIỄN.
 *
 * 🔴 Lỗi chặn L1 nói: sổ mới phải rỗng. File này không mâu thuẫn với điều đó —
 * nó chỉ chạy khi người dùng chủ động bấm "Xem thử dữ liệu mẫu", và màn hình
 * luôn kèm banner + nút "Xoá hết, bắt đầu thật". Không được gọi từ đường đọc
 * dữ liệu (`normalize`, `readBook`) trong bất kỳ hoàn cảnh nào.
 *
 * Số liệu chọn sao cho vừa vặn một buổi trình diễn tại điểm thu mua (CP4 §10):
 * có nợ, có nợ quá hạn, có phiếu bán, có tồn kho, có một mặt hàng tồn âm để
 * cho thấy app bắt được lỗi nhập sai.
 */

import { freezeLineTotals } from './calc';
import { DEFAULT_PRODUCTS } from './catalog';
import { newId } from './id';
import { defaultSettings } from './normalize';
import type {
  AppData,
  Buyer,
  ProductFormulaType,
  Supplier,
  Transaction,
  TransactionLine,
} from './types';

const DAY_MS = 86_400_000;

const daysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString();
const inDays = (n: number): string => new Date(Date.now() + n * DAY_MS).toISOString();

interface LineSpec {
  readonly productId: string;
  readonly productName: string;
  readonly formulaType: ProductFormulaType;
  readonly grossWeight: number;
  readonly pricePerUnit: number;
  readonly qualityPercent?: number;
  readonly tareWeight?: number;
}

const line = (spec: LineSpec): TransactionLine =>
  freezeLineTotals({
    id: newId(),
    productId: spec.productId,
    productName: spec.productName,
    unit: 'kg',
    formulaType: spec.formulaType,
    grossWeight: spec.grossWeight,
    pricePerUnit: spec.pricePerUnit,
    qualityPercent: spec.qualityPercent,
    tareWeight: spec.tareWeight,
  });

interface TxSpec {
  readonly party: Supplier | Buyer;
  readonly kind: 'purchase' | 'sale';
  readonly daysAgo: number;
  readonly lines: readonly LineSpec[];
  /** Tỷ lệ đã trả: 1 = trả đủ, 0 = ghi nợ hết. */
  readonly paidRatio: number;
  /** Có hẹn ngày trả thì ghi số ngày kể từ hôm nay (âm = đã quá hạn). */
  readonly dueInDays?: number;
}

const transaction = (spec: TxSpec): Transaction => {
  const lines = spec.lines.map(line);
  const total = lines.reduce((sum, l) => sum + (l.roundedTotal ?? 0), 0);
  const amountPaid = Math.round((total * spec.paidRatio) / 1000) * 1000;
  const date = daysAgo(spec.daysAgo);

  return {
    id: newId(),
    date,
    supplierId: spec.party.id,
    counterpartyId: spec.party.id,
    supplierName: spec.party.name,
    kind: spec.kind,
    lines,
    amountPaid,
    payments:
      amountPaid > 0 ? [{ id: newId(), date, amount: amountPaid }] : [],
    creditTerms:
      spec.dueInDays === undefined || amountPaid >= total
        ? undefined
        : [{ dueDate: inDays(spec.dueInDays), amount: total - amountPaid }],
    syncState: 'synced',
  };
};

const supplier = (name: string, phone: string, location: string): Supplier => ({
  id: newId(),
  name,
  phone,
  location,
});

/**
 * Sổ mẫu mới mỗi lần gọi (id sinh ngẫu nhiên, ngày tính từ hôm nay). Trả về
 * `AppData` hoàn chỉnh để tầng dữ liệu nạp thẳng qua `importData`.
 */
export const demoBook = (): AppData => {
  const mai = supplier('Cô Mai', '0912345678', 'Ấp 3, Lộc Ninh');
  const bay = supplier('Chú Bảy', '0987654321', 'Ấp 1, Lộc Hưng');
  const tuan = supplier('Anh Tuấn', '0905112233', 'Thị trấn Lộc Ninh');
  const sau = supplier('Bà Sáu', '0933221144', 'Ấp 5, Lộc Thái');

  const factory: Buyer = {
    id: newId(),
    name: 'Nhà máy Phước Hoà',
    phone: '0271388999',
    location: 'KCN Phước Hoà',
  };
  const agency: Buyer = { id: newId(), name: 'Đại lý Bình Long', phone: '0918776655' };

  const rubber = { productId: 'prod-rubber', productName: 'Cao su', formulaType: 'rubberLatex' as const };
  const cashew = { productId: 'prod-cashew', productName: 'Điều', formulaType: 'netAfterTare' as const };
  const coffee = { productId: 'prod-coffee', productName: 'Cà phê', formulaType: 'netAfterTare' as const };

  const transactions: Transaction[] = [
    transaction({
      party: mai,
      kind: 'purchase',
      daysAgo: 0,
      paidRatio: 1,
      lines: [{ ...rubber, grossWeight: 320, qualityPercent: 31, pricePerUnit: 14_500 }],
    }),
    transaction({
      party: bay,
      kind: 'purchase',
      daysAgo: 0,
      paidRatio: 0.5,
      dueInDays: 5,
      lines: [{ ...cashew, grossWeight: 180, tareWeight: 4, pricePerUnit: 28_000 }],
    }),
    transaction({
      party: tuan,
      kind: 'purchase',
      daysAgo: 2,
      paidRatio: 1,
      lines: [{ ...coffee, grossWeight: 240, tareWeight: 6, pricePerUnit: 42_000 }],
    }),
    transaction({
      party: sau,
      kind: 'purchase',
      daysAgo: 4,
      paidRatio: 0,
      dueInDays: -3,
      lines: [{ ...rubber, grossWeight: 410, qualityPercent: 29, pricePerUnit: 14_200 }],
    }),
    transaction({
      party: mai,
      kind: 'purchase',
      daysAgo: 6,
      paidRatio: 1,
      lines: [{ ...rubber, grossWeight: 275, qualityPercent: 32, pricePerUnit: 14_800 }],
    }),
    transaction({
      party: bay,
      kind: 'purchase',
      daysAgo: 8,
      paidRatio: 1,
      lines: [
        { ...cashew, grossWeight: 95, tareWeight: 2, pricePerUnit: 27_500 },
        { ...coffee, grossWeight: 60, pricePerUnit: 41_000 },
      ],
    }),
    transaction({
      party: tuan,
      kind: 'purchase',
      daysAgo: 11,
      paidRatio: 0.7,
      dueInDays: -1,
      lines: [{ ...coffee, grossWeight: 310, tareWeight: 8, pricePerUnit: 40_500 }],
    }),
    transaction({
      party: factory,
      kind: 'sale',
      daysAgo: 3,
      paidRatio: 1,
      lines: [{ ...rubber, grossWeight: 260, qualityPercent: 100, pricePerUnit: 16_800 }],
    }),
    transaction({
      party: agency,
      kind: 'sale',
      daysAgo: 7,
      paidRatio: 0.4,
      dueInDays: 9,
      lines: [{ ...cashew, grossWeight: 300, pricePerUnit: 31_000 }],
    }),
  ];

  return {
    suppliers: [mai, bay, tuan, sau],
    buyers: [factory, agency],
    products: [...DEFAULT_PRODUCTS],
    transactions,
    drafts: [],
    notes: [
      {
        id: newId(),
        body: 'Giá cao su sáng nay 14.500đ — hỏi lại nhà máy trước khi chốt chuyến chiều.',
        pinned: true,
        done: false,
        createdAt: daysAgo(0),
        updatedAt: daysAgo(0),
      },
    ],
    settings: defaultSettings(),
    pricingRules: [
      {
        id: newId(),
        name: 'Phí xe đến lấy',
        kind: 'logistics',
        fixedAmount: -50_000,
        appliesOnPickup: true,
        active: true,
      },
      {
        id: newId(),
        name: 'Bớt giá khi mua nhiều',
        kind: 'volumeDiscount',
        productId: 'prod-cashew',
        percentOfTotal: -1,
        minWeightKg: 1_000,
        active: false,
      },
    ],
  };
};
