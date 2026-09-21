import type { RouteDef } from '@mambo/contracts';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import type { z } from 'zod';
import { ApiException } from './api-exception';
import { ROUTE_KEY } from './endpoint';
import type { ApiRequest } from './request-context';

/** `{ "orgName": "Too small…" }` — đường dẫn trường → câu lỗi đầu tiên. Không lặp lại giá trị đã gửi. */
const fieldErrors = (error: z.ZodError): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '(body)';
    fields[key] ??= issue.message;
  }
  return fields;
};

/**
 * Hai ô trên sơ đồ ("zod DTO" và "Transform") ở một chỗ, cùng đọc dòng `routes`:
 *
 * VÀO — thân request đi qua `route.body` TRƯỚC khi tới handler. Sai → 422
 * `VALIDATION_FAILED`, `details.fields` chỉ đúng trường sai. Handler nhận bản đã
 * chuẩn hoá (trim, chữ thường…) qua `@Body()`; schema là `strictObject` nên trường
 * lạ bị từ chối, không lặng lẽ bỏ qua.
 *
 * RA — mọi phản hồi thành công đi qua `route.response`:
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

    if (route.body) {
      const req = context.switchToHttp().getRequest<ApiRequest>();
      const parsed = route.body.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiException('VALIDATION_FAILED', 'Dữ liệu gửi lên chưa đúng', { fields: fieldErrors(parsed.error) });
      }
      req.body = parsed.data;
    }

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
