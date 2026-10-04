/**
 * Ảnh chứng từ — KH backend §6, BE8. API chỉ KÝ URL; ảnh đi thẳng giữa app và Supabase Storage.
 *
 * Đường dẫn luôn là `<tổ chức đang làm việc>/<id ảnh>` — tổ chức này không ký được URL vào thư mục
 * của tổ chức khác, kể cả khi biết id. Xem ảnh còn phải có một phiếu / nháp mình được thấy (qua
 * RLS, cùng phạm vi chi nhánh như sổ) nhắc tới id đó: người cân chi nhánh A không mở được ảnh phiếu
 * chi nhánh B.
 */

import type { AttachmentDownloadUrl, AttachmentUploadInput, AttachmentUploadUrl } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { ApiException } from '../common/api-exception';
import { DATABASE, type Database } from '../db/database';
import { ATTACHMENTS_BUCKET, STORAGE_ADMIN, type StorageAdmin, UPLOAD_URL_TTL_MS } from '../storage/storage-admin';

/** URL xem ảnh sống ngần này — đủ để mở và phóng to, hết thì phải xin lại. */
export const DOWNLOAD_URL_TTL_SECONDS = 600;

const pathOf = (m: MembershipContext, attachmentId: string): string => `${m.organizationId}/${attachmentId}`;

@Injectable()
export class AttachmentsService {
  private readonly db: Database;
  private readonly storage: StorageAdmin;

  constructor(@Inject(DATABASE) db: Database, @Inject(STORAGE_ADMIN) storage: StorageAdmin) {
    this.db = db;
    this.storage = storage;
  }

  /** Không cần phiếu có trước: ảnh chụp lúc mất mạng có thể lên trước op của phiếu. */
  async uploadUrl(m: MembershipContext, input: z.output<typeof AttachmentUploadInput>): Promise<AttachmentUploadUrl> {
    const uploadUrl = await this.storage.signUpload(ATTACHMENTS_BUCKET, pathOf(m, input.attachmentId));
    return {
      attachmentId: input.attachmentId,
      uploadUrl,
      method: 'PUT',
      headers: { 'content-type': input.contentType, 'x-upsert': 'false' },
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_MS).toISOString(),
    };
  }

  async downloadUrl(user: AuthUser, m: MembershipContext, attachmentId: string): Promise<AttachmentDownloadUrl> {
    const referenced = await this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      const where = {
        organizationId: m.organizationId,
        attachmentIds: { has: attachmentId },
        deletedAt: null,
        ...(m.branchId ? { branchId: m.branchId } : {}),
      };
      return Boolean(
        (await tx.transaction.findFirst({ where, select: { id: true } })) ?? (await tx.draft.findFirst({ where, select: { id: true } })),
      );
    });
    if (!referenced) throw new ApiException('NOT_FOUND', 'Không có ảnh này trong sổ');

    const url = await this.storage.signDownload(ATTACHMENTS_BUCKET, pathOf(m, attachmentId), DOWNLOAD_URL_TTL_SECONDS);
    if (!url) throw new ApiException('NOT_FOUND', 'Ảnh chưa lên máy chủ — máy chụp ảnh chưa có mạng');
    return {
      attachmentId,
      url,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
