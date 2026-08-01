import { randomUUID } from 'node:crypto';
import path from 'node:path';

export * from './placeholder-lifecycle.js';
export * from './plex-watchlist.js';

export * from './arr-source.js';
export * from './arr-probe.js';
export * from './arr-request.js';
export * from './missing-media.js';
export * from './missing-history.js';
export * from './seerr-request.js';

export type ArrKind = 'radarr' | 'sonarr';
export type AutomaticTagMode = 'off' | 'single' | 'per-service' | 'granular';
export type RadarrAvailability = 'announced' | 'inCinemas' | 'released';
export type SonarrSeriesType = 'standard' | 'daily' | 'anime';
export type SonarrMonitorType =
  | 'all'
  | 'future'
  | 'missing'
  | 'existing'
  | 'pilot'
  | 'firstSeason'
  | 'latestSeason'
  | 'none';

export interface ArrEndpointDraft {
  kind: ArrKind;
  name: string;
  hostname: string;
  port: number;
  useSsl: boolean;
  apiKey: string;
  urlBase: string;
  externalUrl?: string;
}

export interface ArrProbeResult {
  serviceVersion: string;
  normalizedUrlBase: string;
  profiles: readonly { id: number; name: string }[];
  rootFolders: readonly { id: number; path: string }[];
  tags: readonly { id: number; label: string }[];
}

interface SharedArrSelection {
  profileId: number;
  rootFolder: string;
  tagIds: readonly number[];
  isDefault: boolean;
  is4k: boolean;
  automaticTagMode: AutomaticTagMode;
  monitorByDefault: boolean;
  searchOnAdd: boolean;
  tagExistingItems: boolean;
}

export type ArrSelection =
  | (SharedArrSelection & {
      kind: 'radarr';
      minimumAvailability: RadarrAvailability;
    })
  | (SharedArrSelection & {
      kind: 'sonarr';
      seriesType: SonarrSeriesType;
      seasonFolders: boolean;
      monitorType: SonarrMonitorType;
    });

export interface ArrConfiguration {
  id: string;
  revision: number;
  endpoint: Omit<ArrEndpointDraft, 'apiKey'>;
  secretReference: string;
  selection: ArrSelection;
  verifiedAt: string;
}

export interface ArrConfigurationView {
  id: string;
  revision: number;
  endpoint: Omit<ArrEndpointDraft, 'apiKey'>;
  secretConfigured: true;
  selection: ArrSelection;
  verifiedAt: string;
}

export interface ArrRepository {
  list(kind: ArrKind): Promise<readonly ArrConfiguration[]>;
  get(id: string): Promise<ArrConfiguration | undefined>;
  compareAndSet(
    id: string,
    expectedRevision: number,
    next: ArrConfiguration,
    defaultsToClear: readonly string[]
  ): Promise<boolean>;
  delete(id: string, expectedRevision: number): Promise<boolean>;
}

export interface ArrVault {
  store(value: string): Promise<string>;
  remove(reference: string): Promise<void>;
}

export interface ArrProbe {
  inspect(
    endpoint: ArrEndpointDraft,
    signal?: AbortSignal
  ): Promise<ArrProbeResult>;
}

export class DownloadConfigurationError extends Error {
  public constructor(
    public readonly code:
      | 'invalid-endpoint'
      | 'invalid-selection'
      | 'test-required'
      | 'configuration-conflict'
      | 'confirmation-required',
    message: string
  ) {
    super(message);
  }
}

interface TestedDraft {
  endpoint: ArrEndpointDraft;
  result: ArrProbeResult;
  testedAt: number;
}

const normalizePath = (value: string): string => {
  const trimmed = value.trim();
  return trimmed ? `/${trimmed.replace(/^\/+|\/+$/g, '')}` : '';
};

const normalizeExternalUrl = (value?: string): string | undefined => {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error('invalid');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new DownloadConfigurationError(
      'invalid-endpoint',
      'External URL must be HTTP or HTTPS without embedded credentials.'
    );
  }
};

