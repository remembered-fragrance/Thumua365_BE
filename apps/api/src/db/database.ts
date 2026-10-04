/**
 * Cửa DUY NHẤT vào Postgres lúc API chạy.
 *
 * Kết nối bằng role `api_service` — role này KHÔNG bypass RLS (migration 0001 §C6).
 * Mọi truy vấn nghiệp vụ đi qua `scoped()`: mở một transaction, đặt
 * `app.user_id` / `app.org_id` bằng `set_config(..., true)` (chỉ trong transaction
 * đó — an toàn với Transaction pooler của Supabase), rồi mới chạy việc. Policy RLS
 * đọc hai giá trị này. Repository lỡ quên `where organizationId` vẫn chỉ thấy dữ
 * liệu của tổ chức trong ngữ cảnh — đó là lớp bảo vệ thứ hai (KH §5).
 *
 * Không có cách nào lấy PrismaClient trần ra ngoài lớp này.
 */

import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '../generated/prisma/client';

/** Client bên trong một transaction đã có ngữ cảnh RLS. */
export type Tx = Prisma.TransactionClient;

/**
 * Ngữ cảnh RLS của một transaction.
 *   userId — người đang gọi (auth.users.id)
 *   orgId  — tổ chức đang làm việc; null khi chưa chọn (GET /v1/me, tra membership)
 */
export interface Scope {
  readonly userId: string;
  readonly orgId: string | null;
}

export const DATABASE = Symbol('DATABASE');
/** Khai ở đây (không import privileged-database.ts) để không có vòng phụ thuộc. */
export const PRIVILEGED_DATABASE = Symbol('PRIVILEGED_DATABASE');

export class Database {
  private readonly client: PrismaClient;

  constructor(connectionString: string) {
    // Pool nhỏ: một container free trên Render, Transaction pooler của Supabase phía sau.
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5 }) });
  }

  /** Chạy `work` trong MỘT transaction có ngữ cảnh RLS. Lỗi ⇒ rollback toàn bộ. */
  scoped<T>(scope: Scope, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$queryRaw`
        select set_config('app.user_id', ${scope.userId}, true),
               set_config('app.org_id', ${scope.orgId ?? ''}, true)`;
      return work(tx);
    });
  }

  /**
   * Việc của HỆ THỐNG trong ngữ cảnh một tổ chức, không có người gọi — listener sau commit (đo
   * lường của server: gói vừa mở bởi webhook ngân hàng). `app.user_id` để trống: policy cần người
   * dùng đều ra NULL; chỉ policy theo `app.org_id` cho qua.
   */
  system<T>(orgId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.scoped({ userId: '', orgId }, work);
  }

  /**
   * Transaction KHÔNG có ngữ cảnh — người gọi chưa đăng nhập. Mọi policy RLS so
   * sánh ra NULL ⇒ không đọc/ghi được bảng nào; chỉ gọi được hàm security definer
   * đã cấp cho api_service (find_login_user).
   */
  anonymous<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.client.$transaction(work);
  }

  close(): Promise<void> {
    return this.client.$disconnect();
  }
}

/** Tắt app (Render deploy bản mới, SIGTERM) ⇒ đóng pool Postgres gọn gàng. */
@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
  private readonly db: Database;

  private readonly privileged: { close(): Promise<void> } | null;

  constructor(@Inject(DATABASE) db: Database, @Inject(PRIVILEGED_DATABASE) privileged: { close(): Promise<void> } | null) {
    this.db = db;
    this.privileged = privileged;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
    await this.privileged?.close();
  }
}
