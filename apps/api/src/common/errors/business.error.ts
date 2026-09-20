import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@phone-erp/shared-types';

/**
 * A rule of the business was violated. Always carries a stable `code` so the
 * frontend can render a precise message without parsing English text.
 */
export class BusinessError extends HttpException {
  constructor(
    public readonly code: ErrorCode | string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details: Record<string, unknown> = {},
  ) {
    super({ statusCode: status, code, message, details }, status);
  }

  static notFound(entity: string, id?: string): BusinessError {
    return new BusinessError(
      ErrorCode.NOT_FOUND,
      `${entity} not found.`,
      HttpStatus.NOT_FOUND,
      id ? { id } : {},
    );
  }

  static forbiddenWarehouse(warehouseId?: string): BusinessError {
    return new BusinessError(
      ErrorCode.WAREHOUSE_FORBIDDEN,
      'You do not have access to this warehouse.',
      HttpStatus.FORBIDDEN,
      warehouseId ? { warehouseId } : {},
    );
  }

  static conflict(code: ErrorCode | string, message: string, details: Record<string, unknown> = {}) {
    return new BusinessError(code, message, HttpStatus.CONFLICT, details);
  }
}
