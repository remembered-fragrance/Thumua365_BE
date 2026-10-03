/**
 * Hồ sơ của chính người gọi và mã giới thiệu — KH backend §6, BE6. Qua RLS (`own_profile`: chỉ hồ
 * sơ của mình); tra mã của người khác chỉ qua hàm `claim_referral()`.
 */

import type { MeProfile, MeProfilePatch } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { ApiException } from '../common/api-exception';
import { DATABASE, type Database } from '../db/database';
import { Prisma, type Profile } from '../generated/prisma/client';

const toProfile = (row: Profile): MeProfile => ({
  name: row.name,
  username: row.username,
  phone: row.phone,
  recoveryEmail: row.recoveryEmail,
  referralCode: row.referralCode,
  referred: row.referredBy !== null,
});

const noProfile = (): ApiException => new ApiException('NOT_FOUND', 'Chưa có hồ sơ — làm bước "Bác là ai?" trước');

@Injectable()
export class ProfileService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  get(user: AuthUser): Promise<MeProfile> {
    return this.db.scoped({ userId: user.id, orgId: null }, async (tx) => {
      const row = await tx.profile.findFirst({ where: { id: user.id, deletedAt: null } });
      if (!row) throw noProfile();
      return toProfile(row);
    });
  }

  async update(user: AuthUser, patch: z.output<typeof MeProfilePatch>): Promise<MeProfile> {
    try {
      return await this.db.scoped({ userId: user.id, orgId: null }, async (tx) => {
        const { count } = await tx.profile.updateMany({ where: { id: user.id, deletedAt: null }, data: patch });
        if (count === 0) throw noProfile();
        return toProfile(await tx.profile.findUniqueOrThrow({ where: { id: user.id } }));
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ApiException('VALIDATION_FAILED', 'Tên đăng nhập này đã có người dùng', {
          fields: { username: 'Đã có người dùng' },
        });
      }
      throw err;
    }
  }

  /** Luôn trả kết quả, không ném: không cho biết vì sao mã không dùng được. */
  claimReferral(user: AuthUser, code: string): Promise<{ claimed: boolean }> {
    return this.db.scoped({ userId: user.id, orgId: null }, async (tx) => {
      const rows = await tx.$queryRaw<{ claimed: boolean }[]>`select public.claim_referral(${code}) as claimed`;
      return { claimed: rows[0]?.claimed === true };
    });
  }
}
