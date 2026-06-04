import type { Redis } from 'ioredis';
import { config, PlanConfig } from '../config';
import { scanKeys } from '../utils/redis-keys';

export type SubscriptionType = 'free' | 'lifetime' | 'expiring';

export interface PlanStatus {
  plan: PlanConfig;
  daysLeft: number | null;
  type: SubscriptionType;
  hasOverrides: boolean;
}

// ✅ User Settings (block, sequential, note)
export interface UserSettings {
  forceSequential?: boolean;
  blockAccess?: boolean;
  note?: string;
}

// ✅ Plan Overrides - Updated with Schedule fields
export interface UserPlanOverrides {
  quota?: number;        // Daily quota in minutes
  maxTabs?: number;      // Max concurrent tabs
  maxSteps?: number;     // Max steps per job
  priority?: number;     // Queue priority (lower = higher priority)
  maxSchedules?: number; // ✅ NEW: Max concurrent schedules
  runLimit?: number;     // ✅ NEW: Max runs per schedule (0 = unlimited)
}

// ✅ Combined effective plan (base + overrides)
export interface EffectivePlan extends PlanConfig {
  isOverridden: boolean;
  overrides: UserPlanOverrides;
  baseLevel: string;
}

// ✅ All override field names
const OVERRIDE_FIELDS: (keyof UserPlanOverrides)[] = [
  'quota', 'maxTabs', 'maxSteps', 'priority', 'maxSchedules', 'runLimit'
];

export class UserManager {
  
  // ============================================
  // PLAN & LEVEL MANAGEMENT
  // ============================================

  /**
   * Get user's effective plan (base plan + overrides merged)
   */
  static async getUserPlan(redis: Redis, userId: string): Promise<PlanConfig> {
    const effective = await this.getEffectivePlan(redis, userId);
    return {
      quota: effective.quota,
      maxTabs: effective.maxTabs,
      maxSteps: effective.maxSteps,
      priority: effective.priority,
      maxSchedules: effective.maxSchedules,  // ✅ NEW
      runLimit: effective.runLimit           // ✅ NEW
    };
  }

  /**
   * Get detailed effective plan with override info
   */
  static async getEffectivePlan(redis: Redis, userId: string): Promise<EffectivePlan> {
    try {
      // 1. Get base plan from level
      const savedLevel = await redis.get(`user:level:${userId}`);
      const level = savedLevel || config.DEFAULT_USER_LEVEL;
      
      // ✅ Get base plan with all 6 fields
      const basePlan: PlanConfig = config.USER_PLANS[level] || config.USER_PLANS['0'] || {
        quota: 5,
        maxTabs: 1,
        maxSteps: 5,
        priority: 100,
        maxSchedules: 2,
        runLimit: 100
      };

      // 2. Get user-specific overrides
      const overrides = await this.getPlanOverrides(redis, userId);
      const hasOverrides = Object.values(overrides).some(v => v !== undefined);

      // 3. Merge (overrides take precedence)
      return {
        quota: overrides.quota ?? basePlan.quota,
        maxTabs: overrides.maxTabs ?? basePlan.maxTabs,
        maxSteps: overrides.maxSteps ?? basePlan.maxSteps,
        priority: overrides.priority ?? basePlan.priority,
        maxSchedules: overrides.maxSchedules ?? basePlan.maxSchedules,  // ✅ NEW
        runLimit: overrides.runLimit ?? basePlan.runLimit,              // ✅ NEW
        isOverridden: hasOverrides,
        overrides,
        baseLevel: level
      };

    } catch (e) {
      console.error(`[UserManager] Error fetching plan for ${userId}:`, e);
      return {
        quota: 5,
        maxTabs: 1,
        maxSteps: 5,
        priority: 100,
        maxSchedules: 2,
        runLimit: 100,
        isOverridden: false,
        overrides: {},
        baseLevel: config.DEFAULT_USER_LEVEL
      };
    }
  }

  /**
   * Get user's subscription status including expiration
   */
  static async getSubscriptionStatus(redis: Redis, userId: string): Promise<PlanStatus> {
    const effective = await this.getEffectivePlan(redis, userId);
    const key = `user:level:${userId}`;
    const ttl = await redis.ttl(key);

    let type: SubscriptionType = 'free';
    let daysLeft: number | null = null;

    if (ttl === -1) {
      type = 'lifetime';
    } else if (ttl > 0) {
      type = 'expiring';
      daysLeft = Math.ceil(ttl / 86400);
    } else if (ttl === -2) {
      type = 'free';
    }

    return { 
      plan: {
        quota: effective.quota,
        maxTabs: effective.maxTabs,
        maxSteps: effective.maxSteps,
        priority: effective.priority,
        maxSchedules: effective.maxSchedules,  // ✅ NEW
        runLimit: effective.runLimit           // ✅ NEW
      }, 
      daysLeft, 
      type,
      hasOverrides: effective.isOverridden
    };
  }

