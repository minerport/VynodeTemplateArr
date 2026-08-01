import {
  ArrConfigurationService,
  ArrRequestClient,
  ArrTagSourceClient,
  DirectMissingMediaCoordinator,
  FileMissingRequestRepository,
  HttpArrProbe,
  HttpSeerrCollectionSourceClient,
  HttpSeerrProvider,
  HttpSeerrRequestCoordinator,
  PlexPlaceholderWebhookService,
  PlexWatchlistClient,
  PlexWatchlistSyncCoordinator,
  SeerrConfigurationService,
  type MissingMediaCandidate,
  type MissingMediaExecutionReport,
} from '@vynode/downloads';
import { PlexCloudAuthProvider, PlexLoginService } from '@vynode/identity';
import {
  IntegrationConfigurationService,
  MaintainerrClient,
  MDBListClient,
  MyAnimeListClient,
  TautulliClient,
  TmdbSourceClient,
  TraktClient,
  TraktOAuthService,
} from '@vynode/integrations';
import {
  FilePlexDiscoveryRepository,
  ManagedCollectionSynchronizer,
  PlexCloudServerDirectory,
  PlexDiscoveryCoordinator,
  PlexDiscoveryScanner,
  PlexHttpTransport,
  PlexLibraryGeneratorClient,
  PlexManagedCollectionClient,
  PlexManagementClient,
  PlexPersonCollectionClient,
  PlexServerConfigurationService,
  ProductionPlexServerProbe,
} from '@vynode/media-servers';
import { OnboardingService } from '@vynode/onboarding';
import {
  EncryptedSecretVault,
  SqliteAuditLog,
  SqliteIdentityRepository,
  SqliteJsonRepository,
  SqliteSessionRepository,
  VynodeSqliteStorage,
} from '@vynode/storage';
import { randomUUID } from 'node:crypto';

import type {
  CollectionPreviewResult,
  DashboardCollectionStatistic,
  DashboardSummary,
  ManagedCollection,
} from '@vynode/contracts';
import { FileDurableJobRepository } from '@vynode/jobs';
import { resolve } from 'node:path';
import { DashboardJobService } from './dashboard-jobs.js';
import { ProductionCollectionJobRunner } from './production-collection-jobs.js';
import { ProductionCollectionPosterStore } from './production-collection-posters.js';
import { ProductionCollectionPreview } from './production-collection-preview.js';
import { ProductionCollectionSurface } from './production-collections.js';
import {
  loadProductionConfiguration,
  type ProductionConfiguration,
} from './production-config.js';
import { ProductionGeneralSettings } from './production-general-settings.js';
import { ProductionJobsAndCache } from './production-jobs-cache.js';
import { ProductionPlaceholderServices } from './production-placeholder-settings.js';
import { ProductionPlexOverlayExecutor } from './production-plex-overlays.js';
import { ProductionPosterOverlayStore } from './production-poster-overlays.js';
import {
  SqliteArrRepository,
  SqliteIntegrationRepository,
  SqliteOnboardingRepository,
  SqlitePlexServerRepository,
  SqliteSeerrRepository,
} from './production-repositories.js';
import { ProductionTraktOAuthRepository } from './production-trakt-oauth.js';
import { ProductionWatchlistSettings } from './production-watchlists.js';

export interface ProductionRuntime {
  configuration: ProductionConfiguration;
  storage: VynodeSqliteStorage;
  secrets: EncryptedSecretVault;
  identities: SqliteIdentityRepository;
  sessions: SqliteSessionRepository;
  audit: SqliteAuditLog;
  installationId: string;
  plexLogin: PlexLoginService;
  onboarding: OnboardingService;
  plexServerRepository: SqlitePlexServerRepository;
  plexServer: PlexServerConfigurationService;
  plexServerDirectory: PlexCloudServerDirectory;
  ownerPlexTokenReference(): Promise<string>;
  integrations: IntegrationConfigurationService;
  collections: ProductionCollectionSurface;
  generalSettings: ProductionGeneralSettings;
  dashboardJobs: DashboardJobService;
  collectionJobs: ProductionCollectionJobRunner;
  posterOverlays: ProductionPosterOverlayStore;
  collectionPosters: ProductionCollectionPosterStore;
  placeholderServices: ProductionPlaceholderServices;
  watchlists: ProductionWatchlistSettings;
  plexWebhook: PlexPlaceholderWebhookService;
  jobsAndCache: ProductionJobsAndCache;
  traktOAuth: TraktOAuthService;
  downloads: ArrConfigurationService;
  arrRepository: SqliteArrRepository;
  seerr: SeerrConfigurationService;
  dashboardInsights: {
    summary(): Promise<DashboardSummary>;
    collectionStatistics(
      days: number
    ): Promise<readonly DashboardCollectionStatistic[]>;
    missingItems(
      filters: {
        mediaType?: 'movie' | 'show';
        requestStatus?:
          | 'pending'
          | 'approved'
          | 'declined'
          | 'available'
          | 'processing'
          | 'failed'
          | 'partially-available';
        collectionSource?: string;
        requestService?: string;
      },
      limit: number,
      offset: number
    ): ReturnType<FileMissingRequestRepository['query']>;
    syncMissingItems(): Promise<void>;
  };
  fetchingPolicy: {
    get(): Promise<{
      revision: number;
      letterboxdUsePlainHttp: boolean;
      flixpatrolUsePlainHttp: boolean;
    }>;
    save(
      expectedRevision: number,
      values: {
        letterboxdUsePlainHttp: boolean;
        flixpatrolUsePlainHttp: boolean;
      }
    ): Promise<
      | {
          revision: number;
          letterboxdUsePlainHttp: boolean;
          flixpatrolUsePlainHttp: boolean;
        }
      | undefined
    >;
  };
  close(): void;
}

