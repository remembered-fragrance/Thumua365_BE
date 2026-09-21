import { newId } from './id';
import type { AppData, Product } from './types';

export type NewProduct = Pick<Product, 'name' | 'unit' | 'formulaType'> &
  Partial<Pick<Product, 'crop' | 'isSuggested' | 'group'>>;

export const addProduct = (
  data: AppData,
  input: NewProduct,
): { data: AppData; product: Product } => {
  const name = input.name.trim();
  const existing = data.products.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) return { data, product: existing };

  const product: Product = {
    id: newId(),
    name,
    unit: input.unit.trim() || 'kg',
    formulaType: input.formulaType,
    isSuggested: Boolean(input.isSuggested),
    isActive: true,
    crop: input.crop,
    group: input.group?.trim() || undefined,
  };
  return { data: { ...data, products: [...data.products, product] }, product };
};

export const updateProduct = (data: AppData, id: string, patch: Partial<Product>): AppData => ({
  ...data,
  products: data.products.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
});
