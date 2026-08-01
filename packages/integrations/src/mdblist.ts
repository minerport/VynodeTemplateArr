export type MDBListMediaType = 'movie' | 'show';

export interface MDBListSourceItem {
  mediaType: MDBListMediaType;
  title: string;
  year?: number;
  tmdbId: number;
  imdbId?: string;
  tvdbId?: number;
  rank: number;
  rating?: number;
  releasedAt?: string;
}

export interface MDBListInspection {
  title: string;
  description?: string;
  contentType: 'movie' | 'show' | 'mixed';
  itemCount?: number;
  private?: boolean;
  dynamic?: boolean;
}

export interface MDBListAccount {
  userId: number;
  requestLimit?: number;
  requestCount?: number;
  patronStatus?: string;
}

export interface MDBListSummary {
  id: number;
  username: string;
  title: string;
  slug: string;
  contentType: 'movie' | 'show';
  itemCount: number;
  private: boolean;
  dynamic: boolean;
}

export interface MDBListHttpResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
}

export interface MDBListHttpTransport {
  request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<MDBListHttpResponse>;
}

export class FetchMDBListTransport implements MDBListHttpTransport {
  public async request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<MDBListHttpResponse> {
    const response = await fetch(input.url, {
      headers: input.headers,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Preserve non-JSON provider errors for status-based handling.
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }
}

export class MDBListApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
const rows = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
const positiveInteger = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};
const finite = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export type MDBListReference =
  | { kind: 'id'; listId: number }
  | { kind: 'named'; username: string; slug: string };

export const parseMDBListUrl = (value: string): MDBListReference => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid MDBList list URL.');
  }
  if (
    url.protocol !== 'https:' ||
    !['mdblist.com', 'www.mdblist.com'].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password
  )
    throw new Error('MDBList URLs must use HTTPS on mdblist.com.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'lists')
    throw new Error('MDBList URL must point to a list.');
  if (parts.length === 2 && positiveInteger(parts[1]))
    return { kind: 'id', listId: positiveInteger(parts[1])! };
  if (
    parts.length === 3 &&
    parts[1]?.toLowerCase() === 'external' &&
    positiveInteger(parts[2])
  )
    return { kind: 'id', listId: positiveInteger(parts[2])! };
  if (
    parts.length === 3 &&
    /^[A-Za-z0-9_-]+$/.test(parts[1] ?? '') &&
    /^[A-Za-z0-9_-]+$/.test(parts[2] ?? '')
  )
    return {
      kind: 'named',
      username: parts[1]!,
      slug: parts[2]!,
    };
  throw new Error(
    'Use https://mdblist.com/lists/{id} or https://mdblist.com/lists/{username}/{list-name}.'
  );
};

export interface MDBListClientOptions {
  apiKey: string;
  transport?: MDBListHttpTransport;
  maxRetries?: number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const waitWithSignal = async (
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });

export class MDBListClient {
  private readonly transport: MDBListHttpTransport;
  private readonly maxRetries: number;
  private readonly wait: NonNullable<MDBListClientOptions['wait']>;

  public constructor(private readonly options: MDBListClientOptions) {
    if (!options.apiKey.trim()) throw new Error('MDBList API key is required.');
    this.transport = options.transport ?? new FetchMDBListTransport();
    this.maxRetries = options.maxRetries ?? 3;
    this.wait = options.wait ?? waitWithSignal;
  }

  public async test(signal?: AbortSignal): Promise<void> {
    await this.request('/user', {}, signal);
  }

  public async account(signal?: AbortSignal): Promise<MDBListAccount> {
    const payload = record(await this.request('/user', {}, signal));
    const userId = positiveInteger(payload?.user_id);
    if (!userId)
      throw new MDBListApiError(502, 'MDBList returned invalid account details.');
    const requestLimit = positiveInteger(payload?.api_requests);
    const requestCount =
      typeof payload?.api_requests_count === 'number' &&
      payload.api_requests_count >= 0
        ? payload.api_requests_count
        : undefined;
    const patronStatus =
      typeof payload?.patron_status === 'string' &&
      payload.patron_status.trim()
        ? payload.patron_status.trim()
        : undefined;
    return {
      userId,
      ...(requestLimit ? { requestLimit } : {}),
      ...(requestCount !== undefined ? { requestCount } : {}),
      ...(patronStatus ? { patronStatus } : {}),
    };
  }

