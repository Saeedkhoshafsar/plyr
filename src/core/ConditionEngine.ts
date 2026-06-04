import type { Page } from 'playwright';
import { config } from '../config';

// Try to load safe-regex2, fallback to always true
let isSafeRegex: (pattern: string) => boolean;
try {
  isSafeRegex = require('safe-regex2');
} catch {
  isSafeRegex = () => true;
}

// === TYPES ===

export type ConditionOperator =
  | 'exists' | 'not_exists' | 'visible' | 'hidden'
  | 'equals' | 'not_equals' | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with' | 'matches_regex'
  | 'greater_than' | 'less_than' | 'greater_equal' | 'less_equal'
  | 'is_empty' | 'not_empty'
  | 'is_true' | 'is_false'
  | 'in_list' | 'not_in_list'
  | 'random';

export interface SimpleCondition {
  operator: ConditionOperator;
  value?: any;
  expected?: any;
  selector?: string;
}

export interface CompositeCondition {
  all?: (SimpleCondition | CompositeCondition)[];
  any?: (SimpleCondition | CompositeCondition)[];
  not?: SimpleCondition | CompositeCondition;
}

export type Condition = SimpleCondition | CompositeCondition;

// === CONDITION ENGINE ===

export class ConditionEngine {
  private page: Page;
  private variables: Map<string, any>;

  constructor(page: Page, variables: Map<string, any>) {
    this.page = page;
    this.variables = variables;
  }

  async evaluate(condition: Condition): Promise<boolean> {
    // Composite: ALL (AND)
    if ('all' in condition && Array.isArray(condition.all)) {
      for (const c of condition.all) {
        if (!(await this.evaluate(c))) {
          return false;
        }
      }
      return true;
    }

    // Composite: ANY (OR)
    if ('any' in condition && Array.isArray(condition.any)) {
      for (const c of condition.any) {
        if (await this.evaluate(c)) {
          return true;
        }
      }
      return false;
    }

    // Composite: NOT
    if ('not' in condition && condition.not) {
      return !(await this.evaluate(condition.not));
    }

    // Simple condition
    if ('operator' in condition) {
      return this.evaluateSimple(condition as SimpleCondition);
    }

    return false;
  }

  private async evaluateSimple(cond: SimpleCondition): Promise<boolean> {
    const { operator, value, expected, selector } = cond;

    // Resolve variables
    const resolvedValue = this.resolveVariables(value);
    const resolvedExpected = this.resolveVariables(expected);

    // DOM-based conditions
    if (['exists', 'not_exists', 'visible', 'hidden'].includes(operator)) {
      if (!selector) return false;

      try {
        const locator = this.page.locator(selector).first();
        const count = await locator.count();

        switch (operator) {
          case 'exists':
            return count > 0;
          case 'not_exists':
            return count === 0;
          case 'visible':
            return count > 0 && await locator.isVisible();
          case 'hidden':
            return count === 0 || !(await locator.isVisible());
          default:
            return false;
        }
      } catch {
        return operator === 'not_exists' || operator === 'hidden';
      }
    }

    // Get actual value (from selector or direct)
    let actualValue = resolvedValue;

    if (selector) {
      try {
        const locator = this.page.locator(selector).first();
        if (await locator.count() > 0) {
          // Try innerText first, then inputValue
          actualValue = await locator.innerText().catch(() => null);
          if (actualValue === null || actualValue === '') {
            actualValue = await locator.inputValue().catch(() => '');
          }
        }
      } catch {
        actualValue = '';
      }
    }

    // Convert to strings for comparison
    const strActual = String(actualValue ?? '').trim();
    const strExpected = String(resolvedExpected ?? '').trim();

    // Convert to numbers for numeric comparisons
    const numActual = parseFloat(strActual.replace(/[^0-9.-]/g, '')) || 0;
    const numExpected = parseFloat(strExpected.replace(/[^0-9.-]/g, '')) || 0;

    switch (operator) {
      // String comparisons
      case 'equals':
        return strActual === strExpected;
      case 'not_equals':
        return strActual !== strExpected;
      case 'contains':
        return strActual.includes(strExpected);
      case 'not_contains':
        return !strActual.includes(strExpected);
      case 'starts_with':
        return strActual.startsWith(strExpected);
      case 'ends_with':
        return strActual.endsWith(strExpected);

      // Empty checks
      case 'is_empty':
        return strActual.length === 0;
      case 'not_empty':
        return strActual.length > 0;

      // Numeric comparisons
      case 'greater_than':
        return numActual > numExpected;
      case 'less_than':
        return numActual < numExpected;
      case 'greater_equal':
        return numActual >= numExpected;
      case 'less_equal':
        return numActual <= numExpected;

      // Boolean checks
      case 'is_true':
        return actualValue === true || strActual.toLowerCase() === 'true';
      case 'is_false':
        return actualValue === false || strActual.toLowerCase() === 'false';

      // List checks
      case 'in_list':
        return Array.isArray(resolvedExpected) && resolvedExpected.includes(actualValue);
      case 'not_in_list':
        return Array.isArray(resolvedExpected) && !resolvedExpected.includes(actualValue);

      // Random (for A/B testing)
      case 'random':
        return Math.random() * 100 < numExpected;

      // Regex
      case 'matches_regex':
        return this.safeRegexTest(strExpected, strActual);

      default:
        return false;
    }
  }

  private safeRegexTest(pattern: string, input: string): boolean {
    try {
      // Length check
      if (pattern.length > config.MAX_REGEX_LENGTH) {
        console.warn(`[SECURITY] Regex too long: ${pattern.length} chars (max: ${config.MAX_REGEX_LENGTH})`);
        return false;
      }

      // Safety check (ReDoS prevention)
      if (!isSafeRegex(pattern)) {
        console.warn(`[SECURITY] Potentially unsafe regex blocked: ${pattern}`);
        return false;
      }

      const regex = new RegExp(pattern, 'i');

      // Limit input length for regex testing
      const testInput = input.length > 10000 ? input.substring(0, 10000) : input;

      return regex.test(testInput);
    } catch (e) {
      console.warn(`[REGEX] Invalid pattern: ${pattern}`);
      return false;
    }
  }

  public resolveVariables(text: any): any {
    if (typeof text !== 'string') {
      return text;
    }

    return text.replace(/\{\{(.+?)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();
      const val = this.variables.get(trimmedKey);
      return val !== undefined ? String(val) : '';
    });
  }
}