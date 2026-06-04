import { describe, it, expect, vi } from 'vitest';
import { ConditionEngine, type Condition } from '../../src/core/ConditionEngine';
import type { Page } from 'playwright';

// A minimal fake Page. The non-DOM operators tested below never touch the page
// (no selector is supplied), so a stub is enough; DOM operators are exercised
// separately with a controllable locator.
function makeEngine(vars: Record<string, unknown> = {}, page?: Partial<Page>) {
  const map = new Map<string, unknown>(Object.entries(vars));
  const fakePage = (page ?? {}) as unknown as Page;
  return new ConditionEngine(fakePage, map as Map<string, never>);
}

describe('ConditionEngine — value operators (no selector)', () => {
  const eng = makeEngine();
  it('equals / not_equals', async () => {
    expect(await eng.evaluate({ operator: 'equals', value: 'abc', expected: 'abc' })).toBe(true);
    expect(await eng.evaluate({ operator: 'equals', value: 'abc', expected: 'xyz' })).toBe(false);
    expect(await eng.evaluate({ operator: 'not_equals', value: 'a', expected: 'b' })).toBe(true);
  });
  it('contains / not_contains / starts_with / ends_with', async () => {
    expect(await eng.evaluate({ operator: 'contains', value: 'hello world', expected: 'world' })).toBe(true);
    expect(await eng.evaluate({ operator: 'not_contains', value: 'hello', expected: 'zzz' })).toBe(true);
    expect(await eng.evaluate({ operator: 'starts_with', value: 'foobar', expected: 'foo' })).toBe(true);
    expect(await eng.evaluate({ operator: 'ends_with', value: 'foobar', expected: 'bar' })).toBe(true);
  });
  it('is_empty / not_empty (trims first)', async () => {
    expect(await eng.evaluate({ operator: 'is_empty', value: '' })).toBe(true);
    expect(await eng.evaluate({ operator: 'is_empty', value: '   ' })).toBe(true);
    expect(await eng.evaluate({ operator: 'not_empty', value: 'x' })).toBe(true);
  });
  it('numeric comparisons (with currency stripping)', async () => {
    expect(await eng.evaluate({ operator: 'greater_than', value: '10', expected: '5' })).toBe(true);
    expect(await eng.evaluate({ operator: 'less_than', value: '3', expected: '5' })).toBe(true);
    expect(await eng.evaluate({ operator: 'greater_equal', value: '5', expected: '5' })).toBe(true);
    expect(await eng.evaluate({ operator: 'less_equal', value: '4', expected: '5' })).toBe(true);
    expect(await eng.evaluate({ operator: 'greater_than', value: '$1,234', expected: '1000' })).toBe(true);
  });
  it('boolean checks', async () => {
    expect(await eng.evaluate({ operator: 'is_true', value: true })).toBe(true);
    expect(await eng.evaluate({ operator: 'is_true', value: 'true' })).toBe(true);
    expect(await eng.evaluate({ operator: 'is_false', value: false })).toBe(true);
    expect(await eng.evaluate({ operator: 'is_false', value: 'false' })).toBe(true);
  });
  it('list membership', async () => {
    expect(await eng.evaluate({ operator: 'in_list', value: 'b', expected: ['a', 'b', 'c'] })).toBe(true);
    expect(await eng.evaluate({ operator: 'not_in_list', value: 'z', expected: ['a', 'b'] })).toBe(true);
    expect(await eng.evaluate({ operator: 'in_list', value: 'x', expected: 'not-an-array' })).toBe(false);
  });
  it('matches_regex (safe) and blocks unsafe ReDoS patterns', async () => {
    expect(await eng.evaluate({ operator: 'matches_regex', value: 'abc123', expected: '\\d+' })).toBe(true);
    // (a+)+$ is flagged unsafe by safe-regex2 -> blocked -> false
    expect(await eng.evaluate({ operator: 'matches_regex', value: 'aaaa', expected: '(a+)+$' })).toBe(false);
  });
  it('unknown operator returns false', async () => {
    expect(await eng.evaluate({ operator: 'bogus' as never, value: 'x' })).toBe(false);
  });
});

