import { lineTotals, transactionTotals } from './calc';
import { formatDateTime, formatQuantity, formatVnd } from './format';
import type { Transaction } from './types';

/**
 * Nội dung phiếu dạng chữ — dùng để gửi Zalo/SMS.
 * Thuần: chỉ nhận Transaction, trả về string. Không chạm DOM, không chia sẻ.
 * Việc gửi đi nằm ở `export/`.
 */
export const receiptShareText = (t: Transaction): string => {
  const lines = t.lines
    .map((l) => {
      const lt = lineTotals(l);
      const quality = l.formulaType === 'rubberLatex' ? `, hàm lượng ${l.qualityPercent ?? 0}%` : '';
      return `- ${l.productName}: cân ${formatQuantity(l.grossWeight, l.unit)}${quality}, tính tiền ${formatQuantity(lt.netWeight, l.unit)}, ${formatVnd(lt.total)}`;
    })
    .join('\n');

  const { netWeight, total, debt } = transactionTotals(t);
  const isSale = t.kind === 'sale';
  return `${isSale ? 'PHIẾU BÁN HÀNG' : 'PHIẾU THU MUA'} - THUMUA365
${isSale ? 'Người mua' : 'Người bán'}: ${t.supplierName}
Thời gian: ${formatDateTime(t.date)}
${lines}
Tổng tính tiền: ${formatQuantity(netWeight)}
Thành tiền: ${formatVnd(total)}
Đã trả: ${formatVnd(t.amountPaid)}${debt > 0 ? `\nCòn nợ: ${formatVnd(debt)}` : ''}`;
};
