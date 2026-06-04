'use strict';

import type IORedis from 'ioredis';
import { getLiveChannel, getLiveBufferKey } from '../utils/redis-keys';

// ════════════════════════════════════════════════════════════════
// LiveBus (Step 16) — standard live event channel for jobs.
// ----------------------------------------------------------------
// Events are published to a per-job Redis Pub/Sub channel so that the
// web process (which may be separate from the worker under PM2 cluster)
// can fan them out to WebSocket / SSE subscribers. A short replay buffer
// (capped Redis list) lets a late subscriber catch up on recent events.
// ════════════════════════════════════════════════════════════════

export type LiveEventType =
  | 'job.start'
  | 'log'
  | 'step.start'
  | 'step.done'
  | 'step.error'
  | 'job.done'
  | 'job.error';

export interface LiveEvent {
  type: LiveEventType;
  jobId: string;
  userId: string;
  seq: number;
  ts: string;
  data?: Record<string, unknown>;
}

const BUFFER_MAX = 200;          // keep last N events per job
const BUFFER_TTL_SEC = 30 * 60;  // expire replay buffer after 30 min

export class LiveBus {
  // A dedicated publisher connection (re-uses the main one; ioredis is safe for publish).
  constructor(private readonly redis: IORedis) {}

  // Publish an event: append to capped replay buffer + fan-out via Pub/Sub.
  async publish(ev: Omit<LiveEvent, 'ts'> & { ts?: string }): Promise<void> {
    const full: LiveEvent = { ts: new Date().toISOString(), ...ev } as LiveEvent;
    const payload = JSON.stringify(full);
    const chan = getLiveChannel(full.userId, full.jobId);
    const buf = getLiveBufferKey(full.userId, full.jobId);
    try {
      const pipe = this.redis.pipeline();
      pipe.rpush(buf, payload);
      pipe.ltrim(buf, -BUFFER_MAX, -1);
      pipe.expire(buf, BUFFER_TTL_SEC);
      pipe.publish(chan, payload);
      await pipe.exec();
    } catch {
      // Live delivery is best-effort; never let it break the pipeline.
    }
  }

  // Fetch the recent replay buffer for a job (oldest -> newest).
  async getBuffer(userId: string, jobId: string): Promise<LiveEvent[]> {
    try {
      const raw = await this.redis.lrange(getLiveBufferKey(userId, jobId), 0, -1);
      return raw.map(r => { try { return JSON.parse(r) as LiveEvent; } catch { return null; } })
        .filter((x): x is LiveEvent => x !== null);
    } catch {
      return [];
    }
  }
}

// A small helper bound to a single job: increments seq and stamps ids.
export class JobLivePublisher {
  private seq = 0;
  constructor(
    private readonly bus: LiveBus,
    private readonly userId: string,
    private readonly jobId: string
  ) {}

  emit(type: LiveEventType, data?: Record<string, unknown>): void {
    this.seq += 1;
    // fire-and-forget
    void this.bus.publish({ type, userId: this.userId, jobId: this.jobId, seq: this.seq, data });
  }
}
