/**
 * BE8 trên Postgres thật — "Xong khi" của KH: ảnh chụp lúc mất mạng lên được khi có mạng; máy thứ hai
 * xem được; URL có hạn. Cộng: đường dẫn luôn trong thư mục của tổ chức đang làm việc, chỉ ảnh mà phiếu
 * / nháp mình được thấy nhắc tới mới xin URL xem được (kể cả phạm vi chi nhánh). Storage là giả.
 */

import { AttachmentDownloadUrl, AttachmentUploadUrl, ErrorBody, SyncPushResult } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { FakeStorageAdmin, buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, createOrg, newId, service, truncateAll } from './db';
import { addMember, createBranch, giveTrial, opMaker, txData } from './sync-fixture';

let app: INestApplication;
let storage: FakeStorageAdmin;
let signer: Awaited<ReturnType<typeof makeSigner>>;

let vua: string;
let owner: string;
let staff: string;

beforeAll(async () => {
  signer = await makeSigner();
  storage = new FakeStorageAdmin();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000' }),
    jwks: signer.jwks,
    storage,
    db,
    memberships: new PrismaMemberships(db),
  });
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await service.end();
});

const as = async (userId: string, orgId: string) => {
  const token = await signer.sign({ sub: userId });
  const authed = <T extends request.Test>(r: T) => r.set('authorization', `Bearer ${token}`).set('x-organization-id', orgId);
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string) => authed(http().get(path)),
    post: (path: string, body: object) => authed(http().post(path).send(body)),
    push: (ops: unknown[]) => authed(http().post('/v1/sync/push').send({ deviceId: newId(), ops })),
  };
};

const photo = (attachmentId: string) => ({ attachmentId, contentType: 'image/jpeg', size: 480_000 });

beforeEach(async () => {
  await truncateAll();
  storage.objects.clear();
  owner = newId();
  staff = newId();
  vua = await createOrg('trader', owner, 'Vựa Tư Hùng');
  await giveTrial(vua);
  await addMember(vua, staff, 'staff');
});

describe('luồng nghiệm thu BE8', () => {
  it('người cân chụp ảnh lúc mất mạng → có mạng: xin URL, tải lên, đẩy phiếu → máy của chủ xem được bằng URL có hạn', async () => {
    const staffApi = await as(staff, vua);
    const photoId = newId();

    // Có mạng: xin URL tải lên — trong thư mục của vựa, không ghi đè.
    const up = AttachmentUploadUrl.parse((await staffApi.post('/v1/attachments/upload-url', photo(photoId)).expect(200)).body);
    expect(up.uploadUrl).toContain(`/attachments/${vua}/${photoId}`);
    expect(up).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' } });
    expect(Date.parse(up.expiresAt) - Date.now()).toBeGreaterThan(100 * 60 * 1000);
    storage.objects.add(`attachments/${vua}/${photoId}`); // app PUT thành công

    const txId = newId();
    const pushed = SyncPushResult.parse(
      (await staffApi.push([opMaker()('transaction', 'insert', txId, txData({ attachmentIds: [photoId] }))]).expect(200)).body,
    );
    expect(pushed.results[0]?.status).toBe('applied');

    // Máy thứ hai (chủ) xem được.
    const view = AttachmentDownloadUrl.parse((await (await as(owner, vua)).get(`/v1/attachments/${photoId}/url`).expect(200)).body);
    expect(view.url).toContain(`/attachments/${vua}/${photoId}`);
    expect(view.url).toContain('ttl=600');
    const ttl = Date.parse(view.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('phiếu đã lên nhưng ảnh chưa (máy chụp chưa có mạng) → 404 nói rõ; nháp nhắc tới ảnh cũng xem được', async () => {
    const staffApi = await as(staff, vua);
    const photoId = newId();
    await staffApi.push([opMaker()('transaction', 'insert', newId(), txData({ attachmentIds: [photoId] }))]).expect(200);
    const missing = await staffApi.get(`/v1/attachments/${photoId}/url`).expect(404);
    expect(ErrorBody.parse(missing.body).error.message).toMatch(/chưa lên/);

    const draftPhoto = newId();
    storage.objects.add(`attachments/${vua}/${draftPhoto}`);
    const draft = { status: 'draft', supplierName: 'Cô Mai', lines: [], amountPaid: 0, attachmentIds: [draftPhoto] };
    await staffApi.push([opMaker()('draft', 'insert', newId(), draft)]).expect(200);
    await staffApi.get(`/v1/attachments/${draftPhoto}/url`).expect(200);
  });
});

describe('ai xem được ảnh nào', () => {
  it('🔴 tổ chức khác biết id ảnh cũng không xin được URL; ảnh không phiếu nào nhắc tới → 404', async () => {
    const photoId = newId();
    storage.objects.add(`attachments/${vua}/${photoId}`);
    await (await as(staff, vua)).push([opMaker()('transaction', 'insert', newId(), txData({ attachmentIds: [photoId] }))]).expect(200);

    const otherOwner = newId();
    const other = await createOrg('trader', otherOwner, 'Vựa khác');
    await (await as(otherOwner, other)).get(`/v1/attachments/${photoId}/url`).expect(404);
    // Ký URL tải lên của tổ chức khác chỉ ra thư mục của CHÍNH họ.
    const theirs = AttachmentUploadUrl.parse((await (await as(otherOwner, other)).post('/v1/attachments/upload-url', photo(photoId)).expect(200)).body);
    expect(theirs.uploadUrl).toContain(`/attachments/${other}/${photoId}`);

    await (await as(owner, vua)).get(`/v1/attachments/${newId()}/url`).expect(404);
  });

  it('người cân chi nhánh A không xem được ảnh phiếu chi nhánh B; chủ xem được cả hai', async () => {
    const dnOwner = newId();
    const dn = await createOrg('enterprise', dnOwner, 'Công ty Bình Long');
    await giveTrial(dn);
    const a = await createBranch(dn, 'A');
    const b = await createBranch(dn, 'B');
    const staffA = newId();
    const staffB = newId();
    await addMember(dn, staffA, 'staff', a);
    await addMember(dn, staffB, 'staff', b);
    const photoB = newId();
    storage.objects.add(`attachments/${dn}/${photoB}`);
    await (await as(staffB, dn)).push([opMaker()('transaction', 'insert', newId(), txData({ attachmentIds: [photoB] }))]).expect(200);

    await (await as(staffA, dn)).get(`/v1/attachments/${photoB}/url`).expect(404);
    await (await as(staffB, dn)).get(`/v1/attachments/${photoB}/url`).expect(200);
    await (await as(dnOwner, dn)).get(`/v1/attachments/${photoB}/url`).expect(200);
  });

  it('nông dân không tải ảnh lên được; ảnh sai loại hay quá 3MB → 422 ngay, không tốn mạng', async () => {
    const mai = newId();
    const farm = await createOrg('farmer', mai, 'Hộ cô Mai');
    await (await as(mai, farm)).post('/v1/attachments/upload-url', photo(newId())).expect(403);
    const staffApi = await as(staff, vua);
    await staffApi.post('/v1/attachments/upload-url', { ...photo(newId()), contentType: 'application/pdf' }).expect(422);
    await staffApi.post('/v1/attachments/upload-url', { ...photo(newId()), size: 3 * 1024 * 1024 + 1 }).expect(422);
  });
});
