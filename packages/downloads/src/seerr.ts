import type {
  ArrKind,
  SeerrConfiguration,
  SeerrEndpointDraft,
  SeerrOptionsProvider,
  SeerrProbe,
  SeerrProbeResult,
  SeerrServer,
} from './index.js';

type FetchLike = typeof fetch;

interface SeerrArrSettings {
  id: number;
  name: string;
  hostname: string;
  port: number;
  useSsl?: boolean;
  baseUrl?: string;
  is4k?: boolean;
  isDefault?: boolean;
  apiKey: string;
}

interface SeerrArrTestResult {
  profiles?: { id: number; name: string }[];
  rootFolders?: { id: number; path: string }[];
  tags?: { id: number; label: string }[];
}

const endpointUrl = (
  endpoint: Omit<SeerrEndpointDraft, 'apiKey'>,
  path: string
): string =>
  `${endpoint.useSsl ? 'https' : 'http'}://${endpoint.hostname}:${endpoint.port}${endpoint.urlBase}${path}`;

const safeFailure = (service: string, status: number): Error =>
  new Error(`${service} request failed with status ${status}.`);

const isArrSettings = (value: unknown): value is SeerrArrSettings => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SeerrArrSettings>;
  return (
    Number.isInteger(candidate.id) &&
    typeof candidate.name === 'string' &&
    typeof candidate.hostname === 'string' &&
    Number.isInteger(candidate.port) &&
    typeof candidate.apiKey === 'string'
  );
};

export class HttpSeerrProvider implements SeerrProbe, SeerrOptionsProvider {
  public constructor(
    private readonly configurationSecret: (
      configuration: SeerrConfiguration
    ) => string | undefined,
    private readonly request: FetchLike = fetch,
    private readonly arrUrlOverride?: (
      kind: ArrKind,
      server: SeerrArrSettings
    ) => string | undefined
  ) {}

  public inspect(
    endpoint: SeerrEndpointDraft,
    signal?: AbortSignal
  ): Promise<SeerrProbeResult> {
    return this.loadEndpoint(endpoint, endpoint.apiKey, signal);
  }

  public load(configuration: SeerrConfiguration): Promise<SeerrProbeResult> {
    const apiKey = this.configurationSecret(configuration);
    if (!apiKey) throw new Error('Seerr credentials are unavailable.');
    return this.loadEndpoint(configuration.endpoint, apiKey);
  }

  public async createTag(
    configuration: SeerrConfiguration,
    kind: ArrKind,
    serverId: number,
    label: string
  ): Promise<{ id: number; label: string }> {
    const apiKey = this.configurationSecret(configuration);
    if (!apiKey) throw new Error('Seerr credentials are unavailable.');
    const servers = await this.settings(configuration.endpoint, apiKey, kind);
    const server = servers.find((candidate) => candidate.id === serverId);
    if (!server) throw new Error('The selected Seerr destination no longer exists.');
    const baseUrl =
      this.arrUrlOverride?.(kind, server) ??
      `${server.useSsl ? 'https' : 'http'}://${server.hostname}:${server.port}${server.baseUrl ?? ''}`;
    const response = await this.request(`${baseUrl}/api/v3/tag`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': server.apiKey,
      },
      body: JSON.stringify({ label }),
    });
    if (!response.ok) throw safeFailure(kind === 'radarr' ? 'Radarr' : 'Sonarr', response.status);
    const created = (await response.json()) as { id?: unknown; label?: unknown };
    if (!Number.isInteger(created.id) || typeof created.label !== 'string')
      throw new Error('The download service returned an invalid tag.');
    return { id: created.id as number, label: created.label };
  }

  public async triggerWatchlistSync(
    configuration: SeerrConfiguration,
    signal?: AbortSignal
  ): Promise<void> {
    const apiKey = this.configurationSecret(configuration);
    if (!apiKey) throw new Error('Seerr credentials are unavailable.');
    const response = await this.request(
      endpointUrl(
        configuration.endpoint,
        '/api/v1/settings/jobs/plex-watchlist-sync/run'
      ),
      {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey },
        ...(signal ? { signal } : {}),
      }
    );
    if (!response.ok) throw safeFailure('Seerr', response.status);
  }

  private async loadEndpoint(
    endpoint: Omit<SeerrEndpointDraft, 'apiKey'>,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<SeerrProbeResult> {
    const authentication = await this.request(
      endpointUrl(endpoint, '/api/v1/auth/me'),
      {
        headers: { 'X-Api-Key': apiKey },
        ...(signal ? { signal } : {}),
      }
    );
    if (!authentication.ok) throw safeFailure('Seerr authentication', authentication.status);
    const [radarr, sonarr] = await Promise.all([
      this.settings(endpoint, apiKey, 'radarr', signal),
      this.settings(endpoint, apiKey, 'sonarr', signal),
    ]);
    const [radarrOptions, sonarrOptions] = await Promise.all([
      this.options(endpoint, apiKey, 'radarr', radarr, signal),
      this.options(endpoint, apiKey, 'sonarr', sonarr, signal),
    ]);
    return {
      servers: {
        radarr: radarr.map(this.publicServer),
        sonarr: sonarr.map(this.publicServer),
      },
      radarrServerOptions: radarrOptions,
      sonarrServerOptions: sonarrOptions,
    };
  }

  private async settings(
    endpoint: Omit<SeerrEndpointDraft, 'apiKey'>,
    apiKey: string,
    kind: ArrKind,
    signal?: AbortSignal
  ): Promise<SeerrArrSettings[]> {
    const response = await this.request(
      endpointUrl(endpoint, `/api/v1/settings/${kind}`),
      {
        headers: { 'X-Api-Key': apiKey },
        ...(signal ? { signal } : {}),
      }
    );
    if (!response.ok) {
      if (response.status >= 500) return [];
      throw safeFailure(`Seerr ${kind} settings`, response.status);
    }
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body) || !body.every(isArrSettings))
      throw new Error('Seerr returned invalid download-server settings.');
    return body;
  }

  private async options(
    endpoint: Omit<SeerrEndpointDraft, 'apiKey'>,
    apiKey: string,
    kind: ArrKind,
    servers: SeerrArrSettings[],
    signal?: AbortSignal
  ): Promise<Record<number, SeerrProbeResult['radarrServerOptions'][number]>> {
    const entries = await Promise.all(
      servers.map(async (server) => {
        const response = await this.request(
          endpointUrl(endpoint, `/api/v1/settings/${kind}/test`),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Api-Key': apiKey,
            },
            body: JSON.stringify(server),
            ...(signal ? { signal } : {}),
          }
        );
        if (!response.ok) {
          if (response.status >= 500) {
            return [server.id, { profiles: [], rootFolders: [], tags: [] }] as const;
          }
          throw safeFailure(`Seerr ${kind} destination test`, response.status);
        }
        const result = (await response.json()) as SeerrArrTestResult;
        return [
          server.id,
          {
            profiles: Array.isArray(result.profiles) ? result.profiles : [],
            rootFolders: Array.isArray(result.rootFolders)
              ? result.rootFolders
              : [],
            tags: Array.isArray(result.tags) ? result.tags : [],
          },
        ] as const;
      })
    );
    return Object.fromEntries(entries);
  }

  private readonly publicServer = (server: SeerrArrSettings): SeerrServer => ({
    id: server.id,
    name: server.name,
    hostname: server.hostname,
    port: server.port,
    is4k: server.is4k ?? false,
    isDefault: server.isDefault ?? false,
  });
}
