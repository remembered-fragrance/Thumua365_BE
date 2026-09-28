/**
 * Dựng sẵn cho test đồng bộ: app thật trên Postgres thật (role api_service, PrismaMemberships),
 * token cho nhiều người, tổ chức có gói, chi nhánh, và op đúng hợp đồng.
 */

import { freezeLineTotals } from '@mambo/core/calc';
import type { TransactionLine } from '@mambo/core/types';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, newId } from './db';

export const NOW = '2026-09-28T03:00:00.000Z';

export interface SyncApp {
  readonly app: INestApplication;
  readonly tokenFor: (userId: string) => Promise<string>;
}

export const buildSyncApp = async (): Promise<SyncApp> => {
  const signer = await makeSigner();
  const db = new Database(SERVICE_URL);
  const app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000' }),
    jwks: signer.jwks,
    db,
    memberships: new PrismaMemberships(db),
  });
  return { app, tokenFor: (userId) => signer.sign({ sub: userId }) };
};

// ─── Dữ liệu (role postgres) ─────────────────────────────────────────────────

/** Gói dùng thử còn `days` ngày (âm = đã hết hạn). */
export const giveTrial = async (orgId: string, days = 30): Promise<void> => {
  await admin.query(
    `insert into subscriptions (organization_id, status, trial_ends_at)
     values ($1, 'trialing', now() + make_interval(days => $2))`,
    [orgId, days],
  );
};

export const createBranch = async (orgId: string, name: string): Promise<string> => {
  const id = newId();
  await admin.query('insert into branches (id, organization_id, name) values ($1, $2, $3)', [id, orgId, name]);
  return id;
};

export const addMember = async (
  orgId: string,
  userId: string,
  role: 'owner' | 'manager' | 'staff',
  branchId: string | null = null,
): Promise<void> => {
  await admin.query('insert into memberships (user_id, organization_id, role, branch_id) values ($1, $2, $3, $4)', [
    userId,
    orgId,
    role,
    branchId,
  ]);
};

// ─── Op đúng hợp đồng ────────────────────────────────────────────────────────

/** Dòng cao su 100kg × 30% × 47.940đ = 1.438.200 → 1.438.000 — tổng đóng băng bằng core. */
export const rubberLine = (overrides: Partial<TransactionLine> = {}): TransactionLine =>
  freezeLineTotals({
    id: newId(),
    productName: 'Cao su',
    unit: 'kg',
    formulaType: 'rubberLatex',
    grossWeight: 100,
    qualityPercent: 30,
    pricePerUnit: 47_940,
    ...overrides,
  });

export const txData = (overrides: Record<string, unknown> = {}) => ({
  date: NOW,
  kind: 'purchase',
  counterpartyId: null,
  supplierName: 'Khách lẻ',
  lines: [rubberLine()],
  ...overrides,
});

export const paymentData = (transactionId: string, amount: number) => ({ transactionId, date: NOW, amount });

/** Sinh op với `seq` tăng dần như hàng đợi của một máy. */
export const opMaker = () => {
  let seq = 0;
  return (entity: string, kind: string, recordId: string, data?: unknown) => ({
    opId: newId(),
    seq: ++seq,
    entity,
    kind,
    recordId,
    ...(data === undefined ? {} : { data }),
  });
};

// ─── Gọi API ─────────────────────────────────────────────────────────────────

export const pushAs = (app: INestApplication, token: string, orgId: string, ops: unknown[], deviceId = newId()) =>
  request(app.getHttpServer())
    .post('/v1/sync/push')
    .set('authorization', `Bearer ${token}`)
    .set('x-organization-id', orgId)
    .send({ deviceId, ops });

export const pullAs = (app: INestApplication, token: string, orgId: string, query: Record<string, string | number> = {}) =>
  request(app.getHttpServer())
    .get('/v1/sync/pull')
    .query(query)
    .set('authorization', `Bearer ${token}`)
    .set('x-organization-id', orgId);
