/**
 * Báo cáo tổng — KH backend §6, BE7. Tổng hợp phía server để chủ doanh nghiệp thấy nhiều chi nhánh
 * mà không phải kéo cả sổ về máy. Tiền, khối lượng, còn nợ tính bằng ĐÚNG `transactionTotals` của
 * `@mambo/core` — báo cáo khớp từng đồng với từng phiếu trên app.
 *
 *   Vựa / doanh nghiệp: phiếu trong sổ (qua RLS), chia theo chi nhánh. Người gắn chi nhánh chỉ thấy
 *     chi nhánh mình (xin chi nhánh khác → FORBIDDEN).
 *   Nông dân: phiếu các vựa đang kết nối ghi về mình (`linked_receipts()`, BE4), lật chiều — vựa MUA
 *     của mình là mình BÁN.
 */

import { transactionTotals } from '@mambo/core/calc';
import type { PriceAdjustment, TransactionLine } from '@mambo/core/types';
import { hasBook, type ReportFigures, type ReportSide, type ReportSummary, type ReportSummaryQuery } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import type { MembershipContext } from '../auth/membership';
import { ApiException } from '../common/api-exception';
import { DATABASE, type Database, type Tx } from '../db/database';

type Kind = 'purchase' | 'sale';

interface Receipt {
  readonly kind: Kind;
  readonly branchId: string | null;
  readonly lines: readonly TransactionLine[];
  readonly adjustments: readonly PriceAdjustment[];
  readonly paid: number;
}

interface LinkedRow {
  date: Date;
  kind: string;
  lines: unknown;
  adjustments: unknown;
  payments: { amount: number }[];
}

const emptySide = (): ReportSide => ({ count: 0, netWeight: 0, amount: 0, paid: 0, debt: 0 });
const emptyFigures = (): ReportFigures => ({ purchase: emptySide(), sale: emptySide() });

const add = (figures: ReportFigures, r: Receipt): void => {
  const t = transactionTotals({ lines: r.lines, adjustments: r.adjustments, amountPaid: r.paid });
  const side = figures[r.kind];
  side.count += 1;
  side.netWeight = Math.round((side.netWeight + t.netWeight) * 100) / 100;
  side.amount += t.total;
  side.paid += r.paid;
  side.debt += t.debt;
};

@Injectable()
export class ReportsService {
  private readonly db: Database;

  constructor(@Inject(DATABASE) db: Database) {
    this.db = db;
  }

  summary(user: AuthUser, m: MembershipContext, query: ReportSummaryQuery): Promise<ReportSummary> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    return this.db.scoped({ userId: user.id, orgId: m.organizationId }, async (tx) => {
      if (!hasBook(m.orgType)) {
        const totals = emptyFigures();
        for (const r of await linkedReceipts(tx, from, to)) add(totals, r);
        return { from: from.toISOString(), to: to.toISOString(), totals, branches: [] };
      }

      const branchId = await scopeBranch(tx, m, query.branchId);
      const rows = await tx.transaction.findMany({
        where: {
          organizationId: m.organizationId,
          deletedAt: null,
          date: { gte: from, lt: to },
          ...(branchId ? { branchId } : {}),
        },
        select: { kind: true, branchId: true, lines: true, adjustments: true, payments: { where: { deletedAt: null }, select: { amount: true } } },
      });

      const totals = emptyFigures();
      const byBranch = new Map<string | null, ReportFigures>();
      for (const row of rows) {
        const receipt: Receipt = {
          kind: row.kind as Kind,
          branchId: row.branchId,
          lines: row.lines as unknown as TransactionLine[],
          adjustments: (row.adjustments ?? []) as unknown as PriceAdjustment[],
          paid: row.payments.reduce((sum, p) => sum + Number(p.amount), 0),
        };
        add(totals, receipt);
        const figures = byBranch.get(receipt.branchId) ?? emptyFigures();
        add(figures, receipt);
        byBranch.set(receipt.branchId, figures);
      }

      const ids = [...byBranch.keys()].filter((id): id is string => id !== null);
      const names = new Map(
        (await tx.branch.findMany({ where: { id: { in: ids }, organizationId: m.organizationId }, select: { id: true, name: true } })).map(
          (b) => [b.id, b.name],
        ),
      );
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        totals,
        branches: [...byBranch.entries()]
          .map(([id, figures]) => ({ branch: id ? { id, name: names.get(id) ?? '' } : null, figures }))
          .sort((a, b) => (a.branch?.name ?? '').localeCompare(b.branch?.name ?? '', 'vi')),
      };
    });
  }
}

/** Chủ chọn được một chi nhánh (phải là của mình); người gắn chi nhánh luôn chỉ chi nhánh mình. */
const scopeBranch = async (tx: Tx, m: MembershipContext, requested: string | undefined): Promise<string | null> => {
  if (m.branchId) {
    if (requested && requested !== m.branchId) {
      throw new ApiException('FORBIDDEN', 'Chỉ xem được báo cáo của chi nhánh mình', { branchId: m.branchId });
    }
    return m.branchId;
  }
  if (!requested) return null;
  const branch = await tx.branch.findFirst({ where: { id: requested, organizationId: m.organizationId }, select: { id: true } });
  if (!branch) throw new ApiException('NOT_FOUND', 'Không có chi nhánh này');
  return requested;
};

/** Nông dân: phiếu vựa ghi về mình, lật chiều về phía mình. */
const linkedReceipts = async (tx: Tx, from: Date, to: Date): Promise<Receipt[]> => {
  const rows = await tx.$queryRaw<LinkedRow[]>`select * from public.linked_receipts(null::uuid, null::timestamptz, null::uuid, null::int)`;
  return rows
    .filter((r) => r.date >= from && r.date < to)
    .map((r) => ({
      kind: r.kind === 'purchase' ? 'sale' : 'purchase',
      branchId: null,
      lines: r.lines as TransactionLine[],
      adjustments: (r.adjustments ?? []) as PriceAdjustment[],
      paid: r.payments.reduce((sum, p) => sum + Number(p.amount), 0),
    }));
};
