import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type { CollectionVisibilitySettings } from '@vynode/contracts';

import type { PlexConnectionInput } from './index.js';
import type { PlexJsonTransport } from './plex-discovery.js';

export type PlexTransportErrorCode =
  | 'aborted'
  | 'authentication'
  | 'http'
  | 'invalid-json'
  | 'network'
  | 'response-too-large'
  | 'timeout';

export class PlexTransportError extends Error {
  public constructor(
    public readonly code: PlexTransportErrorCode,
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
  }
}

export interface PlexHttpTransportOptions {
  connection: PlexConnectionInput;
  token: () => Promise<string>;
  clientIdentifier: string;
  product?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const aborted = () =>
  new PlexTransportError('aborted', 'The Plex request was cancelled.');

export class PlexHttpTransport implements PlexJsonTransport {
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  public constructor(private readonly options: PlexHttpTransportOptions) {
    if (!options.clientIdentifier.trim()) {
      throw new Error('A stable Plex client identifier is required.');
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 25 * 1024 * 1024;
  }

  public query(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.send('GET', path, undefined, undefined, 'json', signal);
  }

  public queryBinary(
    path: string,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    return this.send(
      'GET',
      path,
      undefined,
      undefined,
      'bytes',
      signal
    ) as Promise<Uint8Array>;
  }

  public async put(path: string, signal?: AbortSignal): Promise<void> {
    await this.send('PUT', path, undefined, undefined, 'none', signal);
  }

  public async post(path: string, signal?: AbortSignal): Promise<void> {
    await this.send('POST', path, undefined, undefined, 'none', signal);
  }

  public postJson(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.send('POST', path, undefined, undefined, 'json', signal);
  }

  public async delete(path: string, signal?: AbortSignal): Promise<void> {
    await this.send('DELETE', path, undefined, undefined, 'none', signal);
  }

  public async postBinary(
    path: string,
    body: Uint8Array,
    signal?: AbortSignal
  ): Promise<void> {
    await this.send(
      'POST',
      path,
      body,
      'application/octet-stream',
      'none',
      signal
    );
  }

  private async send(
    method: 'DELETE' | 'GET' | 'POST' | 'PUT',
    path: string,
    body: Uint8Array | undefined,
    contentType: string | undefined,
    responseType: 'json' | 'bytes' | 'none',
    signal?: AbortSignal,
    redirects = 0
  ): Promise<unknown> {
    if (signal?.aborted) throw aborted();
    const token = (await this.options.token()).trim();
    if (signal?.aborted) throw aborted();
    if (!token) {
      throw new PlexTransportError(
        'authentication',
        'The Plex owner credential is unavailable.'
      );
    }
    const connection = this.options.connection;
    const protocol = connection.transport === 'http' ? 'http:' : 'https:';
    const host = connection.host.includes(':')
      ? `[${connection.host}]`
      : connection.host;
    const url = new URL(path, `${protocol}//${host}:${connection.port}`);
    const headers: Record<string, string | number> = {
      Accept: 'application/json',
      'X-Plex-Token': token,
      'X-Plex-Client-Identifier': this.options.clientIdentifier,
      'X-Plex-Product': this.options.product ?? 'Vynode',
    };
    if (contentType) headers['Content-Type'] = contentType;
    if (body) headers['Content-Length'] = body.byteLength;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        callback();
      };
      const request = (protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method,
          headers,
          ...(protocol === 'https:'
            ? {
                rejectUnauthorized:
                  connection.transport !== 'https-allow-self-signed',
              }
            : {}),
        },
        (response) => {
          const chunks: Uint8Array[] = [];
          let received = 0;
          response.on('data', (chunk: Buffer) => {
            received += chunk.byteLength;
            if (received > this.maxResponseBytes) {
              response.destroy(
                new PlexTransportError(
                  'response-too-large',
                  'The Plex response exceeded the configured safety limit.'
                )
              );
              return;
            }
            chunks.push(new Uint8Array(chunk));
          });
          response.on('error', (error) =>
            finish(() =>
              reject(
                error instanceof PlexTransportError
                  ? error
                  : new PlexTransportError(
                      'network',
                      `The Plex response failed: ${error.message}`
                    )
              )
            )
          );
          response.on('end', () => {
            const status = response.statusCode ?? 0;
            if (
              [301, 302, 303, 307, 308].includes(status) &&
              response.headers.location
            ) {
              if (redirects >= 5) {
                finish(() =>
                  reject(
                    new PlexTransportError(
                      'http',
                      'Plex returned too many redirects.'
                    )
                  )
                );
                return;
              }
              const destination = new URL(response.headers.location, url);
              if (destination.origin !== url.origin) {
                finish(() =>
                  reject(
                    new PlexTransportError(
                      'http',
                      'Plex attempted to redirect credentials to another origin.'
                    )
                  )
                );
                return;
              }
              finish(() =>
                resolve(
                  this.send(
                    method,
                    `${destination.pathname}${destination.search}`,
                    body,
                    contentType,
                    responseType,
                    signal,
                    redirects + 1
                  )
                )
              );
              return;
            }
            if (status < 200 || status >= 300) {
              finish(() =>
                reject(
                  new PlexTransportError(
                    status === 401 || status === 403
                      ? 'authentication'
                      : 'http',
                    status === 401 || status === 403
                      ? 'Plex rejected the owner credential.'
                      : `Plex returned HTTP ${status}.`,
                    status
                  )
                )
              );
              return;
            }
            if (responseType === 'none') {
              finish(() => resolve(undefined));
              return;
            }
            const combined = new Uint8Array(received);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.byteLength;
            }
            if (responseType === 'bytes') {
              finish(() => resolve(combined));
              return;
            }
            const responseBody = new TextDecoder().decode(combined);
            try {
              const parsed = responseBody.trim()
                ? (JSON.parse(responseBody) as unknown)
                : {};
              finish(() => resolve(parsed));
            } catch {
              finish(() =>
                reject(
                  new PlexTransportError(
                    'invalid-json',
                    'Plex returned a response that was not valid JSON.'
                  )
                )
              );
            }
          });
        }
      );
      const onAbort = () => request.destroy(aborted());
      signal?.addEventListener('abort', onAbort, { once: true });
      request.setTimeout(this.timeoutMs, () =>
        request.destroy(
          new PlexTransportError(
            'timeout',
            `Plex did not respond within ${this.timeoutMs} ms.`
          )
        )
      );
      request.on('error', (error) =>
        finish(() =>
          reject(
            error instanceof PlexTransportError
              ? error
              : new PlexTransportError(
                  'network',
                  `The Plex request failed: ${error.message}`
                )
          )
        )
      );
      if (body) request.write(body);
      request.end();
    });
  }
}

