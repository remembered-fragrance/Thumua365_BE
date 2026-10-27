/**
 * Bản đồ thu mua — mang sang từ LiveMap.
 *
 * Đọc: mọi người đã đăng nhập (`scoped({ userId, orgId: null })` — RLS `places_read`). Tên tổ chức chủ
 * lấy qua `place_owners()` (chỉ id + tên): RLS của `organizations` không nới cho người ngoài.
 * Ghi: chỉ trong tổ chức đang làm việc (`scoped({ userId, orgId })` — RLS `places_insert/update`);
 * điều kiện `organizationId` ở đây là lớp một, RLS là lớp hai. Gỡ = xoá mềm; trigger
 * `keep_soft_deleted` giữ điểm đã gỡ không hiện lại.
 */

import {
  type BBox,
  entitled,
  PLACES_PAGE_LIMIT,
  PLACES_PER_ORG_LIMIT,
  type Place,
  type PlaceInput,
  type PlaceKind,
  type PlacePatch,
  type PlacePrice,
  type PlacesList,
} from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { planSummary } from '../auth/prisma-memberships';
import { assertEntitlement } from '../billing/plan-of';
import { ApiException } from '../common/api-exception';
import { DATABASE, type Database, type Tx } from '../db/database';
import { Prisma } from '../generated/prisma/client';

type CreateInput = z.output<typeof PlaceInput>;
type PatchInput = z.output<typeof PlacePatch>;