describe('ConditionEngine — composites', () => {
  const eng = makeEngine();
  it('all (AND)', async () => {
    const pass: Condition = { all: [
      { operator: 'equals', value: 'a', expected: 'a' },
      { operator: 'contains', value: 'abc', expected: 'b' },
    ] };
    expect(await eng.evaluate(pass)).toBe(true);
    const fail: Condition = { all: [
      { operator: 'equals', value: 'a', expected: 'a' },
      { operator: 'equals', value: 'a', expected: 'b' },
    ] };
    expect(await eng.evaluate(fail)).toBe(false);
  });
  it('any (OR)', async () => {
    const c: Condition = { any: [
      { operator: 'equals', value: 'a', expected: 'b' },
      { operator: 'equals', value: 'a', expected: 'a' },
    ] };
    expect(await eng.evaluate(c)).toBe(true);
    expect(await eng.evaluate({ any: [{ operator: 'equals', value: '1', expected: '2' }] })).toBe(false);
  });
  it('not', async () => {
    expect(await eng.evaluate({ not: { operator: 'equals', value: 'a', expected: 'b' } })).toBe(true);
    expect(await eng.evaluate({ not: { operator: 'equals', value: 'a', expected: 'a' } })).toBe(false);
  });
  it('nested composites', async () => {
    const c: Condition = { all: [
      { any: [ { operator: 'equals', value: '1', expected: '2' }, { operator: 'equals', value: '1', expected: '1' } ] },
      { not: { operator: 'is_empty', value: 'x' } },
    ] };
    expect(await eng.evaluate(c)).toBe(true);
  });
});

describe('ConditionEngine — resolveVariables', () => {
  const eng = makeEngine({ name: 'Ada', count: 7 });
  it('substitutes {{var}} tokens from the variable map', () => {
    expect(eng.resolveVariables('Hello {{name}}!')).toBe('Hello Ada!');
    expect(eng.resolveVariables('n={{count}}')).toBe('n=7');
  });
  it('replaces unknown tokens with empty string', () => {
    expect(eng.resolveVariables('x={{missing}}')).toBe('x=');
  });
  it('returns non-strings unchanged', () => {
    expect(eng.resolveVariables(42 as never)).toBe(42);
    const arr = [1, 2, 3];
    expect(eng.resolveVariables(arr as never)).toBe(arr);
  });
  it('resolves variables inside an equals comparison', async () => {
    expect(await eng.evaluate({ operator: 'equals', value: '{{name}}', expected: 'Ada' })).toBe(true);
  });
});

describe('ConditionEngine — DOM operators (controllable locator)', () => {
  function pageWith(count: number, visible = true): Partial<Page> {
    const locator = {
      first() { return this; },
      count: vi.fn(async () => count),
      isVisible: vi.fn(async () => visible),
      innerText: vi.fn(async () => ''),
      inputValue: vi.fn(async () => ''),
    };
    return { locator: vi.fn(() => locator) } as unknown as Partial<Page>;
  }
  it('exists / not_exists based on element count', async () => {
    const present = makeEngine({}, pageWith(1));
    const absent = makeEngine({}, pageWith(0));
    expect(await present.evaluate({ operator: 'exists', selector: '#a' })).toBe(true);
    expect(await absent.evaluate({ operator: 'exists', selector: '#a' })).toBe(false);
    expect(await absent.evaluate({ operator: 'not_exists', selector: '#a' })).toBe(true);
  });
  it('visible / hidden', async () => {
    const shown = makeEngine({}, pageWith(1, true));
    const hiddenEl = makeEngine({}, pageWith(1, false));
    expect(await shown.evaluate({ operator: 'visible', selector: '#a' })).toBe(true);
    expect(await hiddenEl.evaluate({ operator: 'hidden', selector: '#a' })).toBe(true);
  });
  it('DOM operator without selector returns false', async () => {
    const eng = makeEngine({}, pageWith(1));
    expect(await eng.evaluate({ operator: 'exists' })).toBe(false);
  });
});