export class PlexManagementClient {
  public constructor(private readonly transport: PlexHttpTransport) {}

  public updateHubVisibility(
    libraryId: string,
    hubIdentifier: string,
    value: CollectionVisibilitySettings,
    signal?: AbortSignal
  ): Promise<void> {
    const parameters = new URLSearchParams({
      promotedToRecommended: value.libraryRecommended ? '1' : '0',
      promotedToOwnHome: value.serverOwnerHome ? '1' : '0',
      promotedToSharedHome: value.usersHome ? '1' : '0',
    });
    return this.transport.put(
      `/hubs/sections/${encodeURIComponent(libraryId)}/manage/${encodeURIComponent(hubIdentifier)}?${parameters}`,
      signal
    );
  }

  public markUnplayed(ratingKey: string, signal?: AbortSignal): Promise<void> {
    const parameters = new URLSearchParams({
      key: ratingKey,
      identifier: 'com.plexapp.plugins.library',
    });
    return this.transport.put(`/:/unscrobble?${parameters}`, signal);
  }

  public async updateDiscoveredVisibility(
    item: {
      kind: 'default-hub' | 'pre-existing-collection';
      libraryId: string;
      plexKey: string;
    },
    value: CollectionVisibilitySettings,
    signal?: AbortSignal
  ): Promise<void> {
    if (item.kind === 'default-hub') {
      return this.updateHubVisibility(
        item.libraryId,
        item.plexKey,
        value,
        signal
      );
    }
    const identifier = `custom.collection.${item.libraryId}.${item.plexKey}`;
    const response = (await this.transport.query(
      `/hubs/sections/${encodeURIComponent(item.libraryId)}/manage`,
      signal
    )) as {
      MediaContainer?: { Hub?: readonly { identifier?: string }[] };
    };
    const alreadyManaged =
      response.MediaContainer?.Hub?.some(
        (hub) => hub.identifier === identifier
      ) ?? false;
    if (!alreadyManaged) {
      await this.transport.post(
        `/hubs/sections/${encodeURIComponent(item.libraryId)}/manage?metadataItemId=${encodeURIComponent(item.plexKey)}`,
        signal
      );
    }
    await this.updateHubVisibility(item.libraryId, identifier, value, signal);
  }

