/**
 * Danh mục có sẵn: bốn loại cây và bốn mặt hàng gợi ý.
 * Tách khỏi `types.ts` để file kiểu chỉ còn kiểu, không lẫn dữ liệu.
 */

import type { CropType, Product } from './types.js';

export interface CropMeta {
  readonly id: CropType;
  readonly label: string;
  readonly emoji: string;
}

export const CROPS: readonly CropMeta[] = [
  { id: 'rubber', label: 'Cao su', emoji: '🌳' },
  { id: 'cashew', label: 'Điều', emoji: '🥜' },
  { id: 'coffee', label: 'Cà phê', emoji: '☕' },
  { id: 'pepper', label: 'Hồ tiêu', emoji: '🌶️' },
] as const;

export const cropMeta = (id?: CropType): CropMeta | undefined =>
  id ? CROPS.find((c) => c.id === id) : undefined;

export const productNameFromCrop = (crop?: CropType): string =>
  cropMeta(crop)?.label ?? 'Mặt hàng';

/**
 * Bốn mặt hàng gợi ý cho sổ CHỈ NẰM TRÊN MÁY (tài khoản máy, dữ liệu mẫu). Id `prod-…` không phải
 * UUID nên không đồng bộ được: sổ có máy chủ nhận bộ mặt hàng này từ máy chủ (`/v1/me/bootstrap` tạo
 * với id UUID), không bao giờ dùng bản ở đây.
 */
export const DEFAULT_PRODUCTS: readonly Product[] = [
  {
    id: 'prod-rubber',
    name: 'Cao su',
    unit: 'kg',
    formulaType: 'rubberLatex',
    isSuggested: true,
    isActive: true,
    crop: 'rubber',
  },
  {
    id: 'prod-cashew',
    name: 'Điều',
    unit: 'kg',
    formulaType: 'netAfterTare',
    isSuggested: true,
    isActive: true,
    crop: 'cashew',
  },
  {
    id: 'prod-coffee',
    name: 'Cà phê',
    unit: 'kg',
    formulaType: 'netAfterTare',
    isSuggested: true,
    isActive: true,
    crop: 'coffee',
  },
  {
    id: 'prod-pepper',
    name: 'Hồ tiêu',
    unit: 'kg',
    formulaType: 'netAfterTare',
    isSuggested: true,
    isActive: true,
    crop: 'pepper',
  },
] as const;

/** Id mặt hàng mặc định kiểu cũ (`prod-rubber`…) — máy chủ từ chối mọi thao tác trên id này. */
export const isLegacyProductId = (id: string): boolean => DEFAULT_PRODUCTS.some((p) => p.id === id);