  public async accountLists(signal?: AbortSignal): Promise<readonly MDBListSummary[]> {
    return rows(await this.request('/lists/user', {}, signal))
      .map((item) => {
        const id = positiveInteger(item.id);
        const username =
          typeof item.user_name === 'string' ? item.user_name.trim() : '';
        const title = typeof item.name === 'string' ? item.name.trim() : '';
        const slug = typeof item.slug === 'string' ? item.slug.trim() : '';
        const itemCount =
          typeof item.items === 'number' && item.items >= 0 ? item.items : 0;
        const contentType =
          item.mediatype === 'movie' || item.mediatype === 'show'
            ? item.mediatype
            : undefined;
        if (!id || !username || !title || !slug || !contentType) return undefined;
        return {
          id,
          username,
          title,
          slug,
          contentType,
          itemCount,
          private: item.private === true,
          dynamic: item.dynamic === true,
        } satisfies MDBListSummary;
      })
      .filter((item): item is MDBListSummary => Boolean(item));
  }

  public async inspect(
    listUrl: string,
    signal?: AbortSignal
  ): Promise<MDBListInspection> {
    const reference = parseMDBListUrl(listUrl);
    const basePath =
      reference.kind === 'id'
        ? `/lists/${reference.listId}`
        : `/lists/user/${encodeURIComponent(reference.username)}`;
    const summaryPayload = await this.request(basePath, {}, signal);
    const summaries = Array.isArray(summaryPayload)
      ? rows(summaryPayload)
      : record(summaryPayload)
        ? [record(summaryPayload)!]
        : [];
    let summary =
      reference.kind === 'id'
        ? summaries.find((item) => positiveInteger(item.id) === reference.listId)
        : summaries.find(
            (item) =>
              typeof item.slug === 'string' &&
              item.slug.toLowerCase() === reference.slug.toLowerCase()
          );
    if (!summary && reference.kind === 'named') {
      const ownLists = rows(await this.request('/lists/user', {}, signal));
      summary = ownLists.find(
        (item) =>
          typeof item.slug === 'string' &&
          item.slug.toLowerCase() === reference.slug.toLowerCase() &&
          (typeof item.user_name !== 'string' ||
            item.user_name.toLowerCase() === reference.username.toLowerCase())
      );
    }
    if (!summary) throw new MDBListApiError(404, 'MDBList could not find that list.');

    const itemPath =
      reference.kind === 'id'
        ? `/lists/${reference.listId}/items`
        : `/lists/${encodeURIComponent(reference.username)}/${encodeURIComponent(reference.slug)}/items`;
    const sample = record(
      await this.request(itemPath, { limit: '1', offset: '0' }, signal)
    );
    const hasMovies = rows(sample?.movies).length > 0;
    const hasShows = rows(sample?.shows).length > 0;
    const declaredMediaType =
      summary.mediatype === 'movie' || summary.mediatype === 'show'
        ? summary.mediatype
        : undefined;
    const contentType =
      hasMovies && hasShows
        ? 'mixed'
        : hasMovies
          ? 'movie'
          : hasShows
            ? 'show'
            : declaredMediaType ?? 'mixed';
    const title =
      typeof summary.name === 'string' && summary.name.trim()
        ? summary.name.trim()
        : reference.kind === 'named'
          ? reference.slug.replace(/[-_]+/g, ' ')
          : `MDBList ${reference.listId}`;
    const description =
      typeof summary.description === 'string' && summary.description.trim()
        ? summary.description.trim()
        : undefined;
    const itemCount = positiveInteger(summary.items);
    return {
      title,
      contentType,
      ...(description ? { description } : {}),
      ...(itemCount ? { itemCount } : {}),
      ...(typeof summary.private === 'boolean'
        ? { private: summary.private }
        : {}),
      ...(typeof summary.dynamic === 'boolean'
        ? { dynamic: summary.dynamic }
        : {}),
    };
  }

