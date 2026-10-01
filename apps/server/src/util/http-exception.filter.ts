import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ServerError } from 'livekit-server-sdk';

/**
 * Gives every error response the same shape: { statusCode, error, message }.
 *  - HttpExceptions keep their status and message
 *  - LiveKit API errors are reported as LiveKit errors (404 stays 404)
 *  - LiveKit timeouts / connection failures become 502 "LiveKit unreachable"
 *  - anything else is a logged 500
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const { statusCode, message } = this.describe(exception);
    const route = `${req.method} ${req.url}`;

    if (statusCode >= 500) {
      this.logger.error(
        `${route} -> ${statusCode} ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${route} -> ${statusCode} ${message}`);
    }

    res.status(statusCode).json({
      statusCode,
      error: HttpStatus[statusCode] ?? 'Error',
      message,
    });
  }

  private describe(exception: unknown): {
    statusCode: number;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : (body as { message?: string | string[] }).message ??
            exception.message;
      return { statusCode: exception.getStatus(), message };
    }

    if (exception instanceof ServerError) {
      if (exception.status === 404 || exception.code === 'not_found') {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: `LiveKit: ${exception.message}`,
        };
      }
      return {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: `LiveKit error: ${exception.message}`,
      };
    }

    if (isConnectionError(exception)) {
      return {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: 'LiveKit server unreachable',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}

const isConnectionError = (err: unknown) => {
  if (!(err instanceof Error)) {
    return false;
  }
  // fetch() failures surface as TypeError("fetch failed"); timeouts as AbortError/TimeoutError
  return (
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    (err.name === 'TypeError' && err.message === 'fetch failed')
  );
};
