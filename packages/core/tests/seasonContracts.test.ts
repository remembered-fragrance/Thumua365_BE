import { describe, expect, it } from 'vitest';
import { emptyData, normalize } from '../src/normalize';
import {
  addSeasonContract,
  contractProgress,
  contractsForTransaction,
  deleteSeasonContract,
  updateSeasonContract,
  type NewSeasonContract,
} from '../src/seasonContracts';
import { line, tx } from './fixtures';

const input: NewSeasonContract = {
  kind: 'purchase',
  counterpartyId: 'sup-1',
  counterpartyName: 'Cô Lê Thị Mai',
  productName: 'Cà phê nhân',
  unit: 'kg',
  quantity: 10_000,
  pricePerUnit: 98_000,
  startDate: '2026-11-01T00:00:00.000+07:00',
  endDate: '2027-01-31T00:00:00.000+07:00',
};

const coffee = (grossWeight: number) => line({ productName: 'Cà phê nhân', grossWeight });

describe('hợp đồng mùa vụ — thêm, sửa, xoá', () => {
  it('thêm vào đầu danh sách, mở, có id; sửa giữ id; xoá mất hẳn', () => {
    const { data, contract } = addSeasonContract(emptyData(), input);
    expect(data.seasonContracts).toEqual([contract]);
    expect(contract).toMatchObject({ closed: false, quantity: 10_000 });

    const closed = updateSeasonContract(data, contract.id, { closed: true, id: 'khác' });
    expect(closed.seasonContracts?.[0]).toMatchObject({ id: contract.id, closed: true });
    expect(deleteSeasonContract(closed, contract.id).seasonContracts).toEqual([]);
  });

  it('sổ cũ chưa có hợp đồng thì normalize ra []', () => {
    expect(normalize({ transactions: [] }).seasonContracts).toEqual([]);
  });
});

describe('tiến độ giao', () => {
  const { data: base, contract } = addSeasonContract(emptyData(), input);

  it('chỉ cộng phiếu mua, cùng người, cùng mặt hàng, trong khoảng ngày (tính cả ngày cuối)', () => {
    const data = {
      ...base,
      transactions: [
        tx({ id: 'a', date: '2026-11-05T03:00:00.000Z', lines: [coffee(3_000), line({ productName: 'Tiêu', grossWeight: 500 })] }),
        tx({ id: 'b', date: '2027-01-31T15:00:00.000Z', lines: [coffee(2_000)] }),
        tx({ id: 'c', date: '2027-02-01T03:00:00.000Z', lines: [coffee(9_000)] }),
        tx({ id: 'd', date: '2026-11-05T03:00:00.000Z', counterpartyId: 'sup-2', supplierName: 'Anh Tư', lines: [coffee(9_000)] }),
        tx({ id: 'e', date: '2026-11-05T03:00:00.000Z', kind: 'sale', lines: [coffee(9_000)] }),
      ],
    };
    expect(contractProgress(data, contract)).toEqual({ delivered: 5_000, remaining: 5_000, percent: 50, receiptCount: 2 });
  });

  it('giao dư: còn 0, 100%', () => {
    const data = { ...base, transactions: [tx({ date: '2026-12-01T03:00:00.000Z', lines: [coffee(12_000)] })] };
    expect(contractProgress(data, contract)).toMatchObject({ remaining: 0, percent: 100 });
  });

  it('hợp đồng không có id người / mặt hàng thì khớp theo tên, bỏ dấu, không phân biệt hoa thường', () => {
    const { data, contract: byName } = addSeasonContract(emptyData(), { ...input, counterpartyId: undefined, counterpartyName: 'co le thi mai' });
    const withTx = { ...data, transactions: [tx({ date: '2026-12-01T03:00:00.000Z', lines: [line({ productName: 'CÀ PHÊ NHÂN', grossWeight: 100 })] })] };
    expect(contractProgress(withTx, byName).delivered).toBe(100);
  });

  it('phiếu vừa chốt tìm được hợp đồng còn mở của nó; hợp đồng đã đóng thì không', () => {
    const t = tx({ date: '2026-12-01T03:00:00.000Z', lines: [coffee(100)] });
    expect(contractsForTransaction(base, t).map((c) => c.id)).toEqual([contract.id]);
    expect(contractsForTransaction(updateSeasonContract(base, contract.id, { closed: true }), t)).toEqual([]);
  });
});
