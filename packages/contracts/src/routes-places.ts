/** Bản đồ thu mua — một phần của danh bạ `routes`. */

import { Place, PlaceDeleteResult, PlaceIdParams, PlaceInput, PlacePatch, PlacesList, PlacesQuery } from './places.js';
import type { RouteDef } from './route-def.js';

export const placeRoutes = {
  placesList: {
    method: 'GET',
    path: '/v1/places',
    summary:
      'Địa điểm của vựa / doanh nghiệp trong khung nhìn bản đồ, mới sửa trước, tối đa 500 (truncated = còn nữa). Mọi vai trò đều xem được',
    auth: 'user',
    query: PlacesQuery,
    response: PlacesList,
  },
  placeGet: {
    method: 'GET',
    path: '/v1/places/:id',
    summary: 'Một địa điểm đang hiện trên bản đồ',
    auth: 'user',
    params: PlaceIdParams,
    response: Place,
    errors: ['NOT_FOUND'],
  },
  orgPlacesList: {
    method: 'GET',
    path: '/v1/org/places',
    summary: 'Địa điểm của tổ chức đang làm việc, mới sửa trước',
    auth: 'org',
    permission: 'place:manage',
    response: PlacesList,
  },
  orgPlaceCreate: {
    method: 'POST',
    path: '/v1/org/places',
    summary:
      'Đặt một địa điểm của tổ chức đang làm việc lên bản đồ. Loại (vựa / doanh nghiệp) theo loại tổ chức. Tối đa 100 điểm mỗi tổ chức',
    auth: 'org',
    permission: 'place:manage',
    body: PlaceInput,
    response: Place,
    errors: ['PLAN_REQUIRED'],
    rateLimitPerMinute: 30,
  },
  orgPlaceUpdate: {
    method: 'PATCH',
    path: '/v1/org/places/:id',
    summary: 'Sửa địa điểm của tổ chức đang làm việc — đổi vị trí thì gửi cả lat và lng',
    auth: 'org',
    permission: 'place:manage',
    params: PlaceIdParams,
    body: PlacePatch,
    response: Place,
    errors: ['NOT_FOUND', 'PLAN_REQUIRED'],
  },
  orgPlaceDelete: {
    method: 'DELETE',
    path: '/v1/org/places/:id',
    summary: 'Gỡ địa điểm của tổ chức đang làm việc khỏi bản đồ (xoá mềm)',
    auth: 'org',
    permission: 'place:manage',
    params: PlaceIdParams,
    response: PlaceDeleteResult,
    errors: ['NOT_FOUND'],
  },
} as const satisfies Record<string, RouteDef>;
