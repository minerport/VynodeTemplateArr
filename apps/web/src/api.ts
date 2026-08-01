import type {
  OnboardingEvent,
  OnboardingState,
} from '@vynode/onboarding';
import type {
  PlexConnectionInput,
  PlexConnectionCandidate,
  PlexServerConfiguration,
} from '@vynode/media-servers';
import type {
  IntegrationConfiguration,
  IntegrationDraft,
  IntegrationId,
} from '@vynode/integrations';
import type {
  ArrConfigurationView,
  ArrEndpointDraft,
  ArrKind,
  ArrProbeResult,
  ArrSelection,
  DirectoryListing,
  PlaceholderSettings,
  PlaceholderInventory,
  SeerrConfigurationView,
  SeerrDestination,
  SeerrEndpointDraft,
  SeerrProbeResult,
  ServiceUserCreationMode,
  WatchlistDestination,
  WatchlistDestinationOptions,
  WatchlistSettings,
  PlexWebhookStatus,
} from '@vynode/downloads';
import type {
  DashboardJobKind,
  DashboardJobStatus,
  DashboardCollectionStatistic,
  DashboardMissingItem,
  DashboardSummary,
  CollectionSurface,
  ManagedCollection,
  CollectionDraft,
  AuthenticatedPrincipal,
  GeneralSettings,
  GeneralSettingsDraft,
  ApplicationLogPage,
  ApplicationLogEntry,
  BackgroundJob,
  CacheStatistic,
  AboutInformation,
  PosterOverlayWorkspace,
  PosterSource,
  PosterTestSearchItem,
  PosterOverlayTestResult,
  CollectionPosterWorkspace,
  CollectionPosterDesign,
  CollectionPreviewResult,
  OverlayTemplateSummary,
  PlexLibraryGeneratorSubtype,
  PlexLibraryGeneratorValue,
} from '@vynode/contracts';

export interface PlexLoginAttempt {
  id: string;
  state:
    | 'pending'
    | 'authorized'
    | 'denied'
    | 'expired'
    | 'cancelled'
    | 'failed';
  authorizationUrl: string;
  expiresAt: string;
  failureCode?: string;
}

