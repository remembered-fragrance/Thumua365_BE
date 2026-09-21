/**
 * Lớp bảo vệ thứ hai (KH §5): chứng minh bằng Postgres thật rằng role api_service
 * KHÔNG đọc/ghi được dữ liệu tổ chức khác — kể cả khi câu truy vấn quên lọc.
 * Đây là điều kiện "Xong khi" của BE2: "test RLS xanh".
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  admin,
  asService,
  createOrg,
  createSupplier,
  createTransactionWithPayment,
  newId,
  service,
  serviceError,
  truncateAll,
} from './db';

afterAll(async () => {
  await admin.end();
  await service.end();
});

let alice: string; // chủ vựa A
let bob: string; // chủ vựa B
let orgA: string;
let orgB: string;

beforeEach(async () => {
  await truncateAll();
  alice = newId();
  bob = newId();
  orgA = await createOrg('trader', alice, 'Vựa A');
  orgB = await createOrg('trader', bob, 'Vựa B');
  await createSupplier(orgA, '0912345678', 'Nông hộ của A');
  await createSupplier(orgB, '0987654321', 'Nông hộ của B');
});

describe('cô lập theo tổ chức', () => {
  it('🔴 repository QUÊN lọc orgId vẫn chỉ thấy dữ liệu tổ chức mình', async () => {
    const names = await asService({ userId: alice, orgId: orgA }, async (c) =>
      (await c.query<{ name: string }>('select name from suppliers')).rows.map((r) => r.name),
    );
    expect(names).toEqual(['Nông hộ của A']);
  });

  it('chưa có ngữ cảnh (quên set_config) → không thấy gì, không phải thấy hết', async () => {
    const count = await asService({}, async (c) => (await c.query('select * from suppliers')).rowCount);
    expect(count).toBe(0);
  });

  it('ghi vào tổ chức khác bị chặn', async () => {
    const message = await serviceError(
      { userId: alice, orgId: orgA },
      `insert into suppliers (id, organization_id, created_by, name) values ($1, $2, $3, 'chen ngang')`,
      [newId(), orgB, alice],
    );
    expect(message).toMatch(/row-level security/);
  });

  it('sửa dữ liệu tổ chức khác không có tác dụng (0 hàng)', async () => {
    const updated = await asService({ userId: alice, orgId: orgA }, async (c) =>
      (await c.query(`update suppliers set name = 'bị sửa' where organization_id = $1`, [orgB])).rowCount,
    );
    expect(updated).toBe(0);
  });

  it('không chuyển được dữ liệu của mình sang tổ chức khác', async () => {
    const message = await serviceError(
      { userId: alice, orgId: orgA },
      `update suppliers set organization_id = $1`,
      [orgB],
    );
    expect(message).toMatch(/row-level security/);
  });

  it('phiếu và lần trả của tổ chức khác không lọt ra', async () => {
    await createTransactionWithPayment(orgB);
    const [txs, pays] = await asService({ userId: alice, orgId: orgA }, async (c) => [
      (await c.query('select id from transactions')).rowCount,
      (await c.query('select id from payments')).rowCount,
    ]);
    expect([txs, pays]).toEqual([0, 0]);
  });
});

describe('tổ chức và membership', () => {
  it('thấy mọi tổ chức mình là thành viên, không thấy tổ chức người khác', async () => {
    const orgC = await createOrg('farmer', alice, 'Hộ của Alice');
    const names = await asService({ userId: alice }, async (c) =>
      (await c.query<{ name: string }>('select name from organizations order by name')).rows.map((r) => r.name),
    );
    expect(names).toEqual(['Hộ của Alice', 'Vựa A']);
    expect(orgC).toBeDefined();
  });

  it('thấy membership của chính mình, không thấy của người khác', async () => {
    const users = await asService({ userId: alice }, async (c) =>
      (await c.query<{ user_id: string }>('select user_id from memberships')).rows.map((r) => r.user_id),
    );
    expect(users).toEqual([alice]);
  });

  it('không tự thêm mình vào tổ chức người khác', async () => {
    const message = await serviceError(
      { userId: alice, orgId: orgA },
      `insert into memberships (user_id, organization_id, role) values ($1, $2, 'owner')`,
      [alice, orgB],
    );
    expect(message).toMatch(/row-level security/);
  });

  it('hồ sơ: chỉ của chính mình', async () => {
    await admin.query(`insert into profiles (id, name) values ($1, 'Alice'), ($2, 'Bob')`, [alice, bob]);
    const names = await asService({ userId: alice }, async (c) =>
      (await c.query<{ name: string }>('select name from profiles')).rows.map((r) => r.name),
    );
    expect(names).toEqual(['Alice']);
  });
});

describe('quyền của api_service — năm quy tắc chống mất tiền ở tầng database', () => {
  it('không có DELETE ở bảng nào: xoá là xoá mềm', async () => {
    expect(await serviceError({ userId: alice, orgId: orgA }, 'delete from suppliers')).toMatch(/permission denied/);
    expect(await serviceError({ userId: alice, orgId: orgA }, 'delete from organizations')).toMatch(/permission denied/);
  });

  it('lần trả tiền: KHÔNG sửa được số tiền; huỷ (deleted_at) được và updated_at đổi theo', async () => {
    const { payId } = await createTransactionWithPayment(orgA);
    expect(await serviceError({ userId: alice, orgId: orgA }, 'update payments set amount = 1')).toMatch(
      /permission denied/,
    );

    const row = await asService({ userId: alice, orgId: orgA }, async (c) => {
      const before = await c.query<{ updated_at: Date }>('select updated_at from payments where id = $1', [payId]);
      await c.query(`select pg_sleep(0.01)`);
      await c.query('update payments set deleted_at = now() where id = $1', [payId]);
      const after = await c.query<{ updated_at: Date; deleted_at: Date | null }>(
        'select updated_at, deleted_at from payments where id = $1',
        [payId],
      );
      return { before: before.rows[0], after: after.rows[0] };
    });
    expect(row.after?.deleted_at).not.toBeNull();
    // Lỗi #1 của MEMORY: huỷ lần trả phải đổi updated_at để lan sang máy khác khi kéo.
    expect(row.after?.updated_at.getTime()).toBeGreaterThan(row.before?.updated_at.getTime() ?? Infinity);
  });

  it('audit_log chỉ ghi thêm: không sửa được', async () => {
    await asService({ userId: alice, orgId: orgA }, (c) =>
      c.query(`insert into audit_log (organization_id, actor_user_id, action, entity) values ($1, $2, 'x', 'y')`, [
        orgA,
        alice,
      ]),
    );
    expect(await serviceError({ userId: alice, orgId: orgA }, `update audit_log set action = 'z'`)).toMatch(
      /permission denied/,
    );
  });

  it('sổ đối soát ngân hàng và nhật ký quản trị: api_service không chạm được', async () => {
    expect(await serviceError({ userId: alice, orgId: orgA }, 'select * from bank_transactions')).toMatch(
      /permission denied/,
    );
    expect(await serviceError({ userId: alice, orgId: orgA }, 'select * from admin_access_log')).toMatch(
      /permission denied/,
    );
  });

  it('api_service không bypass RLS; api_privileged thì có', async () => {
    const { rows } = await admin.query<{ rolname: string; rolbypassrls: boolean }>(
      `select rolname, rolbypassrls from pg_roles where rolname in ('api_service', 'api_privileged') order by rolname`,
    );
    expect(rows).toEqual([
      { rolname: 'api_privileged', rolbypassrls: true },
      { rolname: 'api_service', rolbypassrls: false },
    ]);
  });
});

describe('Data API của Supabase đã tắt — anon/authenticated không có quyền gì', () => {
  it('không quyền nào trên bảng nào trong public', async () => {
    const { rows } = await admin.query<{ grantee: string; table_name: string; privilege_type: string }>(
      `select grantee, table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')`,
    );
    expect(rows).toEqual([]);
  });

  it('không gọi được hàm security definer', async () => {
    const { rows } = await admin.query<{ fn: string; anon: boolean; auth: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row, row.fn).toMatchObject({ anon: false, auth: false });
  });

  it('mọi bảng trong public đều bật RLS', async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
         and c.relname <> '_prisma_migrations'`,
    );
    expect(rows).toEqual([]);
  });
});

describe('ràng buộc dữ liệu', () => {
  it('giá trị ngoài danh sách bị từ chối ngay ở database', async () => {
    await expect(
      admin.query(`insert into organizations (type, name, created_by) values ('admin', 'x', $1)`, [alice]),
    ).rejects.toThrow(/organizations_type_check/);
    await expect(
      admin.query(`insert into profiles (id, name, phone) values ($1, 'x', '0912 345 678')`, [newId()]),
    ).rejects.toThrow(/profiles_phone_normalized/);
  });

  it('mỗi tổ chức một gói đang sống', async () => {
    await admin.query(`insert into subscriptions (organization_id, status) values ($1, 'trialing')`, [orgA]);
    await expect(
      admin.query(`insert into subscriptions (organization_id, status) values ($1, 'active')`, [orgA]),
    ).rejects.toThrow(/subscriptions_one_per_org/);
  });

  it('mã giới thiệu do database đặt, bỏ qua giá trị client gửi', async () => {
    const id = newId();
    await asService({ userId: id }, async (c) => {
      await c.query(`insert into profiles (id, name, referral_code, referred_by) values ($1, 'x', 'AAAAAA', $2)`, [
        id,
        bob,
      ]);
      const { rows } = await c.query<{ referral_code: string; referred_by: string | null }>(
        'select referral_code, referred_by from profiles where id = $1',
        [id],
      );
      expect(rows[0]?.referral_code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
      expect(rows[0]?.referral_code).not.toBe('AAAAAA');
      expect(rows[0]?.referred_by).toBeNull();
    });
  });
});

describe('find_login_user — đăng nhập một ô', () => {
  beforeEach(async () => {
    await admin.query(
      `insert into profiles (id, name, username, phone, recovery_email) values ($1, 'Tư Hùng', 'vuatuhung', '+84912345678', 'hung@gmail.com')`,
      [alice],
    );
  });

  const find = (raw: string) =>
    asService({}, async (c) => (await c.query<{ id: string | null }>('select public.find_login_user($1) as id', [raw])).rows[0]?.id);

  it('tìm theo tên (không phân biệt hoa thường), SĐT (mọi cách gõ), email khôi phục', async () => {
    for (const raw of ['VuaTuHung', '0912 345 678', '+84 912 345 678', '84912345678', 'HUNG@gmail.com']) {
      expect(await find(raw), raw).toBe(alice);
    }
  });

  it('hồ sơ lưu chữ HOA vẫn tìm được bằng chữ thường', async () => {
    const id = newId();
    await admin.query(`insert into profiles (id, name, username, recovery_email) values ($1, 'x', 'VuaBaTam', 'BaTam@Gmail.com')`, [id]);
    expect(await find('vuabatam')).toBe(id);
    expect(await find('batam@gmail.com')).toBe(id);
  });

  it('không có / đã xoá → null', async () => {
    expect(await find('khongcoai')).toBeNull();
    await admin.query('update profiles set deleted_at = now() where id = $1', [alice]);
    expect(await find('vuatuhung')).toBeNull();
  });
});

describe('discover_links — dò kết nối theo số đã xác thực', () => {
  let farmer: string;
  let farmerOrg: string;

  beforeEach(async () => {
    farmer = newId();
    farmerOrg = await createOrg('farmer', farmer, 'Hộ cô Mai');
  });

  const discover = (phone: string) =>
    asService({ userId: farmer, orgId: farmerOrg }, async (c) => {
      const created = (await c.query<{ n: number }>('select public.discover_links($1) as n', [phone])).rows[0]?.n;
      const links = await c.query<{ owner_org_id: string; status: string }>(
        'select owner_org_id, status from partner_links order by owner_org_id',
      );
      return { created, links: links.rows };
    });

  it('tạo lời mời pending từ mọi sổ có đối tác mang số đó, dù vựa gõ số kiểu gì', async () => {
    await createSupplier(orgB, '0912 345 678');
    const res = await discover('+84912345678');
    expect(res.created).toBe(2);
    expect(res.links.map((l) => l.owner_org_id).sort()).toEqual([orgA, orgB].sort());
    expect(res.links.every((l) => l.status === 'pending')).toBe(true);
  });

  it('gọi lại không tạo trùng', async () => {
    const first = await asService({ userId: farmer, orgId: farmerOrg }, async (c) => {
      const a = (await c.query<{ n: number }>('select public.discover_links($1) as n', ['+84912345678'])).rows[0]?.n;
      const b = (await c.query<{ n: number }>('select public.discover_links($1) as n', ['+84912345678'])).rows[0]?.n;
      return [a, b];
    });
    expect(first).toEqual([1, 0]);
  });

  it('🔴 vựa đã huỷ kết nối thì dò lại cũng không tạo lại được', async () => {
    const supplierId = await createSupplier(orgB, '0911111111');
    await admin.query(
      `insert into partner_links (owner_org_id, partner_kind, partner_id, linked_org_id, status)
       values ($1, 'supplier', $2, $3, 'revoked')`,
      [orgB, supplierId, farmerOrg],
    );
    const res = await discover('+84911111111');
    expect(res.created).toBe(0);
  });

  it('không tự nối với sổ của chính mình; số sai dạng hoặc thiếu ngữ cảnh bị từ chối', async () => {
    await createSupplier(farmerOrg, '0922222222');
    expect((await discover('+84922222222')).created).toBe(0);
    expect(await serviceError({ userId: farmer, orgId: farmerOrg }, `select public.discover_links('0912345678')`)).toMatch(
      /\+84/,
    );
    expect(await serviceError({ userId: farmer }, `select public.discover_links('+84912345678')`)).toMatch(/app\.org_id/);
  });

  it('vựa thấy lời mời trong sổ mình; vựa khác không thấy', async () => {
    await discover('+84912345678');
    // discover trong asService đã rollback — dựng lại bằng admin để kiểm quyền đọc.
    await admin.query(
      `insert into partner_links (owner_org_id, partner_kind, partner_id, linked_org_id, status)
       select organization_id, 'supplier', id, $1, 'pending' from suppliers where organization_id = $2`,
      [farmerOrg, orgA],
    );
    const seenByA = await asService({ userId: alice, orgId: orgA }, async (c) => (await c.query('select id from partner_links')).rowCount);
    const seenByB = await asService({ userId: bob, orgId: orgB }, async (c) => (await c.query('select id from partner_links')).rowCount);
    const seenByFarmer = await asService({ userId: farmer }, async (c) => (await c.query('select id from partner_links')).rowCount);
    expect([seenByA, seenByB, seenByFarmer]).toEqual([1, 0, 1]);
  });
});
