'use strict';

import express from 'express';
import helmet from 'helmet';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import fsExtra from 'fs-extra';
import path from 'path';
import fs from 'fs/promises';
import { glob } from 'glob';

import { config } from './config';
import { runPipeline } from './pipeline';
import { ProfileManager } from './core/ProfileManager';
import { UserManager } from './core/UserManager';
import { QuotaManager } from './core/QuotaManager';
import { GlobalBrowser } from './core/GlobalBrowser';
import { smartLimiter, adminLimiter } from './rate-limit';
import { sanitizeLogMessage } from './validation';
import {
  requireApiKey,
  initApiKeyManager,
  getApiKeyManager,
  AuthenticatedRequest
} from './middleware/auth';
import { asyncBlockCheck } from './middleware/block-check';

// Utils & Services
import { isVipUser } from './utils/helpers';
import { STATS_KEY, getUserActiveJobsKey } from './utils/redis-keys';
import { sendWebhook } from './services/webhook.service';
import { persistJob } from './services/job.service';

// Routes
import { createAllRoutes } from './routes';

// ============================================
// EXPRESS SETUP
// ============================================

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: config.MAX_REQUEST_BODY_SIZE }));

// ============================================
// REDIS & QUEUE
// ============================================

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  retryStrategy: (times) => {
    if (times > 10) {
      console.error('[REDIS] Max retries reached, giving up');
      return null;
    }
    return Math.min(times * 200, 5000);
  }
});

connection.on('connect', () => console.log('[REDIS] Connected'));
connection.on('error', (err) => console.error('[REDIS] Error:', err.message));

const queue = new Queue('automation-jobs', { connection });
const profileManager = new ProfileManager();
const quotaManager = new QuotaManager(connection);
const apiKeyManager = initApiKeyManager(connection);

// ============================================
// LUA SCRIPTS
// ============================================

let checkOlderJobsScriptSha: string | null = null;

const LUA_CHECK_OLDER_JOBS = `
local key = KEYS[1]
local currentId = tonumber(ARGV[1])
if not currentId then return 0 end
local members = redis.call('SMEMBERS', key)
for i, id in ipairs(members) do
  local idNum = tonumber(id)
  if idNum and idNum < currentId then return 1 end
end
return 0
`;

const initLuaScripts = async (): Promise<void> => {
  try {
    checkOlderJobsScriptSha = await connection.script('LOAD', LUA_CHECK_OLDER_JOBS) as string;
    console.log('[REDIS] ✓ Lua scripts loaded');
  } catch (e) {
    console.warn('[REDIS] ⚠️ Failed to load Lua scripts, using fallback');
    checkOlderJobsScriptSha = null;
  }
};

const luaScriptsLoaded = (): boolean => checkOlderJobsScriptSha !== null;

const hasOlderJobs = async (userId: string, currentJobId: string): Promise<boolean> => {
  const key = getUserActiveJobsKey(userId);
  const currentIdNum = parseInt(currentJobId);

  if (isNaN(currentIdNum)) return false;

  if (checkOlderJobsScriptSha) {
    try {
      const result = await connection.evalsha(checkOlderJobsScriptSha, 1, key, currentJobId);
      return result === 1;
    } catch (e: unknown) {
      const error = e as Error;
      if (error.message?.includes('NOSCRIPT')) {
        await initLuaScripts();
      }
    }
  }

  // Fallback
  const activeIds = await connection.smembers(key);
  return activeIds.some(id => {
    const idNum = parseInt(id);
    return !isNaN(idNum) && idNum < currentIdNum;
  });
};

// ============================================
// CLEANUP
// ============================================

const cleanupSystem = async (): Promise<void> => {
  console.log('[SYSTEM] Cleaning up stale locks...');
  try {
    const locks = await glob(path.join(config.PROFILES_DIR, '**/SingletonLock'));
    for (const lock of locks) {
      await fs.unlink(lock).catch(() => {});
    }
    if (locks.length > 0) {
      console.log(`[SYSTEM] Cleaned ${locks.length} stale lock(s)`);
    }
  } catch (e) {
    console.error('[SYSTEM] Cleanup error:', e);
  }
};

// ============================================
// MIDDLEWARES
// ============================================

const asyncAuthMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  requireApiKey(req as AuthenticatedRequest, res, next).catch(next);
};

// Rate limiting
app.use('/run', smartLimiter);
app.use('/cancel', smartLimiter);
app.use('/admin', adminLimiter);

// API Key authentication
app.use('/run', asyncAuthMiddleware);
app.use('/cancel', asyncAuthMiddleware);
app.use('/job', asyncAuthMiddleware);
app.use('/jobs', asyncAuthMiddleware);
app.use('/quota', asyncAuthMiddleware);

// Block check
const blockCheck = asyncBlockCheck(connection);
app.use('/run', blockCheck);
app.use('/cancel', blockCheck);
app.use('/job', blockCheck);
app.use('/jobs', blockCheck);
app.use('/quota', blockCheck);

// ============================================
// INITIALIZATION
// ============================================

fsExtra.ensureDirSync(config.PROFILES_DIR);
fsExtra.ensureDirSync(config.LOGS_DIR);

