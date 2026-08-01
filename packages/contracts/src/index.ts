export type MediaKind = 'movie' | 'show' | 'season' | 'episode';

export interface MediaIdentity {
  kind: MediaKind;
  title: string;
  year?: number;
  ids: Partial<
    Record<
      | 'plex'
      | 'jellyfin'
      | 'tmdb'
      | 'tvdb'
      | 'imdb'
      | 'trakt'
      | 'anilist'
      | 'myanimelist'
      | 'radarr'
      | 'sonarr',
      string
    >
  >;
}

export type ChangeRisk = 'read-only' | 'reversible' | 'destructive';

export type ChangeOperation =
  | 'collection.create'
  | 'collection.update'
  | 'collection.delete'
  | 'collection.members.add'
  | 'collection.members.remove'
  | 'collection.members.reorder'
  | 'collection.visibility.update'
  | 'artwork.apply'
  | 'artwork.restore'
  | 'request.create'
  | 'placeholder.create'
  | 'placeholder.delete';

export interface PlannedChange {
  id: string;
  operation: ChangeOperation;
  risk: ChangeRisk;
  targetAdapterId: string;
  resourceKey: string;
  summary: string;
  input: Readonly<Record<string, unknown>>;
  inverse?: Omit<PlannedChange, 'inverse'>;
  dependsOn: readonly string[];
}

export interface ChangePlan {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  sourceSnapshotHash: string;
  targetSnapshotHash: string;
  policyHash: string;
  changes: readonly PlannedChange[];
  warnings: readonly string[];
}

export interface PlanExecution {
  planId: string;
  state:
    | 'queued'
    | 'running'
    | 'cancelling'
    | 'cancelled'
    | 'succeeded'
    | 'failed'
    | 'diverged';
  completedChangeIds: readonly string[];
  failedChangeId?: string;
  checkpointAt?: string;
}

export interface IntegrationHealth {
  adapterId: string;
  state: 'unknown' | 'healthy' | 'degraded' | 'unavailable';
  checkedAt: string;
  latencyMs?: number;
  message?: string;
}

export interface IntegrationAdapter {
  readonly id: string;
  health(signal?: AbortSignal): Promise<IntegrationHealth>;
}

