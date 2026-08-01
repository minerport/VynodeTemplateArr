import type {
  OverlayApplicationCondition,
  OverlayTemplateSummary,
} from '@vynode/contracts';

export type PosterPreviewMediaType = 'movie' | 'show';

export type PosterPreviewSample = {
  title: string;
  imageUrl: string;
};

const tmdbPoster = (path: string) =>
  `https://image.tmdb.org/t/p/w500${path}`;

export const posterPreviewSamples: Record<
  PosterPreviewMediaType,
  readonly PosterPreviewSample[]
> = {
  movie: [
    { title: 'Dune: Part Two', imageUrl: tmdbPoster('/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg') },
    { title: 'Oppenheimer', imageUrl: tmdbPoster('/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg') },
    { title: 'Spider-Man: Across the Spider-Verse', imageUrl: tmdbPoster('/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg') },
    { title: 'Barbie', imageUrl: tmdbPoster('/iuFNMS8U5cb6xfzi51Dbkovj7vM.jpg') },
    { title: 'The Batman', imageUrl: tmdbPoster('/74xTEgt7R36Fpooo50r9T25onhq.jpg') },
    { title: 'Everything Everywhere All at Once', imageUrl: tmdbPoster('/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg') },
  ],
  show: [
    { title: 'The Last of Us', imageUrl: tmdbPoster('/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg') },
    { title: 'Andor', imageUrl: tmdbPoster('/59SVNwLfoMnZPPB6ukW6dlPxAdI.jpg') },
    { title: 'Fallout', imageUrl: tmdbPoster('/AnsSKR9LuK0T9bAOcPVA3PUvyWj.jpg') },
    { title: 'Shōgun', imageUrl: tmdbPoster('/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg') },
    { title: 'House of the Dragon', imageUrl: tmdbPoster('/z2yahl2uefxDCl0nogcRBstwruJ.jpg') },
    { title: 'Severance', imageUrl: tmdbPoster('/lFf6LLrQjYldcZItzOkGmMMigP7.jpg') },
  ],
};

export const posterPreviewSample = (
  mediaType: PosterPreviewMediaType,
  index: number
) => {
  const samples = posterPreviewSamples[mediaType];
  return samples[((index % samples.length) + samples.length) % samples.length]!;
};

const conditionTargetsShows = (
  condition?: OverlayApplicationCondition
) =>
  condition?.sections.some((section) =>
    section.rules.some(
      (rule) =>
        rule.field === 'mediaType' &&
        ['eq', 'in'].includes(rule.operator) &&
        String(rule.value).toLowerCase().includes('show')
    )
  ) ?? false;

export const templatePreviewMediaType = (
  template: Pick<OverlayTemplateSummary, 'condition' | 'tags' | 'type'>
): PosterPreviewMediaType => {
  const labels = [...template.tags, template.type].join(' ').toLowerCase();
  return conditionTargetsShows(template.condition) ||
    /\b(tv|show|series|season|episode)\b/.test(labels)
    ? 'show'
    : 'movie';
};
