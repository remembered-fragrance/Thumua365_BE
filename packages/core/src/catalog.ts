/**
 * Danh mục có sẵn: bốn loại cây và bốn mặt hàng gợi ý.
 * Tách khỏi `types.ts` để file kiểu chỉ còn kiểu, không lẫn dữ liệu.
 */

import type { CropType, Product } from './types';

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
