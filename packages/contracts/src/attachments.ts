/**
 * Ảnh chứng từ — KH backend §6, BE8. Ảnh (phiếu cân, hoá đơn) nằm ở Supabase Storage, bucket riêng
 * tư `attachments`, đường dẫn `<organizationId>/<attachmentId>`. App KHÔNG cầm khoá Storage nào:
 * xin URL có chữ ký từ API rồi tải thẳng lên / xem thẳng từ Storage.
 *
 *   Tải lên: chụp lúc mất mạng thì lưu IndexedDB trước, xếp hàng; có mạng → `upload-url` → `PUT`
 *   thân là ảnh. Không ghi đè được: `PUT` lại một ảnh đã lên trả 409 — coi là ĐÃ XONG (lần trước lên
 *   rồi mà mất phản hồi). Id ảnh do app sinh (UUID), nằm trong `attachmentIds` của phiếu / nháp.
 *   Xem: `GET /attachments/:id/url` — chỉ cho ảnh mà một phiếu hay nháp mình được thấy đang nhắc tới
 *   (cùng phạm vi chi nhánh như sổ). URL hết hạn sau `expiresAt`, mở lại phải xin URL mới.
 */

import { z } from 'zod';

const Time = z.iso.datetime({ offset: true });

/** App nén ảnh về JPEG cạnh dài 1600px — ảnh thật ~0,3–0,8MB. Bucket chặn cùng giới hạn này. */
export const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const AttachmentContentType = z.enum(ATTACHMENT_TYPES);
export type AttachmentContentType = z.infer<typeof AttachmentContentType>;

export const AttachmentUploadInput = z.strictObject({
  attachmentId: z.uuid(),
  contentType: AttachmentContentType,
  /** Số byte của ảnh sẽ gửi. Lớn hơn giới hạn → 422 (ngay ở đây, đỡ tốn mạng). */
  size: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
});
export type AttachmentUploadInput = z.input<typeof AttachmentUploadInput>;

export const AttachmentUploadUrl = z.object({
  attachmentId: z.uuid(),
  /** `PUT` ảnh vào đây, kèm đúng `headers`. */
  uploadUrl: z.url(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: Time,
});
export type AttachmentUploadUrl = z.infer<typeof AttachmentUploadUrl>;

export const AttachmentIdParams = z.strictObject({ id: z.uuid() });
export type AttachmentIdParams = z.infer<typeof AttachmentIdParams>;

export const AttachmentDownloadUrl = z.object({
  attachmentId: z.uuid(),
  url: z.url(),
  expiresAt: Time,
});
export type AttachmentDownloadUrl = z.infer<typeof AttachmentDownloadUrl>;
