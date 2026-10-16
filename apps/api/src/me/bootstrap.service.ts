import { randomUUID } from 'node:crypto';
import { DEFAULT_PRODUCTS } from '@mambo/core/catalog';
import { normalizePhone } from '@mambo/core/identifier';
import { type MeBootstrapInput, hasBook } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-user';
import { isInternalEmail, phoneFromLoginEmail } from '../auth/login-email';
import type { SupabaseAccount } from '../auth/supabase-users';
import { ApiException } from '../common/api-exception';
import { TRIAL_DAYS } from '../config/plans';
import { RecoveryMailService } from '../account/recovery-mail.service';
import { DATABASE, type Database, type Tx } from '../db/database';
import { DomainEvents } from '../events/domain-events';
import { Prisma } from '../generated/prisma/client';

type Input = z.output<typeof MeBootstrapInput>;

const DAY_MS = 86_400_000;

/**
 * Số điện thoại của hồ sơ — cũng là khoá đăng nhập (/v1/auth/resolve-identifier).
 *
 * Đăng ký bằng số điện thoại ⇒ số NẰM TRONG email đăng nhập, và Supabase Auth đã
 * đảm bảo không ai khác có email đó ⇒ lấy số từ đấy, bỏ qua `input.phone`. Không làm
 * vậy thì ai cũng khai được số người khác vào hồ sơ mình, rồi chiếm luôn việc đăng
 * nhập bằng số đó.
 */
const profilePhone = (account: SupabaseAccount, input: Input): string | null => {
  const fromLogin = phoneFromLoginEmail(account.email);
  if (fromLogin) return fromLogin;
  // Tài khoản cũ đăng ký bằng email thật: số khai lúc đăng ký nằm trong user_metadata.
  const raw = input.phone ?? metadataText(account, 'phone');
  if (!raw) return null;
  const phone = normalizePhone(raw);
  if (!phone) throw new ApiException('VALIDATION_FAILED', 'Số điện thoại chưa đúng', { fields: { phone: 'Số điện thoại chưa đúng' } });
  return phone;
};