  /**
   * Get user's level
   */
  static async getUserLevel(redis: Redis, userId: string): Promise<string> {
    const level = await redis.get(`user:level:${userId}`);
    return level || config.DEFAULT_USER_LEVEL;
  }

  /**
   * Set user's level
   */
  static async setUserLevel(
    redis: Redis,
    userId: string,
    level: string,
    days?: number
  ): Promise<void> {
    const key = `user:level:${userId}`;

    if (days && days > 0) {
      await redis.set(key, level, 'EX', days * 24 * 60 * 60);
    } else {
      await redis.set(key, level);
      await redis.persist(key);
    }
  }

  // ============================================
  // PLAN OVERRIDES
  // ============================================

  /**
   * Get user-specific plan overrides (all 6 fields)
   */
  static async getPlanOverrides(redis: Redis, userId: string): Promise<UserPlanOverrides> {
    const key = `user:plan:${userId}`;
    const data = await redis.hgetall(key);

    return {
      quota: data.quota !== undefined ? parseInt(data.quota) : undefined,
      maxTabs: data.maxTabs !== undefined ? parseInt(data.maxTabs) : undefined,
      maxSteps: data.maxSteps !== undefined ? parseInt(data.maxSteps) : undefined,
      priority: data.priority !== undefined ? parseInt(data.priority) : undefined,
      maxSchedules: data.maxSchedules !== undefined ? parseInt(data.maxSchedules) : undefined,  // ✅ NEW
      runLimit: data.runLimit !== undefined ? parseInt(data.runLimit) : undefined              // ✅ NEW
    };
  }

  /**
   * Set user-specific plan overrides
   * Pass null to remove a specific override, undefined to keep current value
   */
  static async setPlanOverrides(
    redis: Redis,
    userId: string,
    overrides: Partial<Record<keyof UserPlanOverrides, number | null>>
  ): Promise<void> {
    const key = `user:plan:${userId}`;
    const pipeline = redis.pipeline();

    // ✅ Now handles all 6 fields
    for (const field of OVERRIDE_FIELDS) {
      const value = overrides[field];
      if (value === null) {
        // null = remove this override (use base plan value)
        pipeline.hdel(key, field);
      } else if (value !== undefined) {
        // number = set override
        pipeline.hset(key, field, String(value));
      }
      // undefined = don't change
    }

    await pipeline.exec();
  }

  /**
   * Clear all plan overrides (user will use base plan only)
   */
  static async clearPlanOverrides(redis: Redis, userId: string): Promise<void> {
    await redis.del(`user:plan:${userId}`);
  }

  // ============================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================

  /**
   * Extend or reduce subscription duration
   */
  static async extendSubscription(redis: Redis, userId: string, days: number): Promise<boolean> {
    const key = `user:level:${userId}`;
    const ttl = await redis.ttl(key);

    if (ttl < 0) {
      return false;
    }

    const newTtl = ttl + (days * 24 * 60 * 60);

    if (newTtl <= 0) {
      await redis.del(key);
      return true;
    }

    await redis.expire(key, newTtl);
    return true;
  }

  /**
   * Get plan expiration in days
   */
  static async getPlanExpiration(redis: Redis, userId: string): Promise<number | null> {
    const status = await this.getSubscriptionStatus(redis, userId);
    return status.daysLeft;
  }

  // ============================================
  // USER SETTINGS
  // ============================================

  /**
   * Get user specific settings
   */
  static async getUserSettings(redis: Redis, userId: string): Promise<UserSettings> {
    const key = `user:settings:${userId}`;
    const data = await redis.hgetall(key);

    return {
      forceSequential: data.forceSequential === 'true',
      blockAccess: data.blockAccess === 'true',
      note: data.note || undefined
    };
  }

