import { describe, expect, it } from 'vitest';
import {
  computeReceiptTotal,
  freezeLineTotals,
  lineNetWeight,
  linePhysicalWeight,
  linePrice,
  lineTotals,
  roundToThousand,
  totalAdjustments,
  transactionHasProduct,
  transactionProducts,
  transactionTotals,
} from '../src/calc';
import { line, tx } from './fixtures';

describe('lineNetWeight — bốn cách tính', () => {
  it('standard: tính tiền theo đúng số cân được', () => {
    expect(lineNetWeight(line({ formulaType: 'standard', grossWeight: 320 }))).toBe(320);
  });

  it('netAfterTare: cân 320, bì 20 → tính tiền 300', () => {
    expect(
      lineNetWeight(line({ formulaType: 'netAfterTare', grossWeight: 320, tareWeight: 20 })),
    ).toBe(300);
  });

  it('netAfterTare: bì lớn hơn cân → 0, không bao giờ âm', () => {
    expect(
      lineNetWeight(line({ formulaType: 'netAfterTare', grossWeight: 50, tareWeight: 60 })),
    ).toBe(0);
  });

  it('rubberLatex: cao su 320kg hàm lượng 31% → 99,2kg quy khô', () => {
    expect(
      lineNetWeight(line({ formulaType: 'rubberLatex', grossWeight: 320, qualityPercent: 31 })),
    ).toBe(99.2);
  });

  it('rubberLatex: hàm lượng 0% → không tính tiền kí nào', () => {
    expect(
      lineNetWeight(line({ formulaType: 'rubberLatex', grossWeight: 320, qualityPercent: 0 })),
    ).toBe(0);
  });

  it('rubberLatex: hàm lượng 100% → đúng bằng số cân được', () => {
    expect(
      lineNetWeight(line({ formulaType: 'rubberLatex', grossWeight: 320, qualityPercent: 100 })),
    ).toBe(320);
  });

  it('rubberLatex: thiếu hàm lượng → coi như 0, không tính bừa', () => {
    expect(lineNetWeight(line({ formulaType: 'rubberLatex', grossWeight: 320 }))).toBe(0);
  });

  it('lossPercent: 200kg hao hụt 5% → 190kg', () => {
    expect(
      lineNetWeight(line({ formulaType: 'lossPercent', grossWeight: 200, lossPercent: 5 })),
    ).toBe(190);
  });

  it('lossPercent: hao hụt 100% → 0', () => {
    expect(
      lineNetWeight(line({ formulaType: 'lossPercent', grossWeight: 200, lossPercent: 100 })),
    ).toBe(0);
  });

  it('cân âm (lỗi nhập) không kéo tiền xuống âm', () => {
    expect(lineNetWeight(line({ formulaType: 'standard', grossWeight: -10 }))).toBe(0);
  });
});

describe('linePhysicalWeight — khối lượng VẬT LÝ, không quy đổi', () => {
  it('cao su hàm lượng 31%: vật lý vẫn là 320kg dù tính tiền chỉ 99,2kg', () => {
    const l = line({ formulaType: 'rubberLatex', grossWeight: 320, qualityPercent: 31 });
    expect(linePhysicalWeight(l)).toBe(320);
    expect(lineNetWeight(l)).toBe(99.2);
  });
});

describe('roundToThousand', () => {
  it('làm tròn lên khi đúng nửa nghìn', () => {
    expect(roundToThousand(1500)).toBe(2000);
    expect(roundToThousand(500)).toBe(1000);
  });

  it('làm tròn xuống khi dưới nửa nghìn', () => {
    expect(roundToThousand(1499)).toBe(1000);
    expect(roundToThousand(499)).toBe(0);
  });

  it('số âm (khoản trừ bớt) làm tròn về phía số lớn hơn — quy ước hiện hành', () => {
    expect(roundToThousand(-1500)).toBe(-1000);
    expect(roundToThousand(-1600)).toBe(-2000);
    expect(roundToThousand(-1400)).toBe(-1000);
  });
});

describe('linePrice — chấp nhận dữ liệu cũ', () => {
  it('phiếu cũ chỉ có pricePerKg vẫn ra đúng đơn giá', () => {
    expect(linePrice({ pricePerUnit: undefined as unknown as number, pricePerKg: 14_500 })).toBe(
      14_500,
    );
  });

  it('không có giá nào → 0', () => {
    expect(linePrice({ pricePerUnit: undefined as unknown as number })).toBe(0);
  });
});

describe('lineTotals — cao su 320kg × 31% × 14.500đ', () => {
  const l = line({
    formulaType: 'rubberLatex',
    grossWeight: 320,
    qualityPercent: 31,
    pricePerUnit: 14_500,
  });

  it('tạm tính = 99,2 × 14.500 = 1.438.400', () => {
    expect(lineTotals(l).rawTotal).toBe(1_438_400);
  });

  it('thành tiền làm tròn nghìn = 1.438.000', () => {
    expect(lineTotals(l).total).toBe(1_438_000);
  });
});

