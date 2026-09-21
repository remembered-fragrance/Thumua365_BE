/**
 * Đọc bảng tính người dùng gửi tới → dữ liệu của sổ. Hàm thuần.
 *
 * Phục vụ dịch vụ chuyển dữ liệu có thu phí (CP4 §11.1): chủ vựa đang giữ danh
 * sách nông hộ và phiếu cũ trong file Excel do con cháu gõ hộ, và không ai đi
 * gõ lại một nghìn dòng bằng tay.
 *
 * 🔴 KHÔNG NHẬP NỬA VỜI. Còn một dòng sai thì cả file dừng lại và báo đúng số
 * dòng đó. Nhập được 700 dòng rồi hỏng ở dòng 701 là trạng thái tệ nhất: người
 * dùng không biết đã vào tới đâu, chạy lại thì trùng, không chạy lại thì thiếu.
 *
 * File này chỉ ĐỌC và KIỂM. Việc tạo hồ sơ đối tác và lập phiếu vẫn đi qua
 * `partyActions` / `receiptActions` như mọi đường khác, để bất biến tiền nong
 * chỉ có một chỗ định nghĩa.
 */

import { parseNumber } from './parseNumber.js';
import { fold } from './vietnameseFold.js';

/** Một ô có thể là chữ, số, ngày, hoặc trống. */
export type Cell = string | number | boolean | Date | null | undefined;
export type SheetMatrix = readonly (readonly Cell[])[];

export type ImportKind = 'suppliers' | 'receipts';

export type ImportErrorCode =
  | 'emptyFile'
  | 'missingColumn'
  | 'missingName'
  | 'missingProduct'
  | 'badDate'
  | 'badNumber';

export interface ImportError {
  /** Số dòng ĐÚNG NHƯ TRONG EXCEL (tính cả dòng tiêu đề) để người dùng mở ra sửa. */
  readonly row: number;
  readonly code: ImportErrorCode;
  /** Tên cột liên quan, viết như trong file mẫu. */
  readonly column?: string;
}

export interface SupplierImport {
  readonly name: string;
  readonly phone?: string;
  readonly location?: string;
  readonly note?: string;
}

export interface ReceiptImport {
  readonly date: string;
  readonly partyName: string;
  readonly productName: string;
  readonly unit: string;
  readonly grossWeight: number;
  readonly pricePerUnit: number;
  readonly amountPaid: number;
  readonly note?: string;
}

export type ImportResult<T> =
  | { readonly ok: true; readonly items: readonly T[] }
  | { readonly ok: false; readonly errors: readonly ImportError[] };

// ─── Tiêu đề cột ─────────────────────────────────────────────────────────────

/**
 * Tên cột chấp nhận được. Cột đầu tiên của mỗi dòng là tên trong file mẫu;
 * các tên sau là những cách viết đã gặp trong file thật của người dùng.
 */
const SUPPLIER_COLUMNS = {
  name: ['Tên nông hộ', 'ten', 'ho ten', 'ten nguoi ban', 'nguoi ban'],
  phone: ['Số điện thoại', 'sdt', 'dien thoai', 'so dt'],
  location: ['Khu vực', 'dia chi', 'noi o'],
  note: ['Ghi chú'],
} as const;

const RECEIPT_COLUMNS = {
  date: ['Ngày', 'ngay mua', 'ngay can'],
  partyName: ['Tên nông hộ', 'ten', 'nguoi ban', 'ten nguoi ban'],
  productName: ['Mặt hàng', 'san pham', 'hang'],
  unit: ['Đơn vị'],
  grossWeight: ['Số lượng', 'can duoc', 'khoi luong', 'so kg'],
  pricePerUnit: ['Đơn giá', 'gia'],
  amountPaid: ['Đã trả', 'so tien da tra', 'tra truoc'],
  note: ['Ghi chú'],
} as const;

const REQUIRED: Record<ImportKind, readonly string[]> = {
  suppliers: ['name'],
  receipts: ['date', 'partyName', 'productName', 'grossWeight', 'pricePerUnit'],
};

const text = (cell: Cell): string => (cell === null || cell === undefined ? '' : String(cell).trim());

