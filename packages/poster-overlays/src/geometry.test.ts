import assert from 'node:assert/strict';
import test from 'node:test';

import type { OverlayTemplateDesign } from '@vynode/contracts';

import { planOverlayGeometry } from './geometry.js';

const design: OverlayTemplateDesign = {
  width: 1000,
  height: 1500,
  elements: [
    {
      id: 'top',
      layerOrder: 2,
      type: 'text',
      x: 100,
      y: 100,
      width: 400,
      height: 100,
      rotation: 0,
      name: 'Top',
      properties: {},
    },
    {
      id: 'bottom',
      layerOrder: 1,
      type: 'tile',
      x: -100,
      y: 1400,
      width: 1200,
      height: 200,
      rotation: 5,
      name: 'Bottom',
      properties: {},
    },
  ],
};

test('uses uniform centered scaling and stable layer order', () => {
  const plan = planOverlayGeometry(design, 500, 750);
  assert.deepEqual(
    plan.map(({ elementId }) => elementId),
    ['bottom', 'top']
  );
  assert.deepEqual(plan[1], {
    elementId: 'top',
    layerOrder: 2,
    left: 50,
    top: 50,
    width: 200,
    height: 50,
    rotation: 0,
    clipped: false,
  });
  assert.deepEqual(plan[0], {
    elementId: 'bottom',
    layerOrder: 1,
    left: 0,
    top: 700,
    width: 500,
    height: 50,
    rotation: 5,
    clipped: true,
  });
});

test('centers the design without stretching on non-standard poster ratios', () => {
  const plan = planOverlayGeometry(
    { ...design, elements: [design.elements[0]!] },
    800,
    800
  );
  assert.deepEqual(plan[0], {
    elementId: 'top',
    layerOrder: 2,
    left: 187,
    top: 53,
    width: 213,
    height: 53,
    rotation: 0,
    clipped: false,
  });
});

test('rejects invalid poster dimensions', () => {
  assert.throws(() => planOverlayGeometry(design, 0, 750), /positive whole/);
  assert.throws(() => planOverlayGeometry(design, 500.5, 750), /positive whole/);
});
