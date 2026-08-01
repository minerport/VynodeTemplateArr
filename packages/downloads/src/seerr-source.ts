import type { SeerrConfiguration } from './index.js';

type FetchLike = typeof fetch;

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;

const integer = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const endpointUrl = (configuration: SeerrConfiguration, path: string): string =>
  `${configuration.endpoint.useSsl ? 'https' : 'http'}://${configuration.endpoint.hostname}:${configuration.endpoint.port}${configuration.endpoint.urlBase}${path}`;

export type SeerrCollectionSubtype = 'global' | 'server_owner' | 'users' | 'user';

export interface SeerrCollectionSourceItem {
  requestId: number;
  mediaType: 'movie' | 'show';
  title: string;
  year?: number;
  tmdbId: number;
  tvdbId?: number;
  requestedBy: {
    id: number;
    displayName: string;
    owner: boolean;
  };
  requestStatus: 'pending' | 'approved' | 'declined';
  mediaStatus:
    | 'unknown'
    | 'pending'
    | 'processing'
    | 'partially-available'
    | 'available';
  createdAt?: string;
}

interface SeerrRequestRow {
  id: number;
  status: number;
  createdAt?: string;
  requestedBy: {
    id: number;
    displayName: string;
  };
  media: {
    mediaType: 'movie' | 'tv';
    tmdbId: number;
    tvdbId?: number;
    status?: number;
  };
}

const requestStatus = (
  status: number
): SeerrCollectionSourceItem['requestStatus'] =>
  status === 1 ? 'pending' : status === 3 ? 'declined' : 'approved';

const mediaStatus = (
  status?: number
): SeerrCollectionSourceItem['mediaStatus'] =>
  status === 5
    ? 'available'
    : status === 4
      ? 'partially-available'
      : status === 3
        ? 'processing'
        : status === 2
          ? 'pending'
          : 'unknown';

const parseRequest = (value: unknown): SeerrRequestRow | undefined => {
  const row = record(value);
  const media = record(row?.media);
  const requestedBy = record(row?.requestedBy);
  const id = integer(row?.id);
  const requesterId = integer(requestedBy?.id);
  const tmdbId = integer(media?.tmdbId);
  const mediaType =
    media?.mediaType === 'movie' || media?.mediaType === 'tv'
      ? media.mediaType
      : undefined;
  if (!id || !requesterId || !tmdbId || !mediaType) return undefined;
  return {
    id,
    status: Number(row?.status ?? 0),
    ...(text(row?.createdAt) ? { createdAt: text(row?.createdAt)! } : {}),
    requestedBy: {
      id: requesterId,
      displayName:
        text(requestedBy?.displayName) ??
        text(requestedBy?.plexUsername) ??
        text(requestedBy?.email) ??
        `User ${requesterId}`,
    },
    media: {
      mediaType,
      tmdbId,
      ...(integer(media?.tvdbId) ? { tvdbId: integer(media?.tvdbId)! } : {}),
      ...(integer(media?.status) ? { status: integer(media?.status)! } : {}),
    },
  };
};

export class HttpSeerrCollectionSourceClient {
  public constructor(
    private readonly secret: (configuration: SeerrConfiguration) => string | undefined,
    private readonly request: FetchLike = fetch
  ) {}

  public async source(
    configuration: SeerrConfiguration,
    input: {
      mediaType: 'movie' | 'show';
      subtype: SeerrCollectionSubtype;
      limit: number;
      requesterId?: number;
    },
    signal?: AbortSignal
  ): Promise<readonly SeerrCollectionSourceItem[]> {
    const apiKey = this.secret(configuration);
    if (!apiKey) throw new Error('Seerr credentials are unavailable.');
    if (input.subtype === 'user' && (!Number.isInteger(input.requesterId) || input.requesterId! <= 0))
      throw new Error('Choose a valid Seerr user before loading a private user collection.');
    const headers = { 'X-Api-Key': apiKey };
    const ownerResponse = await this.request(
      endpointUrl(configuration, '/api/v1/auth/me'),
      { headers, ...(signal ? { signal } : {}) }
    );
    if (!ownerResponse.ok)
      throw new Error(`Seerr owner lookup failed with status ${ownerResponse.status}.`);
    const ownerId = integer(record(await ownerResponse.json())?.id);
    if (!ownerId) throw new Error('Seerr returned an invalid owner identity.');

    const requests: SeerrRequestRow[] = [];
    const pageSize = 100;
    for (let skip = 0; ; skip += pageSize) {
      signal?.throwIfAborted();
      const parameters = new URLSearchParams({
        take: String(pageSize),
        skip: String(skip),
        sort: 'added',
        mediaType: input.mediaType === 'movie' ? 'movie' : 'tv',
      });
      const response = await this.request(
        endpointUrl(configuration, `/api/v1/request?${parameters}`),
        { headers, ...(signal ? { signal } : {}) }
      );
      if (!response.ok)
        throw new Error(`Seerr request feed failed with status ${response.status}.`);
      const payload = record(await response.json());
      const results = Array.isArray(payload?.results) ? payload.results : [];
      requests.push(
        ...results
          .map(parseRequest)
          .filter((item): item is SeerrRequestRow => Boolean(item))
      );
      const total = Number(record(payload?.pageInfo)?.results ?? requests.length);
      if (results.length < pageSize || requests.length >= total) break;
    }

    const filtered = requests.filter((item) => {
      if (item.media.mediaType !== (input.mediaType === 'movie' ? 'movie' : 'tv'))
        return false;
      if (item.status === 3) return false;
      if (input.subtype === 'server_owner')
        return item.requestedBy.id === ownerId;
      if (input.subtype === 'users')
        return item.requestedBy.id !== ownerId;
      if (input.subtype === 'user')
        return item.requestedBy.id === input.requesterId && item.requestedBy.id !== ownerId;
      return true;
    });
    const unique = [
      ...new Map(
        filtered.map((item) => [
          `${item.media.mediaType}:${item.media.tmdbId}`,
          item,
        ])
      ).values(),
    ].slice(0, Math.max(1, input.limit));

    const hydrated: SeerrCollectionSourceItem[] = [];
    for (const item of unique) {
      signal?.throwIfAborted();
      const path =
        item.media.mediaType === 'movie'
          ? `/api/v1/movie/${item.media.tmdbId}`
          : `/api/v1/tv/${item.media.tmdbId}`;
      const response = await this.request(endpointUrl(configuration, path), {
        headers,
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new Error(
          `Seerr media details failed with status ${response.status}.`
        );
      const details = record(await response.json());
      const title =
        text(details?.title) ??
        text(details?.name) ??
        `TMDB ${item.media.tmdbId}`;
      const date = text(details?.releaseDate) ?? text(details?.firstAirDate);
      const year = date ? Number(date.slice(0, 4)) : undefined;
      hydrated.push({
        requestId: item.id,
        mediaType: item.media.mediaType === 'movie' ? 'movie' : 'show',
        title,
        ...(year !== undefined && Number.isInteger(year) && year > 0
          ? { year }
          : {}),
        tmdbId: item.media.tmdbId,
        ...(item.media.tvdbId ? { tvdbId: item.media.tvdbId } : {}),
        requestedBy: {
          ...item.requestedBy,
          owner: item.requestedBy.id === ownerId,
        },
        requestStatus: requestStatus(item.status),
        mediaStatus: mediaStatus(item.media.status),
        ...(item.createdAt ? { createdAt: item.createdAt } : {}),
      });
    }
    return hydrated;
  }
}