type ColumnMap = Readonly<Record<string, number>>;

const mapColumns = (header: readonly Cell[], columns: Record<string, readonly string[]>): ColumnMap => {
  const found: Record<string, number> = {};
  header.forEach((cell, index) => {
    const key = fold(text(cell));
    if (!key) return;
    for (const [field, aliases] of Object.entries(columns)) {
      if (found[field] !== undefined) continue;
      if (aliases.some((alias) => fold(alias) === key)) found[field] = index;
    }
  });
  return found;
};

/** Tên cột như trong file mẫu — để câu báo lỗi chỉ đúng thứ người dùng nhìn thấy. */
const templateName = (columns: Record<string, readonly string[]>, field: string): string =>
  columns[field]?.[0] ?? field;

// ─── Đọc ô ───────────────────────────────────────────────────────────────────

/** Excel đếm ngày từ 30/12/1899. Ô định dạng ngày mà đọc ra số thì là số này. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/**
 * Ô ngày chỉ nói NGÀY, không nói giờ — nên chốt vào GIỮA TRƯA giờ máy.
 *
 * Nửa đêm là mốc sai: `01/08` lưu thành nửa đêm giờ Việt Nam là 17:00 ngày
 * 31/07 theo giờ quốc tế, và phiếu nhảy lùi một ngày ngay khi máy khác ở múi
 * giờ khác đọc nó về. Giữa trưa thì lệch ±12 tiếng vẫn rơi đúng ngày đó.
 */
