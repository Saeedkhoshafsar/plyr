import { Router } from 'express';
import type { Queue } from 'bullmq';
import type IORedis from 'ioredis';

import { config } from '../config';
import type { ProfileManager } from '../core/ProfileManager';
import type { QuotaManager } from '../core/QuotaManager';
import { UserManager, UserSettings, UserPlanOverrides } from '../core/UserManager';
import { GlobalBrowser } from '../core/GlobalBrowser';
import { sanitizeUserId } from '../validation';
import { requireAdminAuth } from '../middleware/admin-auth';
import { parseInteger, parseBoolean, isVipUser } from '../utils/helpers';
import { STATS_KEY, getUserActiveJobsKey, scanKeys } from '../utils/redis-keys';
import { getApiKeyManager, generateApiKey } from '../middleware/auth';

interface AdminRoutesDeps {
  queue: Queue;
  connection: IORedis;
  profileManager: ProfileManager;
  quotaManager: QuotaManager;
  luaScriptsLoaded: () => boolean;
  reloadLuaScripts: () => Promise<void>;
}

export const createAdminRoutes = (deps: AdminRoutesDeps): Router => {
  const router = Router();
  const { queue, connection, profileManager, quotaManager, luaScriptsLoaded, reloadLuaScripts } = deps;

  // Apply admin auth to all routes
  router.use(requireAdminAuth);

  // ══════════════════════════════════════════
  // GET /stats - System statistics
  // ══════════════════════════════════════════
  router.get('/stats', async (_req, res) => {
    try {
      const queueCounts = await queue.getJobCounts(
        'waiting', 'active', 'completed', 'failed', 'delayed'
      );

      const [totalJobs, totalFailed, totalSuccess, totalSteps] = await Promise.all([
        connection.get(STATS_KEY.TOTAL_JOBS),
        connection.get(STATS_KEY.TOTAL_FAILED),
        connection.get(STATS_KEY.TOTAL_SUCCESS),
        connection.get(STATS_KEY.TOTAL_STEPS),
      ]);

      const lockedUsers = await profileManager.getLockedUserCount(connection);

      const topModulesRaw = await connection.zrevrange(
        STATS_KEY.MODULE_USAGE_ZSET, 0, 19, 'WITHSCORES'
      );

      const topModules: Record<string, number> = {};
      for (let i = 0; i < topModulesRaw.length; i += 2) {
        topModules[topModulesRaw[i]] = parseInt(topModulesRaw[i + 1]);
      }

      const jobOutputStats = profileManager.getJobOutputStats();
      const memUsage = process.memoryUsage();
      const globalBrowserStatus = GlobalBrowser.getHealthStatus();

      // Count blocked users
      const [settingsKeys, planKeys] = await Promise.all([
        scanKeys(connection, 'user:settings:*'),
        scanKeys(connection, 'user:plan:*')
      ]);

      let blockedCount = 0;
      for (const key of settingsKeys) {
        const blocked = await connection.hget(key, 'blockAccess');
        if (blocked === 'true') blockedCount++;
      }

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        system: {
          version: config.VERSION,
          nodeVersion: process.version,
          uptime: Math.round(process.uptime()),
          luaScripts: luaScriptsLoaded() ? 'loaded' : 'fallback',
          browsers: {
            vipCount: profileManager.getVipBrowserCount(),
            freeCount: profileManager.getFreeContextCount(),
            totalActive: profileManager.getActiveBrowserCount(),
            registeredPages: profileManager.getRegisteredPageCount(),
            globalBrowser: globalBrowserStatus
          },
          lockedUsers,
          blockedUsers: blockedCount,
          usersWithOverrides: planKeys.length,
          pendingJobOutputs: jobOutputStats.count,
          oldestJobOutputAgeMs: jobOutputStats.oldestAgeMs,
          memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB'
          }
        },
        features: {
          flattenerEnabled: config.FREE_FLATTENER_ENABLED,
          resourceBlocking: config.FREE_RESOURCE_BLOCKING,
          turboMode: config.TURBO_MODE,
          vipThreshold: config.VIP_PRIORITY_THRESHOLD,
          webhookRetries: config.WEBHOOK_MAX_RETRIES,
          jobOutputMaxAgeMin: Math.round(config.JOB_OUTPUT_MAX_AGE_MS / 60000),
          freeForceSequential: config.FREE_FORCE_SEQUENTIAL,
          planOverrides: true,
          unifiedUserManagement: true
        },
        queue: queueCounts,
        history: {
          totalJobs: parseInt(totalJobs || '0'),
          totalSuccess: parseInt(totalSuccess || '0'),
          totalFailed: parseInt(totalFailed || '0'),
          totalSteps: parseInt(totalSteps || '0'),
          successRate: totalJobs
            ? ((parseInt(totalSuccess || '0') / parseInt(totalJobs)) * 100).toFixed(1) + '%'
            : '0%'
        },
        topModules
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // POST /set-user-level
  // ══════════════════════════════════════════
  router.post('/set-user-level', async (req, res) => {
    const { userId, level, days } = req.body;

    if (!userId || level === undefined) {
      return res.status(400).json({ error: 'userId and level are required' });
    }

    if (!config.USER_PLANS[String(level)]) {
      return res.status(400).json({
        error: 'Invalid level',
        validLevels: Object.keys(config.USER_PLANS)
      });
    }

    try {
      const parsedDays = parseInteger(days);
      await UserManager.setUserLevel(connection, userId, String(level), parsedDays);

      const plan = config.USER_PLANS[String(level)];
      const isVip = isVipUser(plan.priority, config.VIP_PRIORITY_THRESHOLD);

      res.json({
        success: true,
        message: parsedDays && parsedDays > 0
          ? `User ${userId} set to level ${level} for ${parsedDays} days`
          : `User ${userId} set to level ${level} (Lifetime)`,
        userType: isVip ? 'VIP' : 'Free',
        plan
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // GET /user/:userId - Full user details
  // ══════════════════════════════════════════
  router.get('/user/:userId', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);

      const [level, effectivePlan, userSettings] = await Promise.all([
        UserManager.getUserLevel(connection, userId),
        UserManager.getEffectivePlan(connection, userId),
        UserManager.getUserSettings(connection, userId)
      ]);

      const status = await UserManager.getSubscriptionStatus(connection, userId);
      const usage = await quotaManager.getUsage(userId);
      const activeJobs = await connection.smembers(getUserActiveJobsKey(userId));
      const isLocked = await profileManager.isUserLocked(connection, userId);
      const hasVipBrowser = !!profileManager.getVipContext(userId);
      const isVip = isVipUser(effectivePlan.priority, config.VIP_PRIORITY_THRESHOLD);

      res.json({
        success: true,
        userId,
        level,
        userType: isVip ? 'VIP' : 'Free',
        subscription: {
          type: status.type,
          daysLeft: status.daysLeft
        },
        plan: {
          effective: {
            quota: effectivePlan.quota,
            maxTabs: effectivePlan.maxTabs,
            maxSteps: effectivePlan.maxSteps,
            priority: effectivePlan.priority
          },
          baseLevel: effectivePlan.baseLevel,
          hasOverrides: effectivePlan.isOverridden,
          overrides: effectivePlan.overrides
        },
        settings: userSettings,
        quota: {
          usedSeconds: usage.usedSeconds,
          limitSeconds: effectivePlan.quota * 60,
          usedMinutes: parseFloat((usage.usedSeconds / 60).toFixed(2)),
          limitMinutes: effectivePlan.quota,
          unlimited: effectivePlan.quota <= 0
        },
        activity: {
          activeJobs: activeJobs.length,
          jobIds: activeJobs,
          isLocked,
          hasVipBrowser,
          browserType: hasVipBrowser ? 'Persistent (VIP)' : (isVip ? 'Not Active' : 'Ephemeral (Free)')
        }
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // GET /user/:userId/settings
  // ══════════════════════════════════════════
  router.get('/user/:userId/settings', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);
      const settings = await UserManager.getUserSettings(connection, userId);
      const overrides = await UserManager.getPlanOverrides(connection, userId);

      res.json({
        success: true,
        userId,
        settings,
        planOverrides: overrides
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // POST /user/:userId/settings
  // ══════════════════════════════════════════
  router.post('/user/:userId/settings', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);
      const { forceSequential, blockAccess, note } = req.body;

      await UserManager.updateUserSettings(connection, userId, {
        forceSequential: parseBoolean(forceSequential),
        blockAccess: parseBoolean(blockAccess),
        note: note !== undefined ? String(note) : undefined
      });

      const updatedSettings = await UserManager.getUserSettings(connection, userId);

      if (parseBoolean(blockAccess) === true) {
        console.log(`[ADMIN] ⛔ User ${userId} blocked. Note: ${note || 'N/A'}`);
      } else if (parseBoolean(blockAccess) === false) {
        console.log(`[ADMIN] ✅ User ${userId} unblocked`);
      }

      res.json({
        success: true,
        message: `Settings updated for ${userId}`,
        settings: updatedSettings
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // POST /user/:userId/plan - Set plan overrides
  // ══════════════════════════════════════════
  router.post('/user/:userId/plan', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);
      const { quota, maxTabs, maxSteps, priority, clear } = req.body;

      if (parseBoolean(clear)) {
        await UserManager.clearPlanOverrides(connection, userId);
        const effective = await UserManager.getEffectivePlan(connection, userId);

        return res.json({
          success: true,
          message: `All plan overrides cleared for ${userId}`,
          effectivePlan: effective
        });
      }

      const overrides: Partial<Record<keyof UserPlanOverrides, number | null>> = {};

      if (quota !== undefined) {
        overrides.quota = quota === null ? null : parseInteger(quota);
      }
      if (maxTabs !== undefined) {
        overrides.maxTabs = maxTabs === null ? null : parseInteger(maxTabs);
      }
      if (maxSteps !== undefined) {
        overrides.maxSteps = maxSteps === null ? null : parseInteger(maxSteps);
      }
      if (priority !== undefined) {
        overrides.priority = priority === null ? null : parseInteger(priority);
      }

      if (Object.keys(overrides).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid overrides provided',
          hint: 'Provide at least one of: quota, maxTabs, maxSteps, priority (or clear=true)'
        });
      }

      await UserManager.setPlanOverrides(connection, userId, overrides);
      const effective = await UserManager.getEffectivePlan(connection, userId);

      console.log(`[ADMIN] 📋 Plan overrides set for ${userId}:`, overrides);

      res.json({
        success: true,
        message: `Plan overrides updated for ${userId}`,
        appliedOverrides: overrides,
        effectivePlan: {
          quota: effective.quota,
          maxTabs: effective.maxTabs,
          maxSteps: effective.maxSteps,
          priority: effective.priority
        },
        isOverridden: effective.isOverridden,
        baseLevel: effective.baseLevel
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // POST /user/:userId/extend - Extend subscription
  // ══════════════════════════════════════════
  router.post('/user/:userId/extend', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);
      const days = parseInteger(req.body.days);

      if (days === undefined || days === 0) {
        return res.status(400).json({
          success: false,
          error: 'days must be a non-zero number',
          received: req.body.days
        });
      }

      const beforeStatus = await UserManager.getSubscriptionStatus(connection, userId);
      const success = await UserManager.extendSubscription(connection, userId, days);

      if (!success) {
        return res.status(400).json({
          success: false,
          error: 'Cannot extend lifetime or free tier. Use set-user-level first.',
          currentType: beforeStatus.type
        });
      }

      const afterStatus = await UserManager.getSubscriptionStatus(connection, userId);

      res.json({
        success: true,
        message: days > 0
          ? `Extended ${userId} by ${days} days`
          : `Reduced ${userId} by ${Math.abs(days)} days`,
        before: { type: beforeStatus.type, daysLeft: beforeStatus.daysLeft },
        after: { type: afterStatus.type, daysLeft: afterStatus.daysLeft }
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // BULK OPERATIONS
  // ══════════════════════════════════════════

  // POST /users/settings - Bulk update settings
  router.post('/users/settings', async (req, res) => {
    try {
      const { userIds, forceSequential, blockAccess, note } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'userIds array is required and must not be empty'
        });
      }

      const sanitizedIds = userIds.map((id: unknown) => sanitizeUserId(String(id)));

      const settings: Partial<UserSettings> = {};
      if (forceSequential !== undefined) settings.forceSequential = parseBoolean(forceSequential);
      if (blockAccess !== undefined) settings.blockAccess = parseBoolean(blockAccess);
      if (note !== undefined) settings.note = String(note);

      if (Object.keys(settings).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No settings provided to update'
        });
      }

      const result = await UserManager.bulkUpdateSettings(connection, sanitizedIds, settings);

      if (settings.blockAccess === true) {
        console.log(`[ADMIN] ⛔ Bulk blocked ${result.successful.length} users`);
      } else if (settings.blockAccess === false) {
        console.log(`[ADMIN] ✅ Bulk unblocked ${result.successful.length} users`);
      }

      res.json({
        success: true,
        message: `Settings updated for ${result.successful.length} users`,
        appliedSettings: settings,
        details: {
          total: sanitizedIds.length,
          successful: result.successful.length,
          failed: result.failed.length
        },
        successful: result.successful,
        failed: result.failed.length > 0 ? result.failed : undefined
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /users/plan - Bulk set plan overrides
  router.post('/users/plan', async (req, res) => {
    try {
      const { userIds, quota, maxTabs, maxSteps, priority, clear } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'userIds array is required and must not be empty'
        });
      }

      const sanitizedIds = userIds.map((id: unknown) => sanitizeUserId(String(id)));

      if (parseBoolean(clear)) {
        let successCount = 0;
        for (const userId of sanitizedIds) {
          try {
            await UserManager.clearPlanOverrides(connection, userId);
            successCount++;
          } catch {}
        }

        return res.json({
          success: true,
          message: `Plan overrides cleared for ${successCount} users`,
          details: { total: sanitizedIds.length, cleared: successCount }
        });
      }

      const overrides: Partial<Record<keyof UserPlanOverrides, number | null>> = {};
      if (quota !== undefined) overrides.quota = quota === null ? null : parseInteger(quota);
      if (maxTabs !== undefined) overrides.maxTabs = maxTabs === null ? null : parseInteger(maxTabs);
      if (maxSteps !== undefined) overrides.maxSteps = maxSteps === null ? null : parseInteger(maxSteps);
      if (priority !== undefined) overrides.priority = priority === null ? null : parseInteger(priority);

      if (Object.keys(overrides).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid overrides provided'
        });
      }

      const result = await UserManager.bulkSetPlanOverrides(connection, sanitizedIds, overrides);

      console.log(`[ADMIN] 📋 Bulk plan overrides for ${result.successful.length} users:`, overrides);

      res.json({
        success: true,
        message: `Plan overrides set for ${result.successful.length} users`,
        appliedOverrides: overrides,
        details: {
          total: sanitizedIds.length,
          successful: result.successful.length,
          failed: result.failed.length
        },
        successful: result.successful,
        failed: result.failed.length > 0 ? result.failed : undefined
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /users/extend - Bulk extend subscriptions
  router.post('/users/extend', async (req, res) => {
    try {
      const { userIds, days, filter, limit, withinDays } = req.body;

      const parsedDays = parseInteger(days);
      if (parsedDays === undefined || parsedDays === 0) {
        return res.status(400).json({
          success: false,
          error: 'days must be a non-zero number',
          received: days
        });
      }

      let targetUsers: string[] = [];

      if (Array.isArray(userIds) && userIds.length > 0) {
        targetUsers = userIds.map((id: unknown) => sanitizeUserId(String(id)));
      }
      else if (filter === 'expiring') {
        const maxDays = parseInteger(withinDays) || 7;
        const maxUsers = parseInteger(limit) || 100;

        const allKeys = await scanKeys(connection, 'user:level:*');
        const expiringUsers: { userId: string; ttl: number }[] = [];

        for (const key of allKeys) {
          const ttl = await connection.ttl(key);
          if (ttl > 0) {
            const daysLeft = Math.ceil(ttl / 86400);
            if (daysLeft <= maxDays) {
              const userId = key.split(':')[2];
              expiringUsers.push({ userId, ttl });
            }
          }
        }

        expiringUsers.sort((a, b) => a.ttl - b.ttl);
        targetUsers = expiringUsers.slice(0, maxUsers).map(u => u.userId);
      }
      else {
        return res.status(400).json({
          success: false,
          error: 'Either userIds array or filter="expiring" is required'
        });
      }

      if (targetUsers.length === 0) {
        return res.json({
          success: true,
          message: 'No users matched the criteria',
          details: { processed: 0, successful: 0, failed: 0, skipped: 0 }
        });
      }

      const result = await UserManager.bulkExtendSubscription(connection, targetUsers, parsedDays);

      res.json({
        success: true,
        message: `Extended ${result.successful.length} users by ${parsedDays} days`,
        details: {
          daysAdded: parsedDays,
          total: targetUsers.length,
          successful: result.successful.length,
          failed: result.failed.length,
          skipped: result.skipped.length
        },
        successful: result.successful.slice(0, 50),
        failed: result.failed.length > 0 ? result.failed : undefined,
        skipped: result.skipped.length > 0 ? result.skipped.slice(0, 20) : undefined
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // LIST OPERATIONS
  // ══════════════════════════════════════════

  // GET /users/blocked
  router.get('/users/blocked', async (_req, res) => {
    try {
      const users = await UserManager.getUsersWithSettings(connection, { blocked: true });

      res.json({
        success: true,
        count: users.length,
        users: users.map(u => ({
          userId: u.userId,
          note: u.settings.note
        }))
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /users/expiring
  router.get('/users/expiring', async (req, res) => {
    try {
      const withinDays = parseInteger(req.query.days) || 7;
      const allKeys = await scanKeys(connection, 'user:level:*');
      const expiringUsers: { userId: string; level: string; daysLeft: number }[] = [];

      for (const key of allKeys) {
        const ttl = await connection.ttl(key);
        if (ttl > 0) {
          const daysLeft = Math.ceil(ttl / 86400);
          if (daysLeft <= withinDays) {
            const userId = key.split(':')[2];
            const level = await connection.get(key) || '0';
            expiringUsers.push({ userId, level, daysLeft });
          }
        }
      }

      expiringUsers.sort((a, b) => a.daysLeft - b.daysLeft);

      res.json({
        success: true,
        withinDays,
        count: expiringUsers.length,
        users: expiringUsers
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /users/overrides
  router.get('/users/overrides', async (_req, res) => {
    try {
      const users = await UserManager.getUsersWithOverrides(connection);

      res.json({
        success: true,
        count: users.length,
        users
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /users/sequential
  router.get('/users/sequential', async (_req, res) => {
    try {
      const users = await UserManager.getUsersWithSettings(connection, { sequential: true });

      res.json({
        success: true,
        count: users.length,
        users: users.map(u => ({
          userId: u.userId,
          note: u.settings.note
        }))
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // API KEY MANAGEMENT
  // ══════════════════════════════════════════

  // POST /api-keys/generate
  router.post('/api-keys/generate', async (req, res) => {
    const { userId, note, type = 'live', expiresInDays } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    try {
      const manager = getApiKeyManager();
      if (!manager) {
        return res.status(500).json({ error: 'API Key Manager not initialized' });
      }

      const newKey = generateApiKey(type === 'test' ? 'test' : 'live');
      await manager.addKey(newKey, userId, note, parseInteger(expiresInDays));

      res.json({
        success: true,
        apiKey: newKey,
        userId,
        note: note || null,
        type,
        expiresInDays: expiresInDays || null,
        warning: '⚠️ This key is shown only once! Store it securely.'
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api-keys
  router.get('/api-keys', async (_req, res) => {
    try {
      const manager = getApiKeyManager();
      if (!manager) {
        return res.status(500).json({ error: 'API Key Manager not initialized' });
      }

      const keys = await manager.listKeys();
      const envKeys = Array.from(config.API_KEYS).map(k => ({
        prefix: k.substring(0, 15) + '...',
        source: 'env',
        meta: { note: 'Defined in .env file', permanent: true }
      }));

      res.json({
        success: true,
        summary: {
          total: keys.length + envKeys.length,
          fromEnv: envKeys.length,
          fromRedis: keys.length
        },
        keys: [
          ...envKeys,
          ...keys.map(k => ({ ...k, source: 'redis' }))
        ]
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // DELETE /api-keys/:key
  router.delete('/api-keys/:key', async (req, res) => {
    const apiKey = req.params.key;

    try {
      if (config.API_KEYS.has(apiKey)) {
        return res.status(400).json({
          success: false,
          error: 'Cannot revoke keys defined in .env file. Remove from .env and restart.'
        });
      }

      const manager = getApiKeyManager();
      if (!manager) {
        return res.status(500).json({ error: 'API Key Manager not initialized' });
      }

      const revoked = await manager.revokeKey(apiKey);

      res.json({
        success: revoked,
        message: revoked ? 'API key revoked successfully' : 'API key not found'
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // SYSTEM MANAGEMENT
  // ══════════════════════════════════════════

  // POST /reset-quota/:userId
  router.post('/reset-quota/:userId', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);

      await quotaManager.resetQuota(userId);

      res.json({
        success: true,
        message: `Quota reset for user ${userId}`
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /cleanup
  router.post('/cleanup', async (_req, res) => {
    try {
      const beforeVip = profileManager.getVipBrowserCount();
      const beforeFree = profileManager.getFreeContextCount();

      await profileManager.runGarbageCollector(0);

      const afterVip = profileManager.getVipBrowserCount();
      const afterFree = profileManager.getFreeContextCount();

      res.json({
        success: true,
        message: 'Cleanup completed',
        closed: {
          vip: beforeVip - afterVip,
          free: beforeFree - afterFree,
          total: (beforeVip + beforeFree) - (afterVip + afterFree)
        },
        active: {
          vip: afterVip,
          free: afterFree,
          total: afterVip + afterFree
        }
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /reload-lua
  router.post('/reload-lua', async (_req, res) => {
    try {
      await reloadLuaScripts();

      res.json({
        success: true,
        message: 'Lua scripts reloaded',
        status: luaScriptsLoaded() ? 'loaded' : 'failed'
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /restart-global-browser
  router.post('/restart-global-browser', async (_req, res) => {
    try {
      const success = await GlobalBrowser.forceRestart();

      res.json({
        success,
        message: success ? 'GlobalBrowser restarted successfully' : 'Failed to restart GlobalBrowser',
        status: GlobalBrowser.getHealthStatus()
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /system/restart
  router.post('/system/restart', async (req, res) => {
    try {
      console.warn(`[ADMIN] ⚠️ Remote restart requested by ${req.ip}`);

      res.json({
        success: true,
        message: 'Server is restarting...',
        timestamp: new Date().toISOString()
      });

      setTimeout(() => {
        console.log('[ADMIN] 👋 Goodbye! Exiting process for restart...');
        process.exit(0);
      }, 1000);

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};