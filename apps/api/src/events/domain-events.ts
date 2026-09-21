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
}

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
