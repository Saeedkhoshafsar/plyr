import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import IORedis from 'ioredis';

// Step 16 — LiveBus integration tests.
// These exercise the real Redis-backed replay buffer + Pub/Sub fan-out.
// They self-skip when Redis is unavailable so the suite stays green in
// environments without a local Redis (CI without the service, etc).

let redis: IORedis | null = null;
let redisAvailable = false;

const TEST_USER = 'live_test_user';

beforeAll(async () => {
  try {
    redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    await redis.connect();
    await redis.ping();
    redisAvailable = true;
  } catch {
    redisAvailable = false;
    if (redis) { try { redis.disconnect(); } catch { /* ignore */ } }
    redis = null;
  }
});

afterAll(async () => {
  if (redis) {
    try {
      // Clean up any test keys.
      const keys = await redis.keys('live:*' + TEST_USER + '*');
      if (keys.length) await redis.del(...keys);
    } catch { /* ignore */ }
    try { await redis.quit(); } catch { /* ignore */ }
  }
});

describe('LiveBus (Redis-backed replay buffer + Pub/Sub)', () => {
  it('publishes events to the replay buffer and reads them back in order', async () => {
    if (!redisAvailable || !redis) { expect(true).toBe(true); return; }

    const { LiveBus } = await import('../../src/core/LiveBus');
    const bus = new LiveBus(redis);
    const jobId = 'job_' + Date.now();

    await bus.publish({ type: 'job.start', userId: TEST_USER, jobId, seq: 1 });
    await bus.publish({ type: 'log', userId: TEST_USER, jobId, seq: 2, data: { message: 'hi' } });
    await bus.publish({ type: 'job.done', userId: TEST_USER, jobId, seq: 3, data: { durationMs: 5 } });

    const buf = await bus.getBuffer(TEST_USER, jobId);
    expect(buf.length).toBe(3);
    expect(buf.map(e => e.type)).toEqual(['job.start', 'log', 'job.done']);
    expect(buf[1].data?.message).toBe('hi');
    // ts is auto-stamped
    expect(typeof buf[0].ts).toBe('string');
  });

  it('caps the replay buffer (keeps only the most recent events)', async () => {
    if (!redisAvailable || !redis) { expect(true).toBe(true); return; }

    const { LiveBus } = await import('../../src/core/LiveBus');
    const bus = new LiveBus(redis);
    const jobId = 'job_cap_' + Date.now();

    // Publish more than BUFFER_MAX (200) events.
    for (let i = 0; i < 210; i++) {
      await bus.publish({ type: 'log', userId: TEST_USER, jobId, seq: i, data: { i } });
    }
    const buf = await bus.getBuffer(TEST_USER, jobId);
    expect(buf.length).toBe(200);
    // The oldest 10 should have been trimmed; first kept event has i=10.
    expect(buf[0].data?.i).toBe(10);
    expect(buf[buf.length - 1].data?.i).toBe(209);
  });

  it('fans events out via Pub/Sub to a subscriber', async () => {
    if (!redisAvailable || !redis) { expect(true).toBe(true); return; }

    const { LiveBus } = await import('../../src/core/LiveBus');
    const { getLiveChannel } = await import('../../src/utils/redis-keys');
    const bus = new LiveBus(redis);
    const jobId = 'job_pub_' + Date.now();
    const channel = getLiveChannel(TEST_USER, jobId);

    const sub = redis.duplicate();
    const received: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for pub/sub')), 5000);
      sub.on('message', (_chan, message) => {
        received.push(message);
        if (received.length >= 2) {
          clearTimeout(timer);
          resolve();
        }
      });
      sub.subscribe(channel).then(() => {
        // Publish after the subscription is active.
        bus.publish({ type: 'step.start', userId: TEST_USER, jobId, seq: 1, data: { index: 1, action: 'goto' } });
        bus.publish({ type: 'step.done', userId: TEST_USER, jobId, seq: 2, data: { index: 1, action: 'goto', success: true } });
      }).catch(reject);
    });

    try { await sub.unsubscribe(channel); } catch { /* ignore */ }
    try { await sub.quit(); } catch { /* ignore */ }

    expect(received.length).toBeGreaterThanOrEqual(2);
    const parsed = received.map(r => JSON.parse(r));
    expect(parsed[0].type).toBe('step.start');
    expect(parsed[1].type).toBe('step.done');
  });
});

describe('JobLivePublisher (seq increment + fire-and-forget)', () => {
  it('increments seq across emits and writes to the buffer', async () => {
    if (!redisAvailable || !redis) { expect(true).toBe(true); return; }

    const { LiveBus, JobLivePublisher } = await import('../../src/core/LiveBus');
    const bus = new LiveBus(redis);
    const jobId = 'job_pub_seq_' + Date.now();
    const pub = new JobLivePublisher(bus, TEST_USER, jobId);

    pub.emit('job.start', { isVip: false });
    pub.emit('log', { message: 'one' });
    pub.emit('log', { message: 'two' });

    // emit is fire-and-forget; give the async publishes a moment to land.
    await new Promise(r => setTimeout(r, 200));

    const buf = await bus.getBuffer(TEST_USER, jobId);
    expect(buf.length).toBe(3);
    expect(buf.map(e => e.seq)).toEqual([1, 2, 3]);
    expect(buf[2].data?.message).toBe('two');
  });
});
