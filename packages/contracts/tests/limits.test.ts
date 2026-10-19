/**
 * B4 — app chặn ô nhập bằng chính các hằng này. Lệch với schema là bấm Lưu không có phản hồi: op bị máy
 * chặn trước khi vào hàng đợi (`opCheck`), form không báo gì.
 */

import { describe, expect, it } from 'vitest';
import { NOTE_LIMITS, NoteInsert, PARTY_LIMITS, PartyInsert, PRODUCT_LIMITS, ProductInsert } from '../src/index';

const text = (n: number) => 'a'.repeat(n);

describe('giới hạn ô nhập khớp schema', () => {
  it('đối tác', () => {
    const at = { name: text(PARTY_LIMITS.name), phone: text(PARTY_LIMITS.phone), location: text(PARTY_LIMITS.location), note: text(PARTY_LIMITS.note) };
    expect(PartyInsert.safeParse(at).success).toBe(true);
    for (const key of ['name', 'phone', 'location', 'note'] as const) {
      expect(PartyInsert.safeParse({ ...at, [key]: text(PARTY_LIMITS[key] + 1) }).success).toBe(false);
    }
  });

  it('mặt hàng', () => {
    const at = { name: text(PRODUCT_LIMITS.name), unit: text(PRODUCT_LIMITS.unit), formulaType: 'standard' };
    expect(ProductInsert.safeParse(at).success).toBe(true);
    expect(ProductInsert.safeParse({ ...at, name: text(PRODUCT_LIMITS.name + 1) }).success).toBe(false);
    expect(ProductInsert.safeParse({ ...at, unit: text(PRODUCT_LIMITS.unit + 1) }).success).toBe(false);
  });

  it('ghi chú', () => {
    expect(NoteInsert.safeParse({ body: text(NOTE_LIMITS.body) }).success).toBe(true);
    expect(NoteInsert.safeParse({ body: text(NOTE_LIMITS.body + 1) }).success).toBe(false);
  });
});
