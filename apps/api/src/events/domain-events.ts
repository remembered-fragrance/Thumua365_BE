/**
 * Sự kiện miền — event bus nội bộ (KH §1.8, `@nestjs/event-emitter`).
 *
 * Việc chính xong trong transaction; SAU KHI COMMIT mới phát sự kiện, các listener
 * (thông báo, đo lường, audit phụ) làm phần còn lại. Module không gọi chéo nhau để
 * làm việc phụ. Listener hỏng KHÔNG làm hỏng việc chính: lỗi vào log + Sentry.
 *
 * Danh mục sự kiện có kiểu ở đây — phát sai tên hay sai dữ liệu là lỗi biên dịch.
 */

import type { MemberRole, OrgType } from '@mambo/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Logger } from 'winston';

export interface DomainEventMap {
  /** Có người đăng ký xong bước "Bác là ai?" — đo lường `sign_up_completed` (BE9). */
  'organization.created': {
    readonly organizationId: string;
    readonly orgType: OrgType;
    readonly userId: string;
    readonly role: MemberRole;
  };
  /** Dò kết nối tạo được lời mời mới — thông báo cho vựa (BE4–BE5). */
  'link.discovered': { readonly linkedOrgId: string; readonly created: number };
  /** Bên được liên kết đồng ý — thông báo cho bên sổ (BE5), đo lường `link_accepted` (BE9). */
  'link.accepted': {
    readonly linkId: string;
    readonly ownerOrgId: string;
    readonly linkedOrgId: string;
    readonly actorUserId: string;
  };
  /** Một bên huỷ kết nối — thông báo cho bên kia (BE5). */
  'link.revoked': {
    readonly linkId: string;
    readonly ownerOrgId: string;
    readonly linkedOrgId: string | null;
    readonly by: 'owner' | 'linked';
    readonly actorUserId: string;
  };
  /** Đơn chuyển trạng thái (BE5) — thông báo cho bên kia; `order.fulfilled` còn cho đo lường (BE9). */
  'order.submitted': OrderChanged;
  'order.accepted': OrderChanged;
  'order.scheduled': OrderChanged;
  'order.cancelled': OrderChanged;
  /** Phát từ đồng bộ sổ: phiếu theo đơn vừa lên. */
  'order.fulfilled': OrderChanged;
  /** Gói vừa mở / gia hạn (BE6) — đo lường `plan_activated` (BE9). Thông báo đã ghi cùng transaction. */
  'plan.activated': { readonly organizationId: string; readonly months: number; readonly source: 'webhook' | 'admin' };
}

/** Ai (tổ chức, người) vừa đổi đơn nào. Bên kia = bên còn lại trong hai bên bán/mua. */
export interface OrderChanged {
  readonly orderId: string;
  readonly actorOrgId: string;
  readonly actorUserId: string;
  readonly sellerOrgId: string | null;
  readonly buyerOrgId: string;
}

export type OrderEventName = 'order.submitted' | 'order.accepted' | 'order.scheduled' | 'order.cancelled' | 'order.fulfilled';

export type DomainEventName = keyof DomainEventMap;

export const LOGGER = Symbol('LOGGER');

/**
 * Listener của BE4+ theo đúng khuôn:
 *   `@OnEvent('order.fulfilled', { async: true, suppressErrors: true })`
 * `suppressErrors` để listener hỏng không làm hỏng request; tự bắt lỗi và gửi Sentry.
 */
@Injectable()
export class DomainEvents {
  private readonly emitter: EventEmitter2;
  private readonly logger: Logger;

  constructor(emitter: EventEmitter2, @Inject(LOGGER) logger: Logger) {
    this.emitter = emitter;
    this.logger = logger;
  }

  /** Gọi SAU KHI transaction đã commit. Payload chỉ mang id — không tên, SĐT, số tiền. */
  emit<N extends DomainEventName>(name: N, payload: DomainEventMap[N]): void {
    this.logger.info('domain_event', { event: name, ...payload });
    this.emitter.emit(name, payload);
  }
}
