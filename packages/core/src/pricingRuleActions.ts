import { newId } from './id';
import type { AppData, PricingRule } from './types';

export const addPricingRule = (
  data: AppData,
  input: Omit<PricingRule, 'id'>,
): { data: AppData; rule: PricingRule } => {
  const rule: PricingRule = { ...input, id: newId() };
  return { data: { ...data, pricingRules: [...(data.pricingRules ?? []), rule] }, rule };
};

export const updatePricingRule = (
  data: AppData,
  id: string,
  patch: Partial<PricingRule>,
): AppData => ({
  ...data,
  pricingRules: (data.pricingRules ?? []).map((r) =>
    r.id === id ? { ...r, ...patch, id: r.id } : r,
  ),
});

export const deletePricingRule = (data: AppData, id: string): AppData => ({
  ...data,
  pricingRules: (data.pricingRules ?? []).filter((r) => r.id !== id),
});
