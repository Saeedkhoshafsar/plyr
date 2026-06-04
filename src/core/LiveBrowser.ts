'use strict';

import type { BrowserContext, Page, CDPSession } from 'playwright';
import { GlobalBrowser } from './GlobalBrowser';

// ════════════════════════════════════════════════════════════════
// LiveBrowser (Step 12) — interactive, streamable browser sessions.
// ----------------------------------------------------------------
// Each UI client that opens the "Live Browser View" gets one
// LiveBrowserSession: a dedicated, isolated BrowserContext + Page on
// the shared (headless) Chromium, plus a CDP session running
// Page.startScreencast. Frames are pushed to a sink (the WebSocket)
// as base64 JPEG; the UI renders them on a <canvas>. Input commands
// (navigate / click / type / scroll / key) are replayed onto the
// page via CDP Input.* so the user can drive the real server browser.
//
// An Element Picker mode is injected as page script: hovering
// highlights elements and a click reports a robust CSS selector +
// XPath back over the channel (without performing a real click).
//
// Sessions are reference-counted by socket and auto-expire after an
// idle TTL so the browser is not held open forever (lifecycle mgmt).
// ════════════════════════════════════════════════════════════════

export interface ScreencastFrame {
  data: string;        // base64 JPEG
  sessionId: number;   // CDP screencast frame ack id
  width: number;
  height: number;
}

export interface PickResult {
  css: string;
  xpath: string;
  text?: string;
  tag?: string;
}

type FrameSink = (frame: ScreencastFrame) => void;
type EventSink = (type: string, data: Record<string, unknown>) => void;

const IDLE_TTL_MS = 5 * 60 * 1000;     // close session after 5 min idle
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

// The picker script is injected into the page. It draws an overlay,
// highlights the hovered element, and on click computes a CSS path +
// XPath, then reports it via a binding exposed by Playwright. It does
// NOT navigate or trigger the element's own handlers (capture + stop).
const PICKER_SCRIPT = `(() => {
  if (window.__abPickerActive) return;
  window.__abPickerActive = true;
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4f8cff;background:rgba(79,140,255,.15);box-shadow:0 0 0 1px #fff;transition:all .03s;';
  document.documentElement.appendChild(box);
  function cssPath(el){
    if (!(el instanceof Element)) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    while (el && el.nodeType === 1 && parts.length < 6){
      var sel = el.nodeName.toLowerCase();
      if (el.id){ parts.unshift('#' + CSS.escape(el.id)); break; }
      var cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0,2);
      if (cls.length) sel += '.' + cls.map(function(c){return CSS.escape(c);}).join('.');
      var parent = el.parentNode;
      if (parent){
        var sibs = Array.prototype.filter.call(parent.children, function(c){return c.nodeName === el.nodeName;});
        if (sibs.length > 1){ sel += ':nth-of-type(' + (sibs.indexOf(el)+1) + ')'; }
      }
      parts.unshift(sel);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  function xPath(el){
    if (el && el.id) return '//*[@id="' + el.id + '"]';
    var parts = [];
    while (el && el.nodeType === 1){
      var idx = 1, sib = el.previousSibling;
      while (sib){ if (sib.nodeType === 1 && sib.nodeName === el.nodeName) idx++; sib = sib.previousSibling; }
      parts.unshift(el.nodeName.toLowerCase() + '[' + idx + ']');
      el = el.parentElement;
    }
    return '/' + parts.join('/');
  }
  function onMove(e){
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box) return;
    var r = el.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    window.__abPickHover = el;
  }
  function onClick(e){
    e.preventDefault(); e.stopPropagation();
    var el = window.__abPickHover || document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    try {
      window.__abReportPick({
        css: cssPath(el),
        xpath: xPath(el),
        text: (el.textContent || '').trim().slice(0,80),
        tag: el.nodeName.toLowerCase()
      });
    } catch (err) {}
  }
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  window.__abStopPicker = function(){
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    if (box && box.parentNode) box.parentNode.removeChild(box);
    window.__abPickerActive = false;
  };
})();`;

export class LiveBrowserSession {
  public readonly id: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private frameSink: FrameSink | null = null;
  private eventSink: EventSink | null = null;
  private pickerOn = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private closed = false;
  public readonly userId: string;
  private vp = { ...DEFAULT_VIEWPORT };

  constructor(id: string, userId: string) {
    this.id = id;
    this.userId = userId;
  }

  setSinks(frameSink: FrameSink, eventSink: EventSink): void {
    this.frameSink = frameSink;
    this.eventSink = eventSink;
  }

  isClosed(): boolean {
    return this.closed;
  }

