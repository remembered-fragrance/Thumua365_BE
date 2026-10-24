/**
 * Nhật ký thao tác — KE_HOACH_GOI_PRO V6, D4. Máy chủ ghi ở MỌI bậc gói (xoá phiếu, huỷ lần trả, sửa ghi chú /
 * ảnh của phiếu, thêm / gỡ / đổi quyền người, chi nhánh…); đọc cần quyền `staff:manage` và quyền lợi
 * `audit:view`.
 *
 * `action` để chuỗi, không enum: máy chủ thêm loại thao tác mới thì app cũ vẫn đọc được trang (hiện tên thô),
 * không vỡ cả màn vì `CONTRACT_MISMATCH`. `before` / `after` là ảnh chụp tự do theo từng `action`.
 */

import { z } from 'zod';

const Time = z.iso.datetime({ offset: true });

export const AuditQuery = z.strictObject({
  /** Chỉ việc của một người. */
  actor: z.uuid().optional(),
  from: Time.optional(),
  to: Time.optional(),
  cursor: z.string().min(1).max(500).optional(),
  /** Mặc định 50. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type AuditQuery = z.output<typeof AuditQuery>;

export const AuditEntryView = z.object({
  id: z.uuid(),
  at: Time,
  /** `null` = máy chủ tự làm (kích hoạt gói từ ngân hàng…). */
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type AuditEntryView = z.infer<typeof AuditEntryView>;

/** Mới nhất trước. `cursor` null = hết. */
export const AuditResult = z.object({ entries: z.array(AuditEntryView), cursor: z.string().nullable() });
export type AuditResult = z.infer<typeof AuditResult>;
