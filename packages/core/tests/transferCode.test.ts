import { describe, expect, it } from 'vitest';
import {
  findTransferCode,
  newTransferCode,
  transferContent,
  TRANSFER_CODE_LENGTH,
} from '../src/transferCode';

describe('newTransferCode', () => {
  it('sinh đúng độ dài và không có ký tự dễ đọc nhầm', () => {
    for (let i = 0; i < 200; i++) {
      const code = newTransferCode();
      expect(code).toHaveLength(TRANSFER_CODE_LENGTH);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('nhận nguồn ngẫu nhiên bơm vào để test lặp lại được', () => {
    expect(newTransferCode(() => 0)).toBe('222222');
  });
});

describe('findTransferCode', () => {
  const CODE = 'K7M2P9';

  it('đọc được nội dung app tự điền', () => {
    expect(findTransferCode(transferContent(CODE))).toBe(CODE);
  });

  it('đọc được khi ngân hàng dính chữ và thêm tiền tố của họ', () => {
    expect(findTransferCode('CT DEN:TM365K7M2P9-MBVCB.123456')).toBe(CODE);
  });

  it('đọc được khi người dùng gõ thường và thêm khoảng trắng', () => {
    expect(findTransferCode('chuyen tien  tm365  k7m2p9  nhe')).toBe(CODE);
  });

  it('không có tiền tố thì trả null, không đoán bừa', () => {
    expect(findTransferCode('THANH TOAN K7M2P9')).toBeNull();
  });

  it('mã cụt thì trả null', () => {
    expect(findTransferCode('TM365 K7M2')).toBeNull();
  });

  it('mã chứa ký tự ngoài bảng chữ thì trả null', () => {
    // Số 0 và chữ O đã bị loại khỏi bảng chữ vì đọc qua điện thoại hay nhầm.
    expect(findTransferCode('TM365 K7M2P0')).toBeNull();
  });

  it('nội dung rỗng thì trả null', () => {
    expect(findTransferCode('')).toBeNull();
  });
});
