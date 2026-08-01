import type {
  ApplicationLogEntry,
  BackgroundJob,
  CacheStatistic,
  CollectionPosterDesign,
  CollectionPosterWorkspace,
  GeneralSettings,
  ManagedCollection,
  OverlayTemplateSummary,
  PlexDiscoveredItem,
  PlexGeneratedCollectionReference,
  PosterOverlayWorkspace,
  PosterTestSearchItem,
  PlexLibraryGeneratorSubtype,
} from '@vynode/contracts';
import {
  ArrConfigurationService,
  ArrTagSourceClient,
  ArrRequestClient,
  DirectMissingMediaCoordinator,
  FileMissingRequestRepository,
  HttpArrProbe,
  HttpSeerrProvider,
  HttpSeerrCollectionSourceClient,
  HttpSeerrRequestCoordinator,
  MountedDirectoryBrowser,
  FilePlaceholderInventoryRepository,
  GenericPlaceholderMediaWriter,
  YtDlpTrailerMediaSource,
  PlaceholderLifecycleCoordinator,
  PlaceholderSettingsService,
  PlexWatchlistClient,
  PlexWatchlistSyncCoordinator,
  PlexPlaceholderWebhookService,
  SeerrConfigurationService,
  WatchlistSettingsService,
  type ArrConfiguration,
  type ArrKind,
  type ArrTagSourceItem,
  type MissingMediaCandidate,
  type MissingMediaExecutionReport,
  type PlaceholderCandidate,
  type SeerrConfiguration,
  type SeerrCollectionSourceItem,
  type SeerrCollectionSubtype,
  type WatchlistSettings,
} from '@vynode/downloads';
import { PlexLoginService, type IdentityRecord } from '@vynode/identity';
import {
  AniListClient,
  ImdbClient,
  IntegrationConfigurationService,
  LetterboxdClient,
  MaintainerrClient,
  MDBListClient,
  MyAnimeListClient,
  selectTraktRandomListUrl,
  TautulliClient,
  TmdbSourceClient,
  TraktClient,
  TraktOAuthService,
  type ImdbSourceItem,
  type AniListSourceItem,
  type IntegrationId,
  type MaintainerrOverlayItem,
  type MDBListSourceItem,
  type MyAnimeListSourceItem,
  type TautulliSourceItem,
  type TmdbSourceItem,
  type TraktOAuthTokens,
  type TraktSourceItem,
} from '@vynode/integrations';
import {
  CollectionPosterSynchronizationAssets,
  FileMissingCollectionMemberRepository,
  FilePlexDiscoveryRepository,
  ManagedCollectionSynchronizer,
  MissingMemberQuickSync,
  PlexCollectionPosterInputProvider,
  PlexDiscoveredItemSynchronizer,
  PlexDiscoveryCoordinator,
  PlexDiscoveryScanner,
  PlexHttpTransport,
  PlexManagedCollectionClient,
  PlexManagementClient,
  PlexLibraryGeneratorClient,
  PlexPersonCollectionClient,
  PlexServerConfigurationService,
  type PlexServerConfiguration,
} from '@vynode/media-servers';
import {
  createOnboardingState,
  OnboardingService,
  type OnboardingState,
} from '@vynode/onboarding';
import { composeSources } from '@vynode/planner';
import {
  createFileBackedOverlayApplication,
  evaluateOverlayConditionDetailed,
  FilePosterEditorAssetStore,
  NativeCollectionPosterRenderer,
  NativeOverlayRenderer,
  OverlayContextBuilder,
  PosterOperationCoordinator,
  generateLocalPosterFolders,
  populateLocalPosters as populateLocalPosterWorkspace,
  type OverlayApplicationItem,
  type OverlayContextValue,
  type PlexOverlayMedia,
} from '@vynode/poster-overlays';

import { execFileSync } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createControlPlane } from './app.js';
import { DashboardJobService } from './dashboard-jobs.js';

const developmentDataDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
  '.vynode-dev'
);
const posterEditorAssetStore = new FilePosterEditorAssetStore({
  directory: resolve(developmentDataDirectory, 'poster-editor-assets'),
});
const replaceStateFile = async (
  temporaryPath: string,
  destinationPath: string
): Promise<void> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporaryPath, destinationPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt >= 7 ||
        (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')
      )
        throw error;
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, 25 * 2 ** attempt)
      );
    }
  }
};
// The live preview uses the same durable asset repository as production composition.
// Keep live-preview settings durable so a backend rebuild tests restart safety.
const developmentStatePath = resolve(
  developmentDataDirectory,
  'onboarding.json'
);
const developmentAuthPath = resolve(
  developmentDataDirectory,
  'authentication.json'
);
const developmentSourcesPath = resolve(
  developmentDataDirectory,
  'sources.json'
);
const placeholderInventoryPath = resolve(
  developmentDataDirectory,
  'placeholder-inventory.json'
);
const genericPlaceholderMediaPath = resolve(
  developmentDataDirectory,
  '..',
  'packages',
  'downloads',
  'assets',
  'generic-placeholder.mp4'
);
const youtubeCookiesPath = resolve(
  developmentDataDirectory,
  'youtube-cookies.txt'
);
const trailerCachePath = resolve(developmentDataDirectory, 'trailer-cache');
const ytDlpExecutablePath = resolve(
  process.env.LOCALAPPDATA ?? developmentDataDirectory,
  'Microsoft',
  'WinGet',
  'Packages',
  'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'yt-dlp.exe'
);
const ytDlpFfmpegPath = resolve(
  process.env.LOCALAPPDATA ?? developmentDataDirectory,
  'Microsoft',
  'WinGet',
  'Packages',
  'yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'ffmpeg-N-125365-g9a01c1cb6a-win64-gpl',
  'bin'
);
const ytDlpDenoPath = resolve(
  process.env.LOCALAPPDATA ?? developmentDataDirectory,
  'Microsoft',
  'WinGet',
  'Packages',
  'DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'deno.exe'
);

interface DevelopmentAuthState {
  identities: IdentityRecord[];
  sessions: [string, string][];
}

interface DevelopmentSourcesState {
  fetchingPolicy: {
    revision: number;
    letterboxdUsePlainHttp: boolean;
    flixpatrolUsePlainHttp: boolean;
  };
  configurations: [IntegrationId, any][];
  secrets: [string, string][];
  downloads?: [string, ArrConfiguration][];
  seerr?: SeerrConfiguration;
  placeholders?: {
    revision: number;
    libraryRoots: Record<string, string>;
    skipYoutubeTrailerDownloads: boolean;
  };
  watchlists?: WatchlistSettings;
  plex?: PlexServerConfiguration;
  backgroundJobs?: BackgroundJob[];
  cacheStatistics?: CacheStatistic[];
  managedCollections?: ManagedCollection[];
  traktOAuth?: TraktOAuthTokens;
  posterOverlays?: PosterOverlayWorkspace;
}

const loadDevelopmentOnboarding = async (): Promise<OnboardingState> => {
  try {
    return JSON.parse(
      await readFile(developmentStatePath, 'utf8')
    ) as OnboardingState;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return createOnboardingState('vynode-development');
    }
    console.warn(
      `Ignoring unreadable development onboarding state at ${developmentStatePath}.`,
      error
    );
    return createOnboardingState('vynode-development');
  }
};