const atNoon = (year: number, month: number, day: number): string | null => {
  const date = new Date(year, month, day, 12);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const readDate = (cell: Cell): string | null => {
  // `xlsx` dựng Date sao cho phần GIỜ MÁY khớp con số trong ô, nên đọc lại
  // bằng getFullYear/getMonth/getDate mới ra đúng ngày người dùng nhìn thấy.
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime())
      ? null
      : atNoon(cell.getFullYear(), cell.getMonth(), cell.getDate());
  }

  if (typeof cell === 'number' && Number.isFinite(cell) && cell > 0) {
    const serial = new Date(EXCEL_EPOCH_MS + Math.floor(cell) * MS_PER_DAY);
    return atNoon(serial.getUTCFullYear(), serial.getUTCMonth(), serial.getUTCDate());
  }

  const raw = text(cell);
  if (!raw) return null;

  // 1/8/2026 · 01-08-26 — kiểu người Việt gõ: ngày trước, tháng sau.
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(raw);
  if (dmy) {
    const [, d = '', m = '', y = ''] = dmy;
    const year = y.length === 2 ? 2000 + parseNumber(y) : parseNumber(y);
    return atNoon(year, parseNumber(m) - 1, parseNumber(d));
  }

  // 2026-08-01 — kiểu ISO, cũng chỉ là ngày nên vẫn chốt vào giữa trưa.
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (ymd) {
    const [, y = '', m = '', d = ''] = ymd;
    return atNoon(parseNumber(y), parseNumber(m) - 1, parseNumber(d));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/**
 * Ô số không âm. Trống → 0 (cột "Đã trả" bỏ trống nghĩa là chưa trả đồng nào).
 *
 * Trả `null` khi ô có chữ, hoặc khi số âm — cả hai đều là "dòng này sai", không
 * phải "bằng 0". Số âm phải chặn ở đây vì phía sau không ai bắt được nó nữa:
 * `lineNetWeight` kẹp khối lượng về 0, nên một dòng −320 kg lặng lẽ thành phiếu
 * 0₫ và người dùng chỉ phát hiện khi đối chiếu sổ giấy.
 */
const readNumber = (cell: Cell): number | null => {
  if (cell === null || cell === undefined || text(cell) === '') return 0;

  if (typeof cell === 'number') {
    return Number.isFinite(cell) && cell >= 0 ? cell : null;
  }

  const raw = text(cell);
  const value = parseNumber(raw);
  // parseNumber trả 0 cho cả "0" lẫn "abc" — phải tự phân biệt hai trường hợp.
  if (value === 0 && !/^[0.,\s]+$/.test(raw)) return null;
  return value >= 0 ? value : null;
};

const optional = (cell: Cell): string | undefined => text(cell) || undefined;

const isBlankRow = (row: readonly Cell[]): boolean => row.every((cell) => text(cell) === '');

// ─── Đọc cả bảng ─────────────────────────────────────────────────────────────

interface Reader<T> {
  readonly columns: Record<string, readonly string[]>;
  readonly readRow: (row: readonly Cell[], at: ColumnMap, rowNo: number, push: (e: ImportError) => void) => T | null;
}

const run = <T>(matrix: SheetMatrix, kind: ImportKind, reader: Reader<T>): ImportResult<T> => {
  const [header, ...body] = matrix;
  if (!header || body.length === 0) return { ok: false, errors: [{ row: 1, code: 'emptyFile' }] };

  const at = mapColumns(header, reader.columns);
  const missing = REQUIRED[kind]
    .filter((field) => at[field] === undefined)
    .map((field): ImportError => ({
      row: 1,
      code: 'missingColumn',
      column: templateName(reader.columns, field),
    }));
  if (missing.length > 0) return { ok: false, errors: missing };

  const errors: ImportError[] = [];
  const items: T[] = [];

  body.forEach((row, index) => {
    if (isBlankRow(row)) return;
    const item = reader.readRow(row, at, index + 2, (e) => errors.push(e));
    if (item) items.push(item);
  });

  if (errors.length > 0) return { ok: false, errors };
  if (items.length === 0) return { ok: false, errors: [{ row: 1, code: 'emptyFile' }] };
  return { ok: true, items };
};

const cellAt = (row: readonly Cell[], at: ColumnMap, field: string): Cell => {
  const index = at[field];
  return index === undefined ? null : row[index];
};

export const parseSuppliers = (matrix: SheetMatrix): ImportResult<SupplierImport> =>
  run(matrix, 'suppliers', {
    columns: SUPPLIER_COLUMNS,
    readRow: (row, at, rowNo, push) => {
      const name = text(cellAt(row, at, 'name'));
      if (!name) {
        push({ row: rowNo, code: 'missingName', column: templateName(SUPPLIER_COLUMNS, 'name') });
        return null;
      }
      return {
        name,
        phone: optional(cellAt(row, at, 'phone')),
        location: optional(cellAt(row, at, 'location')),
        note: optional(cellAt(row, at, 'note')),
      };
    },
  });

export const parseReceipts = (matrix: SheetMatrix): ImportResult<ReceiptImport> =>
  run(matrix, 'receipts', {
    columns: RECEIPT_COLUMNS,
    readRow: (row, at, rowNo, push) => {
      const date = readDate(cellAt(row, at, 'date'));
      const partyName = text(cellAt(row, at, 'partyName'));
      const productName = text(cellAt(row, at, 'productName'));
      const grossWeight = readNumber(cellAt(row, at, 'grossWeight'));
      const pricePerUnit = readNumber(cellAt(row, at, 'pricePerUnit'));
      const amountPaid = readNumber(cellAt(row, at, 'amountPaid'));

      const named = (field: string) => templateName(RECEIPT_COLUMNS, field);
      if (date === null) push({ row: rowNo, code: 'badDate', column: named('date') });
      if (!partyName) push({ row: rowNo, code: 'missingName', column: named('partyName') });
      if (!productName) push({ row: rowNo, code: 'missingProduct', column: named('productName') });
      if (grossWeight === null) push({ row: rowNo, code: 'badNumber', column: named('grossWeight') });
      if (pricePerUnit === null) push({ row: rowNo, code: 'badNumber', column: named('pricePerUnit') });
      if (amountPaid === null) push({ row: rowNo, code: 'badNumber', column: named('amountPaid') });

      if (date === null || !partyName || !productName) return null;
      if (grossWeight === null || pricePerUnit === null || amountPaid === null) return null;

      return {
        date,
        partyName,
        productName,
        unit: text(cellAt(row, at, 'unit')) || 'kg',
        grossWeight,
        pricePerUnit,
        amountPaid,
        note: optional(cellAt(row, at, 'note')),
      };
    },
  });
