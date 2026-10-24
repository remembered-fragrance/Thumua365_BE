// ─── Primitive types ────────────────────────────────────────────────────────

export type CropType = 'rubber' | 'cashew' | 'coffee' | 'pepper';
export type WeightUnit = 'kg' | 'hg';
export type ProductFormulaType = 'standard' | 'netAfterTare' | 'rubberLatex' | 'lossPercent';
/**
 * Loại mủ của công thức `rubberLatex` (V20): mủ nước tính theo độ TSC, mủ tạp (mủ chén, mủ đông) theo DRC.
 * Cùng một phép tính (kg × độ % × giá); khác nhãn và bậc giá. Không thêm `ProductFormulaType` mới: app
 * bản cũ đọc phải công thức lạ thì cả lượt kéo sổ hỏng (`CONTRACT_MISMATCH`), còn trường lạ thì bỏ qua.
 */
export type RubberKind = 'latex' | 'cuplump';
export type DraftStatus = 'draft' | 'waiting';

/**
 * Phân biệt chiều giao dịch:
 *  'purchase' — thu mua (nhập hàng từ người bán)
 *  'sale'     — xuất bán (bán hàng đến người mua)
 * Dữ liệu cũ (v2) luôn được migrate về 'purchase'.
 */
export type TransactionKind = 'purchase' | 'sale';

// ─── Payment (Workstream H) ──────────────────────────────────────────────────

/**
 * Một lần trả tiền cho giao dịch.
 * Bất biến: sum(payments) === amountPaid tại mọi thời điểm.
 */
export interface Payment {
  readonly id: string;
  readonly date: string;   // ISO 8601
  readonly amount: number;
  readonly note?: string;
}

// ─── Credit term (Workstream H) ─────────────────────────────────────────────

/** Kỳ hạn thanh toán: ngày hẹn và số tiền đến hạn của kỳ này. */
export interface CreditTerm {
  readonly dueDate: string; // ISO 8601
  readonly amount: number;
}

// ─── Price adjustment (Workstream G) ────────────────────────────────────────

/**
 * Điều chỉnh giá trên phiếu (phí logistics, chiết khấu volume, điều chỉnh tay).
 * Được freeze cùng phiếu — lưu số tiền tuyệt đối, không lưu công thức.
 * Dương = cộng thêm cho người bán, âm = trừ vào.
 */
export interface PriceAdjustment {
  readonly id: string;
  readonly kind: 'logistics' | 'volumeDiscount' | 'manual';
  readonly label: string;  // "Phí xe đến lấy", "Chiết khấu > 1 tấn"...
  readonly amount: number;
  /** G: link về PricingRule người sinh ra adjustment này (optional) */
  readonly ruleId?: string;
}

// ─── Pricing rule (Workstream G) ─────────────────────────────────────────────

export type PricingRuleKind = 'logistics' | 'volumeDiscount' | 'manual';

/**
 * Quy tắc tự đề xuất khoản cộng/trừ (phí xe, bớt giá khi mua nhiều…).
 * Kiểu nằm ở đây vì `AppData` chứa nó; cách áp dụng nằm ở `pricing.ts`.
 */
export interface PricingRule {
  readonly id: string;
  readonly name: string;
  readonly kind: PricingRuleKind;
  /** Có thì chỉ áp cho mặt hàng này; không có thì áp chung. */
  readonly productId?: string;
  /** Số tiền cố định (dương = cộng thêm, âm = trừ bớt). */
  readonly fixedAmount?: number;
  /** Phần trăm của tổng phiếu (dương = cộng thêm, âm = trừ bớt). */
  readonly percentOfTotal?: number;
  /** Từ bao nhiêu kg trở lên thì quy tắc mới kích hoạt. */
  readonly minWeightKg?: number;
  /** true = chỉ khi xe đến lấy · false = chỉ khi tự mang tới · null = cả hai. */
  readonly appliesOnPickup?: boolean | null;
  readonly active: boolean;
  /**
   * V19 — có thì đây là quy tắc theo chỉ tiêu chất lượng: bỏ qua `fixedAmount` / `percentOfTotal`,
   * mỗi dòng có chỉ tiêu này được cộng/trừ theo bảng `qualitySteps`.
   */
  readonly qualityMetric?: QualityMetric;
  /** Bảng mốc, tăng dần theo `from`. Xem `qualityStepOf`. */
  readonly qualitySteps?: readonly QualityStep[];
}

/** Chỉ tiêu trên dòng phiếu mà quy tắc giá đọc được. `qualityPercent` = độ TSC / DRC của mủ. */
export type QualityMetric = 'bulkDensity' | 'moisturePercent' | 'impurityPercent' | 'kor' | 'qualityPercent';

