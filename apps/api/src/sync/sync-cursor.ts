/**
 * Cursor của /v1/sync/pull — với app là chuỗi mờ; ở đây là JSON base64url.
 *
 * Một LƯỢT kéo đi qua tám bảng theo thứ tự `SYNC_ENTITIES` (lần trả tiền cuối cùng), mỗi
 * bảng phân trang theo (updated_at, id), và mọi trang của lượt dùng CHUNG mốc `until` lấy
 * từ đồng hồ database lúc lượt bắt đầu. Xong lượt, cursor "nghỉ" chỉ còn `since` = `until`
 * lùi CHỒNG_LẤN: lượt sau lấy lại cả những bản ghi mà transaction ghi chúng bắt đầu trước
 * `until` nhưng commit sau khi ta đã đọc qua bảng đó. Không dùng giờ máy khách ở đâu cả.
 *
 * Không ký: sửa cursor chỉ làm người đó đọc lại dữ liệu của chính tổ chức mình (RLS), và
 * phạm vi chi nhánh luôn lấy từ membership, không lấy từ cursor.
 */

import { SYNC_ENTITIES } from '@mambo/contracts';
import { z } from 'zod';
import { ApiException } from '../common/api-exception';

/**
 * Lớn hơn hẳn thời gian sống tối đa của một transaction ghi (Prisma: 5 giây) — bản ghi
 * nào có `updated_at` trước mốc `until` − CHỒNG_LẤN chắc chắn đã commit trước `until`.
 */
export const PULL_OVERLAP_MS = 15_000;

const Time = z.iso.datetime();

const Cursor = z.strictObject({
  v: z.literal(1),
  /** Tổ chức — cursor của tổ chức khác bị từ chối. */
  o: z.uuid(),
  /** Phạm vi chi nhánh lúc cấp cursor; lệch với membership hiện tại → resetRequired. */
  b: z.uuid().nullable(),
  /** Chỉ lấy bản ghi có updated_at SAU mốc này. null = từ đầu. */
  s: Time.nullable(),
  /** Mốc trên của lượt đang chạy. null = cursor nghỉ, lượt mới sẽ lấy giờ database. */
  u: Time.nullable(),
  /** Đang ở bảng thứ mấy trong SYNC_ENTITIES. */
  t: z.number().int().min(0).max(SYNC_ENTITIES.length),
  /** Bản ghi cuối đã trả trong bảng đang dở. */
  k: z.strictObject({ at: Time, id: z.uuid() }).nullable(),
});
export type PullCursor = z.infer<typeof Cursor>;

export const startCursor = (orgId: string, branchId: string | null): PullCursor => ({
  v: 1,
  o: orgId,
  b: branchId,
  s: null,
  u: null,
  t: 0,
  k: null,
});

export const encodeCursor = (cursor: PullCursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url');

const invalid = (): ApiException =>
  new ApiException('VALIDATION_FAILED', 'Cursor không hợp lệ — kéo lại từ đầu (bỏ cursor)', {
    fields: { cursor: 'Cursor không hợp lệ' },
  });

export const decodeCursor = (raw: string, orgId: string): PullCursor => {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const parsed = Cursor.safeParse(json);
  if (!parsed.success || parsed.data.o !== orgId) throw invalid();
  return parsed.data;
};
