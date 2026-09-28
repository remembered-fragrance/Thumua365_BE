/**
 * Kiểm MỘT op của `/sync/push` — vỏ đã qua cổng, giờ tới `data` theo đúng loại op. Server dùng
 * để trả lỗi theo từng op; app dùng được để bắt lỗi TRƯỚC khi đưa op vào hàng đợi.
 */

import { z } from 'zod';
import {
  SYNC_ENTITIES,
  SYNC_OP_DATA,
  SYNC_OP_KINDS,
  type SyncEntity,
  SyncEntity as SyncEntitySchema,
  type SyncOpEnvelope,
  type SyncOpKind,
  SyncOpKind as SyncOpKindSchema,
} from './sync.js';

const Id = z.uuid();

/** Op đã kiểm xong: `data` đã chuẩn hoá (cắt khoảng trắng…); `softDelete` không có `data`. */
export interface ParsedSyncOp {
  readonly opId: string;
  readonly seq: number;
  readonly entity: SyncEntity;
  readonly kind: SyncOpKind;
  readonly recordId: string;
  readonly data: Record<string, unknown> | undefined;
}

export type SyncOpCheck =
  | { readonly ok: true; readonly op: ParsedSyncOp }
  | { readonly ok: false; readonly fields: Readonly<Record<string, string>> };

const invalid = (field: string, message: string): SyncOpCheck => ({ ok: false, fields: { [field]: message } });

export const parseSyncOp = (raw: SyncOpEnvelope): SyncOpCheck => {
  const entity = SyncEntitySchema.safeParse(raw.entity);
  if (!entity.success) return invalid('entity', `Loại bản ghi phải là một trong: ${SYNC_ENTITIES.join(', ')}`);
  const kind = SyncOpKindSchema.safeParse(raw.kind);
  if (!kind.success) return invalid('kind', `Thao tác phải là một trong: ${SYNC_OP_KINDS.join(', ')}`);
  if (!Id.safeParse(raw.recordId).success) {
    return invalid('recordId', 'recordId phải là UUID (id mặt hàng mặc định kiểu cũ `prod-…` không đồng bộ được)');
  }

  const base = { opId: raw.opId, seq: raw.seq, entity: entity.data, kind: kind.data, recordId: raw.recordId };
  if (kind.data === 'softDelete') {
    if (raw.data !== undefined) return invalid('data', 'softDelete không mang data');
    return { ok: true, op: { ...base, data: undefined } };
  }

  const schema = SYNC_OP_DATA[entity.data][kind.data];
  if (!schema) return invalid('kind', `${entity.data} không có thao tác ${kind.data}`);
  const parsed = schema.safeParse(raw.data);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[['data', ...issue.path].join('.')] ??= issue.message;
    return { ok: false, fields };
  }
  return { ok: true, op: { ...base, data: parsed.data as Record<string, unknown> } };
};
