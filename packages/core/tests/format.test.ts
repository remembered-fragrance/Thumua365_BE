import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatQuantity,
  formatVnd,
  formatVndShort,
  formatWeight,
  groupThousands,
} from '../src/format';
import { fromKg, toKg, weightUnitLabel } from '../src/weight';

describe('formatVnd', () => {
  it('có dấu ngăn nghìn và ký hiệu đồng', () => {
    expect(formatVnd(1_438_000)).toBe('1.438.000₫');
  });

  it('làm tròn về đồng, không hiện số lẻ', () => {
    expect(formatVnd(1_438_000.4)).toBe('1.438.000₫');
  });
});

describe('formatVndShort — hiển thị gọn trên thẻ tổng quan', () => {
  it.each([
    [900, '900'],
    [74_000, '74k'],
    [1_438_000, '1,4tr'],
    [2_500_000_000, '2,5 tỷ'],
  ])('%i → "%s"', (value, text) => {
    expect(formatVndShort(value)).toBe(text);
  });

  it('số âm vẫn rút gọn được', () => {
    expect(formatVndShort(-1_438_000)).toBe('-1,4tr');
  });
});

describe('groupThousands — ngăn nghìn ngay khi đang gõ', () => {
  it('gõ 74000000 thì thấy 74.000.000, không phải một dãy số liền', () => {
    expect(groupThousands('74000000')).toBe('74.000.000');
  });

  it('đang gõ dấu phẩy thì dấu phẩy KHÔNG biến mất', () => {
    expect(groupThousands('1')).toBe('1');
    expect(groupThousands('1,')).toBe('1,');
    expect(groupThousands('1,5')).toBe('1,5');
  });

  it('ô trống thì để trống, không hiện số 0', () => {
    expect(groupThousands('')).toBe('');
  });

  it('phần nguyên dài vẫn ngăn đúng, phần lẻ giữ nguyên', () => {
    expect(groupThousands('1234567,89')).toBe('1.234.567,89');
  });
});

describe('formatQuantity', () => {
  it('mặc định đơn vị kg', () => {
    expect(formatWeight(99.2)).toBe('99,2 kg');
  });

  it('theo đơn vị của dòng hàng', () => {
    expect(formatQuantity(302, 'hg')).toBe('302 hg');
  });
});

describe('ngày giờ theo kiểu Việt Nam', () => {
  it('ngày dạng dd/mm/yyyy', () => {
    expect(formatDate('2026-08-08T03:00:00.000Z')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('ngày giờ có cả giờ phút', () => {
    expect(formatDateTime('2026-08-08T03:00:00.000Z')).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

describe('đổi đơn vị cân — lạng và kg', () => {
  it('302 lạng = 30,2 kg', () => {
    expect(toKg(302, 'hg')).toBeCloseTo(30.2);
  });

  it('kg giữ nguyên', () => {
    expect(toKg(30.2, 'kg')).toBe(30.2);
    expect(fromKg(30.2, 'kg')).toBe(30.2);
  });

  it('đổi ngược lại về lạng', () => {
    expect(fromKg(30.2, 'hg')).toBeCloseTo(302);
  });

  it('nhãn đơn vị', () => {
    expect(weightUnitLabel('hg')).toBe('hg');
    expect(weightUnitLabel('kg')).toBe('kg');
  });
});
