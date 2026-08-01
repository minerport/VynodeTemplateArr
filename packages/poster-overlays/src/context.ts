import type { OverlayTemplateSummary } from '@vynode/contracts';

import type { OverlayRenderContext, OverlayContextValue } from './conditions.js';

export interface PlexOverlayMedia {
  ratingKey: string;
  title: string;
  year?: number;
  mediaType: 'movie' | 'show';
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
  durationMs?: number;
  userRating?: number;
  imdbRating?: number;
  rtCriticsScore?: number;
  rtAudienceScore?: number;
  rtCertifiedFresh?: boolean;
  rtVerifiedHot?: boolean;
  imdbVotes?: number;
  imdbContentRating?: string;
  imdbGenres?: readonly string[];
  imdbKeywords?: readonly string[];
  imdbActors?: readonly string[];
  imdbDirectors?: readonly string[];
  imdbCreators?: readonly string[];
  imdbPlot?: string;
  imdbAlternateTitle?: string;
  imdbReleaseDate?: string;
  imdbRuntime?: number;
  releaseDate?: string;
  studio?: string;
  directors?: readonly string[];
  genres?: readonly string[];
  networks?: readonly string[];
  streamingProvider?: string;
  streamingProviderId?: number;
  labels?: readonly string[];
  collections?: readonly string[];
  addedAt?: string;
  lastViewedAt?: string;
  viewCount?: number;
  media?: readonly {
    width?: number;
    height?: number;
    aspectRatio?: number;
    resolution?: string;
    videoCodec?: string;
    videoProfile?: string;
    frameRate?: string;
    bitDepth?: number;
    hdr?: boolean;
    dolbyVision?: boolean;
    dolbyVisionProfile?: number;
    colorTrc?: string;
    audioCodec?: string;
    audioChannels?: number;
    audioChannelLayout?: string;
    audioFormat?: string;
    audioLanguages?: readonly { code?: string; name?: string }[];
    subtitleLanguages?: readonly { code?: string; name?: string }[];
    container?: string;
    bitrateKbps?: number;
    fileSize?: number;
    filePath?: string;
  }[];
}

export interface OverlayContextProvider {
  readonly name: string;
  readonly fields: ReadonlySet<string>;
  load(
    item: PlexOverlayMedia,
    fields: ReadonlySet<string>,
    signal?: AbortSignal
  ): Promise<Readonly<Record<string, OverlayContextValue>>>;
  critical?: boolean;
}

export interface OverlayContextBuildResult {
  context: OverlayRenderContext;
  requiredFields: readonly string[];
  warnings: readonly { provider: string; message: string }[];
  criticalProviderFailed: boolean;
}

const hasContextValue = (value: OverlayContextValue): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const date = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
};

const daysBetween = (from: Date, to: Date): number =>
  Math.floor((to.valueOf() - from.valueOf()) / 86_400_000);