/** Một mốc: chỉ tiêu TỪ `from` trở lên (tới mốc kế) thì cộng `amountPerUnit` đồng cho mỗi đơn vị tính tiền. */
export interface QualityStep {
  readonly from: number;
  /** Đồng / kg (đơn vị tính tiền của dòng). Dương = cộng thêm, âm = trừ bớt. */
  readonly amountPerUnit: number;
}

// ─── Attachment (Workstream J) ───────────────────────────────────────────────

/**
 * Metadata chứng từ/ảnh hóa đơn.
 * Blob thực lưu trong IndexedDB; chỉ metadata này nằm trong AppData/localStorage.
 */
export interface Attachment {
  readonly id: string;       // key trong IndexedDB
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly createdAt: string;
}

// ─── Product ─────────────────────────────────────────────────────────────────

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly formulaType: ProductFormulaType;
  readonly isSuggested: boolean;
  readonly isActive: boolean;
  readonly crop?: CropType;
  readonly lastPricePerUnit?: number;
  /** Nhóm mặt hàng tùy chọn (D1) — dùng để lọc trong ProductsPage/HistoryPage */
  readonly group?: string;
  /** Danh sách phân loại chất lượng (E1) — nhãn mô tả, không tham gia công thức */
  readonly qualityGrades?: readonly string[];
  /** Bật theo dõi tồn kho (F) */
  readonly trackInventory?: boolean;
  /** V20: mặt hàng mủ tính theo DRC (mủ tạp). Chọn mặt hàng thì dòng phiếu mang theo. */
  readonly rubberKind?: RubberKind;
}

// ─── Supplier ────────────────────────────────────────────────────────────────

export interface Supplier {
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
  readonly location?: string;
  readonly note?: string;
}

// ─── Buyer (Workstream F) ────────────────────────────────────────────────────

/**
 * Nhà máy / đại lý nhận hàng xuất bán.
 * Cấu trúc giống Supplier nhưng là đối tác đầu ra.
 */
export interface Buyer {
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
  readonly location?: string;
  readonly note?: string;
}

// ─── TransactionLine ─────────────────────────────────────────────────────────

export interface TransactionLine {
  readonly id: string;
  readonly crop?: CropType;
  readonly productId?: string;
  readonly productName: string;
  readonly unit: string;
  readonly formulaType: ProductFormulaType;
  /** Số lượng cân/nhập theo đơn vị của dòng */
  readonly grossWeight: number;
  /** Khối lượng bì/trừ, nếu công thức cần */
  readonly tareWeight?: number;
  /** Hàm lượng mủ/tỷ lệ chất lượng, nhập 30 cho 30% */
  readonly qualityPercent?: number;
  /** Hao hụt %, nếu công thức cần */
  readonly lossPercent?: number;
  /** Đơn giá theo đơn vị của dòng */
  readonly pricePerUnit: number;
  /** @deprecated Legacy field — giữ để migration không vỡ */
  readonly pricePerKg?: number;
  readonly rawTotal?: number;
  readonly roundedTotal?: number;
  /** Phân loại chất lượng (E2) — nhãn mô tả, không tham gia công thức */
  readonly qualityGrade?: string;
  /** V20: `qualityPercent` là độ TSC (mủ nước) hay DRC (mủ tạp). Không có = mủ nước. Công thức như nhau. */
  readonly rubberKind?: RubberKind;
  // V19 — chỉ tiêu chất lượng đo lúc mua. Không tham gia công thức dòng: quy tắc giá theo chỉ tiêu
  // (`PricingRule.qualityMetric`) đọc chúng để đề xuất khoản cộng/trừ.
  /** Dung trọng, g/l (tiêu). */
  readonly bulkDensity?: number;
  /** Độ ẩm, % (tiêu, cà phê, điều). */
  readonly moisturePercent?: number;
  /** Tạp chất, % (tiêu, cà phê). */
  readonly impurityPercent?: number;
  /** Tỷ lệ thu hồi nhân KOR, lbs/bao 80 kg (điều). */
  readonly kor?: number;
}

// ─── Transaction ─────────────────────────────────────────────────────────────

