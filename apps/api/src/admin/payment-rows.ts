import { type AdminPaymentRow, BankTxOutcome, OrgType, PaymentIntentStatus } from '@mambo/contracts';
import type { Tx } from '../db/database';
import { Prisma } from '../generated/prisma/client';

interface Filter {
  readonly from?: Date;
  readonly to?: Date;
  readonly organizationId?: string;
  readonly limit: number;
}

/**
 * Ý định chuyển khoản nối với sổ đối soát ngân hàng — cả hai phía, vì có ý định chưa trả và có tiền vào không qua ý
 * định (mở bằng tay). Mới nhất trước. Dùng chung cho danh sách giao dịch (0.31.0) và trang chi tiết tổ chức (0.32.0).
 */
export const paymentRows = async (tx: Tx, filter: Filter): Promise<AdminPaymentRow[]> => {
  const conditions: Prisma.Sql[] = [];
  if (filter.from) conditions.push(Prisma.sql`coalesce(bt.created_at, pi.created_at) >= ${filter.from}`);
  if (filter.to) conditions.push(Prisma.sql`coalesce(bt.created_at, pi.created_at) < ${filter.to}`);
  if (filter.organizationId) conditions.push(Prisma.sql`coalesce(pi.organization_id, bt.organization_id) = ${filter.organizationId}::uuid`);
  const where = conditions.length > 0 ? Prisma.sql`where ${Prisma.join(conditions, ' and ')}` : Prisma.empty;

  const rows = await tx.$queryRaw<
    {
      at: Date;
      org_id: string | null;
      org_name: string | null;
      org_type: string | null;
      intent_id: string | null;
      intent_amount: bigint | null;
      provider_ref: string | null;
      intent_status: string | null;
      intent_at: Date | null;
      bank_tx_id: string | null;
      paid: bigint | null;
      source: string | null;
      outcome: string | null;
      paid_at: Date | null;
    }[]
  >`
    select coalesce(bt.created_at, pi.created_at) as at,
           o.id as org_id, o.name as org_name, o.type as org_type,
           pi.id as intent_id, pi.amount as intent_amount, pi.provider_ref, pi.status as intent_status, pi.created_at as intent_at,
           bt.bank_tx_id, bt.amount as paid, bt.source, bt.outcome, bt.created_at as paid_at
    from (select * from payment_intents where deleted_at is null) pi
    full join bank_transactions bt on bt.payment_intent_id = pi.id
    left join organizations o on o.id = coalesce(pi.organization_id, bt.organization_id)
    ${where}
    order by coalesce(bt.created_at, pi.created_at) desc
    limit ${filter.limit}`;

  return rows.map((r) => ({
    at: r.at.toISOString(),
    organization: r.org_id && r.org_name && r.org_type ? { id: r.org_id, name: r.org_name, type: OrgType.parse(r.org_type) } : null,
    intent:
      r.intent_id && r.intent_amount !== null && r.intent_at
        ? {
            id: r.intent_id,
            amount: Number(r.intent_amount),
            code: r.provider_ref,
            status: PaymentIntentStatus.parse(r.intent_status),
            createdAt: r.intent_at.toISOString(),
          }
        : null,
    bank:
      r.bank_tx_id && r.paid !== null && r.paid_at
        ? {
            bankTxId: r.bank_tx_id,
            amount: Number(r.paid),
            source: r.source === 'admin' ? 'admin' : 'webhook',
            outcome: BankTxOutcome.parse(r.outcome),
            createdAt: r.paid_at.toISOString(),
          }
        : null,
  }));
};
