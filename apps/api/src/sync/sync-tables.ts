/**
 * Tám bảng sổ nhìn từ phía đồng bộ: đổi `data` của op thành cột DB, đổi hàng DB thành
 * bản ghi của hợp đồng (`*Record`), và lọc theo chi nhánh.
 *
 * Tên trường trong hợp đồng TRÙNG tên field Prisma (`@map` lo snake_case), nên ở đây chỉ
 * đổi KIỂU: tiền → BigInt, JSON, thời gian → Date. Tên delegate Prisma trùng tên thực thể
 * (`tx.supplier`, `tx.pricingRule`…).
 */

import type {
  DraftRecord,
  NoteRecord,
  PartyRecord,
  PaymentRecord,
  PricingRuleRecord,
  ProductRecord,
  SyncEntity,
  TransactionRecord,
} from '@mambo/contracts';
import type { Tx } from '../db/database';
import {
  type Buyer,
  type Draft,
  type Note,
  type Payment,
  Prisma,
  type PricingRule,
  type Product,
  type Supplier,
  type Transaction,
} from '../generated/prisma/client';

type Data = Record<string, unknown>;
type Row = { readonly id: string; readonly updatedAt: Date } & Record<string, unknown>;

/**
 * Phần delegate Prisma mà đồng bộ dùng — giống nhau ở cả tám bảng. `data` đã qua schema
 * zod của hợp đồng và `toDb` trước khi tới đây.
 */
export interface SyncDelegate {
  findUnique(args: { where: { id: string }; select: Record<string, unknown> }): Promise<Data | null>;
  create(args: { data: Data; select: { id: true } }): Promise<unknown>;
  update(args: { where: { id: string }; data: Data; select: { id: true } }): Promise<unknown>;
  findMany(args: { where: Data; orderBy: Data[]; take: number }): Promise<Row[]>;
}

export const delegateOf = (tx: Tx, entity: SyncEntity): SyncDelegate => tx[entity] as unknown as SyncDelegate;

/** Bản ghi thuộc chi nhánh nào: của chính nó (phiếu, nháp), của phiếu cha (lần trả), hoặc không (danh mục). */
export type BranchRule = 'own' | 'parent' | 'none';

export interface SyncTable {
  readonly branch: BranchRule;
  /** Giá trị server điền khi insert bỏ trống. */
  readonly defaults: Data;
  /** `data` của op (đã kiểm) → giá trị cột. */
  readonly toDb: (data: Data) => Data;
  readonly toRecord: (row: never) => unknown;
}

const iso = (d: Date): string => d.toISOString();
const meta = (row: { id: string; createdBy: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null }) => ({
  id: row.id,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  deletedAt: row.deletedAt ? iso(row.deletedAt) : null,
});

/** Tiền trong DB là BigInt; trên mạng là số nguyên đồng — luôn nằm trong vùng an toàn của Number. */
const toBigInt = (value: unknown): bigint | null => (value === null ? null : BigInt(value as number));

/** Đổi những trường có mặt trong `data`; trường vắng mặt vẫn vắng (patch không đụng tới). */
const convert =
  (converters: Readonly<Record<string, (value: unknown) => unknown>>) =>
  (data: Data): Data => {
    const out: Data = { ...data };
    for (const [key, fn] of Object.entries(converters)) {
      if (key in out && out[key] !== undefined) out[key] = fn(out[key]);
    }
    return out;
  };

const same = (data: Data): Data => data;
const asDate = (value: unknown): Date => new Date(value as string);
/** Cột JSON cho phép NULL: `null` phải thành `Prisma.DbNull` (NULL của SQL), không phải JSON `null`. */
const nullableJson = (value: unknown): unknown => (value === null ? Prisma.DbNull : value);
const list = (value: string[] | null | undefined): string[] => value ?? [];