const metadataText = (account: SupabaseAccount, key: string): string | null => {
  const value = account.user_metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email khôi phục = email thật người dùng khai lúc đăng ký (`user_metadata.recoveryEmail`).
 * Đăng nhập bằng email đó đi qua `find_login_user` → cùng tài khoản với SĐT (issue FE#9).
 * Email nội bộ `84…@id.thumua365.vn` không bao giờ là email khôi phục.
 */
const profileRecoveryEmail = (account: SupabaseAccount): string | null => {
  const raw = metadataText(account, 'recoveryEmail')?.toLowerCase() ?? null;
  if (!raw || raw.length > 200 || !EMAIL.test(raw) || isInternalEmail(raw)) return null;
  return raw;
};

/** Trùng tên đăng nhập / email khôi phục / số điện thoại với tài khoản khác → 422 chỉ đúng trường. */
const uniqueViolation = (err: unknown): ApiException | null => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null;
  const where = `${JSON.stringify(err.meta ?? {})} ${err.message}`;
  const field = where.includes('username')
    ? 'username'
    : where.includes('recovery_email')
      ? 'recoveryEmail'
      : where.includes('phone')
        ? 'phone'
        : null;
  if (!field) return null;
  const message = {
    username: 'Tên đăng nhập đã có người dùng',
    recoveryEmail: 'Email này đã gắn với tài khoản khác',
    phone: 'Số điện thoại đã gắn với tài khoản khác',
  }[field];
  return new ApiException('VALIDATION_FAILED', message, { fields: { [field]: message } });
};

/**
 * Bước "Bạn là ai?" — hồ sơ + tổ chức + chủ + (vựa, DN) gói dùng thử và mặt hàng mặc định,
 * MỘT transaction.
 *
 * Idempotent: người đã thuộc một tổ chức gọi lại thì không tạo gì thêm. Khoá
 * advisory theo user chặn hai lần bấm cùng lúc tạo ra hai tổ chức.
 */
@Injectable()
export class BootstrapService {
  private readonly db: Database;
  private readonly events: DomainEvents;
  private readonly recoveryMail: RecoveryMailService;

  constructor(@Inject(DATABASE) db: Database, events: DomainEvents, recoveryMail: RecoveryMailService) {
    this.db = db;
    this.events = events;
    this.recoveryMail = recoveryMail;
  }

  /** Trả `true` nếu lần gọi này tạo tổ chức mới. */
  async run(user: AuthUser, account: SupabaseAccount, input: Input, requestId: string): Promise<boolean> {
    const phone = profilePhone(account, input);
    const recoveryEmail = profileRecoveryEmail(account);
    const organizationId = randomUUID();

    // Email đã là định danh của tài khoản khác (index `profiles_recovery_email_live`) thì bỏ qua:
    // không chặn cả bước đăng ký vì một trường người dùng không sửa được ở màn này. Người đó vẫn
    // đăng nhập bằng SĐT, đặt email khác sau ở PATCH /v1/me/profile. RLS chỉ cho thấy hồ sơ của
    // chính mình ⇒ hỏi qua `find_login_user` (security definer), giống /v1/auth/resolve-identifier.
    const freeEmail = async (tx: Tx): Promise<string | null> => {
      if (!recoveryEmail) return null;
      const rows = await tx.$queryRaw<{ id: string | null }[]>`select public.find_login_user(${recoveryEmail})::text as id`;
      const owner = rows[0]?.id;
      return owner && owner !== user.id ? null : recoveryEmail;
    };

    let created: boolean;
    try {
      created = await this.db.scoped({ userId: user.id, orgId: organizationId }, async (tx) => {
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;

        const already = await tx.membership.count({ where: { userId: user.id, status: 'active' } });
        if (already > 0) return false;

        const profile = await tx.profile.findUnique({ where: { id: user.id }, select: { id: true } });
        if (!profile) {
          await tx.profile.create({
            data: { id: user.id, name: input.name, phone, username: input.username ?? null, recoveryEmail: await freeEmail(tx) },
            select: { id: true },
          });
        }

        await tx.organization.create({
          data: { id: organizationId, type: input.orgType, name: input.orgName, phone, createdBy: user.id },
          select: { id: true },
        });
        await tx.membership.create({
          data: { userId: user.id, organizationId, role: 'owner', status: 'active' },
          select: { id: true },
        });
        if (hasBook(input.orgType)) {
          await tx.subscription.create({
            data: { organizationId, status: 'trialing', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY_MS) },
            select: { id: true },
          });
          // Mặt hàng mặc định của sổ, id do server sinh: `prod-rubber`… của core không phải
          // UUID nên không đồng bộ được. App kéo về rồi gộp theo tên như normalize() vẫn làm.
          await tx.product.createMany({
            data: DEFAULT_PRODUCTS.map((p) => ({
              id: randomUUID(),
              organizationId,
              createdBy: user.id,
              name: p.name,
              unit: p.unit,
              formulaType: p.formulaType,
              isSuggested: true,
              isActive: true,
              crop: p.crop ?? null,
              qualityGrades: [],
            })),
          });
        }
        await recordAudit(tx, {
          organizationId,
          actorUserId: user.id,
          action: 'organization.bootstrapped',
          entity: 'organization',
          entityId: organizationId,
          after: { type: input.orgType, role: 'owner', trial: hasBook(input.orgType) },
          requestId,
        });
        return true;
      });
    } catch (err) {
      throw uniqueViolation(err) ?? err;
    }

    if (created) {
      this.events.emit('organization.created', { organizationId, orgType: input.orgType, userId: user.id, role: 'owner' });
      // Email khai lúc đăng ký: gửi thư xác nhận luôn (sau commit, lỗi chỉ ghi log).
      if (recoveryEmail) await this.recoveryMail.sendVerificationQuietly(user.id);
    }
    return created;
  }
}