// ============================================
// ROUTES
// ============================================

const routes = createAllRoutes({
  queue,
  connection,
  profileManager,
  quotaManager,
  luaScriptsLoaded,
  reloadLuaScripts: initLuaScripts
});

app.use('/', routes.health);
app.use('/', routes.user);
app.use('/admin', routes.admin);

// ============================================
// WORKER
// ============================================

const worker = new Worker('automation-jobs', async (job: Job) => {
  const userId = String(job.data.userId);
  const webhookUrl = job.data.webhookUrl;

  // Immediate cancel check
  if (job.data.__cancelledByUser || profileManager.isCancelledLocally(job.id!)) {
    console.log(`[JOB:${job.id}] ⚡ Already cancelled - skipping`);
    await connection.srem(getUserActiveJobsKey(userId), job.id!).catch(() => {});
    return;
  }

  const userPlan = await UserManager.getUserPlan(connection, userId);
  const userSettings = await UserManager.getUserSettings(connection, userId);
  const isVip = isVipUser(userPlan.priority, config.VIP_PRIORITY_THRESHOLD);

  // Block check
  if (userSettings.blockAccess) {
    console.log(`[JOB:${job.id}] ⛔ User ${userId} blocked - job rejected`);
    await connection.srem(getUserActiveJobsKey(userId), job.id!);
    await persistJob(userId, job.id!, [], {
      success: false,
      message: 'Account blocked by administrator',
      blocked: true
    });

    if (webhookUrl) {
      sendWebhook(webhookUrl, {
        event: 'job.blocked',
        jobId: job.id!,
        userId,
        success: false,
        message: 'Account blocked by administrator',
        timestamp: new Date().toISOString()
      });
    }
    return;
  }

  await connection.sadd(getUserActiveJobsKey(userId), job.id!);
  await connection.expire(getUserActiveJobsKey(userId), 90 * 60);

  const shouldLock = isVip || config.FREE_FORCE_SEQUENTIAL || userSettings.forceSequential;

  if (shouldLock) {
    if (!(await profileManager.tryLockUser(connection, userId))) {
      await job.moveToDelayed(Date.now() + config.QUEUE_DELAY_MS);
      return;
    }

    if (await hasOlderJobs(userId, job.id!)) {
      console.log(`[ORDER] Waiting for older jobs -> User ${userId}`);
      await profileManager.unlockUser(connection, userId);
      await job.moveToDelayed(Date.now() + 1000);
      return;
    }
  }

  profileManager.initJobOutputs(job.id!);

  const log = (msg: string) => {
    console.log(`[JOB:${job.id}] ${sanitizeLogMessage(msg)}`);
  };

  try {
    log(`Started (${isVip ? 'VIP' : 'Free'}) [Lock: ${shouldLock}]`);

    connection.incr(STATS_KEY.TOTAL_JOBS).catch(() => {});

    const steps = job.data.steps;
    if (Array.isArray(steps)) {
      connection.incrby(STATS_KEY.TOTAL_STEPS, steps.length).catch(() => {});

      const pipeline = connection.pipeline();
      steps.forEach((s: { action?: string }) => {
        if (s.action) {
          pipeline.zincrby(STATS_KEY.MODULE_USAGE_ZSET, 1, s.action);
        }
      });
      pipeline.exec().catch(() => {});
    }

    const result = await runPipeline({
      userId,
      steps: job.data.steps,
      headless: job.data.headless ?? config.DEFAULT_HEADLESS,
      log,
      jobId: job.id!,
      job,
      profileManager,
      isCancelled: async () => {
        if (profileManager.isCancelledLocally(job.id!)) return true;
        try {
          const f = await queue.getJob(job.id!);
          return !!f?.data?.__cancelledByUser;
        } catch {
          return false;
        }
      },
      redis: connection,
      userPlan,
      quotaManager
    });

    log('Completed');
    connection.incr(STATS_KEY.TOTAL_SUCCESS).catch(() => {});

    const outputs = profileManager.getJobOutputs(job.id!);
    await persistJob(userId, job.id!, outputs, { ...result, success: true });

    if (webhookUrl) {
      sendWebhook(webhookUrl, {
        event: 'job.completed',
        jobId: job.id!,
        userId,
        success: true,
        durationMs: result.durationMs,
        stepsCount: outputs.length,
        timestamp: new Date().toISOString()
      });
    }

  } catch (err: unknown) {
    const error = err as Error;
    connection.incr(STATS_KEY.TOTAL_FAILED).catch(() => {});

    const outputs = profileManager.getJobOutputs(job.id!);

    let cancelled = profileManager.isCancelledLocally(job.id!);
    if (!cancelled) {
      try {
        const f = await queue.getJob(job.id!);
        cancelled = !!f?.data?.__cancelledByUser;
      } catch {}
    }

    if (cancelled || error.message === 'CANCELLED_BY_USER' || error.message === 'QUOTA_EXHAUSTED') {
      log(error.message === 'QUOTA_EXHAUSTED' ? 'Quota Exhausted' : 'Cancelled');

      await persistJob(userId, job.id!, outputs, {
        success: false,
        message: error.message,
        cancelledByUser: cancelled,
        userCancelled: cancelled
      });

      if (webhookUrl) {
        sendWebhook(webhookUrl, {
          event: cancelled ? 'job.cancelled' : 'job.quota_exhausted',
          jobId: job.id!,
          userId,
          success: false,
          message: error.message,
          stepsCompleted: outputs.length,
          timestamp: new Date().toISOString()
        });
      }
      return;
    }

    // Browser crash handling
    if (error.message.includes('Session closed') || error.message.includes('Protocol error')) {
      log('Browser crashed - cleaning up');

      if (isVip) {
        const entry = profileManager.getVipContext(userId);
        if (entry) {
          await entry.context.close().catch(() => {});
        }
        profileManager.removeVipContext(userId);
      } else {
        const entry = profileManager.getFreeContext(job.id!);
        if (entry) {
          await entry.context.close().catch(() => {});
        }
        profileManager.removeFreeContext(job.id!);
      }
    }

    log(`Failed: ${sanitizeLogMessage(error.message)}`);

    await persistJob(userId, job.id!, outputs, {
      success: false,
      message: error.message
    });

    if (webhookUrl) {
      sendWebhook(webhookUrl, {
        event: 'job.failed',
        jobId: job.id!,
        userId,
        success: false,
        error: error.message,
        stepsCompleted: outputs.length,
        timestamp: new Date().toISOString()
      });
    }

    throw err;

  } finally {
    if (shouldLock) {
      await profileManager.unlockUser(connection, userId);
      if (isVip) {
        profileManager.updateActivity(userId);
      }
    }

    profileManager.clearJobOutputs(job.id!);
    profileManager.clearCancelFlag(job.id!);
    profileManager.unregisterPage(job.id!);
    await connection.srem(getUserActiveJobsKey(userId), job.id!).catch(() => {});
  }
}, {
  connection,
  concurrency: config.MAX_CONCURRENT,
  lockDuration: 300000,
  lockRenewTime: 60000,
  maxStalledCount: 0,
});