  /**
   * Update user specific settings
   */
  static async updateUserSettings(
    redis: Redis,
    userId: string,
    settings: Partial<UserSettings>
  ): Promise<void> {
    const key = `user:settings:${userId}`;
    const pipeline = redis.pipeline();

    if (settings.forceSequential !== undefined) {
      pipeline.hset(key, 'forceSequential', String(settings.forceSequential));
    }

    if (settings.blockAccess !== undefined) {
      pipeline.hset(key, 'blockAccess', String(settings.blockAccess));
    }

    if (settings.note !== undefined) {
      if (settings.note === '' || settings.note === null) {
        pipeline.hdel(key, 'note');
      } else {
        pipeline.hset(key, 'note', settings.note);
      }
    }

    await pipeline.exec();
  }

  /**
   * Clear all user settings
   */
  static async clearUserSettings(redis: Redis, userId: string): Promise<void> {
    await redis.del(`user:settings:${userId}`);
  }

  /**
   * Check if user is blocked
   */
  static async isUserBlocked(redis: Redis, userId: string): Promise<boolean> {
    const key = `user:settings:${userId}`;
    const blocked = await redis.hget(key, 'blockAccess');
    return blocked === 'true';
  }

  // ============================================
  // QUOTA CHECK
  // ============================================

  /**
   * Check if user has quota remaining
   */
  static async hasQuotaRemaining(redis: Redis, userId: string): Promise<boolean> {
    const plan = await this.getUserPlan(redis, userId);

    if (plan.quota <= 0) {
      return true; // Unlimited
    }

    const date = new Date().toISOString().split('T')[0];
    const key = `quota:${userId}:${date}`;
    const usedSeconds = parseInt(await redis.get(key) || '0');

    return usedSeconds < plan.quota * 60;
  }

  // ============================================
  // BULK OPERATIONS
  // ============================================

  /**
   * Bulk update settings for multiple users
   */
  static async bulkUpdateSettings(
    redis: Redis,
    userIds: string[],
    settings: Partial<UserSettings>
  ): Promise<{ successful: string[]; failed: string[] }> {
    const successful: string[] = [];
    const failed: string[] = [];

    for (const userId of userIds) {
      try {
        await this.updateUserSettings(redis, userId, settings);
        successful.push(userId);
      } catch {
        failed.push(userId);
      }
    }

    return { successful, failed };
  }

  /**
   * Bulk extend subscriptions
   */
  static async bulkExtendSubscription(
    redis: Redis,
    userIds: string[],
    days: number
  ): Promise<{ successful: string[]; failed: string[]; skipped: string[] }> {
    const successful: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];

    for (const userId of userIds) {
      try {
        const result = await this.extendSubscription(redis, userId, days);
        if (result) {
          successful.push(userId);
        } else {
          skipped.push(userId);
        }
      } catch {
        failed.push(userId);
      }
    }

    return { successful, failed, skipped };
  }

  /**
   * Bulk set plan overrides
   */
  static async bulkSetPlanOverrides(
    redis: Redis,
    userIds: string[],
    overrides: Partial<Record<keyof UserPlanOverrides, number | null>>
  ): Promise<{ successful: string[]; failed: string[] }> {
    const successful: string[] = [];
    const failed: string[] = [];

    for (const userId of userIds) {
      try {
        await this.setPlanOverrides(redis, userId, overrides);
        successful.push(userId);
      } catch {
        failed.push(userId);
      }
    }

    return { successful, failed };
  }

  // ============================================
  // LIST OPERATIONS
  // ============================================

  /**
   * Get all users with plan overrides
   */
  static async getUsersWithOverrides(redis: Redis): Promise<{ userId: string; overrides: UserPlanOverrides }[]> {
    const keys = await scanKeys(redis, 'user:plan:*');
    const result: { userId: string; overrides: UserPlanOverrides }[] = [];

    for (const key of keys) {
      const userId = key.split(':')[2];
      const overrides = await this.getPlanOverrides(redis, userId);
      if (Object.values(overrides).some(v => v !== undefined)) {
        result.push({ userId, overrides });
      }
    }

    return result;
  }

  /**
   * Get users with specific settings
   */
  static async getUsersWithSettings(
    redis: Redis, 
    filter?: { blocked?: boolean; sequential?: boolean }
  ): Promise<{ userId: string; settings: UserSettings }[]> {
    const keys = await scanKeys(redis, 'user:settings:*');
    const result: { userId: string; settings: UserSettings }[] = [];

    for (const key of keys) {
      const userId = key.split(':')[2];
      const settings = await this.getUserSettings(redis, userId);
      
      if (filter) {
        if (filter.blocked !== undefined && settings.blockAccess !== filter.blocked) continue;
        if (filter.sequential !== undefined && settings.forceSequential !== filter.sequential) continue;
      }
      
      result.push({ userId, settings });
    }

    return result;
  }
}