export const normalizeArrEndpoint = (
  draft: ArrEndpointDraft
): ArrEndpointDraft => {
  const name = draft.name.trim();
  const hostname = draft.hostname.trim().toLowerCase();
  if (
    !name ||
    !hostname ||
    hostname.includes('://') ||
    hostname.includes('/') ||
    !Number.isInteger(draft.port) ||
    draft.port < 1 ||
    draft.port > 65535 ||
    !draft.apiKey.trim()
  ) {
    throw new DownloadConfigurationError(
      'invalid-endpoint',
      'Name, hostname, port from 1 through 65535, and API key are required.'
    );
  }
  const externalUrl = normalizeExternalUrl(draft.externalUrl);
  return {
    ...draft,
    name,
    hostname,
    apiKey: draft.apiKey.trim(),
    urlBase: normalizePath(draft.urlBase),
    ...(externalUrl ? { externalUrl } : {}),
  };
};

const sameEndpoint = (
  left: ArrEndpointDraft,
  right: ArrEndpointDraft
): boolean => JSON.stringify(left) === JSON.stringify(right);

const validateSelection = (
  selection: ArrSelection,
  probe: ArrProbeResult
): void => {
  if (
    !probe.profiles.some((profile) => profile.id === selection.profileId) ||
    !probe.rootFolders.some(
      (folder) => folder.path === selection.rootFolder
    ) ||
    selection.tagIds.some(
      (tagId) => !probe.tags.some((tag) => tag.id === tagId)
    )
  ) {
    throw new DownloadConfigurationError(
      'invalid-selection',
      'A selected profile, root folder, or tag is no longer available.'
    );
  }
};

export class ArrConfigurationService {
  private readonly tests = new Map<string, TestedDraft>();

  public constructor(
    private readonly repository: ArrRepository,
    private readonly vault: ArrVault,
    private readonly probe: ArrProbe,
    private readonly now: () => Date,
    private readonly references: (id: string) => Promise<readonly string[]> =
      async () => []
  ) {}

  public async list(kind: ArrKind): Promise<readonly ArrConfigurationView[]> {
    return (await this.repository.list(kind)).map((entry) => ({
      id: entry.id,
      revision: entry.revision,
      endpoint: entry.endpoint,
      secretConfigured: true,
      selection: entry.selection,
      verifiedAt: entry.verifiedAt,
    }));
  }

  public async test(
    draft: ArrEndpointDraft,
    signal?: AbortSignal
  ): Promise<{ testReceipt: string; options: ArrProbeResult }> {
    const endpoint = normalizeArrEndpoint(draft);
    const result = await this.probe.inspect(endpoint, signal);
    const testReceipt = randomUUID();
    this.tests.set(testReceipt, {
      endpoint,
      result,
      testedAt: this.now().getTime(),
    });
    return { testReceipt, options: result };
  }