export interface ProductionRuntimeOptions {
  fetch?: typeof globalThis.fetch;
}

export const createProductionRuntime = async (
  environment: Readonly<Record<string, string | undefined>>,
  options: ProductionRuntimeOptions = {}
): Promise<ProductionRuntime> => {
  const configuration = await loadProductionConfiguration(environment);
  const storage = new VynodeSqliteStorage(configuration.databasePath);
  try {
    const secrets = new EncryptedSecretVault(storage, configuration.masterKey);
    const identities = new SqliteIdentityRepository(storage);
    const system = new SqliteJsonRepository<{ id: string }>(storage, 'system');
    const installation =
      system.get('installation') ??
      system.put('installation', { id: randomUUID() });
    const installationId = installation.value.id;
    const sessions = new SqliteSessionRepository(storage, (userId) =>
      identities.principalForUser(userId)
    );
    const audit = new SqliteAuditLog(storage);
    const fetchingPolicyRepository = new SqliteJsonRepository<{
      letterboxdUsePlainHttp: boolean;
      flixpatrolUsePlainHttp: boolean;
    }>(storage, 'fetching-policy');
    const fetchingPolicy = {
      async get() {
        const stored = fetchingPolicyRepository.get('policy');
        return {
          revision: stored?.revision ?? 0,
          letterboxdUsePlainHttp: stored?.value.letterboxdUsePlainHttp ?? false,
          flixpatrolUsePlainHttp: stored?.value.flixpatrolUsePlainHttp ?? false,
        };
      },
      async save(
        expectedRevision: number,
        values: {
          letterboxdUsePlainHttp: boolean;
          flixpatrolUsePlainHttp: boolean;
        }
      ) {
        try {
          const stored = fetchingPolicyRepository.put(
            'policy',
            values,
            expectedRevision
          );
          return { revision: stored.revision, ...stored.value };
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('stored value changed')
          )
            return undefined;
          throw error;
        }
      },
    };
    const onboarding = new OnboardingService(
      new SqliteOnboardingRepository(storage, installationId)
    );
    const plexServerRepository = new SqlitePlexServerRepository(storage);
    const integrationRepository = new SqliteIntegrationRepository(storage);
    const arrRepository = new SqliteArrRepository(storage);
    const seerrRepository = new SqliteSeerrRepository(storage);
    const downloads = new ArrConfigurationService(
      arrRepository,
      {
        async store(value) {
          return secrets.store(value);
        },
        async remove(reference) {
          secrets.delete(reference);
        },
      },
      new HttpArrProbe(),
      () => new Date()
    );
    const seerrProvider = new HttpSeerrProvider(
      (configured) => secrets.get(configured.secretReference),
      options.fetch
    );
    const seerr = new SeerrConfigurationService(
      seerrRepository,
      {
        async store(value) {
          return secrets.store(value);
        },
        async remove(reference) {
          secrets.delete(reference);
        },
      },
      seerrProvider,
      () => new Date(),
      seerrProvider
    );
    const integrations = new IntegrationConfigurationService(
      integrationRepository,
      {
        async store(secret) {
          return secrets.store(secret);
        },
        async remove(reference) {
          secrets.delete(reference);
        },
      },
      {
        async test(draft, signal) {
          if (draft.id === 'trakt')
            await new TraktClient({ clientId: draft.clientId }).test(signal);
          else if (draft.id === 'tmdb') {
            const items = await new TmdbSourceClient({
              apiKey: draft.apiKey,
              ...(options.fetch ? { fetch: options.fetch } : {}),
            }).source(
              { mediaType: 'movie', subtype: 'popular', limit: 1 },
              signal
            );
            if (!items.length)
              throw new Error(
                'TMDB returned no results for its popular Movies probe.'
              );
          } else if (draft.id === 'myanimelist')
            await new MyAnimeListClient({
              clientId: draft.apiKey,
              ...(options.fetch ? { fetch: options.fetch } : {}),
            }).test(signal);
          else if (draft.id === 'mdblist')
            await new MDBListClient({
              apiKey: draft.apiKey,
              ...(options.fetch ? { fetch: options.fetch } : {}),
            }).test(signal);
          else if ('hostname' in draft && draft.id === 'tautulli')
            await new TautulliClient({
              hostname: draft.hostname,
              port: draft.port,
              useSsl: draft.useSsl,
              urlBase: draft.urlBase,
              apiKey: draft.apiKey,
              ...(options.fetch ? { fetch: options.fetch } : {}),
            }).test(signal);
          else if ('hostname' in draft)
            await new MaintainerrClient({
              hostname: draft.hostname,
              port: draft.port,
              useSsl: draft.useSsl,
              urlBase: draft.urlBase,
              ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
              ...(options.fetch ? { fetch: options.fetch } : {}),
            }).test(signal);
        },
      },
      () => new Date()
    );
    const traktOAuth = new TraktOAuthService(
      new ProductionTraktOAuthRepository(storage, secrets),
      async () => {
        const configured = await integrationRepository.get('trakt');
        const clientId =
          typeof configured?.values?.clientId === 'string'
            ? configured.values.clientId
            : undefined;
        const clientSecret = configured?.secretReference
          ? secrets.get(configured.secretReference)
          : undefined;
        return clientId && clientSecret
          ? { clientId, clientSecret }
          : undefined;
      },
      () => new Date()
    );
    const connectionOptions = {
      clientIdentifier: installationId,
      secret: async (reference: string) => secrets.get(reference),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    };
    const plexServer = new PlexServerConfigurationService(
      plexServerRepository,
      new ProductionPlexServerProbe(connectionOptions)
    );
    const plexServerDirectory = new PlexCloudServerDirectory(connectionOptions);
    const plexContext = async () => {
      const configured = await plexServerRepository.get();
      if (!configured)
        throw new Error('Connect and verify Plex before using collections.');
      const owner = await identities.findById('owner');
      if (!owner)
        throw new Error(
          'Connect the Plex owner account before using collections.'
        );
      const token = secrets.get(owner.tokenReference);
      if (!token)
        throw new Error(
          'The Plex owner credential is unavailable. Reconnect Plex.'
        );
      const transport = new PlexHttpTransport({
        connection: configured,
        token: async () => token,
        clientIdentifier: installationId,
      });
      return { configured, transport };
    };
    const collectionPreview = new ProductionCollectionPreview({
      async tmdbApiKey() {
        const configured = await integrationRepository.get('tmdb');
        return configured?.configured && configured.secretReference
          ? secrets.get(configured.secretReference)
          : undefined;
      },
      async integration(id) {
        const configured = await integrationRepository.get(id);
        if (!configured?.configured) return undefined;
        const secret = configured.secretReference
          ? secrets.get(configured.secretReference)
          : undefined;
        return { values: configured.values, ...(secret ? { secret } : {}) };
      },
      async arrSource(kind, serverId, tagId, signal) {
        const configured = await arrRepository.get(serverId);
        if (!configured || configured.endpoint.kind !== kind)
          throw new Error(
            `The selected ${kind === 'radarr' ? 'Radarr' : 'Sonarr'} server is unavailable.`
          );
        const apiKey = secrets.get(configured.secretReference);
        if (!apiKey)
          throw new Error('The download server credential is unavailable.');
        const client = new ArrTagSourceClient({
          ...configured.endpoint,
          apiKey,
        });
        if (!(await client.tags(signal)).some((tag) => tag.id === tagId))
          throw new Error(
            'The selected download-service tag no longer exists.'
          );
        return client.itemsForTag(tagId, signal);
      },
      async arrMonitored(kind, signal) {
        const configured = (await arrRepository.list(kind)).find(
          (item) => item.selection.isDefault
        );
        if (!configured)
          throw new Error(
            `Configure a default ${kind === 'radarr' ? 'Radarr' : 'Sonarr'} server before using monitored Coming Soon.`
          );
        const apiKey = secrets.get(configured.secretReference);
        if (!apiKey)
          throw new Error('The download server credential is unavailable.');
        return new ArrTagSourceClient({
          ...configured.endpoint,
          apiKey,
        }).monitoredUpcoming(signal);
      },
      async seerrSource(mediaType, subtype, limit, requesterId, signal) {
        const configured = await seerrRepository.get();
        if (!configured)
          throw new Error(
            'Connect and test Seerr before previewing this source.'
          );
        return new HttpSeerrCollectionSourceClient((value) =>
          secrets.get(value.secretReference)
        ).source(
          configured,
          {
            mediaType,
            subtype,
            limit,
            ...(requesterId ? { requesterId } : {}),
          },
          signal
        );
      },
      async plexQuery(path, signal) {
        return (await plexContext()).transport.query(path, signal);
      },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    const missingMedia = new DirectMissingMediaCoordinator({
      configurations: (kind) => arrRepository.list(kind),
      async client(configuration) {
        const apiKey = secrets.get(configuration.secretReference);
        if (!apiKey)
          throw new Error('The download server credential is unavailable.');
        return new ArrRequestClient({ ...configuration.endpoint, apiKey });
      },
    });
    const seerrRequests = new HttpSeerrRequestCoordinator(
      (configured) => secrets.get(configured.secretReference),
      options.fetch
    );
    const generalSettings = new ProductionGeneralSettings(
      storage,
      configuration.publicUrl,
      configuration.dataDirectory
    );
    const missingHistory = new FileMissingRequestRepository(
      resolve(configuration.dataDirectory, 'requests', 'missing.json')
    );
    let collections!: ProductionCollectionSurface;
    const applyExclusions = async (
      collection: ManagedCollection,
      result: CollectionPreviewResult,
      signal?: AbortSignal
    ): Promise<CollectionPreviewResult> => {
      const globalTitles = (await generalSettings.get()).globalExcludedTitles;
      const titles = new Set(
        [...globalTitles, ...(collection.behaviorSettings?.excludedTitles ?? [])]
          .map((value) => value.trim().toLocaleLowerCase())
          .filter(Boolean)
      );
      const excludedKeys = new Set<string>();
      const mutualIds = new Set(
        collection.behaviorSettings?.mutuallyExclusiveCollectionIds ?? []
      );
      if (mutualIds.has(collection.id))
        throw new Error(
          'A collection cannot be mutually exclusive with itself.'
        );
      if (mutualIds.size) {
        const surface = await collections.get();
        const targets = surface.collections.filter((item) =>
          mutualIds.has(item.id)
        );
        if (targets.length !== mutualIds.size)
          throw new Error(
            'One or more mutually exclusive collections no longer exist.'
          );
        const { transport } = await plexContext();
        for (const target of targets) {
          for (const ratingKey of [
            target.plexRatingKey,
            ...(
              target.sourceSettings?.plexGenerator?.generatedCollections ?? []
            ).map((item) => item.ratingKey),
            ...(target.sourceSettings?.generatedPersonCollections ?? []).map(
              (item) => item.ratingKey
            ),
          ].filter((value): value is string => Boolean(value))) {
            signal?.throwIfAborted();
            const payload = await transport.query(
              `/library/collections/${encodeURIComponent(ratingKey)}/children`,
              signal
            );
            const container =
              payload && typeof payload === 'object'
                ? (payload as Record<string, unknown>).MediaContainer
                : undefined;
            const metadata =
              container && typeof container === 'object'
                ? (container as Record<string, unknown>).Metadata
                : undefined;
            if (Array.isArray(metadata))
              for (const row of metadata) {
                if (row && typeof row === 'object') {
                  const key = String(
                    (row as Record<string, unknown>).ratingKey ?? ''
                  );
                  if (key) excludedKeys.add(key);
                }
              }
          }
        }
      }
      const items = result.items.filter(
        (item) =>
          !titles.has(item.title.trim().toLocaleLowerCase()) &&
          (!item.plexRatingKey || !excludedKeys.has(item.plexRatingKey))
      );
      const removed = result.items.length - items.length;
      const matchedCount = items.filter((item) => item.available).length;
      return {
        ...result,
        fetchedCount: items.length,
        matchedCount,
        missingCount: items.length - matchedCount,
        items,
        warnings: removed
          ? [
              ...result.warnings,
              `${removed} item${removed === 1 ? ' was' : 's were'} removed by collection exclusion rules.`,
            ]
          : result.warnings,
      };
    };
    collections = new ProductionCollectionSurface(
      storage,
      () => plexServerRepository.get(),
      (collection, signal) => collectionPreview.preview(collection, signal),
      async (collection, signal) => {
        const preview = await applyExclusions(
          collection,
          await collectionPreview.preview(collection, signal),
          signal
        );
        const missing = collection.missingMediaSettings;
        if (missing?.enabled) {
          const candidates: MissingMediaCandidate[] = preview.items
            .filter((item) => !item.available)
            .map((item) => ({
              key: `${collection.mediaType}:${item.tmdbId ?? item.tvdbId ?? item.title}`,
              mediaType: collection.mediaType,
              title: item.title,
              ...(item.year ? { year: item.year } : {}),
              ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}),
              ...(item.tvdbId ? { tvdbId: item.tvdbId } : {}),
            }));
          const eligible = candidates.filter((item) =>
            item.mediaType === 'movie'
              ? missing.searchMissingMovies
              : missing.searchMissingTv
          );
          if (eligible.length) {
            const operationKey = (candidate: MissingMediaCandidate) =>
              `${collection.id}:${candidate.key}`;
            await missingHistory.begin(
              eligible.map((candidate) => ({
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
                  missing.downloadMode === 'seerr'
                    ? 'Seerr'
                    : candidate.mediaType === 'movie'
                      ? 'Radarr'
                      : 'Sonarr',
                requestMethod: 'auto',
              })),
              new Date()
            );
            let routed: MissingMediaExecutionReport;
            if (missing.downloadMode === 'seerr') {
              const configured = await seerrRepository.get();
              if (!configured)
                throw new Error(
                  'Connect Seerr before requesting missing collection media.'
                );
              routed = await seerrRequests.execute(
                configured,
                eligible,
                missing,
                signal
              );
            } else
              routed = await missingMedia.execute(
                eligible,
                { radarr: missing.directRadarr, sonarr: missing.directSonarr },
                signal
              );
            await Promise.all(
              routed.executions.map((execution) => {
                const candidate = eligible.find(
                  (item) => item.key === execution.key
                );
                if (!candidate) return Promise.resolve();
                const requestStatus =
                  execution.outcome === 'added'
                    ? execution.message?.includes('pending')
                      ? 'pending'
                      : 'approved'
                    : execution.outcome === 'existing'
                      ? 'available'
                      : 'failed';
                return missingHistory.complete(
                  operationKey(candidate),
                  {
                    requestStatus,
                    ...(execution.serviceId !== undefined
                      ? { serviceId: execution.serviceId }
                      : {}),
                    ...(execution.serverId
                      ? { serverId: execution.serverId }
                      : {}),
                    ...(execution.message ? { notes: execution.message } : {}),
                  },
                  new Date()
                );
              })
            );
            if (routed.failed)
              throw new Error(
                `${routed.failed} missing-media request${routed.failed === 1 ? '' : 's'} failed.`
              );
          }
        }
        const desired = preview.items.flatMap((item) =>
          item.plexRatingKey ? [item.plexRatingKey] : []
        );
        const { configured, transport } = await plexContext();
        const report = await new ManagedCollectionSynchronizer(
          new PlexManagedCollectionClient({
            transport,
            machineIdentifier: configured.machineIdentifier,
            verifiedServerName: configured.name,
            allowedMutationServerNames: new Set([configured.name]),
          })
        ).synchronize(collection, desired, signal);
        return {
          plexRatingKey: report.plexRatingKey,
          itemCount: report.verifiedMemberKeys.length,
          created: report.created,
          failures: report.failures,
        };
      }
    );
    collections.connectPlexItemSearch(async (libraryId, query, itemType) => {
      const { configured, transport } = await plexContext();
      const library = configured.libraries.find(
        (item) =>
          item.key === libraryId &&
          item.available &&
          (item.type === 'movie' || item.type === 'show')
      );
      if (!library) throw new Error('The selected Plex library is unavailable.');
      const effectiveType: 'movie' | 'show' | 'season' | 'episode' =
        itemType ?? (library.type === 'movie' ? 'movie' : 'show');
      if (effectiveType === 'movie' && library.type !== 'movie')
        throw new Error('Movie search requires a Movie library.');
      if ((effectiveType === 'show' || effectiveType === 'season' || effectiveType === 'episode') && library.type !== 'show')
        throw new Error('TV show, season, and episode search requires a TV library.');
      const parameters = new URLSearchParams({
        type: effectiveType === 'movie' ? '1' : effectiveType === 'show' ? '2' : effectiveType === 'season' ? '3' : '4',
        title: query.trim(),
        includeGuids: '1',
        'X-Plex-Container-Start': '0',
        'X-Plex-Container-Size': '50',
      });
      const payload = await transport.query(
        `/library/sections/${encodeURIComponent(libraryId)}/all?${parameters}`
      );
      const container = payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>).MediaContainer
        : undefined;
      const rows = container && typeof container === 'object'
        ? (container as Record<string, unknown>).Metadata
        : undefined;
      return (Array.isArray(rows) ? rows : []).flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return [];
        const row = raw as Record<string, unknown>;
        const ratingKey = String(row.ratingKey ?? '');
        const title = String(row.title ?? '').trim();
        if (!/^\d+$/.test(ratingKey) || !title) return [];
        const year = Number(row.year);
        const parentRatingKey = String(row.parentRatingKey ?? '');
        const grandparentRatingKey = String(row.grandparentRatingKey ?? '');
        const seasonNumber = Number(effectiveType === 'episode' ? row.parentIndex : row.index);
        const episodeNumber = Number(row.index);
        return [{
          ratingKey,
          title,
          ...(Number.isInteger(year) ? { year } : {}),
          type: effectiveType,
          libraryId,
          libraryName: library.title,
          ...(effectiveType === 'season' && /^\d+$/.test(parentRatingKey)
            ? { parentRatingKey }
            : {}),
          ...(effectiveType === 'season' && Number.isInteger(seasonNumber)
            ? { seasonNumber }
            : {}),
          ...(effectiveType === 'episode' && /^\d+$/.test(parentRatingKey)
            ? { parentRatingKey }
            : {}),
          ...(effectiveType === 'episode' && /^\d+$/.test(grandparentRatingKey)
            ? { grandparentRatingKey }
            : {}),
          ...(effectiveType === 'episode' && Number.isInteger(seasonNumber)
            ? { seasonNumber }
            : {}),
          ...(effectiveType === 'episode' && Number.isInteger(episodeNumber)
            ? { episodeNumber }
            : {}),
        }];
      }).slice(0, 50);
    });
    collections.connectPreviewFilter(applyExclusions);
    collections.connectLibraryGenerator(
      async (libraryId, mediaType, subtype, signal) => {
        const { configured, transport } = await plexContext();
        return new PlexLibraryGeneratorClient({
          transport,
          machineIdentifier: configured.machineIdentifier,
          verifiedServerName: configured.name,
          allowedMutationServerNames: new Set([configured.name]),
        }).values(libraryId, mediaType, subtype, signal);
      },
      async (collection, values, signal) => {
        const { configured, transport } = await plexContext();
        const client = new PlexLibraryGeneratorClient({
          transport,
          machineIdentifier: configured.machineIdentifier,
          verifiedServerName: configured.name,
          allowedMutationServerNames: new Set([configured.name]),
        });
        const settings = collection.sourceSettings!.plexGenerator!;
        const selected = new Set(
          settings.selectedValues.length
            ? settings.selectedValues
            : values.map((value) => value.value)
        );
        const enabledGroups = new Set(settings.enabledRatingGroups);
        const desired = values.filter(
          (value) =>
            selected.has(value.value) &&
            (!value.group || enabledGroups.has(value.group))
        );
        const previous = new Map(
          (settings.generatedCollections ?? []).map((value) => [
            value.value,
            value,
          ])
        );
        const references = [];
        const failures: string[] = [];
        for (const value of desired) {
          signal?.throwIfAborted();
          const title = (settings.titleTemplate.trim() || '{value}').replaceAll(
            '{value}',
            value.label
          );
          const existing = previous.get(value.value);
          if (existing?.title === title) {
            references.push(existing);
            previous.delete(value.value);
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
            previous.delete(value.value);
          }
          try {
            references.push({
              value: value.value,
              title,
              ratingKey: await client.createSmart(
                {
                  title,
                  libraryId: collection.libraryId,
                  mediaType: collection.mediaType,
                  subtype: collection.sourceSettings!.subtype as Parameters<
                    typeof client.values
                  >[2],
                  value: value.label,
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
            signal?.throwIfAborted();
            await client
              .delete(stale.ratingKey, signal)
              .catch((error) =>
                failures.push(
                  `${stale.title}: ${error instanceof Error ? error.message : String(error)}`
                )
              );
          }
        } else references.push(...previous.values());
        return { references, failures };
      }
    );
    collections.connectPersonGenerator(async (collection, signal) => {
      const { configured, transport } = await plexContext();
      const client = new PlexPersonCollectionClient({
        transport,
        machineIdentifier: configured.machineIdentifier,
        verifiedServerName: configured.name,
        allowedMutationServerNames: new Set([configured.name]),
      });
      const settings = collection.sourceSettings!;
      const kind = settings.subtype as 'actors' | 'directors';
      const minimum = settings.personMinimumItems ?? 5;
      const people = (
        await client.people(
          collection.libraryId,
          collection.mediaType,
          kind,
          signal
        )
      )
        .filter((person) => person.count >= minimum)
        .slice(0, settings.maxItems);
      const previous = new Map(
        (settings.generatedPersonCollections ?? []).map((value) => [
          value.value.toLocaleLowerCase(),
          value,
        ])
      );
      const references = [];
      const failures: string[] = [];
      for (const person of people) {
        signal?.throwIfAborted();
        const key = person.name.toLocaleLowerCase();
        const token = kind === 'actors' ? '{actor}' : '{director}';
        const title = collection.title.includes(token)
          ? collection.title.replaceAll(token, person.name)
          : person.name;
        const existing = previous.get(key);
        if (existing?.title === title) {
          references.push(existing);
          previous.delete(key);
          continue;
        }
        if (existing) {
          await client
            .delete(existing.ratingKey, signal)
            .catch((error) =>
              failures.push(
                `${existing.title}: ${error instanceof Error ? error.message : String(error)}`
              )
            );
          previous.delete(key);
        }
        try {
          references.push({
            value: person.name,
            title,
            ratingKey: await client.createSmart(
              {
                title,
                libraryId: collection.libraryId,
                mediaType: collection.mediaType,
                kind,
                personName: person.name,
                maxItems: settings.maxItems,
              },
              signal
            ),
          });
        } catch (error) {
          failures.push(
            `${person.name}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      for (const stale of previous.values()) {
        signal?.throwIfAborted();
        await client
          .delete(stale.ratingKey, signal)
          .catch((error) =>
            failures.push(
              `${stale.title}: ${error instanceof Error ? error.message : String(error)}`
            )
          );
      }
      return { references, failures };
    });
    const collectionJobs = new ProductionCollectionJobRunner(
      new FileDurableJobRepository(
        resolve(configuration.dataDirectory, 'jobs', 'queue.json')
      ),
      collections
    );
    const plexDiscoveryRepository = new FilePlexDiscoveryRepository({
      path: resolve(
        configuration.dataDirectory,
        'plex-discovery',
        'state.json'
      ),
    });
    collections.connectDiscovery(plexDiscoveryRepository, async () => {
      const { configured, transport } = await plexContext();
      return new PlexDiscoveryCoordinator({
        scanner: new PlexDiscoveryScanner(transport),
        repository: plexDiscoveryRepository,
        libraries: async () => configured.libraries,
        managedCollectionKeys: async () =>
          new Set(
            (await collections.get()).collections.flatMap((item) =>
              item.plexRatingKey ? [item.plexRatingKey] : []
            )
          ),
        now: () => new Date().toISOString(),
      }).scan();
    });
    const posterOverlays = new ProductionPosterOverlayStore(
      storage,
      () => plexServerRepository.get(),
      configuration.dataDirectory,
      async () =>
        (await integrationRepository.get('maintainerr'))?.configured === true
    );
    const collectionPosters = new ProductionCollectionPosterStore(
      storage,
      configuration.dataDirectory
    );
    const overlayExecutor = new ProductionPlexOverlayExecutor(
      resolve(configuration.dataDirectory, 'poster-overlays'),
      posterOverlays,
      collectionPosters,
      plexContext,
      async () => {
        const configured = await integrationRepository.get('tmdb');
        return configured?.configured && configured.secretReference
          ? secrets.get(configured.secretReference)
          : undefined;
      },
      options.fetch
    );
    posterOverlays.connectOperations(overlayExecutor);
    const placeholderServices = new ProductionPlaceholderServices(
      storage,
      configuration.dataDirectory,
      configuration.mediaRoots,
      () => plexServerRepository.get()
    );
    const watchlists = new ProductionWatchlistSettings(
      storage,
      arrRepository,
      seerrRepository,
      (reference) => secrets.get(reference),
      options.fetch
    );
    const plexWebhook = new PlexPlaceholderWebhookService(
      {
        async markUnplayed(ratingKey) {
          const { transport } = await plexContext();
          await new PlexManagementClient(transport).markUnplayed(ratingKey);
        },
      },
      () => new Date(),
      5 * 60 * 1000,
      () => plexServerRepository.peek()?.machineIdentifier
    );
    await collectionJobs.resume();
    const dashboardJobs = new DashboardJobService(
      {
        async items(kind) {
          if (kind !== 'collections') return [];
          return (await collections.get()).collections
            .filter((item) => item.isActive !== false)
            .map((item) => ({
              id: item.id,
              name: item.title,
              sourceType: item.sourceType,
            }));
        },
        async process(kind, item, signal) {
          if (kind !== 'collections')
            return { durationMs: 0, outcome: 'skipped' as const };
          const result = await collectionJobs.execute(item.id, signal);
          return {
            durationMs: 0,
            outcome: 'success' as const,
            created: result.created,
          };
        },
        async cleanup() {
          return;
        },
      },
      () => new Date()
    );
    const executeWatchlists = async (signal: AbortSignal) => {
      const settings = await watchlists.service.get();
      let report = {
        scanned: 0,
        added: 0,
        existing: 0,
        skipped: 0,
        failed: 0,
        failures: [] as readonly string[],
        disabled: !settings.enableOwner,
      };
      if (settings.enableOwner) {
        const owner = await identities.findById('owner');
        if (!owner)
          throw new Error(
            'Connect the Plex owner account before synchronizing watchlists.'
          );
        const token = secrets.get(owner.tokenReference);
        if (!token)
          throw new Error(
            'The Plex owner credential is unavailable. Reconnect Plex.'
          );
        report = await new PlexWatchlistSyncCoordinator(
          new PlexWatchlistClient(token, options.fetch, installationId),
          {
            async route(item, routeSignal) {
              const destination =
                item.mediaType === 'movie' ? settings.radarr : settings.sonarr;
              const kind = item.mediaType === 'movie' ? 'radarr' : 'sonarr';
              if (
                !destination.serverId ||
                destination.profileId === undefined ||
                !destination.rootFolder
              )
                return 'skipped';
              const configured = await arrRepository.get(destination.serverId);
              if (!configured || configured.endpoint.kind !== kind)
                throw new Error(
                  'The configured watchlist destination is unavailable.'
                );
              const apiKey = secrets.get(configured.secretReference);
              if (!apiKey)
                throw new Error(
                  'The watchlist destination credential is unavailable.'
                );
              const client = new ArrRequestClient({
                ...configured.endpoint,
                apiKey,
              });
              if (item.mediaType === 'movie') {
                if (!item.tmdbId) return 'skipped';
                const selection =
                  configured.selection.kind === 'radarr'
                    ? configured.selection
                    : undefined;
                if (!selection)
                  throw new Error(
                    'The watchlist movie destination is invalid.'
                  );
                const result = await client.addMovie(
                  {
                    title: item.title,
                    year: item.year ?? new Date().getUTCFullYear(),
                    tmdbId: item.tmdbId,
                    profileId: destination.profileId,
                    rootFolder: destination.rootFolder,
                    minimumAvailability: selection.minimumAvailability,
                    tagIds: destination.tagIds,
                    monitor: destination.monitor,
                    searchOnAdd: destination.searchOnAdd,
                    tagExistingItems: selection.tagExistingItems,
                  },
                  routeSignal
                );
                return result.outcome === 'added'
                  ? 'added'
                  : result.outcome === 'existing'
                    ? 'existing'
                    : 'skipped';
              }
              if (!item.tvdbId) return 'skipped';
              const selection =
                configured.selection.kind === 'sonarr'
                  ? configured.selection
                  : undefined;
              if (!selection)
                throw new Error('The watchlist TV destination is invalid.');
              const result = await client.addSeries(
                {
                  title: item.title,
                  tvdbId: item.tvdbId,
                  profileId: destination.profileId,
                  rootFolder: destination.rootFolder,
                  tagIds: destination.tagIds,
                  monitorType: destination.monitor
                    ? selection.monitorType
                    : 'none',
                  seriesType: selection.seriesType,
                  seasonFolders:
                    destination.seasonFolders ?? selection.seasonFolders,
                  searchOnAdd: destination.searchOnAdd,
                  tagExistingItems: selection.tagExistingItems,
                },
                routeSignal
              );
              return result.outcome === 'added'
                ? 'added'
                : result.outcome === 'existing'
                  ? 'existing'
                  : 'skipped';
            },
          }
        ).run(true, signal);
      }
      if (settings.enableUsers) {
        const configured = await seerrRepository.get();
        if (!configured)
          throw new Error(
            'Connect Seerr before synchronizing linked-user watchlists.'
          );
        await seerrProvider.triggerWatchlistSync(configured, signal);
      }
      return report;
    };
    const jobsAndCache = new ProductionJobsAndCache(
      storage,
      configuration.dataDirectory,
      {
        'plex-collections-sync': async (signal) => {
          const active = (await collections.get()).collections.filter(
            (item) => item.isActive !== false
          );
          let created = 0;
          for (const item of active) {
            signal.throwIfAborted();
            if ((await collectionJobs.execute(item.id, signal)).created)
              created += 1;
          }
          return `Synchronized ${active.length} collections; created ${created}.`;
        },
        'overlay-application': async (signal) => {
          const report = await overlayExecutor.executeAll(signal);
          return `Processed ${report.libraries} libraries: applied ${report.applied}, restored ${report.restored}, skipped ${report.skipped}, failed ${report.failed}.`;
        },
        'watchlist-sync': async (signal) => {
          const report = await executeWatchlists(signal);
          return report.disabled
            ? 'Watchlist synchronization is disabled.'
            : `Scanned ${report.scanned}, added ${report.added}, found ${report.existing} existing, skipped ${report.skipped}, failed ${report.failed}.`;
        },
      }
    );
    const tautulliClientFromConfiguration = async () => {
      const configured = await integrationRepository.get('tautulli');
      if (!configured?.configured)
        throw new Error(
          'Connect and test Tautulli before loading activity statistics.'
        );
      const apiKey = configured.secretReference
        ? secrets.get(configured.secretReference)
        : undefined;
      if (!apiKey)
        throw new Error(
          'The Tautulli credential is unavailable. Reconnect Tautulli.'
        );
      const values = configured.values;
      return new TautulliClient({
        hostname: String(values.hostname ?? ''),
        port: Number(values.port ?? 8181),
        useSsl: Boolean(values.useSsl),
        urlBase: String(values.urlBase ?? ''),
        apiKey,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    };
    const tautulliCollectionInputs = async () =>
      (await collections.get()).collections.flatMap((item) =>
        item.plexRatingKey
          ? [
              {
                ratingKey: item.plexRatingKey,
                title: item.title,
                mediaType: item.mediaType,
                itemCount: item.itemCount,
              },
            ]
          : []
      );
    const dashboardInsights = {
      async summary() {
        const surface = await collections.get();
        const managed = surface.collections.length;
        const preExisting = (surface.discoveredPlexItems ?? []).filter(
          (item) => item.kind === 'pre-existing-collection' && !item.missing
        ).length;
        const tautulli = await integrationRepository.get('tautulli');
        const tautulliConnected = Boolean(tautulli?.configured);
        const activity = tautulliConnected
          ? await (await tautulliClientFromConfiguration()).activitySummary(7)
          : { totalPlays: 0, moviePlays: 0, showPlays: 0 };
        const inputs = await tautulliCollectionInputs();
        const statistics =
          tautulliConnected && inputs.length
            ? await (
                await tautulliClientFromConfiguration()
              ).collectionStatistics(inputs, 7)
            : [];
        return {
          collections: { managed, preExisting, total: managed + preExisting },
          activity: {
            ...activity,
            collectionPlays: statistics.reduce(
              (total, item) => total + item.totalPlays,
              0
            ),
          },
          tautulliConnected,
          timestamp: new Date().toISOString(),
        };
      },
      async collectionStatistics(days: number) {
        const inputs = await tautulliCollectionInputs();
        if (!inputs.length) return [];
        return (await tautulliClientFromConfiguration()).collectionStatistics(
          inputs,
          days
        );
      },
      missingItems(
        filters: {
          mediaType?: 'movie' | 'show';
          requestStatus?:
            | 'pending'
            | 'approved'
            | 'declined'
            | 'available'
            | 'processing'
            | 'failed'
            | 'partially-available';
          collectionSource?: string;
          requestService?: string;
        },
        limit: number,
        offset: number
      ) {
        return missingHistory.query(filters, limit, offset);
      },
      async syncMissingItems() {
        const configured = await seerrRepository.get();
        if (!configured) return;
        const page = await missingHistory.query(
          { requestService: 'Seerr' },
          1000,
          0
        );
        await Promise.all(
          page.results.map(async (record) => {
            const serviceId = record.serviceId;
            if (serviceId === undefined) return;
            try {
              const requestStatus = await seerrRequests.status(
                configured,
                serviceId
              );
              await missingHistory.complete(
                record.operationKey,
                {
                  requestStatus,
                  serviceId,
                  ...(record.serverId ? { serverId: record.serverId } : {}),
                },
                new Date()
              );
            } catch (error) {
              await missingHistory.complete(
                record.operationKey,
                {
                  requestStatus: 'failed',
                  serviceId,
                  ...(record.serverId ? { serverId: record.serverId } : {}),
                  notes:
                    error instanceof Error
                      ? error.message
                      : 'Unable to synchronize Seerr request status.',
                },
                new Date()
              );
            }
          })
        );
      },
    };
    const plexLogin = new PlexLoginService(
      new PlexCloudAuthProvider({
        clientIdentifier: installationId,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
      identities,
      sessions,
      secrets,
      {
        async canSignIn(account, owner) {
          return !owner || owner.plexAccountId === account.id;
        },
        async allowAutomaticSharedUserCreation() {
          return false;
        },
      },
      { now: () => new Date() }
    );
    audit.append({
      action: 'runtime.start',
      target: 'control-plane',
      outcome: 'success',
      details: {
        version: process.env.npm_package_version ?? 'unknown',
        host: configuration.host,
        port: configuration.port,
      },
    });
    return {
      configuration,
      storage,
      secrets,
      identities,
      sessions,
      audit,
      installationId,
      plexLogin,
      onboarding,
      plexServerRepository,
      plexServer,
      plexServerDirectory,
      integrations,
      collections,
      generalSettings,
      dashboardJobs,
      jobsAndCache,
      traktOAuth,
      collectionJobs,
      posterOverlays,
      collectionPosters,
      placeholderServices,
      watchlists,
      plexWebhook,
      downloads,
      arrRepository,
      seerr,
      dashboardInsights,
      fetchingPolicy,
      async ownerPlexTokenReference() {
        const owner = await identities.findById('owner');
        if (!owner) throw new Error('Connect the Plex owner account first.');
        return owner.tokenReference;
      },
      close() {
        audit.append({
          action: 'runtime.stop',
          target: 'control-plane',
          outcome: 'success',
        });
        storage.close();
      },
    };
  } catch (error) {
    storage.close();
    throw error;
  }
};
