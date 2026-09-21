import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_STATUS, ErrorBody, isRetryable } from '../src/errors';

describe('định dạng lỗi', () => {
  it('mỗi mã lỗi có đúng một HTTP status', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('hết gói là 402 và KHÔNG thử lại — hàng đợi dừng, không đốt lượt thử', () => {
    expect(ERROR_STATUS.PLAN_EXPIRED).toBe(402);
    expect(isRetryable('PLAN_EXPIRED')).toBe(false);
  });

  it('chỉ lỗi tạm thời mới thử lại', () => {
    expect(ERROR_CODES.filter(isRetryable)).toEqual(['PARENT_MISSING', 'RATE_LIMITED', 'INTERNAL']);
  });

  it('nhận đúng thân lỗi mẫu và từ chối mã lạ', () => {
    expect(
      ErrorBody.safeParse({ error: { code: 'PLAN_EXPIRED', message: 'Gói đã hết hạn', details: {} } }).success,
    ).toBe(true);
    expect(ErrorBody.safeParse({ error: { code: 'TEAPOT', message: 'x' } }).success).toBe(false);
  });
});
