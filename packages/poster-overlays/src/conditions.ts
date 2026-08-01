import type {
  OverlayApplicationCondition,
  OverlayConditionRule,
} from '@vynode/contracts';

export type OverlayContextValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | readonly (string | number | boolean)[];

export type OverlayRenderContext = Readonly<
  Record<string, OverlayContextValue>
>;

export interface OverlayRuleEvaluation {
  ruleIndex: number;
  ruleOperator?: 'and' | 'or';
  field: string;
  operator: string;
  expectedValue: OverlayConditionRule['value'];
  actualValue: OverlayContextValue;
  matched: boolean;
}

export interface OverlayConditionEvaluation {
  matched: boolean;
  sectionResults: readonly {
    sectionIndex: number;
    sectionOperator?: 'and' | 'or';
    matched: boolean;
    ruleResults: readonly OverlayRuleEvaluation[];
  }[];
}

const text = (value: string): string => value.toLocaleLowerCase('en-US');

export const evaluateOverlayRule = (
  rule: OverlayConditionRule,
  context: OverlayRenderContext
): boolean => {
  const actual = context[rule.field];
  const expected = rule.value;
  if (actual === undefined || actual === null) {
    if (rule.operator === 'neq')
      return expected !== undefined && expected !== null;
    if (rule.operator === 'notContains') return true;
    if (rule.operator === 'exists') return expected === false;
    return false;
  }
  switch (rule.operator) {
    case 'eq':
    case 'neq': {
      const equal = Array.isArray(actual)
        ? typeof expected === 'string' &&
          actual.some(
            (entry) =>
              typeof entry === 'string' && text(entry) === text(expected)
          )
        : typeof actual === 'string' && typeof expected === 'string'
          ? text(actual) === text(expected)
          : actual === expected;
      return rule.operator === 'eq' ? equal : !equal;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      if (typeof actual !== 'number' || typeof expected !== 'number')
        return false;
      return rule.operator === 'gt'
        ? actual > expected
        : rule.operator === 'gte'
          ? actual >= expected
          : rule.operator === 'lt'
            ? actual < expected
            : actual <= expected;
    case 'in':
      return (
        Array.isArray(expected) &&
        expected.some((entry) =>
          typeof actual === 'string' && typeof entry === 'string'
            ? text(actual) === text(entry)
            : actual === entry
        )
      );
    case 'contains':
    case 'notContains': {
      if (typeof expected !== 'string') return false;
      const contains = Array.isArray(actual)
        ? actual.some(
            (entry) =>
              typeof entry === 'string' &&
              text(entry).includes(text(expected))
          )
        : typeof actual === 'string' &&
          text(actual).includes(text(expected));
      return rule.operator === 'contains' ? contains : !contains;
    }
    case 'regex':
      if (
        typeof actual !== 'string' ||
        typeof expected !== 'string' ||
        expected.length > 512
      )
        return false;
      try {
        return new RegExp(expected, 'i').test(actual);
      } catch {
        return false;
      }
    case 'begins':
      return (
        typeof actual === 'string' &&
        typeof expected === 'string' &&
        text(actual).startsWith(text(expected))
      );
    case 'ends':
      return (
        typeof actual === 'string' &&
        typeof expected === 'string' &&
        text(actual).endsWith(text(expected))
      );
    case 'exists':
      return typeof expected === 'boolean' ? expected : false;
  }
};

export const evaluateOverlayConditionDetailed = (
  condition: OverlayApplicationCondition | undefined,
  context: OverlayRenderContext
): OverlayConditionEvaluation => {
  if (!condition?.sections.length)
    return { matched: true, sectionResults: [] };
  const sectionResults = condition.sections.map((section, sectionIndex) => {
    const ruleResults = section.rules.map((rule, ruleIndex) => ({
      ruleIndex,
      ...(rule.ruleOperator ? { ruleOperator: rule.ruleOperator } : {}),
      field: rule.field,
      operator: rule.operator,
      expectedValue: rule.value,
      actualValue: context[rule.field],
      matched: evaluateOverlayRule(rule, context),
    }));
    let matched = ruleResults[0]?.matched ?? true;
    for (let index = 1; index < ruleResults.length; index++) {
      const current = ruleResults[index]!;
      matched =
        current.ruleOperator === 'or'
          ? matched || current.matched
          : matched && current.matched;
    }
    return {
      sectionIndex,
      ...(section.sectionOperator
        ? { sectionOperator: section.sectionOperator }
        : {}),
      matched,
      ruleResults,
    };
  });
  let matched = sectionResults[0]?.matched ?? true;
  for (let index = 1; index < sectionResults.length; index++) {
    const current = sectionResults[index]!;
    matched =
      current.sectionOperator === 'and'
        ? matched && current.matched
        : matched || current.matched;
  }
  return { matched, sectionResults };
};

export const evaluateOverlayCondition = (
  condition: OverlayApplicationCondition | undefined,
  context: OverlayRenderContext
): boolean => evaluateOverlayConditionDetailed(condition, context).matched;
