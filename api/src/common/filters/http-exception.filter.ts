import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        code = HttpStatus[status] ?? 'ERROR';
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        message = String(obj.message ?? exception.message);
        code = String(obj.error ?? obj.code ?? HttpStatus[status] ?? 'ERROR');
        if (Array.isArray(obj.message)) {
          message = 'Validation failed';
          details = { messages: obj.message };
          code = 'VALIDATION_ERROR';
        } else if (obj.details !== undefined) {
          details = obj.details;
        }
      }
    }

    response.status(status).json({
      code: typeof code === 'string' ? code.toUpperCase().replace(/\s+/g, '_') : 'ERROR',
      message,
      details,
      requestId,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
