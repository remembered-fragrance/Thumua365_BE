import { describe, expect, it } from 'vitest';
import { BBox, hasPlaces, ORG_TYPES, PlaceInput, PlacePatch, PlacesQuery, can } from '../src/index.js';

describe('PlaceInput', () => {
  const ok = { name: 'Vựa sầu riêng Cái Bè', lat: 10.34, lng: 106.03 };

  it('nhận điểm trong Việt Nam, chữ rỗng thành null', () => {
    expect(PlaceInput.parse({ ...ok, address: '  ', phone: '' })).toEqual({ ...ok, address: null, phone: null, description: null });
  });

  it.each([
    ['Bangkok', 13.75, 100.5],
    ['Vientiane', 17.97, 101.6],
    ['Quảng Châu', 23.13, 118.26],
    ['Singapore', 1.35, 103.82],
  ])('chặn %s (ngoài khung Việt Nam)', (_name, lat, lng) => {
    expect(PlaceInput.safeParse({ ...ok, lat, lng }).success).toBe(false);
  });

  it.each([
    ['Hoàng Sa', 16.5, 112.0],
    ['Trường Sa', 10.0, 114.5],
    ['Lũng Cú', 23.36, 105.32],
    ['Mũi Cà Mau', 8.6, 104.72],
  ])('nhận %s', (_name, lat, lng) => {
    expect(PlaceInput.safeParse({ ...ok, lat, lng }).success).toBe(true);
  });

  it('không nhận trường lạ — loại địa điểm, tổ chức do server đặt', () => {
    expect(PlaceInput.safeParse({ ...ok, kind: 'trader' }).success).toBe(false);
    expect(PlaceInput.safeParse({ ...ok, organizationId: '00000000-0000-4000-8000-000000000000' }).success).toBe(false);
  });

  it('tên rỗng sau khi trim, chữ quá dài ⇒ lỗi', () => {
    expect(PlaceInput.safeParse({ ...ok, name: '   ' }).success).toBe(false);
    expect(PlaceInput.safeParse({ ...ok, description: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('PlacePatch', () => {
  it('lat và lng phải đi cặp', () => {
    expect(PlacePatch.safeParse({ lat: 10.5 }).success).toBe(false);
    expect(PlacePatch.safeParse({ lat: 10.5, lng: 106 }).success).toBe(true);
    expect(PlacePatch.safeParse({ name: 'Mới' }).success).toBe(true);
  });

  it('gửi null xoá trường tuỳ chọn; bỏ trống thì không đụng', () => {
    expect(PlacePatch.parse({ phone: null })).toEqual({ phone: null });
    expect(PlacePatch.parse({})).toEqual({});
  });
});

describe('BBox / PlacesQuery', () => {
  it('đọc đúng thứ tự minLng,minLat,maxLng,maxLat', () => {
    expect(BBox.parse('105.5,9.8,106.3,10.6')).toEqual({ minLng: 105.5, minLat: 9.8, maxLng: 106.3, maxLat: 10.6 });
  });

  it.each(['', '1,2,3', 'a,b,c,d', '106,10,105,11', '1e2,1,2,3', '100,-95,110,10', '-200,1,2,3'])('chặn bbox "%s"', (raw) => {
    expect(BBox.safeParse(raw).success).toBe(false);
  });

  it('kinds bỏ trống = cả hai; lặp thì gộp; loại lạ bị chặn', () => {
    expect(PlacesQuery.parse({ bbox: '105,9,107,11' }).kinds).toEqual(['trader', 'enterprise']);
    expect(PlacesQuery.parse({ bbox: '105,9,107,11', kinds: 'trader,trader' }).kinds).toEqual(['trader']);
    expect(PlacesQuery.safeParse({ bbox: '105,9,107,11', kinds: 'farmer' }).success).toBe(false);
  });

  it('không nhận tham số lạ', () => {
    expect(PlacesQuery.safeParse({ bbox: '105,9,107,11', limit: '5' }).success).toBe(false);
  });
});

describe('ai đặt được địa điểm', () => {
  it('chỉ tổ chức có địa điểm mới có quyền place:manage', () => {
    for (const type of ORG_TYPES) {
      for (const role of ['owner', 'manager', 'staff'] as const) {
        if (can(type, role, 'place:manage')) expect(hasPlaces(type)).toBe(true);
      }
    }
  });
});
