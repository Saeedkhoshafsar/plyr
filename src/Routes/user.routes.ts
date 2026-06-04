import { Router } from 'express';
import type { Queue } from 'bullmq';
import type IORedis from 'ioredis';

import { config } from '../config';
import type { ProfileManager } from '../core/ProfileManager';
import { UserManager } from '../core/UserManager';
import type { QuotaManager } from '../core/QuotaManager';
import {
  sanitizeUserId,
  validateSteps,
  validateWebhookUrl,
  validateHeadless
} from '../validation';
import { isVipUser } from '../utils/helpers';
import { getUserActiveJobsKey } from '../utils/redis-keys';
import { readJobFile, readPartialJobFile } from '../services/job.service';
import type { AuthenticatedRequest } from '../middleware/auth';

interface UserRoutesDeps {
  queue: Queue;
  connection: IORedis;
  profileManager: ProfileManager;
  quotaManager: QuotaManager;
}

const SCHEDULE_PREFIX = 'sched';

export const createUserRoutes = (deps: UserRoutesDeps): Router => {
  const router = Router();
  const { queue, connection, profileManager, quotaManager } = deps;

  // ══════════════════════════════════════════
  // POST /run - Submit new job (Instant)
  // ══════════════════════════════════════════
  router.post('/run', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = sanitizeUserId(req.body.userId);
      const headless = validateHeadless(req.body.headless, config.DEFAULT_HEADLESS);

      const plan = await UserManager.getUserPlan(connection, userId);
      const steps = validateSteps(req.body.steps, plan);
      const webhookUrl = validateWebhookUrl(req.body.webhookUrl);

      // Check quota
      const hasQuota = await quotaManager.hasQuotaRemaining(userId, plan.quota);
      if (!hasQuota) {
        const usage = await quotaManager.getUsage(userId);
        return res.status(429).json({
          success: false,
          error: 'Daily quota exhausted',
          quotaMinutes: plan.quota,
          usedMinutes: Math.round(usage.usedSeconds / 60)
        });
      }

      // Check queue limit
      const currentActiveCount = await connection.scard(getUserActiveJobsKey(userId));

      if (currentActiveCount >= config.MAX_QUEUED_JOBS_PER_USER) {
        const waiting = await queue.getJobs(['waiting', 'delayed', 'active']);
        const realCount = waiting.filter(j => String(j.data.userId) === userId).length;

        if (realCount >= config.MAX_QUEUED_JOBS_PER_USER) {
          return res.status(429).json({
            success: false,
            error: `Queue limit reached. You have ${realCount}/${config.MAX_QUEUED_JOBS_PER_USER} active jobs.`
          });
        }
      }

      const thisJobNumber = currentActiveCount + 1;

      // Add job to queue
      const job = await queue.add(
        'run',
        { userId, steps, headless, webhookUrl },
        { priority: plan.priority }
      );

      await connection.sadd(getUserActiveJobsKey(userId), job.id!);
      await connection.expire(getUserActiveJobsKey(userId), 90 * 60);

      const isVip = isVipUser(plan.priority, config.VIP_PRIORITY_THRESHOLD);

      res.json({
        success: true,
        jobId: job.id,
        message: 'Job queued successfully',
        yourJobNumber: thisJobNumber,
        queueLimit: config.MAX_QUEUED_JOBS_PER_USER,
        priority: plan.priority,
        userType: isVip ? 'VIP' : 'Free',
        webhookEnabled: !!webhookUrl
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // POST /schedule - Submit recurring job
  // ══════════════════════════════════════════
  router.post('/schedule', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = sanitizeUserId(req.body.userId);
      const cron = String(req.body.cron || '').trim();
      const scheduleName = req.body.name 
        ? String(req.body.name).substring(0, 50).replace(/[^a-zA-Z0-9_-]/g, '_')
        : `job_${Date.now()}`;

      // ── Validate Cron ──
      if (!cron) {
        return res.status(400).json({ 
          success: false, 
          error: 'Cron expression required',
          examples: {
            everyHour: '0 * * * *',
            dailyAt8AM: '0 8 * * *',
            everyMonday: '0 9 * * 1',
            every15min: '*/15 * * * *'
          }
        });
      }

      const cronParts = cron.split(' ').filter(p => p.length > 0);
      if (cronParts.length < 5 || cronParts.length > 6) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid cron format. Expected 5-6 parts: "minute hour day month weekday"'
        });
      }

      // ── Get User Plan (includes overrides) ──
      const plan = await UserManager.getUserPlan(connection, userId);
      const isVip = isVipUser(plan.priority, config.VIP_PRIORITY_THRESHOLD);

      // ── Check Schedule Limit (From User's Plan) ──
      const maxSchedules = plan.maxSchedules;
      
      const existingSchedules = await queue.getRepeatableJobs();
      const userScheduleCount = existingSchedules.filter(
        job => job.id?.startsWith(`${SCHEDULE_PREFIX}:${userId}:`)
      ).length;

      if (userScheduleCount >= maxSchedules) {
        return res.status(429).json({
          success: false,
          error: `Schedule limit reached. You have ${userScheduleCount}/${maxSchedules} active schedules.`,
          hint: isVip ? 'Contact support to increase limit' : 'Upgrade to VIP for more schedules'
        });
      }

      // ── Validate Steps ──
      const headless = validateHeadless(req.body.headless, config.DEFAULT_HEADLESS);
      const steps = validateSteps(req.body.steps, plan);
      const webhookUrl = validateWebhookUrl(req.body.webhookUrl);

      // ── Create Schedule ID ──
      const scheduleId = `${SCHEDULE_PREFIX}:${userId}:${Date.now()}:${scheduleName}`;

      // ── Add Repeatable Job (Using Plan's runLimit) ──
      await queue.add(
        'run',
        { 
          userId, 
          steps, 
          headless, 
          webhookUrl,
          __scheduled: true,
          __scheduleName: scheduleName,
          __scheduleId: scheduleId
        },
        {
          priority: plan.priority,
          repeat: { 
            pattern: cron,
            // 0 means unlimited, undefined also means unlimited
            limit: plan.runLimit > 0 ? plan.runLimit : undefined
          },
          jobId: scheduleId
        }
      );

      // ── Calculate Next Run ──
      const repeatableJobs = await queue.getRepeatableJobs();
      const thisSchedule = repeatableJobs.find(j => j.id === scheduleId);

      res.json({
        success: true,
        message: 'Job scheduled successfully',
        schedule: {
          id: scheduleId,
          key: thisSchedule?.key || null,
          name: scheduleName,
          cron,
          nextRun: thisSchedule && thisSchedule.next ? new Date(thisSchedule.next).toISOString() : 'pending',
          runsLimit: plan.runLimit > 0 ? plan.runLimit : 'unlimited'
        },
        currentSchedules: userScheduleCount + 1,
        maxSchedules,
        userType: isVip ? 'VIP' : 'Free'
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // GET /schedules/:userId - List active schedules
  // ══════════════════════════════════════════
  router.get('/schedules/:userId', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);
      
      // Get user's plan (includes personal limits)
      const plan = await UserManager.getUserPlan(connection, userId);
      const isVip = isVipUser(plan.priority, config.VIP_PRIORITY_THRESHOLD);
      const maxSchedules = plan.maxSchedules;

      // Get all repeatable jobs
      const repeatableJobs = await queue.getRepeatableJobs();
      
      // Filter jobs belonging to this user
      const userSchedules = repeatableJobs.filter(
        job => job.id?.startsWith(`${SCHEDULE_PREFIX}:${userId}:`)
      );

      // Parse schedule info from ID
      const schedules = userSchedules.map(job => {
        const parts = job.id?.split(':') || [];
        const name = parts[3] || 'Unknown';
        const createdAt = parts[2] ? parseInt(parts[2]) : 0;

        return {
          key: job.key,
          scheduleId: job.id,
          name,
          cron: job.pattern,
          nextRun: job.next ? new Date(job.next).toISOString() : 'pending',
          createdAt: createdAt ? new Date(createdAt).toISOString() : null,
          timezone: job.tz || 'UTC'
        };
      });

      res.json({
        success: true,
        userId,
        userType: isVip ? 'VIP' : 'Free',
        count: schedules.length,
        limit: maxSchedules,
        remaining: maxSchedules - schedules.length,
        runLimit: plan.runLimit > 0 ? plan.runLimit : 'unlimited',
        schedules
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // DELETE /schedule/:userId/:key - Remove schedule
  // ══════════════════════════════════════════
  router.delete('/schedule/:userId/:key(*)', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);
      const key = decodeURIComponent(req.params.key);

      const repeatableJobs = await queue.getRepeatableJobs();
      const schedule = repeatableJobs.find(j => j.key === key);

      if (!schedule) {
        return res.status(404).json({ 
          success: false, 
          error: 'Schedule not found',
          hint: 'Use GET /schedules/:userId to see valid keys'
        });
      }

      if (!schedule.id?.startsWith(`${SCHEDULE_PREFIX}:${userId}:`)) {
        return res.status(403).json({ 
          success: false, 
          error: 'Access denied - this schedule belongs to another user'
        });
      }

      const removed = await queue.removeRepeatableByKey(key);

      if (!removed) {
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to remove schedule'
        });
      }

      const parts = schedule.id.split(':');
      const name = parts[3] || 'Unknown';

      res.json({
        success: true,
        message: 'Schedule removed successfully',
        removed: {
          key,
          scheduleId: schedule.id,
          name,
          cron: schedule.pattern
        }
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // DELETE /cancel/:userId/:jobId
  // ══════════════════════════════════════════
  router.delete('/cancel/:userId/:jobId', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);
      const jobId = req.params.jobId;

      const closeBrowser = req.query.closeBrowser === 'true';
      const closeTab = req.query.closeTab === 'true';

      const job = await queue.getJob(jobId);
      if (!job || String(job.data.userId) !== userId) {
        return res.status(404).json({ success: false, message: 'Job not found' });
      }

      profileManager.setCancelFlag(jobId);
      await job.updateData({ ...job.data, __cancelledByUser: true });

      const state = await job.getState();
      let actionTaken = 'signal_sent';
      let browserClosed = false;
      let tabClosed = false;
      let contextClosed = false;

      const freeEntry = profileManager.getFreeContext(jobId);
      if (freeEntry) {
        console.log(`[CANCEL] 🧹 Cleaning up Free context for job ${jobId}`);
        try {
          await freeEntry.context.close();
          contextClosed = true;
        } catch {}
        profileManager.removeFreeContext(jobId);
      }

      if (closeBrowser) {
        const vipEntry = profileManager.getVipContext(userId);
        if (vipEntry) {
          console.log(`[CANCEL] 🔴 Closing VIP browser for user ${userId}`);
          await vipEntry.context.close().catch(() => {});
          profileManager.removeVipContext(userId);
          browserClosed = true;
        }
        profileManager.unregisterPage(jobId);
        actionTaken = browserClosed ? 'browser_closed' : 'context_closed';
      } else if (closeTab) {
        const page = profileManager.getPage(jobId);

        if (page && !page.isClosed()) {
          console.log(`[CANCEL] 🟡 Closing specific tab for job ${jobId}`);
          try {
            await page.close();
            tabClosed = true;
            actionTaken = 'tab_closed';
          } catch (e: unknown) {
            const error = e as Error;
            console.log(`[CANCEL] Failed to close tab: ${error.message}`);
          }
        } else {
          actionTaken = contextClosed ? 'context_closed' : 'page_not_found';
        }
        profileManager.unregisterPage(jobId);
      } else {
        console.log(`[CANCEL] 🟢 Soft cancel signal sent for job ${jobId}`);
        actionTaken = contextClosed ? 'context_cleaned' : 'signal_sent';
      }

      if (['waiting', 'delayed'].includes(state)) {
        await job.remove();
        await connection.srem(getUserActiveJobsKey(userId), jobId);

        return res.json({
          success: true,
          removed: true,
          previousState: state,
          action: actionTaken,
          contextClosed,
          browserClosed,
          tabClosed
        });
      }

      res.json({
        success: true,
        message: 'Cancellation processed',
        state,
        action: actionTaken,
        contextClosed,
        browserClosed,
        tabClosed,
        hint: contextClosed
          ? 'Context cleaned up'
          : browserClosed
            ? 'Browser forcefully closed'
            : tabClosed
              ? 'Tab closed, job will stop at next step'
              : 'Job will stop at next cancellation check'
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // GET /quota/:userId
  // ══════════════════════════════════════════
  router.get('/quota/:userId', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);

      const status = await UserManager.getSubscriptionStatus(connection, userId);
      const userLevel = await UserManager.getUserLevel(connection, userId);
      const userSettings = await UserManager.getUserSettings(connection, userId);

      const usage = await quotaManager.getUsage(userId);
      const remaining = await quotaManager.getRemainingSeconds(userId, status.plan.quota);

      const isVip = isVipUser(status.plan.priority, config.VIP_PRIORITY_THRESHOLD);

      res.json({
        success: true,
        userId,
        date: usage.date,
        userType: isVip ? 'VIP' : 'Free',
        forceSequential: userSettings.forceSequential || false,
        plan: {
          level: userLevel,
          quotaMinutes: status.plan.quota,
          maxTabs: status.plan.maxTabs,
          maxSteps: status.plan.maxSteps,
          priority: status.plan.priority,
          maxSchedules: status.plan.maxSchedules,
          runLimit: status.plan.runLimit > 0 ? status.plan.runLimit : 'unlimited',
          hasOverrides: status.hasOverrides,
          subscription: status.type === 'lifetime'
            ? 'Lifetime'
            : (status.daysLeft ? `${status.daysLeft} Days` : 'Free')
        },
        usage: {
          usedSeconds: usage.usedSeconds,
          usedMinutes: parseFloat((usage.usedSeconds / 60).toFixed(2)),
          limitMinutes: status.plan.quota,
          remainingSeconds: remaining === Infinity ? -1 : remaining,
          remainingMinutes: remaining === Infinity ? -1 : parseFloat((remaining / 60).toFixed(2)),
          unlimited: status.plan.quota <= 0
        }
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // GET /jobs/:userId - List user's jobs
  // ══════════════════════════════════════════
  router.get('/jobs/:userId', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const jobs = await queue.getJobs(
        ['waiting', 'active', 'delayed', 'completed', 'failed'],
        0,
        1000,
        true
      );

      const userJobs = jobs
        .filter(j => String(j.data?.userId) === userId)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, limit);

      const list = await Promise.all(userJobs.map(async j => ({
        jobId: j.id,
        state: await j.getState(),
        progress: j.progress || 0,
        timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
        failedReason: j.failedReason,
        isScheduled: !!j.data.__scheduled,
        scheduleName: j.data.__scheduleName || null
      })));

      res.json({
        success: true,
        userId,
        total: list.length,
        jobs: list
      });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ══════════════════════════════════════════
  // GET /job/:userId/:jobId - Get job details
  // ══════════════════════════════════════════
  router.get('/job/:userId/:jobId', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId);
      const jobId = req.params.jobId;

      const job = await queue.getJob(jobId);

      if (job && String(job.data?.userId) === userId) {
        const state = await job.getState();

        if (profileManager.hasJobOutputs(jobId)) {
          let liveUrl = null;

          const vipEntry = profileManager.getVipContext(userId);
          const freeEntry = profileManager.getFreeContext(jobId);
          const entry = vipEntry || freeEntry;

          if (entry && entry.context.pages().length > 0) {
            try {
              liveUrl = entry.context.pages()[0].url();
            } catch {}
          }

          return res.json({
            success: true,
            jobId,
            state: 'active',
            progress: job.progress,
            isScheduled: !!job.data.__scheduled,
            scheduleName: job.data.__scheduleName || null,
            liveStatus: {
              message: 'Processing...',
              currentUrl: liveUrl || 'Loading...',
              stepIndex: profileManager.getJobOutputs(jobId).length || 0
            },
            stepOutputs: profileManager.getJobOutputs(jobId) || []
          });
        }

        if (['waiting', 'delayed'].includes(state)) {
          const counts = await queue.getJobCounts('waiting', 'delayed');
          return res.json({
            success: true,
            jobId,
            state,
            progress: 0,
            isScheduled: !!job.data.__scheduled,
            queueInfo: {
              totalWaiting: counts.waiting + counts.delayed,
              message: 'In Queue'
            }
          });
        }

        if (['completed', 'failed'].includes(state)) {
          const jobData = await readJobFile(userId, jobId);
          if (jobData) return res.json(jobData);
        }
      }

      const jobData = await readJobFile(userId, jobId);
      if (jobData) return res.json(jobData);

      const partialData = await readPartialJobFile(userId, jobId);
      if (partialData) {
        return res.json({
          success: false,
          state: 'failed',
          recovered: true,
          message: 'Recovered from partial crash log',
          stepOutputs: partialData,
          jobId,
          userId
        });
      }

      res.status(404).json({ success: false, message: 'Job not found' });

    } catch (e: unknown) {
      const error = e as Error;
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};