import { ERROR_STATUS, type ErrorBody, type ErrorCode } from '@mambo/contracts';
import { HttpException } from '@nestjs/common';
import { ApiException } from './api-exception';

/** Lỗi HTTP của framework (404 route lạ, 429 throttler…) đổi sang mã hợp đồng. */
const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

const MESSAGE: Readonly<Partial<Record<ErrorCode, string>>> = {
  NOT_FOUND: 'Không có đường dẫn này',
  PAYLOAD_TOO_LARGE: 'Dữ liệu gửi lên quá lớn',
  RATE_LIMITED: 'Gửi quá nhiều yêu cầu, thử lại sau ít phút',
  VALIDATION_FAILED: 'Dữ liệu gửi lên không đúng định dạng',
  UNAUTHENTICATED: 'Chưa đăng nhập hoặc phiên đã hết hạn',
  FORBIDDEN: 'Không có quyền làm việc này',
  INTERNAL: 'Máy chủ gặp lỗi, thử lại sau',
};

export interface MappedError {
  readonly status: number;
  readonly body: ErrorBody;
}

/**
 * Mọi thứ ném ra đều thành đúng một hình dạng lỗi. Lỗi không lường trước (không
 * phải HttpException) luôn là INTERNAL và KHÔNG để lộ thông điệp gốc ra ngoài.
 */
export const toErrorBody = (exception: unknown, requestId: string): MappedError => {
  let code: ErrorCode = 'INTERNAL';
  let message: string | undefined;
  let details: Record<string, unknown> | undefined;

  if (exception instanceof ApiException) {
    code = exception.code;
    // Chi tiết của lỗi 500 chỉ vào log, không ra ngoài.
    if (code !== 'INTERNAL') {
      message = exception.message;
      details = exception.details;
    }
  } else if (exception instanceof HttpException) {
    code = CODE_BY_STATUS[exception.getStatus()] ?? (exception.getStatus() >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
  }

  return {
    status: ERROR_STATUS[code],
    body: {
      error: {
        code,
        message: message ?? MESSAGE[code] ?? code,
        ...(details ? { details } : {}),
        requestId,
      },
    },
  };
};