interface PlaceRow {
  readonly id: string;
  readonly organization_id: string;
  readonly organization_name: string;
  readonly kind: PlaceKind;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly description: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly prices: PlacePrice[] | null;
  readonly prices_updated_at: Date | null;
  /** Gói của chủ điểm — chỉ có khi điểm có giá (`place_price_plans`). */
  readonly sub_id: string | null;
  readonly sub_status: string | null;
  readonly trial_ends_at: Date | null;
  readonly current_period_end: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** V9: giá chỉ hiện khi chủ điểm còn gói (`map:prices`) — tính theo ngày tháng lúc đọc, như mọi chỗ khác. */
const pricesShown = (row: PlaceRow): boolean => {
  if (!row.prices || row.prices.length === 0 || !row.sub_id || !row.sub_status) return false;
  const plan = planSummary(
    { id: row.sub_id, status: row.sub_status, trialEndsAt: row.trial_ends_at, currentPeriodEnd: row.current_period_end, branchLimit: null },
    new Date(),
  );
  return entitled(row.kind, plan?.tier, 'map:prices');
};

const toPlace = (row: PlaceRow): Place => {
  const shown = pricesShown(row);
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    kind: row.kind,
    name: row.name,
    address: row.address,
    phone: row.phone,
    description: row.description,
    lat: row.lat,
    lng: row.lng,
    prices: shown ? (row.prices ?? []) : [],
    pricesUpdatedAt: shown ? (row.prices_updated_at?.toISOString() ?? null) : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
};

/**
 * Điểm còn hiện thoả `where`, mới sửa trước, kèm tên tổ chức chủ. Một chỗ cho mọi truy vấn đọc.
 * `place_owners` chỉ trả tổ chức chưa xoá ⇒ điểm của tổ chức đã xoá không lọt ra.
 */
const selectLive = (tx: Tx, where: Prisma.Sql, limit: number): Promise<PlaceRow[]> => tx.$queryRaw<PlaceRow[]>`
  with v as (
    select p.id, p.organization_id, p.kind, p.name, p.address, p.phone, p.description, p.lat, p.lng,
           p.prices, p.prices_updated_at, p.created_at, p.updated_at
    from places p
    where p.deleted_at is null and ${where}
    order by p.updated_at desc, p.id
    limit ${limit}
  )
  select v.id::text, v.organization_id::text, o.name as organization_name, v.kind, v.name, v.address,
         v.phone, v.description, v.lat, v.lng, v.prices, v.prices_updated_at,
         s.id::text as sub_id, s.status as sub_status, s.trial_ends_at, s.current_period_end,
         v.created_at, v.updated_at
  from v
  join public.place_owners(array(select distinct organization_id from v)) o on o.id = v.organization_id
  left join public.place_price_plans(array(select distinct organization_id from v where prices is not null)) s
    on s.organization_id = v.organization_id
  order by v.updated_at desc, v.id`;

const page = (rows: readonly PlaceRow[]): PlacesList => ({
  items: rows.slice(0, PLACES_PAGE_LIMIT).map(toPlace),
  truncated: rows.length > PLACES_PAGE_LIMIT,
});

const NOT_FOUND = (): ApiException => new ApiException('NOT_FOUND', 'Không tìm thấy địa điểm');

/** Ảnh chụp để ghi nhật ký — chỉ chính địa điểm. */
const snapshot = (p: Place): Prisma.InputJsonValue => ({
  name: p.name,
  address: p.address,
  phone: p.phone,
  description: p.description,
  lat: p.lat,
  lng: p.lng,
  prices: p.prices,
});

/**
 * V9: bảng giá trong input. `undefined` = không đụng; `null` / rỗng = gỡ giá (gói nào cũng được); có giá thì cần
 * `map:prices`. Trả về cột để ghi.
 */
const pricesData = async (
  tx: Tx,
  m: MembershipContext,
  prices: readonly PlacePrice[] | null | undefined,
): Promise<{ prices?: Prisma.InputJsonValue | typeof Prisma.DbNull; pricesUpdatedAt?: Date | null }> => {
  if (prices === undefined) return {};
  if (prices === null || prices.length === 0) return { prices: Prisma.DbNull, pricesUpdatedAt: null };
  await assertEntitlement(tx, m, 'map:prices');
  return { prices: prices.map((p) => ({ ...p })), pricesUpdatedAt: new Date() };
};

/** Hai người bấm "Đặt" cùng lúc không vượt được giới hạn — đếm và tạo sau khoá này. */
const lock = (tx: Tx, orgId: string) => tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${orgId}, 3))`;

@Injectable()
export class PlacesService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  async listInView(user: AuthUser, bbox: BBox, kinds: readonly PlaceKind[]): Promise<PlacesList> {
    const rows = await this.db.scoped({ userId: user.id, orgId: null }, (tx) =>
      selectLive(
        tx,
        // PostGIS ở schema extensions (ngoài search_path) ⇒ gọi toán tử đủ tên; vẫn dùng index GiST.
        Prisma.sql`p.kind = any(${[...kinds]}::text[])
          and p.location operator(extensions.&&) extensions.st_makeenvelope(
                ${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)::extensions.geography`,
        PLACES_PAGE_LIMIT + 1,
      ),
    );
    return page(rows);
  }

  async get(user: AuthUser, id: string): Promise<Place> {
    const place = await this.db.scoped({ userId: user.id, orgId: null }, (tx) => this.findLive(tx, id));
    if (!place) throw NOT_FOUND();
    return place;
  }

  async listForOrg(user: AuthUser, m: MembershipContext): Promise<PlacesList> {
    const rows = await this.db.scoped({ userId: user.id, orgId: m.organizationId }, (tx) =>
      selectLive(tx, Prisma.sql`p.organization_id = ${m.organizationId}::uuid`, PLACES_PAGE_LIMIT + 1),
    );
    return page(rows);
  }

  async create(user: AuthUser, m: MembershipContext, input: CreateInput, requestId: string): Promise<Place> {
    // PermissionGuard đã chặn nông dân; kiểm lại để `kind` chắc chắn đúng kiểu.
    if (m.orgType === 'farmer') throw new ApiException('FORBIDDEN', 'Nông dân không đặt địa điểm');
    const kind: PlaceKind = m.orgType;
    const orgId = m.organizationId;

    return this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      await lock(tx, orgId);
      const used = await tx.place.count({ where: { organizationId: orgId, deletedAt: null } });
      if (used >= PLACES_PER_ORG_LIMIT) {
        throw new ApiException('VALIDATION_FAILED', `Mỗi tổ chức đặt tối đa ${PLACES_PER_ORG_LIMIT} địa điểm`, {
          reason: 'PLACE_LIMIT',
          limit: PLACES_PER_ORG_LIMIT,
        });
      }
      const { id } = await tx.place.create({
        data: {
          organizationId: orgId,
          createdBy: user.id,
          kind,
          name: input.name,
          address: input.address,
          phone: input.phone,
          description: input.description,
          lat: input.lat,
          lng: input.lng,
          ...(await pricesData(tx, m, input.prices)),
        },
        select: { id: true },
      });
      const place = await this.findLive(tx, id);
      if (!place) throw new Error('Địa điểm vừa tạo không đọc lại được');
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: user.id,
        action: 'place.created',
        entity: 'place',
        entityId: id,
        after: snapshot(place),
        requestId,
      });
      return place;
    });
  }

  async update(user: AuthUser, m: MembershipContext, id: string, patch: PatchInput, requestId: string): Promise<Place> {
    const orgId = m.organizationId;
    return this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const before = await this.findOwned(tx, id, orgId);
      if (!before) throw NOT_FOUND();

      const data: Prisma.PlaceUpdateManyMutationInput = {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.lat !== undefined && patch.lng !== undefined ? { lat: patch.lat, lng: patch.lng } : {}),
        ...(await pricesData(tx, m, patch.prices)),
      };
      if (Object.keys(data).length === 0) return before;

      const { count } = await tx.place.updateMany({ where: { id, organizationId: orgId, deletedAt: null }, data });
      if (count === 0) throw NOT_FOUND();

      const after = await this.findLive(tx, id);
      if (!after) throw NOT_FOUND();
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: user.id,
        action: 'place.updated',
        entity: 'place',
        entityId: id,
        before: snapshot(before),
        after: snapshot(after),
        requestId,
      });
      return after;
    });
  }

  async remove(user: AuthUser, m: MembershipContext, id: string, requestId: string): Promise<void> {
    const orgId = m.organizationId;
    await this.db.scoped({ userId: user.id, orgId }, async (tx) => {
      const before = await this.findOwned(tx, id, orgId);
      if (!before) throw NOT_FOUND();

      const { count } = await tx.place.updateMany({
        where: { id, organizationId: orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw NOT_FOUND();

      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: user.id,
        action: 'place.deleted',
        entity: 'place',
        entityId: id,
        before: snapshot(before),
        requestId,
      });
    });
  }

  private async findLive(tx: Tx, id: string): Promise<Place | null> {
    const rows = await selectLive(tx, Prisma.sql`p.id = ${id}::uuid`, 1);
    return rows[0] ? toPlace(rows[0]) : null;
  }

  private async findOwned(tx: Tx, id: string, organizationId: string): Promise<Place | null> {
    const place = await this.findLive(tx, id);
    return place && place.organizationId === organizationId ? place : null;
  }
}
