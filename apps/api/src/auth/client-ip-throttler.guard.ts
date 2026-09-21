import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ApiRequest } from '../common/request-context';

/**
 * Hạn mức theo IP THẬT của người gọi.
 *
 * Mặc định ThrottlerGuard dùng `req.ip`. Trên Render (sau Cloudflare) đó là IP
 * của máy Cloudflare, mỗi request một khác ⇒ không ai chạm hạn mức — đã đo trên
 * staging 21/09/2026: 125 request/40 giây, không request nào bị 429.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return (req as unknown as ApiRequest).clientIp;
  }
}
