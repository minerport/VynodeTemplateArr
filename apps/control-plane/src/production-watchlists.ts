import type { ArrConfiguration, ArrKind, ArrProbeResult, WatchlistSettings } from '@vynode/downloads';
import { HttpArrProbe, WatchlistSettingsService } from '@vynode/downloads';
import { SqliteJsonRepository, type VynodeSqliteStorage } from '@vynode/storage';

import type { SqliteArrRepository, SqliteSeerrRepository } from './production-repositories.js';

const endpointWithSecret = (configuration: ArrConfiguration, apiKey: string) => ({
  ...configuration.endpoint,
  apiKey,
});

const arrBaseUrl = (configuration: ArrConfiguration): string => {
  const base = configuration.endpoint.urlBase.trim()
    ? `/${configuration.endpoint.urlBase.trim().replace(/^\/+|\/+$/g, '')}`
    : '';
  return `${configuration.endpoint.useSsl ? 'https' : 'http'}://${configuration.endpoint.hostname}:${configuration.endpoint.port}${base}/api/v3`;
};

export class ProductionWatchlistSettings {
  public readonly service: WatchlistSettingsService;
  readonly #values: SqliteJsonRepository<WatchlistSettings>;

  public constructor(
    storage: VynodeSqliteStorage,
    arrRepository: SqliteArrRepository,
    seerrRepository: SqliteSeerrRepository,
    secret: (reference: string) => string | undefined,
    fetchImplementation: typeof globalThis.fetch = globalThis.fetch
  ) {
    this.#values = new SqliteJsonRepository(storage, 'watchlist-settings');
    if (!this.#values.get('settings')) {
      this.#values.put('settings', {
        revision: 0,
        enableOwner: false,
        enableUsers: false,
        radarr: { tagIds: [], tagWithUsername: false, monitor: true, searchOnAdd: true },
        sonarr: { tagIds: [], tagWithUsername: false, monitor: true, searchOnAdd: true, seasonFolders: true },
      });
    }
    const probe = new HttpArrProbe(fetchImplementation);
    const configuration = async (kind: ArrKind, id: string) => {
      const value = await arrRepository.get(id);
      if (!value || value.endpoint.kind !== kind) throw new Error('The selected download server is unavailable.');
      const apiKey = secret(value.secretReference);
      if (!apiKey) throw new Error('The selected download server credential is unavailable.');
      return { value, apiKey };
    };
    this.service = new WatchlistSettingsService(
      {
        get: async () => structuredClone(this.#values.get('settings')!.value),
        compareAndSet: async (expectedRevision, next) => {
          const current = this.#values.get('settings')!;
          if (current.value.revision !== expectedRevision) return false;
          try { this.#values.put('settings', next, current.revision); return true; }
          catch (error) { if (error instanceof Error && /changed/.test(error.message)) return false; throw error; }
        },
      },
      {
        load: async (kind) => {
          const values = await arrRepository.list(kind);
          const inspected = await Promise.all(values.map(async (value) => {
            const apiKey = secret(value.secretReference);
            if (!apiKey) return undefined;
            const result = await probe.inspect(endpointWithSecret(value, apiKey));
            return { value, result };
          }));
          const available = inspected.filter((item): item is { value: ArrConfiguration; result: ArrProbeResult } => Boolean(item));
          return {
            servers: available.map(({ value }) => ({ id: value.id, name: value.endpoint.name, is4k: value.selection.is4k, isDefault: value.selection.isDefault })),
            serverOptions: Object.fromEntries(available.map(({ value, result }) => [value.id, result])),
          };
        },
        createTag: async (kind, serverId, label) => {
          const { value, apiKey } = await configuration(kind, serverId);
          const response = await fetchImplementation(`${arrBaseUrl(value)}/tag`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
            body: JSON.stringify({ label }),
          });
          if (!response.ok) throw new Error(`${kind === 'radarr' ? 'Radarr' : 'Sonarr'} could not create the watchlist tag (status ${response.status}).`);
          const body = await response.json() as { id?: unknown; label?: unknown };
          const id = Number(body.id);
          const returnedLabel = String(body.label ?? '').trim();
          if (!Number.isInteger(id) || id < 1 || !returnedLabel) throw new Error('The download server returned an invalid tag.');
          return { id, label: returnedLabel };
        },
      },
      async () => (await seerrRepository.get()) !== undefined
    );
  }
}
