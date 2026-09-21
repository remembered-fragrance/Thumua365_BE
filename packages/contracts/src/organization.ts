/**
 * Hai trục của mô hình ba vai trò — KH backend §1.2. KHÔNG gộp làm một.
 *
 *   OrgType     — bên này là ai trong chuỗi (quyết định vỏ giao diện, gói trả tiền)
 *   MemberRole  — người này được làm gì trong bên đó (quyết định từng thao tác)
 */

import { z } from 'zod';

export const ORG_TYPES = ['farmer', 'trader', 'enterprise'] as const;
export const OrgType = z.enum(ORG_TYPES);
export type OrgType = z.infer<typeof OrgType>;

export const MEMBER_ROLES = ['owner', 'manager', 'staff'] as const;
export const MemberRole = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof MemberRole>;

/** Tổ chức nào có sổ offline và trả tiền theo gói. Nông dân miễn phí, không có sổ. */
export const hasBook = (type: OrgType): boolean => type !== 'farmer';
