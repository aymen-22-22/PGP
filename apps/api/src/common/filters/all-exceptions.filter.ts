import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiError, ErrorCode } from '@phone-erp/shared-types';
import type { Request, Response } from 'express';

/**
 * Single exit point for every error. Guarantees the documented response shape
 * and keeps stack traces out of production responses.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const payload = this.toApiError(exception);

    if (payload.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${payload.statusCode} ${payload.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${payload.statusCode} ${payload.code}`);
    }

    response.status(payload.statusCode).json(payload);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null && 'code' in body) {
        return body as ApiError;
      }

      const raw = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      const rawMessage = raw.message;
      const isValidation = Array.isArray(rawMessage);

      return {
        statusCode: status,
        code: isValidation ? ErrorCode.VALIDATION_FAILED : this.codeForStatus(status),
        message: isValidation ? 'Some fields are invalid.' : ((rawMessage as string) ?? 'Request failed.'),
        details: isValidation ? { fields: rawMessage } : {},
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: this.isProduction
        ? 'An unexpected error occurred.'
        : exception instanceof Error
          ? exception.message
          : String(exception),
      details: {},
    };
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): ApiError {
    const target = (e.meta?.target as string[] | string | undefined) ?? [];
    const fields = Array.isArray(target) ? target : [target];

    switch (e.code) {
      case 'P2002': {
        const isImei = fields.some((f) => f.toLowerCase().includes('imei'));
        return {
          statusCode: HttpStatus.CONFLICT,
          code: isImei ? ErrorCode.IMEI_ALREADY_EXISTS : ErrorCode.DUPLICATE_CODE,
          message: isImei
            ? 'This IMEI already exists.'
            : `A record with the same ${fields.join(', ') || 'value'} already exists.`,
          details: { fields },
        };
      }
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_FAILED,
          message: 'A referenced record does not exist.',
          details: { fields },
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: ErrorCode.NOT_FOUND,
          message: 'The requested record does not exist.',
          details: {},
        };
      case 'P2034':
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.CONCURRENT_MODIFICATION,
          message: 'Another operation changed this data. Please try again.',
          details: {},
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ErrorCode.INTERNAL_ERROR,
          message: this.isProduction ? 'An unexpected database error occurred.' : e.message,
          details: {},
        };
    }
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
