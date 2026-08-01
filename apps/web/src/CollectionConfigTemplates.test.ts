import { describe, expect, it } from 'vitest';

import type { CollectionDraft } from '@vynode/contracts';
import {
  applyCollectionConfigTemplate,
  collectionConfigTemplates,
} from './CollectionConfigTemplates';

const draft = {
  title: '',
  description: '',
  mediaType: 'movie',
  libraryId: '1',
  sourceType: 'manual',
  sourceSettings: { subtype: '', maxItems: 50, itemOrder: 'default' },
  posterSettings: {},
  behaviorSettings: {},
  missingMediaSettings: {},
  multiSourceSettings: {},
  metadataSettings: {},
  tmdbDiscoverSettings: {},
} as CollectionDraft;

describe('collection configuration templates', () => {
  it('includes every Plex library value generator', () => {
    expect(
      collectionConfigTemplates
        .filter((template) => template.group === 'Plex value generators')
        .map((template) => template.subtype)
    ).toEqual(['genres', 'decades', 'resolutions', 'content-ratings']);
  });

  it('applies an editable movie genre generator without changing its library', () => {
    const applied = applyCollectionConfigTemplate(draft, 'genre-library');

    expect(applied.libraryId).toBe('1');
    expect(applied.sourceType).toBe('plex');
    expect(applied.sourceSettings.subtype).toBe('genres');
    expect(applied.sourceSettings.plexGenerator).toMatchObject({
      selectionMode: 'include',
      selectedValues: [],
      titleTemplate: '{value} Movies',
      cleanupMissing: true,
    });
  });

  it('adapts titles to TV and configures a curated rating guide', () => {
    const tv = applyCollectionConfigTemplate(
      { ...draft, mediaType: 'show' },
      'through-the-decades'
    );
    expect(tv.sourceSettings.plexGenerator?.titleTemplate).toBe(
      '{value} TV Shows'
    );

    const family = applyCollectionConfigTemplate(
      draft,
      'family-viewing-guide'
    );
    expect(family.sourceSettings).toMatchObject({
      subtype: 'content-ratings',
      plexGenerator: {
        enabledRatingGroups: ['television', 'numeric'],
        titleTemplate: '{value} Family Guide',
      },
    });
  });
});