export interface ChangeTargetAdapter extends IntegrationAdapter {
  apply(
    change: PlannedChange,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<void>;
  verify(change: PlannedChange, signal?: AbortSignal): Promise<boolean>;
}

export type UserRole = 'owner' | 'administrator' | 'operator' | 'viewer';

export interface AuthenticatedPrincipal {
  userId: string;
  role: UserRole;
  mediaServerScopes: readonly string[];
  sessionId: string;
}

export interface RoutePolicy {
  authentication: 'public' | 'anonymous-only' | 'authenticated';
  roles?: readonly UserRole[];
  onboarding: 'any' | 'incomplete-only' | 'activated-only';
}

export type DashboardJobKind = 'collections' | 'overlays';
export type DashboardJobPhase =
  | 'idle'
  | 'queued'
  | 'setup'
  | 'processing'
  | 'cleanup'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'failed';

export interface DashboardJobOutcome {
  id: string;
  name: string;
  sourceType: string;
  outcome: 'success' | 'error' | 'skipped';
  durationMs: number;
  errorMessage?: string;
}

export interface DashboardJobStatus {
  kind: DashboardJobKind;
  runId?: string;
  phase: DashboardJobPhase;
  phaseLabel: string;
  progressPercent: number;
  processedItems: number;
  totalItems: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  createdCount: number;
  currentItem?: { id: string; name: string; sourceType: string };
  recentOutcomes: readonly DashboardJobOutcome[];
  startedAt?: string;
  completedAt?: string;
  runningForSeconds: number;
  estimatedSecondsRemaining?: number;
  message?: string;
}

export interface DashboardSummary {
  collections: {
    managed: number;
    preExisting: number;
    total: number;
  };
  activity?: {
    totalPlays: number;
    collectionPlays: number;
    moviePlays: number;
    showPlays: number;
  };
  tautulliConnected: boolean;
  timestamp: string;
}

export interface DashboardCollectionStatistic {
  ratingKey: string;
  title: string;
  mediaType: 'movie' | 'show';
  itemCount: number;
  totalPlays: number;
  totalDurationSeconds: number;
  viewerCount: number;
}

export interface DashboardMissingItem {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'show';
  title: string;
  year?: number;
  posterPath?: string;
  collectionName: string;
  collectionSource: string;
  requestService: string;
  requestMethod: 'auto' | 'manual';
  requestStatus:
    | 'pending'
    | 'approved'
    | 'declined'
    | 'available'
    | 'processing'
    | 'failed'
    | 'partially-available';
  createdAt: string;
}

export type CollectionMediaType = 'movie' | 'show';
export type CollectionItemType = 'movie' | 'show' | 'season' | 'episode';
export type CollectionSourceType =
  | 'seerr'
  | 'trakt'
  | 'tmdb'
  | 'imdb'
  | 'letterboxd'
  | 'mdblist'
  | 'mal'
  | 'anilist'
  | 'tautulli'
  | 'plex'
  | 'networks'
  | 'originals'
  | 'radarrtag'
  | 'sonarrtag'
  | 'comingsoon'
  | 'filtered-hub'
  | 'multi-source'
  | 'manual';

export interface CollectionSourceSettings {
  subtype: string;
  seerrUserId?: number;
  customUrl?: string;
  randomListUrls?: readonly string[];
  timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all';
  maxItems: number;
  itemOrder:
    | 'default'
    | 'reverse'
    | 'random'
    | 'rating-desc'
    | 'rating-asc'
    | 'release-desc'
    | 'release-asc'
    | 'alphabetical';
  minimumPlays?: number;
  customDays?: number;
  arrServerId?: string;
  arrTagId?: number;
  region?: string;
  networkCountry?: string;
  personMinimumItems?: number;
  useSeparator?: boolean;
  separatorTitle?: string;
  generatedPersonCollections?: readonly PlexGeneratedCollectionReference[];
  plexGenerator?: PlexLibraryGeneratorSettings;
  manualMembers?: readonly {
    ratingKey: string;
    title: string;
    year?: number;
    type?: CollectionItemType;
    parentRatingKey?: string;
    grandparentRatingKey?: string;
    seasonNumber?: number;
    episodeNumber?: number;
  }[];
}

export type PlexLibraryGeneratorSubtype =
  | 'genres'
  | 'decades'
  | 'resolutions'
  | 'content-ratings';

export type PlexContentRatingGroup =
  | 'australia'
  | 'television'
  | 'numeric'
  | 'other';

export interface PlexLibraryGeneratorValue {
  value: string;
  label: string;
  count: number;
  group?: PlexContentRatingGroup;
}

export interface PlexGeneratedCollectionReference {
  value: string;
  title: string;
  ratingKey: string;
}

export interface PlexLibraryGeneratorSettings {
  selectionMode: 'include' | 'exclude';
  selectedValues: readonly string[];
  enabledRatingGroups: readonly PlexContentRatingGroup[];
  titleTemplate: string;
  cleanupMissing: boolean;
  generatedCollections?: readonly PlexGeneratedCollectionReference[];
}

export interface CollectionPosterSettings {
  autoGenerate: boolean;
  templateId?: string;
  applyOverlaysDuringSync: boolean;
  useTmdbFranchisePoster: boolean;
  hideIndividualItems: boolean;
  customPoster?: {
    kind: 'saved' | 'upload';
    id: string;
    name: string;
    previewDataUrl?: string;
  };
}

export interface CollectionVisibilitySettings {
  usersHome: boolean;
  serverOwnerHome: boolean;
  libraryRecommended: boolean;
}

export interface CollectionBehaviorSettings {
  visibility: CollectionVisibilitySettings;
  excludedTitles?: readonly string[];
  mutuallyExclusiveCollectionIds?: readonly string[];
  randomizeHomeOrder: boolean;
  showUnwatchedOnly: boolean;
  smartCollectionSort:
    | 'titleAsc'
    | 'titleDesc'
    | 'yearAsc'
    | 'yearDesc'
    | 'ratingAsc'
    | 'ratingDesc'
    | 'addedAsc'
    | 'addedDesc';
  timeRestriction: {
    alwaysActive: boolean;
    removeFromPlexWhenInactive: boolean;
    inactiveVisibility: CollectionVisibilitySettings;
    dateRanges: readonly { startDate: string; endDate: string }[];
    weeklySchedule: Readonly<
      Record<
        | 'monday'
        | 'tuesday'
        | 'wednesday'
        | 'thursday'
        | 'friday'
        | 'saturday'
        | 'sunday',
        boolean
      >
    >;
  };
  syncSchedule: {
    enabled: boolean;
    scheduleType: 'preset' | 'custom';
    preset: '1h' | '3h' | '6h' | '12h' | '1d' | '3d' | '7d';
    customCron: string;
    startNow: boolean;
    startDate: string;
    startTime: string;
  };
}

export interface CollectionFilterGroup {
  mode: 'include' | 'exclude';
  values: readonly string[];
}

export interface CollectionContentFilters {
  maximumPosition: number;
  minimumYear: number;
  minimumImdbRating: number;
  minimumRottenTomatoesRating: number;
  minimumRottenTomatoesAudienceRating: number;
  genres: CollectionFilterGroup;
  countries: CollectionFilterGroup;
  languages: CollectionFilterGroup;
  keywords: CollectionFilterGroup;
}

export type CollectionSonarrMonitorType =
  | 'all'
  | 'future'
  | 'missing'
  | 'existing'
  | 'pilot'
  | 'firstSeason'
  | 'latestSeason'
  | 'none';

export interface CollectionArrDestination {
  serverId?: string;
  profileId?: number;
  rootFolder?: string;
  tagIds: readonly number[];
  monitor: boolean;
  monitorType: CollectionSonarrMonitorType;
  searchOnAdd: boolean;
}

export interface CollectionSeerrDestination {
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  tagIds: readonly number[];
}

export interface CollectionMissingMediaSettings {
  enabled: boolean;
  downloadMode: 'seerr' | 'direct';
  searchMissingMovies: boolean;
  searchMissingTv: boolean;
  autoApproveMovies: boolean;
  autoApproveTv: boolean;
  maxSeasonsToRequest: number;
  seasonsPerShowLimit: number;
  seasonGrabOrder: 'first' | 'latest' | 'airing';
  createPlaceholders: boolean;
  placeholderDaysAhead: number;
  includeAllReleasedItems: boolean;
  placeholderReleasedDays: number;
  directRadarr: CollectionArrDestination;
  directSonarr: CollectionArrDestination;
  seerrRadarr: CollectionSeerrDestination;
  seerrSonarr: CollectionSeerrDestination;
  requestFilters: CollectionContentFilters;
  placeholderFilters: CollectionContentFilters;
}

export interface CollectionMultiSourceEntry {
  id: string;
  type: Exclude<
    CollectionSourceType,
    'manual' | 'multi-source' | 'filtered-hub' | 'plex'
  >;
  subtype: string;
  priority: number;
  customUrl?: string;
  timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all';
  customDays?: number;
  minimumPlays?: number;
  networkCountry?: string;
  validation?: {
    state: 'unvalidated' | 'valid' | 'invalid';
    title?: string;
    contentType?: 'movie' | 'show' | 'mixed';
    message?: string;
  };
}

export interface CollectionMultiSourceSettings {
  combineMode: 'interleaved' | 'list-order' | 'randomized' | 'cycle-lists';
  sources: readonly CollectionMultiSourceEntry[];
}

export interface CollectionAssetReference {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  previewDataUrl: string;
}

export interface CollectionMetadataSettings {
  enableCustomSummary: boolean;
  customSummary: string;
  enableCustomWallpaper: boolean;
  wallpaper?: CollectionAssetReference;
  enableCustomTheme: boolean;
  theme?: CollectionAssetReference;
}

export interface TmdbDiscoverRule {
  id: string;
  field: string;
  operator: 'and' | 'or';
  value: string | number | boolean;
}

export interface TmdbDiscoverSettings {
  movieSortBy: string;
  tvSortBy: string;
  filterGroups: readonly {
    id: string;
    operator: 'and' | 'or' | 'not';
    filters: readonly TmdbDiscoverRule[];
  }[];
}

export interface ManagedCollection {
  id: string;
  title: string;
  description: string;
  mediaType: CollectionMediaType;
  itemType?: CollectionItemType;
  libraryId: string;
  libraryName: string;
  sourceType: CollectionSourceType;
  sourceSettings?: CollectionSourceSettings;
  itemCount: number;
  homeVisible: boolean;
  recommendedVisible: boolean;
  libraryVisible: boolean;
  sharedOrder: number;
  libraryOrder: number;
  status: 'ready' | 'needs-sync' | 'syncing' | 'error';
  lastSyncedAt?: string;
  plexRatingKey?: string;
  posterSettings?: CollectionPosterSettings;
  behaviorSettings?: CollectionBehaviorSettings;
  isActive?: boolean;
  missingMediaSettings?: CollectionMissingMediaSettings;
  multiSourceSettings?: CollectionMultiSourceSettings;
  metadataSettings?: CollectionMetadataSettings;
  tmdbDiscoverSettings?: TmdbDiscoverSettings;
  linkGroupId?: string;
  isLinked?: boolean;
  isUnlinked?: boolean;
}

export interface CollectionLinkResult {
  groupId: string;
  collections: readonly ManagedCollection[];
}

export interface CollectionPreviewResult {
  collectionId: string;
  sourceType: CollectionSourceType;
  fetchedCount: number;
  matchedCount: number;
  missingCount: number;
  items: readonly {
    title: string;
    year?: number;
    tmdbId?: number;
    tvdbId?: number;
    plexRatingKey?: string;
    available: boolean;
  }[];
  warnings: readonly string[];
}

export type PlexDiscoveredItemKind = 'default-hub' | 'pre-existing-collection';

export interface PlexDiscoveredItem {
  id: string;
  kind: PlexDiscoveredItemKind;
  plexKey: string;
  name: string;
  libraryId: string;
  libraryName: string;
  mediaType: CollectionMediaType;
  titleSort?: string;
  homeOrder: number;
  libraryOrder: number;
  visibility: CollectionVisibilitySettings;
  missing: boolean;
  isLinked: boolean;
  isUnlinked: boolean;
  linkGroupId?: string;
  lastValidatedAt: string;
  timeRestriction: CollectionBehaviorSettings['timeRestriction'];
  posterSettings?: CollectionPosterSettings;
  metadataSettings?: CollectionMetadataSettings;
}

export interface PlexDiscoveryStatus {
  enabled: boolean;
  plexConnected: boolean;
  running: boolean;
  libraryCount: number;
  capabilities: {
    hubReordering: boolean;
    visibilityControl: boolean;
    builtInHubManagement: boolean;
    collectionHubManagement: boolean;
  };
}

export interface PlexDiscoveryResult {
  imported: readonly PlexDiscoveredItem[];
  totalHubs: number;
  totalPreExistingCollections: number;
  validated: number;
  missingIds: readonly string[];
  completedAt: string;
  warnings?: readonly string[];
}

export interface PlexMissingCleanupResult {
  cleanupCount: number;
  plexHubDeleteCount: number;
  warnings: readonly string[];
}

export interface PlexDiscoveredLinkResult {
  groupId: string;
  items: readonly PlexDiscoveredItem[];
}

export interface PlexDiscoveredItemDraft {
  homeOrder: number;
  libraryOrder: number;
  visibility: CollectionVisibilitySettings;
  titleSort?: string;
  timeRestriction: CollectionBehaviorSettings['timeRestriction'];
  posterSettings?: CollectionPosterSettings;
  metadataSettings?: CollectionMetadataSettings;
}

export interface CollectionLibrary {
  id: string;
  name: string;
  mediaType: CollectionMediaType;
  collectionCount: number;
}

export interface CollectionSurface {
  libraries: readonly CollectionLibrary[];
  collections: readonly ManagedCollection[];
  timestamp: string;
  discoveredPlexItems?: readonly PlexDiscoveredItem[];
  discoveryStatus?: PlexDiscoveryStatus;
}

export interface CollectionDraft {
  title: string;
  description: string;
  mediaType: CollectionMediaType;
  itemType?: CollectionItemType;
  libraryId: string;
  sourceType: CollectionSourceType;
  sourceSettings: CollectionSourceSettings;
  posterSettings: CollectionPosterSettings;
  behaviorSettings: CollectionBehaviorSettings;
  missingMediaSettings: CollectionMissingMediaSettings;
  multiSourceSettings: CollectionMultiSourceSettings;
  metadataSettings: CollectionMetadataSettings;
  tmdbDiscoverSettings: TmdbDiscoverSettings;
}

export interface GeneralSettings {
  revision: number;
  applicationTitle: string;
  applicationUrl: string;
  locale: string;
  cacheImages: boolean;
  imageCacheDays: number;
  globalExcludedTitles: readonly string[];
  apiKeyPreview: string;
  /** Present only once, immediately after rotating the API key. */
  issuedApiKey?: string;
  cacheItemCount: number;
  cacheSizeBytes: number;
  updatedAt: string;
}

export type GeneralSettingsDraft = Pick<
  GeneralSettings,
  | 'applicationTitle'
  | 'applicationUrl'
  | 'locale'
  | 'cacheImages'
  | 'imageCacheDays'
> & { globalExcludedTitles?: readonly string[] };

export interface ApplicationLogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  label?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface ApplicationLogPage {
  results: readonly ApplicationLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  appDataPath: string;
  timestamp: string;
}

export interface BackgroundJob {
  id: string;
  name: string;
  type: 'process' | 'command';
  interval: 'seconds' | 'minutes' | 'hours' | 'fixed';
  cronSchedule: string;
  nextExecutionTime: string;
  followingExecutionTime?: string;
  running: boolean;
  startedAt?: string;
  lastCompletedAt?: string;
  lastOutcome?: 'success' | 'failed' | 'cancelled';
  lastMessage?: string;
}

export interface CacheStatistic {
  id: string;
  name: string;
  hits: number;
  misses: number;
  keys: number;
  keySizeBytes: number;
  valueSizeBytes: number;
}

export interface AboutInformation {
  version: string;
  build: string;
  commit: string;
  updateAvailable: boolean;
  updateCheckAvailable?: boolean;
  latestVersion: string;
  restartRequired: boolean;
  nodeVersion: string;
  platform: string;
  architecture: string;
  timezone: string;
  appDataPath: string;
  uptimeSeconds: number;
  documentationUrl?: string;
  issueUrl?: string;
  sourceUrl?: string;
  license: string;
}

export type PosterSource = 'plex' | 'local' | 'tmdb';
export type PosterLibraryType = 'movie' | 'show';

export interface PosterSourceSettings {
  revision: number;
  source: PosterSource;
  localRoot: string;
  updatedAt: string;
}

export interface OverlayTemplateSummary {
  id: string;
  name: string;
  description: string;
  type: string;
  tags: readonly string[];
  enabled: boolean;
  displayOrder: number;
  elementCount: number;
  conditionSummary: string;
  accent: string;
  design: OverlayTemplateDesign;
  condition?: OverlayApplicationCondition;
}

export type OverlayLayerType =
  | 'text'
  | 'tile'
  | 'variable'
  | 'raster'
  | 'svg'
  | 'icon'
  | 'shape'
  | 'mapped-icon';
export interface OverlayShape {
  id: string;
  label: string;
  category: string;
  path: string;
}
export const overlayShapes: readonly OverlayShape[] = [
  { id:'plate', label:'Plate', category:'Foundations', path:'M8 10H112V62H8Z' },
  { id:'soft-plate', label:'Soft plate', category:'Foundations', path:'M18 8H102Q114 8 114 20V52Q114 64 102 64H18Q6 64 6 52V20Q6 8 18 8Z' },
  { id:'capsule', label:'Capsule', category:'Foundations', path:'M28 8H92A28 28 0 010 56H28A28 28 0 010 8Z' },
  { id:'ticket', label:'Ticket', category:'Foundations', path:'M8 8H112V24A12 12 0 000 48V64H8V48A12 12 0 000 24Z' },
  { id:'chamfer', label:'Chamfer', category:'Foundations', path:'M18 8H102L114 20V52L102 64H18L6 52V20Z' },
  { id:'cut-corners', label:'Cut corners', category:'Foundations', path:'M20 8H100L114 22V50L100 64H20L6 50V22Z' },
  { id:'stepped', label:'Stepped', category:'Foundations', path:'M6 18H28V8H92V18H114V54H92V64H28V54H6Z' },
  { id:'circle', label:'Circle', category:'Badges', path:'M60 4A32 32 0 1160 68A32 32 0 1160 4Z' },
  { id:'oval', label:'Oval', category:'Badges', path:'M60 8C94 8 114 19 114 36S94 64 60 64 6 53 6 36 26 8 60 8Z' },
  { id:'diamond', label:'Diamond', category:'Badges', path:'M60 3L116 36 60 69 4 36Z' },
  { id:'hex', label:'Hex badge', category:'Badges', path:'M26 5H94L117 36 94 67H26L3 36Z' },
  { id:'octagon', label:'Octagon', category:'Badges', path:'M28 4H92L116 26V46L92 68H28L4 46V26Z' },
  { id:'shield', label:'Shield', category:'Badges', path:'M60 3L108 17V37C108 54 90 64 60 70 30 64 12 54 12 37V17Z' },
  { id:'seal', label:'Seal', category:'Badges', path:'M60 3L70 12 84 7 90 20 105 19 103 34 117 42 106 53 110 68 94 67 84 71 72 64 60 71 48 64 36 71 26 67 10 68 14 53 3 42 17 34 15 19 30 20 36 7 50 12Z' },
  { id:'ribbon', label:'Ribbon', category:'Editorial', path:'M5 17H33V10H88V17H115L101 36 115 55H87V62H32V55H5L19 36Z' },
  { id:'banner', label:'Folded banner', category:'Editorial', path:'M7 9H96V21L116 34 96 47V63H7L24 36Z' },
  { id:'swallowtail', label:'Swallowtail', category:'Editorial', path:'M3 7H117L100 36 117 65H3L21 36Z' },
  { id:'pennant', label:'Pennant', category:'Editorial', path:'M5 6L117 36 5 66Z' },
  { id:'chevron', label:'Chevron', category:'Editorial', path:'M4 7H76L117 36 76 65H4L43 36Z' },
  { id:'lower-third', label:'Lower third', category:'Editorial', path:'M4 21H72L85 34H117V66H4ZM4 6H55L70 21H4Z' },
  { id:'open-corners', label:'Open corners', category:'Frames', path:'M34 4H4V31H11V11H34ZM86 4H116V31H109V11H86ZM116 41V68H86V61H109V41ZM34 68H4V41H11V61H34Z' },
  { id:'brackets', label:'Brackets', category:'Frames', path:'M34 4H10V68H34V61H17V11H34ZM86 4H110V68H86V61H103V11H86Z' },
  { id:'double-frame', label:'Double frame', category:'Frames', path:'M3 3H117V69H3ZM10 10V62H110V10ZM18 17H102V55H18ZM25 24V48H95V24Z' },
  { id:'focus', label:'Focus reticle', category:'Frames', path:'M57 2H63V18H57ZM57 54H63V70H57ZM2 33H22V39H2ZM98 33H118V39H98ZM60 15A21 21 0 1160 57A21 21 0 1160 15ZM60 22A14 14 0 1060 50A14 14 0 1060 22Z' },
  { id:'film-strip', label:'Film strip', category:'Cinema', path:'M3 6H117V66H3ZM11 18V54H109V18ZM16 8H25V15H16ZM36 8H45V15H36ZM56 8H65V15H56ZM76 8H85V15H76ZM96 8H105V15H96ZM16 57H25V64H16ZM36 57H45V64H36ZM56 57H65V64H56ZM76 57H85V64H76ZM96 57H105V64H96Z' },
  { id:'screen', label:'Cinema screen', category:'Cinema', path:'M12 5H108V59H64V67H84V71H36V67H56V59H12ZM19 12V52H101V12Z' },
  { id:'clapper', label:'Clapper', category:'Cinema', path:'M7 21H113V67H7ZM7 4H113V19H7ZM16 6L30 17H41L27 6ZM48 6L62 17H73L59 6ZM80 6L94 17H105L91 6Z' },
  { id:'play', label:'Play lens', category:'Cinema', path:'M60 2A34 34 0 1160 70A34 34 0 1160 2ZM48 18V54L84 36Z' },
  { id:'blob', label:'Soft blob', category:'Organic', path:'M12 39C2 16 27 1 49 12 70-3 107 7 111 29 123 49 99 70 77 62 57 73 32 66 26 54 17 56 14 48 12 39Z' },
  { id:'wave', label:'Wave panel', category:'Organic', path:'M3 15C28-2 43 31 66 15 85 2 103 6 117 14V60C95 71 82 41 58 58 38 71 18 66 3 56Z' },
  { id:'cloud', label:'Cloud', category:'Organic', path:'M17 63A20 20 0 0118 22 27 27 0 0169 15 21 21 0 01102 28 17 17 0 01100 63Z' },
  { id:'speech', label:'Speech bubble', category:'Organic', path:'M4 4H116V59H55L27 71 35 59H4Z' },
  { id:'droplet', label:'Droplet', category:'Organic', path:'M60 1C82 28 97 42 97 53A37 37 0 0123 53C23 42 38 28 60 1Z' },
  { id:'arch', label:'Arch', category:'Organic', path:'M9 70V36C9 12 30 1 60 1S111 12 111 36V70Z' },
  { id:'data-panel', label:'Data panel', category:'Tech', path:'M4 6H92L118 32V66H28L4 42Z' },
  { id:'angular-hud', label:'Angular HUD', category:'Tech', path:'M3 5H43V12H10V28H3ZM77 5H117V28H110V12H77ZM117 44V67H77V60H110V44ZM43 67H3V44H10V60H43ZM48 16H72L88 36 72 56H48L32 36Z' },
  { id:'step-track', label:'Step track', category:'Status', path:'M3 52H31V41H58V30H86V19H117V68H3Z' },
  { id:'priority', label:'Priority burst', category:'Status', path:'M60 1L72 22 98 12 88 38 117 46 88 55 94 71 66 59 60 72 52 59 24 71 32 55 3 46 33 38 22 12 48 22Z' },
  { id:'pin', label:'Milestone pin', category:'Status', path:'M60 1A28 28 0 0188 29C88 50 60 72 60 72S32 50 32 29A28 28 0 0160 1ZM60 17A12 12 0 1060 41A12 12 0 1060 17Z' },
  { id:'inset-plate', label:'Inset plate', category:'Foundations', path:'M4 5H116V67H4ZM13 14V58H107V14Z' },
  { id:'offset-plate', label:'Offset plate', category:'Foundations', path:'M3 18H99L117 36V68H21L3 50ZM21 4H117V14H21Z' },
  { id:'split-plate', label:'Split plate', category:'Foundations', path:'M4 6H55V66H4ZM65 6H116V66H65Z' },
  { id:'notched-plate', label:'Notched plate', category:'Foundations', path:'M4 7H47L60 18 73 7H116V65H73L60 54 47 65H4Z' },
  { id:'side-notches', label:'Side notches', category:'Foundations', path:'M4 6H116V25L103 36 116 47V66H4V47L17 36 4 25Z' },
  { id:'top-tab', label:'Top tab', category:'Foundations', path:'M4 17H36L45 5H91L100 17H116V66H4Z' },
  { id:'bottom-tab', label:'Bottom tab', category:'Foundations', path:'M4 6H116V55H85L76 67H44L35 55H4Z' },
  { id:'slant-plate', label:'Slant plate', category:'Foundations', path:'M20 4H117L100 68H3Z' },
  { id:'crest', label:'Crest', category:'Badges', path:'M12 5H108V39C108 56 89 66 60 72 31 66 12 56 12 39Z' },
  { id:'medallion', label:'Medallion', category:'Badges', path:'M60 2A27 27 0 1160 56A27 27 0 1160 2ZM42 50L49 72 60 61 71 72 78 50Z' },
  { id:'notched-coin', label:'Notched coin', category:'Badges', path:'M60 3L71 12 85 8 91 21 106 24 103 39 112 50 100 60 85 59 74 69 60 62 46 69 35 59 20 60 8 50 17 39 14 24 29 21 35 8 49 12Z' },
  { id:'shield-wide', label:'Wide shield', category:'Badges', path:'M5 8H115V35C115 53 95 64 60 71 25 64 5 53 5 35Z' },
  { id:'shield-point', label:'Point shield', category:'Badges', path:'M60 2L112 16 104 52 60 71 16 52 8 16Z' },
  { id:'star-badge', label:'Star badge', category:'Badges', path:'M60 1L72 24 98 13 87 39 116 46 87 54 96 71 68 60 60 72 52 60 24 71 33 54 4 46 33 39 22 13 48 24Z' },
  { id:'flag', label:'Flag', category:'Editorial', path:'M8 2H15V70H8ZM16 7H113L98 23 113 40H16Z' },
  { id:'vertical-label', label:'Vertical label', category:'Editorial', path:'M36 2H84V58L60 71 36 58Z' },
  { id:'corner-sash', label:'Corner sash', category:'Editorial', path:'M2 2H72L118 48V70H96L2 24Z' },
  { id:'double-chevron', label:'Double chevron', category:'Editorial', path:'M2 5H47L77 36 47 67H2L32 36ZM61 5H90L120 36 90 67H61L91 36Z' },
  { id:'arrow-right', label:'Arrow right', category:'Arrows', path:'M3 20H76V4L117 36 76 68V52H3Z' },
  { id:'arrow-left', label:'Arrow left', category:'Arrows', path:'M117 20H44V4L3 36 44 68V52H117Z' },
  { id:'arrow-up', label:'Arrow up', category:'Arrows', path:'M44 69V29H23L60 2 97 29H76V69Z' },
  { id:'arrow-down', label:'Arrow down', category:'Arrows', path:'M44 3V43H23L60 70 97 43H76V3Z' },
  { id:'arrow-split', label:'Split arrow', category:'Arrows', path:'M4 31H50V15H35L60 2 85 15H70V31H116V41H70V57H85L60 70 35 57H50V41H4Z' },
  { id:'arrow-cycle', label:'Cycle arrows', category:'Arrows', path:'M13 32A48 27 0 0194 14L82 4H112V33L101 23A39 20 0 0023 36ZM107 40A48 27 0 0126 58L38 68H8V39L19 49A39 20 0 0097 36Z' },
  { id:'crop-marks', label:'Crop marks', category:'Frames', path:'M4 4H35V11H11V31H4ZM85 4H116V31H109V11H85ZM116 41V68H85V61H109V41ZM35 68H4V41H11V61H35Z' },
  { id:'split-brackets', label:'Split brackets', category:'Frames', path:'M3 27V4H47V11H10V27ZM73 4H117V27H110V11H73ZM117 45V68H73V61H110V45ZM47 68H3V45H10V61H47Z' },
  { id:'inset-corners', label:'Inset corners', category:'Frames', path:'M34 14H20V29H27V21H34ZM86 14H100V29H93V21H86ZM100 43V58H86V51H93V43ZM34 58H20V43H27V51H34Z' },
  { id:'target-box', label:'Target box', category:'Frames', path:'M22 8H98V64H22ZM29 15V57H91V15ZM57 1H63V22H57ZM57 50H63V71H57ZM2 33H36V39H2ZM84 33H118V39H84Z' },
  { id:'marquee', label:'Marquee', category:'Cinema', path:'M4 4H116V68H4ZM12 12V60H108V12ZM18 18H102V25H18ZM18 47H102V54H18Z' },
  { id:'spotlight', label:'Spotlight beam', category:'Cinema', path:'M10 14L37 7 117 60 27 67Z' },
  { id:'trailer-card', label:'Trailer card', category:'Cinema', path:'M4 4H116V68H4ZM12 12V60H108V12ZM48 18V54L86 36Z' },
  { id:'countdown-wedge', label:'Countdown wedge', category:'Cinema', path:'M60 2A34 34 0 1160 70A34 34 0 1160 2ZM60 36V2A34 34 0 0189 54Z' },
  { id:'leaf', label:'Leaf', category:'Organic', path:'M2 66C12 20 50 0 118 7 106 54 77 73 2 66Z' },
  { id:'petal', label:'Petal badge', category:'Organic', path:'M60 2C74 12 80 23 78 34 90 31 103 36 113 49 99 67 81 72 60 62 39 72 21 67 7 49 17 36 30 31 42 34 40 23 46 12 60 2Z' },
  { id:'scallop', label:'Scallop panel', category:'Organic', path:'M3 68V27A12 12 0 0127 27 12 12 0 0151 27 12 12 0 0175 27 12 12 0 0199 27 12 12 0 01123 27V68Z' },
  { id:'thought', label:'Thought bubble', category:'Organic', path:'M17 52C3 25 29 5 51 15 64 0 91 8 94 24 117 22 124 53 102 63H29C17 63 10 57 17 52ZM28 68A5 4 0 1128 60A5 4 0 1128 68Z' },
  { id:'circuit-card', label:'Circuit card', category:'Tech', path:'M4 5H116V67H4ZM12 22H38L47 31H74L83 22H108V28H86L77 37H44L35 28H12ZM12 48H31L41 39H79L89 48H108V54H86L76 45H44L34 54H12Z' },
  { id:'radar', label:'Radar', category:'Tech', path:'M60 2A34 34 0 1160 70A34 34 0 1160 2ZM57 7H63V65H57ZM31 33H89V39H31ZM60 36L89 14 93 19Z' },
  { id:'waveform', label:'Waveform rail', category:'Tech', path:'M3 4H117V68H3ZM9 39H25L31 15 40 60 50 23 61 50 72 17 83 58 91 35H111V41H96L81 66 71 31 61 62 51 38 39 70 30 33 27 45H9Z' },
  { id:'stacked-data', label:'Stacked data', category:'Tech', path:'M14 3H106V22H14ZM6 27H114V47H6ZM21 52H99V69H21Z' },
  { id:'progress-ring', label:'Progress ring', category:'Status', path:'M60 2A34 34 0 110 36H8A26 26 0 1060 10ZM60 2A34 34 0 0193 28L85 30A26 26 0 0060 10Z' },
  { id:'half-gauge', label:'Half gauge', category:'Status', path:'M12 62A48 48 0 01108 62H99A39 39 0 0021 62ZM57 62L86 26 64 66Z' },
  { id:'segmented-bar', label:'Segmented bar', category:'Status', path:'M3 24H24V48H3ZM27 24H48V48H27ZM51 24H72V48H51ZM75 24H96V48H75ZM99 24H117V48H99Z' },
  { id:'timeline', label:'Timeline rail', category:'Status', path:'M4 33H116V39H4ZM24 25A11 11 0 1124 47A11 11 0 1124 25ZM60 25A11 11 0 1160 47A11 11 0 1160 25ZM96 25A11 11 0 1196 47A11 11 0 1196 25Z' },
];
export const overlayShapeById = (id: string): OverlayShape =>
  overlayShapes.find((shape) => shape.id === id) ?? overlayShapes[0]!;
export interface OverlayVariableSegment {
  type: 'text' | 'variable';
  value?: string;
  field?: string;
  format?: string;
}
export interface OverlayIconMapping {
  value: string;
  iconPath: string;
}
export interface DynamicValueIcon {
  id: string;
  label: string;
  fields: readonly string[];
  path: string;
  category?: 'General' | 'Media' | 'Formats' | 'Audio' | 'Availability' | 'Lifecycle' | 'Streaming';
  /** Trusted, bundled layered SVG markup using main, soft, and accent roles. */
  svgBody?: string;
}
const streamingServiceIcon = (
  id: string,
  label: string,
  mark: string,
  brand?:Pick<SimpleIcon,'path'|'hex'>
): DynamicValueIcon => ({
  id: `streaming-${id}`,
  label,
  category: 'Streaming',
  fields: ['streamingProvider'],
  path: 'M3 5h18v14H3z',
  svgBody: brand?`<path fill="#${brand.hex==='000000'?'FFFFFF':brand.hex}" d="${brand.path}"/>`:`<rect class="soft" x="2.5" y="4.5" width="19" height="15" rx="3"/><text class="accent" x="12" y="12.4" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${mark.length > 4 ? 4.2 : mark.length > 2 ? 5.5 : 8}" font-weight="700">${mark}</text>`,
});
export const streamingServiceIcons: readonly DynamicValueIcon[] = [
  streamingServiceIcon('netflix', 'Netflix', 'N',siNetflix),
  streamingServiceIcon('prime-video', 'Prime Video', 'prime',siPrimevideo),
  streamingServiceIcon('hulu', 'Hulu', 'hulu',siHulu),
  streamingServiceIcon('max', 'Max', 'max',siMax),
  streamingServiceIcon('apple-tv-plus', 'Apple TV+', 'tv+',siAppletv),
  streamingServiceIcon('paramount-plus', 'Paramount+', 'P+',siParamountplus),
  streamingServiceIcon('youtube', 'YouTube', 'YT',siYoutube),
  streamingServiceIcon('youtube-tv', 'YouTube TV', 'YTTV',siYoutubetv),
  streamingServiceIcon('tubi', 'Tubi', 'tubi',siTubi),
  streamingServiceIcon('roku-channel', 'The Roku Channel', 'ROKU',siRoku),
  streamingServiceIcon('crunchyroll', 'Crunchyroll', 'CR',siCrunchyroll),
  streamingServiceIcon('fubo', 'Fubo', 'FUBO',siFubo),
  streamingServiceIcon('starz', 'Starz', 'STARZ',siStarz),
  streamingServiceIcon('showtime', 'Showtime', 'SHO',siShowtime),
  streamingServiceIcon('mubi', 'MUBI', 'MUBI',siMubi),
  streamingServiceIcon('plex', 'Plex', 'PLEX',siPlex),
  streamingServiceIcon('dazn', 'DAZN', 'DAZN',siDazn),
  streamingServiceIcon('itvx', 'ITVX', 'ITVX',siItvx),
  streamingServiceIcon('channel-4', 'Channel 4', '4',siChannel4),
  streamingServiceIcon('sky-go', 'Sky Go', 'SKY',siSky),
];
export const dynamicValueIcons: readonly DynamicValueIcon[] = [
  ...streamingServiceIcons,
  { id:'concept-placeholder', label:'Trailer placeholder', category:'Availability', fields:['isPlaceholder'], path:'M4 5h16v14H4z M10 9l5 3-5 3z', svgBody:'<rect class="soft" x="4" y="5" width="16" height="14" rx="2"/><path class="main" d="M10 9l5 3-5 3z"/><circle class="accent" cx="19" cy="5" r="2"/>' },
  { id:'concept-requested', label:'Requested', category:'Availability', fields:[], path:'M4 7h16v12H4z M8 7V4h8v3 M8 13h8', svgBody:'<path class="main" d="M4 7h16v12H4zM8 7V4h8v3M8 13h8"/><path class="accent" d="M12 9l1 2 2 .3-1.5 1.5.4 2.2-1.9-1-1.9 1 .4-2.2L9 11.3l2-.3z"/>' },
  { id:'concept-approved', label:'Approved', category:'Availability', fields:[], path:'M12 3l7 3v5c0 4.8-2.8 8-7 10-4.2-2-7-5.2-7-10V6z M8.5 12l2.2 2.2 4.8-5', svgBody:'<path class="soft" d="M12 3l7 3v5c0 4.8-2.8 8-7 10-4.2-2-7-5.2-7-10V6z"/><path class="main" d="M8.5 12l2.2 2.2 4.8-5"/>' },
  { id:'concept-pending', label:'Pending', category:'Availability', fields:[], path:'M5 6h8 M5 10h6 M5 14h4 M16 12v3l2 1', svgBody:'<path class="main" d="M5 6h8M5 10h6M5 14h4"/><circle class="soft" cx="16" cy="15" r="5"/><path class="main" d="M16 12v3l2 1"/>' },
  { id:'concept-missing', label:'Missing', category:'Availability', fields:['downloaded'], path:'M4 5h16v14H4z M4 15l4-4 3 3 3-3 6 6', svgBody:'<path class="main" d="M4 5h16v14H4zM4 15l4-4 3 3 3-3 6 6M9 8h.01"/><path class="accent" d="M11 3h2v4h-2zM11 17h2v4h-2z"/>' },
  { id:'concept-downloading', label:'Downloading', category:'Availability', fields:['downloaded'], path:'M4 5h16v12H4z M12 7v7 M9 11l3 3 3-3 M7 21h10', svgBody:'<path class="soft" d="M4 5h16v12H4z"/><path class="main" d="M12 7v7m-3-3 3 3 3-3M7 21h10"/>' },
  { id:'concept-monitored', label:'Monitored', category:'Availability', fields:['isMonitored'], path:'M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5z', svgBody:'<path class="main" d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5z"/><circle class="soft" cx="12" cy="12" r="2.5"/><circle class="accent" cx="19" cy="6" r="1.8"/>' },
  { id:'concept-available', label:'Available', category:'Availability', fields:['downloaded'], path:'M4 4h16v16H4z M8 12l2.5 2.5L16.5 8', svgBody:'<rect class="soft" x="4" y="4" width="16" height="16" rx="2"/><path class="main" d="M8 12l2.5 2.5L16.5 8"/>' },
  { id:'concept-coming', label:'Coming soon', category:'Lifecycle', fields:['daysUntilRelease','releaseDate'], path:'M4 6h16v14H4z M8 3v5 M16 3v5 M4 10h16', svgBody:'<path class="soft" d="M4 6h16v14H4z"/><path class="main" d="M8 3v5m8-5v5M4 10h16M8 14h4"/><path class="accent" d="M16 13l4 3-4 3z"/>' },
  { id:'concept-premiere', label:'Premiere', category:'Lifecycle', fields:['releaseDate'], path:'M4 4h16 M6 4c0 6 2 10 6 16 M18 4c0 6-2 10-6 16', svgBody:'<path class="main" d="M4 4h16M6 4c0 6 2 10 6 16M18 4c0 6-2 10-6 16"/><path class="accent" d="M12 8l1.2 2.4 2.8.4-2 2 .5 2.7-2.5-1.3-2.5 1.3.5-2.7-2-2 2.8-.4z"/>' },
  { id:'concept-returning', label:'Returning series', category:'Lifecycle', fields:['nextSeasonAirDate'], path:'M5 6h14v12H5z M9 10h6 M15 14H9', svgBody:'<path class="soft" d="M5 6h14v12H5z"/><path class="main" d="M9 10h6l-2-2m2 2-2 2M15 14H9l2 2m-2-2 2-2"/>' },
  { id:'concept-leaving', label:'Leaving soon', category:'Lifecycle', fields:['daysUntilAction'], path:'M5 3h10v18H5z M15 8h5', svgBody:'<path class="main" d="M5 3h10v18H5zM10 12h.01M15 8h5m-2-2 2 2-2 2"/><circle class="accent" cx="18" cy="17" r="2"/>' },
  { id:'concept-movie', label:'Movie', category:'Media', fields:['mediaType'], path:'M3 5h18v14H3z M3 9h18 M9 12l5 2.5L9 17z', svgBody:'<rect class="soft" x="3" y="5" width="18" height="14" rx="2"/><path class="main" d="M3 9h18M7 5v4m5-4v4m5-4v4M9 12l5 2.5L9 17z"/>' },
  { id:'concept-series', label:'TV series', category:'Media', fields:['mediaType'], path:'M3 6h18v13H3z M8 2l4 4 4-4 M8 22h8', svgBody:'<path class="soft" d="M3 6h18v13H3z"/><path class="main" d="M8 2l4 4 4-4M7 10h10M7 14h7M8 22h8"/>' },
  { id:'concept-season', label:'Season', category:'Media', fields:['seasonNumber','totalSeasons'], path:'M6 4h13v14H6z M3 7v14h13', svgBody:'<path class="soft" d="M6 4h13v14H6z"/><path class="main" d="M3 7v14h13M10 8h5m-5 4h5"/><circle class="accent" cx="17" cy="17" r="3"/>' },
  { id:'concept-collection', label:'Collection', category:'Media', fields:['collection'], path:'M3 7h7l2 2h9v11H3z M7 13h10', svgBody:'<path class="soft" d="M3 7h7l2 2h9v11H3z"/><path class="main" d="M7 13h10M7 17h7"/><circle class="accent" cx="18" cy="7" r="2"/>' },
  { id:'concept-uhd', label:'4K UHD', category:'Formats', fields:['resolution'], path:'M3 5h18v14H3z M5.5 13h5 M13 7v10', svgBody:'<rect class="soft" x="3" y="5" width="18" height="14" rx="3"/><path class="main" d="M5.5 13h5l-1-6v10M13 7v10m5-10-5 5 5 5"/>' },
  { id:'concept-hdr', label:'HDR', category:'Formats', fields:['hdr'], path:'M4 6h16v12H4z M7 10v4 M13 10v4', svgBody:'<path class="soft" d="M4 6h16v12H4z"/><path class="main" d="M7 10v4m3-4v4m-3-2h3M13 10v4h2c2 0 2-4 0-4zm6 4v-4h2"/>' },
  { id:'concept-vision', label:'Dynamic vision', category:'Formats', fields:['dolbyVision'], path:'M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5z', svgBody:'<path class="soft" d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5z"/><path class="main" d="M8 12a4 4 0 0 1 8 0 4 4 0 0 1-8 0zM12 3v2m0 14v2"/><circle class="accent" cx="12" cy="12" r="1.7"/>' },
  { id:'concept-codec', label:'Codec', category:'Formats', fields:['videoCodec','audioCodec'], path:'M5 3h14v18H5z M9 7h6', svgBody:'<path class="soft" d="M5 3h14v18H5z"/><path class="main" d="M9 7h6M8 11h2m2 0h4M8 15h5m2 0h1"/><path class="accent" d="M3 9h2v6H3zm16 0h2v6h-2z"/>' },
  { id:'concept-bitrate', label:'Bitrate', category:'Formats', fields:['bitrate'], path:'M4 19V13 M8 19V9 M12 19V5 M16 19v-8 M20 19v-4', svgBody:'<path class="main" d="M4 19V13m4 6V9m4 10V5m4 14v-8m4 8v-4"/><path class="accent" d="M10 3h4l-2-2z"/>' },
  { id:'concept-aspect', label:'Aspect ratio', category:'Formats', fields:['aspectRatio'], path:'M4 6h16v12H4z M8 9H6v3 M16 9h2v3', svgBody:'<path class="soft" d="M4 6h16v12H4z"/><path class="main" d="M8 9H6v3m10-3h2v3M8 15H6v-3m10 3h2v-3"/>' },
  { id:'concept-surround', label:'Surround 7.1', category:'Audio', fields:['audioChannels','audioChannelLayout'], path:'M4 7h3v4H4z M17 7h3v4h-3z', svgBody:'<circle class="soft" cx="12" cy="12" r="3"/><path class="main" d="M4 7h3v4H4zm13 0h3v4h-3zM4 15h3v4H4zm13 0h3v4h-3zM10 3h4v3h-4zm0 15h4v3h-4z"/>' },
  { id:'concept-spatial', label:'Spatial audio', category:'Audio', fields:['audioFormat','audioCodec'], path:'M6 8c-3 3-3 5 0 8 M18 8c3 3 3 5 0 8', svgBody:'<circle class="soft" cx="12" cy="12" r="2.5"/><path class="main" d="M6 8c-3 3-3 5 0 8m12-8c3 3 3 5 0 8M8 5c3-3 5-3 8 0M8 19c3 3 5 3 8 0"/><circle class="accent" cx="12" cy="12" r="1"/>' },
  { id:'concept-lossless', label:'Lossless audio', category:'Audio', fields:['audioFormat'], path:'M3 12h3l2-5 3 10 3-8 2 6 2-3h3', svgBody:'<path class="main" d="M3 12h3l2-5 3 10 3-8 2 6 2-3h3"/><path class="soft" d="M12 3l3 3-3 3-3-3z"/>' },
  { id:'concept-subtitles', label:'Subtitles concept', category:'Audio', fields:['subtitleLanguages','hasSubtitles'], path:'M3 5h18v14H3z M6 11h5 M13 11h5', svgBody:'<path class="soft" d="M3 5h18v14H3z"/><path class="main" d="M6 11h5m2 0h5M6 15h3m2 0h7"/>' },
  { id:'concept-language', label:'Multiple languages', category:'Audio', fields:['audioLanguages','subtitleLanguages'], path:'M4 5h12v10H9l-4 4v-4H4z', svgBody:'<path class="soft" d="M4 5h12v10H9l-4 4v-4H4z"/><path class="main" d="M7 8h6M10 6v2m-2 4c2-1 3-2 4-4"/><circle class="accent" cx="18" cy="17" r="3"/>' },
  { id: 'resolution', label: 'Resolution', fields: ['resolution','width','height'], path: 'M3 5h18v12H3z M8 21h8 M12 17v4 M7 9h3v4H7z M14 9h3v4h-3z' },
  { id: 'video', label: 'Video codec', fields: ['videoCodec','videoProfile','container'], path: 'M3 5h13v14H3z M16 10l5-3v10l-5-3z M7 9h5 M7 13h5' },
  { id: 'hdr', label: 'HDR', fields: ['hdr','dolbyVision','colorTrc'], path: 'M12 2v2 M12 20v2 M4.93 4.93l1.42 1.42 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M4.93 19.07l1.42-1.42 M17.66 6.34l1.41-1.41 M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0' },
  { id: 'bitrate', label: 'Bitrate', fields: ['bitrate','videoFrameRate','bitDepth'], path: 'M4 18V9 M8 18V5 M12 18v-7 M16 18V3 M20 18v-5' },
  { id: 'audio', label: 'Audio', fields: ['audioFormat','audioCodec','audioChannels','audioChannelLayout'], path: 'M4 10v4 M8 7v10 M12 4v16 M16 7v10 M20 10v4' },
  { id: 'language', label: 'Language', fields: ['audioLanguage','audioLanguages','subtitleLanguages'], path: 'M4 5h10 M9 3v2 M6 9c2 3 5 5 8 6 M13 5c-1 5-4 9-8 11 M15 19l3-8 3 8 M16 16h4' },
  { id: 'subtitles', label: 'Subtitles', fields: ['hasSubtitles','subtitleLanguages','subtitleLanguageCodes'], path: 'M3 5h18v14H3z M6 11h5 M13 11h5 M6 15h3 M11 15h7' },
  { id: 'rating', label: 'Rating', fields: ['imdbRating','imdbVotes','imdbContentRating','rtCriticsScore','rtAudienceScore','plexUserRating'], path: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1z' },
  { id: 'award', label: 'Ranking', fields: ['imdbTop250Rank','isImdbTop250','rtCertifiedFresh','rtVerifiedHot'], path: 'M8 3h8v5a4 4 0 0 1-8 0z M8 5H4v2a4 4 0 0 0 4 4 M16 5h4v2a4 4 0 0 1-4 4 M12 12v5 M8 21h8 M9 17h6' },
  { id: 'calendar', label: 'Date', fields: ['releaseDate','dateAdded','lastPlayed','nextEpisodeAirDate','nextSeasonAirDate'], path: 'M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16 M8 14h2 M14 14h2 M8 18h2' },
  { id: 'countdown', label: 'Countdown', fields: ['daysUntilRelease','daysUntilAction','daysUntilNextEpisode','daysUntilNextSeason'], path: 'M7 2h10 M7 22h10 M8 2c0 5 2 6 4 8 2-2 4-3 4-8 M8 22c0-5 2-6 4-8 2 2 4 3 4 8' },
  { id: 'tv', label: 'TV', fields: ['seasonNumber','episodeNumber','totalSeasons','seasonsAvailable'], path: 'M3 6h18v13H3z M8 2l4 4 4-4 M8 22h8' },
  { id: 'episodes', label: 'Episodes', fields: ['episodeCount','episode4kCount','episodeHdrCount','episodeDvCount'], path: 'M5 4h14v16H5z M9 8l6 4-6 4z' },
  { id: 'download', label: 'Downloaded', fields: ['downloaded','inRadarr','inSonarr','isMonitored'], path: 'M12 3v12 M7 10l5 5 5-5 M4 21h16' },
  { id: 'provider', label: 'Provider', fields: ['streamingProvider','studio','network'], path: 'M3 19h18 M5 19V9h14v10 M8 9V5h8v4 M9 13h2 M13 13h2' },
  { id: 'collection', label: 'Collection', fields: ['collection','plexLabels','radarrTags','sonarrTags'], path: 'M3 6h7l2 2h9v11H3z M7 12h10 M7 16h7' },
  { id: 'file', label: 'File', fields: ['filePath','fileSize'], path: 'M6 2h8l4 4v16H6z M14 2v6h6 M9 13h6 M9 17h6' },
  { id: 'identity', label: 'Media details', fields: ['title','year','genre','director','mediaType','imdbGenres','imdbKeywords','imdbActors','imdbDirectors','imdbCreators','imdbPlot','imdbAlternateTitle','imdbReleaseDate','imdbRuntime'], path: 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5' },
  { id: 'play', label: 'Play', fields: [], path: 'M7 3l14 9-14 9z' },
  { id: 'pause', label: 'Pause', fields: [], path: 'M6 3h4v18H6z M14 3h4v18h-4z' },
  { id: 'film', label: 'Film', fields: [], path: 'M3 4h18v16H3z M3 9h18 M3 15h18 M7 4v5 M12 4v5 M17 4v5 M7 15v5 M12 15v5 M17 15v5' },
  { id: 'clapper', label: 'Clapperboard', fields: [], path: 'M3 9h18v12H3z M3 3h18v6H3z M7 3l4 6 M13 3l4 6' },
  { id: 'camera', label: 'Camera', fields: [], path: 'M3 7h4l2-3h6l2 3h4v13H3z M12 10a4 4 0 1 0 0 8 4 4 0 1 0 0-8' },
  { id: 'reel', label: 'Film reel', fields: [], path: 'M12 2a9 9 0 1 0 0 18 9 9 0 1 0 0-18 M8 7a2 2 0 1 0 0 4 2 2 0 1 0 0-4 M16 7a2 2 0 1 0 0 4 2 2 0 1 0 0-4 M8 15a2 2 0 1 0 0 4 2 2 0 1 0 0-4 M16 15a2 2 0 1 0 0 4 2 2 0 1 0 0-4' },
  { id: 'sparkles', label: 'Sparkles', fields: [], path: 'M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z M19 16l1 3 3 1-3 1-1 3-1-3-3-1 3-1z' },
  { id: 'crown', label: 'Crown', fields: [], path: 'M3 7l5 4 4-7 4 7 5-4-2 12H5z M5 22h14' },
  { id: 'heart', label: 'Heart', fields: [], path: 'M12 21S3 15 3 8a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 7-9 13-9 13z' },
  { id: 'flame', label: 'Flame', fields: [], path: 'M13 2c1 5-4 6-2 11 1-2 3-3 5-4 3 3 4 6 2 10-2 4-9 5-12 1-4-5-1-11 4-15 0 4 1 6 3 7 0-4 2-7 3-10z' },
  { id: 'bolt', label: 'Lightning', fields: [], path: 'M13 2L4 14h7l-1 8 10-13h-7z' },
  { id: 'eye', label: 'Eye', fields: [], path: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6' },
  { id: 'lock', label: 'Lock', fields: [], path: 'M5 10h14v12H5z M8 10V7a4 4 0 0 1 8 0v3 M12 15v3' },
  { id: 'bell', label: 'Bell', fields: [], path: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4' },
  { id: 'bookmark', label: 'Bookmark', fields: [], path: 'M6 3h12v19l-6-4-6 4z' },
  { id: 'tag', label: 'Tag', fields: [], path: 'M3 4h9l9 9-8 8-10-10z M8 8h.01' },
  { id: 'layers', label: 'Layers', fields: [], path: 'M12 2l10 5-10 5L2 7z M2 12l10 5 10-5 M2 17l10 5 10-5' },
  { id: 'grid', label: 'Grid', fields: [], path: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z' },
  { id: 'globe', label: 'Globe', fields: [], path: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20 M2 12h20 M12 2c3 3 4 7 4 10s-1 7-4 10c-3-3-4-7-4-10s1-7 4-10' },
  { id: 'rocket', label: 'Rocket', fields: [], path: 'M14 4c3-2 6-2 7-2 0 1 0 4-2 7l-6 6-5-5z M9 9l-4 1-3 3 6 1 M15 15l-1 6-3 3-1-6 M7 17l-4 4' },
  { id: 'check', label: 'Check', fields: [], path: 'M4 12l5 5L20 6' },
  { id: 'xmark', label: 'Close', fields: [], path: 'M5 5l14 14 M19 5L5 19' },
  { id: 'plus', label: 'Plus', fields: [], path: 'M12 3v18 M3 12h18' },
  { id: 'info', label: 'Information', fields: [], path: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20 M12 10v7 M12 7h.01' },
  { id: 'warning', label: 'Warning', fields: [], path: 'M12 2l10 19H2z M12 8v6 M12 18h.01' },
];
export const dynamicValueIconForField = (field: string): DynamicValueIcon =>
  dynamicValueIcons.find((icon) => icon.fields.includes(field)) ??
  dynamicValueIcons[dynamicValueIcons.length - 1]!;
export interface OverlayLayer {
  id: string;
  groupId?: string;
  layerOrder: number;
  type: OverlayLayerType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  name: string;
  properties: Record<
    string,
    | string
    | number
    | boolean
    | readonly OverlayVariableSegment[]
    | readonly OverlayIconMapping[]
    | undefined
  >;
}
export interface OverlayTemplateDesign {
  width: 1000;
  height: 1500;
  elements: readonly OverlayLayer[];
}
export type OverlayConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'notContains'
  | 'regex'
  | 'begins'
  | 'ends'
  | 'exists';
export interface OverlayConditionRule {
  ruleOperator?: 'and' | 'or';
  field: string;
  operator: OverlayConditionOperator;
  value: string | number | boolean | readonly (string | number)[];
}
export interface OverlayConditionSection {
  sectionOperator?: 'and' | 'or';
  rules: readonly OverlayConditionRule[];
}
export interface OverlayApplicationCondition {
  sections: readonly OverlayConditionSection[];
}

export interface OverlayLibraryConfiguration {
  id: string;
  name: string;
  type: PosterLibraryType;
  itemCount: number;
  enabledTemplateIds: readonly string[];
  tmdbLanguage: string;
  enableEpisodeScanning: boolean;
  maintainerrSeasonOverlays: boolean;
  maintainerrConfigured: boolean;
  status:
    | 'idle'
    | 'queued'
    | 'processing'
    | 'cancelling'
    | 'complete'
    | 'error';
  processedItems: number;
  failedItems: number;
  lastAppliedItems?: number;
  lastRestoredItems?: number;
  lastSkippedItems?: number;
  lastUnchangedItems?: number;
  lastNoMatchItems?: number;
  lastAppliedAt?: string;
  indexedItems?: number;
  lastSyncedAt?: string;
}

export interface PosterOverlayWorkspace {
  source: PosterSourceSettings;
  templates: readonly OverlayTemplateSummary[];
  libraries: readonly OverlayLibraryConfiguration[];
}

export interface PosterTestSearchItem {
  ratingKey: string;
  title: string;
  year?: number;
  type: PosterLibraryType | 'season' | 'episode';
  libraryId: string;
  libraryName: string;
  posterUrl?: string;
  syncedAt?: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface PosterTemplateTestResult {
  id: string;
  name: string;
  matched: boolean;
  conditionSummary: string;
  actualValue?: string;
}

export interface PosterOverlayTestResult {
  item: PosterTestSearchItem;
  templates: readonly PosterTemplateTestResult[];
  context: Readonly<Record<string, string | number | boolean | null>>;
  errors: readonly string[];
}

export type CollectionPosterLayerType =
  | 'text'
  | 'raster'
  | 'svg'
  | 'content-grid'
  | 'person';

export interface CollectionPosterLayer {
  id: string;
  layerOrder: number;
  type: CollectionPosterLayerType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  name: string;
  properties: Record<string, string | number | boolean | undefined>;
}

export interface CollectionPosterDesign {
  width: 1000;
  height: 1500;
  background: {
    type: 'color' | 'gradient' | 'radial';
    color: string;
    secondaryColor: string;
    intensity: number;
    useSourceColors: boolean;
  };
  elements: readonly CollectionPosterLayer[];
  migrated: true;
}

export interface CollectionPosterTemplate {
  id: string;
  name: string;
  description: string;
  design: CollectionPosterDesign;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedCollectionPoster {
  id: string;
  name: string;
  description: string;
  design: CollectionPosterDesign;
  isEditable: boolean;
  usedBy: readonly {
    id: string;
    name: string;
    libraryName: string;
    type: 'collection' | 'pre-existing';
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface SourceColorScheme {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
}

export interface PosterEditorAsset {
  id: string;
  name: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/svg+xml';
  size: number;
  kind: 'raster' | 'svg';
  createdAt: string;
}

export interface CollectionPosterWorkspace {
  templates: readonly CollectionPosterTemplate[];
  savedPosters: readonly SavedCollectionPoster[];
  sourceColors: Readonly<Record<string, SourceColorScheme>>;
  assets: readonly PosterEditorAsset[];
}

export interface AuthorizationContext {
  principal?: AuthenticatedPrincipal;
  onboardingActivated: boolean;
}

export type AuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      status: 302 | 401 | 403;
      reason:
        | 'authentication-required'
        | 'already-authenticated'
        | 'onboarding-required'
        | 'onboarding-complete'
        | 'insufficient-role';
      redirectTo?: '/login' | '/setup' | '/';
    };
import { siAppletv,siChannel4,siCrunchyroll,siDazn,siFubo,siItvx,siMax,siMubi,siNetflix,siParamountplus,siPlex,siRoku,siShowtime,siSky,siStarz,siTubi,siYoutube,siYoutubetv,type SimpleIcon } from 'simple-icons';
import { siPrimevideo } from 'simple-icons-legacy';
import { siHulu } from 'simple-icons-hulu';
