import { createHash } from 'node:crypto';

import type {
  CollectionPosterSettings,
  PlexDiscoveredItem,
} from '@vynode/contracts';

import type {
  CollectionPosterRenderInputProvider,
  CollectionPosterRenderInputs,
} from './collection-poster-assets.js';
import { PlexHttpTransport } from './plex-http.js';

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null
    ? (value as JsonRecord)
    : undefined;

const records = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : record(value)
      ? [record(value)!]
      : [];

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface PlexCollectionPosterInputOptions {
  transport: Pick<PlexHttpTransport, 'query' | 'queryBinary'>;
  maximumItemPosters?: number;
  sourceType?(item: PlexDiscoveredItem): Promise<string | undefined>;
  personPoster?(
    item: PlexDiscoveredItem,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined>;
  tmdbFranchisePoster?(
    item: PlexDiscoveredItem,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined>;
  uploadedPoster?(
    id: string,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined>;
}

interface PlexCollectionMember {
  ratingKey: string;
  thumb?: string;
  parentThumb?: string;
  updatedAt?: string;
}

const parseMembers = (value: unknown): readonly PlexCollectionMember[] => {
  const mediaContainer = record(record(value)?.MediaContainer);
  return records(mediaContainer?.Metadata)
    .map((member) => {
      const ratingKey = text(member.ratingKey);
      if (!ratingKey) return undefined;
      const thumb = text(member.thumb);
      const parentThumb = text(member.parentThumb);
      const updatedAt = text(member.updatedAt);
      return {
        ratingKey,
        ...(thumb ? { thumb } : {}),
        ...(parentThumb ? { parentThumb } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      };
    })
    .filter(
      (member): member is PlexCollectionMember => member !== undefined
    );
};

export class PlexCollectionPosterInputProvider
  implements CollectionPosterRenderInputProvider
{
  private readonly maximumItemPosters: number;

  public constructor(private readonly options: PlexCollectionPosterInputOptions) {
    this.maximumItemPosters = options.maximumItemPosters ?? 24;
    if (
      !Number.isInteger(this.maximumItemPosters) ||
      this.maximumItemPosters < 1 ||
      this.maximumItemPosters > 100
    ) {
      throw new Error('maximumItemPosters must be an integer from 1 through 100.');
    }
  }

  public uploadedPoster(
    id: string,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined> {
    return (
      this.options.uploadedPoster?.(id, signal) ??
      Promise.resolve(undefined)
    );
  }

  public async inputs(
    item: PlexDiscoveredItem,
    settings: CollectionPosterSettings,
    signal?: AbortSignal
  ): Promise<CollectionPosterRenderInputs> {
    if (item.kind === 'default-hub') {
      throw new Error('Built-in Plex hubs do not have collection members.');
    }
    const response = await this.options.transport.query(
      `/library/collections/${encodeURIComponent(item.plexKey)}/children`,
      signal
    );
    const members = parseMembers(response);
    const selected = members.slice(0, this.maximumItemPosters);
    const posterResults = await Promise.allSettled(
      selected.map((member) => {
        const artwork = member.thumb || member.parentThumb;
        return artwork
          ? this.options.transport.queryBinary(artwork, signal)
          : Promise.resolve(undefined);
      })
    );
    if (signal?.aborted) {
      throw new DOMException(
        'The collection poster input request was cancelled.',
        'AbortError'
      );
    }
    const itemPosters = posterResults
      .filter(
        (result): result is PromiseFulfilledResult<Uint8Array | undefined> =>
          result.status === 'fulfilled'
      )
      .map((result) => result.value)
      .filter(
        (poster): poster is Uint8Array =>
          poster !== undefined && poster.byteLength > 0
      );
    const [sourceType, personPoster, tmdbFranchisePoster] = await Promise.all([
      this.options.sourceType?.(item) ?? Promise.resolve(undefined),
      this.options.personPoster?.(item, signal) ?? Promise.resolve(undefined),
      settings.useTmdbFranchisePoster
        ? (this.options.tmdbFranchisePoster?.(item, signal) ??
          Promise.resolve(undefined))
        : Promise.resolve(undefined),
    ]);
    return {
      itemPosters,
      fingerprint: digest(
        members.map(({ ratingKey, thumb, parentThumb, updatedAt }) => ({
          ratingKey,
          thumb,
          parentThumb,
          updatedAt,
        }))
      ),
      ...(sourceType ? { sourceType } : {}),
      ...(personPoster?.byteLength ? { personPoster } : {}),
      ...(tmdbFranchisePoster?.byteLength
        ? { tmdbFranchisePoster }
        : {}),
    };
  }
}
