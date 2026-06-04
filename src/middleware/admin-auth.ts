import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';

/**
 * Admin authentication middleware
 * Uses timing-safe comparison to prevent timing attacks
 */
export const requireAdminAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const token = String(req.headers['x-admin-token'] || req.query.token || '');

  if (!token || !config.ADMIN_SECRET) {
    res.status(403).json({ error: 'Access Denied' });
    return;
  }

  try {
    const tokenBuffer = Buffer.from(token);
    const secretBuffer = Buffer.from(config.ADMIN_SECRET);

    if (tokenBuffer.length !== secretBuffer.length) {
      res.status(403).json({ error: 'Access Denied' });
      return;
    }

    if (!timingSafeEqual(tokenBuffer, secretBuffer)) {
      res.status(403).json({ error: 'Access Denied' });
      return;
    }

    next();
  } catch {
    res.status(403).json({ error: 'Access Denied' });
  }
};