  public moveHub(
    libraryId: string,
    hubIdentifier: string,
    afterHubIdentifier?: string,
    signal?: AbortSignal
  ): Promise<void> {
    const after = afterHubIdentifier
      ? `?after=${encodeURIComponent(afterHubIdentifier)}`
      : '';
    return this.transport.put(
      `/hubs/sections/${encodeURIComponent(libraryId)}/manage/${encodeURIComponent(hubIdentifier)}/move${after}`,
      signal
    );
  }

  public updateCollectionSortTitle(
    ratingKey: string,
    sortTitle: string,
    signal?: AbortSignal
  ): Promise<void> {
    const parameters = new URLSearchParams({
      type: '18',
      id: ratingKey,
      'titleSort.value': sortTitle,
      'titleSort.locked': '1',
    });
    return this.transport.put(
      `/library/metadata/${encodeURIComponent(ratingKey)}?${parameters}`,
      signal
    );
  }

  public updateCollectionSummary(
    ratingKey: string,
    summary: string,
    signal?: AbortSignal
  ): Promise<void> {
    const parameters = new URLSearchParams({ summary });
    return this.transport.put(
      `/library/metadata/${encodeURIComponent(ratingKey)}?${parameters}`,
      signal
    );
  }

  public updateCollectionMode(
    ratingKey: string,
    mode: -1 | 0 | 1 | 2 | 3,
    signal?: AbortSignal
  ): Promise<void> {
    return this.transport.put(
      `/library/metadata/${encodeURIComponent(ratingKey)}/prefs?collectionMode=${mode}`,
      signal
    );
  }

  public async uploadCollectionAsset(
    ratingKey: string,
    kind: 'poster' | 'wallpaper' | 'theme',
    body: Uint8Array,
    signal?: AbortSignal
  ): Promise<void> {
    const endpoint = {
      poster: 'posters',
      wallpaper: 'arts',
      theme: 'themes',
    }[kind];
    const lockField = {
      poster: 'thumb.locked',
      wallpaper: 'art.locked',
      theme: 'theme.locked',
    }[kind];
    const encodedRatingKey = encodeURIComponent(ratingKey);
    await this.transport.postBinary(
      `/library/metadata/${encodedRatingKey}/${endpoint}`,
      body,
      signal
    );
    await this.transport.put(
      `/library/metadata/${encodedRatingKey}?${lockField}=1`,
      signal
    );
  }

  public uploadPoster(
    ratingKey: string,
    body: Uint8Array,
    signal?: AbortSignal
  ): Promise<void> {
    return this.uploadCollectionAsset(ratingKey, 'poster', body, signal);
  }

  public async setOverlayLabel(
    ratingKey: string,
    enabled: boolean,
    signal?: AbortSignal
  ): Promise<void> {
    const encodedRatingKey = encodeURIComponent(ratingKey);
    const response = await this.transport.query(
      `/library/metadata/${encodedRatingKey}`,
      signal
    );
    const metadata =
      typeof response === 'object' &&
      response !== null &&
      'MediaContainer' in response &&
      typeof response.MediaContainer === 'object' &&
      response.MediaContainer !== null &&
      'Metadata' in response.MediaContainer &&
      Array.isArray(response.MediaContainer.Metadata)
        ? response.MediaContainer.Metadata[0]
        : undefined;
    const labels: string[] =
      typeof metadata === 'object' &&
      metadata !== null &&
      'Label' in metadata &&
      Array.isArray(metadata.Label)
        ? (metadata.Label as unknown[])
            .map((entry: unknown) =>
              typeof entry === 'object' &&
              entry !== null &&
              'tag' in entry &&
              typeof entry.tag === 'string'
                ? entry.tag.trim()
                : ''
            )
            .filter(Boolean)
        : [];
    const withoutOverlay = labels.filter(
      (label) => label.toLowerCase() !== 'overlay'
    );
    const updated = enabled ? [...withoutOverlay, 'Overlay'] : withoutOverlay;
    if (
      labels.length === updated.length &&
      labels.every((label, index) => label === updated[index])
    )
      return;

    const parameters = new URLSearchParams();
    if (updated.length) {
      updated.forEach((label, index) =>
        parameters.set(`label[${index}].tag.tag`, label)
      );
      parameters.set('label.locked', '1');
    } else {
      parameters.set('label[0].tag.tag-', '');
    }
    await this.transport.put(
      `/library/metadata/${encodedRatingKey}?${parameters}`,
      signal
    );
  }
}
