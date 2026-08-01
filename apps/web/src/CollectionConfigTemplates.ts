import type {
  CollectionDraft,
  PlexContentRatingGroup,
  PlexLibraryGeneratorSubtype,
} from '@vynode/contracts';

export interface CollectionConfigTemplate {
  id: string;
  group: 'Plex value generators' | 'Curated smart collections';
  name: string;
  description: string;
  subtype: PlexLibraryGeneratorSubtype;
  titleTemplate: string;
  enabledRatingGroups?: readonly PlexContentRatingGroup[];
}

const ratingGroups: PlexContentRatingGroup[] = [
  'australia',
  'television',
  'numeric',
  'other',
];

export const collectionConfigTemplates: readonly CollectionConfigTemplate[] = [
  {
    id: 'genre-library',
    group: 'Plex value generators',
    name: 'Genre Library',
    description:
      'Create a self-updating smart collection for each selected Plex genre.',
    subtype: 'genres',
    titleTemplate: '{value} {media}',
  },
  {
    id: 'through-the-decades',
    group: 'Plex value generators',
    name: 'Through the Decades',
    description:
      'Build decade shelves such as 1980s Movies or 2010s TV Shows.',
    subtype: 'decades',
    titleTemplate: '{value} {media}',
  },
  {
    id: 'video-quality',
    group: 'Plex value generators',
    name: 'Video Quality',
    description:
      'Group titles into live resolution collections such as 4K Quality and 1080p Quality.',
    subtype: 'resolutions',
    titleTemplate: '{value} Quality',
  },
  {
    id: 'content-rating-guide',
    group: 'Plex value generators',
    name: 'Content Rating Guide',
    description:
      'Maintain collections for selected certification systems and age ratings.',
    subtype: 'content-ratings',
    titleTemplate: '{value} {media}',
  },
  {
    id: 'genre-nights',
    group: 'Curated smart collections',
    name: 'Genre Nights',
    description:
      'A friendly genre preset with collection titles such as Comedy Night.',
    subtype: 'genres',
    titleTemplate: '{value} Night',
  },
  {
    id: 'cinema-by-era',
    group: 'Curated smart collections',
    name: 'Cinema by Era',
    description:
      'A cinema-focused decade catalog with titles such as 1990s Cinema.',
    subtype: 'decades',
    titleTemplate: '{value} Cinema',
  },
  {
    id: 'family-viewing-guide',
    group: 'Curated smart collections',
    name: 'Family Viewing Guide',
    description:
      'Start a rating-based family guide using TV and numeric-age certification groups.',
    subtype: 'content-ratings',
    titleTemplate: '{value} Family Guide',
    enabledRatingGroups: ['television', 'numeric'],
  },
] as const;

export const applyCollectionConfigTemplate = (
  draft: CollectionDraft,
  templateId: string
): CollectionDraft => {
  const template = collectionConfigTemplates.find(
    (candidate) => candidate.id === templateId
  );
  if (!template) return draft;

  const mediaLabel = draft.mediaType === 'movie' ? 'Movies' : 'TV Shows';
  return {
    ...draft,
    title: template.name,
    description: template.description,
    sourceType: 'plex',
    sourceSettings: {
      subtype: template.subtype,
      maxItems: draft.sourceSettings.maxItems || 50,
      itemOrder: 'alphabetical',
      plexGenerator: {
        selectionMode: 'include',
        selectedValues: [],
        enabledRatingGroups: [
          ...(template.enabledRatingGroups ?? ratingGroups),
        ],
        titleTemplate: template.titleTemplate.replace('{media}', mediaLabel),
        cleanupMissing: true,
      },
    },
  };
};