  public async source(
    input: {
      listUrl: string;
      mediaType: MDBListMediaType;
      limit: number;
    },
    signal?: AbortSignal
  ): Promise<readonly MDBListSourceItem[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 9999)
      throw new Error('MDBList item limit must be from 1 through 9,999.');
    const reference = parseMDBListUrl(input.listUrl);
    const basePath =
      reference.kind === 'id'
        ? `/lists/${reference.listId}/items`
        : `/lists/${encodeURIComponent(reference.username)}/${encodeURIComponent(reference.slug)}/items`;
    const output: MDBListSourceItem[] = [];
    const seen = new Set<number>();
    const pageSize = 500;
    for (let offset = 0; output.length < input.limit; offset += pageSize) {
      const payload = record(
        await this.request(
          basePath,
          {
            limit: String(pageSize),
            offset: String(offset),
          },
          signal
        )
      );
      const moviePage = rows(payload?.movies);
      const showPage = rows(payload?.shows);
      const page = input.mediaType === 'movie' ? moviePage : showPage;
      for (const [pageIndex, row] of page.entries()) {
        const tmdbId = positiveInteger(row.id);
        const title = typeof row.title === 'string' ? row.title.trim() : '';
        if (!tmdbId || !title || seen.has(tmdbId)) continue;
        seen.add(tmdbId);
        const imdbId =
          typeof row.imdb_id === 'string' &&
          /^tt\d{6,}$/i.test(row.imdb_id)
            ? row.imdb_id.toLowerCase()
            : undefined;
        const tvdbId = positiveInteger(row.tvdb_id);
        const year = positiveInteger(row.release_year);
        const rating =
          finite(row.score) ??
          finite(row.mdblist_score) ??
          finite(row.imdb_rating);
        const releasedAt =
          typeof row.release_date === 'string' ? row.release_date : undefined;
        output.push({
          mediaType: input.mediaType,
          title,
          tmdbId,
          rank: positiveInteger(row.rank) ?? offset + pageIndex + 1,
          ...(imdbId ? { imdbId } : {}),
          ...(tvdbId ? { tvdbId } : {}),
          ...(year ? { year } : {}),
          ...(rating !== undefined ? { rating } : {}),
          ...(releasedAt ? { releasedAt } : {}),
        });
        if (output.length >= input.limit) break;
      }
      if (moviePage.length + showPage.length < pageSize) break;
    }
    return output;
  }

  private async request(
    path: string,
    query: Readonly<Record<string, string>>,
    signal?: AbortSignal
  ): Promise<unknown> {
    let delay = 500;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const url = new URL(path, 'https://api.mdblist.com');
      url.searchParams.set('apikey', this.options.apiKey);
      for (const [name, value] of Object.entries(query))
        url.searchParams.set(name, value);
      const response = await this.transport.request({
        url: url.toString(),
        headers: { Accept: 'application/json' },
        ...(signal ? { signal } : {}),
      });
      if (response.status >= 200 && response.status < 300) return response.body;
      const retryAfter = Number(response.headers['retry-after']);
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt + 1 < this.maxRetries
      ) {
        await this.wait(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : delay,
          signal
        );
        delay *= 2;
        continue;
      }
      const message =
        [401, 403].includes(response.status)
          ? 'MDBList rejected the API key.'
          : response.status === 404
            ? 'MDBList could not find that list.'
            : response.status === 429
              ? 'MDBList rate limit exceeded.'
              : `MDBList request failed with status ${response.status}.`;
      throw new MDBListApiError(
        response.status,
        message,
        Number.isFinite(retryAfter) ? retryAfter : undefined
      );
    }
    throw new Error('MDBList request failed.');
  }
}