const saveDevelopmentOnboarding = async (
  state: OnboardingState
): Promise<void> => {
  await mkdir(dirname(developmentStatePath), { recursive: true });
  const temporaryPath = `${developmentStatePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await replaceStateFile(temporaryPath, developmentStatePath);
};

const loadDevelopmentAuth = async (): Promise<DevelopmentAuthState> => {
  try {
    return JSON.parse(
      await readFile(developmentAuthPath, 'utf8')
    ) as DevelopmentAuthState;
  } catch (error) {
    if (
      !(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
    ) {
      console.warn(
        `Ignoring unreadable development authentication state at ${developmentAuthPath}.`,
        error
      );
    }
    return { identities: [], sessions: [] };
  }
};

const defaultDevelopmentSources = (): DevelopmentSourcesState => ({
  fetchingPolicy: {
    revision: 0,
    letterboxdUsePlainHttp: false,
    flixpatrolUsePlainHttp: false,
  },
  configurations: [],
  secrets: [],
});

const loadDevelopmentSources = async (): Promise<DevelopmentSourcesState> => {
  try {
    return JSON.parse(
      await readFile(developmentSourcesPath, 'utf8')
    ) as DevelopmentSourcesState;
  } catch (error) {
    if (
      !(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
    ) {
      console.warn(
        `Ignoring unreadable development source state at ${developmentSourcesPath}.`,
        error
      );
    }
    return defaultDevelopmentSources();
  }
};

let onboarding = await loadDevelopmentOnboarding();
const developmentAuth = await loadDevelopmentAuth();
const developmentSources = await loadDevelopmentSources();
const readLocalDevelopmentPlexToken = (): string | undefined => {
  const fromEnvironment = process.env.VYNODE_DEV_PLEX_TOKEN?.trim();
  if (fromEnvironment) return fromEnvironment;
  if (process.platform !== 'win32') return undefined;
  try {
    const output = execFileSync(
      'reg.exe',
      [
        'query',
        'HKCU\\Software\\Plex, Inc.\\Plex Media Server',
        '/v',
        'PlexOnlineToken',
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    return output.match(/PlexOnlineToken\s+REG_SZ\s+(\S+)/)?.[1]?.trim();
  } catch {
    return undefined;
  }
};
const developmentPlexToken = readLocalDevelopmentPlexToken();
const realDevelopmentPlexEnabled = Boolean(developmentPlexToken);

const developmentPlexInput = (input: {
  host: string;
  port: number;
  transport: 'http' | 'https-verify' | 'https-allow-self-signed';
  webAppUrl?: string;
  autoEmptyTrash: boolean;
}) => ({
  ...input,
  host: input.host === 'plex.local' ? '127.0.0.1' : input.host,
});

const developmentPlexTransport = (input: {
  host: string;
  port: number;
  transport: 'http' | 'https-verify' | 'https-allow-self-signed';
  webAppUrl?: string;
  autoEmptyTrash: boolean;
}) =>
  new PlexHttpTransport({
    connection: developmentPlexInput(input),
    token: async () => developmentPlexToken ?? '',
    clientIdentifier: 'vynode-development-laptop',
    product: 'Vynode Development',
  });

const requireDevelopmentLaptopPlex = (): PlexServerConfiguration => {
  if (!realDevelopmentPlexEnabled || !plexConfiguration)
    throw new Error('Connect and verify Plex before changing posters.');
  if (plexConfiguration.name !== 'Laptop')
    throw new Error(
      `Plex poster mutations are restricted to Laptop; configured server is "${plexConfiguration.name}".`
    );
  return plexConfiguration;
};

const developmentPersonCollectionClient = (
  configuration: PlexServerConfiguration
) =>
  new PlexPersonCollectionClient({
    transport: developmentPlexTransport(configuration),
    machineIdentifier: configuration.machineIdentifier,
    verifiedServerName: configuration.name,
    allowedMutationServerNames: new Set(['Laptop']),
  });

const developmentLibraryGeneratorClient = (
  configuration: PlexServerConfiguration
) =>
  new PlexLibraryGeneratorClient({
    transport: developmentPlexTransport(configuration),
    machineIdentifier: configuration.machineIdentifier,
    verifiedServerName: configuration.name,
    allowedMutationServerNames: new Set(['Laptop']),
  });

type PlexJsonRecord = Record<string, unknown>;
const plexRecord = (value: unknown): PlexJsonRecord | undefined =>
  typeof value === 'object' && value !== null
    ? (value as PlexJsonRecord)
    : undefined;
const plexRecords = (value: unknown): readonly PlexJsonRecord[] =>
  Array.isArray(value)
    ? value
        .map(plexRecord)
        .filter((item): item is PlexJsonRecord => Boolean(item))
    : plexRecord(value)
      ? [plexRecord(value)!]
      : [];
const plexText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

let plexConfiguration: PlexServerConfiguration | undefined =
  developmentSources.plex;
const developmentPlaceholderMountRoots = [
  ...new Set(
    (plexConfiguration?.libraries ?? [])
      .filter(
        (library) =>
          library.available &&
          (library.type === 'movie' || library.type === 'show')
      )
      .flatMap((library) => library.locations)
      .map((location) => resolve(location))
  ),
];
let fetchingPolicy = developmentSources.fetchingPolicy;
let placeholderSettings = developmentSources.placeholders ?? {
  revision: 0,
  libraryRoots: {} as Record<string, string>,
  skipYoutubeTrailerDownloads: false,
};
let seerrConfiguration: SeerrConfiguration | undefined =
  developmentSources.seerr;
let watchlistSettings: WatchlistSettings = developmentSources.watchlists ?? {
  revision: 0,
  enableOwner: false,
  enableUsers: false,
  radarr: {
    tagIds: [],
    tagWithUsername: false,
    monitor: true,
    searchOnAdd: true,
  },
  sonarr: {
    tagIds: [],
    tagWithUsername: false,
    monitor: true,
    searchOnAdd: true,
    seasonFolders: true,
  },
};
const identities = new Map<string, IdentityRecord>(
  developmentAuth.identities.map((identity) => [identity.id, identity])
);
const sessions = new Map<string, string>(developmentAuth.sessions);
const saveDevelopmentAuth = async (): Promise<void> => {
  await mkdir(dirname(developmentAuthPath), { recursive: true });
  const temporaryPath = `${developmentAuthPath}.${process.pid}.tmp`;
  const state: DevelopmentAuthState = {
    identities: [...identities.values()],
    sessions: [...sessions.entries()],
  };
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await replaceStateFile(temporaryPath, developmentAuthPath);
};
const integrationConfigurations = new Map<IntegrationId, any>(
  developmentSources.configurations
);
const integrationSecrets = new Map<string, string>(developmentSources.secrets);
let traktOAuthTokens = developmentSources.traktOAuth;
const seerrProvider = new HttpSeerrProvider(
  (configuration) => integrationSecrets.get(configuration.secretReference),
  fetch,
  (kind, server) => {
    if (kind === 'radarr' && server.hostname === 'vynode-radarr-fresh')
      return 'http://127.0.0.1:17879';
    if (kind === 'sonarr' && server.hostname === 'vynode-sonarr-fresh')
      return 'http://127.0.0.1:18990';
    return undefined;
  }
);
const seerrRequestCoordinator = new HttpSeerrRequestCoordinator(
  (configuration) => integrationSecrets.get(configuration.secretReference)
);
const seerrCollectionSourceClient = new HttpSeerrCollectionSourceClient(
  (configuration) => integrationSecrets.get(configuration.secretReference)
);
const saveDevelopmentSources = async (): Promise<void> => {
  // Source and download services share one preview vault, so persist them atomically.
  await mkdir(dirname(developmentSourcesPath), { recursive: true });
  const temporaryPath = `${developmentSourcesPath}.${process.pid}.tmp`;
  const state: DevelopmentSourcesState = {
    fetchingPolicy,
    configurations: [...integrationConfigurations.entries()],
    secrets: [...integrationSecrets.entries()],
    downloads: [...downloadConfigurations.entries()],
    ...(seerrConfiguration ? { seerr: seerrConfiguration } : {}),
    placeholders: placeholderSettings,
    watchlists: watchlistSettings,
    ...(plexConfiguration ? { plex: plexConfiguration } : {}),
    backgroundJobs,
    cacheStatistics,
    managedCollections,
    ...(traktOAuthTokens ? { traktOAuth: traktOAuthTokens } : {}),
    posterOverlays: posterOverlayWorkspace,
  };
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await replaceStateFile(temporaryPath, developmentSourcesPath);
};
const traktOAuthService = new TraktOAuthService(
  {
    async get() {
      return traktOAuthTokens;
    },
    async save(tokens) {
      traktOAuthTokens = tokens;
      await saveDevelopmentSources();
    },
    async delete() {
      traktOAuthTokens = undefined;
      await saveDevelopmentSources();
    },
  },
  async () => {
    const configuration = integrationConfigurations.get('trakt');
    const reference = configuration?.secretReference;
    const clientSecret =
      typeof reference === 'string'
        ? integrationSecrets.get(reference)
        : undefined;
    const clientId =
      typeof configuration?.values?.clientId === 'string'
        ? configuration.values.clientId
        : undefined;
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  },
  () => new Date()
);
const downloadConfigurations = new Map<string, ArrConfiguration>(
  developmentSources.downloads ?? []
);
const missingRequestHistory = new FileMissingRequestRepository(
  resolve(developmentDataDirectory, 'missing-request-history.json')
);
const missingCollectionMembers = new FileMissingCollectionMemberRepository(
  resolve(developmentDataDirectory, 'missing-collection-members.json')
);
const arrClientForConfiguration = (configuration: ArrConfiguration) => {
  const apiKey = integrationSecrets.get(configuration.secretReference);
  if (!apiKey)
    throw new Error(
      `${configuration.endpoint.kind === 'radarr' ? 'Radarr' : 'Sonarr'} credentials are unavailable.`
    );
  return new ArrRequestClient({
    hostname: configuration.endpoint.hostname,
    port: configuration.endpoint.port,
    useSsl: configuration.endpoint.useSsl,
    urlBase: configuration.endpoint.urlBase,
    apiKey,
  });
};

const arrTagClientForConfiguration = (configuration: ArrConfiguration) => {
  const apiKey = integrationSecrets.get(configuration.secretReference);
  if (!apiKey)
    throw new Error(
      `${configuration.endpoint.kind === 'radarr' ? 'Radarr' : 'Sonarr'} credentials are unavailable.`
    );
  return new ArrTagSourceClient({
    kind: configuration.endpoint.kind,
    hostname: configuration.endpoint.hostname,
    port: configuration.endpoint.port,
    useSsl: configuration.endpoint.useSsl,
    urlBase: configuration.endpoint.urlBase,
    apiKey,
  });
};

const executePlexWatchlistSync = async (
  signal?: AbortSignal
): Promise<
  Awaited<ReturnType<PlexWatchlistSyncCoordinator['run']>> & {
    seerrTriggered: boolean;
  }
> => {
  signal?.throwIfAborted();
  const enabled = watchlistSettings.enableOwner || watchlistSettings.enableUsers;
  if (!enabled)
    return new PlexWatchlistSyncCoordinator(
      { async items() { return []; } },
      { async route() { return 'skipped'; } }
    ).run(false, signal).then((report) => ({ ...report, seerrTriggered: false }));
  const ownerIdentity = [...identities.values()].find(
    (identity) => identity.role === 'owner'
  );
  const ownerAccountToken = ownerIdentity
    ? integrationSecrets.get(ownerIdentity.tokenReference)
    : undefined;
  if (watchlistSettings.enableOwner && !ownerAccountToken)
    throw new Error(
      'Reconnect the Plex owner account before synchronizing its watchlist.'
    );
  if (watchlistSettings.enableUsers && !seerrConfiguration)
    throw new Error('Connect Seerr before synchronizing linked-user watchlists.');
  if (!watchlistSettings.enableOwner) {
    const report = await new PlexWatchlistSyncCoordinator(
      { async items() { return []; } },
      { async route() { return 'skipped'; } }
    ).run(true, signal);
    await seerrProvider.triggerWatchlistSync(seerrConfiguration!, signal);
    watchlistSettings = {
      ...watchlistSettings,
      revision: watchlistSettings.revision + 1,
      lastSyncAt: new Date().toISOString(),
    };
    await saveDevelopmentSources();
    return { ...report, seerrTriggered: true };
  }
  const movieServerId = watchlistSettings.radarr.serverId;
  const showServerId = watchlistSettings.sonarr.serverId;
  const movieConfiguration = movieServerId
    ? downloadConfigurations.get(movieServerId)
    : undefined;
  const showConfiguration = showServerId
    ? downloadConfigurations.get(showServerId)
    : undefined;
  if (
    !movieConfiguration ||
    movieConfiguration.endpoint.kind !== 'radarr' ||
    !showConfiguration ||
    showConfiguration.endpoint.kind !== 'sonarr'
  )
    throw new Error(
      'Complete and save both Radarr and Sonarr watchlist destinations before running synchronization.'
    );
  const movieProfileId = watchlistSettings.radarr.profileId;
  const movieRoot = watchlistSettings.radarr.rootFolder;
  const showProfileId = watchlistSettings.sonarr.profileId;
  const showRoot = watchlistSettings.sonarr.rootFolder;
  if (!movieProfileId || !movieRoot || !showProfileId || !showRoot)
    throw new Error(
      'Complete and save both Radarr and Sonarr watchlist destinations before running synchronization.'
    );
  const movieClient = arrClientForConfiguration(movieConfiguration);
  const showClient = arrClientForConfiguration(showConfiguration);
  const report = await new PlexWatchlistSyncCoordinator(
    new PlexWatchlistClient(
      ownerAccountToken!,
      fetch,
      'vynode-development-owner'
    ),
    {
      async route(item, routeSignal) {
      const result =
        item.mediaType === 'movie'
          ? item.tmdbId && item.year
            ? await movieClient.addMovie(
                {
                  title: item.title,
                  year: item.year,
                  tmdbId: item.tmdbId,
                  profileId: movieProfileId,
                  rootFolder: movieRoot,
                  minimumAvailability:
                    movieConfiguration.selection.kind === 'radarr'
                      ? movieConfiguration.selection.minimumAvailability
                      : 'released',
                  tagIds: watchlistSettings.radarr.tagIds,
                  monitor: watchlistSettings.radarr.monitor,
                  searchOnAdd: watchlistSettings.radarr.searchOnAdd,
                  tagExistingItems: true,
                },
                routeSignal
              )
            : undefined
          : item.tvdbId
            ? await showClient.addSeries(
                {
                  title: item.title,
                  tvdbId: item.tvdbId,
                  profileId: showProfileId,
                  rootFolder: showRoot,
                  tagIds: watchlistSettings.sonarr.tagIds,
                  monitorType: watchlistSettings.sonarr.monitor
                    ? showConfiguration.selection.kind === 'sonarr'
                      ? showConfiguration.selection.monitorType
                      : 'all'
                    : 'none',
                  seriesType:
                    showConfiguration.selection.kind === 'sonarr'
                      ? showConfiguration.selection.seriesType
                      : 'standard',
                  seasonFolders:
                    watchlistSettings.sonarr.seasonFolders ?? true,
                  searchOnAdd: watchlistSettings.sonarr.searchOnAdd,
                  tagExistingItems: true,
                },
                routeSignal
              )
            : undefined;
        if (!result || result.outcome === 'skipped-unmonitored')
          return 'skipped';
        return result.outcome;
      },
    }
  ).run(true, signal);
  if (watchlistSettings.enableUsers)
    await seerrProvider.triggerWatchlistSync(seerrConfiguration!, signal);
  watchlistSettings = {
    ...watchlistSettings,
    revision: watchlistSettings.revision + 1,
    lastSyncAt: new Date().toISOString(),
  };
  await saveDevelopmentSources();
  return {
    ...report,
    seerrTriggered: watchlistSettings.enableUsers,
  };
};

const directMissingMediaCoordinator = new DirectMissingMediaCoordinator({
  async configurations(kind) {
    return [...downloadConfigurations.values()].filter(
      (configuration) => configuration.endpoint.kind === kind
    );
  },
  async client(configuration) {
    return arrClientForConfiguration(configuration);
  },
});

const executeCollectionMissingMedia = async (
  collection: ManagedCollection,
  candidates: readonly MissingMediaCandidate[],
  signal: AbortSignal
): Promise<MissingMediaExecutionReport | undefined> => {
  const settings = collection.missingMediaSettings;
  if (
    !settings?.enabled ||
    candidates.length === 0
  )
    return undefined;
  if (settings.downloadMode === 'seerr' && !seerrConfiguration)
    throw new Error('Connect Seerr before requesting missing collection media.');
  const enabled = candidates.filter((candidate) =>
    candidate.mediaType === 'movie'
      ? settings.searchMissingMovies
      : settings.searchMissingTv
  );
  if (enabled.length === 0) return undefined;
  const operationKey = (candidate: MissingMediaCandidate) =>
    `${collection.id}:${candidate.key}`;
  await missingRequestHistory.begin(
    enabled.map((candidate) => ({
      operationKey: operationKey(candidate),
      candidateKey: candidate.key,
      tmdbId: candidate.tmdbId ?? 0,
      ...(candidate.tvdbId ? { tvdbId: candidate.tvdbId } : {}),
      mediaType: candidate.mediaType,
      title: candidate.title,
      ...(candidate.year ? { year: candidate.year } : {}),
      collectionName: collection.title,
      collectionSource: collection.sourceType,
      requestService:
        settings.downloadMode === 'seerr'
          ? 'Seerr'
          : candidate.mediaType === 'movie'
            ? 'Radarr'
            : 'Sonarr',
      requestMethod: 'auto' as const,
    })),
    new Date()
  );
  const report =
    settings.downloadMode === 'seerr'
      ? await seerrRequestCoordinator.execute(
          seerrConfiguration!,
          enabled,
          settings,
          signal
        )
      : await directMissingMediaCoordinator.execute(
          enabled,
          {
            radarr: settings.directRadarr,
            sonarr: settings.directSonarr,
          },
          signal
        );
  const byKey = new Map(enabled.map((candidate) => [candidate.key, candidate]));
  await Promise.all(
    report.executions.map((execution) => {
      const candidate = byKey.get(execution.key);
      if (!candidate) return Promise.resolve();
      const requestStatus =
        execution.outcome === 'added'
          ? execution.message?.includes('pending')
            ? ('pending' as const)
            : ('approved' as const)
          : execution.outcome === 'existing'
            ? ('available' as const)
            : ('failed' as const);
      return missingRequestHistory.complete(
        operationKey(candidate),
        {
          requestStatus,
          ...(execution.serviceId !== undefined
            ? { serviceId: execution.serviceId }
            : {}),
          ...(execution.serverId ? { serverId: execution.serverId } : {}),
          ...(execution.message ? { notes: execution.message } : {}),
        },
        new Date()
      );
    })
  );
  return report;
};

const storeCollectionMissingMembers = async (
  collection: ManagedCollection,
  collectionRatingKey: string,
  candidates: readonly MissingMediaCandidate[]
): Promise<void> => {
  const fullSyncAt = new Date().toISOString();
  await missingCollectionMembers.replaceForCollection(
    collection.id,
    candidates.flatMap((candidate, originalPosition) => {
      if (!candidate.tmdbId && !candidate.tvdbId) return [];
      return [
        {
          id: `${collection.id}:${candidate.key}`,
          collectionId: collection.id,
          collectionRatingKey,
          libraryId: collection.libraryId,
          mediaType: candidate.mediaType,
          ...(candidate.tmdbId ? { tmdbId: candidate.tmdbId } : {}),
          ...(candidate.tvdbId ? { tvdbId: candidate.tvdbId } : {}),
          title: candidate.title,
          ...(candidate.year ? { year: candidate.year } : {}),
          originalPosition,
          source: collection.sourceType,
          fullSyncAt,
        },
      ];
    })
  );
};
const previewArrTags = new Map<string, { id: number; label: string }[]>();
const resetPlaceholderRatingKeys: string[] = [];
let genericPlaceholderMedia: Uint8Array | undefined;
const readGenericPlaceholderMedia = async (): Promise<Uint8Array> => {
  genericPlaceholderMedia ??= await readFile(genericPlaceholderMediaPath);
  return genericPlaceholderMedia;
};
const normalizedMediaPath = (value: string): string =>
  resolve(value).replaceAll('\\', '/').toLowerCase();
const isManagedPlaceholderPlexItem = (
  item: Record<string, unknown>
): boolean => {
  const labels = plexRecords(item.Label)
    .map((entry) => plexText(entry.tag).toLowerCase())
    .filter(Boolean);
  const files = plexRecords(item.Media).flatMap((media) =>
    plexRecords(media.Part).map((part) => plexText(part.file))
  );
  return (
    labels.some((label) =>
      ['trailer-placeholder', 'vynode-placeholder'].includes(label)
    ) ||
    files.some((file) =>
      normalizedMediaPath(file).includes('/vynode placeholders/')
    )
  );
};
const plexAvailablePlaceholderKeys = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<ReadonlySet<string>> => {
  if (!realDevelopmentPlexEnabled || !plexConfiguration) return new Set();
  const managedShowKeys = new Set<string>();
  if (collection.mediaType === 'show') {
    const leavesResponse = await developmentPlexTransport(
      plexConfiguration
    ).query(
      `/library/sections/${encodeURIComponent(collection.libraryId)}/all?type=4`,
      signal
    );
    const leavesContainer = plexRecord(
      plexRecord(leavesResponse)?.MediaContainer
    );
    for (const episode of plexRecords(leavesContainer?.Metadata)) {
      const files = plexRecords(episode.Media).flatMap((media) =>
        plexRecords(media.Part).map((part) => plexText(part.file))
      );
      if (
        files.some((file) =>
          normalizedMediaPath(file).includes('/vynode placeholders/')
        )
      ) {
        const showKey = plexText(episode.grandparentRatingKey);
        if (showKey) managedShowKeys.add(showKey);
      }
    }
  }
  const response = await developmentPlexTransport(plexConfiguration).query(
    `/library/sections/${encodeURIComponent(collection.libraryId)}/all?type=${
      collection.mediaType === 'movie' ? '1' : '2'
    }&includeGuids=1`,
    signal
  );
  const container = plexRecord(plexRecord(response)?.MediaContainer);
  const keys = new Set<string>();
  for (const item of plexRecords(container?.Metadata)) {
    if (
      isManagedPlaceholderPlexItem(item) ||
      managedShowKeys.has(plexText(item.ratingKey))
    )
      continue;
    for (const guid of plexRecords(item.Guid)) {
      const id = plexText(guid.id);
      const tmdb = id.match(/^tmdb:\/\/(\d+)$/i)?.[1];
      const tvdb = id.match(/^tvdb:\/\/(\d+)$/i)?.[1];
      if (tmdb) keys.add(`movie:tmdb:${tmdb}`);
      if (tvdb) keys.add(`show:tvdb:${tvdb}`);
    }
  }
  return keys;
};
const addPlaceholderLabels = async (
  ratingKey: string,
  labels: readonly string[],
  signal?: AbortSignal
): Promise<void> => {
  if (!plexConfiguration) throw new Error('Plex is not configured.');
  const transport = developmentPlexTransport(plexConfiguration);
  const response = await transport.query(
    `/library/metadata/${encodeURIComponent(ratingKey)}`,
    signal
  );
  const metadata = plexRecords(
    plexRecord(plexRecord(response)?.MediaContainer)?.Metadata
  )[0];
  const existing = plexRecords(metadata?.Label)
    .map((entry) => plexText(entry.tag).trim())
    .filter(Boolean);
  const combined = [
    ...existing,
    ...labels.filter(
      (label) =>
        !existing.some(
          (current) => current.toLowerCase() === label.toLowerCase()
        )
    ),
  ];
  const parameters = new URLSearchParams();
  combined.forEach((label, index) =>
    parameters.set(`label[${index}].tag.tag`, label)
  );
  parameters.set('label.locked', '1');
  await transport.put(
    `/library/metadata/${encodeURIComponent(ratingKey)}?${parameters}`,
    signal
  );
};
const executeCollectionPlaceholderLifecycle = async (
  collection: ManagedCollection,
  candidates: readonly MissingMediaCandidate[],
  signal?: AbortSignal
) => {
  const settings = collection.missingMediaSettings;
  if (!settings?.createPlaceholders) return undefined;
  if (!realDevelopmentPlexEnabled || !plexConfiguration)
    throw new Error('Connect and verify Plex before creating placeholders.');
  if (plexConfiguration.name !== 'Laptop')
    throw new Error(
      `Placeholder mutations are restricted to Laptop; configured server is "${plexConfiguration.name}".`
    );
  const libraryRoot = placeholderSettings.libraryRoots[collection.libraryId];
  if (!libraryRoot)
    throw new Error(
      `Configure a placeholder folder for Plex library ${collection.libraryId} before synchronization.`
    );
  const transport = developmentPlexTransport(plexConfiguration);
  const coordinator = new PlaceholderLifecycleCoordinator(
    new FilePlaceholderInventoryRepository(placeholderInventoryPath),
    new GenericPlaceholderMediaWriter(
      await readGenericPlaceholderMedia(),
      new YtDlpTrailerMediaSource({
        cacheDirectory: trailerCachePath,
        genericMedia: await readGenericPlaceholderMedia(),
        skipYoutube: () =>
          placeholderSettings.skipYoutubeTrailerDownloads,
        cookiesPath: youtubeCookiesPath,
        executable: ytDlpExecutablePath,
        ffmpegLocation: ytDlpFfmpegPath,
        useSystemCertificates: process.platform === 'win32',
        javascriptRuntime: ytDlpDenoPath,
      })
    ),
    {
      async refreshLibrary(libraryId, requestSignal) {
        await transport.post(
          `/library/sections/${encodeURIComponent(libraryId)}/refresh`,
          requestSignal
        );
      },
      async findByMediaPath(libraryId, mediaPath, requestSignal) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const response = await transport.query(
            `/library/sections/${encodeURIComponent(libraryId)}/all?type=${
              collection.mediaType === 'movie' ? '1' : '4'
            }&includeGuids=1`,
            requestSignal
          );
          const metadata = plexRecords(
            plexRecord(plexRecord(response)?.MediaContainer)?.Metadata
          );
          for (const item of metadata) {
            const files = plexRecords(item.Media).flatMap((media) =>
              plexRecords(media.Part).map((part) => plexText(part.file))
            );
            if (
              files.some(
                (file) =>
                  file && normalizedMediaPath(file) === normalizedMediaPath(mediaPath)
              )
            ) {
              const ratingKey =
                collection.mediaType === 'show'
                  ? plexText(item.grandparentRatingKey)
                  : plexText(item.ratingKey);
              if (ratingKey) return { ratingKey };
            }
          }
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
        }
        return undefined;
      },
      addLabels: addPlaceholderLabels,
    }
  );
  return coordinator.synchronize(
    {
      libraryId: collection.libraryId,
      libraryRoot,
      candidates: candidates as readonly PlaceholderCandidate[],
      availableKeys: await plexAvailablePlaceholderKeys(collection, signal),
      daysAhead: settings.placeholderDaysAhead,
      includeAllReleasedItems: settings.includeAllReleasedItems,
      releasedRetentionDays: settings.placeholderReleasedDays,
    },
    signal
  );
};
let discoveryRunning = false;
const alwaysActiveDiscoveredSchedule = {
  alwaysActive: true,
  removeFromPlexWhenInactive: false,
  inactiveVisibility: {
    usersHome: false,
    serverOwnerHome: false,
    libraryRecommended: false,
  },
  dateRanges: [],
  weeklySchedule: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
  },
};
const defaultDiscoveredPosterSettings = {
  autoGenerate: false,
  applyOverlaysDuringSync: false,
  useTmdbFranchisePoster: false,
  hideIndividualItems: false,
};
const defaultDiscoveredMetadataSettings = {
  enableCustomSummary: false,
  customSummary: '',
  enableCustomWallpaper: false,
  enableCustomTheme: false,
};
let discoveredPlexItems: PlexDiscoveredItem[] = [
  {
    id: 'plex-missing-classics',
    kind: 'pre-existing-collection',
    plexKey: '12001',
    name: 'Legacy Classics',
    libraryId: 'movies',
    libraryName: 'Movies',
    mediaType: 'movie',
    titleSort: 'Legacy Classics',
    homeOrder: 0,
    libraryOrder: 0,
    visibility: {
      usersHome: false,
      serverOwnerHome: false,
      libraryRecommended: false,
    },
    missing: true,
    isLinked: false,
    isUnlinked: false,
    lastValidatedAt: new Date().toISOString(),
    timeRestriction: alwaysActiveDiscoveredSchedule,
    posterSettings: defaultDiscoveredPosterSettings,
    metadataSettings: defaultDiscoveredMetadataSettings,
  },
];
const realDevelopmentPlexDiscovery = new FilePlexDiscoveryRepository({
  path: resolve(developmentDataDirectory, 'plex-discovery', 'laptop.json'),
});
const persistRealDevelopmentPlexItems = async (): Promise<void> => {
  if (!realDevelopmentPlexEnabled) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await realDevelopmentPlexDiscovery.get();
    const saved = await realDevelopmentPlexDiscovery.compareAndSet(
      current.revision,
      {
        ...current,
        revision: current.revision + 1,
        items: discoveredPlexItems,
      }
    );
    if (saved) return;
  }
  throw new Error(
    'Plex discovery changed concurrently; reload and retry the operation.'
  );
};
if (realDevelopmentPlexEnabled) {
  discoveredPlexItems = [...(await realDevelopmentPlexDiscovery.get()).items];
}
// A fresh installation must start empty. Examples belong in documentation,
// never in a user's runtime collection registry.
const defaultManagedCollections: ManagedCollection[] = [];
let managedCollections: ManagedCollection[] =
  developmentSources.managedCollections?.map((collection) => ({
    ...collection,
  })) ?? defaultManagedCollections;
const normalizeManagedCollectionLibraryIdentities = (): boolean => {
  if (!plexConfiguration) return false;
  let changed = false;
  managedCollections = managedCollections.map((collection) => {
    if (
      plexConfiguration!.libraries.some(
        (library) => library.key === collection.libraryId
      )
    )
      return collection;
    const matches = plexConfiguration!.libraries.filter(
      (library) =>
        library.available &&
        library.type === collection.mediaType &&
        library.title === collection.libraryName
    );
    if (matches.length !== 1) return collection;
    changed = true;
    return {
      ...collection,
      libraryId: matches[0]!.key,
      libraryName: matches[0]!.title,
      status: 'needs-sync' as const,
    };
  });
  return changed;
};
let migratedManagedLibraryIdentity =
  normalizeManagedCollectionLibraryIdentities();

const orderTraktItems = (
  items: readonly TraktSourceItem[],
  order: NonNullable<ManagedCollection['sourceSettings']>['itemOrder']
): readonly TraktSourceItem[] => {
  const ordered = [...items];
  if (order === 'reverse') return ordered.reverse();
  if (order === 'alphabetical')
    return ordered.sort((left, right) => left.title.localeCompare(right.title));
  if (order === 'rating-desc' || order === 'rating-asc')
    return ordered.sort((left, right) =>
      order === 'rating-desc'
        ? (right.rating ?? -1) - (left.rating ?? -1)
        : (left.rating ?? Number.MAX_VALUE) - (right.rating ?? Number.MAX_VALUE)
    );
  if (order === 'release-desc' || order === 'release-asc')
    return ordered.sort((left, right) => {
      const leftTime = Date.parse(left.releasedAt ?? '') || 0;
      const rightTime = Date.parse(right.releasedAt ?? '') || 0;
      return order === 'release-desc'
        ? rightTime - leftTime
        : leftTime - rightTime;
    });
  if (order === 'random') {
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const target =
        crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1);
      [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    }
  }
  return ordered;
};

const orderTautulliItems = (
  items: readonly TautulliSourceItem[],
  order: NonNullable<ManagedCollection['sourceSettings']>['itemOrder']
): readonly TautulliSourceItem[] => {
  const ordered = [...items];
  if (order === 'reverse') return ordered.reverse();
  if (order === 'alphabetical')
    return ordered.sort((left, right) => left.title.localeCompare(right.title));
  if (order === 'rating-desc' || order === 'rating-asc')
    return ordered.sort((left, right) =>
      order === 'rating-desc'
        ? (right.rating ?? -1) - (left.rating ?? -1)
        : (left.rating ?? Number.MAX_VALUE) - (right.rating ?? Number.MAX_VALUE)
    );
  if (order === 'release-desc' || order === 'release-asc')
    return ordered.sort((left, right) =>
      order === 'release-desc'
        ? (right.year ?? 0) - (left.year ?? 0)
        : (left.year ?? Number.MAX_VALUE) - (right.year ?? Number.MAX_VALUE)
    );
  if (order === 'random') {
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const target =
        crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1);
      [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    }
  }
  return ordered;
};

const plexMemberKeysForTraktItems = async (
  collection: ManagedCollection,
  items: readonly {
    tmdbId: number;
    tvdbId?: number;
  }[],
  signal?: AbortSignal
): Promise<ReadonlyMap<number, string>> => {
  if (!plexConfiguration)
    throw new Error('Connect and verify Plex before matching Trakt items.');
  const library = plexConfiguration.libraries.find(
    (candidate) =>
      candidate.key === collection.libraryId &&
      candidate.type === collection.mediaType &&
      candidate.available
  );
  if (!library) throw new Error('The collection Plex library is unavailable.');
  const desired = new Set(items.map((item) => item.tmdbId));
  const byTmdb = new Map<number, string>();
  const managedShowKeys = new Set<string>();
  if (collection.mediaType === 'show') {
    const leavesResponse = await developmentPlexTransport(
      plexConfiguration
    ).query(
      `/library/sections/${encodeURIComponent(library.key)}/all?type=4`,
      signal
    );
    const leavesContainer = plexRecord(
      plexRecord(leavesResponse)?.MediaContainer
    );
    for (const episode of plexRecords(leavesContainer?.Metadata)) {
      const files = plexRecords(episode.Media).flatMap((media) =>
        plexRecords(media.Part).map((part) => plexText(part.file))
      );
      if (
        files.some((file) =>
          normalizedMediaPath(file).includes('/vynode placeholders/')
        )
      ) {
        const showKey = plexText(episode.grandparentRatingKey);
        if (showKey) managedShowKeys.add(showKey);
      }
    }
  }
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const parameters = new URLSearchParams({
      type: collection.mediaType === 'movie' ? '1' : '2',
      includeGuids: '1',
      'X-Plex-Container-Start': String(start),
      'X-Plex-Container-Size': String(pageSize),
    });
    const response = await developmentPlexTransport(plexConfiguration).query(
      `/library/sections/${encodeURIComponent(library.key)}/all?${parameters}`,
      signal
    );
    const mediaContainer = plexRecord(plexRecord(response)?.MediaContainer);
    const metadata = plexRecords(mediaContainer?.Metadata);
    for (const item of metadata) {
      if (
        isManagedPlaceholderPlexItem(item) ||
        managedShowKeys.has(plexText(item.ratingKey))
      )
        continue;
      const ratingKey = plexText(item.ratingKey);
      const guidValues = [
        plexText(item.guid),
        ...plexRecords(item.Guid).map((guid) => plexText(guid.id)),
      ];
      for (const guid of guidValues) {
        const match =
          /(?:tmdb:\/\/|themoviedb:\/\/|com\.plexapp\.agents\.themoviedb:\/\/)(\d+)/i.exec(
            guid
          );
        const tmdbId = match ? Number(match[1]) : undefined;
        if (tmdbId && desired.has(tmdbId) && ratingKey)
          byTmdb.set(tmdbId, ratingKey);
      }
    }
    const totalSize = Number(mediaContainer?.totalSize ?? mediaContainer?.size);
    if (
      metadata.length < pageSize ||
      (Number.isFinite(totalSize) && start + metadata.length >= totalSize)
    )
      break;
  }
  return byTmdb;
};

const plexMemberKeysForImdbItems = async (
  collection: ManagedCollection,
  items: readonly ImdbSourceItem[],
  signal?: AbortSignal
): Promise<ReadonlyMap<string, string>> => {
  if (!plexConfiguration)
    throw new Error('Connect and verify Plex before matching IMDb items.');
  const library = plexConfiguration.libraries.find(
    (candidate) =>
      candidate.key === collection.libraryId &&
      candidate.type === collection.mediaType &&
      candidate.available
  );
  if (!library) throw new Error('The collection Plex library is unavailable.');
  const desired = new Set(items.map((item) => item.imdbId.toLowerCase()));
  const matches = new Map<string, string>();
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const parameters = new URLSearchParams({
      type: collection.mediaType === 'movie' ? '1' : '2',
      includeGuids: '1',
      'X-Plex-Container-Start': String(start),
      'X-Plex-Container-Size': String(pageSize),
    });
    const response = await developmentPlexTransport(plexConfiguration).query(
      `/library/sections/${encodeURIComponent(library.key)}/all?${parameters}`,
      signal
    );
    const mediaContainer = plexRecord(plexRecord(response)?.MediaContainer);
    const metadata = plexRecords(mediaContainer?.Metadata);
    for (const item of metadata) {
      const ratingKey = plexText(item.ratingKey);
      if (!ratingKey) continue;
      const guids = [
        plexText(item.guid),
        ...plexRecords(item.Guid).map((guid) => plexText(guid.id)),
      ];
      for (const guid of guids) {
        const imdbId = /imdb:\/\/(tt\d{6,})/i.exec(guid)?.[1]?.toLowerCase();
        if (imdbId && desired.has(imdbId)) matches.set(imdbId, ratingKey);
      }
    }
    const totalSize = Number(mediaContainer?.totalSize ?? mediaContainer?.size);
    if (
      metadata.length < pageSize ||
      (Number.isFinite(totalSize) && start + metadata.length >= totalSize)
    )
      break;
  }
  return matches;
};

const plexMemberKeysForMyAnimeListItems = async (
  collection: ManagedCollection,
  items: readonly MyAnimeListSourceItem[],
  signal?: AbortSignal
): Promise<ReadonlyMap<number, string>> => {
  if (!plexConfiguration)
    throw new Error('Connect and verify Plex before matching anime.');
  const library = plexConfiguration.libraries.find(
    (candidate) =>
      candidate.key === collection.libraryId &&
      candidate.type === collection.mediaType &&
      candidate.available
  );
  if (!library) throw new Error('The collection Plex library is unavailable.');
  const byTmdb = new Map<number, string>();
  const byTvdb = new Map<number, string>();
  const byImdb = new Map<string, string>();
  const byMal = new Map<number, string>();
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const parameters = new URLSearchParams({
      type: collection.mediaType === 'movie' ? '1' : '2',
      includeGuids: '1',
      'X-Plex-Container-Start': String(start),
      'X-Plex-Container-Size': String(pageSize),
    });
    const response = await developmentPlexTransport(plexConfiguration).query(
      `/library/sections/${encodeURIComponent(library.key)}/all?${parameters}`,
      signal
    );
    const mediaContainer = plexRecord(plexRecord(response)?.MediaContainer);
    const metadata = plexRecords(mediaContainer?.Metadata);
    for (const item of metadata) {
      const ratingKey = plexText(item.ratingKey);
      if (!ratingKey) continue;
      const guids = [
        plexText(item.guid),
        ...plexRecords(item.Guid).map((guid) => plexText(guid.id)),
      ];
      for (const guid of guids) {
        const tmdb = /(?:tmdb|themoviedb):\/\/(\d+)/i.exec(guid)?.[1];
        const tvdb = /(?:tvdb|thetvdb):\/\/(\d+)/i.exec(guid)?.[1];
        const imdb = /imdb:\/\/(tt\d{6,})/i.exec(guid)?.[1];
        const mal = /myanimelist:\/\/(\d+)/i.exec(guid)?.[1];
        if (tmdb) byTmdb.set(Number(tmdb), ratingKey);
        if (tvdb) byTvdb.set(Number(tvdb), ratingKey);
        if (imdb) byImdb.set(imdb.toLowerCase(), ratingKey);
        if (mal) byMal.set(Number(mal), ratingKey);
      }
    }
    const totalSize = Number(mediaContainer?.totalSize ?? mediaContainer?.size);
    if (
      metadata.length < pageSize ||
      (Number.isFinite(totalSize) && start + metadata.length >= totalSize)
    )
      break;
  }
  return new Map(
    items.flatMap((item) => {
      const ratingKey =
        byMal.get(item.malId) ??
        (collection.mediaType === 'show' && item.tvdbId
          ? byTvdb.get(item.tvdbId)
          : undefined) ??
        item.tmdbIds.map((id) => byTmdb.get(id)).find(Boolean) ??
        item.imdbIds.map((id) => byImdb.get(id)).find(Boolean);
      return ratingKey ? [[item.malId, ratingKey] as const] : [];
    })
  );
};

const plexMemberKeysForAniListItems = async (
  collection: ManagedCollection,
  items: readonly AniListSourceItem[],
  signal?: AbortSignal
): Promise<ReadonlyMap<number, string>> => {
  const syntheticItems: MyAnimeListSourceItem[] = items.map((item) => ({
    malId: item.malId ?? -item.anilistId,
    title: item.title,
    rank: item.rank,
    mediaType: item.mediaType,
    tmdbIds: item.tmdbIds,
    imdbIds: item.imdbIds,
    ...(item.tvdbId ? { tvdbId: item.tvdbId } : {}),
    ...(item.year ? { year: item.year } : {}),
    ...(item.rating !== undefined ? { rating: item.rating } : {}),
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
  }));
  const matches = await plexMemberKeysForMyAnimeListItems(
    collection,
    syntheticItems,
    signal
  );
  return new Map(
    items.flatMap((item) => {
      const ratingKey = matches.get(item.malId ?? -item.anilistId);
      return ratingKey ? [[item.anilistId, ratingKey] as const] : [];
    })
  );
};

const scanAvailablePlexMembers = async (
  libraryId: string,
  mediaType: 'movie' | 'show',
  signal?: AbortSignal
) => {
  if (!plexConfiguration)
    throw new Error('Connect and verify Plex before quick synchronization.');
  const library = plexConfiguration.libraries.find(
    (candidate) =>
      candidate.key === libraryId &&
      candidate.type === mediaType &&
      candidate.available
  );
  if (!library) throw new Error('The quick-sync Plex library is unavailable.');
  const available: {
    ratingKey: string;
    tmdbId?: number;
    tvdbId?: number;
  }[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    signal?.throwIfAborted();
    const parameters = new URLSearchParams({
      type: mediaType === 'movie' ? '1' : '2',
      includeGuids: '1',
      'X-Plex-Container-Start': String(start),
      'X-Plex-Container-Size': String(pageSize),
    });
    const response = await developmentPlexTransport(plexConfiguration).query(
      `/library/sections/${encodeURIComponent(library.key)}/all?${parameters}`,
      signal
    );
    const container = plexRecord(plexRecord(response)?.MediaContainer);
    const metadata = plexRecords(container?.Metadata);
    for (const item of metadata) {
      const ratingKey = plexText(item.ratingKey);
      if (!ratingKey) continue;
      const guids = [
        plexText(item.guid),
        ...plexRecords(item.Guid).map((guid) => plexText(guid.id)),
      ];
      const tmdbId = guids
        .map((guid) => /(?:tmdb|themoviedb):\/\/(\d+)/i.exec(guid)?.[1])
        .map(Number)
        .find((id) => Number.isInteger(id) && id > 0);
      const tvdbId = guids
        .map((guid) => /(?:tvdb|thetvdb):\/\/(\d+)/i.exec(guid)?.[1])
        .map(Number)
        .find((id) => Number.isInteger(id) && id > 0);
      available.push({
        ratingKey,
        ...(tmdbId ? { tmdbId } : {}),
        ...(tvdbId ? { tvdbId } : {}),
      });
    }
    const totalSize = Number(container?.totalSize ?? container?.size);
    if (
      metadata.length < pageSize ||
      (Number.isFinite(totalSize) && start + metadata.length >= totalSize)
    )
      break;
  }
  return available;
};

const plexMemberKeysForArrTagItems = async (
  collection: ManagedCollection,
  items: readonly ArrTagSourceItem[],
  signal?: AbortSignal
): Promise<ReadonlyMap<number, string>> => {
  const available = await scanAvailablePlexMembers(
    collection.libraryId,
    collection.mediaType,
    signal
  );
  const byTmdb = new Map(
    available.flatMap((item) =>
      item.tmdbId ? [[item.tmdbId, item.ratingKey] as const] : []
    )
  );
  const byTvdb = new Map(
    available.flatMap((item) =>
      item.tvdbId ? [[item.tvdbId, item.ratingKey] as const] : []
    )
  );
  return new Map(
    items.flatMap((item) => {
      const ratingKey =
        collection.mediaType === 'movie' && item.tmdbId
          ? byTmdb.get(item.tmdbId)
          : item.tvdbId
            ? byTvdb.get(item.tvdbId)
            : undefined;
      return ratingKey ? [[item.serviceId, ratingKey] as const] : [];
    })
  );
};

const collectionsQuickSync = new MissingMemberQuickSync({
  repository: missingCollectionMembers,
  async collections() {
    return managedCollections.map((collection) => ({
      id: collection.id,
      ...(collection.plexRatingKey
        ? { collectionRatingKey: collection.plexRatingKey }
        : {}),
      libraryId: collection.libraryId,
      mediaType: collection.mediaType,
    }));
  },
  scanLibrary: scanAvailablePlexMembers,
  async addMembers(collectionRatingKey, memberKeys, signal) {
    if (!realDevelopmentPlexEnabled || !plexConfiguration)
      throw new Error('Connect and verify Plex before quick synchronization.');
    const client = new PlexManagedCollectionClient({
      transport: developmentPlexTransport(plexConfiguration),
      machineIdentifier: plexConfiguration.machineIdentifier,
      verifiedServerName: plexConfiguration.name,
      allowedMutationServerNames: new Set(['Laptop']),
    });
    const result = await client.addMembers(
      collectionRatingKey,
      memberKeys,
      signal
    );
    const snapshot = await client.snapshot(collectionRatingKey, signal);
    const verified = new Set(snapshot.memberKeys);
    const failedVerification = memberKeys.filter((key) => !verified.has(key));
    const failures = [...new Set([...result.failures, ...failedVerification])];
    return {
      added: result.added.filter((key) => verified.has(key)),
      failures,
    };
  },
  now: () => new Date(),
});

const plexMemberKeysForTautulliItems = async (
  collection: ManagedCollection,
  items: readonly TautulliSourceItem[],
  signal?: AbortSignal
): Promise<ReadonlySet<string>> => {
  if (!plexConfiguration)
    throw new Error('Connect and verify Plex before matching Tautulli items.');
  const library = plexConfiguration.libraries.find(
    (candidate) =>
      candidate.key === collection.libraryId &&
      candidate.type === collection.mediaType &&
      candidate.available
  );
  if (!library) throw new Error('The collection Plex library is unavailable.');
  const desired = new Set(items.map((item) => item.ratingKey));
  const matched = new Set<string>();
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const parameters = new URLSearchParams({
      type: collection.mediaType === 'movie' ? '1' : '2',
      'X-Plex-Container-Start': String(start),
      'X-Plex-Container-Size': String(pageSize),
    });
    const response = await developmentPlexTransport(plexConfiguration).query(
      `/library/sections/${encodeURIComponent(library.key)}/all?${parameters}`,
      signal
    );
    const container = plexRecord(plexRecord(response)?.MediaContainer);
    const metadata = plexRecords(container?.Metadata);
    for (const row of metadata) {
      const ratingKey = plexText(row.ratingKey);
      if (desired.has(ratingKey)) matched.add(ratingKey);
    }
    const total = Number(container?.totalSize ?? container?.size);
    if (
      metadata.length < pageSize ||
      (Number.isFinite(total) && start + metadata.length >= total)
    )
      break;
  }
  return matched;
};

const resolveTraktSourceItems = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<readonly TraktSourceItem[]> => {
  const configuration = integrationConfigurations.get('trakt');
  const clientId =
    typeof configuration?.values.clientId === 'string'
      ? configuration.values.clientId
      : '';
  if (!configuration?.configured || !clientId)
    throw new Error(
      'Configure and test Trakt in Settings before synchronization.'
    );
  const settings = collection.sourceSettings;
  if (!settings) throw new Error('The Trakt collection source is incomplete.');
  const supportedSubtypes = new Set([
    'trending',
    'popular',
    'recommendations',
    'watchlist',
    'played',
    'watched',
    'collected',
    'favorited',
    'trakt_anticipated',
    'boxoffice',
    'custom',
    'random',
  ]);
  if (!supportedSubtypes.has(settings.subtype))
    throw new Error(
      `Trakt subtype "${settings.subtype}" is not implemented yet.`
    );
  const accountRequired = ['recommendations', 'watchlist'].includes(
    settings.subtype
  );
  const accountSupported =
    accountRequired ||
    settings.subtype === 'custom' ||
    settings.subtype === 'random';
  const accessToken = accountSupported
    ? await traktOAuthService.accessToken(
        'http://localhost:5174/settings/sources',
        signal
      )
    : undefined;
  const sourceItems = await new TraktClient({
    clientId,
    ...(accessToken ? { accessToken: async () => accessToken } : {}),
  }).source(
    {
      mediaType: collection.mediaType,
      subtype: (settings.subtype === 'random'
        ? 'custom'
        : settings.subtype === 'trakt_anticipated'
          ? 'anticipated'
          : settings.subtype) as
        | 'trending'
        | 'popular'
        | 'recommendations'
        | 'watchlist'
        | 'played'
        | 'watched'
        | 'collected'
        | 'favorited'
        | 'anticipated'
        | 'boxoffice'
        | 'custom',
      limit: settings.maxItems,
      ...(settings.timePeriod ? { period: settings.timePeriod } : {}),
      ...(settings.subtype === 'random'
        ? {
            customUrl: selectTraktRandomListUrl(settings.randomListUrls ?? []),
          }
        : settings.customUrl
          ? { customUrl: settings.customUrl }
          : {}),
    },
    signal
  );
  return orderTraktItems(sourceItems, settings.itemOrder);
};

const resolveSeerrSourceItems = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<readonly SeerrCollectionSourceItem[]> => {
  if (!seerrConfiguration)
    throw new Error(
      'Connect and verify Seerr in Settings before synchronization.'
    );
  const settings = collection.sourceSettings;
  if (!settings) throw new Error('The Seerr collection source is incomplete.');
  const supported = new Set<SeerrCollectionSubtype>([
    'global',
    'server_owner',
    'users',
    'user',
  ]);
  if (!supported.has(settings.subtype as SeerrCollectionSubtype))
    throw new Error(`Unsupported Seerr subtype "${settings.subtype}".`);
  const items = await seerrCollectionSourceClient.source(
    seerrConfiguration,
    {
      mediaType: collection.mediaType,
      subtype: settings.subtype as SeerrCollectionSubtype,
      limit: settings.maxItems,
      ...(settings.seerrUserId ? { requesterId: settings.seerrUserId } : {}),
    },
    signal
  );
  const ordered = [...items];
  if (settings.itemOrder === 'reverse') ordered.reverse();
  if (settings.itemOrder === 'alphabetical')
    ordered.sort((left, right) => left.title.localeCompare(right.title));
  if (settings.itemOrder === 'release-desc')
    ordered.sort((left, right) => (right.year ?? 0) - (left.year ?? 0));
  if (settings.itemOrder === 'release-asc')
    ordered.sort(
      (left, right) => (left.year ?? Infinity) - (right.year ?? Infinity)
    );
  if (settings.itemOrder === 'random') {
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const target =
        crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1);
      [ordered[index], ordered[target]] = [
        ordered[target]!,
        ordered[index]!,
      ];
    }
  }
  return ordered;
};

const resolveTmdbSourceItems = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<readonly TmdbSourceItem[]> => {
  const configuration=integrationConfigurations.get('tmdb');
  const reference=configuration?.secretReference;
  const apiKey=typeof reference==='string'?integrationSecrets.get(reference):'';
  if(!configuration?.configured||!apiKey) throw new Error('Configure and test TMDB in Settings before synchronization.');
  const settings=collection.sourceSettings; if(!settings) throw new Error('The TMDB collection source is incomplete.');
  const randomUrl=settings.subtype==='random'?(()=>{const pool=[...new Set((settings.randomListUrls??[]).map((value)=>value.trim()).filter(Boolean))];if(!pool.length)throw new Error('Add at least one TMDB URL to the random pool.');return pool[crypto.getRandomValues(new Uint32Array(1))[0]!%pool.length];})():undefined;
  const subtype=settings.subtype==='random'||settings.subtype==='custom'?'custom':settings.subtype==='advanced_custom_tmdb'?'discover':settings.subtype;
  if(!['trending_day','trending_week','popular','top_rated','custom','discover'].includes(subtype)) throw new Error(`Unsupported TMDB subtype "${settings.subtype}".`);
  const discover:Record<string,string|number|boolean>={sort_by:collection.mediaType==='movie'?collection.tmdbDiscoverSettings?.movieSortBy??'popularity.desc':collection.tmdbDiscoverSettings?.tvSortBy??'popularity.desc'};
  for(const group of collection.tmdbDiscoverSettings?.filterGroups??[]) for(const rule of group.filters){if(!rule.field)continue;const current=discover[rule.field];discover[rule.field]=current===undefined?rule.value:`${current}${rule.operator==='or'?'|':','}${rule.value}`;}
  const items=await new TmdbSourceClient({apiKey}).source({mediaType:collection.mediaType,subtype:subtype as 'trending_day'|'trending_week'|'popular'|'top_rated'|'custom'|'discover',limit:settings.maxItems,...(randomUrl||settings.customUrl?{customUrl:randomUrl??settings.customUrl}:{}),...(subtype==='discover'?{discover}:{}),...(settings.region?{region:settings.region}:{})},signal);
  const ordered=[...items]; if(settings.itemOrder==='reverse')ordered.reverse(); if(settings.itemOrder==='alphabetical')ordered.sort((a,b)=>a.title.localeCompare(b.title)); if(settings.itemOrder==='rating-desc')ordered.sort((a,b)=>(b.voteAverage??-1)-(a.voteAverage??-1)); if(settings.itemOrder==='rating-asc')ordered.sort((a,b)=>(a.voteAverage??Infinity)-(b.voteAverage??Infinity)); if(settings.itemOrder==='release-desc')ordered.sort((a,b)=>(b.year??0)-(a.year??0)); if(settings.itemOrder==='release-asc')ordered.sort((a,b)=>(a.year??Infinity)-(b.year??Infinity)); if(settings.itemOrder==='random')for(let index=ordered.length-1;index>0;index--){const target=crypto.getRandomValues(new Uint32Array(1))[0]!%(index+1);[ordered[index],ordered[target]]=[ordered[target]!,ordered[index]!];}
  return ordered;
};

const resolveLetterboxdSourceItems = async(collection:ManagedCollection,signal?:AbortSignal):Promise<readonly TmdbSourceItem[]>=>{
  if(collection.mediaType!=='movie')throw new Error('Letterboxd sources require a Movie library.');const settings=collection.sourceSettings;if(!settings)throw new Error('The Letterboxd collection source is incomplete.');
  const configuration=integrationConfigurations.get('tmdb');const reference=configuration?.secretReference;const apiKey=typeof reference==='string'?integrationSecrets.get(reference):'';if(!configuration?.configured||!apiKey)throw new Error('Configure and test TMDB before resolving Letterboxd titles.');
  const listed=await new LetterboxdClient().source({subtype:settings.subtype as 'custom'|'watchlist'|'random',limit:settings.maxItems,...(settings.customUrl?{url:settings.customUrl}:{}),...(settings.randomListUrls?{randomUrls:settings.randomListUrls}:{})},signal);const tmdb=new TmdbSourceClient({apiKey});const resolved:(TmdbSourceItem|undefined)[]=new Array(listed.length);let cursor=0;await Promise.all(Array.from({length:Math.min(5,listed.length)},async()=>{while(cursor<listed.length){const index=cursor++;const item=listed[index]!;resolved[index]=await tmdb.search('movie',item.title,item.year,signal);}}));return resolved.filter((item):item is TmdbSourceItem=>Boolean(item));
};

const resolveMultiSourceItems=async(collection:ManagedCollection,signal?:AbortSignal):Promise<{items:readonly TmdbSourceItem[];warnings:readonly string[]}>=>{
  const settings=collection.multiSourceSettings;if(!settings?.sources.length)throw new Error('Add at least one dependency to this multi-source collection.');const baseMax=collection.sourceSettings?.maxItems??100;
  const result=await composeSources(settings.sources.map((entry)=>({id:entry.id,priority:entry.priority,async load(){const child:ManagedCollection={...collection,sourceType:entry.type,sourceSettings:{subtype:entry.subtype,maxItems:baseMax,itemOrder:'default',...(entry.customUrl?{customUrl:entry.customUrl}:{}),...(entry.timePeriod?{timePeriod:entry.timePeriod}:{}),...(entry.customDays!==undefined?{customDays:entry.customDays}:{}),...(entry.minimumPlays!==undefined?{minimumPlays:entry.minimumPlays}:{}),...(entry.networkCountry?{networkCountry:entry.networkCountry}:{})}};let items:readonly {tmdbId:number;mediaType:'movie'|'show';title:string;year?:number}[];if(entry.type==='tmdb')items=await resolveTmdbSourceItems(child,signal);else if(entry.type==='letterboxd')items=await resolveLetterboxdSourceItems(child,signal);else if(entry.type==='trakt'||entry.type==='comingsoon')items=await resolveTraktSourceItems(child,signal);else if(entry.type==='mdblist')items=await resolveMDBListSourceItems(child,signal);else if(entry.type==='seerr')items=await resolveSeerrSourceItems(child,signal);else if(entry.type==='mal')items=(await resolveMyAnimeListSourceItems(child,signal)).flatMap((item)=>item.tmdbIds[0]?[{tmdbId:item.tmdbIds[0],mediaType:item.mediaType,title:item.title,...(item.year?{year:item.year}:{})}]:[]);else if(entry.type==='anilist')items=(await resolveAniListSourceItems(child,signal)).flatMap((item)=>item.tmdbIds[0]?[{tmdbId:item.tmdbIds[0],mediaType:item.mediaType,title:item.title,...(item.year?{year:item.year}:{})}]:[]);else throw new Error(`${entry.type} cannot yet provide a TMDB identity to multi-source composition.`);return items.map((item)=>({...item,key:`${item.mediaType}:tmdb:${item.tmdbId}`}));}})),{mode:settings.combineMode,limit:baseMax,cycleIndex:new Date().getUTCDate()-1},signal);
  return{items:result.items,warnings:result.failures.map((failure)=>`${failure.sourceId}: ${failure.message}`)};
};

const resolveImdbSourceItems = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<readonly ImdbSourceItem[]> => {
  const settings = collection.sourceSettings;
  if (!settings) throw new Error('The IMDb collection source is incomplete.');
  const supported = new Set([
    'top_250',
    'top_250_english',
    'popular',
    'boxoffice',
    'custom',
    'random',
  ]);
  if (!supported.has(settings.subtype))
    throw new Error(`Unsupported IMDb subtype "${settings.subtype}".`);
  const customUrl =
    settings.subtype === 'random'
      ? (() => {
          const pool = [
            ...new Set(
              (settings.randomListUrls ?? [])
                .map((value) => value.trim())
                .filter((value) => value && !value.startsWith('#'))
            ),
          ];
          if (!pool.length)
            throw new Error(
              'Add at least one valid IMDb list URL to the random pool.'
            );
          return pool[
            crypto.getRandomValues(new Uint32Array(1))[0]! % pool.length
          ]!;
        })()
      : settings.customUrl;
  const items = await new ImdbClient().source(
    {
      mediaType: collection.mediaType,
      subtype:
        settings.subtype === 'random'
          ? 'custom'
          : (settings.subtype as
              | 'top_250'
              | 'top_250_english'
              | 'popular'
              | 'boxoffice'
              | 'custom'),
      limit: settings.maxItems,
      ...(customUrl ? { customUrl } : {}),
    },
    signal
  );
  const ordered = [...items];
  if (settings.itemOrder === 'reverse') ordered.reverse();
  if (settings.itemOrder === 'alphabetical')
    ordered.sort((left, right) => left.title.localeCompare(right.title));
  if (settings.itemOrder === 'release-desc')
    ordered.sort((left, right) => (right.year ?? 0) - (left.year ?? 0));
  if (settings.itemOrder === 'release-asc')
    ordered.sort(
      (left, right) => (left.year ?? Infinity) - (right.year ?? Infinity)
    );
  if (settings.itemOrder === 'random') {
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const target =
        crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1);
      [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    }
  }
  return ordered;
};

const resolveMyAnimeListSourceItems = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<readonly MyAnimeListSourceItem[]> => {
  const configuration = integrationConfigurations.get('myanimelist');
  const reference = configuration?.secretReference;
  const clientId =
    typeof reference === 'string' ? integrationSecrets.get(reference) : '';
  if (!configuration?.configured || !clientId)
    throw new Error(
      'Configure and test MyAnimeList in Settings before synchronization.'
    );
  if (collection.mediaType !== 'show' && collection.mediaType !== 'movie')
    throw new Error('MyAnimeList supports movie and TV libraries only.');
  const settings = collection.sourceSettings;
  if (!settings) throw new Error('The MyAnimeList source is incomplete.');
  const supported = new Set([
    'all',
    'airing',
    'tv',
    'ova',
    'movie',
    'special',
    'bypopularity',
    'favorite',
  ]);
  if (!supported.has(settings.subtype))
    throw new Error(`Unsupported MyAnimeList ranking "${settings.subtype}".`);
  const items = await new MyAnimeListClient({ clientId }).source(
    {
      rankingType: settings.subtype as
        | 'all'
        | 'airing'
        | 'tv'
        | 'ova'
        | 'movie'
        | 'special'
        | 'bypopularity'
        | 'favorite',
      mediaType: collection.mediaType,
      limit: settings.maxItems,
    },
    signal
  );
  const byOrder = [...items];
  if (settings.itemOrder === 'reverse') byOrder.reverse();
  if (settings.itemOrder === 'alphabetical')
    byOrder.sort((left, right) => left.title.localeCompare(right.title));
  if (settings.itemOrder === 'rating-desc')
    byOrder.sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1));
  if (settings.itemOrder === 'rating-asc')
    byOrder.sort(
      (left, right) => (left.rating ?? Infinity) - (right.rating ?? Infinity)
    );
  if (settings.itemOrder === 'release-desc')
    byOrder.sort((left, right) => (right.year ?? 0) - (left.year ?? 0));
  if (settings.itemOrder === 'release-asc')
    byOrder.sort(
      (left, right) => (left.year ?? Infinity) - (right.year ?? Infinity)
    );
  if (settings.itemOrder === 'random') {
    for (let index = byOrder.length - 1; index > 0; index -= 1) {
      const target =
        crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1);
      [byOrder[index], byOrder[target]] = [byOrder[target]!, byOrder[index]!];
    }
  }
  return byOrder;
};

const resolveAniListSourceItems = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<readonly AniListSourceItem[]> => {
  if (collection.mediaType !== 'show' && collection.mediaType !== 'movie')
    throw new Error('AniList supports movie and TV libraries only.');
  const settings = collection.sourceSettings;
  if (!settings) throw new Error('The AniList source is incomplete.');
  const supported = new Set(['trending', 'popular', 'top_rated', 'custom']);
  if (!supported.has(settings.subtype))
    throw new Error(`Unsupported AniList source "${settings.subtype}".`);
  const items = await new AniListClient().source(
    {
      subtype: settings.subtype as
        | 'trending'
        | 'popular'
        | 'top_rated'
        | 'custom',
      mediaType: collection.mediaType,
      limit: settings.maxItems,
      ...(settings.subtype === 'custom' && settings.customUrl
        ? { customUrl: settings.customUrl }
        : {}),
    },
    signal
  );
  const ordered = [...items];
  if (settings.itemOrder === 'reverse') ordered.reverse();
  if (settings.itemOrder === 'alphabetical')
    ordered.sort((left, right) => left.title.localeCompare(right.title));
  if (settings.itemOrder === 'rating-desc')
    ordered.sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1));
  if (settings.itemOrder === 'rating-asc')
    ordered.sort(
      (left, right) => (left.rating ?? Infinity) - (right.rating ?? Infinity)
    );
  if (settings.itemOrder === 'release-desc')
    ordered.sort((left, right) => (right.year ?? 0) - (left.year ?? 0));
  if (settings.itemOrder === 'release-asc')
    ordered.sort(
      (left, right) => (left.year ?? Infinity) - (right.year ?? Infinity)
    );
  if (settings.itemOrder === 'random') {
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const target =
        crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1);
      [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    }
  }
  return ordered;
};

const resolveArrTagSourceItems = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<readonly ArrTagSourceItem[]> => {
  const kind =
    collection.sourceType === 'radarrtag'
      ? ('radarr' as const)
      : collection.sourceType === 'sonarrtag'
        ? ('sonarr' as const)
        : undefined;
  if (!kind) throw new Error('This collection is not an Arr tag source.');
  if (
    (kind === 'radarr' && collection.mediaType !== 'movie') ||
    (kind === 'sonarr' && collection.mediaType !== 'show')
  )
    throw new Error(
      kind === 'radarr'
        ? 'Radarr tag sources require a Movie library.'
        : 'Sonarr tag sources require a TV library.'
    );
  const serverId = collection.sourceSettings?.arrServerId?.trim();
  const tagId = collection.sourceSettings?.arrTagId;
  if (!serverId || !Number.isInteger(tagId) || Number(tagId) < 1)
    throw new Error(
      `Choose a verified ${kind === 'radarr' ? 'Radarr' : 'Sonarr'} server and tag.`
    );
  const selectedTagId = Number(tagId);
  const configuration = downloadConfigurations.get(serverId);
  if (!configuration || configuration.endpoint.kind !== kind)
    throw new Error(
      `The selected ${kind === 'radarr' ? 'Radarr' : 'Sonarr'} server is unavailable.`
    );
  const client = arrTagClientForConfiguration(configuration);
  if (!(await client.tags(signal)).some((tag) => tag.id === selectedTagId))
    throw new Error(
      `The selected ${kind === 'radarr' ? 'Radarr' : 'Sonarr'} tag no longer exists.`
    );
  const ordered = [...(await client.itemsForTag(selectedTagId, signal))];
  const order = collection.sourceSettings?.itemOrder ?? 'default';
  if (order === 'reverse') ordered.reverse();
  if (order === 'alphabetical')
    ordered.sort((left, right) => left.title.localeCompare(right.title));
  if (order === 'release-desc')
    ordered.sort((left, right) => (right.year ?? 0) - (left.year ?? 0));
  if (order === 'release-asc')
    ordered.sort(
      (left, right) => (left.year ?? Infinity) - (right.year ?? Infinity)
    );
  if (order === 'random') {
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const target =
        crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1);
      [ordered[index], ordered[target]] = [
        ordered[target]!,
        ordered[index]!,
      ];
    }
  }
  return ordered.slice(0, collection.sourceSettings?.maxItems ?? 50);
};

const resolveMDBListSourceItems = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<readonly MDBListSourceItem[]> => {
  const configuration = integrationConfigurations.get('mdblist');
  const reference = configuration?.secretReference;
  const apiKey =
    typeof reference === 'string' ? integrationSecrets.get(reference) : '';
  if (!configuration?.configured || !apiKey)
    throw new Error(
      'Configure and test MDBList in Settings before synchronization.'
    );
  const settings = collection.sourceSettings;
  if (!settings?.customUrl)
    throw new Error('Enter an MDBList list URL for this collection.');
  if (settings.subtype !== 'custom')
    throw new Error(`Unsupported MDBList subtype "${settings.subtype}".`);
  const items = await new MDBListClient({ apiKey }).source(
    {
      listUrl: settings.customUrl,
      mediaType: collection.mediaType,
      limit: settings.maxItems,
    },
    signal
  );
  return orderTraktItems(items, settings.itemOrder);
};

const tautulliClientFromConfiguration = (): TautulliClient => {
  const configuration = integrationConfigurations.get('tautulli');
  const reference = configuration?.secretReference;
  const apiKey =
    typeof reference === 'string' ? integrationSecrets.get(reference) : '';
  if (!configuration?.configured || !apiKey)
    throw new Error(
      'Configure and test Tautulli in Settings before synchronization.'
    );
  return new TautulliClient({
    hostname: String(configuration.values.hostname ?? ''),
    port: Number(configuration.values.port),
    useSsl: Boolean(configuration.values.useSsl),
    urlBase: String(configuration.values.urlBase ?? ''),
    apiKey,
  });
};

const maintainerrClientFromConfiguration = (): MaintainerrClient => {
  const configuration = integrationConfigurations.get('maintainerr');
  const reference = configuration?.secretReference;
  const apiKey =
    typeof reference === 'string' ? integrationSecrets.get(reference) : '';
  if (!configuration?.configured)
    throw new Error(
      'Configure and test Maintainerr in Settings before using deletion countdowns.'
    );
  return new MaintainerrClient({
    hostname: String(configuration.values.hostname ?? ''),
    port: Number(configuration.values.port),
    useSsl: Boolean(configuration.values.useSsl),
    urlBase: String(configuration.values.urlBase ?? ''),
    ...(apiKey ? { apiKey } : {}),
  });
};

const resolveTautulliSourceItems = async (
  collection: ManagedCollection,
  signal?: AbortSignal
): Promise<readonly TautulliSourceItem[]> => {
  const settings = collection.sourceSettings;
  if (!settings) throw new Error('The Tautulli source is incomplete.');
  const subtype = settings.subtype;
  if (
    ![
      'most_popular_plays',
      'most_popular_duration',
      'most_watched_plays',
      'most_watched_duration',
    ].includes(subtype)
  )
    throw new Error(`Unsupported Tautulli subtype "${subtype}".`);
  const days = settings.customDays ?? 30;
  const items = await tautulliClientFromConfiguration().source(
    {
      mediaType: collection.mediaType,
      statType: subtype.endsWith('_duration') ? 'duration' : 'plays',
      collectionType: subtype.startsWith('most_watched')
        ? 'most_watched'
        : 'most_popular',
      days,
      minimumPlays: settings.minimumPlays ?? 3,
      limit: settings.maxItems,
    },
    signal
  );
  return orderTautulliItems(items, settings.itemOrder);
};

const tautulliDashboardCollections = () => {
  const inputs = [
    ...managedCollections
      .filter((item) => Boolean(item.plexRatingKey))
      .map((item) => ({
        ratingKey: item.plexRatingKey!,
        title: item.title,
        mediaType: item.mediaType,
      })),
    ...discoveredPlexItems
      .filter(
        (item) => item.kind === 'pre-existing-collection' && !item.missing
      )
      .map((item) => ({
        ratingKey: item.plexKey,
        title: item.name,
        mediaType: item.mediaType,
      })),
  ];
  return [
    ...new Map(inputs.map((item) => [item.ratingKey, item] as const)).values(),
  ];
};
let generalSettings: GeneralSettings = {
  revision: 0,
  applicationTitle: 'Vynode',
  applicationUrl: 'http://localhost:5174',
  locale: 'en-US',
  cacheImages: true,
  imageCacheDays: 30,
  globalExcludedTitles: [],
  apiKeyPreview: 'vyn_••••••••7f2a',
  cacheItemCount: 184,
  cacheSizeBytes: 48_234_496,
  updatedAt: new Date().toISOString(),
};
const applicationLogEntries: ApplicationLogEntry[] = [
  {
    id: 'log-1',
    timestamp: new Date().toISOString(),
    level: 'info',
    label: 'Collections',
    message: 'Collection synchronization completed.',
    data: { processed: 3, created: 1, skipped: 0 },
  },
  {
    id: 'log-2',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    level: 'warn',
    label: 'Downloads',
    message: 'No default Radarr server is configured.',
    data: { mediaType: 'movie' },
  },
  {
    id: 'log-3',
    timestamp: new Date(Date.now() - 120_000).toISOString(),
    level: 'debug',
    label: 'Plex',
    message: 'Library metadata refreshed.',
    data: { libraries: 2, durationMs: 184 },
  },
  {
    id: 'log-4',
    timestamp: new Date(Date.now() - 180_000).toISOString(),
    level: 'error',
    label: 'Sources',
    message: 'Optional Tautulli connection is not configured.',
  },
];

const cronPartMatches = (
  value: number,
  expression: string,
  minimum: number
): boolean =>
  expression.split(',').some((part) => {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!match) return false;
    const start = match[2] === undefined ? minimum : Number(match[2]);
    const end =
      match[1] === '*'
        ? Number.POSITIVE_INFINITY
        : match[3] === undefined
          ? start
          : Number(match[3]);
    const step = match[4] === undefined ? 1 : Number(match[4]);
    return value >= start && value <= end && (value - start) % step === 0;
  });

const nextCronExecutions = (
  cronSchedule: string,
  after = new Date(),
  count = 2
): Date[] => {
  const [seconds, minutes, hours, days, months, weekdays] =
    cronSchedule.split(/\s+/);
  if (!seconds || !minutes || !hours || !days || !months || !weekdays)
    return [];
  const results: Date[] = [];
  const cursor = new Date(after);
  cursor.setMilliseconds(0);
  cursor.setSeconds(0);
  const minuteLimit = 1_070_000;
  for (
    let offset = 0;
    offset <= minuteLimit && results.length < count;
    offset += 1
  ) {
    const minute = new Date(cursor.getTime() + offset * 60_000);
    if (
      !cronPartMatches(minute.getMinutes(), minutes, 0) ||
      !cronPartMatches(minute.getHours(), hours, 0) ||
      !cronPartMatches(minute.getDate(), days, 1) ||
      !cronPartMatches(minute.getMonth() + 1, months, 1) ||
      !cronPartMatches(minute.getDay(), weekdays, 0)
    )
      continue;
    for (let second = 0; second < 60 && results.length < count; second += 1) {
      if (!cronPartMatches(second, seconds, 0)) continue;
      const candidate = new Date(minute);
      candidate.setSeconds(second);
      if (candidate > after) results.push(candidate);
    }
  }
  return results;
};

let backgroundJobs: BackgroundJob[] = developmentSources.backgroundJobs?.map(
  ({ startedAt: _startedAt, ...job }) => ({ ...job, running: false })
) ?? [
  {
    id: 'plex-collections-sync',
    name: 'Plex Collections Sync',
    type: 'process',
    interval: 'hours',
    cronSchedule: '0 0 */6 * * *',
    nextExecutionTime: new Date(Date.now() + 21_600_000).toISOString(),
    followingExecutionTime: new Date(Date.now() + 43_200_000).toISOString(),
    running: false,
  },
  {
    id: 'plex-collections-quick-sync',
    name: 'Collections Quick Sync',
    type: 'command',
    interval: 'minutes',
    cronSchedule: '0 */30 * * * *',
    nextExecutionTime: new Date(Date.now() + 1_800_000).toISOString(),
    running: false,
  },
  {
    id: 'overlay-application',
    name: 'Poster Overlay Application',
    type: 'process',
    interval: 'hours',
    cronSchedule: '0 15 */6 * * *',
    nextExecutionTime: new Date(Date.now() + 22_500_000).toISOString(),
    running: false,
  },
  {
    id: 'watchlist-sync',
    name: 'Plex Watchlist Sync',
    type: 'command',
    interval: 'minutes',
    cronSchedule: '0 */10 * * * *',
    nextExecutionTime: new Date(Date.now() + 600_000).toISOString(),
    running: false,
  },
];
backgroundJobs = backgroundJobs.map((job) => {
  if (Date.parse(job.nextExecutionTime) > Date.now()) return job;
  const [nextExecution, followingExecution] = nextCronExecutions(
    job.cronSchedule
  );
  return {
    ...job,
    nextExecutionTime: (
      nextExecution ?? new Date(Date.now() + 3_600_000)
    ).toISOString(),
    ...(followingExecution
      ? { followingExecutionTime: followingExecution.toISOString() }
      : {}),
  };
});
const backgroundJobControllers = new Map<string, AbortController>();
let cacheStatistics: CacheStatistic[] = developmentSources.cacheStatistics ?? [
  {
    id: 'tmdb',
    name: 'TMDB API',
    hits: 1248,
    misses: 92,
    keys: 340,
    keySizeBytes: 18420,
    valueSizeBytes: 2_481_330,
  },
  {
    id: 'trakt',
    name: 'Trakt API',
    hits: 484,
    misses: 38,
    keys: 122,
    keySizeBytes: 6410,
    valueSizeBytes: 822_140,
  },
  {
    id: 'images',
    name: 'Image metadata',
    hits: 932,
    misses: 64,
    keys: 184,
    keySizeBytes: 9840,
    valueSizeBytes: 48_234_496,
  },
];
if (migratedManagedLibraryIdentity) await saveDevelopmentSources();
let posterOverlayWorkspace: PosterOverlayWorkspace = {
  source: {
    revision: 0,
    source: 'plex',
    localRoot: '/config/plex-base-posters',
    updatedAt: new Date().toISOString(),
  },
  templates: [
    {
      id: 'resolution',
      name: 'Resolution',
      description: 'Displays the best available video resolution.',
      type: 'video',
      tags: ['video', 'quality'],
      enabled: true,
      displayOrder: 0,
      elementCount: 2,
      conditionSummary: 'Resolution is available',
      accent: '#f3ad32',
      design: {
        width: 1000,
        height: 1500,
        elements: [
          {
            id: 'resolution-tile',
            layerOrder: 0,
            type: 'tile',
            x: 55,
            y: 70,
            width: 250,
            height: 105,
            rotation: 0,
            name: 'Badge tile',
            properties: {
              fillColor: '#000000',
              fillOpacity: 72,
              borderColor: '#f3ad32',
              borderWidth: 3,
              lockCorners: true,
              borderRadiusTopLeft: 18,
            },
          },
          {
            id: 'resolution-value',
            layerOrder: 1,
            type: 'variable',
            x: 75,
            y: 88,
            width: 210,
            height: 75,
            rotation: 0,
            name: 'Resolution value',
            properties: {
              segments: [{ type: 'variable', field: 'resolution' }],
              fontSize: 54,
              fontFamily: 'Inter',
              fontWeight: 'bold',
              fontStyle: 'normal',
              color: '#ffffff',
              textAlign: 'center',
              opacity: 100,
            },
          },
        ],
      },
      condition: {
        sections: [
          { rules: [{ field: 'resolution', operator: 'exists', value: true }] },
        ],
      },
    },
    {
      id: 'audience-rating',
      name: 'Audience rating',
      description: 'Shows the audience score using a mapped icon.',
      type: 'rating',
      tags: ['rating'],
      enabled: true,
      displayOrder: 1,
      elementCount: 2,
      conditionSummary: 'Audience rating is greater than 0',
      accent: '#4cc38a',
      design: {
        width: 1000,
        height: 1500,
        elements: [
          {
            id: 'rating-icon',
            layerOrder: 0,
            type: 'mapped-icon',
            x: 760,
            y: 80,
            width: 120,
            height: 120,
            rotation: 0,
            name: 'Rating icon',
            properties: {
              field: 'rtAudienceScore',
              mappings: [{ value: 'fresh', iconPath: 'tomato-fresh.svg' }],
              layout: 'horizontal',
              iconSize: 96,
              spacingX: 8,
              spacingY: 8,
              maxIcons: 1,
              gridColumns: 1,
              grayscale: false,
              opacity: 100,
            },
          },
          {
            id: 'rating-value',
            layerOrder: 1,
            type: 'variable',
            x: 865,
            y: 90,
            width: 105,
            height: 80,
            rotation: 0,
            name: 'Rating value',
            properties: {
              segments: [
                { type: 'variable', field: 'rtAudienceScore' },
                { type: 'text', value: '%' },
              ],
              fontSize: 48,
              fontFamily: 'Inter',
              fontWeight: 'bold',
              fontStyle: 'normal',
              color: '#ffffff',
              textAlign: 'left',
              opacity: 100,
            },
          },
        ],
      },
      condition: {
        sections: [
          { rules: [{ field: 'rtAudienceScore', operator: 'gt', value: 0 }] },
        ],
      },
    },
    {
      id: 'coming-soon',
      name: 'Coming soon',
      description: 'Highlights media with an upcoming release date.',
      type: 'release-date',
      tags: ['date', 'status'],
      enabled: false,
      displayOrder: 2,
      elementCount: 1,
      conditionSummary: 'Release date is in the future',
      accent: '#8f7df0',
      design: {
        width: 1000,
        height: 1500,
        elements: [
          {
            id: 'coming-text',
            layerOrder: 0,
            type: 'variable',
            x: 100,
            y: 1280,
            width: 800,
            height: 110,
            rotation: 0,
            name: 'Release countdown',
            properties: {
              segments: [
                { type: 'text', value: 'COMING IN ' },
                { type: 'variable', field: 'daysUntilRelease' },
                { type: 'text', value: ' DAYS' },
              ],
              fontSize: 58,
              fontFamily: 'Inter',
              fontWeight: 'bold',
              fontStyle: 'normal',
              color: '#ffffff',
              textAlign: 'center',
              opacity: 100,
            },
          },
        ],
      },
      condition: {
        sections: [
          { rules: [{ field: 'daysUntilRelease', operator: 'gt', value: 0 }] },
        ],
      },
    },
    {
      id: 'maintainerr-countdown',
      name: 'Maintainerr countdown',
      description:
        'Shows the number of days before Maintainerr performs its scheduled action.',
      type: 'release-date',
      tags: ['maintainerr', 'countdown', 'status'],
      enabled: false,
      displayOrder: 3,
      elementCount: 1,
      conditionSummary: 'Maintainerr action is scheduled',
      accent: '#f5b842',
      design: {
        width: 1000,
        height: 1500,
        elements: [
          {
            id: 'maintainerr-countdown-text',
            layerOrder: 0,
            type: 'variable',
            x: 100,
            y: 1280,
            width: 800,
            height: 110,
            rotation: 0,
            name: 'Maintainerr action countdown',
            properties: {
              segments: [
                { type: 'text', value: 'LEAVING IN ' },
                { type: 'variable', field: 'daysUntilAction' },
                { type: 'text', value: ' DAYS' },
              ],
              fontSize: 58,
              fontFamily: 'Inter',
              fontWeight: 'bold',
              fontStyle: 'normal',
              color: '#ffffff',
              textAlign: 'center',
              opacity: 100,
            },
          },
        ],
      },
      condition: {
        sections: [
          { rules: [{ field: 'daysUntilAction', operator: 'gte', value: 0 }] },
        ],
      },
    },
  ],
  libraries: [
    {
      id: 'movies',
      name: 'Movies',
      type: 'movie',
      itemCount: 418,
      enabledTemplateIds: ['resolution', 'audience-rating'],
      tmdbLanguage: 'en-US',
      enableEpisodeScanning: false,
      maintainerrSeasonOverlays: false,
      maintainerrConfigured: false,
      status: 'complete',
      processedItems: 418,
      failedItems: 0,
      lastAppliedAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      id: 'tv',
      name: 'TV Shows',
      type: 'show',
      itemCount: 126,
      enabledTemplateIds: ['resolution'],
      tmdbLanguage: 'en-US',
      enableEpisodeScanning: true,
      maintainerrSeasonOverlays: true,
      maintainerrConfigured: false,
      status: 'idle',
      processedItems: 0,
      failedItems: 0,
    },
  ],
};
if (developmentSources.posterOverlays) {
  posterOverlayWorkspace = structuredClone(developmentSources.posterOverlays);
}
let posterLibraryCountsLoaded = false;
if (plexConfiguration) {
  const configuredPosterLibraries = plexConfiguration.libraries.filter(
    (library) =>
      library.available && (library.type === 'movie' || library.type === 'show')
  );
  if (configuredPosterLibraries.length) {
    posterOverlayWorkspace = {
      ...posterOverlayWorkspace,
      libraries: configuredPosterLibraries.map((library) => {
        const existing = posterOverlayWorkspace.libraries.find(
          (candidate) =>
            candidate.id === library.key ||
            (candidate.name === library.title &&
              candidate.type === library.type)
        );
        const { lastAppliedAt: _lastAppliedAt, ...existingWithoutRun } =
          existing ?? {
            itemCount: 0,
            enabledTemplateIds: [],
            tmdbLanguage: 'en-US',
            enableEpisodeScanning: false,
            maintainerrSeasonOverlays: false,
            maintainerrConfigured: false,
            status: 'idle' as const,
            processedItems: 0,
            failedItems: 0,
          };
        return {
          ...existingWithoutRun,
          id: library.key,
          name: library.title,
          type: library.type as 'movie' | 'show',
          itemCount: 0,
          processedItems: 0,
          failedItems: 0,
          status: 'idle' as const,
        };
      }),
    };
  }
}
const previewOverlayMedia = new Map<string, PlexOverlayMedia>([
  [
    'movie-101',
    {
      ratingKey: 'movie-101',
      title: 'The Example Horizon',
      year: 2026,
      mediaType: 'movie',
      durationMs: 8_160_000,
      userRating: 8.6,
      studio: 'Vynode Pictures',
      networks: ['Netflix'],
      directors: ['Morgan Vale'],
      genres: ['Science Fiction', 'Drama'],
      labels: ['Featured'],
      collections: ['trending-now'],
      addedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      lastViewedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      viewCount: 3,
      media: [
        {
          width: 3840,
          height: 2160,
          aspectRatio: 2.39,
          resolution: '4K',
          videoCodec: 'hevc',
          videoProfile: 'main 10',
          frameRate: '23.976',
          bitDepth: 10,
          hdr: true,
          dolbyVision: false,
          colorTrc: 'smpte2084',
          audioCodec: 'truehd',
          audioChannels: 8,
          audioChannelLayout: '7.1 Atmos',
          audioFormat: 'English (Dolby TrueHD Atmos 7.1)',
          audioLanguages: [{ code: 'en', name: 'English' }],
          subtitleLanguages: [
            { code: 'en', name: 'English' },
            { code: 'es', name: 'Spanish' },
          ],
          container: 'mkv',
          bitrateKbps: 58_400,
          fileSize: 61_200_000_000,
          filePath: '/media/Movies/The Example Horizon (2026)/movie.mkv',
        },
      ],
    },
  ],
  [
    'show-201',
    {
      ratingKey: 'show-201',
      title: 'Northern Station',
      year: 2024,
      mediaType: 'show',
      durationMs: 3_240_000,
      userRating: 7.9,
      studio: 'Northline Television',
      networks: ['Vynode Network'],
      genres: ['Drama'],
      labels: [],
      collections: ['top-anime'],
      addedAt: new Date(Date.now() - 18 * 86_400_000).toISOString(),
      viewCount: 1,
      media: [
        {
          width: 1920,
          height: 1080,
          resolution: '1080p',
          videoCodec: 'h264',
          bitDepth: 8,
          hdr: false,
          dolbyVision: false,
          audioCodec: 'eac3',
          audioChannels: 6,
          audioChannelLayout: '5.1',
          audioLanguages: [{ code: 'en', name: 'English' }],
          subtitleLanguages: [{ code: 'en', name: 'English' }],
          container: 'mkv',
          bitrateKbps: 8_200,
          fileSize: 3_450_000_000,
          filePath: '/media/TV/Northern Station/Season 01/episode.mkv',
        },
      ],
    },
  ],
]);
let maintainerrOverlayCache:
  | {
      expiresAt: number;
      items: readonly MaintainerrOverlayItem[];
    }
  | undefined;
let maintainerrOverlayRequest:
  | Promise<readonly MaintainerrOverlayItem[]>
  | undefined;
const loadMaintainerrOverlayItems = async (
  signal?: AbortSignal
): Promise<readonly MaintainerrOverlayItem[]> => {
  if (maintainerrOverlayCache && maintainerrOverlayCache.expiresAt > Date.now())
    return maintainerrOverlayCache.items;
  maintainerrOverlayRequest ??= maintainerrClientFromConfiguration()
    .overlayData(signal)
    .then((items) => {
      maintainerrOverlayCache = {
        expiresAt: Date.now() + 60_000,
        items,
      };
      return items;
    })
    .finally(() => {
      maintainerrOverlayRequest = undefined;
    });
  return maintainerrOverlayRequest;
};
const imdbOverlayCache = new Map<
  string,
  {
    expiresAt: number;
    value: Awaited<ReturnType<ImdbClient['title']>>;
  }
>();
const imdbOverlayRequests = new Map<
  string,
  Promise<Awaited<ReturnType<ImdbClient['title']>>>
>();
const loadImdbOverlayMetadata = async (
  imdbId: string,
  signal?: AbortSignal
) => {
  const cached = imdbOverlayCache.get(imdbId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let request = imdbOverlayRequests.get(imdbId);
  if (!request) {
    request = new ImdbClient()
      .title(imdbId, signal)
      .then((value) => {
        if (imdbOverlayCache.size >= 5_000) {
          const oldest = imdbOverlayCache.keys().next().value;
          if (oldest) imdbOverlayCache.delete(oldest);
        }
        imdbOverlayCache.set(imdbId, {
          expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
          value,
        });
        return value;
      })
      .finally(() => {
        imdbOverlayRequests.delete(imdbId);
      });
    imdbOverlayRequests.set(imdbId, request);
  }
  return request;
};
const previewContextBuilder = new OverlayContextBuilder([
  {
    name: 'IMDb',
    fields: new Set([
      'imdbRating',
      'imdbVotes',
      'imdbContentRating',
      'imdbGenres',
      'imdbKeywords',
      'imdbActors',
      'imdbDirectors',
      'imdbCreators',
      'imdbPlot',
      'imdbAlternateTitle',
      'imdbReleaseDate',
      'imdbRuntime',
    ]),
    async load(item, _fields, signal) {
      if (
        item.ratingKey.startsWith('movie-') ||
        item.ratingKey.startsWith('show-')
      ) {
        return {
          imdbRating: 8.4,
          imdbVotes: 124_500,
          imdbContentRating: item.mediaType === 'movie' ? 'PG-13' : 'TV-14',
          imdbGenres: ['Drama', 'Action'],
          imdbKeywords: ['first responder', 'firefighter'],
          imdbActors: ['Example Actor'],
          imdbDirectors: ['Example Director'],
          imdbCreators: ['Example Creator'],
          imdbPlot: 'IMDb plot summary for the selected title.',
          imdbAlternateTitle: item.title,
          imdbReleaseDate: item.releaseDate,
          imdbRuntime: item.durationMs
            ? Math.round(item.durationMs / 60_000)
            : undefined,
        };
      }
      if (!item.imdbId)
        return {
          imdbRating: item.imdbRating,
        };
      const metadata = await loadImdbOverlayMetadata(item.imdbId, signal);
      return {
        imdbRating: metadata.rating ?? item.imdbRating,
        imdbVotes: metadata.ratingCount,
        imdbContentRating: metadata.contentRating,
        imdbGenres: metadata.genres,
        imdbKeywords: metadata.keywords,
        imdbActors: metadata.actors,
        imdbDirectors: metadata.directors,
        imdbCreators: metadata.creators,
        imdbPlot: metadata.description,
        imdbAlternateTitle: metadata.alternateTitle,
        imdbReleaseDate: metadata.releaseDate,
        imdbRuntime: metadata.durationMinutes,
      };
    },
  },
  {
    name: 'Plex ratings',
    fields: new Set([
      'rtCriticsScore',
      'rtAudienceScore',
      'rtCertifiedFresh',
      'rtVerifiedHot',
    ]),
    async load(item) {
      if (
        item.ratingKey.startsWith('movie-') ||
        item.ratingKey.startsWith('show-')
      )
        return {
          rtCriticsScore: 91,
          rtAudienceScore: 83,
          rtCertifiedFresh: true,
        };
      return {
        rtCriticsScore: item.rtCriticsScore,
        rtAudienceScore: item.rtAudienceScore,
        rtCertifiedFresh: item.rtCertifiedFresh,
        rtVerifiedHot: item.rtVerifiedHot,
      };
    },
  },
  {
    name: 'maintainerr',
    fields: new Set(['daysUntilAction']),
    async load(item, _fields, signal) {
      const match = (await loadMaintainerrOverlayItems(signal)).find(
        (candidate) => candidate.mediaId === item.ratingKey
      );
      return {
        daysUntilAction: match?.daysRemaining,
      };
    },
  },
]);
const serializeOverlayContext = (
  value: OverlayContextValue
): string | number | boolean | null => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.join(', ');
  return value as string | number | boolean;
};
const previewBasePoster = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#354851"/><stop offset="1" stop-color="#070c0f"/></linearGradient></defs><rect width="1000" height="1500" fill="url(#g)"/></svg>'
);
const previewPlexPosters = new Map<string, Uint8Array>();
const previewPlexOverlayLabels = new Set<string>();
const previewPosterJobs = new Map<string, AbortController>();
const previewPosterCoordinator = new PosterOperationCoordinator();
const plexMetadataForRatingKey = async (
  ratingKey: string,
  signal?: AbortSignal
): Promise<PlexJsonRecord> => {
  const configuration = requireDevelopmentLaptopPlex();
  const response = await developmentPlexTransport(configuration).query(
    `/library/metadata/${encodeURIComponent(ratingKey)}?includeGuids=1`,
    signal
  );
  const metadata = plexRecords(
    plexRecord(plexRecord(response)?.MediaContainer)?.Metadata
  )[0];
  if (!metadata)
    throw new Error(`Plex did not return metadata for item ${ratingKey}.`);
  return metadata;
};
const plexPosterForRatingKey = async (
  ratingKey: string,
  signal?: AbortSignal
): Promise<Uint8Array> => {
  const configuration = requireDevelopmentLaptopPlex();
  const metadata = await plexMetadataForRatingKey(ratingKey, signal);
  const thumb = plexText(metadata.thumb);
  if (!thumb) throw new Error(`Plex item ${ratingKey} does not have a poster.`);
  const normalizedThumb =
    thumb.startsWith('http://') || thumb.startsWith('https://')
      ? `${new URL(thumb).pathname}${new URL(thumb).search}`
      : thumb;
  const parameters = new URLSearchParams({
    url: normalizedThumb,
    width: '1000',
    height: '1500',
    minSize: '1',
    upscale: '1',
  });
  return developmentPlexTransport(configuration).queryBinary(
    `/photo/:/transcode?${parameters}`,
    signal
  );
};
const developmentPlexPosterWriter = () =>
  new PlexManagementClient(
    developmentPlexTransport(requireDevelopmentLaptopPlex())
  );
const previewOverlayApplication = createFileBackedOverlayApplication(
  resolve(developmentDataDirectory, 'poster-overlays'),
  {
    acquisition: {
      async acquire(source, item, _language, signal) {
        signal?.throwIfAborted();
        if (realDevelopmentPlexEnabled && plexConfiguration)
          return {
            source: source === 'local' ? 'plex' : source,
            ...(source === 'local' ? { fallbackFrom: source } : {}),
            bytes: await plexPosterForRatingKey(item.ratingKey, signal),
          };
        return { source, bytes: previewBasePoster };
      },
    },
    contexts: previewContextBuilder,
    renderer: new NativeOverlayRenderer({
      assets: {
        async resolve(path, signal) {
          signal?.throwIfAborted();
          const match = /^asset:\/\/([0-9a-f-]{36})$/i.exec(path);
          if (!match?.[1])
            throw new Error(
              'The overlay references an unsupported asset path.'
            );
          const stored = await posterEditorAssetStore.read(match[1]);
          if (!stored)
            throw new Error(
              'The selected overlay asset is no longer available.'
            );
          return stored.bytes;
        },
      },
    }),
    plex: {
      async uploadPoster(ratingKey, bytes, signal) {
        signal?.throwIfAborted();
        if (realDevelopmentPlexEnabled && plexConfiguration) {
          await developmentPlexPosterWriter().uploadPoster(
            ratingKey,
            bytes,
            signal
          );
          return;
        }
        previewPlexPosters.set(ratingKey, bytes);
      },
      async setOverlayLabel(ratingKey, enabled, signal) {
        signal?.throwIfAborted();
        if (realDevelopmentPlexEnabled && plexConfiguration) {
          await developmentPlexPosterWriter().setOverlayLabel(
            ratingKey,
            enabled,
            signal
          );
          return;
        }
        if (enabled) previewPlexOverlayLabels.add(ratingKey);
        else previewPlexOverlayLabels.delete(ratingKey);
      },
    },
    coordinator: previewPosterCoordinator,
  }
);
const plexOverlayItem = (
  metadata: PlexJsonRecord,
  library: { key: string; title: string; type: 'movie' | 'show' }
): OverlayApplicationItem | undefined => {
  const normalizedResolution = (value: string): string => {
    const normalized = value.trim();
    if (/^\d{3,4}$/i.test(normalized)) return `${normalized}p`;
    if (/^4k$/i.test(normalized)) return '4K';
    if (/^sd$/i.test(normalized)) return 'SD';
    return normalized;
  };
  const ratingKey = plexText(metadata.ratingKey);
  const title = plexText(metadata.title);
  if (!ratingKey || !title) return undefined;
  const media = plexRecords(metadata.Media).map((entry) => {
    const part = plexRecords(entry.Part)[0];
    const videoStreams = plexRecords(part?.Stream).filter(
      (stream) => plexText(stream.streamType) === '1'
    );
    const audioStreams = plexRecords(part?.Stream).filter(
      (stream) => plexText(stream.streamType) === '2'
    );
    const width = Number(entry.width);
    const height = Number(entry.height);
    const primaryAudio = audioStreams.find(
      (stream) => plexText(stream.selected) === '1'
    ) ?? audioStreams[0];
    const channels = Number(primaryAudio?.channels ?? entry.audioChannels);
    const aspectRatio = Number(entry.aspectRatio);
    const bitDepth = Number(videoStreams[0]?.bitDepth);
    const dolbyVisionProfile = Number(videoStreams[0]?.DOVIProfile);
    const audioLanguages = audioStreams.map((stream) => ({
      ...(plexText(stream.languageCode)
        ? { code: plexText(stream.languageCode) }
        : {}),
      ...(plexText(stream.language)
        ? { name: plexText(stream.language) }
        : {}),
    })).filter((language) => language.code || language.name);
    const subtitleLanguages = plexRecords(part?.Stream)
      .filter((stream) => plexText(stream.streamType) === '3')
      .map((stream) => ({
        ...(plexText(stream.languageCode)
          ? { code: plexText(stream.languageCode) }
          : {}),
        ...(plexText(stream.language)
          ? { name: plexText(stream.language) }
          : {}),
      }))
      .filter((language) => language.code || language.name);
    return {
      ...(Number.isFinite(width) ? { width } : {}),
      ...(Number.isFinite(height) ? { height } : {}),
      ...(Number.isFinite(aspectRatio) ? { aspectRatio } : {}),
      ...(plexText(entry.videoResolution)
        ? { resolution: normalizedResolution(plexText(entry.videoResolution)) }
        : {}),
      ...(plexText(entry.videoCodec)
        ? { videoCodec: plexText(entry.videoCodec) }
        : {}),
      ...(plexText(entry.videoProfile)
        ? { videoProfile: plexText(entry.videoProfile) }
        : {}),
      ...(plexText(entry.videoFrameRate)
        ? { frameRate: plexText(entry.videoFrameRate) }
        : {}),
      ...(Number.isFinite(bitDepth) ? { bitDepth } : {}),
      ...(plexText(videoStreams[0]?.colorTrc)
        ? { colorTrc: plexText(videoStreams[0]?.colorTrc) }
        : {}),
      ...(plexText(entry.container)
        ? { container: plexText(entry.container) }
        : {}),
      ...(Number.isFinite(Number(entry.bitrate))
        ? { bitrateKbps: Number(entry.bitrate) }
        : {}),
      ...(plexText(part?.file) ? { filePath: plexText(part?.file) } : {}),
      ...(Number.isFinite(Number(part?.size))
        ? { fileSize: Number(part?.size) }
        : {}),
      ...(plexText(primaryAudio?.codec ?? entry.audioCodec)
        ? { audioCodec: plexText(primaryAudio?.codec ?? entry.audioCodec) }
        : {}),
      ...(Number.isFinite(channels) ? { audioChannels: channels } : {}),
      ...(plexText(primaryAudio?.channelLayout)
        ? { audioChannelLayout: plexText(primaryAudio?.channelLayout) }
        : {}),
      ...(plexText(primaryAudio?.displayTitle)
        ? { audioFormat: plexText(primaryAudio?.displayTitle) }
        : {}),
      ...(audioLanguages.length ? { audioLanguages } : {}),
      ...(subtitleLanguages.length ? { subtitleLanguages } : {}),
      hdr:
        videoStreams.some((stream) =>
          ['smpte2084', 'arib-std-b67'].includes(
            plexText(stream.colorTrc).toLowerCase()
          )
        ) || plexText(entry.videoDynamicRange).toLowerCase().includes('hdr'),
      dolbyVision: videoStreams.some((stream) =>
        plexText(stream.DOVIPresent).startsWith('1')
      ),
      ...(Number.isFinite(dolbyVisionProfile) ? { dolbyVisionProfile } : {}),
    };
  });
  const year = Number(metadata.year);
  const duration = Number(metadata.duration);
  const userRating = Number(metadata.userRating);
  const ratingEntries = plexRecords(metadata.Rating);
  const ratingValue = (
    entry: PlexJsonRecord | undefined
  ): number | undefined => {
    const value = Number(entry?.value);
    return Number.isFinite(value) ? value : undefined;
  };
  const ratingByImage = (fragment: string) =>
    ratingEntries.find((entry) =>
      plexText(entry.image).toLowerCase().includes(fragment)
    );
  const normalizePercent = (value: number | undefined): number | undefined =>
    value === undefined
      ? undefined
      : Math.max(0, Math.min(100, value <= 10 ? value * 10 : value));
  const imdbRating = ratingValue(ratingByImage('imdb'));
  const imdbId = plexRecords(metadata.Guid)
    .map((entry) => plexText(entry.id))
    .map((guid) => /^imdb:\/\/(tt\d{6,})$/i.exec(guid)?.[1]?.toLowerCase())
    .find(Boolean);
  const plexCriticRating = Number(metadata.rating);
  const plexAudienceRating = Number(metadata.audienceRating);
  const rtCriticsScore = normalizePercent(
    ratingValue(ratingByImage('rottentomatoes://image.rating')) ??
      (Number.isFinite(plexCriticRating) ? plexCriticRating : undefined)
  );
  const rtAudienceScore = normalizePercent(
    ratingValue(ratingByImage('rottentomatoes://image.audience')) ??
      (Number.isFinite(plexAudienceRating) ? plexAudienceRating : undefined)
  );
  const certifiedImage = plexText(
    ratingByImage('rottentomatoes://image.rating')?.image
  ).toLowerCase();
  const epoch = (value: unknown): string | undefined => {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000).toISOString()
      : undefined;
  };
  const addedAt = epoch(metadata.addedAt);
  const lastViewedAt = epoch(metadata.lastViewedAt);
  const releaseDate = plexText(metadata.originallyAvailableAt);
  return {
    ratingKey,
    title,
    ...(Number.isInteger(year) ? { year } : {}),
    mediaType: library.type,
    libraryId: library.key,
    libraryName: library.title,
    ...(imdbId ? { imdbId } : {}),
    ...(Number.isFinite(duration) ? { durationMs: duration } : {}),
    ...(Number.isFinite(userRating) ? { userRating } : {}),
    ...(imdbRating !== undefined ? { imdbRating } : {}),
    ...(rtCriticsScore !== undefined ? { rtCriticsScore } : {}),
    ...(rtAudienceScore !== undefined ? { rtAudienceScore } : {}),
    ...(certifiedImage
      ? { rtCertifiedFresh: certifiedImage.includes('certified') }
      : {}),
    ...(plexText(metadata.studio) ? { studio: plexText(metadata.studio) } : {}),
    directors: plexRecords(metadata.Director)
      .map((entry) => plexText(entry.tag))
      .filter(Boolean),
    genres: plexRecords(metadata.Genre)
      .map((entry) => plexText(entry.tag))
      .filter(Boolean),
    networks: [...new Set([
      ...plexRecords(metadata.Network).map((entry)=>plexText(entry.tag)),
      plexText(metadata.network),
    ].filter(Boolean))],
    labels: plexRecords(metadata.Label)
      .map((entry) => plexText(entry.tag))
      .filter(Boolean),
    collections: plexRecords(metadata.Collection)
      .map((entry) => plexText(entry.tag))
      .filter(Boolean),
    ...(addedAt ? { addedAt } : {}),
    ...(lastViewedAt ? { lastViewedAt } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    ...(Number.isFinite(Number(metadata.viewCount))
      ? { viewCount: Number(metadata.viewCount) }
      : {}),
    media,
  };
};
interface IndexedOverlayItem {
  updatedAt: string;
  syncedAt: string;
  item: OverlayApplicationItem;
}
const overlayLibraryIndex = new Map<
  string,
  {
    syncedAt: string;
    episodeScanning: boolean;
    items: Map<string, IndexedOverlayItem>;
  }
>();
const overlayItemsForLibrary = async (
  libraryId: string,
  signal?: AbortSignal
): Promise<OverlayApplicationItem[]> => {
  if (realDevelopmentPlexEnabled && plexConfiguration) {
    const configuration = requireDevelopmentLaptopPlex();
    const configured = configuration.libraries.find(
      (library) =>
        library.key === libraryId &&
        library.available &&
        (library.type === 'movie' || library.type === 'show')
    );
    if (!configured)
      throw new Error('The selected Plex library is unavailable.');
    const response = await developmentPlexTransport(configuration).query(
      `/library/sections/${encodeURIComponent(configured.key)}/all?includeGuids=1`,
      signal
    );
    const metadataItems = plexRecords(
      plexRecord(plexRecord(response)?.MediaContainer)?.Metadata
    );
    const previous = overlayLibraryIndex.get(configured.key);
    const episodeScanning =
      configured.type === 'show' &&
      posterOverlayWorkspace.libraries.find(
        (library) => library.id === configured.key
      )?.enableEpisodeScanning === true;
    const indexed = new Map<string, IndexedOverlayItem>();
    const syncedAt = new Date().toISOString();
    for (const summary of metadataItems) {
      signal?.throwIfAborted();
      const ratingKey = plexText(summary.ratingKey);
      if (!ratingKey) continue;
      const updatedAt = plexText(summary.updatedAt);
      const existing = previous?.items.get(ratingKey);
      if (
        existing &&
        existing.updatedAt === updatedAt &&
        previous?.episodeScanning === episodeScanning
      ) {
        indexed.set(ratingKey, existing);
        continue;
      }
      let metadata = await plexMetadataForRatingKey(ratingKey, signal);
      if (
        episodeScanning
      ) {
        const leaves = await developmentPlexTransport(configuration).query(
          `/library/metadata/${encodeURIComponent(
            ratingKey
          )}/allLeaves?includeGuids=1`,
          signal
        );
        const episodes = plexRecords(
          plexRecord(plexRecord(leaves)?.MediaContainer)?.Metadata
        );
        metadata = {
          ...metadata,
          Media: episodes.flatMap((episode) => plexRecords(episode.Media)),
        };
      }
      const item = plexOverlayItem(metadata, {
        key: configured.key,
        title: configured.title,
        type: configured.type as 'movie' | 'show',
      });
      if (item)
        indexed.set(ratingKey, { updatedAt, syncedAt, item });
    }
    overlayLibraryIndex.set(configured.key, {
      syncedAt,
      episodeScanning,
      items: indexed,
    });
    const items = [...indexed.values()].map((entry) => entry.item);
    posterOverlayWorkspace = {
      ...posterOverlayWorkspace,
      libraries: posterOverlayWorkspace.libraries.map((library) =>
        library.id === configured.key
          ? {
              ...library,
              itemCount: items.length,
              indexedItems: items.length,
              lastSyncedAt: syncedAt,
            }
          : library
      ),
    };
    return items;
  }
  return [...previewOverlayMedia.values()]
    .filter((item) =>
      libraryId === 'movies'
        ? item.mediaType === 'movie'
        : item.mediaType === 'show'
    )
    .map((item) => ({
      ...item,
      libraryId,
      libraryName: libraryId === 'movies' ? 'Movies' : 'TV Shows',
    }));
};
const overlayTemplateUsesField = (
  template: OverlayTemplateSummary,
  field: string
): boolean =>
  (template.condition?.sections ?? []).some((section) =>
    section.rules.some((rule) => rule.field === field)
  ) ||
  (template.design?.elements ?? []).some((element) => {
    if (element.properties.field === field) return true;
    const segments = element.properties.segments;
    return (
      Array.isArray(segments) &&
      segments.some(
        (segment) =>
          typeof segment === 'object' &&
          segment !== null &&
          'type' in segment &&
          segment.type === 'variable' &&
          'field' in segment &&
          segment.field === field
      )
    );
  });
const maintainerrSeasonItemsForLibrary = async (
  library: PosterOverlayWorkspace['libraries'][number],
  signal?: AbortSignal
): Promise<OverlayApplicationItem[]> => {
  if (
    !realDevelopmentPlexEnabled ||
    !plexConfiguration ||
    library.type !== 'show' ||
    !library.maintainerrSeasonOverlays
  )
    return [];
  const candidates = (await loadMaintainerrOverlayItems(signal)).filter(
    (item) =>
      item.mediaType === 'season' &&
      (!item.libraryId || item.libraryId === library.id)
  );
  const items: OverlayApplicationItem[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    if (seen.has(candidate.mediaId)) continue;
    seen.add(candidate.mediaId);
    const metadata = await plexMetadataForRatingKey(candidate.mediaId);
    if (plexText(metadata.librarySectionID) !== library.id) continue;
    const item = plexOverlayItem(metadata, {
      key: library.id,
      title: library.name,
      type: 'show',
    });
    if (item) items.push(item);
  }
  return items;
};
const applyConfiguredOverlayLibrary = async (
  library: PosterOverlayWorkspace['libraries'][number],
  signal: AbortSignal
) => {
  const templates = posterOverlayWorkspace.templates.filter((template) =>
    library.enabledTemplateIds.includes(template.id)
  );
  const primary = await previewOverlayApplication.apply(
    await overlayItemsForLibrary(library.id, signal),
    templates,
    posterOverlayWorkspace.source.source,
    library.tmdbLanguage,
    signal
  );
  const seasonTemplates = templates.filter(
    (template) =>
      overlayTemplateUsesField(template, 'daysUntilAction') ||
      template.tags.some((tag) => tag.toLowerCase() === 'maintainerr')
  );
  if (
    library.type !== 'show' ||
    !library.maintainerrSeasonOverlays ||
    seasonTemplates.length === 0
  )
    return primary;
  const seasons = await maintainerrSeasonItemsForLibrary(library, signal);
  if (!seasons.length) return primary;
  const seasonResult = await previewOverlayApplication.apply(
    seasons,
    seasonTemplates,
    'plex',
    library.tmdbLanguage,
    signal
  );
  return {
    items: [...primary.items, ...seasonResult.items],
    applied: primary.applied + seasonResult.applied,
    restored: primary.restored + seasonResult.restored,
    skipped: primary.skipped + seasonResult.skipped,
    failed: primary.failed + seasonResult.failed,
  };
};
const overlayRunBreakdown = (
  result: Awaited<ReturnType<typeof applyConfiguredOverlayLibrary>>
) => ({
  lastAppliedItems: result.applied,
  lastRestoredItems: result.restored,
  lastSkippedItems: result.skipped,
  lastUnchangedItems: result.items.filter(
    (item) =>
      item.status === 'skipped' &&
      (item.appliedTemplateIds?.length ?? 0) > 0
  ).length,
  lastNoMatchItems: result.items.filter(
    (item) =>
      item.status === 'skipped' &&
      (item.appliedTemplateIds?.length ?? 0) === 0
  ).length,
});
const runScheduledOverlayApplication = async (
  signal: AbortSignal
): Promise<{
  libraries: number;
  applied: number;
  skipped: number;
  failed: number;
}> => {
  // Libraries with no enabled templates still need a reconciliation pass so
  // posters rendered by a previously enabled template are restored.
  const eligible = posterOverlayWorkspace.libraries;
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  for (const library of eligible) {
    signal.throwIfAborted();
    const items = await overlayItemsForLibrary(library.id, signal);
    posterOverlayWorkspace = {
      ...posterOverlayWorkspace,
      libraries: posterOverlayWorkspace.libraries.map((item) =>
        item.id === library.id
          ? {
              ...item,
              itemCount: items.length,
              status: 'processing' as const,
              processedItems: 0,
              failedItems: 0,
            }
          : item
      ),
    };
    const result = await applyConfiguredOverlayLibrary(library, signal);
    applied += result.applied;
    skipped += result.skipped;
    failed += result.failed;
    posterOverlayWorkspace = {
      ...posterOverlayWorkspace,
      libraries: posterOverlayWorkspace.libraries.map((item) =>
        item.id === library.id
          ? {
              ...item,
              status: result.failed
                ? ('error' as const)
                : ('complete' as const),
              processedItems:
                result.applied + result.restored + result.skipped,
              failedItems: result.failed,
              ...overlayRunBreakdown(result),
              lastAppliedAt: new Date().toISOString(),
            }
          : item
      ),
    };
  }
  await saveDevelopmentSources();
  return { libraries: eligible.length, applied, skipped, failed };
};

const runOverlayLibraryApplication = async (
  libraryId: string,
  signal: AbortSignal
) => {
  const library = posterOverlayWorkspace.libraries.find(
    (candidate) => candidate.id === libraryId
  );
  if (!library)
    throw new Error(`Overlay library "${libraryId}" is no longer available.`);
  const items = await overlayItemsForLibrary(library.id, signal);
  posterOverlayWorkspace = {
    ...posterOverlayWorkspace,
    libraries: posterOverlayWorkspace.libraries.map((candidate) =>
      candidate.id === library.id
        ? {
            ...candidate,
            itemCount: items.length,
            status: 'processing' as const,
            processedItems: 0,
            failedItems: 0,
          }
        : candidate
    ),
  };
  const result = await applyConfiguredOverlayLibrary(library, signal);
  posterOverlayWorkspace = {
    ...posterOverlayWorkspace,
    libraries: posterOverlayWorkspace.libraries.map((candidate) =>
      candidate.id === library.id
        ? {
            ...candidate,
            status: result.failed ? ('error' as const) : ('complete' as const),
            processedItems:
              result.applied + result.restored + result.skipped,
            failedItems: result.failed,
            ...overlayRunBreakdown(result),
            lastAppliedAt: new Date().toISOString(),
          }
        : candidate
    ),
  };
  await saveDevelopmentSources();
  return result;
};
const starterPosterDesign: CollectionPosterDesign = {
  width: 1000,
  height: 1500,
  background: {
    type: 'radial',
    color: '#f3ad32',
    secondaryColor: '#17262d',
    intensity: 52,
    useSourceColors: false,
  },
  elements: [
    {
      id: 'title',
      layerOrder: 1,
      type: 'text',
      x: 90,
      y: 1060,
      width: 820,
      height: 230,
      rotation: 0,
      name: 'Collection title',
      properties: {
        elementType: 'collection-title',
        fontSize: 86,
        fontFamily: 'Inter',
        fontWeight: 'bold',
        fontStyle: 'normal',
        color: '#ffffff',
        textAlign: 'left',
        maxLines: 2,
        textTransform: 'none',
      },
    },
    {
      id: 'grid',
      layerOrder: 0,
      type: 'content-grid',
      x: 90,
      y: 150,
      width: 820,
      height: 720,
      rotation: 0,
      name: 'Content grid',
      properties: { columns: 3, rows: 2, spacing: 24, cornerRadius: 22 },
    },
  ],
  migrated: true,
};
let collectionPosterWorkspace: CollectionPosterWorkspace = {
  templates: [
    {
      id: 'editorial-grid',
      name: 'Editorial Grid',
      description: 'A clean six-item grid with a bold collection title.',
      design: starterPosterDesign,
      isDefault: true,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'cinema-focus',
      name: 'Cinema Focus',
      description: 'A cinematic radial layout for curated movie collections.',
      design: {
        ...starterPosterDesign,
        background: {
          ...starterPosterDesign.background,
          color: '#8f7df0',
          secondaryColor: '#111220',
        },
      },
      isDefault: false,
      createdAt: new Date(Date.now() - 43_200_000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  savedPosters: [
    {
      id: 'trending-poster',
      name: 'Trending Now',
      description: 'Current generated artwork for Trending Now.',
      design: starterPosterDesign,
      isEditable: true,
      usedBy: [
        {
          id: 'trending-now',
          name: 'Trending Now',
          libraryName: 'Movies',
          type: 'collection',
        },
      ],
      createdAt: new Date(Date.now() - 32_400_000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'award-poster',
      name: 'Award Winners',
      description: 'Imported finished poster artwork.',
      design: {
        ...starterPosterDesign,
        background: {
          ...starterPosterDesign.background,
          color: '#4cc38a',
          secondaryColor: '#0a1b14',
        },
      },
      isEditable: false,
      usedBy: [],
      createdAt: new Date(Date.now() - 21_600_000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  sourceColors: {
    trakt: {
      primaryColor: '#ed1c24',
      secondaryColor: '#3a090b',
      textColor: '#ffffff',
    },
    mdblist: {
      primaryColor: '#6957ff',
      secondaryColor: '#17122f',
      textColor: '#ffffff',
    },
    mal: {
      primaryColor: '#2e51a2',
      secondaryColor: '#0c1731',
      textColor: '#ffffff',
    },
  },
  assets: [],
};

const refreshPosterUsage = () => {
  collectionPosterWorkspace = {
    ...collectionPosterWorkspace,
    savedPosters: collectionPosterWorkspace.savedPosters.map((poster) => ({
      ...poster,
      usedBy: managedCollections
        .filter(
          (collection) =>
            collection.posterSettings?.customPoster?.kind === 'saved' &&
            collection.posterSettings.customPoster.id === poster.id
        )
        .map((collection) => ({
          id: collection.id,
          name: collection.title,
          libraryName: collection.libraryName,
          type: 'collection' as const,
        })),
    })),
  };
};

const collectionIsActive = (
  settings: ManagedCollection['behaviorSettings'],
  now = new Date()
) => {
  const restriction = settings?.timeRestriction;
  if (!restriction || restriction.alwaysActive) return true;
  const day = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ][now.getDay()] as keyof typeof restriction.weeklySchedule;
  if (!restriction.weeklySchedule[day]) return false;
  if (!restriction.dateRanges.length) return true;
  const current = (now.getMonth() + 1) * 100 + now.getDate();
  return restriction.dateRanges.some(({ startDate, endDate }) => {
    const toValue = (value: string) => {
      const [dayPart, monthPart] = value.split('-').map(Number);
      return (monthPart ?? Number.NaN) * 100 + (dayPart ?? Number.NaN);
    };
    const start = toValue(startDate);
    const end = toValue(endDate);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      (start <= end
        ? current >= start && current <= end
        : current >= start || current <= end)
    );
  });
};

const withBehaviorPlacement = <T extends ManagedCollection>(
  collection: T
): T => {
  const behavior = collection.behaviorSettings;
  if (!behavior) return collection;
  const isActive = collectionIsActive(behavior);
  const visibility = isActive
    ? behavior.visibility
    : behavior.timeRestriction.inactiveVisibility;
  return {
    ...collection,
    isActive,
    homeVisible:
      isActive || !behavior.timeRestriction.removeFromPlexWhenInactive
        ? visibility.usersHome || visibility.serverOwnerHome
        : false,
    recommendedVisible:
      isActive || !behavior.timeRestriction.removeFromPlexWhenInactive
        ? visibility.libraryRecommended
        : false,
    libraryVisible:
      isActive || !behavior.timeRestriction.removeFromPlexWhenInactive,
  };
};

const alwaysActiveTimeRestriction = {
  alwaysActive: true,
  removeFromPlexWhenInactive: false,
  inactiveVisibility: {
    usersHome: false,
    serverOwnerHome: false,
    libraryRecommended: false,
  },
  dateRanges: [],
  weeklySchedule: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
  },
} as const;

const managedCollectionAsPlexItem = (
  collection: ManagedCollection,
  plexRatingKey = collection.plexRatingKey
): PlexDiscoveredItem => {
  if (!plexRatingKey)
    throw new Error(
      `Collection "${collection.title}" does not have a Plex rating key.`
    );
  const active = collectionIsActive(collection.behaviorSettings);
  const visibility = collection.behaviorSettings
    ? active
      ? collection.behaviorSettings.visibility
      : collection.behaviorSettings.timeRestriction.inactiveVisibility
    : {
        usersHome: collection.homeVisible,
        serverOwnerHome: collection.homeVisible,
        libraryRecommended: collection.recommendedVisible,
      };
  return {
    id: collection.id,
    kind: 'pre-existing-collection',
    plexKey: plexRatingKey,
    name: collection.title,
    libraryId: collection.libraryId,
    libraryName: collection.libraryName,
    mediaType: collection.mediaType,
    homeOrder: collection.sharedOrder + 1,
    libraryOrder: collection.libraryOrder,
    visibility,
    missing: false,
    isLinked: Boolean(collection.isLinked),
    isUnlinked: Boolean(collection.isUnlinked),
    ...(collection.linkGroupId ? { linkGroupId: collection.linkGroupId } : {}),
    lastValidatedAt: new Date().toISOString(),
    timeRestriction:
      collection.behaviorSettings?.timeRestriction ??
      alwaysActiveTimeRestriction,
    ...(collection.posterSettings
      ? { posterSettings: collection.posterSettings }
      : {}),
    ...(collection.metadataSettings
      ? { metadataSettings: collection.metadataSettings }
      : {}),
  };
};

const resolveCollectionAssetBytes = async (reference: {
  id: string;
  name: string;
  size: number;
  previewDataUrl: string;
}): Promise<Uint8Array> => {
  const stored = await posterEditorAssetStore.read(reference.id);
  if (stored?.bytes.byteLength) return stored.bytes;
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(
    reference.previewDataUrl
  );
  if (!match?.[1])
    throw new Error(`Asset "${reference.name}" is no longer available.`);
  const bytes = new Uint8Array(Buffer.from(match[1], 'base64'));
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024)
    throw new Error(`Asset "${reference.name}" has an invalid size.`);
  return bytes;
};

const collectionSynchronizationAssets = (
  configuration: PlexServerConfiguration
) =>
  new CollectionPosterSynchronizationAssets({
    workspace: async () => collectionPosterWorkspace,
    renderInputs: new PlexCollectionPosterInputProvider({
      transport: developmentPlexTransport(configuration),
      sourceType: async (item) =>
        managedCollections.find((collection) => collection.id === item.id)
          ?.sourceType,
      uploadedPoster: async (id) =>
        (await posterEditorAssetStore.read(id))?.bytes,
    }),
    renderer: new NativeCollectionPosterRenderer({
      assets: {
        async resolve(id) {
          const stored = await posterEditorAssetStore.read(id);
          if (!stored)
            throw new Error(`Poster asset "${id}" is no longer available.`);
          return stored.bytes;
        },
      },
    }),
    resolveCollectionAsset: resolveCollectionAssetBytes,
  });

const applyCollectionMemberOverlays = async (
  collection: ManagedCollection,
  ratingKeys: readonly string[],
  signal: AbortSignal
) => {
  if (!collection.posterSettings?.applyOverlaysDuringSync)
    return { applied: 0, skipped: 0, failed: 0 };
  const library = posterOverlayWorkspace.libraries.find(
    (candidate) => candidate.id === collection.libraryId
  );
  if (!library || library.enabledTemplateIds.length === 0)
    return { applied: 0, skipped: ratingKeys.length, failed: 0 };
  const configuration = requireDevelopmentLaptopPlex();
  const configured = configuration.libraries.find(
    (candidate) =>
      candidate.key === collection.libraryId &&
      (candidate.type === 'movie' || candidate.type === 'show')
  );
  if (!configured)
    throw new Error(
      `Plex library "${collection.libraryName}" is unavailable for overlays.`
    );
  const items = (
    await Promise.all(
      ratingKeys.map(async (ratingKey) => {
        const metadata = await plexMetadataForRatingKey(ratingKey, signal);
        return plexOverlayItem(metadata, {
          key: configured.key,
          title: configured.title,
          type: configured.type as 'movie' | 'show',
        });
      })
    )
  ).filter((item): item is OverlayApplicationItem => Boolean(item));
  const result = await previewOverlayApplication.apply(
    items,
    posterOverlayWorkspace.templates.filter((template) =>
      library.enabledTemplateIds.includes(template.id)
    ),
    posterOverlayWorkspace.source.source,
    library.tmdbLanguage,
    signal
  );
  return {
    applied: result.applied,
    skipped: result.skipped,
    failed: result.failed,
  };
};

const sessionRepository = {
  async rotateForUser(previous: string | undefined, userId: string) {
    if (previous) sessions.delete(previous);
    const sessionId = `dev-${crypto.randomUUID()}`;
    sessions.set(sessionId, userId);
    await saveDevelopmentAuth();
    return {
      sessionId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
  },
  async revoke(sessionId: string) {
    sessions.delete(sessionId);
    await saveDevelopmentAuth();
  },
  async resolve(sessionId: string) {
    const userId = sessions.get(sessionId);
    return userId
      ? {
          userId,
          role: 'owner' as const,
          mediaServerScopes: [],
          sessionId,
        }
      : undefined;
  },
};

const plexAccountForToken = async (
  token: string,
  signal?: AbortSignal
) => {
  const response = await fetch('https://plex.tv/api/v2/user', {
    headers: {
      Accept: 'application/json',
      'X-Plex-Token': token,
      'X-Plex-Product': 'Vynode',
      'X-Plex-Version': '0.1.0',
      'X-Plex-Client-Identifier': 'vynode-development-owner',
    },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Plex rejected the account authorization.'
        : `Plex account verification failed with status ${response.status}.`
    );
  const account = (await response.json()) as {
    id?: number;
    email?: string;
    username?: string;
    title?: string;
    thumb?: string;
    subscription?: { active?: boolean };
  };
  if (!account.id || !account.email || !account.username)
    throw new Error('Plex returned an incomplete account profile.');
  return {
    id: String(account.id),
    email: account.email,
    username: account.username,
    ...(account.title ? { title: account.title } : {}),
    ...(account.thumb ? { avatarUrl: account.thumb } : {}),
    hasPlexPass: account.subscription?.active === true,
  };
};

const plexLogin = new PlexLoginService(
  {
    async createPin(signal) {
      const response = await fetch('https://plex.tv/api/v2/pins', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Plex-Product': 'Vynode',
          'X-Plex-Version': '0.1.0',
          'X-Plex-Client-Identifier': 'vynode-development-owner',
        },
        body: new URLSearchParams({
          strong: 'true',
          'X-Plex-Product': 'Vynode',
          'X-Plex-Client-Identifier': 'vynode-development-owner',
        }),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new Error(
          `Plex authorization could not start (status ${response.status}).`
        );
      const payload = (await response.json()) as {
        id?: number;
        code?: string;
        expiresIn?: number;
      };
      if (!payload.id || !payload.code)
        throw new Error('Plex returned an incomplete authorization response.');
      const parameters = new URLSearchParams({
        clientID: 'vynode-development-owner',
        code: payload.code,
        'context[device][product]': 'Vynode',
      });
      return {
        providerPinId: String(payload.id),
        code: payload.code,
        authorizationUrl: `https://app.plex.tv/auth#?${parameters.toString()}`,
        expiresAt: new Date(
          Date.now() + Math.max(60, payload.expiresIn ?? 1800) * 1000
        ).toISOString(),
      };
    },
    async pollPin(providerPinId, signal) {
      const response = await fetch(
        `https://plex.tv/api/v2/pins/${encodeURIComponent(providerPinId)}`,
        {
          headers: {
            Accept: 'application/json',
            'X-Plex-Product': 'Vynode',
            'X-Plex-Version': '0.1.0',
            'X-Plex-Client-Identifier': 'vynode-development-owner',
          },
          ...(signal ? { signal } : {}),
        }
      );
      if (response.status === 429) return undefined;
      if (!response.ok)
        throw new Error(
          `Plex authorization check failed (status ${response.status}).`
        );
      const payload = (await response.json()) as {
        authToken?: string | null;
      };
      if (!payload.authToken) return undefined;
      return {
        token: payload.authToken,
        account: await plexAccountForToken(payload.authToken, signal),
      };
    },
    async accountForToken(token, signal) {
      return plexAccountForToken(token, signal);
    },
  },
  {
    async count() {
      return identities.size;
    },
    async findByPlexAccountId(id) {
      const exact = [...identities.values()].find(
        (identity) => identity.plexAccountId === id
      );
      if (exact) return exact;
      return [...identities.values()].find(
        (identity) =>
          identity.role === 'owner' &&
          !integrationSecrets.has(identity.tokenReference)
      );
    },
    async findById(id) {
      return identities.get(id);
    },
    async save(identity) {
      identities.set(identity.id, identity);
      await saveDevelopmentAuth();
    },
    async transaction(operation) {
      return operation();
    },
  },
  sessionRepository,
  {
    async store(secret) {
      const reference = `dev-vault:plex:${crypto.randomUUID()}`;
      integrationSecrets.set(reference, secret);
      await saveDevelopmentSources();
      return reference;
    },
    async replace(reference, secret) {
      integrationSecrets.set(reference, secret);
      await saveDevelopmentSources();
      return reference;
    },
  },
  {
    async canSignIn() {
      return true;
    },
    async allowAutomaticSharedUserCreation() {
      return true;
    },
  },
  { now: () => new Date() }
);

