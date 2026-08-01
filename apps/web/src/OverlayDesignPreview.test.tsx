// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  OverlayLayer,
  OverlayTemplateSummary,
} from '@vynode/contracts';
import { OverlayDesignPreview } from './OverlayDesignPreview';

const layer = (
  id: string,
  type: OverlayLayer['type'],
  layerOrder: number,
  properties: OverlayLayer['properties']
): OverlayLayer => ({
  id,
  type,
  layerOrder,
  x: 10,
  y: 20,
  width: 300,
  height: 120,
  rotation: 0,
  name: id,
  properties,
});

const template: OverlayTemplateSummary = {
  id: 'saved-preview',
  name: 'Saved preview',
  description: 'Every saved layer is represented.',
  type: 'generic',
  tags: [],
  enabled: true,
  displayOrder: 0,
  elementCount: 6,
  conditionSummary: 'Always',
  accent: '#f3ad32',
  design: {
    width: 1000,
    height: 1500,
    elements: [
      layer('tile', 'tile', 0, { fillColor: '#000000' }),
      layer('text', 'text', 1, { text: 'Saved text' }),
      layer('variable', 'variable', 2, {
        segments: [{ type: 'variable', field: 'resolution' }],
      }),
      layer('raster', 'raster', 3, {
        imagePath: 'asset://saved-raster',
      }),
      layer('svg', 'svg', 4, { iconPath: 'asset://saved-svg' }),
      layer('mapping', 'mapped-icon', 5, {
        field: 'audioLanguages',
        systemIcon: '',
        mappings: [
          { value: 'English', iconPath: 'asset://saved-mapping' },
        ],
      }),
    ],
  },
};

describe('OverlayDesignPreview', () => {
  it('renders every persisted saved-template layer on the main card', () => {
    const { container } = render(
      <OverlayDesignPreview
        template={template}
        context={{ ...{}, resolution: '4K', audioLanguages: ['English'] }}
      />
    );

    const renderedLayers = container.querySelectorAll('[data-layer-id]');
    expect(renderedLayers).toHaveLength(template.design.elements.length);
    expect(container).toHaveTextContent('Saved text');
    expect(container).toHaveTextContent('4K');
    expect(
      container.querySelector('[data-layer-id="raster"]')
    ).toHaveAttribute(
      'src',
      '/api/posters/collections/assets/saved-raster'
    );
    expect(container.querySelector('[data-layer-id="svg"]')).toHaveAttribute(
      'src',
      '/api/posters/collections/assets/saved-svg'
    );
    expect(
      container.querySelector('[data-layer-id="mapping"] img')
    ).toHaveAttribute(
      'src',
      '/api/posters/collections/assets/saved-mapping'
    );
  });

  it('preserves the saved stacking order explicitly', () => {
    const { container } = render(
      <OverlayDesignPreview template={template} layersOnly />
    );

    expect(
      container.querySelector<HTMLElement>('[data-layer-id="tile"]')?.style
        .zIndex
    ).toBe('1');
    expect(
      container.querySelector<HTMLElement>('[data-layer-id="mapping"]')?.style
        .zIndex
    ).toBe('6');
  });

  it('composites tile fill opacity without fading the entire saved layer', () => {
    const { container } = render(
      <OverlayDesignPreview
        template={{
          ...template,
          design: {
            ...template.design,
            elements: [
              layer('tile', 'tile', 0, {
                fillColor: '#000000',
                fillOpacity: 70,
                borderColor: '#ffffff',
                borderWidth: 8,
              }),
            ],
          },
        }}
      />
    );
    const tile = container.querySelector<HTMLElement>(
      '[data-layer-id="tile"]'
    );

    expect(tile?.style.background).toContain('70%');
    expect(tile?.style.background).toContain('transparent');
    expect(tile?.style.opacity).toBe('');
  });

  it('preserves layered concept styling in the saved preview', () => {
    const { container } = render(
      <OverlayDesignPreview
        template={{
          ...template,
          design: {
            ...template.design,
            elements: [
              layer('concept', 'icon', 0, {
                systemIcon: 'concept-placeholder',
                iconStyle: 'badge',
                iconColor: '#ffffff',
                iconSoftColor: '#224466',
                iconAccentColor: '#ff8800',
                iconBadgeColor: '#112233',
                iconBadgeOpacity: 55,
              }),
            ],
          },
        }}
      />
    );
    expect(container.querySelector('.layered-icon-badge .main')).toBeTruthy();
    expect(container.querySelector('.layered-icon-badge .soft')).toBeTruthy();
    expect(container.querySelector('.layered-icon-badge .accent')).toBeTruthy();
    expect(container.querySelector('[data-layer-id="concept"] rect')).toHaveAttribute(
      'fill',
      '#112233'
    );
  });
});
