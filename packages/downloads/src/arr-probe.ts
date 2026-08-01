import {
  DownloadConfigurationError,
  type ArrEndpointDraft,
  type ArrProbe,
  type ArrProbeResult,
} from './index.js';

type JsonRecord = Record<string, unknown>;

const records = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
      )
    : [];

const positiveInteger = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const baseUrl = (endpoint: ArrEndpointDraft): string => {
  const base = endpoint.urlBase.trim()
    ? `/${endpoint.urlBase.trim().replace(/^\/+|\/+$/g, '')}`
    : '';
  return `${endpoint.useSsl ? 'https' : 'http'}://${endpoint.hostname}:${endpoint.port}${base}/api/v3`;
};

export class HttpArrProbe implements ArrProbe {
  public constructor(
    private readonly fetchImplementation: typeof globalThis.fetch = globalThis.fetch
  ) {}

  public async inspect(
    endpoint: ArrEndpointDraft,
    signal?: AbortSignal
  ): Promise<ArrProbeResult> {
    const headers = {
      Accept: 'application/json',
      'X-Api-Key': endpoint.apiKey,
    };
    const get = async (path: string): Promise<unknown> => {
      let response: Response;
      try {
        response = await this.fetchImplementation(`${baseUrl(endpoint)}${path}`, {
          headers,
          ...(signal ? { signal } : {}),
        });
      } catch {
        throw new DownloadConfigurationError(
          'invalid-endpoint',
          `${endpoint.kind === 'radarr' ? 'Radarr' : 'Sonarr'} could not be reached at the supplied address.`
        );
      }
      if (!response.ok) {
        throw new DownloadConfigurationError(
          'invalid-endpoint',
          [401, 403].includes(response.status)
            ? `${endpoint.kind === 'radarr' ? 'Radarr' : 'Sonarr'} rejected the API key.`
            : `${endpoint.kind === 'radarr' ? 'Radarr' : 'Sonarr'} returned status ${response.status}.`
        );
      }
      return response.json().catch(() => {
        throw new DownloadConfigurationError(
          'invalid-endpoint',
          `${endpoint.kind === 'radarr' ? 'Radarr' : 'Sonarr'} returned invalid JSON.`
        );
      });
    };

    const [status, profilesBody, rootsBody, tagsBody] = await Promise.all([
      get('/system/status'),
      get('/qualityprofile'),
      get('/rootfolder'),
      get('/tag'),
    ]);
    const statusRecord =
      typeof status === 'object' && status !== null && !Array.isArray(status)
        ? (status as JsonRecord)
        : undefined;
    const serviceVersion = String(statusRecord?.version ?? '').trim();
    const profiles = records(profilesBody)
      .map((item) => {
        const id = positiveInteger(item.id);
        const name = String(item.name ?? '').trim();
        return id && name ? { id, name } : undefined;
      })
      .filter((item): item is { id: number; name: string } => Boolean(item));
    const rootFolders = records(rootsBody)
      .map((item) => {
        const id = positiveInteger(item.id);
        const path = String(item.path ?? '').trim();
        return id && path ? { id, path } : undefined;
      })
      .filter((item): item is { id: number; path: string } => Boolean(item));
    const tags = records(tagsBody)
      .map((item) => {
        const id = positiveInteger(item.id);
        const label = String(item.label ?? '').trim();
        return id && label ? { id, label } : undefined;
      })
      .filter((item): item is { id: number; label: string } => Boolean(item));

    if (!serviceVersion || profiles.length === 0 || rootFolders.length === 0) {
      throw new DownloadConfigurationError(
        'invalid-endpoint',
        `${endpoint.kind === 'radarr' ? 'Radarr' : 'Sonarr'} did not return the required profiles and root folders.`
      );
    }

    return {
      serviceVersion,
      normalizedUrlBase: endpoint.urlBase,
      profiles,
      rootFolders,
      tags,
    };
  }
}