let dashboardJobService: DashboardJobService;

const waitForDashboardJob = async (
  kind: 'collections' | 'overlays',
  signal: AbortSignal
) => {
  await dashboardJobService.start(kind);
  while (true) {
    if (signal.aborted) {
      const current = dashboardJobService.status(kind);
      if (
        ['queued', 'setup', 'processing', 'cleanup'].includes(current.phase)
      ) {
        dashboardJobService.cancel(kind);
      }
      throw new DOMException('Aborted', 'AbortError');
    }
    const status = dashboardJobService.status(kind);
    if (['completed', 'cancelled', 'failed'].includes(status.phase))
      return status;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
};

const app = await createControlPlane({
  allowedOrigin: 'http://127.0.0.1:5174',
  onboarding: new OnboardingService({
    async get() {
      return onboarding;
    },
    async compareAndSet(expectedRevision, next) {
      if (onboarding.revision !== expectedRevision) return false;
      await saveDevelopmentOnboarding(next);
      onboarding = next;
      return true;
    },
  }),
  plexLogin,
  dashboardJobs: (dashboardJobService = new DashboardJobService(
    {
      async items(kind) {
        return kind === 'collections'
          ? managedCollections.map((collection) => ({
              id: collection.id,
              name: collection.title,
              sourceType: collection.sourceType,
            }))
          : posterOverlayWorkspace.libraries.map((library) => ({
              id: library.id,
              name: library.name,
              sourceType: 'Plex library',
            }));
      },
      async process(kind, item, signal) {
        if (kind === 'collections') {
          const collection = managedCollections.find(
            (candidate) => candidate.id === item.id
          );
          if (!collection)
            return {
              outcome: 'skipped' as const,
              durationMs: 0,
              errorMessage: 'Collection was removed before synchronization.',
            };
          if (
            collection.sourceType !== 'manual' &&
            collection.sourceType !== 'seerr' &&
            collection.sourceType !== 'tmdb' &&
            collection.sourceType !== 'letterboxd' &&
            collection.sourceType !== 'multi-source' &&
            collection.sourceType !== 'trakt' &&
            !(
              collection.sourceType === 'comingsoon' &&
              collection.sourceSettings?.subtype === 'trakt_anticipated'
            ) &&
            collection.sourceType !== 'mal' &&
            collection.sourceType !== 'anilist' &&
            collection.sourceType !== 'mdblist' &&
            collection.sourceType !== 'tautulli' &&
            collection.sourceType !== 'plex' &&
            collection.sourceType !== 'imdb' &&
            collection.sourceType !== 'radarrtag' &&
            collection.sourceType !== 'sonarrtag'
          )
            return {
              outcome: 'skipped' as const,
              durationMs: 0,
              errorMessage: `${collection.sourceType} source execution is not connected yet.`,
            };
          if (collection.sourceType === 'plex') {
            const configuration = requireDevelopmentLaptopPlex();
            const subtype = collection.sourceSettings?.subtype;
            const libraryGeneratorSubtypes = [
              'genres',
              'decades',
              'resolutions',
              'content-ratings',
            ] as const;
            if (
              subtype !== 'actors' &&
              subtype !== 'directors' &&
              !libraryGeneratorSubtypes.includes(
                subtype as (typeof libraryGeneratorSubtypes)[number]
              )
            )
              throw new Error(
                'Choose a supported Plex library collection generator.'
              );
            const startedAt = Date.now();
            if (
              libraryGeneratorSubtypes.includes(
                subtype as (typeof libraryGeneratorSubtypes)[number]
              )
            ) {
              const generatorSubtype =
                subtype as (typeof libraryGeneratorSubtypes)[number];
              const client =
                developmentLibraryGeneratorClient(configuration);
              const settings =
                collection.sourceSettings?.plexGenerator ?? {
                  selectionMode: 'include' as const,
                  selectedValues: [],
                  enabledRatingGroups: [
                    'australia',
                    'television',
                    'numeric',
                    'other',
                  ] as const,
                  titleTemplate: '{value}',
                  cleanupMissing: true,
                };
              const available = await client.values(
                collection.libraryId,
                collection.mediaType,
                generatorSubtype,
                signal
              );
              const selected = new Set(settings.selectedValues);
              const enabledGroups = new Set(settings.enabledRatingGroups);
              const desired = available.filter(
                (entry) =>
                  selected.has(entry.value) &&
                  (!entry.group || enabledGroups.has(entry.group))
              );
              const previous = new Map(
                (settings.generatedCollections ?? []).map((entry) => [
                  entry.value,
                  entry,
                ])
              );
              const retained: PlexGeneratedCollectionReference[] = [];
              const failures: string[] = [];
              for (const entry of desired) {
                signal.throwIfAborted();
                const title = (
                  settings.titleTemplate.trim() || '{value}'
                ).replaceAll('{value}', entry.label);
                const existing = previous.get(entry.value);
                if (existing?.title === title) {
                  retained.push(existing);
                  previous.delete(entry.value);
                  continue;
                }
                if (existing && settings.cleanupMissing) {
                  await client
                    .delete(existing.ratingKey, signal)
                    .catch((error) =>
                      failures.push(
                        `${existing.title}: ${error instanceof Error ? error.message : String(error)}`
                      )
                    );
                  previous.delete(entry.value);
                }
                try {
                  retained.push({
                    value: entry.value,
                    title,
                    ratingKey: await client.createSmart(
                      {
                        title,
                        libraryId: collection.libraryId,
                        mediaType: collection.mediaType,
                        subtype: generatorSubtype,
                        value: entry.label,
                      },
                      signal
                    ),
                  });
                } catch (error) {
                  failures.push(
                    `${title}: ${error instanceof Error ? error.message : String(error)}`
                  );
                }
              }
              if (settings.cleanupMissing) {
                for (const stale of previous.values()) {
                  signal.throwIfAborted();
                  await client
                    .delete(stale.ratingKey, signal)
                    .catch((error) =>
                      failures.push(
                        `${stale.title}: ${error instanceof Error ? error.message : String(error)}`
                      )
                    );
                }
              } else retained.push(...previous.values());
              const completedAt = new Date().toISOString();
              managedCollections = managedCollections.map((candidate) =>
                candidate.id === collection.id
                  ? {
                      ...candidate,
                      sourceSettings: {
                        ...candidate.sourceSettings!,
                        plexGenerator: {
                          ...settings,
                          generatedCollections: retained,
                        },
                      },
                      itemCount: retained.length,
                      status: failures.length ? 'error' : 'ready',
                      lastSyncedAt: completedAt,
                    }
                  : candidate
              );
              await saveDevelopmentSources();
              return {
                outcome:
                  failures.length && !retained.length
                    ? ('error' as const)
                    : ('success' as const),
                created: retained.length > 0,
                durationMs: Date.now() - startedAt,
                ...(failures.length
                  ? { errorMessage: failures.join(' ') }
                  : {}),
              };
            }
            const personSubtype = subtype as 'actors' | 'directors';
            const minimum = collection.sourceSettings?.personMinimumItems ?? 5;
            const client = developmentPersonCollectionClient(configuration);
            const people = await client.people(
              collection.libraryId,
              collection.mediaType,
              personSubtype,
              signal
            );
            const qualifying = people
              .filter((person) => person.count >= minimum)
              .slice(0, collection.sourceSettings?.maxItems ?? 50);
            if (!qualifying.length)
              return {
                outcome: 'skipped' as const,
                durationMs: Date.now() - startedAt,
                errorMessage: `No ${subtype} meet the ${minimum}-item minimum in ${collection.libraryName}.`,
              };
            let created = 0;
            const failures: string[] = [];
            for (const person of qualifying) {
              signal.throwIfAborted();
              const token =
                personSubtype === 'actors' ? '{actor}' : '{director}';
              const title = collection.title.includes(token)
                ? collection.title.replaceAll(token, person.name)
                : person.name;
              try {
                await client.createSmart(
                  {
                    title,
                    libraryId: collection.libraryId,
                    mediaType: collection.mediaType,
                    kind: personSubtype,
                    personName: person.name,
                    ...(collection.sourceSettings?.maxItems
                      ? { maxItems: collection.sourceSettings.maxItems }
                      : {}),
                  },
                  signal
                );
                created += 1;
              } catch (error) {
                failures.push(
                  `${person.name}: ${error instanceof Error ? error.message : String(error)}`
                );
              }
            }
            const completedAt = new Date().toISOString();
            managedCollections = managedCollections.map((candidate) =>
              candidate.id === collection.id
                ? {
                    ...candidate,
                    itemCount: created,
                    status: failures.length
                      ? ('error' as const)
                      : ('ready' as const),
                    lastSyncedAt: completedAt,
                  }
                : candidate
            );
            await saveDevelopmentSources();
            return {
              outcome: failures.length
                ? created
                  ? ('success' as const)
                  : ('error' as const)
                : ('success' as const),
              created: created > 0,
              durationMs: Date.now() - startedAt,
              ...(failures.length
                ? {
                    errorMessage: `Created ${created} of ${qualifying.length} person collections. ${failures.join('; ')}`,
                  }
                : {}),
            };
          }
          let memberKeys: readonly string[];
          let missingReport: MissingMediaExecutionReport | undefined;
          let placeholderReport:
            | Awaited<ReturnType<typeof executeCollectionPlaceholderLifecycle>>
            | undefined;
          let missingCandidates: MissingMediaCandidate[] = [];
          if (collection.sourceType === 'manual') {
            memberKeys =
              collection.sourceSettings?.manualMembers?.map(
                (member) => member.ratingKey
              ) ?? [];
          } else if (collection.sourceType === 'seerr') {
            const sourceItems = await resolveSeerrSourceItems(
              collection,
              signal
            );
            const matches = await plexMemberKeysForTraktItems(
              collection,
              sourceItems,
              signal
            );
            missingCandidates = sourceItems
              .filter((sourceItem) => !matches.has(sourceItem.tmdbId))
              .map((sourceItem) => ({
                key: `${sourceItem.mediaType}:${sourceItem.tmdbId}`,
                mediaType: sourceItem.mediaType,
                title: sourceItem.title,
                ...(sourceItem.year ? { year: sourceItem.year } : {}),
                tmdbId: sourceItem.tmdbId,
                ...(sourceItem.tvdbId ? { tvdbId: sourceItem.tvdbId } : {}),
              }));
            missingReport = await executeCollectionMissingMedia(
              collection,
              missingCandidates,
              signal
            );
            memberKeys = sourceItems
              .map((sourceItem) => matches.get(sourceItem.tmdbId))
              .filter((key): key is string => Boolean(key));
          } else if (collection.sourceType === 'tmdb' || collection.sourceType === 'letterboxd' || collection.sourceType === 'multi-source') {
            const sourceItems=collection.sourceType==='tmdb'?await resolveTmdbSourceItems(collection,signal):collection.sourceType==='letterboxd'?await resolveLetterboxdSourceItems(collection,signal):(await resolveMultiSourceItems(collection,signal)).items;
            const matches=await plexMemberKeysForTraktItems(collection,sourceItems,signal);
            missingCandidates=sourceItems.filter((item)=>!matches.has(item.tmdbId)).map((item)=>({key:`${item.mediaType}:${item.tmdbId}`,mediaType:item.mediaType,title:item.title,tmdbId:item.tmdbId,...(item.year?{year:item.year}:{})}));
            missingReport=await executeCollectionMissingMedia(collection,missingCandidates,signal);
            memberKeys=sourceItems.map((item)=>matches.get(item.tmdbId)).filter((key):key is string=>Boolean(key));
          } else if (
            collection.sourceType === 'trakt' ||
            (collection.sourceType === 'comingsoon' &&
              collection.sourceSettings?.subtype === 'trakt_anticipated')
          ) {
            const orderedSourceItems = await resolveTraktSourceItems(
              collection,
              signal
            );
            const matches = await plexMemberKeysForTraktItems(
              collection,
              orderedSourceItems,
              signal
            );
            missingCandidates = orderedSourceItems
              .filter((sourceItem) => !matches.has(sourceItem.tmdbId))
              .map((sourceItem) => ({
                key: `${sourceItem.mediaType}:${sourceItem.tmdbId}`,
                mediaType: sourceItem.mediaType,
                title: sourceItem.title,
                ...(sourceItem.year ? { year: sourceItem.year } : {}),
                ...(sourceItem.releasedAt
                  ? { releaseDate: sourceItem.releasedAt }
                  : {}),
                tmdbId: sourceItem.tmdbId,
                ...(sourceItem.tvdbId ? { tvdbId: sourceItem.tvdbId } : {}),
              }));
            missingReport = await executeCollectionMissingMedia(
              collection,
              missingCandidates,
              signal
            );
            memberKeys = orderedSourceItems
              .map((sourceItem) => matches.get(sourceItem.tmdbId))
              .filter((key): key is string => Boolean(key));
          } else if (collection.sourceType === 'mdblist') {
            const orderedSourceItems = await resolveMDBListSourceItems(
              collection,
              signal
            );
            const matches = await plexMemberKeysForTraktItems(
              collection,
              orderedSourceItems,
              signal
            );
            missingCandidates = orderedSourceItems
              .filter((sourceItem) => !matches.has(sourceItem.tmdbId))
              .map((sourceItem) => ({
                key: `${sourceItem.mediaType}:${sourceItem.tmdbId}`,
                mediaType: sourceItem.mediaType,
                title: sourceItem.title,
                ...(sourceItem.year ? { year: sourceItem.year } : {}),
                ...(sourceItem.releasedAt
                  ? { releaseDate: sourceItem.releasedAt }
                  : {}),
                tmdbId: sourceItem.tmdbId,
                ...(sourceItem.tvdbId ? { tvdbId: sourceItem.tvdbId } : {}),
              }));
            missingReport = await executeCollectionMissingMedia(
              collection,
              missingCandidates,
              signal
            );
            memberKeys = orderedSourceItems
              .map((sourceItem) => matches.get(sourceItem.tmdbId))
              .filter((key): key is string => Boolean(key));
          } else if (collection.sourceType === 'tautulli') {
            const sourceItems = await resolveTautulliSourceItems(
              collection,
              signal
            );
            const matches = await plexMemberKeysForTautulliItems(
              collection,
              sourceItems,
              signal
            );
            memberKeys = sourceItems
              .map((sourceItem) => sourceItem.ratingKey)
              .filter((key) => matches.has(key));
          } else if (collection.sourceType === 'imdb') {
            const sourceItems = await resolveImdbSourceItems(
              collection,
              signal
            );
            const matches = await plexMemberKeysForImdbItems(
              collection,
              sourceItems,
              signal
            );
            missingCandidates = sourceItems
              .filter(
                (sourceItem) => !matches.has(sourceItem.imdbId.toLowerCase())
              )
              .map((sourceItem) => ({
                key: `${sourceItem.mediaType}:imdb:${sourceItem.imdbId}`,
                mediaType: sourceItem.mediaType,
                title: sourceItem.title,
                ...(sourceItem.year ? { year: sourceItem.year } : {}),
              }));
            missingReport = await executeCollectionMissingMedia(
              collection,
              missingCandidates,
              signal
            );
            memberKeys = sourceItems
              .map((sourceItem) => matches.get(sourceItem.imdbId.toLowerCase()))
              .filter((key): key is string => Boolean(key));
          } else if (collection.sourceType === 'mal') {
            const sourceItems = await resolveMyAnimeListSourceItems(
              collection,
              signal
            );
            const matches = await plexMemberKeysForMyAnimeListItems(
              collection,
              sourceItems,
              signal
            );
            missingCandidates = sourceItems
              .filter((sourceItem) => !matches.has(sourceItem.malId))
              .map((sourceItem) => ({
                key: `${sourceItem.mediaType}:mal:${sourceItem.malId}`,
                mediaType: sourceItem.mediaType,
                title: sourceItem.title,
                ...(sourceItem.year ? { year: sourceItem.year } : {}),
                ...(sourceItem.tmdbIds[0]
                  ? { tmdbId: sourceItem.tmdbIds[0] }
                  : {}),
                ...(sourceItem.tvdbId ? { tvdbId: sourceItem.tvdbId } : {}),
              }));
            missingReport = await executeCollectionMissingMedia(
              collection,
              missingCandidates,
              signal
            );
            memberKeys = sourceItems
              .map((sourceItem) => matches.get(sourceItem.malId))
              .filter((key): key is string => Boolean(key));
          } else if (
            collection.sourceType === 'radarrtag' ||
            collection.sourceType === 'sonarrtag'
          ) {
            const sourceItems = await resolveArrTagSourceItems(
              collection,
              signal
            );
            const matches = await plexMemberKeysForArrTagItems(
              collection,
              sourceItems,
              signal
            );
            memberKeys = sourceItems
              .map((sourceItem) => matches.get(sourceItem.serviceId))
              .filter((key): key is string => Boolean(key));
          } else if (collection.sourceType === 'anilist') {
            const sourceItems = await resolveAniListSourceItems(
              collection,
              signal
            );
            const matches = await plexMemberKeysForAniListItems(
              collection,
              sourceItems,
              signal
            );
            missingCandidates = sourceItems
              .filter((sourceItem) => !matches.has(sourceItem.anilistId))
              .map((sourceItem) => ({
                key: `${sourceItem.mediaType}:anilist:${sourceItem.anilistId}`,
                mediaType: sourceItem.mediaType,
                title: sourceItem.title,
                ...(sourceItem.year ? { year: sourceItem.year } : {}),
                ...(sourceItem.tmdbIds[0]
                  ? { tmdbId: sourceItem.tmdbIds[0] }
                  : {}),
                ...(sourceItem.tvdbId ? { tvdbId: sourceItem.tvdbId } : {}),
              }));
            missingReport = await executeCollectionMissingMedia(
              collection,
              missingCandidates,
              signal
            );
            memberKeys = sourceItems
              .map((sourceItem) => matches.get(sourceItem.anilistId))
              .filter((key): key is string => Boolean(key));
          } else {
            throw new Error(
              `${collection.sourceType} collection synchronization is not connected yet.`
            );
          }
          placeholderReport = await executeCollectionPlaceholderLifecycle(
            collection,
            missingCandidates,
            signal
          );
          if (placeholderReport?.indexedItems.length) {
            memberKeys = [
              ...new Set([
                ...memberKeys,
                ...placeholderReport.indexedItems.map(
                  (placeholder) => placeholder.ratingKey
                ),
              ]),
            ];
          }
          if (!memberKeys.length) {
            if (collection.plexRatingKey) {
              await storeCollectionMissingMembers(
                collection,
                collection.plexRatingKey,
                missingCandidates
              );
            }
            return {
              outcome:
                (!missingReport || missingReport.failed === 0) &&
                (!placeholderReport || placeholderReport.failed === 0) &&
                (Boolean(missingReport?.executions.length) ||
                  Boolean(placeholderReport?.created) ||
                  Boolean(placeholderReport?.retained))
                  ? ('success' as const)
                  : ('skipped' as const),
              durationMs: 0,
              errorMessage:
                missingReport?.executions.length || placeholderReport
                  ? `No source items matched Plex. Missing-media processing added ${missingReport?.added ?? 0}, found ${missingReport?.existing ?? 0} existing, skipped ${missingReport?.skipped ?? 0}, and failed ${missingReport?.failed ?? 0}. Placeholder processing created ${placeholderReport?.created ?? 0}, indexed ${placeholderReport?.indexed ?? 0}, retained ${placeholderReport?.retained ?? 0}, removed ${placeholderReport?.removed ?? 0}, and failed ${placeholderReport?.failed ?? 0}.`
                  : collection.sourceType === 'manual'
                    ? 'Add at least one manual Plex item before synchronization.'
                    : `No ${
                        collection.sourceType === 'trakt' ||
                        (collection.sourceType === 'comingsoon' &&
                          collection.sourceSettings?.subtype ===
                            'trakt_anticipated')
                          ? 'Trakt'
                          : collection.sourceType === 'mdblist'
                            ? 'MDBList'
                            : collection.sourceType === 'tautulli'
                              ? 'Tautulli'
                              : collection.sourceType === 'imdb'
                                ? 'IMDb'
                                : 'MyAnimeList'
                      } items matched media already present in the selected Plex library.`,
            };
          }
          if (!realDevelopmentPlexEnabled || !plexConfiguration)
            throw new Error(
              'Connect and verify Plex before synchronizing collections.'
            );
          const startedAt = Date.now();
          managedCollections = managedCollections.map((candidate) =>
            candidate.id === collection.id
              ? { ...candidate, status: 'syncing' as const }
              : candidate
          );
          await saveDevelopmentSources();
          try {
            const synchronizer = new ManagedCollectionSynchronizer(
              new PlexManagedCollectionClient({
                transport: developmentPlexTransport(plexConfiguration),
                machineIdentifier: plexConfiguration.machineIdentifier,
                verifiedServerName: plexConfiguration.name,
                allowedMutationServerNames: new Set(['Laptop']),
              })
            );
            const report = await synchronizer.synchronize(
              collection,
              memberKeys,
              signal
            );
            const synchronizedCollection = {
              ...collection,
              plexRatingKey: report.plexRatingKey,
            };
            const metadataReport = await new PlexDiscoveredItemSynchronizer(
              new PlexManagementClient(
                developmentPlexTransport(plexConfiguration)
              ),
              collectionSynchronizationAssets(plexConfiguration)
            ).synchronizeItem(
              managedCollectionAsPlexItem(
                synchronizedCollection,
                report.plexRatingKey
              ),
              collectionIsActive(collection.behaviorSettings),
              signal
            );
            const overlayReport = await applyCollectionMemberOverlays(
              synchronizedCollection,
              report.verifiedMemberKeys,
              signal
            );
            await storeCollectionMissingMembers(
              collection,
              report.plexRatingKey,
              missingCandidates
            );
            const failed =
              report.failures.length > 0 ||
              metadataReport.failures.length > 0 ||
              overlayReport.failed > 0 ||
              Boolean(missingReport?.failed) ||
              Boolean(placeholderReport?.failed);
            managedCollections = managedCollections.map((candidate) =>
              candidate.id === collection.id
                ? {
                    ...candidate,
                    plexRatingKey: report.plexRatingKey,
                    itemCount: report.verifiedMemberKeys.length,
                    status: failed ? ('error' as const) : ('ready' as const),
                    lastSyncedAt: new Date().toISOString(),
                  }
                : candidate
            );
            await saveDevelopmentSources();
            return {
              outcome: failed ? ('error' as const) : ('success' as const),
              durationMs: Date.now() - startedAt,
              created: report.created,
              ...(failed
                ? {
                    errorMessage: [
                      ...(report.failures.length
                        ? [
                            `Plex could not complete ${report.failures.join(', ')}.`,
                          ]
                        : []),
                      ...(metadataReport.failures.length
                        ? [
                            `Plex collection settings failed for ${metadataReport.failures
                              .map(
                                (failure) =>
                                  `${failure.operation}: ${failure.message}`
                              )
                              .join('; ')}.`,
                          ]
                        : []),
                      ...(overlayReport.failed
                        ? [
                            `${overlayReport.failed} collection member overlay${overlayReport.failed === 1 ? '' : 's'} failed.`,
                          ]
                        : []),
                      ...(missingReport?.failed
                        ? [
                            `${missingReport.failed} missing-media request${missingReport.failed === 1 ? '' : 's'} failed.`,
                          ]
                        : []),
                      ...(placeholderReport?.failed
                        ? [
                            `${placeholderReport.failed} placeholder operation${placeholderReport.failed === 1 ? '' : 's'} failed: ${placeholderReport.failures.join('; ')}.`,
                          ]
                        : []),
                    ].join(' '),
                  }
                : {}),
            };
          } catch (error) {
            managedCollections = managedCollections.map((candidate) =>
              candidate.id === collection.id
                ? { ...candidate, status: 'error' as const }
                : candidate
            );
            await saveDevelopmentSources();
            throw error;
          }
        }
        const startedAt = Date.now();
        const result = await runOverlayLibraryApplication(item.id, signal);
        return {
          outcome: result.failed ? ('error' as const) : ('success' as const),
          durationMs: Date.now() - startedAt,
          ...(result.failed
            ? {
                errorMessage: `${result.failed} poster${result.failed === 1 ? '' : 's'} failed during overlay application.`,
              }
            : {}),
        };
      },
      async cleanup(kind, signal) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (
          kind === 'collections' &&
          realDevelopmentPlexEnabled &&
          plexConfiguration
        ) {
          const synchronized = managedCollections
            .filter((collection) => Boolean(collection.plexRatingKey))
            .map((collection) => managedCollectionAsPlexItem(collection));
          const reports = await new PlexDiscoveredItemSynchronizer(
            new PlexManagementClient(
              developmentPlexTransport(plexConfiguration)
            ),
            collectionSynchronizationAssets(plexConfiguration)
          ).synchronizeHomeOrder(synchronized, signal);
          const failures = reports.flatMap((report) => report.failures);
          if (failures.length)
            throw new Error(
              `Plex Home ordering failed: ${failures
                .map((failure) => failure.message)
                .join('; ')}`
            );
        }
      },
    },
    () => new Date()
  )),
  dashboardInsights: {
    async summary() {
      const preExisting = discoveredPlexItems.filter(
        (item) => item.kind === 'pre-existing-collection' && !item.missing
      ).length;
      const tautulliConnected = Boolean(
        integrationConfigurations.get('tautulli')?.configured
      );
      const activity = tautulliConnected
        ? await tautulliClientFromConfiguration().activitySummary(7)
        : {
            totalPlays: 0,
            moviePlays: 0,
            showPlays: 0,
          };
      const collectionInputs = tautulliDashboardCollections();
      const collectionStatistics =
        tautulliConnected && collectionInputs.length
          ? await tautulliClientFromConfiguration().collectionStatistics(
              collectionInputs,
              7
            )
          : [];
      return {
        collections: {
          managed: managedCollections.length,
          preExisting,
          total: managedCollections.length + preExisting,
        },
        activity: {
          ...activity,
          collectionPlays: collectionStatistics.reduce(
            (total, item) => total + item.totalPlays,
            0
          ),
        },
        tautulliConnected,
        timestamp: new Date().toISOString(),
      };
    },
    async collectionStatistics(days) {
      const inputs = tautulliDashboardCollections();
      if (!inputs.length) return [];
      return tautulliClientFromConfiguration().collectionStatistics(
        inputs,
        days
      );
    },
    async missingItems(filters, limit, offset) {
      return missingRequestHistory.query(filters, limit, offset);
    },
    async syncMissingItems() {
      const pages = await Promise.all([
        missingRequestHistory.list('movie', 1000, 0),
        missingRequestHistory.list('show', 1000, 0),
      ]);
      const records = pages.flatMap((page) => page.results);
      await Promise.all(
        records
          .filter((record) => record.serviceId !== undefined)
          .map(async (record) => {
            if (record.requestService.toLowerCase() === 'seerr') {
              if (!seerrConfiguration) {
                await missingRequestHistory.complete(
                  record.operationKey,
                  {
                    requestStatus: 'failed',
                    notes: 'The recorded Seerr destination is no longer configured.',
                  },
                  new Date()
                );
                return;
              }
              try {
                const status = await seerrRequestCoordinator.status(
                  seerrConfiguration,
                  record.serviceId!
                );
                await missingRequestHistory.complete(
                  record.operationKey,
                  { requestStatus: status },
                  new Date()
                );
              } catch (error) {
                await missingRequestHistory.complete(
                  record.operationKey,
                  {
                    requestStatus: 'failed',
                    notes:
                      error instanceof Error
                        ? error.message
                        : 'Unable to synchronize Seerr request status.',
                  },
                  new Date()
                );
              }
              return;
            }
            const kind = record.mediaType === 'movie' ? 'radarr' : 'sonarr';
            const configuration =
              (record.serverId
                ? downloadConfigurations.get(record.serverId)
                : undefined) ??
              [...downloadConfigurations.values()].find(
                (candidate) =>
                  candidate.endpoint.kind === kind &&
                  candidate.selection.isDefault &&
                  !candidate.selection.is4k
              );
            if (!configuration) {
              await missingRequestHistory.complete(
                record.operationKey,
                {
                  requestStatus: 'failed',
                  notes: `The recorded ${kind === 'radarr' ? 'Radarr' : 'Sonarr'} destination is no longer configured.`,
                },
                new Date()
              );
              return;
            }
            try {
              const status = await arrClientForConfiguration(
                configuration
              ).itemStatus(kind, record.serviceId!);
              await missingRequestHistory.complete(
                record.operationKey,
                { requestStatus: status },
                new Date()
              );
            } catch (error) {
              await missingRequestHistory.complete(
                record.operationKey,
                {
                  requestStatus: 'failed',
                  notes:
                    error instanceof Error
                      ? error.message
                      : 'Unable to synchronize Arr item status.',
                },
                new Date()
              );
            }
          })
      );
    },
  },
  collectionSurface: {
    async get() {
      const managedLibraries = [
        ...new Set(
          managedCollections.map((collection) => collection.libraryId)
        ),
      ].map((id) => {
        const collections = managedCollections.filter(
          (collection) => collection.libraryId === id
        );
        return {
          id,
          name: collections[0]?.libraryName ?? id,
          mediaType: collections[0]?.mediaType ?? ('movie' as const),
          collectionCount: collections.length,
        };
      });
      const libraries = plexConfiguration
        ? plexConfiguration.libraries
            .filter(
              (library) =>
                library.available &&
                (library.type === 'movie' || library.type === 'show')
            )
            .map((library) => ({
              id: library.key,
              name: library.title,
              mediaType: library.type as 'movie' | 'show',
              collectionCount: managedCollections.filter(
                (collection) => collection.libraryId === library.key
              ).length,
            }))
        : managedLibraries;
      return {
        libraries,
        collections: managedCollections.map((collection) =>
          withBehaviorPlacement(collection)
        ),
        timestamp: new Date().toISOString(),
        discoveredPlexItems,
        discoveryStatus: {
          enabled: Boolean(plexConfiguration),
          plexConnected: Boolean(plexConfiguration),
          running: discoveryRunning,
          libraryCount: libraries.length,
          capabilities: {
            hubReordering: true,
            visibilityControl: true,
            builtInHubManagement: true,
            collectionHubManagement: true,
          },
        },
      };
    },
    async searchPlexItems(libraryId, query) {
      if (!realDevelopmentPlexEnabled || !plexConfiguration)
        throw new Error(
          'Connect and verify Plex before searching its library.'
        );
      if (plexConfiguration.name !== 'Laptop')
        throw new Error(
          `Development Plex search is restricted to Laptop; configured server is "${plexConfiguration.name}".`
        );
      const library = plexConfiguration.libraries.find(
        (item) =>
          item.key === libraryId &&
          item.available &&
          (item.type === 'movie' || item.type === 'show')
      );
      if (!library)
        throw new Error('The selected Plex library is unavailable.');
      const libraryType = library.type as 'movie' | 'show';
      const parameters = new URLSearchParams({
        type: libraryType === 'movie' ? '1' : '2',
        title: query.trim(),
        includeGuids: '1',
        'X-Plex-Container-Start': '0',
        'X-Plex-Container-Size': '50',
      });
      const response = await developmentPlexTransport(plexConfiguration).query(
        `/library/sections/${encodeURIComponent(library.key)}/all?${parameters}`
      );
      const container = plexRecord(response)?.MediaContainer;
      const metadata = plexRecords(plexRecord(container)?.Metadata);
      return metadata
        .map((item) => {
          const ratingKey = plexText(item.ratingKey);
          const title = plexText(item.title);
          const year = Number(item.year);
          return {
            ratingKey,
            title,
            ...(Number.isInteger(year) ? { year } : {}),
            type: libraryType,
            libraryId: library.key,
            libraryName: library.title,
          };
        })
        .filter((item) => item.ratingKey && item.title)
        .slice(0, 50);
    },
    async plexGeneratorValues(libraryId, subtype) {
      const configuration = requireDevelopmentLaptopPlex();
      const library = configuration.libraries.find(
        (item) =>
          item.key === libraryId &&
          item.available &&
          (item.type === 'movie' || item.type === 'show')
      );
      if (!library)
        throw new Error('The selected Plex library is unavailable.');
      return developmentLibraryGeneratorClient(configuration).values(
        libraryId,
        library.type as 'movie' | 'show',
        subtype
      );
    },
    async preview(id, signal) {
      const collection = managedCollections.find((item) => item.id === id);
      if (!collection) return undefined;
      if (collection.sourceType === 'manual') {
        const members = collection.sourceSettings?.manualMembers ?? [];
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: members.length,
          matchedCount: members.length,
          missingCount: 0,
          items: members.map((member) => ({
            title: member.title,
            ...(member.year ? { year: member.year } : {}),
            plexRatingKey: member.ratingKey,
            available: true,
          })),
          warnings: [],
        };
      }
      if (collection.sourceType === 'plex') {
        const configuration = requireDevelopmentLaptopPlex();
        const subtype = collection.sourceSettings?.subtype;
        const libraryGeneratorSubtypes = [
          'genres',
          'decades',
          'resolutions',
          'content-ratings',
        ] as const;
        if (
          libraryGeneratorSubtypes.includes(
            subtype as (typeof libraryGeneratorSubtypes)[number]
          )
        ) {
          const settings = collection.sourceSettings?.plexGenerator;
          const values = await developmentLibraryGeneratorClient(
            configuration
          ).values(
            collection.libraryId,
            collection.mediaType,
            subtype as PlexLibraryGeneratorSubtype,
            signal
          );
          const selected = new Set(settings?.selectedValues ?? []);
          const enabledGroups = new Set(
            settings?.enabledRatingGroups ?? [
              'australia',
              'television',
              'numeric',
              'other',
            ]
          );
          const desired = values.filter(
            (entry) =>
              selected.has(entry.value) &&
              (!entry.group || enabledGroups.has(entry.group))
          );
          return {
            collectionId: collection.id,
            sourceType: collection.sourceType,
            fetchedCount: values.length,
            matchedCount: desired.length,
            missingCount: values.length - desired.length,
            items: desired.map((entry) => ({
              title: (
                settings?.titleTemplate?.trim() || '{value}'
              ).replaceAll('{value}', entry.label),
              available: true,
            })),
            warnings: [
              `${desired.length} smart collection${desired.length === 1 ? '' : 's'} selected from ${values.length} values currently known by Plex.`,
              settings?.cleanupMissing === false
                ? 'Automatic cleanup is disabled; generated collections remain when values disappear.'
                : 'Generated collections whose values disappear will be removed on synchronization.',
            ],
          };
        }
        if (subtype !== 'actors' && subtype !== 'directors')
          throw new Error(
            'Choose Auto Director Collections or Auto Actor Collections.'
          );
        const minimum = collection.sourceSettings?.personMinimumItems ?? 5;
        const people = await developmentPersonCollectionClient(
          configuration
        ).people(collection.libraryId, collection.mediaType, subtype, signal);
        const qualifying = people
          .filter((person) => person.count >= minimum)
          .slice(0, collection.sourceSettings?.maxItems ?? 50);
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: qualifying.length,
          matchedCount: qualifying.length,
          missingCount: 0,
          items: qualifying.map((person) => ({
            title: `${person.name} (${person.count} items)`,
            available: true,
          })),
          warnings: qualifying.length
            ? [
                `${qualifying.length} ${subtype === 'actors' ? 'actor' : 'director'} collection${qualifying.length === 1 ? '' : 's'} will be generated from this Plex library.`,
                ...(people.length > qualifying.length
                  ? [
                      `${people.length - qualifying.length} ${subtype === 'actors' ? 'actor' : 'director'}${people.length - qualifying.length === 1 ? '' : 's'} were ignored because they did not meet the ${minimum}-item minimum or exceeded the family limit.`,
                    ]
                  : []),
              ]
            : [
                `No ${subtype === 'actors' ? 'actors' : 'directors'} meet the ${minimum}-item minimum in this Plex library.`,
              ],
        };
      }
      if (
        collection.sourceType !== 'seerr' &&
        collection.sourceType !== 'tmdb' &&
        collection.sourceType !== 'letterboxd' &&
        collection.sourceType !== 'multi-source' &&
        collection.sourceType !== 'trakt' &&
        !(
          collection.sourceType === 'comingsoon' &&
          collection.sourceSettings?.subtype === 'trakt_anticipated'
        ) &&
        collection.sourceType !== 'mal' &&
        collection.sourceType !== 'anilist' &&
        collection.sourceType !== 'mdblist' &&
        collection.sourceType !== 'tautulli' &&
        collection.sourceType !== 'imdb' &&
        collection.sourceType !== 'radarrtag' &&
        collection.sourceType !== 'sonarrtag'
      ) {
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: 0,
          matchedCount: 0,
          missingCount: 0,
          items: [],
          warnings: [
            `${collection.sourceType} source preview is not connected yet.`,
          ],
        };
      }
      if (collection.sourceType === 'seerr') {
        const sourceItems = await resolveSeerrSourceItems(collection, signal);
        const matches = await plexMemberKeysForTraktItems(
          collection,
          sourceItems,
          signal
        );
        const items = sourceItems.map((item) => {
          const plexRatingKey = matches.get(item.tmdbId);
          return {
            title: item.title,
            ...(item.year ? { year: item.year } : {}),
            tmdbId: item.tmdbId,
            ...(plexRatingKey ? { plexRatingKey } : {}),
            available: Boolean(plexRatingKey),
          };
        });
        const matchedCount = items.filter((item) => item.available).length;
        const subtype = collection.sourceSettings?.subtype;
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: items.length,
          matchedCount,
          missingCount: items.length - matchedCount,
          items,
          warnings: [
            subtype === 'users'
              ? 'Requests from every non-owner Seerr user are combined here. Per-user restricted collection generation remains a separate family workflow.'
              : subtype === 'server_owner'
                ? 'Showing requests made by the Seerr server owner.'
                : 'Showing requests made by all Seerr users.',
            ...(items.length === 0
              ? [
                  `Seerr returned no ${
                    collection.mediaType === 'movie' ? 'movie' : 'TV'
                  } requests for this source.`,
                ]
              : matchedCount === items.length
                ? []
                : [
                    `${items.length - matchedCount} requested item${items.length - matchedCount === 1 ? ' is' : 's are'} not currently available in this Plex library.`,
                  ]),
          ],
        };
      }
      if (collection.sourceType === 'tmdb' || collection.sourceType === 'letterboxd' || collection.sourceType === 'multi-source') {
        const composed=collection.sourceType==='multi-source'?await resolveMultiSourceItems(collection,signal):undefined;const sourceItems=collection.sourceType==='tmdb'?await resolveTmdbSourceItems(collection,signal):collection.sourceType==='letterboxd'?await resolveLetterboxdSourceItems(collection,signal):composed!.items;
        const matches=await plexMemberKeysForTraktItems(collection,sourceItems,signal);
        const items=sourceItems.map((item)=>{const plexRatingKey=matches.get(item.tmdbId);return{title:item.title,...(item.year?{year:item.year}:{}),tmdbId:item.tmdbId,...(plexRatingKey?{plexRatingKey}:{}),available:Boolean(plexRatingKey)};});
        const matchedCount=items.filter((item)=>item.available).length;
        const provider=collection.sourceType==='tmdb'?'TMDB':collection.sourceType==='letterboxd'?'Letterboxd':'Multi-source';return{collectionId:collection.id,sourceType:collection.sourceType,fetchedCount:items.length,matchedCount,missingCount:items.length-matchedCount,items,warnings:[...(composed?.warnings??[]),...(items.length===0?[`${provider} returned no media for this collection.`]:matchedCount===items.length?[]:[`${items.length-matchedCount} ${provider} item${items.length-matchedCount===1?' is':'s are'} not currently available in this Plex library.`])]};
      }
      if (
        collection.sourceType === 'radarrtag' ||
        collection.sourceType === 'sonarrtag'
      ) {
        const sourceItems = await resolveArrTagSourceItems(collection, signal);
        const matches = await plexMemberKeysForArrTagItems(
          collection,
          sourceItems,
          signal
        );
        const items = sourceItems.map((item) => {
          const plexRatingKey = matches.get(item.serviceId);
          return {
            title: item.title,
            ...(item.year ? { year: item.year } : {}),
            ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}),
            ...(plexRatingKey ? { plexRatingKey } : {}),
            available: Boolean(plexRatingKey),
          };
        });
        const matchedCount = items.filter((item) => item.available).length;
        const service =
          collection.sourceType === 'radarrtag' ? 'Radarr' : 'Sonarr';
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: items.length,
          matchedCount,
          missingCount: items.length - matchedCount,
          items,
          warnings:
            items.length === 0
              ? [`No ${service} items currently use the selected tag.`]
              : matchedCount === items.length
                ? []
                : [
                    `${items.length - matchedCount} tagged ${service} item${items.length - matchedCount === 1 ? ' is' : 's are'} not currently available in this Plex library.`,
                  ],
        };
      }
      if (collection.sourceType === 'mal') {
        const sourceItems = await resolveMyAnimeListSourceItems(
          collection,
          signal
        );
        const matches = await plexMemberKeysForMyAnimeListItems(
          collection,
          sourceItems,
          signal
        );
        const items = sourceItems.map((item) => {
          const plexRatingKey = matches.get(item.malId);
          return {
            title: item.title,
            ...(item.year ? { year: item.year } : {}),
            ...(item.tmdbIds[0] ? { tmdbId: item.tmdbIds[0] } : {}),
            ...(plexRatingKey ? { plexRatingKey } : {}),
            available: Boolean(plexRatingKey),
          };
        });
        const matchedCount = items.filter((item) => item.available).length;
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: items.length,
          matchedCount,
          missingCount: items.length - matchedCount,
          items,
          warnings:
            items.length === 0
              ? [
                  `MyAnimeList returned no ${
                    collection.mediaType === 'movie' ? 'movies' : 'shows'
                  } for this collection.`,
                ]
              : matchedCount === items.length
                ? []
                : [
                    `${items.length - matchedCount} MyAnimeList item${items.length - matchedCount === 1 ? ' is' : 's are'} not currently available in this Plex library.`,
                  ],
        };
      }
      if (collection.sourceType === 'anilist') {
        const sourceItems = await resolveAniListSourceItems(collection, signal);
        const matches = await plexMemberKeysForAniListItems(
          collection,
          sourceItems,
          signal
        );
        const items = sourceItems.map((item) => {
          const plexRatingKey = matches.get(item.anilistId);
          return {
            title: item.title,
            ...(item.year ? { year: item.year } : {}),
            ...(item.tmdbIds[0] ? { tmdbId: item.tmdbIds[0] } : {}),
            ...(plexRatingKey ? { plexRatingKey } : {}),
            available: Boolean(plexRatingKey),
          };
        });
        const matchedCount = items.filter((item) => item.available).length;
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: items.length,
          matchedCount,
          missingCount: items.length - matchedCount,
          items,
          warnings:
            items.length === 0
              ? [
                  `AniList returned no ${
                    collection.mediaType === 'movie' ? 'movies' : 'shows'
                  } for this collection.`,
                ]
              : matchedCount === items.length
                ? []
                : [
                    `${items.length - matchedCount} AniList item${items.length - matchedCount === 1 ? ' is' : 's are'} not currently available in this Plex library.`,
                  ],
        };
      }
      if (collection.sourceType === 'tautulli') {
        const sourceItems = await resolveTautulliSourceItems(
          collection,
          signal
        );
        const matches = await plexMemberKeysForTautulliItems(
          collection,
          sourceItems,
          signal
        );
        const items = sourceItems.map((item) => ({
          title: item.title,
          ...(item.year ? { year: item.year } : {}),
          plexRatingKey: item.ratingKey,
          available: matches.has(item.ratingKey),
        }));
        const matchedCount = items.filter((item) => item.available).length;
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: items.length,
          matchedCount,
          missingCount: items.length - matchedCount,
          items,
          warnings:
            items.length === 0
              ? ['Tautulli returned no media for this collection.']
              : matchedCount === items.length
                ? []
                : [
                    `${items.length - matchedCount} Tautulli item${items.length - matchedCount === 1 ? '' : 's'} are not available in this Plex library.`,
                  ],
        };
      }
      if (collection.sourceType === 'imdb') {
        const sourceItems = await resolveImdbSourceItems(collection, signal);
        const matches = await plexMemberKeysForImdbItems(
          collection,
          sourceItems,
          signal
        );
        const items = sourceItems.map((item) => {
          const plexRatingKey = matches.get(item.imdbId.toLowerCase());
          return {
            title: item.title,
            ...(item.year ? { year: item.year } : {}),
            ...(plexRatingKey ? { plexRatingKey } : {}),
            available: Boolean(plexRatingKey),
          };
        });
        const matchedCount = items.filter((item) => item.available).length;
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: items.length,
          matchedCount,
          missingCount: items.length - matchedCount,
          items,
          warnings:
            matchedCount === items.length
              ? []
              : [
                  `${items.length - matchedCount} IMDb item${items.length - matchedCount === 1 ? ' is' : 's are'} not currently available in this Plex library.`,
                ],
        };
      }
      const sourceItems =
        collection.sourceType === 'mdblist'
          ? await resolveMDBListSourceItems(collection, signal)
          : await resolveTraktSourceItems(collection, signal);
      const matches = await plexMemberKeysForTraktItems(
        collection,
        sourceItems,
        signal
      );
      const items = sourceItems.map((item) => {
        const plexRatingKey = matches.get(item.tmdbId);
        return {
          title: item.title,
          ...(item.year ? { year: item.year } : {}),
          tmdbId: item.tmdbId,
          ...(plexRatingKey ? { plexRatingKey } : {}),
          available: Boolean(plexRatingKey),
        };
      });
      const matchedCount = items.filter((item) => item.available).length;
      return {
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: items.length,
        matchedCount,
        missingCount: items.length - matchedCount,
        items,
        warnings:
          items.length === 0
            ? [
                `${
                  collection.sourceType === 'mdblist' ? 'MDBList' : 'Trakt'
                } returned no ${
                  collection.mediaType === 'movie' ? 'movies' : 'shows'
                } for this collection.`,
              ]
            : matchedCount === items.length
              ? []
              : [
                  `${items.length - matchedCount} ${
                    collection.sourceType === 'mdblist' ? 'MDBList' : 'Trakt'
                  } item${items.length - matchedCount === 1 ? ' is' : 's are'} not currently available in this Plex library.`,
                ],
      };
    },
    async updatePlacement(id, input) {
      const index = managedCollections.findIndex(
        (collection) => collection.id === id
      );
      const current = managedCollections[index];
      if (!current) return undefined;
      const updated = { ...current, ...input };
      managedCollections = managedCollections.map((collection, itemIndex) =>
        itemIndex === index ? updated : collection
      );
      await saveDevelopmentSources();
      return updated;
    },
    async reorderPlacement(firstId, secondId, orderKey) {
      const first = managedCollections.find(
        (collection) => collection.id === firstId
      );
      const second = managedCollections.find(
        (collection) => collection.id === secondId
      );
      if (
        !first ||
        !second ||
        (orderKey === 'libraryOrder' && first.libraryId !== second.libraryId)
      )
        return false;
      const firstOrder = first[orderKey];
      const secondOrder = second[orderKey];
      managedCollections = managedCollections.map((collection) =>
        collection.id === firstId
          ? { ...collection, [orderKey]: secondOrder }
          : collection.id === secondId
            ? { ...collection, [orderKey]: firstOrder }
            : collection
      );
      await saveDevelopmentSources();
      return true;
    },
    async save(id, draft) {
      const normalizedLibrary =
        plexConfiguration?.libraries.find(
          (item) => item.key === draft.libraryId
        ) ??
        plexConfiguration?.libraries.find(
          (item) =>
            item.available &&
            item.type === draft.mediaType &&
            (item.title === draft.libraryId ||
              managedCollections.some(
                (collection) =>
                  collection.libraryId === draft.libraryId &&
                  collection.libraryName === item.title
              ))
        );
      const normalizedDraft = normalizedLibrary
        ? { ...draft, libraryId: normalizedLibrary.key }
        : draft;
      const libraryName =
        plexConfiguration?.libraries.find(
          (item) => item.key === normalizedDraft.libraryId
        )?.title ??
        managedCollections.find(
          (item) => item.libraryId === normalizedDraft.libraryId
        )?.libraryName ??
        (normalizedDraft.libraryId === 'movies'
          ? 'Movies'
          : normalizedDraft.libraryId === 'tv'
            ? 'TV Shows'
            : normalizedDraft.libraryId);
      if (!id) {
        const created: ManagedCollection = {
          id: `${normalizedDraft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID().slice(0, 6)}`,
          ...normalizedDraft,
          libraryName,
          itemCount: 0,
          homeVisible: false,
          recommendedVisible: false,
          libraryVisible: true,
          sharedOrder: managedCollections.length,
          libraryOrder: managedCollections.filter(
            (item) => item.libraryId === normalizedDraft.libraryId
          ).length,
          status: 'needs-sync',
        };
        const placed = withBehaviorPlacement(created);
        managedCollections = [...managedCollections, placed];
        refreshPosterUsage();
        await saveDevelopmentSources();
        return placed;
      }
      const index = managedCollections.findIndex((item) => item.id === id);
      const current = managedCollections[index];
      if (!current) return undefined;
      const currentGenerated =
        current.sourceSettings?.plexGenerator?.generatedCollections ?? [];
      const keepsGeneratorIdentity =
        normalizedDraft.sourceType === 'plex' &&
        normalizedDraft.sourceSettings.subtype ===
          current.sourceSettings?.subtype;
      if (currentGenerated.length && !keepsGeneratorIdentity) {
        const client = developmentLibraryGeneratorClient(
          requireDevelopmentLaptopPlex()
        );
        for (const generated of currentGenerated)
          await client.delete(generated.ratingKey);
      }
      const updated = withBehaviorPlacement({
        ...current,
        ...normalizedDraft,
        ...(current.isLinked
          ? {
              libraryId: current.libraryId,
              libraryName: current.libraryName,
              mediaType: current.mediaType,
            }
          : { libraryName }),
        status: 'needs-sync' as const,
      });
      managedCollections = managedCollections.map((item, itemIndex) => {
        if (itemIndex === index) return updated;
        if (
          !current.isLinked ||
          !current.linkGroupId ||
          item.linkGroupId !== current.linkGroupId ||
          !item.isLinked
        ) {
          return item;
        }
        return withBehaviorPlacement({
          ...item,
          ...normalizedDraft,
          libraryId: item.libraryId,
          libraryName: item.libraryName,
          mediaType: item.mediaType,
          posterSettings: item.posterSettings?.customPoster
            ? {
                ...draft.posterSettings,
                customPoster: item.posterSettings.customPoster,
              }
            : draft.posterSettings,
          homeVisible: item.homeVisible,
          recommendedVisible: item.recommendedVisible,
          libraryVisible: item.libraryVisible,
          sharedOrder: item.sharedOrder,
          libraryOrder: item.libraryOrder,
          itemCount: item.itemCount,
          status: 'needs-sync' as const,
        });
      });
      refreshPosterUsage();
      await saveDevelopmentSources();
      return updated;
    },
    async copy(id) {
      const source = managedCollections.find((item) => item.id === id);
      if (!source) return undefined;
      const { lastSyncedAt: _lastSyncedAt, ...copySource } = source;
      const {
        linkGroupId: _linkGroupId,
        isLinked: _isLinked,
        isUnlinked: _isUnlinked,
        ...independentCopySource
      } = copySource;
      const copy: ManagedCollection = {
        ...independentCopySource,
        id: `${source.id}-copy-${crypto.randomUUID().slice(0, 6)}`,
        title: `${source.title} Copy`,
        homeVisible: false,
        recommendedVisible: false,
        sharedOrder: managedCollections.length,
        libraryOrder: managedCollections.filter(
          (item) => item.libraryId === source.libraryId
        ).length,
        status: 'needs-sync',
        isLinked: false,
        isUnlinked: false,
      };
      managedCollections = [...managedCollections, copy];
      refreshPosterUsage();
      await saveDevelopmentSources();
      return copy;
    },
    async delete(id) {
      const selected = managedCollections.find((item) => item.id === id);
      const ids = new Set(
        selected?.isLinked && selected.linkGroupId
          ? managedCollections
              .filter(
                (item) =>
                  item.isLinked && item.linkGroupId === selected.linkGroupId
              )
              .map((item) => item.id)
          : [id]
      );
      const previousLength = managedCollections.length;
      const generatedTargets = managedCollections
        .filter((item) => ids.has(item.id))
        .flatMap(
          (item) =>
            item.sourceSettings?.plexGenerator?.generatedCollections ?? []
        );
      if (generatedTargets.length) {
        const client = developmentLibraryGeneratorClient(
          requireDevelopmentLaptopPlex()
        );
        for (const generated of generatedTargets)
          await client.delete(generated.ratingKey);
      }
      managedCollections = managedCollections.filter(
        (item) => !ids.has(item.id)
      );
      refreshPosterUsage();
      await saveDevelopmentSources();
      return previousLength !== managedCollections.length;
    },
    async link(masterId, memberIds) {
      const master = managedCollections.find((item) => item.id === masterId);
      if (!master) return undefined;
      const requestedIds = [...new Set([masterId, ...memberIds])];
      const requested = requestedIds
        .map((id) => managedCollections.find((item) => item.id === id))
        .filter((item): item is ManagedCollection => Boolean(item));
      if (
        requested.length < 2 ||
        requested.length !== requestedIds.length ||
        requested.some(
          (item) =>
            item.mediaType !== master.mediaType ||
            item.sourceType !== master.sourceType
        ) ||
        new Set(requested.map((item) => item.libraryId)).size !==
          requested.length
      )
        return undefined;
      const groupId =
        master.linkGroupId ?? `collection-group-${crypto.randomUUID()}`;
      const ids = new Set(requestedIds);
      managedCollections = managedCollections.map((item) => {
        if (!ids.has(item.id)) return item;
        return withBehaviorPlacement({
          ...item,
          title: master.title,
          description: master.description,
          ...(master.sourceSettings
            ? { sourceSettings: master.sourceSettings }
            : {}),
          ...(master.behaviorSettings
            ? { behaviorSettings: master.behaviorSettings }
            : {}),
          ...(master.missingMediaSettings
            ? { missingMediaSettings: master.missingMediaSettings }
            : {}),
          ...(master.multiSourceSettings
            ? { multiSourceSettings: master.multiSourceSettings }
            : {}),
          ...(master.metadataSettings
            ? { metadataSettings: master.metadataSettings }
            : {}),
          ...(master.tmdbDiscoverSettings
            ? { tmdbDiscoverSettings: master.tmdbDiscoverSettings }
            : {}),
          ...((master.posterSettings ?? item.posterSettings)
            ? {
                posterSettings: item.posterSettings?.customPoster
                  ? {
                      ...(master.posterSettings ?? item.posterSettings!),
                      customPoster: item.posterSettings.customPoster,
                    }
                  : (master.posterSettings ?? item.posterSettings!),
              }
            : {}),
          status: 'needs-sync',
          linkGroupId: groupId,
          isLinked: true,
          isUnlinked: false,
        });
      });
      refreshPosterUsage();
      await saveDevelopmentSources();
      return {
        groupId,
        collections: managedCollections.filter((item) => ids.has(item.id)),
      };
    },
    async unlink(id) {
      const selected = managedCollections.find((item) => item.id === id);
      if (!selected?.isLinked || !selected.linkGroupId) return undefined;
      const groupId = selected.linkGroupId;
      const members = managedCollections.filter(
        (item) => item.linkGroupId === groupId && item.isLinked
      );
      if (members.length < 2) return undefined;
      const ids = new Set(members.map((item) => item.id));
      managedCollections = managedCollections.map((item) =>
        ids.has(item.id)
          ? {
              ...item,
              isLinked: false,
              isUnlinked: true,
              status: 'needs-sync' as const,
            }
          : item
      );
      await saveDevelopmentSources();
      return {
        groupId,
        collections: managedCollections.filter((item) => ids.has(item.id)),
      };
    },
    async discoverPlex() {
      if (discoveryRunning)
        throw new Error('Plex discovery is already running.');
      if (!plexConfiguration)
        throw new Error('Connect and verify Plex before running discovery.');
      discoveryRunning = true;
      try {
        const now = new Date().toISOString();
        if (realDevelopmentPlexEnabled) {
          if (plexConfiguration.name !== 'Laptop') {
            throw new Error(
              `Development Plex discovery is restricted to Laptop; configured server is "${plexConfiguration.name}".`
            );
          }
          const result = await new PlexDiscoveryCoordinator({
            scanner: new PlexDiscoveryScanner(
              developmentPlexTransport(plexConfiguration)
            ),
            repository: realDevelopmentPlexDiscovery,
            libraries: async () => plexConfiguration!.libraries,
            managedCollectionKeys: async () => new Set(),
            now: () => now,
          }).scan();
          discoveredPlexItems = [
            ...(await realDevelopmentPlexDiscovery.get()).items,
          ];
          return result;
        }
        const observed: PlexDiscoveredItem[] = [
          {
            id: 'plex-hub-recent-movies',
            kind: 'default-hub',
            plexKey: 'movie.recentlyadded',
            name: 'Recently Added Movies',
            libraryId: 'movies',
            libraryName: 'Movies',
            mediaType: 'movie',
            homeOrder: 1,
            libraryOrder: 1,
            visibility: {
              usersHome: true,
              serverOwnerHome: true,
              libraryRecommended: true,
            },
            missing: false,
            isLinked: false,
            isUnlinked: false,
            lastValidatedAt: now,
            timeRestriction: alwaysActiveDiscoveredSchedule,
          },
          {
            id: 'plex-existing-oscar',
            kind: 'pre-existing-collection',
            plexKey: '35954',
            name: 'Oscar Favorites',
            libraryId: 'movies',
            libraryName: 'Movies',
            mediaType: 'movie',
            titleSort: 'Oscar Favorites',
            homeOrder: 0,
            libraryOrder: 0,
            visibility: {
              usersHome: false,
              serverOwnerHome: false,
              libraryRecommended: false,
            },
            missing: false,
            isLinked: false,
            isUnlinked: false,
            lastValidatedAt: now,
            timeRestriction: alwaysActiveDiscoveredSchedule,
            posterSettings: defaultDiscoveredPosterSettings,
            metadataSettings: defaultDiscoveredMetadataSettings,
          },
          {
            id: 'plex-hub-recent-movies-4k',
            kind: 'default-hub',
            plexKey: 'movie.recentlyadded',
            name: 'Recently Added Movies',
            libraryId: 'movies-4k',
            libraryName: 'Movies 4K',
            mediaType: 'movie',
            homeOrder: 2,
            libraryOrder: 1,
            visibility: {
              usersHome: true,
              serverOwnerHome: true,
              libraryRecommended: true,
            },
            missing: false,
            isLinked: false,
            isUnlinked: false,
            lastValidatedAt: now,
            timeRestriction: alwaysActiveDiscoveredSchedule,
          },
          {
            id: 'plex-existing-oscar-4k',
            kind: 'pre-existing-collection',
            plexKey: '73595',
            name: 'Oscar Favorites',
            libraryId: 'movies-4k',
            libraryName: 'Movies 4K',
            mediaType: 'movie',
            titleSort: 'Oscar Favorites',
            homeOrder: 0,
            libraryOrder: 0,
            visibility: {
              usersHome: false,
              serverOwnerHome: false,
              libraryRecommended: false,
            },
            missing: false,
            isLinked: false,
            isUnlinked: false,
            lastValidatedAt: now,
            timeRestriction: alwaysActiveDiscoveredSchedule,
            posterSettings: defaultDiscoveredPosterSettings,
            metadataSettings: defaultDiscoveredMetadataSettings,
          },
        ];
        const previousById = new Map(
          discoveredPlexItems.map((item) => [item.id, item])
        );
        const refreshed = observed.map((item) => {
          const previous = previousById.get(item.id);
          if (!previous) return item;
          return {
            ...item,
            homeOrder: previous.homeOrder,
            libraryOrder: previous.libraryOrder,
            visibility: previous.visibility,
            timeRestriction: previous.timeRestriction,
            isLinked: previous.isLinked,
            isUnlinked: previous.isUnlinked,
            ...(previous.titleSort ? { titleSort: previous.titleSort } : {}),
            ...(previous.posterSettings
              ? { posterSettings: previous.posterSettings }
              : {}),
            ...(previous.metadataSettings
              ? { metadataSettings: previous.metadataSettings }
              : {}),
            ...(previous.linkGroupId
              ? { linkGroupId: previous.linkGroupId }
              : {}),
          };
        });
        const existingIds = new Set(discoveredPlexItems.map((item) => item.id));
        const imported = refreshed.filter((item) => !existingIds.has(item.id));
        const missingKnown = discoveredPlexItems
          .filter(
            (item) => !refreshed.some((current) => current.id === item.id)
          )
          .map((item) => ({ ...item, missing: true, lastValidatedAt: now }));
        discoveredPlexItems = [...refreshed, ...missingKnown];
        return {
          imported,
          totalHubs: observed.filter((item) => item.kind === 'default-hub')
            .length,
          totalPreExistingCollections: observed.filter(
            (item) => item.kind === 'pre-existing-collection'
          ).length,
          validated: discoveredPlexItems.length,
          missingIds: missingKnown.map((item) => item.id),
          completedAt: now,
        };
      } finally {
        discoveryRunning = false;
      }
    },
    async updateDiscoveredPlexItem(id, draft) {
      const index = discoveredPlexItems.findIndex((item) => item.id === id);
      const current = discoveredPlexItems[index];
      if (!current) return undefined;
      const { titleSort: _titleSort, ...withoutTitleSort } = current;
      const updated: PlexDiscoveredItem = {
        ...withoutTitleSort,
        homeOrder: draft.homeOrder,
        libraryOrder: draft.libraryOrder,
        visibility: draft.visibility,
        timeRestriction: {
          ...draft.timeRestriction,
          removeFromPlexWhenInactive: false,
        },
        ...(current.kind === 'pre-existing-collection'
          ? {
              posterSettings: draft.posterSettings ?? current.posterSettings,
              metadataSettings:
                draft.metadataSettings ?? current.metadataSettings,
            }
          : {}),
        ...(draft.titleSort?.trim()
          ? { titleSort: draft.titleSort.trim() }
          : {}),
        lastValidatedAt: new Date().toISOString(),
      };
      discoveredPlexItems = discoveredPlexItems.map((item, itemIndex) => {
        if (itemIndex === index) return updated;
        if (
          !current.isLinked ||
          !current.linkGroupId ||
          !item.isLinked ||
          item.linkGroupId !== current.linkGroupId
        )
          return item;
        const masterPoster = updated.posterSettings;
        const masterMetadata = updated.metadataSettings;
        return {
          ...item,
          visibility: updated.visibility,
          timeRestriction: updated.timeRestriction,
          ...(updated.titleSort ? { titleSort: updated.titleSort } : {}),
          ...(masterPoster
            ? {
                posterSettings: item.posterSettings?.customPoster
                  ? {
                      ...masterPoster,
                      customPoster: item.posterSettings.customPoster,
                    }
                  : masterPoster,
              }
            : {}),
          ...(masterMetadata
            ? {
                metadataSettings: {
                  ...masterMetadata,
                  ...(item.metadataSettings?.wallpaper
                    ? { wallpaper: item.metadataSettings.wallpaper }
                    : {}),
                  ...(item.metadataSettings?.theme
                    ? { theme: item.metadataSettings.theme }
                    : {}),
                },
              }
            : {}),
          lastValidatedAt: updated.lastValidatedAt,
        };
      });
      await persistRealDevelopmentPlexItems();
      return updated;
    },
    async linkDiscoveredPlexItems(masterId, memberIds) {
      const master = discoveredPlexItems.find((item) => item.id === masterId);
      if (!master || master.missing) return undefined;
      const requestedIds = [...new Set([masterId, ...memberIds])];
      const requested = requestedIds
        .map((id) => discoveredPlexItems.find((item) => item.id === id))
        .filter((item): item is PlexDiscoveredItem => Boolean(item));
      const compatible = (item: PlexDiscoveredItem) =>
        !item.missing &&
        item.kind === master.kind &&
        item.mediaType === master.mediaType &&
        item.libraryId !== master.libraryId &&
        (master.kind === 'default-hub'
          ? item.plexKey === master.plexKey
          : item.name.trim().toLocaleLowerCase() ===
            master.name.trim().toLocaleLowerCase()) &&
        (!item.isLinked || item.linkGroupId === master.linkGroupId);
      if (
        requested.length < 2 ||
        requested.length !== requestedIds.length ||
        requested.slice(1).some((item) => !compatible(item)) ||
        new Set(requested.map((item) => item.libraryId)).size !==
          requested.length
      )
        return undefined;
      const preservedGroup = requested.find(
        (item) => item.linkGroupId
      )?.linkGroupId;
      const groupId =
        master.linkGroupId ??
        preservedGroup ??
        `plex-discovery-group-${crypto.randomUUID()}`;
      const ids = new Set(requestedIds);
      discoveredPlexItems = discoveredPlexItems.map((item) => {
        if (!ids.has(item.id)) return item;
        const poster = master.posterSettings;
        const metadata = master.metadataSettings;
        return {
          ...item,
          visibility: master.visibility,
          timeRestriction: master.timeRestriction,
          ...(master.titleSort ? { titleSort: master.titleSort } : {}),
          ...(poster
            ? {
                posterSettings: item.posterSettings?.customPoster
                  ? {
                      ...poster,
                      customPoster: item.posterSettings.customPoster,
                    }
                  : poster,
              }
            : {}),
          ...(metadata
            ? {
                metadataSettings: {
                  ...metadata,
                  ...(item.metadataSettings?.wallpaper
                    ? { wallpaper: item.metadataSettings.wallpaper }
                    : {}),
                  ...(item.metadataSettings?.theme
                    ? { theme: item.metadataSettings.theme }
                    : {}),
                },
              }
            : {}),
          isLinked: true,
          isUnlinked: false,
          linkGroupId: groupId,
        };
      });
      await persistRealDevelopmentPlexItems();
      return {
        groupId,
        items: discoveredPlexItems.filter((item) => ids.has(item.id)),
      };
    },
    async unlinkDiscoveredPlexItems(id) {
      const selected = discoveredPlexItems.find((item) => item.id === id);
      if (!selected?.isLinked || !selected.linkGroupId) return undefined;
      const groupId = selected.linkGroupId;
      const members = discoveredPlexItems.filter(
        (item) => item.isLinked && item.linkGroupId === groupId
      );
      if (members.length < 2) return undefined;
      const ids = new Set(members.map((item) => item.id));
      discoveredPlexItems = discoveredPlexItems.map((item) =>
        ids.has(item.id) ? { ...item, isLinked: false, isUnlinked: true } : item
      );
      await persistRealDevelopmentPlexItems();
      return {
        groupId,
        items: discoveredPlexItems.filter((item) => ids.has(item.id)),
      };
    },
    async cleanupMissingPlexItems() {
      const missing = discoveredPlexItems.filter((item) => item.missing);
      discoveredPlexItems = discoveredPlexItems.filter((item) => !item.missing);
      await persistRealDevelopmentPlexItems();
      return {
        cleanupCount: missing.length,
        plexHubDeleteCount: missing.length,
        warnings: [],
      };
    },
  },
  posterOverlays: {
    async get() {
      if (
        !posterLibraryCountsLoaded &&
        realDevelopmentPlexEnabled &&
        plexConfiguration
      ) {
        const counts = await Promise.all(
          posterOverlayWorkspace.libraries.map(async (library) => ({
            id: library.id,
            count: (await overlayItemsForLibrary(library.id)).length,
          }))
        );
        posterOverlayWorkspace = {
          ...posterOverlayWorkspace,
          libraries: posterOverlayWorkspace.libraries.map((library) => ({
            ...library,
            itemCount:
              counts.find((entry) => entry.id === library.id)?.count ?? 0,
          })),
        };
        posterLibraryCountsLoaded = true;
      }
      const maintainerrConfigured =
        integrationConfigurations.get('maintainerr')?.configured === true;
      return {
        ...posterOverlayWorkspace,
        libraries: posterOverlayWorkspace.libraries.map((library) => ({
          ...library,
          maintainerrConfigured,
        })),
      };
    },
    async saveSource(expectedRevision, source) {
      if (posterOverlayWorkspace.source.revision !== expectedRevision)
        return undefined;
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        source: {
          ...posterOverlayWorkspace.source,
          source,
          revision: expectedRevision + 1,
          updatedAt: new Date().toISOString(),
        },
      };
      await saveDevelopmentSources();
      return posterOverlayWorkspace;
    },
    async generateLocalFolders() {
      return previewPosterCoordinator.run('generate-local-folders', async () => {
        const items = (
          await Promise.all(
            posterOverlayWorkspace.libraries.map((library) =>
              overlayItemsForLibrary(library.id)
            )
          )
        ).flat();
        return generateLocalPosterFolders(
          posterOverlayWorkspace.source.localRoot,
          items
        );
      });
    },
    async populateLocalPosters() {
      if (!realDevelopmentPlexEnabled || !plexConfiguration)
        throw new Error('Connect and verify Plex before populating local posters.');
      return previewPosterCoordinator.run('populate-local-posters', async () => {
        const items = (
          await Promise.all(
            posterOverlayWorkspace.libraries.map((library) =>
              overlayItemsForLibrary(library.id)
            )
          )
        ).flat();
        return populateLocalPosterWorkspace(
          posterOverlayWorkspace.source.localRoot,
          items,
          (item, signal) => plexPosterForRatingKey(item.ratingKey, signal)
        );
      });
    },
    async updateLibrary(id, input) {
      const index = posterOverlayWorkspace.libraries.findIndex(
        (library) => library.id === id
      );
      if (index < 0) return undefined;
      const selectedTemplateIds = new Set(input.enabledTemplateIds ?? []);
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        templates:
          input.enabledTemplateIds === undefined
            ? posterOverlayWorkspace.templates
            : posterOverlayWorkspace.templates.map((template) =>
                selectedTemplateIds.has(template.id)
                  ? { ...template, enabled: true }
                  : template
              ),
        libraries: posterOverlayWorkspace.libraries.map(
          (library, libraryIndex) =>
            libraryIndex === index ? { ...library, ...input } : library
        ),
      };
      await saveDevelopmentSources();
      return posterOverlayWorkspace;
    },
    async startLibraryJob(id) {
      const library = posterOverlayWorkspace.libraries.find(
        (item) => item.id === id
      );
      if (
        !library ||
        previewPosterCoordinator.running() ||
        previewPosterJobs.size > 0 ||
        ['queued', 'processing', 'cancelling'].includes(library.status)
      )
        return undefined;
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        libraries: posterOverlayWorkspace.libraries.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'processing' as const,
                processedItems: 0,
                failedItems: 0,
              }
            : item
        ),
      };
      const controller = new AbortController();
      previewPosterJobs.set(id, controller);
      void runOverlayLibraryApplication(id, controller.signal)
        .catch((error) => {
          const cancelled = controller.signal.aborted;
          posterOverlayWorkspace = {
            ...posterOverlayWorkspace,
            libraries: posterOverlayWorkspace.libraries.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: cancelled ? ('idle' as const) : ('error' as const),
                    failedItems: cancelled ? item.failedItems : 1,
                  }
                : item
            ),
          };
          if (!cancelled)
            console.error(
              `Preview overlay application failed for ${id}.`,
              error
            );
        })
        .finally(() => previewPosterJobs.delete(id));
      return posterOverlayWorkspace;
    },
    async startAllLibraryJobs() {
      if (previewPosterCoordinator.running() || previewPosterJobs.size)
        return undefined;
      const eligible = posterOverlayWorkspace.libraries.filter(
        (library) =>
          !['queued', 'processing', 'cancelling'].includes(library.status)
      );
      if (!eligible.length) return undefined;
      const ids = new Set(eligible.map((library) => library.id));
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        libraries: posterOverlayWorkspace.libraries.map((library) =>
          ids.has(library.id)
            ? {
                ...library,
                status: 'queued' as const,
                processedItems: 0,
                failedItems: 0,
              }
            : library
        ),
      };
      const controller = new AbortController();
      for (const library of eligible)
        previewPosterJobs.set(library.id, controller);
      void (async () => {
        for (const library of eligible) {
          controller.signal.throwIfAborted();
          posterOverlayWorkspace = {
            ...posterOverlayWorkspace,
            libraries: posterOverlayWorkspace.libraries.map((item) =>
              item.id === library.id
                ? { ...item, status: 'processing' as const }
                : item
            ),
          };
          const result = await applyConfiguredOverlayLibrary(
            library,
            controller.signal
          );
          posterOverlayWorkspace = {
            ...posterOverlayWorkspace,
            libraries: posterOverlayWorkspace.libraries.map((item) =>
              item.id === library.id
                ? {
                    ...item,
                    status: result.failed
                      ? ('error' as const)
                      : ('complete' as const),
                    processedItems: result.failed ? 0 : item.itemCount,
                    failedItems: result.failed,
                    ...overlayRunBreakdown(result),
                    lastAppliedAt: new Date().toISOString(),
                  }
                : item
            ),
          };
        }
      })()
        .catch((error) => {
          const cancelled = controller.signal.aborted;
          posterOverlayWorkspace = {
            ...posterOverlayWorkspace,
            libraries: posterOverlayWorkspace.libraries.map((item) =>
              ids.has(item.id) &&
              ['queued', 'processing', 'cancelling'].includes(item.status)
                ? {
                    ...item,
                    status: cancelled ? ('idle' as const) : ('error' as const),
                    failedItems: cancelled ? item.failedItems : 1,
                  }
                : item
            ),
          };
          if (!cancelled)
            console.error('Preview batch overlay application failed.', error);
        })
        .finally(() => {
          for (const id of ids) previewPosterJobs.delete(id);
        });
      return posterOverlayWorkspace;
    },
    async cancelLibraryJob(id) {
      const library = posterOverlayWorkspace.libraries.find(
        (item) => item.id === id
      );
      if (!library || !['queued', 'processing'].includes(library.status))
        return undefined;
      previewPosterJobs.get(id)?.abort();
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        libraries: posterOverlayWorkspace.libraries.map((item) =>
          item.id === id ? { ...item, status: 'idle' as const } : item
        ),
      };
      return posterOverlayWorkspace;
    },
    async resetLibrary(id) {
      const library = posterOverlayWorkspace.libraries.find(
        (item) => item.id === id
      );
      if (
        !library ||
        ['queued', 'processing', 'cancelling'].includes(library.status)
      )
        return undefined;
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        libraries: posterOverlayWorkspace.libraries.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'processing' as const,
                processedItems: 0,
                failedItems: 0,
              }
            : item
        ),
      };
      const controller = new AbortController();
      previewPosterJobs.set(id, controller);
      void previewOverlayApplication
        .reset(
          await overlayItemsForLibrary(id, controller.signal),
          controller.signal
        )
        .then((result) => {
          posterOverlayWorkspace = {
            ...posterOverlayWorkspace,
            libraries: posterOverlayWorkspace.libraries.map((item) =>
              item.id === id && item.status === 'processing'
                ? {
                    ...item,
                    status: result.failed
                      ? ('error' as const)
                      : ('idle' as const),
                    processedItems: result.restored ? item.itemCount : 0,
                    failedItems: result.failed,
                  }
                : item
            ),
          };
        })
        .catch((error) => {
          const cancelled = controller.signal.aborted;
          posterOverlayWorkspace = {
            ...posterOverlayWorkspace,
            libraries: posterOverlayWorkspace.libraries.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: cancelled ? ('idle' as const) : ('error' as const),
                    failedItems: cancelled ? item.failedItems : 1,
                  }
                : item
            ),
          };
          if (!cancelled)
            console.error(`Preview poster reset failed for ${id}.`, error);
        })
        .finally(() => previewPosterJobs.delete(id));
      return posterOverlayWorkspace;
    },
    async searchItems(query, libraryId) {
      if (realDevelopmentPlexEnabled && plexConfiguration) {
        const configuration = requireDevelopmentLaptopPlex();
        const results: PosterTestSearchItem[] = [];
        for (const library of configuration.libraries.filter(
          (item) =>
            item.available &&
            (!libraryId || item.key === libraryId) &&
            (item.type === 'movie' || item.type === 'show')
        )) {
          const items = await overlayItemsForLibrary(library.key);
          for (const item of items) {
            if (
              query &&
              !item.title.toLowerCase().includes(query.trim().toLowerCase())
            )
              continue;
            const entry = overlayLibraryIndex
              .get(library.key)
              ?.items.get(item.ratingKey);
            results.push({
              ratingKey: item.ratingKey,
              title: item.title,
              ...(Number.isInteger(item.year) ? { year: item.year } : {}),
              type: library.type as 'movie' | 'show',
              libraryId: library.key,
              libraryName: library.title,
              posterUrl: `/api/posters/overlays/items/${encodeURIComponent(
                item.ratingKey
              )}/poster`,
              ...(entry?.syncedAt ? { syncedAt: entry.syncedAt } : {}),
            });
          }
        }
        return results.slice(0, 50);
      }
      const items = [
        {
          ratingKey: 'movie-101',
          title: 'The Example Horizon',
          year: 2026,
          type: 'movie' as const,
          libraryId: 'movies',
          libraryName: 'Movies',
        },
        {
          ratingKey: 'movie-102',
          title: 'Signal at Midnight',
          year: 2025,
          type: 'movie' as const,
          libraryId: 'movies',
          libraryName: 'Movies',
        },
        {
          ratingKey: 'show-201',
          title: 'Northern Station',
          year: 2024,
          type: 'show' as const,
          libraryId: 'tv',
          libraryName: 'TV Shows',
        },
      ];
      const normalized = query.toLowerCase();
      return items.filter((item) =>
        (!libraryId || item.libraryId === libraryId) &&
        (!normalized || item.title.toLowerCase().includes(normalized))
      );
    },
    async posterForItem(ratingKey) {
      if (!realDevelopmentPlexEnabled || !plexConfiguration) return undefined;
      const preserved =
        await previewOverlayApplication.preservedBasePoster(ratingKey);
      if (preserved) return preserved;
      return plexPosterForRatingKey(ratingKey);
    },
    async testItem(ratingKey) {
      if (realDevelopmentPlexEnabled && plexConfiguration) {
        const metadata = await plexMetadataForRatingKey(ratingKey);
        const libraryId = plexText(metadata.librarySectionID);
        const configured = plexConfiguration.libraries.find(
          (library) => library.key === libraryId
        );
        if (
          !configured ||
          (configured.type !== 'movie' && configured.type !== 'show')
        )
          throw new Error('The Plex item library is not configured.');
        const media = plexOverlayItem(metadata, {
          key: configured.key,
          title: configured.title,
          type: configured.type,
        });
        if (!media) return undefined;
        const built = await previewContextBuilder.build(
          media,
          posterOverlayWorkspace.templates.map((template) => ({
            ...template,
            enabled: true,
          }))
        );
        return {
          item: {
            ratingKey: media.ratingKey,
            title: media.title,
            ...(media.year ? { year: media.year } : {}),
            type: media.mediaType,
            libraryId: media.libraryId,
            libraryName: media.libraryName,
          },
          templates: posterOverlayWorkspace.templates.map((template) => {
            const evaluation = evaluateOverlayConditionDetailed(
              template.condition,
              built.context
            );
            const actual =
              evaluation.sectionResults[0]?.ruleResults[0]?.actualValue;
            return {
              id: template.id,
              name: template.name,
              matched: template.enabled && evaluation.matched,
              conditionSummary: template.conditionSummary,
              ...(actual === undefined
                ? {}
                : { actualValue: String(serializeOverlayContext(actual)) }),
            };
          }),
          context: Object.fromEntries(
            Object.entries(built.context)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, serializeOverlayContext(value)])
          ),
          errors: built.warnings.map(
            (warning) => `${warning.provider}: ${warning.message}`
          ),
        };
      }
      const items = [
        {
          ratingKey: 'movie-101',
          title: 'The Example Horizon',
          year: 2026,
          type: 'movie' as const,
          libraryId: 'movies',
          libraryName: 'Movies',
        },
        {
          ratingKey: 'movie-102',
          title: 'Signal at Midnight',
          year: 2025,
          type: 'movie' as const,
          libraryId: 'movies',
          libraryName: 'Movies',
        },
        {
          ratingKey: 'show-201',
          title: 'Northern Station',
          year: 2024,
          type: 'show' as const,
          libraryId: 'tv',
          libraryName: 'TV Shows',
        },
      ];
      const item = items.find((candidate) => candidate.ratingKey === ratingKey);
      if (!item) return undefined;
      const media =
        previewOverlayMedia.get(ratingKey) ??
        ({
          ratingKey,
          title: item.title,
          year: item.year,
          mediaType: item.type,
          media: [{ resolution: '1080p', width: 1920, height: 1080 }],
        } satisfies PlexOverlayMedia);
      const built = await previewContextBuilder.build(
        media,
        posterOverlayWorkspace.templates
      );
      return {
        item,
        templates: posterOverlayWorkspace.templates.map((template) => {
          const evaluation = evaluateOverlayConditionDetailed(
            template.condition,
            built.context
          );
          const actual =
            evaluation.sectionResults[0]?.ruleResults[0]?.actualValue;
          return {
            id: template.id,
            name: template.name,
            matched: template.enabled && evaluation.matched,
            conditionSummary: template.conditionSummary,
            ...(actual === undefined
              ? {}
              : { actualValue: String(serializeOverlayContext(actual)) }),
          };
        }),
        context: Object.fromEntries(
          Object.entries(built.context)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, serializeOverlayContext(value)])
        ),
        errors: built.warnings.map(
          (warning) => `${warning.provider}: ${warning.message}`
        ),
      };
    },
    async applyItem(ratingKey) {
      const configuration = requireDevelopmentLaptopPlex();
      const metadata = await plexMetadataForRatingKey(ratingKey);
      const libraryId = plexText(metadata.librarySectionID);
      const configured = configuration.libraries.find(
        (library) =>
          library.key === libraryId &&
          (library.type === 'movie' || library.type === 'show')
      );
      const library = posterOverlayWorkspace.libraries.find(
        (candidate) => candidate.id === libraryId
      );
      if (!configured || !library) return undefined;
      const item = plexOverlayItem(metadata, {
        key: configured.key,
        title: configured.title,
        type: configured.type as 'movie' | 'show',
      });
      if (!item) return undefined;
      const result = await previewOverlayApplication.apply(
        [item],
        posterOverlayWorkspace.templates.filter((template) =>
          library.enabledTemplateIds.includes(template.id)
        ),
        posterOverlayWorkspace.source.source,
        library.tmdbLanguage
      );
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        libraries: posterOverlayWorkspace.libraries.map((candidate) =>
          candidate.id === library.id
            ? {
                ...candidate,
                status: result.failed
                  ? ('error' as const)
                  : ('complete' as const),
                processedItems:
                  result.applied + result.restored + result.skipped,
                failedItems: result.failed,
                ...overlayRunBreakdown(result),
                lastAppliedAt: new Date().toISOString(),
              }
            : candidate
        ),
      };
      await saveDevelopmentSources();
      if (result.failed)
        throw new Error(
          result.items.find((entry) => entry.status === 'failed')?.reason ??
            'The Plex poster could not be updated.'
        );
      return posterOverlayWorkspace;
    },
    async resetItem(ratingKey) {
      requireDevelopmentLaptopPlex();
      await plexMetadataForRatingKey(ratingKey);
      const result = await previewOverlayApplication.reset([{ ratingKey }]);
      if (result.failed)
        throw new Error(
          result.items.find((entry) => entry.status === 'failed')?.reason ??
            'The original Plex poster could not be restored.'
        );
      if (!result.restored)
        throw new Error('No preserved base poster is recorded for this item.');
      return posterOverlayWorkspace;
    },
    async saveTemplate(id, input) {
      if (id) {
        posterOverlayWorkspace = {
          ...posterOverlayWorkspace,
          templates: posterOverlayWorkspace.templates.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...input,
                  elementCount: input.design.elements.length,
                }
              : item
          ),
        };
      } else {
        posterOverlayWorkspace = {
          ...posterOverlayWorkspace,
          templates: [
            ...posterOverlayWorkspace.templates,
            {
              ...input,
              id: `overlay-${crypto.randomUUID().slice(0, 8)}`,
              displayOrder: posterOverlayWorkspace.templates.length,
              elementCount: input.design.elements.length,
            },
          ],
        };
      }
      await saveDevelopmentSources();
      return posterOverlayWorkspace;
    },
    async duplicateTemplate(id) {
      const source = posterOverlayWorkspace.templates.find(
        (item) => item.id === id
      );
      if (!source) return undefined;
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        templates: [
          ...posterOverlayWorkspace.templates,
          {
            ...structuredClone(source),
            id: `overlay-${crypto.randomUUID().slice(0, 8)}`,
            name: `${source.name} Copy`,
            displayOrder: posterOverlayWorkspace.templates.length,
          },
        ],
      };
      await saveDevelopmentSources();
      return posterOverlayWorkspace;
    },
    async deleteTemplate(id) {
      if (!posterOverlayWorkspace.templates.some((item) => item.id === id))
        return undefined;
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        templates: posterOverlayWorkspace.templates.filter(
          (item) => item.id !== id
        ),
        libraries: posterOverlayWorkspace.libraries.map((library) => ({
          ...library,
          enabledTemplateIds: library.enabledTemplateIds.filter(
            (templateId) => templateId !== id
          ),
        })),
      };
      await saveDevelopmentSources();
      return posterOverlayWorkspace;
    },
    async copyElements(sourceId, targetIds, elementIds) {
      const source = posterOverlayWorkspace.templates.find(
        (item) => item.id === sourceId
      );
      if (!source) return undefined;
      const selected = source.design.elements.filter((element) =>
        elementIds.includes(element.id)
      );
      if (!selected.length) return undefined;
      let copiedTargets = 0;
      posterOverlayWorkspace = {
        ...posterOverlayWorkspace,
        templates: posterOverlayWorkspace.templates.map((target) => {
          if (!targetIds.includes(target.id) || target.id === sourceId)
            return target;
          const maxLayerOrder = Math.max(
            -1,
            ...target.design.elements.map((element) => element.layerOrder)
          );
          const copied = selected.map((element, index) => {
            const clone = structuredClone(element);
            const existing = target.design.elements.find(
              (candidate) => candidate.id === element.id
            );
            if (clone.type === 'variable' && existing?.type === 'variable')
              clone.properties = {
                ...clone.properties,
                segments: existing.properties.segments,
              };
            return {
              ...clone,
              id: `${element.id}-copy-${crypto.randomUUID().slice(0, 7)}`,
              layerOrder: maxLayerOrder + index + 1,
            };
          });
          copiedTargets++;
          return {
            ...target,
            design: {
              ...target.design,
              elements: [...target.design.elements, ...copied],
            },
            elementCount: target.design.elements.length + copied.length,
          };
        }),
      };
      await saveDevelopmentSources();
      return {
        workspace: posterOverlayWorkspace,
        copiedTargets,
        copiedElements: selected.length,
      };
    },
  },
  collectionPosters: {
    async get() {
      collectionPosterWorkspace = {
        ...collectionPosterWorkspace,
        assets: await posterEditorAssetStore.list(),
      };
      return collectionPosterWorkspace;
    },
    async saveTemplate(id, input) {
      const now = new Date().toISOString();
      if (id) {
        collectionPosterWorkspace = {
          ...collectionPosterWorkspace,
          templates: collectionPosterWorkspace.templates.map((item) =>
            item.id === id ? { ...item, ...input, updatedAt: now } : item
          ),
        };
      } else {
        collectionPosterWorkspace = {
          ...collectionPosterWorkspace,
          templates: [
            ...collectionPosterWorkspace.templates,
            {
              id: `template-${crypto.randomUUID().slice(0, 8)}`,
              ...input,
              isDefault: false,
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      }
      return collectionPosterWorkspace;
    },
    async duplicateTemplate(id) {
      const source = collectionPosterWorkspace.templates.find(
        (item) => item.id === id
      );
      if (!source) return undefined;
      const now = new Date().toISOString();
      collectionPosterWorkspace = {
        ...collectionPosterWorkspace,
        templates: [
          ...collectionPosterWorkspace.templates,
          {
            ...source,
            id: `template-${crypto.randomUUID().slice(0, 8)}`,
            name: `${source.name} Copy`,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
      return collectionPosterWorkspace;
    },
    async setDefault(id) {
      if (!collectionPosterWorkspace.templates.some((item) => item.id === id))
        return undefined;
      collectionPosterWorkspace = {
        ...collectionPosterWorkspace,
        templates: collectionPosterWorkspace.templates.map((item) => ({
          ...item,
          isDefault: item.id === id,
        })),
      };
      return collectionPosterWorkspace;
    },
    async deleteTemplate(id) {
      const template = collectionPosterWorkspace.templates.find(
        (item) => item.id === id
      );
      if (!template || template.isDefault) return undefined;
      collectionPosterWorkspace = {
        ...collectionPosterWorkspace,
        templates: collectionPosterWorkspace.templates.filter(
          (item) => item.id !== id
        ),
      };
      const fallbackId = collectionPosterWorkspace.templates.find(
        (item) => item.isDefault
      )?.id;
      managedCollections = managedCollections.map((collection) =>
        collection.posterSettings?.templateId === id
          ? {
              ...collection,
              posterSettings: fallbackId
                ? { ...collection.posterSettings, templateId: fallbackId }
                : (({ templateId: _templateId, ...settings }) => settings)(
                    collection.posterSettings
                  ),
              status: 'needs-sync' as const,
            }
          : collection
      );
      return collectionPosterWorkspace;
    },
    async savePoster(id, input) {
      const now = new Date().toISOString();
      if (id) {
        collectionPosterWorkspace = {
          ...collectionPosterWorkspace,
          savedPosters: collectionPosterWorkspace.savedPosters.map((item) =>
            item.id === id ? { ...item, ...input, updatedAt: now } : item
          ),
        };
      } else {
        collectionPosterWorkspace = {
          ...collectionPosterWorkspace,
          savedPosters: [
            ...collectionPosterWorkspace.savedPosters,
            {
              id: `poster-${crypto.randomUUID().slice(0, 8)}`,
              ...input,
              isEditable: true,
              usedBy: [],
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      }
      return collectionPosterWorkspace;
    },
    async duplicatePoster(id) {
      const source = collectionPosterWorkspace.savedPosters.find(
        (item) => item.id === id
      );
      if (!source) return undefined;
      const now = new Date().toISOString();
      collectionPosterWorkspace = {
        ...collectionPosterWorkspace,
        savedPosters: [
          ...collectionPosterWorkspace.savedPosters,
          {
            ...source,
            id: `poster-${crypto.randomUUID().slice(0, 8)}`,
            name: `${source.name} Copy`,
            usedBy: [],
            isEditable: true,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
      return collectionPosterWorkspace;
    },
    async deletePosters(ids, force) {
      const blocked = collectionPosterWorkspace.savedPosters.filter(
        (item) => ids.includes(item.id) && item.usedBy.length
      );
      const deletable = force || blocked.length === 0 ? ids : [];
      collectionPosterWorkspace = {
        ...collectionPosterWorkspace,
        savedPosters: collectionPosterWorkspace.savedPosters.filter(
          (item) => !deletable.includes(item.id)
        ),
      };
      if (force && deletable.length) {
        managedCollections = managedCollections.map((collection) =>
          collection.posterSettings?.customPoster?.kind === 'saved' &&
          deletable.includes(collection.posterSettings.customPoster.id)
            ? {
                ...collection,
                posterSettings: (({
                  customPoster: _customPoster,
                  ...settings
                }) => settings)(collection.posterSettings),
                status: 'needs-sync' as const,
              }
            : collection
        );
      }
      return { workspace: collectionPosterWorkspace, blocked };
    },
    async importSourceColors(colors) {
      collectionPosterWorkspace = {
        ...collectionPosterWorkspace,
        sourceColors: {
          ...collectionPosterWorkspace.sourceColors,
          ...colors,
        },
      };
      return collectionPosterWorkspace;
    },
    async saveAsset(input) {
      const asset = await posterEditorAssetStore.save(input);
      collectionPosterWorkspace = {
        ...collectionPosterWorkspace,
        assets: await posterEditorAssetStore.list(),
      };
      return asset;
    },
    async readAsset(id) {
      return posterEditorAssetStore.read(id);
    },
    async deleteAsset(id) {
      const deleted = await posterEditorAssetStore.delete(id);
      collectionPosterWorkspace = {
        ...collectionPosterWorkspace,
        assets: await posterEditorAssetStore.list(),
      };
      return deleted;
    },
  },
  generalSettings: {
    async get() {
      return generalSettings;
    },
    async save(expectedRevision, draft) {
      if (generalSettings.revision !== expectedRevision) return undefined;
      generalSettings = {
        ...generalSettings,
        ...draft,
        revision: generalSettings.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      return generalSettings;
    },
    async regenerateApiKey() {
      generalSettings = {
        ...generalSettings,
        revision: generalSettings.revision + 1,
        apiKeyPreview: `vyn_••••••••${crypto.randomUUID().slice(0, 4)}`,
        updatedAt: new Date().toISOString(),
      };
      return generalSettings;
    },
    async clearImageCache() {
      generalSettings = {
        ...generalSettings,
        revision: generalSettings.revision + 1,
        cacheItemCount: 0,
        cacheSizeBytes: 0,
        updatedAt: new Date().toISOString(),
      };
      return generalSettings;
    },
  },
  applicationLogs: {
    async list() {
      return applicationLogEntries;
    },
    async appDataPath() {
      return 'C:\\vynode\\config';
    },
  },
  jobsAndCache: {
    async jobs() {
      return backgroundJobs;
    },
    async run(id) {
      const job = backgroundJobs.find((item) => item.id === id);
      if (!job) return undefined;
      const [nextExecution, followingExecution] = nextCronExecutions(
        job.cronSchedule
      );
      const updated = {
        ...job,
        running: true,
        startedAt: new Date().toISOString(),
        nextExecutionTime: (
          nextExecution ?? new Date(Date.now() + 3_600_000)
        ).toISOString(),
        ...(followingExecution
          ? { followingExecutionTime: followingExecution.toISOString() }
          : {}),
      };
      backgroundJobs = backgroundJobs.map((item) =>
        item.id === id ? updated : item
      );
      await saveDevelopmentSources();
      if (id === 'plex-collections-sync') {
        const controller = new AbortController();
        backgroundJobControllers.set(id, controller);
        void (async () => {
          const managed = await waitForDashboardJob(
            'collections',
            controller.signal
          );
          if (managed.phase !== 'completed') {
            throw new Error(
              managed.message ??
                `Managed collection synchronization ended as ${managed.phase}.`
            );
          }
          const reconciliation = await collectionsQuickSync.run(
            controller.signal
          );
          return { managed, reconciliation };
        })()
          .then(async ({ managed, reconciliation }) => {
            const completedAt = new Date().toISOString();
            backgroundJobs = backgroundJobs.map((candidate) => {
              if (candidate.id !== id) return candidate;
              const { startedAt: _startedAt, ...rest } = candidate;
              return {
                ...rest,
                running: false,
                lastCompletedAt: completedAt,
                lastOutcome: managed.errorCount
                  ? ('failed' as const)
                  : ('success' as const),
                lastMessage: `Synchronized ${managed.successCount} collections, created ${managed.createdCount}, skipped ${managed.skippedCount}, failed ${managed.errorCount}; then scanned ${reconciliation.scannedLibraries} Plex libraries, added ${reconciliation.itemsAdded} recovered members, and removed ${reconciliation.staleRecordsRemoved} stale records.`,
              };
            });
            backgroundJobControllers.delete(id);
            await saveDevelopmentSources();
          })
          .catch(async (error) => {
            const cancelled =
              controller.signal.aborted ||
              (error instanceof DOMException && error.name === 'AbortError');
            const completedAt = new Date().toISOString();
            backgroundJobs = backgroundJobs.map((candidate) => {
              if (candidate.id !== id) return candidate;
              const { startedAt: _startedAt, ...rest } = candidate;
              return {
                ...rest,
                running: false,
                lastCompletedAt: completedAt,
                lastOutcome: cancelled
                  ? ('cancelled' as const)
                  : ('failed' as const),
                lastMessage: cancelled
                  ? 'Safe cancellation completed.'
                  : error instanceof Error
                    ? error.message
                    : 'Plex Collections Sync failed.',
              };
            });
            backgroundJobControllers.delete(id);
            await saveDevelopmentSources();
          });
      }
      if (id === 'plex-collections-quick-sync') {
        const controller = new AbortController();
        backgroundJobControllers.set(id, controller);
        void collectionsQuickSync
          .run(controller.signal)
          .then(async (report) => {
            const completedAt = new Date().toISOString();
            backgroundJobs = backgroundJobs.map((candidate) => {
              if (candidate.id !== id) return candidate;
              const { startedAt: _startedAt, ...rest } = candidate;
              return {
                ...rest,
                running: false,
                lastCompletedAt: completedAt,
                lastOutcome: 'success' as const,
                lastMessage: `Scanned ${report.scannedLibraries} libraries, matched ${report.matchedItems}, added ${report.itemsAdded}, found ${report.alreadyPresent} already present, failed ${report.failed}, and removed ${report.staleRecordsRemoved} stale records.`,
              };
            });
            backgroundJobControllers.delete(id);
            await saveDevelopmentSources();
          })
          .catch(async (error) => {
            const cancelled =
              controller.signal.aborted ||
              (error instanceof DOMException && error.name === 'AbortError');
            const completedAt = new Date().toISOString();
            backgroundJobs = backgroundJobs.map((candidate) => {
              if (candidate.id !== id) return candidate;
              const { startedAt: _startedAt, ...rest } = candidate;
              return {
                ...rest,
                running: false,
                lastCompletedAt: completedAt,
                lastOutcome: cancelled
                  ? ('cancelled' as const)
                  : ('failed' as const),
                lastMessage: cancelled
                  ? 'Safe cancellation completed.'
                  : error instanceof Error
                    ? error.message
                    : 'Collections Quick Sync failed.',
              };
            });
            backgroundJobControllers.delete(id);
            await saveDevelopmentSources();
          });
      }
      if (id === 'overlay-application') {
        const controller = new AbortController();
        backgroundJobControllers.set(id, controller);
        void runScheduledOverlayApplication(controller.signal)
          .then(async (report) => {
            const completedAt = new Date().toISOString();
            backgroundJobs = backgroundJobs.map((candidate) => {
              if (candidate.id !== id) return candidate;
              const { startedAt: _startedAt, ...rest } = candidate;
              return {
                ...rest,
                running: false,
                lastCompletedAt: completedAt,
                lastOutcome: report.failed
                  ? ('failed' as const)
                  : ('success' as const),
                lastMessage: `Processed ${report.libraries} libraries: applied ${report.applied}, skipped ${report.skipped}, failed ${report.failed}.`,
              };
            });
            backgroundJobControllers.delete(id);
            await saveDevelopmentSources();
          })
          .catch(async (error) => {
            const cancelled =
              controller.signal.aborted ||
              (error instanceof DOMException && error.name === 'AbortError');
            const completedAt = new Date().toISOString();
            backgroundJobs = backgroundJobs.map((candidate) => {
              if (candidate.id !== id) return candidate;
              const { startedAt: _startedAt, ...rest } = candidate;
              return {
                ...rest,
                running: false,
                lastCompletedAt: completedAt,
                lastOutcome: cancelled
                  ? ('cancelled' as const)
                  : ('failed' as const),
                lastMessage: cancelled
                  ? 'Safe cancellation completed.'
                  : error instanceof Error
                    ? error.message
                    : 'Poster Overlay Application failed.',
              };
            });
            backgroundJobControllers.delete(id);
            await saveDevelopmentSources();
          });
      }
      if (id === 'watchlist-sync') {
        const controller = new AbortController();
        backgroundJobControllers.set(id, controller);
        void executePlexWatchlistSync(controller.signal)
          .then(async (report) => {
            const completedAt = new Date().toISOString();
            backgroundJobs = backgroundJobs.map((candidate) => {
              if (candidate.id !== id) return candidate;
              const { startedAt: _startedAt, ...rest } = candidate;
              return {
                ...rest,
                running: false,
                lastCompletedAt: completedAt,
                lastOutcome: report.failed
                  ? ('failed' as const)
                  : ('success' as const),
                lastMessage: report.disabled
                  ? 'Watchlist synchronization is disabled; no Plex or Arr changes were made.'
                  : `Scanned ${report.scanned} owner Plex watchlist items, added ${report.added}, found ${report.existing} existing, skipped ${report.skipped}, and failed ${report.failed}.${report.seerrTriggered ? ' Seerr all-user synchronization was triggered.' : ''}${report.failures.length ? ` ${report.failures.join('; ')}` : ''}`,
              };
            });
            backgroundJobControllers.delete(id);
            await saveDevelopmentSources();
          })
          .catch(async (error) => {
            const cancelled =
              controller.signal.aborted ||
              (error instanceof DOMException && error.name === 'AbortError');
            const completedAt = new Date().toISOString();
            backgroundJobs = backgroundJobs.map((candidate) => {
              if (candidate.id !== id) return candidate;
              const { startedAt: _startedAt, ...rest } = candidate;
              return {
                ...rest,
                running: false,
                lastCompletedAt: completedAt,
                lastOutcome: cancelled
                  ? ('cancelled' as const)
                  : ('failed' as const),
                lastMessage: cancelled
                  ? 'Safe cancellation completed.'
                  : error instanceof Error
                    ? error.message
                    : 'Plex Watchlist Sync failed.',
              };
            });
            backgroundJobControllers.delete(id);
            await saveDevelopmentSources();
          });
      }
      return updated;
    },
    async cancel(id) {
      const job = backgroundJobs.find((item) => item.id === id);
      if (!job) return undefined;
      backgroundJobControllers.get(id)?.abort();
      if (
        id === 'plex-collections-sync' &&
        ['queued', 'setup', 'processing', 'cleanup'].includes(
          dashboardJobService.status('collections').phase
        )
      ) {
        dashboardJobService.cancel('collections');
      }
      const { startedAt: _startedAt, ...withoutStartedAt } = job;
      const updated = { ...withoutStartedAt, running: false };
      backgroundJobs = backgroundJobs.map((item) =>
        item.id === id ? updated : item
      );
      await saveDevelopmentSources();
      return updated;
    },
    async schedule(id, cronSchedule) {
      const job = backgroundJobs.find((item) => item.id === id);
      if (!job) return undefined;
      const [nextExecution, followingExecution] =
        nextCronExecutions(cronSchedule);
      const updated = {
        ...job,
        cronSchedule,
        nextExecutionTime: (
          nextExecution ?? new Date(Date.now() + 3_600_000)
        ).toISOString(),
        ...(followingExecution
          ? { followingExecutionTime: followingExecution.toISOString() }
          : {}),
      };
      backgroundJobs = backgroundJobs.map((item) =>
        item.id === id ? updated : item
      );
      await saveDevelopmentSources();
      return updated;
    },
    async caches() {
      return cacheStatistics;
    },
    async flushCache(id) {
      const cache = cacheStatistics.find((item) => item.id === id);
      if (!cache) return undefined;
      const updated = { ...cache, keys: 0, keySizeBytes: 0, valueSizeBytes: 0 };
      cacheStatistics = cacheStatistics.map((item) =>
        item.id === id ? updated : item
      );
      await saveDevelopmentSources();
      return updated;
    },
  },
  async aboutInformation() {
    const version = process.env.VYNODE_VERSION ?? '0.0.0-development';
    const latestVersion = process.env.VYNODE_LATEST_VERSION ?? version;
    const platformNames: Partial<Record<NodeJS.Platform, string>> = {
      win32: 'Windows',
      darwin: 'macOS',
      linux: 'Linux',
      freebsd: 'FreeBSD',
      openbsd: 'OpenBSD',
      aix: 'AIX',
      sunos: 'SunOS',
    };
    return {
      version,
      build: process.env.VYNODE_BUILD ?? 'local-development',
      commit: process.env.VYNODE_COMMIT ?? 'working-tree',
      updateAvailable:
        !!process.env.VYNODE_LATEST_VERSION && latestVersion !== version,
      updateCheckAvailable: !!process.env.VYNODE_LATEST_VERSION,
      latestVersion,
      restartRequired: process.env.VYNODE_RESTART_REQUIRED === 'true',
      nodeVersion: process.version,
      platform: platformNames[process.platform] ?? process.platform,
      architecture: process.arch,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      appDataPath: developmentDataDirectory,
      uptimeSeconds: Math.floor(process.uptime()),
      ...(process.env.VYNODE_DOCUMENTATION_URL
        ? { documentationUrl: process.env.VYNODE_DOCUMENTATION_URL }
        : {}),
      ...(process.env.VYNODE_ISSUE_URL
        ? { issueUrl: process.env.VYNODE_ISSUE_URL }
        : {}),
      ...(process.env.VYNODE_SOURCE_URL
        ? { sourceUrl: process.env.VYNODE_SOURCE_URL }
        : {}),
      license: 'GPL-3.0-only',
    };
  },
  collectionSourceValidator: async ({ type, subtype, customUrl }) => {
    if (type !== 'mdblist' || subtype !== 'custom') return undefined;
    const configuration = integrationConfigurations.get('mdblist');
    const apiKey = configuration?.secretReference
      ? integrationSecrets.get(configuration.secretReference)
      : undefined;
    if (!configuration?.configured || !apiKey) {
      throw new Error(
        'Configure and test MDBList in Settings before validating a list.'
      );
    }
    const inspection = await new MDBListClient({ apiKey }).inspect(
      customUrl ?? ''
    );
    const details = [
      inspection.itemCount !== undefined
        ? `${inspection.itemCount} item${inspection.itemCount === 1 ? '' : 's'}`
        : undefined,
      inspection.private ? 'private list' : 'public list',
      inspection.dynamic ? 'dynamic' : undefined,
    ].filter((value): value is string => Boolean(value));
    return {
      valid: true as const,
      title: inspection.title,
      contentType: inspection.contentType,
      message: details.length
        ? `MDBList verified: ${details.join(' · ')}.`
        : 'MDBList verified.',
    };
  },
  integrations: new IntegrationConfigurationService(
    {
      async get(id) {
        return integrationConfigurations.get(id);
      },
      async compareAndSet(id, expectedRevision, next) {
        if (
          (integrationConfigurations.get(id)?.revision ?? 0) !==
          expectedRevision
        ) {
          return false;
        }
        integrationConfigurations.set(id, next);
        if (id === 'maintainerr') {
          maintainerrOverlayCache = undefined;
          posterOverlayWorkspace = {
            ...posterOverlayWorkspace,
            libraries: posterOverlayWorkspace.libraries.map((library) => ({
              ...library,
              maintainerrConfigured: true,
            })),
          };
        }
        await saveDevelopmentSources();
        return true;
      },
      async delete(id, expectedRevision) {
        if (integrationConfigurations.get(id)?.revision !== expectedRevision) {
          return false;
        }
        const deleted = integrationConfigurations.delete(id);
        if (deleted) {
          if (id === 'maintainerr') {
            maintainerrOverlayCache = undefined;
            posterOverlayWorkspace = {
              ...posterOverlayWorkspace,
              libraries: posterOverlayWorkspace.libraries.map((library) => ({
                ...library,
                maintainerrConfigured: false,
                maintainerrSeasonOverlays: false,
              })),
            };
          }
          await saveDevelopmentSources();
        }
        return deleted;
      },
    },
    {
      async store(secret) {
        const reference = `dev-vault:integration:${crypto.randomUUID()}`;
        integrationSecrets.set(reference, secret);
        await saveDevelopmentSources();
        return reference;
      },
      async remove(reference) {
        integrationSecrets.delete(reference);
        await saveDevelopmentSources();
      },
    },
    {
      async test(draft, signal) {
        if (draft.id === 'trakt') {
          await new TraktClient({
            clientId: draft.clientId,
          }).test(signal);
        }
        if (draft.id === 'tmdb') {
          const items=await new TmdbSourceClient({apiKey:draft.apiKey}).source({mediaType:'movie',subtype:'popular',limit:1},signal);
          if(!items.length) throw new Error('TMDB returned no results for its popular Movies probe.');
        }
        if (draft.id === 'myanimelist') {
          await new MyAnimeListClient({ clientId: draft.apiKey }).test(signal);
        }
        if (draft.id === 'mdblist') {
          await new MDBListClient({ apiKey: draft.apiKey }).test(signal);
        }
        if (draft.id === 'tautulli') {
          await new TautulliClient({
            hostname: draft.hostname,
            port: draft.port,
            useSsl: draft.useSsl,
            urlBase: draft.urlBase,
            apiKey: draft.apiKey,
          }).test(signal);
        }
        if (draft.id === 'maintainerr') {
          await new MaintainerrClient({
            hostname: draft.hostname,
            port: draft.port,
            useSsl: draft.useSsl,
            urlBase: draft.urlBase,
            ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
          }).test(signal);
        }
        // Remaining provider probes are connected as each production adapter lands.
      },
    },
    () => new Date()
  ),
  traktOAuth: traktOAuthService,
  arrCollectionSources: {
    async servers(kind) {
      return [...downloadConfigurations.values()]
        .filter((configuration) => configuration.endpoint.kind === kind)
        .map((configuration) => ({
          id: configuration.id,
          name: configuration.endpoint.name,
          kind,
        }));
    },
    async tags(serverId) {
      const configuration = downloadConfigurations.get(serverId);
      if (!configuration)
        throw new Error('The selected download server no longer exists.');
      return arrTagClientForConfiguration(configuration).tags();
    },
  },
  downloads: new ArrConfigurationService(
    {
      async list(kind: ArrKind) {
        return [...downloadConfigurations.values()].filter(
          (entry) => entry.endpoint.kind === kind
        );
      },
      async get(id) {
        return downloadConfigurations.get(id);
      },
      async compareAndSet(id, expectedRevision, next, defaultsToClear) {
        if (
          (downloadConfigurations.get(id)?.revision ?? 0) !== expectedRevision
        ) {
          return false;
        }
        for (const otherId of defaultsToClear) {
          const other = downloadConfigurations.get(otherId);
          if (other) {
            downloadConfigurations.set(otherId, {
              ...other,
              selection: { ...other.selection, isDefault: false },
            });
          }
        }
        downloadConfigurations.set(id, next);
        await saveDevelopmentSources();
        return true;
      },
      async delete(id, expectedRevision) {
        if (downloadConfigurations.get(id)?.revision !== expectedRevision) {
          return false;
        }
        const deleted = downloadConfigurations.delete(id);
        if (deleted) await saveDevelopmentSources();
        return deleted;
      },
    },
    {
      async store(secret) {
        const reference = `dev-vault:download:${crypto.randomUUID()}`;
        integrationSecrets.set(reference, secret);
        await saveDevelopmentSources();
        return reference;
      },
      async remove(reference) {
        integrationSecrets.delete(reference);
        await saveDevelopmentSources();
      },
    },
    new HttpArrProbe(),
    () => new Date(),
    async (id) => {
      const references: string[] = [];
      if (watchlistSettings.radarr.serverId === id) {
        references.push('Plex watchlist movie destination');
      }
      if (watchlistSettings.sonarr.serverId === id) {
        references.push('Plex watchlist TV destination');
      }
      return references;
    }
  ),
  fetchingPolicy: {
    async get() {
      return fetchingPolicy;
    },
    async save(expectedRevision, values) {
      if (fetchingPolicy.revision !== expectedRevision) return undefined;
      fetchingPolicy = {
        revision: expectedRevision + 1,
        ...values,
      };
      await saveDevelopmentSources();
      return fetchingPolicy;
    },
  },
  placeholders: new PlaceholderSettingsService(
    {
      async get() {
        return placeholderSettings;
      },
      async compareAndSet(expectedRevision, next) {
        if (placeholderSettings.revision !== expectedRevision) return false;
        placeholderSettings = {
          ...next,
          libraryRoots: { ...next.libraryRoots },
        };
        await saveDevelopmentSources();
        return true;
      },
    },
    async () =>
      new Set(
        (plexConfiguration?.libraries ?? [])
          .filter(
            (library) => library.type === 'movie' || library.type === 'show'
          )
          .map((library) => library.key)
      ),
    developmentPlaceholderMountRoots
  ),
  placeholderInventory: new FilePlaceholderInventoryRepository(
    placeholderInventoryPath
  ),
  directoryBrowser: new MountedDirectoryBrowser(developmentPlaceholderMountRoots, {
    async directories(absolutePath) {
      const entries = await readdir(absolutePath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    },
  }),
  async youtubeCookieStatus() {
    const cookiesPresent = await stat(youtubeCookiesPath)
      .then((value) => value.isFile() && value.size > 0)
      .catch(() => false);
    return {
      state: placeholderSettings.skipYoutubeTrailerDownloads
        ? ('present-but-disabled' as const)
        : cookiesPresent
          ? ('ready' as const)
          : ('missing' as const),
      fileName: 'youtube-cookies.txt',
    };
  },
  seerr: new SeerrConfigurationService(
    {
      async get() {
        return seerrConfiguration;
      },
      async compareAndSet(expectedRevision, next) {
        if ((seerrConfiguration?.revision ?? 0) !== expectedRevision) {
          return false;
        }
        seerrConfiguration = next;
        await saveDevelopmentSources();
        return true;
      },
      async delete(expectedRevision) {
        if (seerrConfiguration?.revision !== expectedRevision) return false;
        seerrConfiguration = undefined;
        await saveDevelopmentSources();
        return true;
      },
    },
    {
      async store(secret) {
        const reference = `dev-vault:seerr:${crypto.randomUUID()}`;
        integrationSecrets.set(reference, secret);
        await saveDevelopmentSources();
        return reference;
      },
      async remove(reference) {
        integrationSecrets.delete(reference);
        await saveDevelopmentSources();
      },
    },
    seerrProvider,
    () => new Date(),
    seerrProvider
  ),
  watchlists: new WatchlistSettingsService(
    {
      async get() {
        return watchlistSettings;
      },
      async compareAndSet(expectedRevision, next) {
        if (watchlistSettings.revision !== expectedRevision) return false;
        watchlistSettings = next;
        await saveDevelopmentSources();
        return true;
      },
    },
    {
      async load(kind) {
        const entries = [...downloadConfigurations.values()].filter(
          (configuration) => configuration.endpoint.kind === kind
        );
        const fallbackId = `preview-${kind}`;
        const servers = entries.length
          ? entries.map((configuration) => ({
              id: configuration.id,
              name: configuration.endpoint.name,
              is4k: configuration.selection.is4k,
              isDefault: configuration.selection.isDefault,
            }))
          : [
              {
                id: fallbackId,
                name: kind === 'radarr' ? 'Preview Movies' : 'Preview TV Shows',
                is4k: false,
                isDefault: true,
              },
            ];
        return {
          servers,
          serverOptions: Object.fromEntries(
            servers.map((server) => {
              const configuration = downloadConfigurations.get(server.id);
              const tags = previewArrTags.get(server.id) ?? [
                { id: 1, label: 'watchlist' },
                { id: 2, label: 'vynode' },
              ];
              previewArrTags.set(server.id, tags);
              return [
                server.id,
                {
                  serviceVersion: 'preview',
                  normalizedUrlBase: '',
                  profiles: [
                    {
                      id: configuration?.selection.profileId ?? 1,
                      name: 'HD-1080p',
                    },
                  ],
                  rootFolders: [
                    {
                      id: 1,
                      path: configuration?.selection.rootFolder ?? '/media',
                    },
                  ],
                  tags,
                },
              ];
            })
          ),
        };
      },
      async createTag(kind, serverId, label) {
        const options = await this.load(kind);
        if (!options.servers.some((server) => server.id === serverId)) {
          throw new Error('Unknown preview Arr server.');
        }
        const tags = previewArrTags.get(serverId) ?? [];
        const existing = tags.find(
          (tag) => tag.label.toLowerCase() === label.toLowerCase()
        );
        if (existing) return existing;
        const created = {
          id: Math.max(0, ...tags.map((tag) => tag.id)) + 1,
          label,
        };
        previewArrTags.set(serverId, [...tags, created]);
        return created;
      },
    },
    async () => seerrConfiguration !== undefined
  ),
  plexWebhook: new PlexPlaceholderWebhookService(
    {
      async markUnplayed(ratingKey) {
        resetPlaceholderRatingKeys.push(ratingKey);
      },
    },
    () => new Date(),
    5 * 60 * 1000,
    () => plexConfiguration?.machineIdentifier
  ),
  plexServer: new PlexServerConfigurationService(
    {
      async get() {
        return plexConfiguration;
      },
      async compareAndSet(expectedRevision, next) {
        if ((plexConfiguration?.revision ?? 0) !== expectedRevision) {
          return false;
        }
        plexConfiguration = next;
        const plexPosterLibraries = next.libraries.filter(
          (library) =>
            library.available &&
            (library.type === 'movie' || library.type === 'show')
        );
        if (plexPosterLibraries.length) {
          posterOverlayWorkspace = {
            ...posterOverlayWorkspace,
            libraries: plexPosterLibraries.map((library) => {
              const existing = posterOverlayWorkspace.libraries.find(
                (candidate) =>
                  candidate.id === library.key ||
                  (candidate.name === library.title &&
                    candidate.type === library.type)
              );
              return {
                id: library.key,
                name: library.title,
                type: library.type as 'movie' | 'show',
                itemCount: existing?.itemCount ?? 0,
                enabledTemplateIds: existing?.enabledTemplateIds ?? [],
                tmdbLanguage: existing?.tmdbLanguage ?? 'en-US',
                enableEpisodeScanning: existing?.enableEpisodeScanning ?? false,
                maintainerrSeasonOverlays:
                  existing?.maintainerrSeasonOverlays ?? false,
                maintainerrConfigured: existing?.maintainerrConfigured ?? false,
                status: 'idle' as const,
                processedItems: 0,
                failedItems: 0,
              };
            }),
          };
        }
        normalizeManagedCollectionLibraryIdentities();
        await saveDevelopmentSources();
        return true;
      },
    },
    {
      async observe(input) {
        if (realDevelopmentPlexEnabled) {
          const transport = developmentPlexTransport(input);
          const [identityResponse, libraryResponse] = await Promise.all([
            transport.query('/'),
            transport.query('/library/sections'),
          ]);
          const identity = plexRecord(
            plexRecord(identityResponse)?.MediaContainer
          );
          const name = plexText(identity?.friendlyName);
          if (name !== 'Laptop') {
            throw new Error(
              `Development Plex access is restricted to Laptop; received "${name || 'unknown'}".`
            );
          }
          const libraries = plexRecords(
            plexRecord(plexRecord(libraryResponse)?.MediaContainer)?.Directory
          )
            .map((library) => {
              const key = plexText(library.key);
              const title = plexText(library.title);
              const type = plexText(library.type);
              if (
                !key ||
                !title ||
                !['movie', 'show', 'artist', 'photo'].includes(type)
              )
                return undefined;
              return {
                key,
                title,
                type: type as 'movie' | 'show' | 'artist' | 'photo',
                ...(plexText(library.language)
                  ? { language: plexText(library.language) }
                  : {}),
                ...(plexText(library.agent)
                  ? { agent: plexText(library.agent) }
                  : {}),
                ...(plexText(library.scanner)
                  ? { scanner: plexText(library.scanner) }
                  : {}),
                locations: plexRecords(library.Location)
                  .map((location) => plexText(location.path))
                  .filter(Boolean),
              };
            })
            .filter((library): library is NonNullable<typeof library> =>
              Boolean(library)
            );
          return {
            machineIdentifier: plexText(identity?.machineIdentifier),
            name,
            libraries,
          };
        }
        return {
          machineIdentifier: 'development-plex-server',
          name: 'Vynode Preview Plex',
          libraries: [
            {
              key: '1',
              title: 'Movies',
              type: 'movie',
              language: 'en',
              agent: 'tv.plex.agents.movie',
              scanner: 'Plex Movie',
              locations: [`/preview/${input.host}/movies`],
            },
            {
              key: '2',
              title: 'TV Shows',
              type: 'show',
              language: 'en',
              agent: 'tv.plex.agents.series',
              scanner: 'Plex TV Series',
              locations: [`/preview/${input.host}/tv`],
            },
          ],
        };
      },
    }
  ),
  plexServerDirectory: {
    async discover() {
      if (realDevelopmentPlexEnabled) {
        const startedAt = Date.now();
        const input = {
          host: 'plex.local',
          port: 32400,
          transport: 'http' as const,
          webAppUrl: 'https://app.plex.tv/desktop',
          autoEmptyTrash: true,
        };
        const identityResponse =
          await developmentPlexTransport(input).query('/');
        const identity = plexRecord(
          plexRecord(identityResponse)?.MediaContainer
        );
        const name = plexText(identity?.friendlyName);
        if (name !== 'Laptop') {
          throw new Error(
            `Development Plex discovery is restricted to Laptop; received "${name || 'unknown'}".`
          );
        }
        return [
          {
            id: `local-${plexText(identity?.machineIdentifier)}`,
            serverName: name,
            machineIdentifier: plexText(identity?.machineIdentifier),
            input,
            local: true,
            reachable: true,
            latencyMs: Date.now() - startedAt,
          },
        ];
      }
      return [
        {
          id: 'preview-local',
          serverName: 'Vynode Preview Plex',
          machineIdentifier: 'development-plex-server',
          input: {
            host: 'plex.local',
            port: 32400,
            transport: 'https-verify',
            webAppUrl: 'https://app.plex.tv/desktop',
            autoEmptyTrash: true,
          },
          local: true,
          reachable: true,
          latencyMs: 18,
        },
        {
          id: 'preview-remote',
          serverName: 'Vynode Preview Plex',
          machineIdentifier: 'development-plex-server',
          input: {
            host: 'preview.plex.direct',
            port: 32400,
            transport: 'https-verify',
            webAppUrl: 'https://app.plex.tv/desktop',
            autoEmptyTrash: true,
          },
          local: false,
          reachable: true,
          latencyMs: 64,
        },
      ];
    },
  },
  async ownerPlexTokenReference() {
    return 'dev-vault:plex-owner';
  },
  sessions: sessionRepository,
  production: false,
  now: () => new Date(),
});

let scheduledOverlayCheckRunning = false;
let scheduledCollectionCheckRunning = false;
let scheduledWatchlistCheckRunning = false;
const processDueCollectionSchedule = async (): Promise<void> => {
  if (scheduledCollectionCheckRunning) return;
  const job = backgroundJobs.find(
    (candidate) => candidate.id === 'plex-collections-sync'
  );
  if (!job || job.running || Date.parse(job.nextExecutionTime) > Date.now())
    return;
  scheduledCollectionCheckRunning = true;
  const controller = new AbortController();
  backgroundJobControllers.set(job.id, controller);
  const [nextExecution, followingExecution] = nextCronExecutions(
    job.cronSchedule
  );
  backgroundJobs = backgroundJobs.map((candidate) =>
    candidate.id === job.id
      ? {
          ...candidate,
          running: true,
          startedAt: new Date().toISOString(),
          nextExecutionTime: (
            nextExecution ?? new Date(Date.now() + 3_600_000)
          ).toISOString(),
          ...(followingExecution
            ? { followingExecutionTime: followingExecution.toISOString() }
            : {}),
        }
      : candidate
  );
  await saveDevelopmentSources();
  try {
    const managed = await waitForDashboardJob('collections', controller.signal);
    if (managed.phase !== 'completed')
      throw new Error(
        managed.message ??
          `Managed collection synchronization ended as ${managed.phase}.`
      );
    const reconciliation = await collectionsQuickSync.run(controller.signal);
    const completedAt = new Date().toISOString();
    backgroundJobs = backgroundJobs.map((candidate) => {
      if (candidate.id !== job.id) return candidate;
      const { startedAt: _startedAt, ...rest } = candidate;
      return {
        ...rest,
        running: false,
        lastCompletedAt: completedAt,
        lastOutcome: managed.errorCount
          ? ('failed' as const)
          : ('success' as const),
        lastMessage: `Scheduled run synchronized ${managed.successCount} collections, created ${managed.createdCount}, skipped ${managed.skippedCount}, failed ${managed.errorCount}; then scanned ${reconciliation.scannedLibraries} Plex libraries, added ${reconciliation.itemsAdded} recovered members, and removed ${reconciliation.staleRecordsRemoved} stale records.`,
      };
    });
  } catch (error) {
    const completedAt = new Date().toISOString();
    backgroundJobs = backgroundJobs.map((candidate) => {
      if (candidate.id !== job.id) return candidate;
      const { startedAt: _startedAt, ...rest } = candidate;
      return {
        ...rest,
        running: false,
        lastCompletedAt: completedAt,
        lastOutcome: controller.signal.aborted
          ? ('cancelled' as const)
          : ('failed' as const),
        lastMessage: controller.signal.aborted
          ? 'Safe cancellation completed.'
          : error instanceof Error
            ? error.message
            : 'Scheduled Plex Collections Sync failed.',
      };
    });
  } finally {
    backgroundJobControllers.delete(job.id);
    scheduledCollectionCheckRunning = false;
    await saveDevelopmentSources();
  }
};
const processDueOverlaySchedule = async (): Promise<void> => {
  if (scheduledOverlayCheckRunning) return;
  const job = backgroundJobs.find(
    (candidate) => candidate.id === 'overlay-application'
  );
  if (!job || job.running || Date.parse(job.nextExecutionTime) > Date.now())
    return;
  scheduledOverlayCheckRunning = true;
  const controller = new AbortController();
  backgroundJobControllers.set(job.id, controller);
  const [nextExecution, followingExecution] = nextCronExecutions(
    job.cronSchedule
  );
  backgroundJobs = backgroundJobs.map((candidate) =>
    candidate.id === job.id
      ? {
          ...candidate,
          running: true,
          startedAt: new Date().toISOString(),
          nextExecutionTime: (
            nextExecution ?? new Date(Date.now() + 3_600_000)
          ).toISOString(),
          ...(followingExecution
            ? { followingExecutionTime: followingExecution.toISOString() }
            : {}),
        }
      : candidate
  );
  await saveDevelopmentSources();
  try {
    const report = await runScheduledOverlayApplication(controller.signal);
    const completedAt = new Date().toISOString();
    backgroundJobs = backgroundJobs.map((candidate) => {
      if (candidate.id !== job.id) return candidate;
      const { startedAt: _startedAt, ...rest } = candidate;
      return {
        ...rest,
        running: false,
        lastCompletedAt: completedAt,
        lastOutcome: report.failed ? ('failed' as const) : ('success' as const),
        lastMessage: `Scheduled run processed ${report.libraries} libraries: applied ${report.applied}, skipped ${report.skipped}, failed ${report.failed}.`,
      };
    });
  } catch (error) {
    const completedAt = new Date().toISOString();
    backgroundJobs = backgroundJobs.map((candidate) => {
      if (candidate.id !== job.id) return candidate;
      const { startedAt: _startedAt, ...rest } = candidate;
      return {
        ...rest,
        running: false,
        lastCompletedAt: completedAt,
        lastOutcome: controller.signal.aborted
          ? ('cancelled' as const)
          : ('failed' as const),
        lastMessage: controller.signal.aborted
          ? 'Safe cancellation completed.'
          : error instanceof Error
            ? error.message
            : 'Scheduled Poster Overlay Application failed.',
      };
    });
  } finally {
    backgroundJobControllers.delete(job.id);
    scheduledOverlayCheckRunning = false;
    await saveDevelopmentSources();
  }
};
const processDueWatchlistSchedule = async (): Promise<void> => {
  if (scheduledWatchlistCheckRunning) return;
  const job = backgroundJobs.find(
    (candidate) => candidate.id === 'watchlist-sync'
  );
  if (!job || job.running || Date.parse(job.nextExecutionTime) > Date.now())
    return;
  scheduledWatchlistCheckRunning = true;
  const controller = new AbortController();
  backgroundJobControllers.set(job.id, controller);
  const [nextExecution, followingExecution] = nextCronExecutions(
    job.cronSchedule
  );
  backgroundJobs = backgroundJobs.map((candidate) =>
    candidate.id === job.id
      ? {
          ...candidate,
          running: true,
          startedAt: new Date().toISOString(),
          nextExecutionTime: (
            nextExecution ?? new Date(Date.now() + 3_600_000)
          ).toISOString(),
          ...(followingExecution
            ? { followingExecutionTime: followingExecution.toISOString() }
            : {}),
        }
      : candidate
  );
  await saveDevelopmentSources();
  try {
    const report = await executePlexWatchlistSync(controller.signal);
    const completedAt = new Date().toISOString();
    backgroundJobs = backgroundJobs.map((candidate) => {
      if (candidate.id !== job.id) return candidate;
      const { startedAt: _startedAt, ...rest } = candidate;
      return {
        ...rest,
        running: false,
        lastCompletedAt: completedAt,
        lastOutcome: report.failed ? ('failed' as const) : ('success' as const),
        lastMessage: report.disabled
          ? 'Scheduled watchlist synchronization is disabled; no Plex or Arr changes were made.'
          : `Scheduled run scanned ${report.scanned} owner Plex watchlist items, added ${report.added}, found ${report.existing} existing, skipped ${report.skipped}, and failed ${report.failed}.${report.seerrTriggered ? ' Seerr all-user synchronization was triggered.' : ''}${report.failures.length ? ` ${report.failures.join('; ')}` : ''}`,
      };
    });
  } catch (error) {
    const completedAt = new Date().toISOString();
    backgroundJobs = backgroundJobs.map((candidate) => {
      if (candidate.id !== job.id) return candidate;
      const { startedAt: _startedAt, ...rest } = candidate;
      return {
        ...rest,
        running: false,
        lastCompletedAt: completedAt,
        lastOutcome: controller.signal.aborted
          ? ('cancelled' as const)
          : ('failed' as const),
        lastMessage: controller.signal.aborted
          ? 'Safe cancellation completed.'
          : error instanceof Error
            ? error.message
            : 'Scheduled Plex Watchlist Sync failed.',
      };
    });
  } finally {
    backgroundJobControllers.delete(job.id);
    scheduledWatchlistCheckRunning = false;
    await saveDevelopmentSources();
  }
};
const scheduledOverlayTimer = setInterval(() => {
  void processDueOverlaySchedule();
}, 15_000);
scheduledOverlayTimer.unref();
const scheduledCollectionTimer = setInterval(() => {
  void processDueCollectionSchedule();
}, 15_000);
scheduledCollectionTimer.unref();
const scheduledWatchlistTimer = setInterval(() => {
  void processDueWatchlistSchedule();
}, 15_000);
scheduledWatchlistTimer.unref();

await app.listen({ host: '127.0.0.1', port: 7171 });
