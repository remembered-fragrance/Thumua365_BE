/**
 * Cửa thứ hai vào Postgres — role `api_privileged` (BYPASSRLS, có DELETE). KH backend §5:
 * CHỈ ba việc dùng: webhook ngân hàng (ghi sổ đối soát, gia hạn gói của tổ chức nào đó — không có
 * người gọi để đặt ngữ cảnh RLS), quản trị (`/v1/admin/*`), xoá tài khoản (xoá thật dữ liệu của
 * cả tổ chức). Module nào khác inject cái này là sai thiết kế.
 *
 * Không có ngữ cảnh RLS nào để quên — vì vậy mọi truy vấn ở đây phải tự lọc đúng tổ chức, và mỗi
 * service đặc quyền có test riêng trên Postgres thật.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { Tx } from './database';

export { PRIVILEGED_DATABASE } from './database';

export class PrivilegedDatabase {
  private readonly client: PrismaClient;

  constructor(connectionString: string) {
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }) });
  }

  /** Chạy `work` trong MỘT transaction. Lỗi ⇒ rollback toàn bộ. */
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.client.$transaction(work, { timeout: 15_000 });
  }

  close(): Promise<void> {
    return this.client.$disconnect();
  }
}

/** Service đặc quyền gọi ở đầu mỗi việc: chưa cấu hình thì báo đúng biến nào thiếu. */
export const privileged = (db: PrivilegedDatabase | null): PrivilegedDatabase => {
  if (!db) throw new Error('PRIVILEGED_DATABASE_URL chưa cấu hình — webhook, quản trị, xoá tài khoản chưa chạy được');
  return db;
};
