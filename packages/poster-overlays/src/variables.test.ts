import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatOverlayDate,
  resolveMappedIcons,
  resolveVariableText,
} from './variables.js';

test('formats every legacy date token deterministically and defaults unknown formats', () => {
  assert.equal(formatOverlayDate('2026-07-04', 'YYYY-MM-DD'), '2026-07-04');
  assert.equal(formatOverlayDate('2026-07-04', 'DD/MM/YYYY'), '04/07/2026');
  assert.equal(formatOverlayDate('2026-07-04', 'DDD D/M'), 'SAT 4/7');
  assert.equal(formatOverlayDate('2026-07-04', 'DDDD'), 'SATURDAY');
  assert.equal(
    formatOverlayDate('2026-07-04', 'MMMM DD, YYYY'),
    'July 04, 2026'
  );
  assert.equal(formatOverlayDate('2026-07-04', 'unknown'), 'JUL 04');
  assert.equal(formatOverlayDate('invalid', 'MMM DD'), undefined);
});

test('resolves literal and variable segments with legacy numeric formatting', () => {
  assert.equal(
    resolveVariableText(
      [
        { type: 'text', value: 'IMDb ' },
        { type: 'variable', field: 'imdbRating' },
        { type: 'text', value: ' · RT ' },
        { type: 'variable', field: 'rtCriticsScore' },
        { type: 'text', value: '% · ' },
        {
          type: 'variable',
          field: 'releaseDate',
          format: 'DD MMM YYYY',
        },
      ],
      {
        imdbRating: 8,
        rtCriticsScore: 89.6,
        releaseDate: '2026-07-04',
      }
    ),
    'IMDb 8.0 · RT 90% · 04 JUL 2026'
  );
  assert.equal(
    resolveVariableText(
      [{ type: 'variable', field: 'missing' }],
      {}
    ),
    undefined
  );
  assert.equal(
    resolveVariableText(
      [{ type: 'variable', field: 'tags' }],
      { tags: ['one'] }
    ),
    undefined
  );
});

test('uses saved mapped icons first, falls back to current mappings, and limits output', () => {
  const resolved = resolveMappedIcons(
    ['Netflix', 'Apple TV', 'Unknown'],
    [{ value: 'Netflix', iconPath: '/saved/netflix.svg' }],
    [
      { value: 'Netflix', iconPath: '/current/netflix.svg' },
      { value: 'Apple TV', iconPath: '/current/apple.svg' },
    ],
    2
  );
  assert.deepEqual(resolved, [
    { value: 'Netflix', iconPath: '/saved/netflix.svg' },
    { value: 'Apple TV', iconPath: '/current/apple.svg' },
  ]);
});
