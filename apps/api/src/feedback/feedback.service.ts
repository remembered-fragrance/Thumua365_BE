/**
 * POST /v1/feedback — góp ý + chấm sao trong app (0.25.0). Người và tổ chức lấy từ phiên, không tin app.
 * api_service chỉ có INSERT trên bảng này (RLS `own_feedback`) — quản trị đọc bằng Supabase.
 */

import type { FeedbackInput, FeedbackResult } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { DATABASE, type Database } from '../db/database';

@Injectable()
export class FeedbackService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  async create(user: AuthUser, m: MembershipContext, input: z.output<typeof FeedbackInput>): Promise<FeedbackResult> {
    await this.db.scoped({ userId: user.id, orgId: m.organizationId }, (tx) =>
      // createMany: không có quyền đọc ⇒ không RETURNING được như create().
      tx.feedback.createMany({
        data: {
          organizationId: m.organizationId,
          userId: user.id,
          rating: input.rating,
          comment: input.comment,
          platform: input.platform,
          appVersion: input.appVersion ?? null,
        },
      }),
    );
    return { ok: true };
  }
}
