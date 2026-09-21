import { randomUUID } from 'node:crypto';
import { normalizePhone } from '@mambo/core/identifier';
import { type MeBootstrapInput, hasBook } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-user';
import { phoneFromLoginEmail } from '../auth/login-email';
import type { SupabaseAccount } from '../auth/supabase-users';
import { ApiException } from '../common/api-exception';
import { TRIAL_DAYS } from '../config/plans';
import { DATABASE, type Database } from '../db/database';
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
  if (!input.phone) return null;
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiException('VALIDATION_FAILED', 'Số điện thoại chưa đúng', { fields: { phone: 'Số điện thoại chưa đúng' } });
  return phone;
};

/** Trùng tên đăng nhập / số điện thoại với tài khoản khác → 422 chỉ đúng trường. */
const uniqueViolation = (err: unknown): ApiException | null => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null;
  const where = `${JSON.stringify(err.meta ?? {})} ${err.message}`;
  const field = where.includes('username') ? 'username' : where.includes('phone') ? 'phone' : null;
  if (!field) return null;
  const message = field === 'username' ? 'Tên đăng nhập đã có người dùng' : 'Số điện thoại đã gắn với tài khoản khác';
  return new ApiException('VALIDATION_FAILED', message, { fields: { [field]: message } });
};

/**
 * Bước "Bác là ai?" — hồ sơ + tổ chức + chủ + (vựa, DN) gói dùng thử, MỘT transaction.
 *
 * Idempotent: người đã thuộc một tổ chức gọi lại thì không tạo gì thêm. Khoá
 * advisory theo user chặn hai lần bấm cùng lúc tạo ra hai tổ chức.
 */
@Injectable()
export class BootstrapService {
  private readonly db: Database;
  private readonly events: DomainEvents;

  constructor(@Inject(DATABASE) db: Database, events: DomainEvents) {
    this.db = db;
    this.events = events;
  }

  /** Trả `true` nếu lần gọi này tạo tổ chức mới. */
  async run(user: AuthUser, account: SupabaseAccount, input: Input, requestId: string): Promise<boolean> {
    const phone = profilePhone(account, input);
    const organizationId = randomUUID();

    let created: boolean;
    try {
      created = await this.db.scoped({ userId: user.id, orgId: organizationId }, async (tx) => {
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;

        const already = await tx.membership.count({ where: { userId: user.id, status: 'active' } });
        if (already > 0) return false;

        const profile = await tx.profile.findUnique({ where: { id: user.id }, select: { id: true } });
        if (!profile) {
          await tx.profile.create({
            data: { id: user.id, name: input.name, phone, username: input.username ?? null },
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
    }
    return created;
  }
}
