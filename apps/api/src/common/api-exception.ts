import { ERROR_STATUS, type ErrorCode } from '@mambo/contracts';
import { HttpException } from '@nestjs/common';

/**
 * Lỗi có mã của hợp đồng. Mọi lỗi nghiệp vụ trong API ném cái này — status HTTP
 * suy ra từ `ERROR_STATUS`, không ai tự chọn số.
 */
export class ApiException extends HttpException {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message, ERROR_STATUS[code]);
    this.code = code;
    this.details = details;
  }
}
