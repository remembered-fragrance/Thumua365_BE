/**
 * Bản đồ thu mua — vựa / thương lái và doanh nghiệp tự đặt địa điểm của mình, MỌI người đã đăng nhập
 * (cả nông dân) đều xem được. Mang sang từ LiveMap.
 *
 * Toạ độ giới hạn trong khung Việt Nam, gồm cả quần đảo Hoàng Sa và Trường Sa. Database giữ cùng
 * luật (CHECK `places_lat_vn`, `places_lng_vn`). Vị trí của NGƯỜI DÙNG không bao giờ lên server —
 * chỉ địa điểm do tổ chức chủ động đặt.
 *
 * Mỗi tổ chức tối đa `PLACES_PER_ORG_LIMIT` địa điểm đang hiện; vượt → 422 `VALIDATION_FAILED`,
 * `details.reason: 'PLACE_LIMIT'`, `details.limit`.
 */

import { z } from 'zod';
import { PlaceKind } from './organization.js';

export const VN_BOUNDS = { minLat: 7, maxLat: 24, minLng: 102, maxLng: 118 } as const;

const OUTSIDE_VN = 'Vị trí nằm ngoài Việt Nam';

export const Latitude = z.number().min(VN_BOUNDS.minLat, OUTSIDE_VN).max(VN_BOUNDS.maxLat, OUTSIDE_VN);
export const Longitude = z.number().min(VN_BOUNDS.minLng, OUTSIDE_VN).max(VN_BOUNDS.maxLng, OUTSIDE_VN);

/** Trường chữ tuỳ chọn: chuỗi rỗng sau khi trim coi như bỏ trống (null). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Tối đa ${max} ký tự`)
    .nullish()
    .transform((v) => (v ? v : null));

/** V9 — tối đa số mặt hàng kèm giá trên một địa điểm. */
export const PLACE_PRICES_LIMIT = 10;

/** V9 — giá thu mua một mặt hàng tại điểm này. Đồng / đơn vị. */
export const PlacePrice = z.strictObject({
  product: z.string().trim().min(1, 'Nhập tên mặt hàng').max(60, 'Tối đa 60 ký tự'),
  price: z.number().int('Giá là số đồng chẵn').min(1, 'Nhập giá').max(1e9),
  unit: z.string().trim().min(1).max(20).default('kg'),
});
export type PlacePrice = z.output<typeof PlacePrice>;

/**
 * V9 — gói Pro (`map:prices`). Gửi danh sách (kể cả rỗng) là thay cả bảng giá và đặt lại `pricesUpdatedAt`;
 * gửi danh sách có giá khi hết gói → 402 `PLAN_REQUIRED`. Rỗng / `null` (gỡ giá) thì gói nào cũng được.
 */
const PlacePrices = z.array(PlacePrice).max(PLACE_PRICES_LIMIT, `Tối đa ${PLACE_PRICES_LIMIT} mặt hàng`);

export const Place = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string(),
  kind: PlaceKind,
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  description: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  /**
   * V9 — giá thu mua chủ điểm khai. Rỗng khi chưa khai, hoặc khi gói của chủ điểm đã hết (giá cũ không hiện để
   * khỏi làm nông hộ hiểu lầm — gia hạn là hiện lại).
   */
  prices: z.array(PlacePrice).default([]),
  /** Lúc khai bảng giá gần nhất; `null` khi không có giá. App ghi "Giá hôm nay" khi trùng ngày. */
  pricesUpdatedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Place = z.infer<typeof Place>;

const PlaceName = z.string().trim().min(1, 'Nhập tên địa điểm').max(120, 'Tối đa 120 ký tự');

export const PlaceInput = z.strictObject({
  name: PlaceName,
  address: optionalText(255),
  phone: optionalText(20),
  description: optionalText(1000),
  lat: Latitude,
  lng: Longitude,
  prices: PlacePrices.nullish(),
});
export type PlaceInput = z.input<typeof PlaceInput>;

export const PlacePatch = z
  .strictObject({
    name: PlaceName.optional(),
    address: optionalText(255).optional(),
    phone: optionalText(20).optional(),
    description: optionalText(1000).optional(),
    lat: Latitude.optional(),
    lng: Longitude.optional(),
    prices: PlacePrices.nullish(),
  })
  .refine((p) => (p.lat === undefined) === (p.lng === undefined), {
    message: 'Gửi cả lat và lng khi đổi vị trí',
    path: ['lat'],
  });
export type PlacePatch = z.input<typeof PlacePatch>;

export const PlaceIdParams = z.strictObject({ id: z.uuid() });
export type PlaceIdParams = z.infer<typeof PlaceIdParams>;

const NUMBER = /^-?\d+(\.\d+)?$/;

/** `minLng,minLat,maxLng,maxLat` — đúng thứ tự `map.getBounds().toBBoxString()` của Leaflet. */
export const BBox = z.string().transform((raw, ctx) => {
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length !== 4 || !parts.every((p) => NUMBER.test(p))) {
    ctx.addIssue({ code: 'custom', message: 'bbox phải là minLng,minLat,maxLng,maxLat' });
    return z.NEVER;
  }
  const [minLng, minLat, maxLng, maxLat] = parts.map(Number) as [number, number, number, number];
  if (minLng >= maxLng || minLat >= maxLat) {
    ctx.addIssue({ code: 'custom', message: 'bbox ngược chiều' });
    return z.NEVER;
  }
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) {
    ctx.addIssue({ code: 'custom', message: 'bbox ngoài khoảng toạ độ' });
    return z.NEVER;
  }
  return { minLng, minLat, maxLng, maxLat };
});
export type BBox = z.output<typeof BBox>;

const KindList = z.array(PlaceKind).min(1);

export const PlacesQuery = z.strictObject({
  bbox: BBox,
  /** `trader,enterprise` — bỏ trống = cả hai. */
  kinds: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return [...PlaceKind.options];
      const parsed = KindList.safeParse(
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: 'kinds chỉ gồm trader, enterprise' });
        return z.NEVER;
      }
      return [...new Set(parsed.data)];
    }),
});
export type PlacesQuery = z.input<typeof PlacesQuery>;

/** Tối đa số địa điểm một lần trả về theo khung nhìn. */
export const PLACES_PAGE_LIMIT = 500;

/** Tối đa số địa điểm đang hiện của một tổ chức. */
export const PLACES_PER_ORG_LIMIT = 100;

export const PlacesList = z.object({
  items: z.array(Place),
  /** true khi khung nhìn có nhiều hơn PLACES_PAGE_LIMIT điểm — phóng to để thấy hết. */
  truncated: z.boolean(),
});
export type PlacesList = z.infer<typeof PlacesList>;

export const PlaceDeleteResult = z.object({ ok: z.literal(true) });
export type PlaceDeleteResult = z.infer<typeof PlaceDeleteResult>;
