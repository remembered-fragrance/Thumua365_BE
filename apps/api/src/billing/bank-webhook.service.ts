/**
 * POST /v1/webhooks/bank — Casso / SePay báo tiền vào → gói tự gia hạn. Thay Edge Function
 * `payment-webhook` của bản cũ; giữ nguyên ba chốt của nó, không rút gọn cái nào:
 *
 *   1. XÁC THỰC BÍ MẬT — thiếu là ai cũng tự gia hạn miễn phí được. So sánh không đo được thời gian.
 *   2. CHỐNG TRÙNG theo mã giao dịch ngân hàng — ghi sổ đối soát TRƯỚC khi gia hạn (`activatePlan`).
 *   3. KHỚP SỐ TIỀN — chuyển thiếu thì không mở gói, để đường thủ công (`/v1/admin/plans/activate`).
 *
 * Mã đối soát dò bằng `findTransferCode` của `@mambo/core` — cùng hàm sinh mã trên app.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { findTransferCode } from '@mambo/core/transferCode';
import type { BankWebhookResult } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'winston';
import { ApiException } from '../common/api-exception';
import { ENV, type Env } from '../config/env';
import { monthsForAmount } from '../config/plans';
import { PRIVILEGED_DATABASE, type PrivilegedDatabase, privileged } from '../db/privileged-database';
import { DomainEvents, LOGGER } from '../events/domain-events';
import { activatePlan } from './plan-activation';

interface BankTx {
  readonly bankTxId: string;
  readonly amount: number;
  readonly description: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const num = (value: unknown): number => (typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN);

/** Casso: `{ data: [...] }`; SePay: một giao dịch phẳng, có `transferType: 'in' | 'out'`. */
export const readTransactions = (body: unknown): BankTx[] => {
  const root = (body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(root.data) ? root.data : [root];
  return list
    .map((raw) => (raw ?? {}) as Record<string, unknown>)
    .filter((tx) => tx.transferType !== 'out')
    .map((tx) => ({
      bankTxId: text(tx.tid) || text(tx.id) || text(tx.referenceCode),
      amount: Number.isFinite(num(tx.amount)) ? num(tx.amount) : num(tx.transferAmount),
      description: text(tx.description) || text(tx.content),
    }))
    .filter((tx) => tx.bankTxId !== '' && Number.isFinite(tx.amount) && tx.amount > 0);
};

/** So hai bí mật qua băm SHA-256 — cùng độ dài nên `timingSafeEqual` không lộ độ dài hay vị trí lệch. */
const sameSecret = (given: string, expected: string): boolean =>
  timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());

/** Casso: header `secure-token`; SePay: `Authorization: Apikey <bí mật>`. */
export const tokenFrom = (secureToken: string | undefined, authorization: string | undefined): string =>
  secureToken?.trim() || authorization?.replace(/^Apikey\s+/i, '').trim() || '';

@Injectable()
export class BankWebhookService {
  private readonly env: Env;
  private readonly db: PrivilegedDatabase | null;
  private readonly events: DomainEvents;
  private readonly logger: Logger;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(PRIVILEGED_DATABASE) db: PrivilegedDatabase | null,
    events: DomainEvents,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.env = env;
    this.db = db;
    this.events = events;
    this.logger = logger;
  }

  async handle(token: string, body: unknown, requestId: string): Promise<BankWebhookResult> {
    const secret = this.env.BANK_WEBHOOK_SECRET;
    if (!secret) {
      // Cấu hình thiếu: trả 401 để Casso / SePay gửi lại sau, và kêu to trong log.
      this.logger.error('bank_webhook.secret_missing', { requestId });
      throw new ApiException('UNAUTHENTICATED', 'Webhook chưa được cấu hình');
    }
    if (token === '' || !sameSecret(token, secret)) throw new ApiException('UNAUTHENTICATED', 'Sai bí mật webhook');

    const db = privileged(this.db);
    const handled: string[] = [];
    const skipped: string[] = [];

    for (const bank of readTransactions(body)) {
      const code = findTransferCode(bank.description);
      if (!code) {
        skipped.push(bank.bankTxId);
        continue;
      }
      const done = await db.run(async (tx) => {
        const intent = await tx.paymentIntent.findFirst({
          where: { providerRef: code, status: 'pending', deletedAt: null },
          select: { id: true, organizationId: true, amount: true },
        });
        // Chuyển thiếu cũng để đường thủ công: cộng nửa kỳ hạn là thứ không giải thích được.
        if (!intent || bank.amount < Number(intent.amount)) return null;

        const months = monthsForAmount(Number(intent.amount)) ?? 1;
        const plan = await activatePlan(
          tx,
          {
            organizationId: intent.organizationId,
            months,
            source: 'webhook',
            bankTxId: bank.bankTxId,
            amount: bank.amount,
            paymentIntentId: intent.id,
            description: bank.description,
          },
          new Date(),
        );
        if (!plan) return null;
        await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'paid' }, select: { id: true } });
        return { organizationId: intent.organizationId, months };
      });

      if (done) {
        handled.push(bank.bankTxId);
        this.events.emit('plan.activated', { ...done, source: 'webhook' });
      } else {
        skipped.push(bank.bankTxId);
      }
    }

    this.logger.info('bank_webhook', { requestId, handled: handled.length, skipped: skipped.length });
    return { handled, skipped };
  }
}
