import { describe, expect, it } from 'vitest';
import { newId } from '../src/id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('ra UUID thuần — cột id của mọi bảng là kiểu uuid, tiền tố sẽ bị từ chối', () => {
    expect(newId()).toMatch(UUID);
  });

  it('không trùng nhau', () => {
    const ids = new Set(Array.from({ length: 1_000 }, newId));
    expect(ids.size).toBe(1_000);
  });
});
