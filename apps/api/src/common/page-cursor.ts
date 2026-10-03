/**
 * Cursor phân trang "mới nhất trước" theo `(created_at, id)` — đơn, thông báo. Không ký: sửa cursor
 * chỉ đọc lại dữ liệu mà RLS vốn cho tổ chức này thấy. Cột `created_at` của các bảng phân trang
 * kiểu này là `timestamptz(3)` — bằng độ chính xác của JS Date, so sánh không lệch.
 */

import type { Prisma } from '../generated/prisma/client';
import { z } from 'zod';
import { ApiException } from './api-exception';

const Cursor = z.strictObject({ d: z.iso.datetime(), i: z.uuid() });

export const encodeCursor = (row: { readonly createdAt: Date; readonly id: string }): string =>
  Buffer.from(JSON.stringify({ d: row.createdAt.toISOString(), i: row.id })).toString('base64url');

const decodeCursor = (raw: string): z.infer<typeof Cursor> => {
  try {
    return Cursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new ApiException('VALIDATION_FAILED', 'Cursor không hợp lệ — tải lại từ đầu', { fields: { cursor: 'Cursor không hợp lệ' } });
  }
};

/** Điều kiện "sau cursor" cho `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`. */
export const olderThan = (raw: string | undefined): Prisma.OrderWhereInput & Prisma.NotificationWhereInput => {
  if (!raw) return {};
  const { d, i } = decodeCursor(raw);
  return { OR: [{ createdAt: { lt: new Date(d) } }, { createdAt: new Date(d), id: { lt: i } }] };
};
