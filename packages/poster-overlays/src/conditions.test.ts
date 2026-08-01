import assert from 'node:assert/strict';
import test from 'node:test';

import type { OverlayApplicationCondition } from '@vynode/contracts';

import {
  evaluateOverlayCondition,
  evaluateOverlayConditionDetailed,
  evaluateOverlayRule,
} from './conditions.js';

test('matches string, array, numeric, membership, and existence operators without coercion', () => {
  const context = {
    title: 'Example Movie',
    tags: ['Featured', '4K HDR'],
    rating: 8.4,
    year: 2026,
    available: false,
    missing: undefined,
  };
  assert.equal(
    evaluateOverlayRule(
      { field: 'title', operator: 'begins', value: 'example' },
      context
    ),
    true
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'tags', operator: 'eq', value: 'featured' },
      context
    ),
    true
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'tags', operator: 'contains', value: 'hdr' },
      context
    ),
    true
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'rating', operator: 'gte', value: 8 },
      context
    ),
    true
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'year', operator: 'in', value: [2025, 2026] },
      context
    ),
    true
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'available', operator: 'exists', value: true },
      context
    ),
    true
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'missing', operator: 'exists', value: false },
      context
    ),
    true
  );
});

test('preserves legacy missing-value behavior and rejects invalid comparisons', () => {
  assert.equal(
    evaluateOverlayRule(
      { field: 'missing', operator: 'neq', value: true },
      {}
    ),
    true
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'missing', operator: 'notContains', value: 'x' },
      {}
    ),
    true
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'rating', operator: 'gt', value: '8' },
      { rating: 9 }
    ),
    false
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'title', operator: 'regex', value: '[' },
      { title: 'Example' }
    ),
    false
  );
  assert.equal(
    evaluateOverlayRule(
      { field: 'title', operator: 'regex', value: 'x'.repeat(513) },
      { title: 'Example' }
    ),
    false
  );
});

test('combines rules and sections in stored order and returns exact diagnostics', () => {
  const condition: OverlayApplicationCondition = {
    sections: [
      {
        rules: [
          { field: 'resolution', operator: 'eq', value: '4K' },
          {
            ruleOperator: 'and',
            field: 'hdr',
            operator: 'eq',
            value: true,
          },
        ],
      },
      {
        sectionOperator: 'or',
        rules: [{ field: 'rating', operator: 'gte', value: 8 }],
      },
      {
        sectionOperator: 'and',
        rules: [{ field: 'blocked', operator: 'neq', value: true }],
      },
    ],
  };
  const result = evaluateOverlayConditionDetailed(condition, {
    resolution: '1080p',
    hdr: false,
    rating: 8.5,
  });
  assert.equal(result.matched, true);
  assert.deepEqual(
    result.sectionResults.map(({ matched }) => matched),
    [false, true, true]
  );
  assert.equal(
    result.sectionResults[0]?.ruleResults[0]?.actualValue,
    '1080p'
  );
  assert.equal(evaluateOverlayCondition(undefined, {}), true);
  assert.equal(
    evaluateOverlayCondition({ sections: [{ rules: [] }] }, {}),
    true
  );
});
