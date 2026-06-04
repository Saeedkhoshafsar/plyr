import type { Redis } from 'ioredis';

/**
 * Lua script for atomic quota check and consumption
 * Prevents race conditions in quota management
 */
const LUA_QUOTA_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local add = tonumber(ARGV[2])

-- If limit is 0 or negative, quota is unlimited
if limit <= 0 then
  return 0
end

local current = tonumber(redis.call('GET', key) or '0')

-- Check if adding would exceed limit
if current + add > limit then
  return -1
end

-- Atomically increment
local newVal = redis.call('INCRBY', key, add)

-- Set expiry on first use (24 hours)
if newVal == add then
  redis.call('EXPIRE', key, 86400)
end

return newVal
`;

/**
 * Lua script for checking quota without consuming
 */
const LUA_QUOTA_CHECK_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])

if limit <= 0 then
  return 1
end

local current = tonumber(redis.call('GET', key) or '0')

if current >= limit then
  return 0
end

return 1
`;

export class QuotaManager {
  private redis: Redis;
  private quotaScriptSha: string | null = null;
  private checkScriptSha: string | null = null;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Initialize Lua scripts (call once at startup)
   */
  async initialize(): Promise<void> {
    try {
      this.quotaScriptSha = await this.redis.script('LOAD', LUA_QUOTA_SCRIPT) as string;
      this.checkScriptSha = await this.redis.script('LOAD', LUA_QUOTA_CHECK_SCRIPT) as string;
      console.log('[QUOTA] Lua scripts loaded successfully');
    } catch (e) {
      console.error('[QUOTA] Failed to load Lua scripts, falling back to non-atomic mode:', e);
    }
  }

  /**
   * Get quota key for a user for today
   */
  private getQuotaKey(userId: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `quota:${userId}:${date}`;
  }

  /**
   * Check and consume quota atomically
   * @returns true if quota available, false if exhausted
   */
  async consumeQuota(userId: string, secondsToAdd: number, limitMinutes: number): Promise<boolean> {
    const key = this.getQuotaKey(userId);
    const limitSeconds = limitMinutes * 60;

    // Unlimited quota
    if (limitMinutes <= 0) {
      return true;
    }

    // Don't consume if nothing to add
    if (secondsToAdd <= 0) {
      return true;
    }

    // Use Lua script if available (atomic operation)
    if (this.quotaScriptSha) {
      try {
        const result = await this.redis.evalsha(
          this.quotaScriptSha,
          1,
          key,
          limitSeconds.toString(),
          secondsToAdd.toString()
        );
        return (result as number) >= 0;
      } catch (e: any) {
        // Script might have been flushed, try reloading
        if (e.message?.includes('NOSCRIPT')) {
          await this.initialize();
          return this.consumeQuota(userId, secondsToAdd, limitMinutes);
        }
        console.error('[QUOTA] Lua script error:', e);
      }
    }

    // Fallback: Non-atomic (less safe but functional)
    return this.consumeQuotaFallback(key, secondsToAdd, limitSeconds);
  }

  /**
   * Fallback non-atomic quota consumption
   */
  private async consumeQuotaFallback(
    key: string,
    secondsToAdd: number,
    limitSeconds: number
  ): Promise<boolean> {
    const current = parseInt(await this.redis.get(key) || '0');

    if (current + secondsToAdd > limitSeconds) {
      return false;
    }

    const newUsage = await this.redis.incrby(key, secondsToAdd);

    // Set expiry if this is first usage today
    if (newUsage === secondsToAdd) {
      await this.redis.expire(key, 86400);
    }

    return true;
  }

  /**
   * Check if user has quota remaining (without consuming)
   */
  async hasQuotaRemaining(userId: string, limitMinutes: number): Promise<boolean> {
    const key = this.getQuotaKey(userId);
    const limitSeconds = limitMinutes * 60;

    if (limitMinutes <= 0) {
      return true;
    }

    if (this.checkScriptSha) {
      try {
        const result = await this.redis.evalsha(
          this.checkScriptSha,
          1,
          key,
          limitSeconds.toString()
        );
        return (result as number) === 1;
      } catch {
        // Fallback to non-atomic check
      }
    }

    const current = parseInt(await this.redis.get(key) || '0');
    return current < limitSeconds;
  }

  /**
   * Get current usage for a user
   */
  async getUsage(userId: string): Promise<{ usedSeconds: number; date: string }> {
    const key = this.getQuotaKey(userId);
    const usedSeconds = parseInt(await this.redis.get(key) || '0');
    return { usedSeconds, date: key.split(':')[2] };
  }

  /**
   * Reset quota for a user
   */
  async resetQuota(userId: string): Promise<void> {
    const key = this.getQuotaKey(userId);
    await this.redis.del(key);
  }

  /**
   * Get remaining seconds for a user
   */
  async getRemainingSeconds(userId: string, limitMinutes: number): Promise<number> {
    if (limitMinutes <= 0) {
      return Infinity;
    }

    const { usedSeconds } = await this.getUsage(userId);
    const limitSeconds = limitMinutes * 60;
    return Math.max(0, limitSeconds - usedSeconds);
  }
}