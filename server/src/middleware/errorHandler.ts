import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { ZodError } from 'zod';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.errors,
      },
    });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled server error');

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred.'
        : err.message || 'Internal server error',
    },
  });
}