  public async save(command: {
    id?: string;
    expectedRevision: number;
    endpoint: ArrEndpointDraft;
    selection: ArrSelection;
    testReceipt: string;
  }): Promise<ArrConfigurationView> {
    const endpoint = normalizeArrEndpoint(command.endpoint);
    if (endpoint.kind !== command.selection.kind) {
      throw new DownloadConfigurationError(
        'invalid-selection',
        'Endpoint and download settings must target the same service.'
      );
    }
    const tested = this.tests.get(command.testReceipt);
    if (!tested || !sameEndpoint(tested.endpoint, endpoint)) {
      throw new DownloadConfigurationError(
        'test-required',
        'Test this exact endpoint before saving.'
      );
    }
    validateSelection(command.selection, tested.result);
    const id = command.id ?? randomUUID();
    const current = await this.repository.get(id);
    if ((current?.revision ?? 0) !== command.expectedRevision) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Download settings changed; reload and retry.'
      );
    }
    const secretReference = await this.vault.store(endpoint.apiKey);
    const { apiKey: _apiKey, ...publicEndpoint } = endpoint;
    const defaultsToClear = command.selection.isDefault
      ? (await this.repository.list(endpoint.kind))
          .filter(
            (entry) =>
              entry.id !== id &&
              entry.selection.isDefault &&
              entry.selection.is4k === command.selection.is4k
          )
          .map((entry) => entry.id)
      : [];
    const next: ArrConfiguration = {
      id,
      revision: command.expectedRevision + 1,
      endpoint: publicEndpoint,
      secretReference,
      selection: command.selection,
      verifiedAt: this.now().toISOString(),
    };
    if (
      !(await this.repository.compareAndSet(
        id,
        command.expectedRevision,
        next,
        defaultsToClear
      ))
    ) {
      await this.vault.remove(secretReference);
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Download settings changed; reload and retry.'
      );
    }
    if (current) await this.vault.remove(current.secretReference);
    this.tests.delete(command.testReceipt);
    return {
      id: next.id,
      revision: next.revision,
      endpoint: next.endpoint,
      secretConfigured: true,
      selection: next.selection,
      verifiedAt: next.verifiedAt,
    };
  }

  public async removalImpact(id: string): Promise<{
    configuration: ArrConfigurationView;
    references: readonly string[];
  }> {
    const current = await this.repository.get(id);
    if (!current) {
      throw new DownloadConfigurationError(
        'invalid-selection',
        'This download server no longer exists.'
      );
    }
    return {
      configuration: {
        id: current.id,
        revision: current.revision,
        endpoint: current.endpoint,
        secretConfigured: true,
        selection: current.selection,
        verifiedAt: current.verifiedAt,
      },
      references: await this.references(id),
    };
  }

  public async remove(command: {
    id: string;
    expectedRevision: number;
    confirmed: boolean;
  }): Promise<void> {
    const current = await this.repository.get(command.id);
    if (!current || current.revision !== command.expectedRevision) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Download settings changed; reload and review removal again.'
      );
    }
    if (!command.confirmed) {
      throw new DownloadConfigurationError(
        'confirmation-required',
        'Confirm removal after reviewing every affected setting.'
      );
    }
    if (!(await this.repository.delete(command.id, command.expectedRevision))) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Download settings changed; reload and review removal again.'
      );
    }
    await this.vault.remove(current.secretReference);
  }
}

export interface PlaceholderSettings {
  revision: number;
  libraryRoots: Readonly<Record<string, string>>;
  skipYoutubeTrailerDownloads: boolean;
}

export interface PlaceholderSettingsRepository {
  get(): Promise<PlaceholderSettings>;
  compareAndSet(
    expectedRevision: number,
    next: PlaceholderSettings
  ): Promise<boolean>;
}

export interface MountedDirectory {
  name: string;
  path: string;
}

export interface DirectoryReader {
  directories(absolutePath: string): Promise<readonly string[]>;
}

export interface DirectoryListing {
  currentPath: string;
  parentPath?: string;
  mountRoot: string;
  directories: readonly MountedDirectory[];
}

const within = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

export class MountedDirectoryBrowser {
  private readonly roots: readonly string[];

  public constructor(
    roots: readonly string[],
    private readonly reader: DirectoryReader
  ) {
    this.roots = roots.map((root) => path.resolve(root));
    if (this.roots.length === 0) {
      throw new Error('At least one mounted media root is required');
    }
  }

  public async browse(requestedPath?: string): Promise<DirectoryListing> {
    const candidate = path.resolve(requestedPath ?? this.roots[0]!);
    const mountRoot = this.roots.find((root) => within(root, candidate));
    if (!mountRoot) {
      throw new DownloadConfigurationError(
        'invalid-endpoint',
        'The selected folder is outside the configured media mounts.'
      );
    }
    const directories = (await this.reader.directories(candidate))
      .map((name) => ({
        name,
        path: path.resolve(candidate, name),
      }))
      .filter((entry) => within(mountRoot, entry.path))
      .sort((left, right) => left.name.localeCompare(right.name));
    const parent = path.dirname(candidate);
    return {
      currentPath: candidate,
      mountRoot,
      directories,
      ...(candidate !== mountRoot && within(mountRoot, parent)
        ? { parentPath: parent }
        : {}),
    };
  }
}

export class PlaceholderSettingsService {
  public constructor(
    private readonly repository: PlaceholderSettingsRepository,
    private readonly allowedLibraryKeys: () => Promise<ReadonlySet<string>>,
    private readonly allowedMountRoots: readonly string[]
  ) {}

