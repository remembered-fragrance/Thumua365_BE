/**
 * Bản đồ thu mua trên Postgres thật — RLS `places_*`, CHECK / trigger của bảng, hàm `place_owners`,
 * và các route `/v1/places`, `/v1/org/places`: ai xem được, ai đặt được, khung nhìn, giới hạn mỗi
 * tổ chức, gỡ là xoá mềm, tổ chức đã xoá không còn hiện.
 */

import { ErrorBody, PLACES_PAGE_LIMIT, PLACES_PER_ORG_LIMIT, Place, PlacesList } from '@mambo/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMemberships } from '../../src/auth/prisma-memberships';
import { Database } from '../../src/db/database';
import { buildTestApp, makeSigner, testEnv } from '../helpers';
import { SERVICE_URL, admin, asService, createOrg, newId, service, serviceError, truncateAll } from './db';

let app: INestApplication;
let signer: Awaited<ReturnType<typeof makeSigner>>;

let vua: string;
let vuaOwner: string;
let dn: string;
let dnOwner: string;
let farm: string;
let farmer: string;

beforeAll(async () => {
  signer = await makeSigner();
  const db = new Database(SERVICE_URL);
  app = await buildTestApp({
    env: testEnv({ DATABASE_URL: SERVICE_URL, RATE_LIMIT_PER_MINUTE: '10000' }),
    jwks: signer.jwks,
    db,
    memberships: new PrismaMemberships(db),
  });
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await service.end();
});

/** `orgId` bỏ trống = không gửi x-organization-id (route `auth: 'user'`). */
const as = async (userId: string, orgId?: string) => {
  const token = await signer.sign({ sub: userId });
  const withAuth = <T extends request.Test>(r: T) => {
    const authed = r.set('authorization', `Bearer ${token}`);
    return orgId ? authed.set('x-organization-id', orgId) : authed;
  };
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string, query: Record<string, string> = {}) => withAuth(http().get(path).query(query)),
    post: (path: string, body: object) => withAuth(http().post(path).send(body)),
    patch: (path: string, body: object) => withAuth(http().patch(path).send(body)),
    del: (path: string) => withAuth(http().delete(path)),
  };
};

// Bình Phước và Hà Nội — hai khung nhìn tách nhau.
const BINH_PHUOC = '106.4,11.4,107.0,12.0';
const HA_NOI = '105.6,20.8,106.0,21.2';

const HUNG = { name: 'Vựa Tư Hùng', address: 'Ấp 3, Lộc Ninh', phone: '0905 112 233', lat: 11.83, lng: 106.59 };

/** Đặt thẳng bằng role postgres (bỏ qua RLS và giới hạn của API). */
const seedPlace = async (orgId: string, kind: 'trader' | 'enterprise', lat: number, lng: number, name = 'Điểm thu mua') => {
  const id = newId();
  await admin.query(`insert into places (id, organization_id, created_by, kind, name, lat, lng) values ($1, $2, $3, $4, $5, $6, $7)`, [
    id,
    orgId,
    newId(),
    kind,
    name,
    lat,
    lng,
  ]);
  return id;
};

const addMember = async (orgId: string, role: 'manager' | 'staff') => {
  const userId = newId();
  await admin.query(`insert into memberships (user_id, organization_id, role) values ($1, $2, $3)`, [userId, orgId, role]);
  return userId;
};

const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  (await admin.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0]?.n ?? -1;

beforeEach(async () => {
  await truncateAll();
  vuaOwner = newId();
  dnOwner = newId();
  farmer = newId();
  vua = await createOrg('trader', vuaOwner, 'Vựa Tư Hùng');
  dn = await createOrg('enterprise', dnOwner, 'Công ty Cao su Bình Long');
  farm = await createOrg('farmer', farmer, 'Hộ cô Mai');
});