const party: SyncTable = {
  branch: 'none',
  defaults: { phone: null, location: null, note: null },
  toDb: same,
  toRecord: (row: Supplier | Buyer): PartyRecord => ({
    ...meta(row),
    name: row.name,
    phone: row.phone,
    location: row.location,
    note: row.note,
  }),
};

export const SYNC_TABLES: Readonly<Record<SyncEntity, SyncTable>> = {
  supplier: party,
  buyer: party,

  product: {
    branch: 'none',
    defaults: { unit: 'kg', isSuggested: false, isActive: true, qualityGrades: [] },
    toDb: same,
    toRecord: (row: Product): ProductRecord => ({
      ...meta(row),
      name: row.name,
      unit: row.unit,
      formulaType: row.formulaType as ProductRecord['formulaType'],
      isSuggested: row.isSuggested,
      isActive: row.isActive,
      crop: row.crop as ProductRecord['crop'],
      lastPricePerUnit: row.lastPricePerUnit,
      group: row.group,
      qualityGrades: list(row.qualityGrades),
      trackInventory: row.trackInventory,
    }),
  },

  pricingRule: {
    branch: 'none',
    defaults: {},
    toDb: convert({ fixedAmount: toBigInt }),
    toRecord: (row: PricingRule): PricingRuleRecord => ({
      ...meta(row),
      name: row.name,
      kind: row.kind as PricingRuleRecord['kind'],
      productId: row.productId,
      fixedAmount: row.fixedAmount === null ? null : Number(row.fixedAmount),
      percentOfTotal: row.percentOfTotal,
      minWeightKg: row.minWeightKg,
      appliesOnPickup: row.appliesOnPickup,
      active: row.active,
    }),
  },

  note: {
    branch: 'none',
    defaults: {},
    toDb: same,
    toRecord: (row: Note): NoteRecord => ({ ...meta(row), body: row.body, pinned: row.pinned, done: row.done }),
  },

  draft: {
    branch: 'own',
    defaults: { attachmentIds: [] },
    toDb: convert({ amountPaid: toBigInt }),
    toRecord: (row: Draft): DraftRecord => ({
      ...meta(row),
      status: row.status as DraftRecord['status'],
      kind: row.kind as DraftRecord['kind'],
      counterpartyId: row.counterpartyId,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      lines: row.lines as DraftRecord['lines'],
      amountPaid: Number(row.amountPaid),
      note: row.note,
      attachmentIds: list(row.attachmentIds),
      branchId: row.branchId,
      orderId: row.orderId,
    }),
  },

  transaction: {
    branch: 'own',
    defaults: { attachmentIds: [] },
    toDb: convert({ date: asDate, creditTerms: nullableJson, adjustments: nullableJson }),
    toRecord: (row: Transaction): TransactionRecord => ({
      ...meta(row),
      date: iso(row.date),
      kind: row.kind as TransactionRecord['kind'],
      counterpartyId: row.counterpartyId,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      lines: row.lines as TransactionRecord['lines'],
      creditTerms: row.creditTerms as TransactionRecord['creditTerms'],
      adjustments: row.adjustments as TransactionRecord['adjustments'],
      attachmentIds: list(row.attachmentIds),
      note: row.note,
      branchId: row.branchId,
      orderId: row.orderId,
    }),
  },

  payment: {
    branch: 'parent',
    defaults: { note: null },
    toDb: convert({ date: asDate, amount: toBigInt }),
    toRecord: (row: Payment): PaymentRecord => ({
      ...meta(row),
      transactionId: row.transactionId,
      date: iso(row.date),
      amount: Number(row.amount),
      note: row.note,
    }),
  },
};

/** Điều kiện "chỉ chi nhánh này" theo cách bảng gắn với chi nhánh. */
export const branchFilter = (rule: BranchRule, branchId: string | null): Data => {
  if (branchId === null || rule === 'none') return {};
  return rule === 'own' ? { branchId } : { transaction: { branchId } };
};
