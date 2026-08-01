// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OverlayLayer } from '@vynode/contracts';

import { MappedIconPreview } from './OverlayTemplateEditor';

const iconLayer: OverlayLayer = {
  id: 'date-added',
  type: 'mapped-icon',
  layerOrder: 0,
  x: 40,
  y: 40,
  width: 260,
  height: 180,
  rotation: 0,
  name: 'Date added',
  properties: {
    field: 'dateAdded',
    systemIcon: 'calendar',
    iconColor: '#f3ad32',
    iconSize: 80,
    showValue: true,
    missingValueBehavior: 'hide',
  },
};

describe('MappedIconPreview', () => {
  it('keeps the selected icon visible while editing when the sample item lacks the value', () => {
    const { container } = render(
      <MappedIconPreview
        layer={iconLayer}
        context={{ title: 'Example movie', resolution: '1080' }}
      />
    );

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('svg path')).toHaveAttribute('d');
    expect(container).toHaveTextContent('Dynamic value');
  });
});
