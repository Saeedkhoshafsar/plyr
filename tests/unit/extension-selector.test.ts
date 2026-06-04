import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import vm from 'vm';

// Step 13 — verify the extension's selector.js (window.ABSelector) produces
// the same kind of robust CSS/XPath selectors as the server-side picker
// (src/core/LiveBrowser.ts PICKER_SCRIPT). We run it in a minimal sandbox
// with a tiny fake-DOM (no jsdom dependency) implementing only the bits the
// functions read: nodeType/nodeName/id/getAttribute/children/parent/siblings.

// --- minimal fake DOM ---------------------------------------------------
class FakeEl {
  nodeType = 1;
  nodeName: string;
  attrs: Record<string, string>;
  childrenArr: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.nodeName = tag.toUpperCase();
    this.attrs = attrs;
  }
  get id() { return this.attrs.id || ''; }
  getAttribute(k: string) { return this.attrs[k] != null ? this.attrs[k] : null; }
  get parentNode() { return this.parentElement; }
  get children() { return this.childrenArr; }
  // previousSibling chain across same parent (for xPath index)
  get previousSibling(): FakeEl | null {
    if (!this.parentElement) return null;
    const sibs = this.parentElement.childrenArr;
    const i = sibs.indexOf(this);
    return i > 0 ? sibs[i - 1] : null;
  }
  append(child: FakeEl) { child.parentElement = this; this.childrenArr.push(child); return child; }
}

let ABSelector: { cssPath: (el: unknown) => string; xPath: (el: unknown) => string };

beforeAll(() => {
  const code = readFileSync(resolve(__dirname, '../../extension/content/selector.js'), 'utf8');
  const sandbox: Record<string, unknown> = {
    window: {} as Record<string, unknown>,
    CSS: { escape: (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) },
    // FakeEl must satisfy `instanceof Element`; expose Element = FakeEl.
    Element: FakeEl,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  ABSelector = (sandbox.window as Record<string, unknown>).ABSelector as typeof ABSelector;
});

function build() {
  // <body><div class="wrap col"><button>A</button><button id="go" class="btn primary">B</button></div></body>
  const body = new FakeEl('body');
  const wrap = new FakeEl('div', { class: 'wrap col' });
  const b1 = new FakeEl('button');
  const b2 = new FakeEl('button', { id: 'go', class: 'btn primary' });
  body.append(wrap); wrap.append(b1); wrap.append(b2);
  return { body, wrap, b1, b2 };
}

describe('extension ABSelector.cssPath', () => {
  it('uses #id shortcut when the element has an id', () => {
    const { b2 } = build();
    expect(ABSelector.cssPath(b2)).toBe('#go');
  });

  it('builds a class + :nth-of-type path for id-less elements', () => {
    const { b1 } = build();
    const css = ABSelector.cssPath(b1);
    // first of two buttons under div.wrap.col
    expect(css).toContain('button:nth-of-type(1)');
    expect(css).toContain('div.wrap.col');
    expect(css).toContain(' > ');
  });

  it('returns empty string for non-elements', () => {
    expect(ABSelector.cssPath(null)).toBe('');
    expect(ABSelector.cssPath({} as unknown)).toBe('');
  });
});

describe('extension ABSelector.xPath', () => {
  it('uses //*[@id=...] when the element has an id', () => {
    const { b2 } = build();
    expect(ABSelector.xPath(b2)).toBe('//*[@id="go"]');
  });

  it('builds an indexed absolute path otherwise', () => {
    const { b1 } = build();
    const xp = ABSelector.xPath(b1);
    expect(xp.startsWith('/')).toBe(true);
    expect(xp).toContain('button[1]');
    expect(xp).toContain('div[1]');
  });
});
