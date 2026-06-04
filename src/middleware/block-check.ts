import { Request, Response, NextFunction } from 'express';
import type IORedis from 'ioredis';
import { UserManager } from '../core/UserManager';
import { sanitizeUserId } from '../validation';

/**
 * Factory function to create block check middleware
 */
export const createBlockCheckMiddleware = (connection: IORedis) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.params.userId || (req.body as Record<string, unknown>)?.userId;

      if (!userId) {
        next();
        return;
      }

      let sanitizedUserId: string;
      try {
        sanitizedUserId = sanitizeUserId(String(userId));
      } catch {
        next();
        return;
      }

      const isBlocked = await UserManager.isUserBlocked(connection, sanitizedUserId);

      if (isBlocked) {
        console.log(`[BLOCK] ⛔ Blocked user ${sanitizedUserId} denied access to ${req.method} ${req.path}`);
        res.status(403).json({
          success: false,
          error: 'Account is blocked by administrator',
          code: 'ACCOUNT_BLOCKED',
          hint: 'Contact support if you believe this is an error'
        });
        return;
      }

      next();
    } catch (e: unknown) {
      const error = e as Error;
      console.error('[BLOCK_CHECK] Error:', error.message);
      next();
    }
  };
};

/**
 * Wrapper to handle async middleware errors
 */
export const asyncBlockCheck = (connection: IORedis) => {
  const middleware = createBlockCheckMiddleware(connection);

  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(middleware(req, res, next)).catch(next);
  };
};