  public get(): Promise<PlaceholderSettings> {
    return this.repository.get();
  }

  public async save(command: {
    expectedRevision: number;
    libraryRoots: Readonly<Record<string, string>>;
    skipYoutubeTrailerDownloads: boolean;
  }): Promise<PlaceholderSettings> {
    const current = await this.repository.get();
    if (current.revision !== command.expectedRevision) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Placeholder settings changed; reload and retry.'
      );
    }
    const libraryKeys = await this.allowedLibraryKeys();
    const normalized: Record<string, string> = {};
    for (const [libraryKey, value] of Object.entries(command.libraryRoots)) {
      if (!libraryKeys.has(libraryKey)) {
        throw new DownloadConfigurationError(
          'invalid-selection',
          `Plex library ${libraryKey} is not available.`
        );
      }
      if (!value.trim()) continue;
      const selected = path.resolve(value.trim());
      if (
        !this.allowedMountRoots
          .map((root) => path.resolve(root))
          .some((root) => within(root, selected))
      ) {
        throw new DownloadConfigurationError(
          'invalid-selection',
          'Placeholder folders must be inside a configured media mount.'
        );
      }
      normalized[libraryKey] = selected;
    }
    const next: PlaceholderSettings = {
      revision: current.revision + 1,
      libraryRoots: normalized,
      skipYoutubeTrailerDownloads: command.skipYoutubeTrailerDownloads,
    };
    if (!(await this.repository.compareAndSet(current.revision, next))) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Placeholder settings changed; reload and retry.'
      );
    }
    return next;
  }
}

export type ServiceUserCreationMode = 'single' | 'per-service' | 'granular';

export interface SeerrEndpointDraft {
  hostname: string;
  port: number;
  useSsl: boolean;
  apiKey: string;
  urlBase: string;
  externalUrl?: string;
}

export interface SeerrServer {
  id: number;
  name: string;
  hostname: string;
  port: number;
  is4k: boolean;
  isDefault: boolean;
}

export interface SeerrDestinationOptions {
  profiles: readonly { id: number; name: string }[];
  rootFolders: readonly { id: number; path: string }[];
  tags: readonly { id: number; label: string }[];
}

export interface SeerrProbeResult {
  servers: {
    radarr: readonly SeerrServer[];
    sonarr: readonly SeerrServer[];
  };
  radarrServerOptions: Readonly<Record<number, SeerrDestinationOptions>>;
  sonarrServerOptions: Readonly<Record<number, SeerrDestinationOptions>>;
}

export interface SeerrDestination {
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  tagIds: readonly number[];
}

export interface SeerrConfiguration {
  revision: number;
  endpoint: Omit<SeerrEndpointDraft, 'apiKey'>;
  secretReference: string;
  secretConfigured: true;
  radarr: SeerrDestination;
  sonarr: SeerrDestination;
  userCreationMode: ServiceUserCreationMode;
  verifiedAt: string;
}

export interface SeerrConfigurationView
  extends Omit<SeerrConfiguration, 'secretReference'> {}

export interface SeerrRepository {
  get(): Promise<SeerrConfiguration | undefined>;
  compareAndSet(
    expectedRevision: number,
    next: SeerrConfiguration
  ): Promise<boolean>;
  delete(expectedRevision: number): Promise<boolean>;
}

export interface SeerrProbe {
  inspect(
    endpoint: SeerrEndpointDraft,
    signal?: AbortSignal
  ): Promise<SeerrProbeResult>;
}

export interface SeerrOptionsProvider {
  load(configuration: SeerrConfiguration): Promise<SeerrProbeResult>;
  createTag(
    configuration: SeerrConfiguration,
    kind: ArrKind,
    serverId: number,
    label: string
  ): Promise<{ id: number; label: string }>;
}

