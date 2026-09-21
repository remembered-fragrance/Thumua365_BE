/**
 * Công cụ cho test tích hợp: hai kết nối với hai vai trò khác nhau.
 *
 *   admin   — role postgres: dựng dữ liệu, dọn bảng, nhìn "sự thật" trong DB
 *   service — role api_service: đúng role API dùng, đi qua RLS và quyền
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:54329/thumua365';
export const SERVICE_URL =
  process.env.TEST_DATABASE_SERVICE_URL ?? 'postgresql://api_service:api_service_dev@localhost:54329/thumua365';

export const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
export const service = new pg.Pool({ connectionString: SERVICE_URL, max: 2 });

/** Xoá dữ liệu mọi bảng (giữ bảng migration). Gọi trong beforeEach. */
export const truncateAll = async (): Promise<void> => {
  const { rows } = await admin.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`,
  );
  await admin.query(`truncate ${rows.map((r) => `public."${r.tablename}"`).join(', ')} cascade`);
};

export interface Scope {
  readonly userId?: string;
  readonly orgId?: string;
}

/**
 * Chạy `work` bằng role api_service trong MỘT transaction có ngữ cảnh RLS — y như
 * `Database.scoped()` của API — rồi ROLLBACK (test không để lại gì).
 */
export const asService = async <T>(scope: Scope, work: (c: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await service.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)`, [
      scope.userId ?? '',
      scope.orgId ?? '',
    ]);
    return await work(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
};

/** Như asService nhưng mong một lỗi Postgres; trả về thông điệp lỗi. */
export const serviceError = async (scope: Scope, sql: string, params: unknown[] = []): Promise<string> => {
  try {
    await asService(scope, (c) => c.query(sql, params));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Mong lỗi nhưng câu lệnh chạy được: ${sql}`);
};

// ─── Dựng dữ liệu (role postgres, bỏ qua RLS) ───────────────────────────────

export const newId = (): string => randomUUID();

export const createOrg = async (type: 'farmer' | 'trader' | 'enterprise', ownerId: string, name = `Tổ chức ${type}`) => {
  const id = newId();
  await admin.query(`insert into organizations (id, type, name, created_by) values ($1, $2, $3, $4)`, [
    id,
    type,
    name,
    ownerId,
  ]);
  await admin.query(`insert into memberships (user_id, organization_id, role) values ($1, $2, 'owner')`, [ownerId, id]);
  return id;
};

export const createSupplier = async (orgId: string, phone: string | null, name = 'Nông hộ') => {
  const id = newId();
  await admin.query(
    `insert into suppliers (id, organization_id, created_by, name, phone) values ($1, $2, $3, $4, $5)`,
    [id, orgId, newId(), name, phone],
  );
  return id;
};

export const createTransactionWithPayment = async (orgId: string) => {
  const txId = newId();
  const payId = newId();
  await admin.query(
    `insert into transactions (id, organization_id, created_by, date, kind, supplier_name, lines)
     values ($1, $2, $3, now(), 'purchase', 'Khách lẻ', '[]')`,
    [txId, orgId, newId()],
  );
  await admin.query(
    `insert into payments (id, organization_id, transaction_id, created_by, date, amount)
     values ($1, $2, $3, $4, now(), 1438000)`,
    [payId, orgId, txId, newId()],
  );
  return { txId, payId };
};
