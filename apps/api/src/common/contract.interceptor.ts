import type { RouteDef } from '@mambo/contracts';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { ApiException } from './api-exception';
import { ROUTE_KEY } from './endpoint';

/**
 * "Transform" trên sơ đồ: mọi phản hồi thành công đi qua schema của hợp đồng.
 *
 *  - Trường thừa (nội bộ, lỡ tay trả ra) bị LỌC BỎ — zod bỏ key lạ khi parse.
 *  - Sai hình dạng là lỗi của server ⇒ 500, không để frontend nhận dữ liệu hỏng.
 *
 * Đổi camelCase ↔ snake_case KHÔNG nằm ở đây: nó thuộc về lớp truy cập dữ liệu
 * (Prisma `@map`, từ BE2), nơi biết hàng DB trông thế nào.
 */
@Injectable()
export class ContractInterceptor implements NestInterceptor {
  private readonly reflector: Reflector;

  constructor(reflector: Reflector) {
    this.reflector = reflector;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = this.reflector.get<RouteDef | undefined>(ROUTE_KEY, context.getHandler());
    if (!route) return next.handle();

    return next.handle().pipe(
      map((data: unknown) => {
        const parsed = route.response.safeParse(data);
        if (parsed.success) return parsed.data;
        throw new ApiException('INTERNAL', 'Phản hồi không khớp hợp đồng', {
          path: route.path,
          issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }),
    );
  }
}