const normalizeSeerrEndpoint = (
  draft: SeerrEndpointDraft
): SeerrEndpointDraft => {
  const hostname = draft.hostname.trim().toLowerCase();
  if (
    !hostname ||
    hostname.includes('://') ||
    hostname.includes('/') ||
    !Number.isInteger(draft.port) ||
    draft.port < 1 ||
    draft.port > 65535 ||
    !draft.apiKey.trim()
  ) {
    throw new DownloadConfigurationError(
      'invalid-endpoint',
      'Hostname, port from 1 through 65535, and API key are required.'
    );
  }
  const externalUrl = normalizeExternalUrl(draft.externalUrl);
  return {
    hostname,
    port: draft.port,
    useSsl: draft.useSsl,
    apiKey: draft.apiKey.trim(),
    urlBase: normalizePath(draft.urlBase),
    ...(externalUrl ? { externalUrl } : {}),
  };
};

const validateSeerrDestination = (
  destination: SeerrDestination,
  servers: readonly SeerrServer[],
  options: Readonly<Record<number, SeerrDestinationOptions>>
): void => {
  if (destination.serverId === undefined) {
    if (
      destination.profileId !== undefined ||
      destination.rootFolder !== undefined ||
      destination.tagIds.length > 0
    ) {
      throw new DownloadConfigurationError(
        'invalid-selection',
        'Choose a server before selecting its profile, root, or tags.'
      );
    }
    return;
  }
  const serverOptions = options[destination.serverId];
  if (
    !servers.some((server) => server.id === destination.serverId) ||
    !serverOptions ||
    destination.profileId === undefined ||
    !serverOptions.profiles.some(
      (profile) => profile.id === destination.profileId
    ) ||
    !destination.rootFolder ||
    !serverOptions.rootFolders.some(
      (folder) => folder.path === destination.rootFolder
    ) ||
    destination.tagIds.some(
      (tagId) => !serverOptions.tags.some((tag) => tag.id === tagId)
    )
  ) {
    throw new DownloadConfigurationError(
      'invalid-selection',
      'The selected Seerr server defaults are incomplete or stale.'
    );
  }
};

export class SeerrConfigurationService {
  private readonly tests = new Map<
    string,
    { endpoint: SeerrEndpointDraft; result: SeerrProbeResult }
  >();

  public constructor(
    private readonly repository: SeerrRepository,
    private readonly vault: ArrVault,
    private readonly probe: SeerrProbe,
    private readonly now: () => Date,
    private readonly optionsProvider?: SeerrOptionsProvider
  ) {}

  public async get(): Promise<SeerrConfigurationView | undefined> {
    const stored = await this.repository.get();
    if (!stored) return undefined;
    const { secretReference: _secretReference, ...view } = stored;
    return view;
  }

  public async test(
    draft: SeerrEndpointDraft,
    signal?: AbortSignal
  ): Promise<{ testReceipt: string; options: SeerrProbeResult }> {
    const endpoint = normalizeSeerrEndpoint(draft);
    const result = await this.probe.inspect(endpoint, signal);
    const testReceipt = randomUUID();
    this.tests.set(testReceipt, { endpoint, result });
    return { testReceipt, options: result };
  }

  public async options(): Promise<SeerrProbeResult> {
    const configuration = await this.repository.get();
    if (!configuration || !this.optionsProvider) {
      throw new DownloadConfigurationError(
        'invalid-selection',
        'Connect and verify Seerr before loading collection destinations.'
      );
    }
    return this.optionsProvider.load(configuration);
  }

  public async createTag(
    kind: ArrKind,
    serverId: number,
    label: string
  ): Promise<{ id: number; label: string }> {
    const configuration = await this.repository.get();
    const normalized = label.trim();
    if (
      !configuration ||
      !this.optionsProvider ||
      !normalized ||
      normalized.length > 64
    ) {
      throw new DownloadConfigurationError(
        'invalid-selection',
        'A verified Seerr connection and tag name containing 1 through 64 characters are required.'
      );
    }
    const options = await this.optionsProvider.load(configuration);
    const servers =
      kind === 'radarr' ? options.servers.radarr : options.servers.sonarr;
    if (!servers.some((server) => server.id === serverId)) {
      throw new DownloadConfigurationError(
        'invalid-selection',
        'The selected Seerr destination server no longer exists.'
      );
    }
    return this.optionsProvider.createTag(
      configuration,
      kind,
      serverId,
      normalized
    );
  }

