/**
 * Hình dạng trên mạng (`sync-records.ts`) lệch với kiểu của `@mambo/core` là LỖI BIÊN DỊCH — hai
 * phía cùng tính tiền bằng core, nên một trường đổi ở một bên mà quên bên kia phải đỏ ngay.
 */

import type {
  CreditTerm as CoreCreditTerm,
  CropType as CoreCropType,
  DraftStatus as CoreDraftStatus,
  PriceAdjustment as CorePriceAdjustment,
  PricingRuleKind as CorePricingRuleKind,
  ProductFormulaType as CoreFormulaType,
  TransactionKind as CoreTransactionKind,
  TransactionLine as CoreTransactionLine,
} from '@mambo/core/types';
import type { z } from 'zod';
import type {
  CreditTerm,
  CropType,
  DraftStatus,
  FormulaType,
  PriceAdjustment,
  PricingRuleKind,
  TransactionKind,
  TransactionRecord,
} from './sync-records.js';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
type LineRecord = TransactionRecord['lines'][number];

const matchesCore: [
  Same<z.infer<typeof CropType>, CoreCropType>,
  Same<z.infer<typeof FormulaType>, CoreFormulaType>,
  Same<z.infer<typeof TransactionKind>, CoreTransactionKind>,
  Same<z.infer<typeof DraftStatus>, CoreDraftStatus>,
  Same<z.infer<typeof PricingRuleKind>, CorePricingRuleKind>,
  Same<LineRecord, CoreTransactionLine>,
  Same<z.infer<typeof PriceAdjustment>, CorePriceAdjustment>,
  Same<z.infer<typeof CreditTerm>, CoreCreditTerm>,
] = [true, true, true, true, true, true, true, true];
void matchesCore;