describe('freezeLineTotals — tiền đã chốt thì không đổi nữa', () => {
  const frozen = freezeLineTotals(
    line({ formulaType: 'standard', grossWeight: 100, pricePerUnit: 10_000 }),
  );

  it('đóng băng đúng số tiền đang tính', () => {
    expect(frozen.rawTotal).toBe(1_000_000);
    expect(frozen.roundedTotal).toBe(1_000_000);
  });

  it('đổi đơn giá sau khi chốt KHÔNG làm đổi tiền của phiếu cũ', () => {
    expect(lineTotals({ ...frozen, pricePerUnit: 99_000 }).total).toBe(1_000_000);
  });

  it('đóng băng lần hai cho kết quả y hệt', () => {
    expect(freezeLineTotals(frozen)).toEqual(frozen);
  });

  it('đóng băng tính lại từ đầu, bỏ qua số cũ ghi sai trong file', () => {
    const wrong = line({ grossWeight: 100, pricePerUnit: 10_000, rawTotal: 7, roundedTotal: 7 });
    expect(freezeLineTotals(wrong).roundedTotal).toBe(1_000_000);
  });
});

describe('totalAdjustments', () => {
  it('không có khoản cộng/trừ nào → 0 (dữ liệu cũ không bị lệch)', () => {
    expect(totalAdjustments(undefined)).toBe(0);
    expect(totalAdjustments([])).toBe(0);
  });

  it('làm tròn nghìn ở TỔNG, không làm tròn từng khoản', () => {
    expect(
      totalAdjustments([
        { id: 'a', kind: 'logistics', label: 'Phí xe', amount: 500 },
        { id: 'b', kind: 'manual', label: 'Bù cân', amount: 600 },
      ]),
    ).toBe(1_000);
  });

  it('khoản trừ bớt giữ dấu âm', () => {
    expect(
      totalAdjustments([{ id: 'a', kind: 'volumeDiscount', label: 'Bớt giá', amount: -50_000 }]),
    ).toBe(-50_000);
  });
});

describe('computeReceiptTotal — phiếu nhiều dòng', () => {
  it('cộng dồn cả khối lượng tính tiền lẫn thành tiền', () => {
    const result = computeReceiptTotal([
      line({ id: 'l1', grossWeight: 100, pricePerUnit: 10_000 }),
      line({ id: 'l2', grossWeight: 50, pricePerUnit: 20_000 }),
    ]);
    expect(result.netWeight).toBe(150);
    expect(result.total).toBe(2_000_000);
  });
});

describe('transactionTotals — bất biến nợ', () => {
  it('nợ = thành tiền − đã trả', () => {
    const t = tx({ lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })], amountPaid: 400_000 });
    expect(transactionTotals(t)).toEqual({ netWeight: 100, total: 1_000_000, debt: 600_000 });
  });

  it('trả dư (nhập nhầm) KHÔNG bao giờ ra nợ âm', () => {
    const t = tx({
      lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })],
      amountPaid: 5_000_000,
    });
    expect(transactionTotals(t).debt).toBe(0);
  });

  it('khoản trừ bớt làm giảm cả thành tiền lẫn nợ', () => {
    const t = tx({
      lines: [line({ grossWeight: 100, pricePerUnit: 10_000 })],
      amountPaid: 0,
      adjustments: [{ id: 'a', kind: 'logistics', label: 'Phí xe', amount: -50_000 }],
    });
    expect(transactionTotals(t).total).toBe(950_000);
    expect(transactionTotals(t).debt).toBe(950_000);
  });

  it('phiếu v2 chưa có khoản cộng/trừ ra kết quả y hệt trước đây', () => {
    const lines = [line({ grossWeight: 100, pricePerUnit: 10_000 })];
    expect(transactionTotals({ lines, amountPaid: 0, adjustments: undefined })).toEqual(
      transactionTotals({ lines, amountPaid: 0, adjustments: [] }),
    );
  });
});

describe('transactionProducts / transactionHasProduct', () => {
  const t = tx({
    lines: [
      line({ id: 'l1', productName: 'Cao su', crop: 'rubber' }),
      line({ id: 'l2', productName: 'Điều' }),
      line({ id: 'l3', productName: 'Cao su' }),
    ],
  });

  it('liệt kê mặt hàng không trùng lặp', () => {
    expect(transactionProducts(t)).toEqual(['Cao su', 'Điều']);
  });

  it('tìm được theo tên mặt hàng và theo loại cây', () => {
    expect(transactionHasProduct(t, 'Điều')).toBe(true);
    expect(transactionHasProduct(t, 'rubber')).toBe(true);
    expect(transactionHasProduct(t, 'Hồ tiêu')).toBe(false);
  });

  it('dòng thiếu tên vẫn hiện là "Mặt hàng", không rỗng', () => {
    expect(transactionProducts(tx({ lines: [line({ productName: '' })] }))).toEqual(['Mặt hàng']);
  });
});
