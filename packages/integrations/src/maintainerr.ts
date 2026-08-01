export interface MaintainerrHttpResponse {
  status: number;
  body: unknown;
}

export interface MaintainerrHttpTransport {
  request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<MaintainerrHttpResponse>;
}

export class FetchMaintainerrTransport implements MaintainerrHttpTransport {
  public async request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<MaintainerrHttpResponse> {
    const response = await fetch(input.url, {
      headers: input.headers,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Status and envelope validation below provide a credential-safe error.
    }
    return { status: response.status, body };
  }
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
const records = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];

export interface MaintainerrCollection {
  id: number;
  title: string;
  description?: string;
  mediaType?: string;
  libraryId?: string;
  deleteAfterDays?: number;
  isActive?: boolean;
  action?: number;
  mediaCount?: number;
}

export interface MaintainerrOverlayItem {
  collectionId: number;
  mediaId: string;
  title?: string;
  libraryId?: string;
  mediaType?: string;
  addedAt?: string;
  deleteAt?: string;
  daysRemaining?: number;
}

export interface MaintainerrClientOptions {
  hostname: string;
  port: number;
  useSsl: boolean;
  urlBase: string;
  apiKey?: string;
  transport?: MaintainerrHttpTransport;
  now?: () => Date;
}

export class MaintainerrClient {
  private readonly baseUrl: string;
  private readonly transport: MaintainerrHttpTransport;

  public constructor(private readonly options: MaintainerrClientOptions) {
    if (
      !options.hostname.trim() ||
      options.hostname.includes('://') ||
      options.hostname.includes('/') ||
      !Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535
    )
      throw new Error('Maintainerr hostname and port are invalid.');
    const base = options.urlBase.trim()
      ? `/${options.urlBase.trim().replace(/^\/+|\/+$/g, '')}`
      : '';
    this.baseUrl = `${options.useSsl ? 'https' : 'http'}://${options.hostname}:${options.port}${base}`;
    this.transport = options.transport ?? new FetchMaintainerrTransport();
  }

  public async test(signal?: AbortSignal): Promise<void> {
    const response = await this.get('/api/health/ready', signal);
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        response.status === 503
          ? 'Maintainerr is running but its database is not ready.'
          : `Maintainerr readiness check failed with status ${response.status}.`
      );
    const health = record(response.body);
    if (health?.status !== 'ok' || health.database !== 'ok')
      throw new Error('Maintainerr returned an invalid readiness response.');
  }

  public async collections(
    signal?: AbortSignal
  ): Promise<readonly MaintainerrCollection[]> {
    const response = await this.get('/api/collections', signal);
    this.requireSuccess(response, 'collections');
    if (!Array.isArray(response.body))
      throw new Error('Maintainerr returned an invalid collections response.');
    return records(response.body)
      .map((item): MaintainerrCollection | undefined => {
        const id = Number(item.id);
        const title = String(item.title ?? item.name ?? '').trim();
        if (!Number.isInteger(id) || id < 1 || !title) return undefined;
        const libraryId = String(
          item.libraryId ?? item.librarySectionId ?? item.libraryKey ?? ''
        ).trim();
        const mediaType = String(item.mediaType ?? item.type ?? '').trim();
        const description = String(item.description ?? '').trim();
        const deleteAfterDays = Number(
          item.deleteAfterDays ?? item.deleteAfter ?? item.days
        );
        const action = Number(item.arrAction ?? item.action);
        const mediaCount = Number(
          item.mediaCount ?? (Array.isArray(item.media) ? item.media.length : NaN)
        );
        return {
          id,
          title,
          ...(description ? { description } : {}),
          ...(libraryId ? { libraryId } : {}),
          ...(mediaType ? { mediaType } : {}),
          ...(Number.isFinite(deleteAfterDays) ? { deleteAfterDays } : {}),
          ...(typeof item.isActive === 'boolean'
            ? { isActive: item.isActive }
            : typeof item.active === 'boolean'
              ? { isActive: item.active }
              : {}),
          ...(Number.isInteger(action) ? { action } : {}),
          ...(Number.isInteger(mediaCount) && mediaCount >= 0
            ? { mediaCount }
            : {}),
        };
      })
      .filter((item): item is MaintainerrCollection => Boolean(item));
  }

  public async overlayData(
    signal?: AbortSignal
  ): Promise<readonly MaintainerrOverlayItem[]> {
    let response = await this.get('/api/collections/overlay-data', signal);
    if (response.status === 404)
      response = await this.get('/api/collections', signal);
    this.requireSuccess(response, 'overlay data');
    if (!Array.isArray(response.body))
      throw new Error('Maintainerr returned an invalid overlay-data response.');
    const now = this.options.now?.() ?? new Date();
    return records(response.body).flatMap((collection) => {
      const collectionId = Number(collection.id);
      if (!Number.isInteger(collectionId) || collectionId < 1) return [];
      const libraryId = String(
        collection.libraryId ??
          collection.librarySectionId ??
          collection.libraryKey ??
          ''
      ).trim();
      const collectionType = String(
        collection.mediaType ?? collection.type ?? ''
      ).trim();
      const deleteAfterDays = Number(collection.deleteAfterDays);
      return records(collection.media)
        .map((media): MaintainerrOverlayItem | undefined => {
          const mediaData = record(media.mediaData);
          const mediaId = String(
            media.mediaServerId ??
              media.ratingKey ??
              media.plexId ??
              media.id ??
              ''
          ).trim();
          if (!mediaId) return undefined;
          const title = String(
            mediaData?.grandparentTitle ??
              mediaData?.parentTitle ??
              mediaData?.title ??
              media.title ??
              ''
          ).trim();
          const mediaType = String(mediaData?.type ?? collectionType).trim();
          const addedAt = String(media.addDate ?? '').trim();
          const addedDate = addedAt ? new Date(addedAt) : undefined;
          const validAddedDate =
            addedDate && !Number.isNaN(addedDate.valueOf())
              ? addedDate
              : undefined;
          const usableSchedule =
            Number.isFinite(deleteAfterDays) && deleteAfterDays > 0;
          const deletionDate =
            validAddedDate && usableSchedule
              ? new Date(validAddedDate.valueOf() + deleteAfterDays * 86_400_000)
              : undefined;
          const daysRemaining =
            validAddedDate && usableSchedule
              ? deleteAfterDays -
                Math.floor(
                  (now.valueOf() - validAddedDate.valueOf()) / 86_400_000
                )
              : undefined;
          return {
            collectionId,
            mediaId,
            ...(title ? { title } : {}),
            ...(libraryId ? { libraryId } : {}),
            ...(mediaType ? { mediaType } : {}),
            ...(addedAt ? { addedAt } : {}),
            ...(deletionDate ? { deleteAt: deletionDate.toISOString() } : {}),
            ...(daysRemaining !== undefined ? { daysRemaining } : {}),
          };
        })
        .filter((item): item is MaintainerrOverlayItem => Boolean(item));
    });
  }

  private get(path: string, signal?: AbortSignal) {
    return this.transport.request({
      url: `${this.baseUrl}${path}`,
      headers: this.headers(),
      ...(signal ? { signal } : {}),
    });
  }

  private requireSuccess(
    response: MaintainerrHttpResponse,
    operation: string
  ): void {
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        `Maintainerr ${operation} request failed with status ${response.status}.`
      );
  }

  private headers(): Readonly<Record<string, string>> {
    const apiKey = this.options.apiKey?.trim();
    return {
      Accept: 'application/json',
      ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
    };
  }
}
