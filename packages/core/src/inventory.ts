import { linePhysicalWeight, lineTotals } from './calc';
import { purchases, sales } from './selectors';
import type { AppData } from './types';

// ─── Inventory (Workstream F4) ────────────────────────────────────────────────

export interface InventoryRow {
  readonly productName: string;
  readonly purchasedKg: number;
  readonly soldKg: number;
  readonly stockKg: number;
}

/**
 * Tính tồn kho theo mặt hàng.
 * Dùng linePhysicalWeight (grossWeight) — KHÔNG dùng lineNetWeight để tránh sai số tồn kho
 * với cao su rubberLatex (lineNetWeight trả về KL quy đổi, không phải KL vật lý).
 */
export const inventoryByProduct = (data: AppData): InventoryRow[] => {
  const map = new Map<string, { purchased: number; sold: number }>();

  for (const t of purchases(data)) {
    for (const line of t.lines) {
      const name = line.productName || 'Mặt hàng';
      const cur = map.get(name) ?? { purchased: 0, sold: 0 };
      map.set(name, { ...cur, purchased: cur.purchased + linePhysicalWeight(line) });
    }
  }

  for (const t of sales(data)) {
    for (const line of t.lines) {
      const name = line.productName || 'Mặt hàng';
      const cur = map.get(name) ?? { purchased: 0, sold: 0 };
      map.set(name, { ...cur, sold: cur.sold + linePhysicalWeight(line) });
    }
  }

  return [...map.entries()]
    .map(([productName, { purchased, sold }]) => ({
      productName,
      purchasedKg: Math.round(purchased * 100) / 100,
      soldKg: Math.round(sold * 100) / 100,
      stockKg: Math.round((purchased - sold) * 100) / 100,
    }))
    .sort((a, b) => b.stockKg - a.stockKg);
};

// ─── Giá vốn và giá trị tồn (giai đoạn E) ────────────────────────────────────

export interface InventoryValueRow extends InventoryRow {
  /** Trung bình đã trả cho một kg VẬT LÝ của mặt hàng này. */
  readonly avgCostPerKg: number;
  /** Tồn × giá vốn — ước tính, không phải giá bán. */
  readonly stockValue: number;
}

/**
 * Thêm giá vốn bình quân và giá trị tồn ước tính.
 *
 * Selector MỚI, không sửa `inventoryByProduct` — màn Tổng quan vẫn dùng bản cũ.
 *
 * Giá vốn chia cho khối lượng VẬT LÝ đã mua, cùng mẫu số với cột tồn. Nếu chia
 * cho khối lượng tính tiền thì cao su 320kg × 31% ra giá vốn gấp ba lần thật.
 */
export const inventoryValues = (data: AppData): InventoryValueRow[] => {
  const cost = new Map<string, { money: number; kg: number }>();

  for (const t of purchases(data)) {
    for (const line of t.lines) {
      const name = line.productName || 'Mặt hàng';
      const cur = cost.get(name) ?? { money: 0, kg: 0 };
      cost.set(name, {
        money: cur.money + lineTotals(line).total,
        kg: cur.kg + linePhysicalWeight(line),
      });
    }
  }

  return inventoryByProduct(data).map((row) => {
    const c = cost.get(row.productName);
    const avgCostPerKg = c && c.kg > 0 ? Math.round(c.money / c.kg) : 0;
    return {
      ...row,
      avgCostPerKg,
      // Tồn âm là dấu hiệu nhập sai; nhân ra tiền âm chỉ làm rối thêm.
      stockValue: row.stockKg > 0 ? Math.round(row.stockKg * avgCostPerKg) : 0,
    };
  });
};