  public async save(command: {
    expectedRevision: number;
    endpoint: SeerrEndpointDraft;
    testReceipt: string;
    radarr: SeerrDestination;
    sonarr: SeerrDestination;
    userCreationMode: ServiceUserCreationMode;
  }): Promise<SeerrConfigurationView> {
    const endpoint = normalizeSeerrEndpoint(command.endpoint);
    const tested = this.tests.get(command.testReceipt);
    if (!tested || !sameEndpoint(
      { kind: 'radarr', name: 'seerr', ...tested.endpoint },
      { kind: 'radarr', name: 'seerr', ...endpoint }
    )) {
      throw new DownloadConfigurationError(
        'test-required',
        'Test this exact Seerr endpoint before saving.'
      );
    }
    validateSeerrDestination(
      command.radarr,
      tested.result.servers.radarr,
      tested.result.radarrServerOptions
    );
    validateSeerrDestination(
      command.sonarr,
      tested.result.servers.sonarr,
      tested.result.sonarrServerOptions
    );
    const current = await this.repository.get();
    if ((current?.revision ?? 0) !== command.expectedRevision) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Seerr settings changed; reload and retry.'
      );
    }
    const secretReference = await this.vault.store(endpoint.apiKey);
    const { apiKey: _apiKey, ...publicEndpoint } = endpoint;
    const next: SeerrConfiguration = {
      revision: command.expectedRevision + 1,
      endpoint: publicEndpoint,
      secretReference,
      secretConfigured: true,
      radarr: command.radarr,
      sonarr: command.sonarr,
      userCreationMode: command.userCreationMode,
      verifiedAt: this.now().toISOString(),
    };
    if (
      !(await this.repository.compareAndSet(
        command.expectedRevision,
        next
      ))
    ) {
      await this.vault.remove(secretReference);
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Seerr settings changed; reload and retry.'
      );
    }
    if (current) await this.vault.remove(current.secretReference);
    this.tests.delete(command.testReceipt);
    return (await this.get())!;
  }

  public async removalImpact(): Promise<{
    configuration: SeerrConfigurationView;
    consequences: readonly string[];
  }> {
    const configuration = await this.get();
    if (!configuration) {
      throw new DownloadConfigurationError(
        'invalid-selection',
        'The Seerr connection no longer exists.'
      );
    }
    return {
      configuration,
      consequences: [
        'Plex watchlist synchronization will be disabled until Seerr is reconnected.',
        'Saved Radarr and Sonarr servers will remain configured.',
        'Existing Seerr users and requests will not be deleted.',
      ],
    };
  }

  public async remove(command: {
    expectedRevision: number;
    confirmed: boolean;
  }): Promise<void> {
    const current = await this.repository.get();
    if (!current || current.revision !== command.expectedRevision) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Seerr settings changed; reload and review disconnection again.'
      );
    }
    if (!command.confirmed) {
      throw new DownloadConfigurationError(
        'confirmation-required',
        'Confirm disconnection after reviewing every consequence.'
      );
    }
    if (!(await this.repository.delete(command.expectedRevision))) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Seerr settings changed; reload and review disconnection again.'
      );
    }
    await this.vault.remove(current.secretReference);
  }
}

export interface WatchlistDestinationOptions {
  servers: readonly {
    id: string;
    name: string;
    is4k: boolean;
    isDefault: boolean;
  }[];
  serverOptions: Readonly<Record<string, ArrProbeResult>>;
}

export interface WatchlistDestination {
  serverId?: string;
  profileId?: number;
  rootFolder?: string;
  tagIds: readonly number[];
  tagWithUsername: boolean;
  monitor: boolean;
  searchOnAdd: boolean;
  seasonFolders?: boolean;
}

export interface WatchlistSettings {
  revision: number;
  enableOwner: boolean;
  enableUsers: boolean;
  radarr: WatchlistDestination;
  sonarr: WatchlistDestination;
  lastSyncAt?: string;
}

export interface WatchlistSettingsRepository {
  get(): Promise<WatchlistSettings>;
  compareAndSet(
    expectedRevision: number,
    next: WatchlistSettings
  ): Promise<boolean>;
}