const runtimeText = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours}h` : '', remainder ? `${remainder}m` : '']
    .filter(Boolean)
    .join(' ');
};

const originServices = [
  {name:'Netflix',id:8,aliases:['netflix']},
  {name:'Prime Video',id:9,aliases:['prime video','amazon prime','amazon studios','amazon original','amazon content services','amazon mgm studios']},
  {name:'Disney+',id:337,aliases:['disney+','disney plus','disney original']},
  {name:'Hulu',id:15,aliases:['hulu','hulu originals']},
  {name:'Max',id:1899,aliases:['max original','hbo max','hbo films','hbo original']},
  {name:'Apple TV+',id:350,aliases:['apple tv+','apple tv plus','apple original','apple studios']},
  {name:'Paramount+',id:531,aliases:['paramount+','paramount plus','cbs all access']},
  {name:'Peacock',id:386,aliases:['peacock','peacock original','universal content productions']},
  {name:'YouTube',id:192,aliases:['youtube original','youtube']},
  {name:'Tubi',id:73,aliases:['tubi']},
  {name:'The Roku Channel',id:207,aliases:['roku channel','roku original']},
  {name:'Crunchyroll',id:283,aliases:['crunchyroll']},
  {name:'MUBI',id:11,aliases:['mubi']},
  {name:'Plex',id:538,aliases:['plex original','plex']},
] as const;

export const identifyStreamingProvider=(item:Pick<PlexOverlayMedia,'streamingProvider'|'streamingProviderId'|'networks'|'studio'|'labels'|'collections'|'media'>):{name:string;id?:number}|undefined=>{
  if(item.streamingProvider)return{name:item.streamingProvider,...(item.streamingProviderId!==undefined?{id:item.streamingProviderId}:{})};
  const sources=[...(item.networks??[]),item.studio??'',...(item.labels??[]),...(item.collections??[]),...(item.media??[]).map((entry)=>entry.filePath??'')].map((value)=>value.toLocaleLowerCase('en-US'));
  const matched=originServices.find((service)=>service.aliases.some((alias)=>sources.some((source)=>source.includes(alias))));
  return matched?{name:matched.name,id:matched.id}:undefined;
};

const chooseBestMedia = (
  media: PlexOverlayMedia['media']
): NonNullable<PlexOverlayMedia['media']>[number] | undefined =>
  [...(media ?? [])].sort(
    (left, right) =>
      (right.width ?? 0) * (right.height ?? 0) -
      (left.width ?? 0) * (left.height ?? 0)
  )[0];

export const collectRequiredContextFields = (
  templates: readonly OverlayTemplateSummary[]
): ReadonlySet<string> => {
  const fields = new Set<string>(['title', 'year', 'mediaType', 'isPlaceholder']);
  for (const template of templates) {
    if (!template.enabled) continue;
    for (const section of template.condition?.sections ?? []) {
      for (const rule of section.rules) fields.add(rule.field);
    }
    for (const layer of template.design?.elements ?? []) {
      const directField = layer.properties.field;
      if (typeof directField === 'string' && directField) fields.add(directField);
      const segments = layer.properties.segments;
      if (!Array.isArray(segments)) continue;
      for (const segment of segments) {
        if (
          typeof segment === 'object' &&
          segment !== null &&
          'type' in segment &&
          segment.type === 'variable' &&
          'field' in segment &&
          typeof segment.field === 'string'
        ) {
          fields.add(segment.field);
        }
      }
    }
  }
  return fields;
};

export class OverlayContextBuilder {
  public constructor(
    private readonly providers: readonly OverlayContextProvider[] = [],
    private readonly now: () => Date = () => new Date()
  ) {}

  public async build(
    item: PlexOverlayMedia,
    templates: readonly OverlayTemplateSummary[],
    options: { isPlaceholder?: boolean; signal?: AbortSignal } = {}
  ): Promise<OverlayContextBuildResult> {
    options.signal?.throwIfAborted();
    const required = collectRequiredContextFields(templates);
    const current = this.now();
    const media = chooseBestMedia(item.media);
    const addedAt = date(item.addedAt);
    const lastPlayed = date(item.lastViewedAt);
    const runtime = item.durationMs
      ? Math.max(1, Math.round(item.durationMs / 60_000))
      : undefined;
    const audio = media?.audioLanguages ?? [];
    const subtitles = media?.subtitleLanguages ?? [];
    const streamingProvider=identifyStreamingProvider(item);
    const episodeMedia = item.mediaType === 'show' ? (item.media ?? []) : [];
    const episodeCount = episodeMedia.length;
    const episode4kCount = episodeMedia.filter((entry) => (entry.width ?? 0) >= 3840 || /2160|4k/i.test(entry.resolution ?? '')).length;
    const episodeHdrCount = episodeMedia.filter((entry) => entry.hdr).length;
    const episodeDvCount = episodeMedia.filter((entry) => entry.dolbyVision).length;

    const context: Record<string, OverlayContextValue> = {
      title: item.title,
      year: item.year,
      mediaType: item.mediaType,
      isPlaceholder: options.isPlaceholder ?? false,
      runtime,
      runtimeHHMM: runtime === undefined ? undefined : runtimeText(runtime),
      plexUserRating: item.userRating,
      imdbRating: item.imdbRating,
      imdbVotes: item.imdbVotes,
      imdbContentRating: item.imdbContentRating,
      imdbGenres: item.imdbGenres,
      imdbKeywords: item.imdbKeywords,
      imdbActors: item.imdbActors,
      imdbDirectors: item.imdbDirectors,
      imdbCreators: item.imdbCreators,
      imdbPlot: item.imdbPlot,
      imdbAlternateTitle: item.imdbAlternateTitle,
      imdbReleaseDate: date(item.imdbReleaseDate),
      imdbRuntime: item.imdbRuntime,
      rtCriticsScore: item.rtCriticsScore,
      rtAudienceScore: item.rtAudienceScore,
      rtCertifiedFresh: item.rtCertifiedFresh,
      rtVerifiedHot: item.rtVerifiedHot,
      studio: item.studio,
      director: item.directors?.[0],
      genre: item.genres?.[0],
      network: item.networks?.[0],
      streamingProvider: streamingProvider?.name,
      streamingProviderId: streamingProvider?.id,
      plexLabels: item.labels,
      collection: item.collections,
      viewCount: item.viewCount,
      dateAdded: addedAt,
      lastPlayed,
      daysSinceAdded: addedAt ? Math.max(0, daysBetween(addedAt, current)) : undefined,
      daysSinceLastPlayed: lastPlayed
        ? Math.max(0, daysBetween(lastPlayed, current))
        : undefined,
      releaseDate: date(item.releaseDate),
      daysUntilRelease: item.releaseDate
        ? daysBetween(current, date(item.releaseDate) ?? current)
        : undefined,
      daysAgo: item.releaseDate
        ? daysBetween(date(item.releaseDate) ?? current, current)
        : undefined,
      resolution: media?.resolution,
      width: media?.width,
      height: media?.height,
      aspectRatio: media?.aspectRatio,
      videoCodec: media?.videoCodec,
      videoProfile: media?.videoProfile,
      videoFrameRate: media?.frameRate,
      bitDepth: media?.bitDepth,
      hdr: media?.hdr,
      dolbyVision: media?.dolbyVision,
      dolbyVisionProfile: media?.dolbyVisionProfile,
      colorTrc: media?.colorTrc,
      audioCodec: media?.audioCodec,
      audioChannels: media?.audioChannels,
      audioChannelLayout: media?.audioChannelLayout,
      audioFormat: media?.audioFormat,
      audioLanguage: audio[0]?.name,
      audioLanguageCode: audio[0]?.code,
      audioLanguages: audio.map((entry) => entry.name).filter(Boolean) as string[],
      audioLanguageCodes: audio
        .map((entry) => entry.code)
        .filter(Boolean) as string[],
      subtitleLanguages: subtitles
        .map((entry) => entry.name)
        .filter(Boolean) as string[],
      subtitleLanguageCodes: subtitles
        .map((entry) => entry.code)
        .filter(Boolean) as string[],
      hasSubtitles: subtitles.length > 0,
      container: media?.container,
      bitrate: media?.bitrateKbps,
      fileSize: media?.fileSize,
      filePath: media?.filePath,
      episodeCount: episodeCount || undefined,
      episode4kCount: episodeCount ? episode4kCount : undefined,
      episode4kPercent: episodeCount ? Math.round((episode4kCount / episodeCount) * 100) : undefined,
      episodeHdrCount: episodeCount ? episodeHdrCount : undefined,
      episodeHdrPercent: episodeCount ? Math.round((episodeHdrCount / episodeCount) * 100) : undefined,
      episodeDvCount: episodeCount ? episodeDvCount : undefined,
      episodeDvPercent: episodeCount ? Math.round((episodeDvCount / episodeCount) * 100) : undefined,
      showHdr: episodeCount ? episodeHdrCount > 0 : undefined,
      showDolbyVision: episodeCount ? episodeDvCount > 0 : undefined,
      episodeMediaSource: episodeCount ? 'Plex episode files' : undefined,
    };

    const warnings: { provider: string; message: string }[] = [];
    let criticalProviderFailed = false;
    const providerResults = await Promise.all(
      this.providers.map(async (provider) => {
        const requested = new Set(
          [...required].filter(
            (field) =>
              provider.fields.has(field) && !hasContextValue(context[field])
          )
        );
        if (requested.size === 0) return undefined;
        try {
          return await provider.load(item, requested, options.signal);
        } catch (error) {
          if (options.signal?.aborted) throw error;
          warnings.push({
            provider: provider.name,
            message: error instanceof Error ? error.message : String(error),
          });
          criticalProviderFailed ||= provider.critical === true;
          return undefined;
        }
      })
    );
    for (const result of providerResults) {
      if (!result) continue;
      for (const [field, value] of Object.entries(result)) {
        if (!hasContextValue(context[field]) && hasContextValue(value)) {
          context[field] = value;
        }
      }
    }
    options.signal?.throwIfAborted();

    return {
      context,
      requiredFields: [...required].sort(),
      warnings,
      criticalProviderFailed,
    };
  }
}