export interface Transaction {
  readonly id: string;
  readonly date: string;
  /** @deprecated Dùng counterpartyId thay. Giữ lại để migration v1/v2 không vỡ */
  readonly supplierId: string;
  readonly supplierName: string;
  readonly lines: readonly TransactionLine[];
  /**
   * Tổng đã trả — luôn bằng sum(payments).
   * Giữ field này để backward compat và để transactionTotals() dùng ngay mà không cần sum.
   */
  readonly amountPaid: number;
  readonly note?: string;
  // ─── Fields mới (v3) ───
  /** Chiều giao dịch. Default 'purchase' cho dữ liệu cũ. */
  readonly kind: TransactionKind;
  /** ID đối tác: supplierId (purchase) hoặc buyerId (sale) */
  readonly counterpartyId: string;
  /** Lịch sử từng lần trả tiền */
  readonly payments: readonly Payment[];
  /** Kỳ hạn thanh toán (tùy chọn) */
  readonly creditTerms?: readonly CreditTerm[];
  /** Điều chỉnh giá (logistics, volume discount, manual) */
  readonly adjustments?: readonly PriceAdjustment[];
  /** ID các chứng từ đính kèm (blob trong IndexedDB) */
  readonly attachmentIds?: readonly string[];
  /** (BE5) Phiếu lập theo đơn — đồng bộ lên thì đơn tự sang `fulfilled`. */
  readonly orderId?: string;
  /** Trạng thái đồng bộ với máy chủ. Tầng dữ liệu (giai đoạn C) đặt giá trị. */
  readonly syncState?: SyncState;
}

// ─── Trạng thái đồng bộ ──────────────────────────────────────────────────────

export type SyncState = 'synced' | 'pending' | 'conflict';

/** Trạng thái tầng dữ liệu mà giao diện vẽ dựa vào (thanh "đang chờ gửi"…). */
export interface SyncStatus {
  readonly loading: boolean;
  readonly error?: string;
  readonly lastSyncedAt?: string;
  readonly pendingCount: number;
  /**
   * Máy chủ TỪ CHỐI ghi vì gói đã hết hạn — không phải lỗi mạng.
   * Phân biệt hai thứ này là bắt buộc: lỗi mạng thì thử lại, còn cái này thử
   * lại bao nhiêu lần cũng vậy, và câu phải nói với người dùng là khác hẳn.
   */
  readonly blocked?: boolean;
  /**
   * Máy chủ từ chối CẢ lượt đẩy vì lý do không phải mạng (không còn trong tổ chức, phiên hết hạn, app lệch
   * hợp đồng…). Hàng đợi giữ nguyên và tự thử lại, nhưng không được nói với người dùng là "mất mạng".
   */
  readonly refused?: boolean;
}

// ─── DraftReceipt ────────────────────────────────────────────────────────────

export interface DraftReceipt {
  readonly id: string;
  readonly status: DraftStatus;
  readonly kind?: TransactionKind;
  readonly counterpartyId?: string;
  readonly supplierId?: string;
  readonly supplierName: string;
  readonly lines: readonly TransactionLine[];
  readonly amountPaid: number;
  /** Khoản cộng/trừ đang nhập (tiền xe…) — chốt thì sang nguyên phiếu. */
  readonly adjustments?: readonly PriceAdjustment[];
  readonly note?: string;
  readonly attachmentIds?: readonly string[];
  /** (BE5) Nháp lập theo đơn — chốt thành phiếu thì phiếu mang `orderId` này. */
  readonly orderId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Note ────────────────────────────────────────────────────────────────────

export interface Note {
  readonly id: string;
  readonly body: string;
  readonly pinned: boolean;
  readonly done: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── AppSettings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  readonly defaultWeightUnit: WeightUnit;
  /**
   * Chế độ xem:
   *  'normal'  — trong nhà
   *  'outdoor' — ngoài nắng: chữ to hơn, tương phản cao hơn, vùng chạm lớn hơn
   *  'night'   — buổi tối, nền tối
   */
  readonly displayMode: 'normal' | 'outdoor' | 'night';
}

// ─── AppData ─────────────────────────────────────────────────────────────────

export interface AppData {
  readonly suppliers: readonly Supplier[];
  readonly buyers: readonly Buyer[];
  readonly products: readonly Product[];
  readonly transactions: readonly Transaction[];
  readonly drafts: readonly DraftReceipt[];
  readonly notes: readonly Note[];
  readonly settings: AppSettings;
  /** G: quy tắc điều chỉnh giá tự động. Default [] cho data cũ (backward-compat). */
  readonly pricingRules?: readonly PricingRule[];
}

// ─── UserProfile ─────────────────────────────────────────────────────────────

/**
 * L4 — email là TUỲ CHỌN. Tệp người dùng mục tiêu phần lớn không có email;
 * họ đăng nhập bằng số điện thoại hoặc tên tài khoản.
 * `identifier` là khoá tra cứu đã chuẩn hoá (xem `core/identifier.ts`).
 */
export interface UserProfile {
  readonly id: string;
  readonly identifier: string;
  readonly name: string;
  readonly username?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly businessName?: string;
  /** Mã mời của chính người này, để đưa cho người khác. Database sinh ra. */
  readonly referralCode?: string;
}