  // Bring up an isolated context + page and start the CDP screencast.
  async start(): Promise<void> {
    if (this.closed) throw new Error('session_closed');
    this.context = await GlobalBrowser.getContext();
    this.page = await this.context.newPage();
    await this.page.setViewportSize(this.vp).catch(() => {});

    // Expose a binding the picker uses to report selections.
    await this.page.exposeBinding('__abReportPick', (_src, payload: PickResult) => {
      this.emit('pick', payload as unknown as Record<string, unknown>);
    }).catch(() => {});

    // CDP screencast (JPEG frames).
    this.cdp = await this.context.newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', async (params: {
      data: string;
      sessionId: number;
      metadata: { deviceWidth?: number; deviceHeight?: number };
    }) => {
      // Acknowledge so Chromium keeps sending frames.
      try { await this.cdp!.send('Page.screencastFrameAck', { sessionId: params.sessionId }); }
      catch { /* ignore */ }
      if (this.frameSink) {
        this.frameSink({
          data: params.data,
          sessionId: params.sessionId,
          width: params.metadata.deviceWidth || this.vp.width,
          height: params.metadata.deviceHeight || this.vp.height,
        });
      }
    });

    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: this.vp.width,
      maxHeight: this.vp.height,
      everyNthFrame: 1,
    });

    // Re-inject picker after navigations if it was on.
    this.page.on('framenavigated', async (frame) => {
      if (frame === this.page!.mainFrame() && this.pickerOn) {
        await this.injectPicker().catch(() => {});
      }
    });

    this.touch();
    this.emit('ready', { url: this.page.url(), width: this.vp.width, height: this.vp.height });
  }

  private emit(type: string, data: Record<string, unknown>): void {
    if (this.eventSink) {
      try { this.eventSink(type, data); } catch { /* best-effort */ }
    }
  }

  // Reset idle timer; close the session if no activity for IDLE_TTL_MS.
  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.emit('expired', {});
      void this.close();
    }, IDLE_TTL_MS);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }

  async navigate(url: string): Promise<void> {
    this.touch();
    if (!this.page) return;
    let target = String(url || '').trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    try {
      await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.emit('navigated', { url: this.page.url() });
    } catch (e) {
      this.emit('error', { message: (e as Error).message });
    }
  }

  async click(x: number, y: number): Promise<void> {
    this.touch();
    if (!this.cdp) return;
    const px = Math.round(x);
    const py = Math.round(y);
    try {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py });
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
    } catch { /* ignore */ }
  }

  async scroll(x: number, y: number, dy: number): Promise<void> {
    this.touch();
    if (!this.cdp) return;
    try {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY: Math.round(dy),
      });
    } catch { /* ignore */ }
  }

  // Type a string by inserting text (works for most inputs/contenteditable).
  async type(text: string): Promise<void> {
    this.touch();
    if (!this.cdp) return;
    try {
      await this.cdp.send('Input.insertText', { text: String(text) });
    } catch { /* ignore */ }
  }

  // Send a single special key (Enter, Backspace, Tab, etc.).
  async key(name: string): Promise<void> {
    this.touch();
    if (!this.page) return;
    try {
      await this.page.keyboard.press(name);
    } catch { /* ignore */ }
  }

  private async injectPicker(): Promise<void> {
    if (!this.page) return;
    try { await this.page.evaluate(PICKER_SCRIPT); } catch { /* ignore */ }
  }

  async setPicker(on: boolean): Promise<void> {
    this.touch();
    this.pickerOn = !!on;
    if (!this.page) return;
    if (on) {
      await this.injectPicker();
    } else {
      try { await this.page.evaluate('window.__abStopPicker && window.__abStopPicker()'); } catch { /* ignore */ }
    }
    this.emit('picker', { on: this.pickerOn });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    try { if (this.cdp) await this.cdp.send('Page.stopScreencast').catch(() => {}); } catch { /* ignore */ }
    try { if (this.cdp) await this.cdp.detach().catch(() => {}); } catch { /* ignore */ }
    try { if (this.page) await this.page.close().catch(() => {}); } catch { /* ignore */ }
    try { if (this.context) await GlobalBrowser.closeContext(this.context); } catch { /* ignore */ }
    this.cdp = null; this.page = null; this.context = null;
  }
}

// Registry of active sessions (one per connected socket). Keeps a cap
// so a single server can't be exhausted by too many live views.
export class LiveBrowserManager {
  private sessions = new Map<string, LiveBrowserSession>();
  private seq = 0;
  constructor(private readonly maxSessions = 8) {}

  count(): number { return this.sessions.size; }

  create(userId: string): LiveBrowserSession {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('too_many_sessions');
    }
    this.seq += 1;
    const id = `lb_${Date.now().toString(36)}_${this.seq}`;
    const s = new LiveBrowserSession(id, userId);
    this.sessions.set(id, s);
    return s;
  }

  async destroy(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) {
      this.sessions.delete(id);
      await s.close();
    }
  }

  async shutdown(): Promise<void> {
    const all = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.all(all.map((s) => s.close().catch(() => {})));
  }
}