worker.on('failed', (job, err) => {
  if (job) {
    console.error(`[WORKER] Job ${job.id} failed:`, err.message);
  }
});

worker.on('error', (err) => {
  console.error('[WORKER] Error:', err.message);
});

// ============================================
// ERROR HANDLERS
// ============================================

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    success: false,
    error: config.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
  });
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// ============================================
// GARBAGE COLLECTOR
// ============================================

setInterval(async () => {
  try {
    await profileManager.runGarbageCollector(config.GC_STALE_THRESHOLD_MINUTES);
  } catch (e) {
    console.error('[GC] Error:', e);
  }
}, config.GC_CHECK_INTERVAL_MINUTES * 60 * 1000);

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

let isShuttingDown = false;

const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[SHUTDOWN] ${signal} received, starting graceful shutdown...`);

  try {
    console.log('[SHUTDOWN] Closing worker...');
    await worker.close();

    console.log('[SHUTDOWN] Closing queue...');
    await queue.close();

    console.log('[SHUTDOWN] Closing API Key Manager...');
    const manager = getApiKeyManager();
    if (manager) {
      await manager.shutdown();
    }

    console.log('[SHUTDOWN] Closing Global Browser...');
    await GlobalBrowser.shutdown();

    console.log('[SHUTDOWN] Closing Redis connection...');
    await connection.quit();

    console.log('[SHUTDOWN] Closing all browsers...');
    await profileManager.shutdownAll();

    console.log('[SHUTDOWN] Graceful shutdown completed');
    process.exit(0);

  } catch (e) {
    console.error('[SHUTDOWN] Error during shutdown:', e);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// ============================================
// START SERVER
// ============================================

const startServer = async () => {
  await cleanupSystem();
  await apiKeyManager.initialize();
  await quotaManager.initialize();
  await GlobalBrowser.initialize();
  await initLuaScripts();

  const server = app.listen(config.PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log(`║     🚀 AUTOMATION BACKEND v${config.VERSION} - MODULAR EDITION             ║`);
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log(`║  Port:              ${String(config.PORT).padEnd(47)}║`);
    console.log(`║  Environment:       ${config.NODE_ENV.padEnd(47)}║`);
    console.log(`║  Concurrency:       ${String(config.MAX_CONCURRENT).padEnd(47)}║`);
    console.log(`║  API Auth:          ${(config.API_KEYS_ENABLED ? '✓ Enabled' : '✗ Disabled').padEnd(47)}║`);
    console.log(`║  Turbo Mode:        ${(config.TURBO_MODE ? '✓ Enabled' : '✗ Disabled').padEnd(47)}║`);
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log('║  📁 Modular Structure:                                          ║');
    console.log('║    routes/         - API endpoints                              ║');
    console.log('║    services/       - Business logic                             ║');
    console.log('║    middleware/     - Auth & validation                          ║');
    console.log('║    utils/          - Helpers                                    ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');
  });

  server.on('error', (err) => {
    console.error('[SERVER] Error:', err);
    process.exit(1);
  });

  return server;
};

const server = startServer();

export { app, server, queue, connection, profileManager, quotaManager };