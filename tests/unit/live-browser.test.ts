import { describe, it, expect } from 'vitest';

// Step 12 — LiveBrowserManager session bookkeeping (no real browser).
// create()/destroy() never launch Chromium (that happens in start()),
// so we can test the registry, id uniqueness and the cap purely.

import { LiveBrowserManager } from '../../src/core/LiveBrowser';

describe('LiveBrowserManager (no browser launch)', () => {
  it('creates sessions with unique ids and tracks the count', () => {
    const mgr = new LiveBrowserManager(4);
    expect(mgr.count()).toBe(0);
    const a = mgr.create('0');
    const b = mgr.create('0');
    expect(a.id).not.toBe(b.id);
    expect(a.userId).toBe('0');
    expect(mgr.count()).toBe(2);
    expect(a.isClosed()).toBe(false);
  });

  it('enforces the max-sessions cap', () => {
    const mgr = new LiveBrowserManager(2);
    mgr.create('u1');
    mgr.create('u1');
    expect(() => mgr.create('u1')).toThrowError(/too_many_sessions/);
    expect(mgr.count()).toBe(2);
  });

  it('destroy() removes the session and marks it closed', async () => {
    const mgr = new LiveBrowserManager(4);
    const s = mgr.create('7');
    await mgr.destroy(s.id);
    expect(mgr.count()).toBe(0);
    expect(s.isClosed()).toBe(true);
    // destroying a missing id is a no-op
    await mgr.destroy('does_not_exist');
    expect(mgr.count()).toBe(0);
  });

  it('shutdown() closes and clears every session', async () => {
    const mgr = new LiveBrowserManager(4);
    const s1 = mgr.create('a');
    const s2 = mgr.create('b');
    await mgr.shutdown();
    expect(mgr.count()).toBe(0);
    expect(s1.isClosed()).toBe(true);
    expect(s2.isClosed()).toBe(true);
  });
});

describe('BrowserStreamServer path matching', () => {
  it('only matches the /browser/ws upgrade path', async () => {
    const { BrowserStreamServer } = await import('../../src/core/BrowserStreamServer');
    const srv = new BrowserStreamServer(new LiveBrowserManager(1));
    expect(srv.matches('/browser/ws')).toBe(true);
    expect(srv.matches('/live/ws')).toBe(false);
    expect(srv.matches('/')).toBe(false);
    await srv.shutdown();
  });
});