export interface AgregarrImportResult<TWorkspace> {
  format: 'agregarr';
  kind: 'collection-poster' | 'overlay';
  version: string;
  name: string;
  renamed: boolean;
  importedAssets: number;
  importedLayers: number;
  warnings: readonly string[];
  workspace: TWorkspace;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const request = async <T>(
  path: string,
  init?: RequestInit
): Promise<T> => {
  const hasJsonBody = typeof init?.body === 'string';
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(hasJsonBody ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new ApiError(
      body.message ?? `Request failed (${response.status})`,
      response.status
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export const api = {
  health: () =>
    request<{ status: 'ok'; checkedAt: string }>('/health'),
  dashboardJob: (kind: DashboardJobKind) =>
    request<DashboardJobStatus>(`/api/dashboard/jobs/${kind}`),
  startDashboardJob: (kind: DashboardJobKind) =>
    request<DashboardJobStatus>(`/api/dashboard/jobs/${kind}/start`, {
      method: 'POST',
    }),
  cancelDashboardJob: (kind: DashboardJobKind) =>
    request<DashboardJobStatus>(`/api/dashboard/jobs/${kind}/cancel`, {
      method: 'POST',
    }),
  dashboardSummary: () => request<DashboardSummary>('/api/dashboard/summary'),
  dashboardCollectionStatistics: (days: number) =>
    request<{
      collections: readonly DashboardCollectionStatistic[];
      days: number;
      timestamp: string;
    }>(`/api/dashboard/collection-statistics?days=${days}`),
  dashboardMissingItems: (
    filters: {
      mediaType?: 'movie' | 'show';
      requestStatus?: DashboardMissingItem['requestStatus'];
      collectionSource?: string;
      requestService?: string;
    },
    limit: number,
    offset: number
  ) => {
    const parameters = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    for (const [key, value] of Object.entries(filters)) {
      if (value) parameters.set(key, value);
    }
    return (
    request<{
      results: readonly DashboardMissingItem[];
      total: number;
      limit: number;
      offset: number;
      timestamp: string;
    }>(`/api/dashboard/missing-items?${parameters}`)
    );
  },
  syncDashboardMissingItems: () =>
    request<{ accepted: true }>('/api/dashboard/missing-items/sync', {
      method: 'POST',
    }),
  collections: () => request<CollectionSurface>('/api/collections'),
  discoverPlexCollections: () =>
    request<import('@vynode/contracts').PlexDiscoveryResult>(
      '/api/collections/discovery/scan',
      { method: 'POST', body: JSON.stringify({}) }
    ),
  saveDiscoveredPlexItem: (
    id: string,
    draft: import('@vynode/contracts').PlexDiscoveredItemDraft
  ) =>
    request<import('@vynode/contracts').PlexDiscoveredItem>(
      `/api/collections/discovery/items/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(draft) }
    ),
  cleanupMissingPlexItems: () =>
    request<import('@vynode/contracts').PlexMissingCleanupResult>(
      '/api/collections/discovery/missing',
      { method: 'DELETE' }
    ),
  linkDiscoveredPlexItems: (id: string, memberIds: readonly string[]) =>
    request<import('@vynode/contracts').PlexDiscoveredLinkResult>(
      `/api/collections/discovery/items/${encodeURIComponent(id)}/link`,
      { method: 'POST', body: JSON.stringify({ memberIds }) }
    ),
  unlinkDiscoveredPlexItems: (id: string) =>
    request<import('@vynode/contracts').PlexDiscoveredLinkResult>(
      `/api/collections/discovery/items/${encodeURIComponent(id)}/unlink`,
      { method: 'POST', body: JSON.stringify({}) }
    ),
  updateCollectionPlacement: (
    id: string,
    input: Partial<
      Pick<
        ManagedCollection,
        | 'homeVisible'
        | 'recommendedVisible'
        | 'libraryVisible'
        | 'sharedOrder'
        | 'libraryOrder'
      >
    >
  ) =>
    request<ManagedCollection>(
      `/api/collections/${encodeURIComponent(id)}/placement`,
      { method: 'PATCH', body: JSON.stringify(input) }
    ),
  reorderCollectionPlacement: (
    firstId: string,
    secondId: string,
    orderKey: 'sharedOrder' | 'libraryOrder'
  ) =>
    request<void>('/api/collections/placement/reorder', {
      method: 'POST',
      body: JSON.stringify({ firstId, secondId, orderKey }),
    }),
  saveCollection: (id: string | undefined, draft: CollectionDraft) =>
    request<ManagedCollection>(
      id ? `/api/collections/${encodeURIComponent(id)}` : '/api/collections',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(draft),
      }
    ),
  previewCollection: (id: string) =>
    request<CollectionPreviewResult>(
      `/api/collections/${encodeURIComponent(id)}/preview`
    ),
  syncCollection: (id: string) =>
    request<void>(`/api/collections/${encodeURIComponent(id)}/sync`, {
      method: 'POST',
    }),
  linkCollections: (id: string, memberIds: readonly string[]) =>
    request<import('@vynode/contracts').CollectionLinkResult>(
      `/api/collections/${encodeURIComponent(id)}/link`,
      { method: 'POST', body: JSON.stringify({ memberIds }) }
    ),
  unlinkCollection: (id: string) =>
    request<import('@vynode/contracts').CollectionLinkResult>(
      `/api/collections/${encodeURIComponent(id)}/unlink`,
      { method: 'POST', body: JSON.stringify({}) }
    ),
  validateCollectionSource: (
    type: CollectionDraft['sourceType'],
    subtype: string,
    customUrl?: string
  ) =>
    request<{
      valid: boolean;
      title?: string;
      contentType?: 'movie' | 'show' | 'mixed';
      message?: string;
    }>('/api/collections/source/validate', {
      method: 'POST',
      body: JSON.stringify({ type, subtype, customUrl }),
    }),
  copyCollection: (id: string) =>
    request<ManagedCollection>(
      `/api/collections/${encodeURIComponent(id)}/copy`,
      { method: 'POST' }
    ),
  deleteCollection: (id: string) =>
    request<void>(`/api/collections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  generalSettings: () =>
    request<GeneralSettings>('/api/settings/general'),
  saveGeneralSettings: (
    expectedRevision: number,
    settings: GeneralSettingsDraft
  ) =>
    request<GeneralSettings>('/api/settings/general', {
      method: 'PUT',
      body: JSON.stringify({ expectedRevision, settings }),
    }),
  regenerateApiKey: () =>
    request<GeneralSettings>('/api/settings/general/regenerate-api-key', {
      method: 'POST',
    }),
  clearImageCache: () =>
    request<GeneralSettings>('/api/settings/general/clear-image-cache', {
      method: 'POST',
    }),
  logs: (
    level: ApplicationLogEntry['level'],
    search: string,
    page: number,
    pageSize: number
  ) =>
    request<ApplicationLogPage>(
      `/api/settings/logs?level=${level}&search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`
    ),
  jobs: () => request<readonly BackgroundJob[]>('/api/settings/jobs'),
  runJob: (id: string) =>
    request<BackgroundJob>(`/api/settings/jobs/${encodeURIComponent(id)}/run`, {
      method: 'POST',
    }),
  cancelJob: (id: string) =>
    request<BackgroundJob>(
      `/api/settings/jobs/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' }
    ),
  scheduleJob: (id: string, cronSchedule: string) =>
    request<BackgroundJob>(
      `/api/settings/jobs/${encodeURIComponent(id)}/schedule`,
      { method: 'PUT', body: JSON.stringify({ cronSchedule }) }
    ),
  caches: () =>
    request<readonly CacheStatistic[]>('/api/settings/caches'),
  flushCache: (id: string) =>
    request<CacheStatistic>(
      `/api/settings/caches/${encodeURIComponent(id)}/flush`,
      { method: 'POST' }
    ),
  about: () => request<AboutInformation>('/api/settings/about'),
  posterOverlays: () =>
    request<PosterOverlayWorkspace>('/api/posters/overlays'),
  overlayPlexLabels: () => request<readonly string[]>('/api/posters/overlays/condition-values/plex-labels'),
  saveOverlayTemplate: (id: string | undefined, input: Omit<OverlayTemplateSummary, 'id' | 'displayOrder' | 'elementCount'>) =>
    request<PosterOverlayWorkspace>(id ? `/api/posters/overlays/templates/${encodeURIComponent(id)}` : '/api/posters/overlays/templates', { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) }),
  importAgregarrOverlayTemplate: (file: File) => {
    const body = new FormData();
    body.append('template', file);
    return request<AgregarrImportResult<PosterOverlayWorkspace>>(
      '/api/posters/overlays/templates/import/agregarr',
      { method: 'POST', body }
    );
  },
  duplicateOverlayTemplate: (id: string) =>
    request<PosterOverlayWorkspace>(`/api/posters/overlays/templates/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  deleteOverlayTemplate: (id: string) =>
    request<PosterOverlayWorkspace>(`/api/posters/overlays/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  copyOverlayElements: (sourceTemplateId: string, targetTemplateIds: readonly string[], elementIds: readonly string[]) =>
    request<{ workspace: PosterOverlayWorkspace; copiedTargets: number; copiedElements: number }>('/api/posters/overlays/templates/copy-elements', { method: 'POST', body: JSON.stringify({ sourceTemplateId, targetTemplateIds, elementIds }) }),
  savePosterSource: (expectedRevision: number, source: PosterSource) =>
    request<PosterOverlayWorkspace>('/api/posters/overlays/source', {
      method: 'PUT',
      body: JSON.stringify({ expectedRevision, source }),
    }),
  downloadCleanPlexBasePosters: (confirmation: string) =>
    request<PosterOverlayWorkspace>('/api/posters/overlays/source/plex/download-clean-bases', {
      method: 'POST',
      body: JSON.stringify({ confirmation }),
    }),
  generateLocalPosterFolders: () =>
    request<{ scanned: number; created: number; skippedExisting: number; skippedMissingTmdb: number; failed: number }>(
      '/api/posters/overlays/source/local/generate-folders',
      { method: 'POST' }
    ),
  populateLocalPosters: () =>
    request<{ scanned: number; created: number; skippedExisting: number; skippedMissingTmdb: number; failed: number }>(
      '/api/posters/overlays/source/local/populate',
      { method: 'POST' }
    ),
  updatePosterLibrary: (
    id: string,
    input: {
      enabledTemplateIds?: readonly string[];
      tmdbLanguage?: string;
      enableEpisodeScanning?: boolean;
      maintainerrSeasonOverlays?: boolean;
    }
  ) =>
    request<PosterOverlayWorkspace>(
      `/api/posters/overlays/libraries/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(input) }
    ),
  applyPosterLibrary: (id: string) =>
    request<PosterOverlayWorkspace>(
      `/api/posters/overlays/libraries/${encodeURIComponent(id)}/apply`,
      { method: 'POST' }
    ),
  applyAllPosterLibraries: () =>
    request<PosterOverlayWorkspace>(
      '/api/posters/overlays/libraries/apply-all',
      { method: 'POST' }
    ),
  cancelPosterLibrary: (id: string) =>
    request<PosterOverlayWorkspace>(
      `/api/posters/overlays/libraries/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' }
    ),
  resetPosterLibrary: (id: string) =>
    request<PosterOverlayWorkspace>(
      `/api/posters/overlays/libraries/${encodeURIComponent(id)}/reset`,
      { method: 'POST' }
    ),
  searchPosterTestItems: (query: string, libraryId?: string) =>
    request<{ results: readonly PosterTestSearchItem[] }>(
      `/api/posters/overlays/test-items?query=${encodeURIComponent(query)}${libraryId ? `&libraryId=${encodeURIComponent(libraryId)}` : ''}`
    ),
  searchCollectionPlexItems: (
    libraryId: string,
    query: string,
    itemType?: 'movie' | 'show' | 'season' | 'episode'
  ) =>
    request<{ results: readonly PosterTestSearchItem[] }>(
      `/api/collections/plex-items?libraryId=${encodeURIComponent(libraryId)}&query=${encodeURIComponent(query)}${itemType ? `&itemType=${encodeURIComponent(itemType)}` : ''}`
    ),
  plexCollectionGeneratorValues: (
    libraryId: string,
    subtype: PlexLibraryGeneratorSubtype
  ) =>
    request<{ values: readonly PlexLibraryGeneratorValue[] }>(
      `/api/collections/plex-generator-values?libraryId=${encodeURIComponent(libraryId)}&subtype=${encodeURIComponent(subtype)}`
    ),
  testPosterItem: (ratingKey: string) =>
    request<PosterOverlayTestResult>('/api/posters/overlays/test', {
      method: 'POST',
      body: JSON.stringify({ ratingKey }),
    }),
  applyPosterItem: (ratingKey: string) =>
    request<PosterOverlayWorkspace>(
      `/api/posters/overlays/items/${encodeURIComponent(ratingKey)}/apply`,
      { method: 'POST' }
    ),
  resetPosterItem: (ratingKey: string) =>
    request<PosterOverlayWorkspace>(
      `/api/posters/overlays/items/${encodeURIComponent(ratingKey)}/reset`,
      { method: 'POST' }
    ),
  collectionPosters: () =>
    request<CollectionPosterWorkspace>('/api/posters/collections'),
  importCollectionPosterSourceColors: (input: unknown) =>
    request<{ workspace: CollectionPosterWorkspace; importCount: number }>(
      '/api/posters/collections/source-colors/import',
      { method: 'POST', body: JSON.stringify(input) }
    ),
  uploadCollectionPosterAsset: (file: File) => {
    const body = new FormData();
    body.append('asset', file);
    return request<{
      workspace: CollectionPosterWorkspace;
      asset: CollectionPosterWorkspace['assets'][number];
    }>('/api/posters/collections/assets', { method: 'POST', body });
  },
  saveCollectionPosterTemplate: (id: string | undefined, input: { name: string; description: string; design: CollectionPosterDesign }) =>
    request<CollectionPosterWorkspace>(id ? `/api/posters/collections/templates/${encodeURIComponent(id)}` : '/api/posters/collections/templates', { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) }),
  importAgregarrCollectionPosterTemplate: (file: File) => {
    const body = new FormData();
    body.append('template', file);
    return request<AgregarrImportResult<CollectionPosterWorkspace>>(
      '/api/posters/collections/templates/import/agregarr',
      { method: 'POST', body }
    );
  },
  duplicateCollectionPosterTemplate: (id: string) =>
    request<CollectionPosterWorkspace>(`/api/posters/collections/templates/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  setDefaultCollectionPosterTemplate: (id: string) =>
    request<CollectionPosterWorkspace>(`/api/posters/collections/templates/${encodeURIComponent(id)}/default`, { method: 'POST' }),
  deleteCollectionPosterTemplate: (id: string) =>
    request<CollectionPosterWorkspace>(`/api/posters/collections/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveCollectionPoster: (id: string | undefined, input: { name: string; description: string; design: CollectionPosterDesign }) =>
    request<CollectionPosterWorkspace>(id ? `/api/posters/collections/saved/${encodeURIComponent(id)}` : '/api/posters/collections/saved', { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) }),
  duplicateCollectionPoster: (id: string) =>
    request<CollectionPosterWorkspace>(`/api/posters/collections/saved/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  deleteCollectionPosters: (ids: readonly string[], force = false) =>
    request<{ workspace: CollectionPosterWorkspace; blocked: CollectionPosterWorkspace['savedPosters'] }>('/api/posters/collections/saved/delete', { method: 'POST', body: JSON.stringify({ ids, force }) }),
  onboarding: () => request<OnboardingState>('/api/onboarding'),
  authenticatedPrincipal: () =>
    request<AuthenticatedPrincipal>('/api/auth/me'),
  logout: () =>
    request<void>('/api/auth/logout', { method: 'POST' }),
  onboardingEvent: (
    expectedRevision: number,
    event: OnboardingEvent
  ) =>
    request<OnboardingState>('/api/onboarding/events', {
      method: 'POST',
      body: JSON.stringify({ expectedRevision, event }),
    }),
  beginPlexLogin: () =>
    request<PlexLoginAttempt>('/api/auth/plex/attempts', {
      method: 'POST',
    }),
  manualPlexLogin: (token: string) =>
    request<{ account: { id: string; username: string; title?: string } }>(
      '/api/auth/plex/manual',
      { method: 'POST', body: JSON.stringify({ token }) }
    ),
  pollPlexLogin: (attemptId: string) =>
    request<PlexLoginAttempt>(
      `/api/auth/plex/attempts/${encodeURIComponent(attemptId)}/poll`,
      { method: 'POST' }
    ),
  cancelPlexLogin: (attemptId: string) =>
    request<PlexLoginAttempt>(
      `/api/auth/plex/attempts/${encodeURIComponent(attemptId)}`,
      { method: 'DELETE' }
    ),
  plexConfiguration: () =>
    request<PlexServerConfiguration | undefined>(
      '/api/media-servers/plex'
    ),
  plexCandidates: () =>
    request<readonly PlexConnectionCandidate[]>(
      '/api/media-servers/plex/candidates'
    ),
  savePlexConfiguration: (
    expectedRevision: number,
    input: PlexConnectionInput,
    confirmMachineChange = false
  ) =>
    request<PlexServerConfiguration>('/api/media-servers/plex', {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision,
        input,
        confirmMachineChange,
      }),
    }),
  integration: (id: IntegrationId) =>
    request<IntegrationConfiguration | undefined>(
      `/api/integrations/${encodeURIComponent(id)}`
    ),
  fetchingPolicy: () =>
    request<{
      revision: number;
      letterboxdUsePlainHttp: boolean;
      flixpatrolUsePlainHttp: boolean;
    }>('/api/fetching-policy'),
  saveFetchingPolicy: (
    expectedRevision: number,
    letterboxdUsePlainHttp: boolean,
    flixpatrolUsePlainHttp: boolean
  ) =>
    request<{
      revision: number;
      letterboxdUsePlainHttp: boolean;
      flixpatrolUsePlainHttp: boolean;
    }>('/api/fetching-policy', {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision,
        letterboxdUsePlainHttp,
        flixpatrolUsePlainHttp,
      }),
    }),
  testIntegration: (draft: IntegrationDraft) =>
    request<{ verificationReceipt: string; expiresAt: string }>(
      '/api/integrations/test',
      { method: 'POST', body: JSON.stringify({ draft }) }
    ),
  saveIntegration: (
    expectedRevision: number,
    draft: IntegrationDraft,
    verificationReceipt: string
  ) =>
    request<IntegrationConfiguration>(
      `/api/integrations/${encodeURIComponent(draft.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision,
          draft,
          verificationReceipt,
        }),
      }
    ),
  disconnectIntegration: (id: IntegrationId, expectedRevision: number) =>
    request<void>(
      `/api/integrations/${encodeURIComponent(id)}?expectedRevision=${expectedRevision}`,
      { method: 'DELETE' }
    ),
  traktOAuthStatus: () =>
    request<{ connected: boolean; expiresAt?: string }>(
      '/api/integrations/trakt/oauth'
    ),
  beginTraktOAuth: (redirectUri: string) =>
    request<{ authorizeUrl: string; state: string; expiresAt: string }>(
      '/api/integrations/trakt/oauth/attempts',
      {
        method: 'POST',
        body: JSON.stringify({ redirectUri }),
      }
    ),
  exchangeTraktOAuth: (code: string, state: string) =>
    request<{ connected: boolean; expiresAt?: string }>(
      '/api/integrations/trakt/oauth/exchange',
      {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }
    ),
  disconnectTraktOAuth: () =>
    request<void>('/api/integrations/trakt/oauth', { method: 'DELETE' }),
  refreshTraktOAuth: (redirectUri: string) =>
    request<{ connected: boolean; expiresAt?: string }>(
      '/api/integrations/trakt/oauth/refresh',
      {
        method: 'POST',
        body: JSON.stringify({ redirectUri }),
      }
    ),
  downloadServices: (kind: ArrKind) =>
    request<readonly ArrConfigurationView[]>(
      `/api/download-services/${kind}`
    ),
  collectionArrServers: (kind: ArrKind) =>
    request<readonly { id: string; name: string; kind: ArrKind }[]>(
      `/api/collection-sources/arr/${kind}`
    ),
  collectionArrTags: (serverId: string) =>
    request<readonly { id: number; label: string }[]>(
      `/api/collection-sources/arr-server/${encodeURIComponent(serverId)}/tags`
    ),
  testDownloadService: (endpoint: ArrEndpointDraft) =>
    request<{ testReceipt: string; options: ArrProbeResult }>(
      '/api/download-services/test',
      { method: 'POST', body: JSON.stringify({ endpoint }) }
    ),
  saveDownloadService: (
    id: string | undefined,
    expectedRevision: number,
    endpoint: ArrEndpointDraft,
    selection: ArrSelection,
    testReceipt: string
  ) =>
    request<ArrConfigurationView>(
      `/api/download-services/${encodeURIComponent(id ?? 'new')}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision,
          endpoint,
          selection,
          testReceipt,
        }),
      }
    ),
  downloadServiceRemovalImpact: (id: string) =>
    request<{
      configuration: ArrConfigurationView;
      references: readonly string[];
    }>(`/api/download-services/${encodeURIComponent(id)}/removal-impact`),
  removeDownloadService: (
    id: string,
    expectedRevision: number,
    confirmed: boolean
  ) =>
    request<void>(`/api/download-services/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision, confirmed }),
    }),
  placeholders: () =>
    request<PlaceholderSettings>('/api/placeholders'),
  placeholderInventory: () =>
    request<PlaceholderInventory>('/api/placeholders/inventory'),
  savePlaceholders: (
    expectedRevision: number,
    libraryRoots: Readonly<Record<string, string>>,
    skipYoutubeTrailerDownloads: boolean
  ) =>
    request<PlaceholderSettings>('/api/placeholders', {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision,
        libraryRoots,
        skipYoutubeTrailerDownloads,
      }),
    }),
  directories: (path?: string) =>
    request<DirectoryListing>(
      `/api/directories${path ? `?path=${encodeURIComponent(path)}` : ''}`
    ),
  youtubeCookieStatus: () =>
    request<{
      state: 'missing' | 'ready' | 'present-but-disabled';
      fileName: string;
    }>('/api/youtube-cookie-status'),
  plexWebhookStatus: () =>
    request<PlexWebhookStatus>('/api/plex-webhook/status'),
  seerr: () =>
    request<SeerrConfigurationView | undefined>('/api/seerr'),
  seerrDestinationOptions: () =>
    request<SeerrProbeResult>('/api/seerr/options'),
  createSeerrDestinationTag: (
    kind: ArrKind,
    serverId: number,
    label: string
  ) =>
    request<{ id: number; label: string }>(`/api/seerr/tags/${kind}`, {
      method: 'POST',
      body: JSON.stringify({ serverId, label }),
    }),
  testSeerr: (endpoint: SeerrEndpointDraft) =>
    request<{ testReceipt: string; options: SeerrProbeResult }>(
      '/api/seerr/test',
      { method: 'POST', body: JSON.stringify({ endpoint }) }
    ),
  saveSeerr: (
    expectedRevision: number,
    endpoint: SeerrEndpointDraft,
    testReceipt: string,
    radarr: SeerrDestination,
    sonarr: SeerrDestination,
    userCreationMode: ServiceUserCreationMode
  ) =>
    request<SeerrConfigurationView>('/api/seerr', {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision,
        endpoint,
        testReceipt,
        radarr,
        sonarr,
        userCreationMode,
      }),
    }),
  seerrRemovalImpact: () =>
    request<{
      configuration: SeerrConfigurationView;
      consequences: readonly string[];
    }>('/api/seerr/removal-impact'),
  removeSeerr: (expectedRevision: number, confirmed: boolean) =>
    request<void>('/api/seerr', {
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision, confirmed }),
    }),
  watchlists: () => request<WatchlistSettings>('/api/watchlists'),
  watchlistOptions: (kind: ArrKind) =>
    request<WatchlistDestinationOptions>(`/api/watchlists/options/${kind}`),
  createWatchlistTag: (kind: ArrKind, serverId: string, label: string) =>
    request<{ id: number; label: string }>(`/api/watchlists/tags/${kind}`, {
      method: 'POST',
      body: JSON.stringify({ serverId, label }),
    }),
  saveWatchlists: (
    expectedRevision: number,
    enableOwner: boolean,
    enableUsers: boolean,
    radarr: WatchlistDestination,
    sonarr: WatchlistDestination
  ) =>
    request<WatchlistSettings>('/api/watchlists', {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision,
        enableOwner,
        enableUsers,
        radarr,
        sonarr,
      }),
    }),
};
