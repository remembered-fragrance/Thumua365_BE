import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Response } from 'express';
import type { Logger } from 'winston';
import { ApiException } from './api-exception';
import { toErrorBody } from './error-body';
import type { ApiRequest } from './request-context';

/** Bắt MỌI lỗi — kể cả lỗi không phải HttpException — và trả đúng một định dạng. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<ApiRequest>();
    const res = http.getResponse<Response>();
    const { status, body } = toErrorBody(exception, req.requestId);

    if (status >= 500) {
      this.logger.error('unhandled', {
        requestId: req.requestId,
        path: req.path,
        error:
          exception instanceof Error
            ? {
                name: exception.name,
                message: exception.message,
                details: exception instanceof ApiException ? exception.details : undefined,
                stack: exception.stack,
              }
            : exception,
      });
      if (Sentry.isInitialized()) Sentry.captureException(exception, { tags: { requestId: req.requestId } });
    }

    res.status(status).json(body);
  }
}
