import type { WeightUnit } from './types';

/** 302 hg = 30.2 kg */
export const toKg = (value: number, unit: WeightUnit): number =>
  unit === 'hg' ? value / 10 : value;

export const fromKg = (kg: number, unit: WeightUnit): number =>
  unit === 'hg' ? kg * 10 : kg;

export const weightUnitLabel = (unit: WeightUnit): string => (unit === 'hg' ? 'hg' : 'kg');
