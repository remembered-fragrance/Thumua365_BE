/**
 * Supabase Storage bằng khoá SECRET — chỉ cho việc phía server: xoá sạch ảnh chứng từ của một tổ
 * chức khi xoá tài khoản (BE6), cấp URL có hạn để tải lên / xem ảnh (BE8). App không bao giờ cầm
 * khoá này.
 *
 * Ảnh nằm ở `attachments/<organizationId>/<attachmentId>` — một tầng thư mục mỗi tổ chức.
 */

import { z } from 'zod';

export const ATTACHMENTS_BUCKET = 'attachments';

export interface StorageAdmin {
  /** Xoá mọi file trong `<bucket>/<folder>/`. Trả số file đã xoá. */
  removeFolder(bucket: string, folder: string): Promise<number>;
}

export const STORAGE_ADMIN = Symbol('STORAGE_ADMIN');

const Listed = z.array(z.object({ name: z.string(), id: z.string().nullable().optional() }));
const PAGE = 100;

export class SupabaseStorageHttp implements StorageAdmin {
  private readonly url: string;
  private readonly secretKey: string;

  constructor(supabaseUrl: string, secretKey: string) {
    this.url = `${supabaseUrl}/storage/v1`;
    this.secretKey = secretKey;
  }

  private headers(): Record<string, string> {
    return { apikey: this.secretKey, authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' };
  }

  async removeFolder(bucket: string, folder: string): Promise<number> {
    let removed = 0;
    // Xoá theo trang cho tới khi danh sách rỗng — không dùng offset vì danh sách co lại sau mỗi lần xoá.
    for (;;) {
      const res = await fetch(`${this.url}/object/list/${bucket}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ prefix: folder, limit: PAGE, offset: 0 }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) return removed;
      if (!res.ok) throw new Error(`Supabase Storage trả ${res.status} khi liệt kê ${bucket}/${folder}`);
      // Thư mục con (id null) không có — ảnh nằm phẳng dưới thư mục của tổ chức.
      const files = Listed.parse(await res.json()).filter((f) => f.id);
      if (files.length === 0) return removed;

      const del = await fetch(`${this.url}/object/${bucket}`, {
        method: 'DELETE',
        headers: this.headers(),
        body: JSON.stringify({ prefixes: files.map((f) => `${folder}/${f.name}`) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!del.ok) throw new Error(`Supabase Storage trả ${del.status} khi xoá ${bucket}/${folder}`);
      removed += files.length;
    }
  }
}
