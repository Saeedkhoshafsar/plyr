import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { config } from './config';

const isGodMode = (req: Request): boolean => {
  const ip = req.ip || req.socket.remoteAddress || '';
  return config.GOD_MODE_IPS.some(godIp =>
    ip === godIp ||
    ip === `::ffff:${godIp}` ||
    ip.endsWith(godIp)
  );
};

export const smartLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.RATE_LIMIT_PER_MINUTE,
  message: {
    success: false,
    error: 'Too many requests, please slow down.',
    retryAfter: 60
  },
  skip: (req) => !config.RATE_LIMIT_ENABLED || isGodMode(req),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
});

export const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.ADMIN_RATE_LIMIT_PER_MINUTE,
  message: {
    success: false,
    error: 'Too many admin requests.',
    retryAfter: 60
  },
  skip: (req) => isGodMode(req),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
});