describe('RLS và luật của bảng places', () => {
  it('mọi người đã đăng nhập đọc được điểm đang hiện; chưa đăng nhập thì không; điểm đã gỡ chỉ tổ chức chủ thấy', async () => {
    const live = await seedPlace(vua, 'trader', 11.8, 106.6);
    const gone = await seedPlace(vua, 'trader', 11.7, 106.5);
    await admin.query(`update places set deleted_at = now() where id = $1`, [gone]);

    const ids = (scope: { userId?: string; orgId?: string }) =>
      asService(scope, async (c) => (await c.query<{ id: string }>('select id from places order by id')).rows.map((r) => r.id));

    expect(await ids({ userId: farmer, orgId: farm })).toEqual([live]);
    expect(await ids({ userId: farmer })).toEqual([live]);
    expect(await ids({})).toEqual([]);
    expect((await ids({ userId: vuaOwner, orgId: vua })).sort()).toEqual([live, gone].sort());
  });

  it('chỉ thêm / sửa được điểm của tổ chức đang làm việc; không có quyền DELETE', async () => {
    const theirs = await seedPlace(dn, 'enterprise', 11.5, 106.8);
    const insert = `insert into places (organization_id, created_by, kind, name, lat, lng) values ($1, $2, $3, 'X', 11, 106)`;

    // Tổ chức khác không đọc được ⇒ trigger loại đã chặn trước cả RLS.
    expect(await serviceError({ userId: vuaOwner, orgId: vua }, insert, [dn, vuaOwner, 'enterprise'])).toMatch(/khác loại tổ chức \(<NULL>\)/);
    // created_by phải là chính người gọi.
    expect(await serviceError({ userId: vuaOwner, orgId: vua }, insert, [vua, newId(), 'trader'])).toMatch(/row-level security/);
    const updated = await asService({ userId: vuaOwner, orgId: vua }, (c) => c.query(`update places set name = 'Chiếm' where id = $1`, [theirs]));
    expect(updated.rowCount).toBe(0);
    expect(await serviceError({ userId: dnOwner, orgId: dn }, `delete from places where id = $1`, [theirs])).toMatch(/permission denied/);
  });

  it('loại phải khớp tổ chức (nông dân không có điểm); toạ độ trong khung Việt Nam; location do database tính', async () => {
    const insert = `insert into places (organization_id, created_by, kind, name, lat, lng) values ($1, $2, $3, 'X', $4, $5)`;

    expect(await serviceError({ userId: vuaOwner, orgId: vua }, insert, [vua, vuaOwner, 'enterprise', 11, 106])).toMatch(/khác loại tổ chức/);
    expect(await serviceError({ userId: farmer, orgId: farm }, insert, [farm, farmer, 'trader', 11, 106])).toMatch(/khác loại tổ chức/);
    expect(await serviceError({ userId: vuaOwner, orgId: vua }, insert, [vua, vuaOwner, 'trader', 1.3, 103.8])).toMatch(/places_lat_vn/);
    expect(await serviceError({ userId: vuaOwner, orgId: vua }, insert, [vua, vuaOwner, 'trader', 11, 120])).toMatch(/places_lng_vn/);
    expect(
      await serviceError(
        { userId: vuaOwner, orgId: vua },
        `insert into places (organization_id, created_by, kind, name, lat, lng, location) values ($1, $2, 'trader', 'X', 11, 106, null)`,
        [vua, vuaOwner],
      ),
    ).toMatch(/non-DEFAULT value into column "location"/);

    // Hoàng Sa, Trường Sa nằm trong khung.
    await asService({ userId: vuaOwner, orgId: vua }, async (c) => {
      await c.query(insert, [vua, vuaOwner, 'trader', 16.5, 112.0]);
      await c.query(insert, [vua, vuaOwner, 'trader', 8.6, 111.9]);
    });

    const id = await seedPlace(vua, 'trader', 11.25, 106.5);
    const { rows } = await admin.query<{ lat: number; lng: number }>(
      `select extensions.st_y(location::extensions.geometry) as lat, extensions.st_x(location::extensions.geometry) as lng from places where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ lat: 11.25, lng: 106.5 });
  });

  it('điểm đã gỡ không khôi phục được', async () => {
    const id = await seedPlace(vua, 'trader', 11.8, 106.6);
    await admin.query(`update places set deleted_at = now() where id = $1`, [id]);
    expect(await serviceError({ userId: vuaOwner, orgId: vua }, `update places set deleted_at = null where id = $1`, [id])).toMatch(
      /không khôi phục được/,
    );
  });

  it('place_owners: chỉ id + tên, chỉ tổ chức chưa xoá có điểm đang hiện, người gọi phải đã đăng nhập', async () => {
    await seedPlace(vua, 'trader', 11.8, 106.6);
    const gone = await seedPlace(dn, 'enterprise', 11.5, 106.8);
    await admin.query(`update places set deleted_at = now() where id = $1`, [gone]);

    const owners = (scope: { userId?: string }) =>
      asService(scope, async (c) => (await c.query(`select * from public.place_owners($1::uuid[])`, [[vua, dn, farm]])).rows);

    expect(await owners({ userId: farmer })).toEqual([{ id: vua, name: 'Vựa Tư Hùng' }]);
    expect(await owners({})).toEqual([]);

    await admin.query(`update organizations set deleted_at = now() where id = $1`, [vua]);
    expect(await owners({ userId: farmer })).toEqual([]);
  });
});

describe('/v1/org/places — tổ chức đặt điểm', () => {
  it('chủ vựa đặt điểm → nông dân thấy trên bản đồ kèm tên vựa; loại theo tổ chức; nhật ký ghi lại', async () => {
    const owner = await as(vuaOwner, vua);
    const place = Place.parse((await owner.post('/v1/org/places', { ...HUNG, description: '  ' }).expect(200)).body);
    expect(place).toMatchObject({
      organizationId: vua,
      organizationName: 'Vựa Tư Hùng',
      kind: 'trader',
      name: 'Vựa Tư Hùng',
      phone: '0905 112 233',
      description: null,
      lat: 11.83,
      lng: 106.59,
    });

    const mai = await as(farmer);
    const inView = PlacesList.parse((await mai.get('/v1/places', { bbox: BINH_PHUOC }).expect(200)).body);
    expect(inView).toEqual({ items: [place], truncated: false });
    expect(Place.parse((await mai.get(`/v1/places/${place.id}`).expect(200)).body)).toEqual(place);

    const mine = PlacesList.parse((await owner.get('/v1/org/places').expect(200)).body);
    expect(mine.items.map((p) => p.id)).toEqual([place.id]);
    expect(await count(`audit_log where action = 'place.created' and entity_id = $1 and organization_id = $2`, [place.id, vua])).toBe(1);
  });

  it('doanh nghiệp: chủ và quản lý đặt được; người cân, nông dân thì không', async () => {
    const manager = await addMember(dn, 'manager');
    const staff = await addMember(dn, 'staff');
    const input = { name: 'Trạm Bù Đốp', lat: 11.95, lng: 106.85 };

    expect(Place.parse((await (await as(dnOwner, dn)).post('/v1/org/places', input).expect(200)).body).kind).toBe('enterprise');
    await (await as(manager, dn)).post('/v1/org/places', input).expect(200);

    const denied = await (await as(staff, dn)).post('/v1/org/places', input).expect(403);
    expect(ErrorBody.parse(denied.body).error.code).toBe('FORBIDDEN');
    await (await as(staff, dn)).get('/v1/org/places').expect(403);
    await (await as(farmer, farm)).post('/v1/org/places', input).expect(403);
    // Xem bản đồ thì người cân cũng được.
    expect(PlacesList.parse((await (await as(staff)).get('/v1/places', { bbox: BINH_PHUOC }).expect(200)).body).items).toHaveLength(2);
  });

  it('dữ liệu sai → 422: ngoài Việt Nam, thiếu tên, trường lạ, đổi vị trí chỉ gửi một toạ độ', async () => {
    const owner = await as(vuaOwner, vua);
    await owner.post('/v1/org/places', { ...HUNG, lat: 1.35, lng: 103.82 }).expect(422);
    await owner.post('/v1/org/places', { ...HUNG, name: '   ' }).expect(422);
    await owner.post('/v1/org/places', { ...HUNG, kind: 'enterprise' }).expect(422);

    const place = Place.parse((await owner.post('/v1/org/places', HUNG).expect(200)).body);
    await owner.patch(`/v1/org/places/${place.id}`, { lat: 12 }).expect(422);
    await owner.patch(`/v1/org/places/${place.id}`, { organizationId: dn }).expect(422);
    await owner.get('/v1/org/places/khong-phai-uuid').expect(404);
  });

  it('sửa: đổi tên và dời vị trí — bản đồ thấy ở chỗ mới; điểm của tổ chức khác → 404', async () => {
    const owner = await as(vuaOwner, vua);
    const place = Place.parse((await owner.post('/v1/org/places', HUNG).expect(200)).body);

    const moved = Place.parse(
      (await owner.patch(`/v1/org/places/${place.id}`, { name: 'Vựa Tư Hùng (Hà Nội)', phone: null, lat: 21.03, lng: 105.85 }).expect(200)).body,
    );
    expect(moved).toMatchObject({ id: place.id, name: 'Vựa Tư Hùng (Hà Nội)', phone: null, address: HUNG.address, lat: 21.03, lng: 105.85 });
    expect(Date.parse(moved.updatedAt)).toBeGreaterThanOrEqual(Date.parse(place.updatedAt));

    const mai = await as(farmer);
    expect(PlacesList.parse((await mai.get('/v1/places', { bbox: BINH_PHUOC }).expect(200)).body).items).toEqual([]);
    expect(PlacesList.parse((await mai.get('/v1/places', { bbox: HA_NOI }).expect(200)).body).items.map((p) => p.id)).toEqual([place.id]);

    // Patch rỗng: trả nguyên điểm, không ghi nhật ký.
    expect(Place.parse((await owner.patch(`/v1/org/places/${place.id}`, {}).expect(200)).body)).toEqual(moved);
    expect(await count(`audit_log where action = 'place.updated' and entity_id = $1`, [place.id])).toBe(1);

    const other = await as(dnOwner, dn);
    expect(ErrorBody.parse((await other.patch(`/v1/org/places/${place.id}`, { name: 'Chiếm' }).expect(404)).body).error.code).toBe('NOT_FOUND');
    await other.del(`/v1/org/places/${place.id}`).expect(404);
  });

  it('gỡ: xoá mềm — biến khỏi bản đồ và danh sách, gỡ lần hai → 404, hàng vẫn còn trong database', async () => {
    const owner = await as(vuaOwner, vua);
    const place = Place.parse((await owner.post('/v1/org/places', HUNG).expect(200)).body);

    expect((await owner.del(`/v1/org/places/${place.id}`).expect(200)).body).toEqual({ ok: true });
    await owner.del(`/v1/org/places/${place.id}`).expect(404);
    await owner.patch(`/v1/org/places/${place.id}`, { name: 'Sống lại' }).expect(404);

    const mai = await as(farmer);
    await mai.get(`/v1/places/${place.id}`).expect(404);
    expect(PlacesList.parse((await mai.get('/v1/places', { bbox: BINH_PHUOC }).expect(200)).body).items).toEqual([]);
    expect(PlacesList.parse((await owner.get('/v1/org/places').expect(200)).body).items).toEqual([]);
    expect(await count('places where id = $1 and deleted_at is not null', [place.id])).toBe(1);
    expect(await count(`audit_log where action = 'place.deleted' and entity_id = $1`, [place.id])).toBe(1);
  });

  it(`tối đa ${PLACES_PER_ORG_LIMIT} điểm đang hiện mỗi tổ chức — điểm đã gỡ không tính; hai yêu cầu cùng lúc không vượt`, async () => {
    const owner = await as(vuaOwner, vua);
    await admin.query(
      `insert into places (organization_id, created_by, kind, name, lat, lng)
       select $1, $2, 'trader', 'Điểm ' || g, 11, 106 from generate_series(1, $3::int) g`,
      [vua, vuaOwner, PLACES_PER_ORG_LIMIT - 1],
    );

    const [a, b] = await Promise.all([owner.post('/v1/org/places', HUNG), owner.post('/v1/org/places', HUNG)]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const refused = a.status === 422 ? a : b;
    expect(ErrorBody.parse(refused.body).error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'PLACE_LIMIT', limit: PLACES_PER_ORG_LIMIT },
    });
    expect(await count('places where organization_id = $1 and deleted_at is null', [vua])).toBe(PLACES_PER_ORG_LIMIT);

    // Gỡ một điểm → đặt lại được một.
    const first = PlacesList.parse((await owner.get('/v1/org/places').expect(200)).body).items[0];
    await owner.del(`/v1/org/places/${first?.id ?? ''}`).expect(200);
    await owner.post('/v1/org/places', HUNG).expect(200);
    await owner.post('/v1/org/places', HUNG).expect(422);
  });
});

describe('/v1/places — xem bản đồ', () => {
  it('lọc theo khung nhìn và loại; mới sửa trước', async () => {
    const older = await seedPlace(vua, 'trader', 11.8, 106.6, 'Vựa cũ');
    await admin.query(`update places set updated_at = now() - interval '1 day' where id = $1`, [older]);
    const newer = await seedPlace(dn, 'enterprise', 11.5, 106.8, 'Nhà máy');
    await seedPlace(vua, 'trader', 21.0, 105.8, 'Ở Hà Nội');

    const mai = await as(farmer);
    const all = PlacesList.parse((await mai.get('/v1/places', { bbox: BINH_PHUOC }).expect(200)).body);
    expect(all.items.map((p) => p.id)).toEqual([newer, older]);
    expect(all.items.map((p) => p.organizationName)).toEqual(['Công ty Cao su Bình Long', 'Vựa Tư Hùng']);

    const traders = PlacesList.parse((await mai.get('/v1/places', { bbox: BINH_PHUOC, kinds: 'trader' }).expect(200)).body);
    expect(traders.items.map((p) => p.id)).toEqual([older]);
    const both = PlacesList.parse((await mai.get('/v1/places', { bbox: BINH_PHUOC, kinds: 'trader,enterprise,trader' }).expect(200)).body);
    expect(both.items).toHaveLength(2);
  });

  it(`quá ${PLACES_PAGE_LIMIT} điểm trong khung → trả ${PLACES_PAGE_LIMIT}, truncated`, async () => {
    await admin.query(
      `insert into places (organization_id, created_by, kind, name, lat, lng)
       select $1, $2, 'trader', 'Điểm ' || g, 11.5 + g / 10000.0, 106.5 from generate_series(1, $3::int) g`,
      [vua, vuaOwner, PLACES_PAGE_LIMIT + 1],
    );
    const list = PlacesList.parse((await (await as(farmer)).get('/v1/places', { bbox: BINH_PHUOC }).expect(200)).body);
    expect(list.items).toHaveLength(PLACES_PAGE_LIMIT);
    expect(list.truncated).toBe(true);
  });

  it('tham số sai → 422; chưa đăng nhập → 401', async () => {
    const mai = await as(farmer);
    await mai.get('/v1/places').expect(422);
    await mai.get('/v1/places', { bbox: '106,11,107' }).expect(422);
    await mai.get('/v1/places', { bbox: '107,11,106,12' }).expect(422);
    await mai.get('/v1/places', { bbox: '106,11,107,1e3' }).expect(422);
    await mai.get('/v1/places', { bbox: BINH_PHUOC, kinds: 'farmer' }).expect(422);
    await mai.get('/v1/places', { bbox: BINH_PHUOC, page: '2' }).expect(422);
    await mai.get('/v1/places/khong-phai-uuid').expect(422);
    await request(app.getHttpServer()).get('/v1/places').query({ bbox: BINH_PHUOC }).expect(401);
  });

  it('tổ chức đã xoá: điểm của nó không còn hiện', async () => {
    const id = await seedPlace(vua, 'trader', 11.8, 106.6);
    await admin.query(`update organizations set deleted_at = now() where id = $1`, [vua]);
    const mai = await as(farmer);
    expect(PlacesList.parse((await mai.get('/v1/places', { bbox: BINH_PHUOC }).expect(200)).body).items).toEqual([]);
    await mai.get(`/v1/places/${id}`).expect(404);
  });
});