export interface WatchlistOptionsProvider {
  load(kind: ArrKind): Promise<WatchlistDestinationOptions>;
  createTag(
    kind: ArrKind,
    serverId: string,
    label: string
  ): Promise<{ id: number; label: string }>;
}

const validateWatchlistDestination = (
  destination: WatchlistDestination,
  options: WatchlistDestinationOptions,
  required: boolean,
  kind: ArrKind
): void => {
  if (!required && destination.serverId === undefined) return;
  if (!destination.serverId) {
    throw new DownloadConfigurationError(
      'invalid-selection',
      `Choose a ${kind === 'radarr' ? 'movie' : 'series'} server before enabling watchlist sync.`
    );
  }
  const serverOptions = options.serverOptions[destination.serverId];
  if (
    !options.servers.some((server) => server.id === destination.serverId) ||
    !serverOptions ||
    destination.profileId === undefined ||
    !serverOptions.profiles.some((profile) => profile.id === destination.profileId) ||
    !destination.rootFolder ||
    !serverOptions.rootFolders.some((folder) => folder.path === destination.rootFolder) ||
    destination.tagIds.some(
      (tagId) => !serverOptions.tags.some((tag) => tag.id === tagId)
    )
  ) {
    throw new DownloadConfigurationError(
      'invalid-selection',
      `The ${kind === 'radarr' ? 'movie' : 'series'} watchlist destination is incomplete or stale.`
    );
  }
};

export class WatchlistSettingsService {
  public constructor(
    private readonly repository: WatchlistSettingsRepository,
    private readonly optionsProvider: WatchlistOptionsProvider,
    private readonly seerrConfigured: () => Promise<boolean>
  ) {}

  public get(): Promise<WatchlistSettings> {
    return this.repository.get();
  }

  public options(kind: ArrKind): Promise<WatchlistDestinationOptions> {
    return this.optionsProvider.load(kind);
  }

  public async createTag(
    kind: ArrKind,
    serverId: string,
    label: string
  ): Promise<{ id: number; label: string }> {
    const normalized = label.trim();
    if (!normalized || normalized.length > 64) {
      throw new DownloadConfigurationError(
        'invalid-selection',
        'Tag names must contain 1 through 64 characters.'
      );
    }
    return this.optionsProvider.createTag(kind, serverId, normalized);
  }

  public async save(command: {
    expectedRevision: number;
    enableOwner: boolean;
    enableUsers: boolean;
    radarr: WatchlistDestination;
    sonarr: WatchlistDestination;
  }): Promise<WatchlistSettings> {
    const current = await this.repository.get();
    if (current.revision !== command.expectedRevision) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Watchlist settings changed; reload and retry.'
      );
    }
    if (command.enableUsers && !(await this.seerrConfigured())) {
      throw new DownloadConfigurationError(
        'invalid-selection',
        'Connect Seerr before enabling watchlist synchronization for all linked users.'
      );
    }
    const [radarrOptions, sonarrOptions] = await Promise.all([
      this.optionsProvider.load('radarr'),
      this.optionsProvider.load('sonarr'),
    ]);
    validateWatchlistDestination(
      command.radarr,
      radarrOptions,
      command.enableOwner,
      'radarr'
    );
    validateWatchlistDestination(
      command.sonarr,
      sonarrOptions,
      command.enableOwner,
      'sonarr'
    );
    const next: WatchlistSettings = {
      revision: current.revision + 1,
      enableOwner: command.enableOwner,
      enableUsers: command.enableUsers,
      radarr: command.radarr,
      sonarr: command.sonarr,
      ...(current.lastSyncAt ? { lastSyncAt: current.lastSyncAt } : {}),
    };
    if (!(await this.repository.compareAndSet(current.revision, next))) {
      throw new DownloadConfigurationError(
        'configuration-conflict',
        'Watchlist settings changed; reload and retry.'
      );
    }
    return next;
  }
}

