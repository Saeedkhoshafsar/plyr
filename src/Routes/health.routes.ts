import { Router } from 'express';
import type IORedis from 'ioredis';
import type { ProfileManager } from '../core/ProfileManager';
import { GlobalBrowser } from '../core/GlobalBrowser';
import { config } from '../config';

interface HealthRoutesDeps {
  connection: IORedis;
  profileManager: ProfileManager;
  luaScriptsLoaded: () => boolean;
}

export const createHealthRoutes = (deps: HealthRoutesDeps): Router => {
  const router = Router();
  const { connection, profileManager, luaScriptsLoaded } = deps;

  router.get('/health', async (_req, res) => {
    let redisStatus = 'disconnected';
    try {
      await connection.ping();
      redisStatus = 'connected';
    } catch {}

    const globalBrowserStatus = GlobalBrowser.getHealthStatus();

    res.json({
      status: 'ok',
      version: config.VERSION,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      redis: redisStatus,
      luaScripts: luaScriptsLoaded() ? 'loaded' : 'fallback',
      browsers: {
        vip: profileManager.getVipBrowserCount(),
        free: profileManager.getFreeContextCount(),
        total: profileManager.getActiveBrowserCount(),
        registeredPages: profileManager.getRegisteredPageCount(),
        globalBrowser: globalBrowserStatus
      },
      features: {
        flattenerEnabled: config.FREE_FLATTENER_ENABLED,
        resourceBlocking: config.FREE_RESOURCE_BLOCKING,
        turboMode: config.TURBO_MODE,
        webhookRetries: config.WEBHOOK_MAX_RETRIES,
        freeForceSequential: config.FREE_FORCE_SEQUENTIAL,
        planOverrides: true,
        unifiedUserManagement: true
      }
    });
  });

  return router;
};