export { HttpSeerrProvider } from './seerr.js';
export { HttpSeerrRequestCoordinator } from './seerr-request.js';
export {
  SpawnTrailerProcessRunner,
  YtDlpTrailerMediaSource,
  type PlaceholderMediaSource,
  type TrailerProcessRunner,
  type YtDlpTrailerMediaSourceOptions,
} from './trailer-acquisition.js';
export {
  HttpSeerrCollectionSourceClient,
  type SeerrCollectionSourceItem,
  type SeerrCollectionSubtype,
} from './seerr-source.js';

export interface PlexWebhookPayload {
  event: string;
  Account?: { id?: number; title?: string };
  Server?: { uuid?: string; title?: string };
  Metadata?: {
    ratingKey?: string | number;
    type?: string;
    title?: string;
    editionTitle?: string;
  };
}

export interface PlexWebhookStatus {
  state: 'waiting' | 'ignored' | 'processed' | 'failed';
  receivedAt?: string;
  event?: string;
  detail: string;
}

export interface PlexWatchedStateTarget {
  markUnplayed(ratingKey: string): Promise<void>;
}

const isPlaceholderWebhookItem = (
  metadata: NonNullable<PlexWebhookPayload['Metadata']>
): boolean =>
  Boolean(metadata.editionTitle?.toLowerCase().includes('trailer')) ||
  (metadata.type === 'episode' &&
    (metadata.title === 'Trailer' ||
      metadata.title === 'Trailer (Placeholder)'));

export class PlexPlaceholderWebhookService {
  private readonly processed = new Map<string, number>();
  private status: PlexWebhookStatus = {
    state: 'waiting',
    detail: 'No Plex webhook has been received yet.',
  };

  public constructor(
    private readonly target: PlexWatchedStateTarget,
    private readonly now: () => Date,
    private readonly duplicateWindowMs = 5 * 60 * 1000,
    private readonly expectedServerUuid: () => string | undefined = () => undefined
  ) {}

  public getStatus(): PlexWebhookStatus {
    return this.status;
  }

  public async receive(payload: PlexWebhookPayload): Promise<PlexWebhookStatus> {
    const receivedAt = this.now();
    const metadata = payload.Metadata;
    const expectedServer = this.expectedServerUuid();
    if (
      expectedServer &&
      payload.Server?.uuid !== expectedServer
    ) {
      this.status = {
        state: 'ignored',
        receivedAt: receivedAt.toISOString(),
        event: payload.event,
        detail: 'Event came from a different Plex server and was ignored.',
      };
      return this.status;
    }
    if (
      !['media.play', 'media.stop', 'media.scrobble'].includes(payload.event) ||
      !metadata?.ratingKey ||
      !isPlaceholderWebhookItem(metadata)
    ) {
      this.status = {
        state: 'ignored',
        receivedAt: receivedAt.toISOString(),
        event: payload.event,
        detail: 'Event received; no placeholder watched-state reset was needed.',
      };
      return this.status;
    }
    const ratingKey = String(metadata.ratingKey);
    const dedupeKey = [
      payload.event,
      ratingKey,
      payload.Account?.id ?? payload.Account?.title ?? '',
      payload.Server?.uuid ?? payload.Server?.title ?? '',
    ].join(':');
    const previous = this.processed.get(dedupeKey);
    if (
      previous !== undefined &&
      receivedAt.getTime() - previous < this.duplicateWindowMs
    ) {
      this.status = {
        state: 'ignored',
        receivedAt: receivedAt.toISOString(),
        event: payload.event,
        detail: 'Duplicate Plex event ignored safely.',
      };
      return this.status;
    }
    try {
      await this.target.markUnplayed(ratingKey);
      this.processed.set(dedupeKey, receivedAt.getTime());
      for (const [key, timestamp] of this.processed) {
        if (receivedAt.getTime() - timestamp >= this.duplicateWindowMs) {
          this.processed.delete(key);
        }
      }
      this.status = {
        state: 'processed',
        receivedAt: receivedAt.toISOString(),
        event: payload.event,
        detail: 'Placeholder detected and watched state reset.',
      };
    } catch {
      this.status = {
        state: 'failed',
        receivedAt: receivedAt.toISOString(),
        event: payload.event,
        detail: 'Placeholder detected, but Plex could not reset watched state.',
      };
    }
    return this.status;
  }
}
