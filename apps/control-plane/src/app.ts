import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type {
  AboutInformation,
  ApplicationLogEntry,
  AuthenticatedPrincipal,
  BackgroundJob,
  CacheStatistic,
  CollectionAssetReference,
  CollectionDraft,
  PlexLibraryGeneratorSubtype,
  PlexLibraryGeneratorValue,
  CollectionLinkResult,
  CollectionPosterDesign,
  CollectionPosterWorkspace,
  CollectionPreviewResult,
  CollectionSurface,
  DashboardCollectionStatistic,
  DashboardJobKind,
  DashboardMissingItem,
  DashboardSummary,
  GeneralSettings,
  GeneralSettingsDraft,
  ManagedCollection,
  OverlayTemplateSummary,
  PlexDiscoveredItem,
  PlexDiscoveredItemDraft,
  PlexDiscoveredLinkResult,
  PlexDiscoveryResult,
  PlexMissingCleanupResult,
  PosterEditorAsset,
  PosterOverlayTestResult,
  PosterOverlayWorkspace,
  PosterSource,
  PosterTestSearchItem,
  SourceColorScheme,
} from '@vynode/contracts';
import {
  DownloadConfigurationError,
  type ArrConfigurationService,
  type ArrEndpointDraft,
  type ArrKind,
  type ArrSelection,
  type MountedDirectoryBrowser,
  type PlaceholderSettingsService,
  type PlaceholderInventory,
  type PlexPlaceholderWebhookService,
  type PlexWebhookPayload,
  type SeerrConfigurationService,
  type SeerrDestination,
  type SeerrEndpointDraft,
  type ServiceUserCreationMode,
  type WatchlistDestination,
  type WatchlistSettingsService,
} from '@vynode/downloads';
import type { PlexLoginService, SessionRepository } from '@vynode/identity';
import {
  IntegrationConfigurationError,
  TraktApiError,
  parseMDBListUrl,
  type IntegrationConfigurationService,
  type IntegrationDraft,
  type IntegrationId,
  type TraktOAuthService,
} from '@vynode/integrations';
import {
  PlexConfigurationError,
  type PlexConnectionInput,
  type PlexServerConfigurationService,
  type PlexServerDirectory,
} from '@vynode/media-servers';
import {
  OnboardingConflictError,
  type OnboardingEvent,
  type OnboardingService,
} from '@vynode/onboarding';
import type { LocalPosterWorkspaceResult } from '@vynode/poster-overlays';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { DashboardJobService } from './dashboard-jobs.js';
import {
  readAgregarrArchive,
  normalizeAgregarrAsset,
  translateAgregarrCollectionPoster,
  translateAgregarrOverlay,
  uniqueImportedName,
  type AgregarrTemplateKind,
} from './agregarr-template-import.js';

const sessionCookie = 'vynode.session';
type OverlayTemplateInput = Omit<
  OverlayTemplateSummary,
  'id' | 'displayOrder' | 'elementCount'
>;

const sensitiveLogKey =
  /(?:api[-_ ]?key|authorization|cookie|credential|password|secret|token|x-plex-token)/i;

const redactLogString = (
  value: string,
  sensitiveValues: readonly string[]
): string => {
  let redacted = value
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      '$1 [REDACTED]'
    )
    .replace(
      /([?&](?:api[-_]?key|auth|password|secret|token|x-plex-token)=)[^&#\s]*/gi,
      '$1[REDACTED]'
    );
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue) {
      redacted = redacted.split(sensitiveValue).join('[REDACTED]');
    }
  }
  return redacted;
};

const redactLogValue = (
  value: unknown,
  sensitiveValues: readonly string[],
  seen: WeakSet<object>
): unknown => {
  if (typeof value === 'string')
    return redactLogString(value, sensitiveValues);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => redactLogValue(item, sensitiveValues, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveLogKey.test(key)
        ? '[REDACTED]'
        : redactLogValue(item, sensitiveValues, seen),
    ])
  );
};

export const redactApplicationLogEntry = (
  entry: ApplicationLogEntry,
  sensitiveValues: readonly string[] = []
): ApplicationLogEntry => ({
  ...entry,
  message: redactLogString(entry.message, sensitiveValues),
  ...(entry.data
    ? {
        data: redactLogValue(
          entry.data,
          sensitiveValues,
          new WeakSet()
        ) as Record<string, unknown>,
      }
    : {}),
});

export const isValidCronExpression = (expression: string): boolean => {
  const fields = expression.trim().split(/\s+/);
  const ranges = [
    [0, 59],
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const;
  if (fields.length !== ranges.length) return false;
  return fields.every((field, index) => {
    const [minimum, maximum] = ranges[index]!;
    return field.split(',').every((part) => {
      const match =
        /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
      if (!match) return false;
      const start = match[2] === undefined ? undefined : Number(match[2]);
      const end = match[3] === undefined ? undefined : Number(match[3]);
      const step = match[4] === undefined ? undefined : Number(match[4]);
      if (start !== undefined && (start < minimum || start > maximum))
        return false;
      if (
        end !== undefined &&
        (end < minimum || end > maximum || end < (start ?? minimum))
      )
        return false;
      return step === undefined || (step >= 1 && step <= maximum);
    });
  });
};

export const validateOverlayTemplateInput = (
  input: OverlayTemplateInput
): string | undefined => {
  if (!input.name?.trim()) return 'Template name is required.';
  if (input.name.length > 120)
    return 'Template name must be 120 characters or fewer.';
  if (input.description.length > 1000)
    return 'Template description must be 1000 characters or fewer.';
  if (input.design.width !== 1000 || input.design.height !== 1500)
    return 'Overlay templates must use a 1000 by 1500 canvas.';
  if (input.design.elements.length > 100)
    return 'Overlay templates can contain at most 100 layers.';
  const ids = new Set<string>();
  for (const element of input.design.elements) {
    if (!element.id || ids.has(element.id))
      return 'Every overlay layer must have a unique identifier.';
    ids.add(element.id);
    if (
      ![
        element.x,
        element.y,
        element.width,
        element.height,
        element.rotation,
      ].every(Number.isFinite)
    )
      return `Layer "${element.name}" contains invalid geometry.`;
    if (element.width <= 0 || element.height <= 0)
      return `Layer "${element.name}" must have a positive width and height.`;
  }
  for (const section of input.condition?.sections ?? []) {
    if (!section.rules.length) return 'Condition sections cannot be empty.';
    for (const rule of section.rules)
      if (!rule.field || !rule.operator)
        return 'Every condition rule requires a field and operator.';
  }
  return undefined;
};

export const validateCollectionPosterInput = (input: {
  name?: unknown;
  description?: unknown;
  design?: CollectionPosterDesign;
}): string | undefined => {
  if (typeof input?.name !== 'string' || !input.name.trim())
    return 'Poster name is required.';
  if (input.name.trim().length > 120)
    return 'Poster name must be 120 characters or fewer.';
  if (
    typeof input.description !== 'string' ||
    input.description.length > 500
  )
    return 'Poster description must be 500 characters or fewer.';
  const design = input.design;
  if (
    !design ||
    design.width !== 1000 ||
    design.height !== 1500 ||
    design.migrated !== true
  )
    return 'Poster designs must use the 1000 × 1500 Vynode canvas.';
  const background = design.background;
  const isColor = (value: unknown) =>
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (
    !background ||
    !['color', 'gradient', 'radial'].includes(background.type) ||
    !isColor(background.color) ||
    !isColor(background.secondaryColor) ||
    !Number.isFinite(background.intensity) ||
    background.intensity < 0 ||
    background.intensity > 100 ||
    typeof background.useSourceColors !== 'boolean'
  )
    return 'Poster background settings are invalid.';
  if (!Array.isArray(design.elements) || design.elements.length > 100)
    return 'Poster designs may contain at most 100 layers.';
  const ids = new Set<string>();
  const layerOrders = new Set<number>();
  for (const layer of design.elements) {
    if (
      !layer ||
      typeof layer.id !== 'string' ||
      !layer.id.trim() ||
      ids.has(layer.id)
    )
      return 'Every poster layer requires a unique ID.';
    ids.add(layer.id);
    if (layerOrders.has(layer.layerOrder))
      return 'Every poster layer requires a unique layer order.';
    layerOrders.add(layer.layerOrder);
    if (
      !['text', 'raster', 'svg', 'content-grid', 'person'].includes(
        layer.type
      ) ||
      typeof layer.name !== 'string' ||
      !layer.name.trim() ||
      layer.name.length > 120 ||
      !Number.isInteger(layer.layerOrder) ||
      ![
        layer.x,
        layer.y,
        layer.width,
        layer.height,
        layer.rotation,
      ].every(Number.isFinite) ||
      layer.x < 0 ||
      layer.y < 0 ||
      layer.width <= 0 ||
      layer.height <= 0 ||
      layer.x + layer.width > design.width ||
      layer.y + layer.height > design.height ||
      Math.abs(layer.rotation) > 360
    )
      return `Layer "${layer.name || layer.id}" has invalid geometry or metadata.`;
    if (layer.type === 'text') {
      const size = Number(layer.properties.fontSize);
      if (!Number.isFinite(size) || size < 8 || size > 400)
        return `Text layer "${layer.name}" has an invalid font size.`;
    }
    if (layer.type === 'content-grid') {
      const columns = Number(layer.properties.columns);
      const rows = Number(layer.properties.rows);
      const spacing = Number(layer.properties.spacing);
      const cornerRadius = Number(layer.properties.cornerRadius);
      if (
        !Number.isInteger(columns) ||
        columns < 1 ||
        columns > 8 ||
        !Number.isInteger(rows) ||
        rows < 1 ||
        rows > 8 ||
        !Number.isFinite(spacing) ||
        spacing < 0 ||
        spacing > 100 ||
        !Number.isFinite(cornerRadius) ||
        cornerRadius < 0 ||
        cornerRadius > 100
      )
        return `Content grid "${layer.name}" has invalid layout settings.`;
    }
  }
  return undefined;
};

export const validateSourceColorsImport = (
  input: unknown
):
  | { colors: Readonly<Record<string, SourceColorScheme>> }
  | { error: string } => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { error: 'Choose a valid source-colors JSON export.' };
  const payload = input as Record<string, unknown>;
  if (
    payload.schema !== undefined &&
    payload.schema !== 'vynode.source-colors'
  )
    return { error: 'This file is not a Vynode source-colors export.' };
  if (
    payload.version !== undefined &&
    payload.version !== 1 &&
    payload.version !== '1.0'
  )
    return { error: `Source-colors version "${String(payload.version)}" is not supported.` };
  const sourceColors = payload.sourceColors;
  if (
    !sourceColors ||
    typeof sourceColors !== 'object' ||
    Array.isArray(sourceColors)
  )
    return { error: 'The export does not contain sourceColors.' };
  const entries = Object.entries(sourceColors);
  if (entries.length === 0 || entries.length > 100)
    return { error: 'Source-colors imports must contain between 1 and 100 schemes.' };
  const colors: Record<string, SourceColorScheme> = Object.create(null);
  const hex = /^#[0-9a-f]{6}$/i;
  for (const [rawSource, value] of entries) {
    const source = rawSource.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(source))
      return { error: `Source name "${rawSource}" is invalid.` };
    if (Object.hasOwn(colors, source))
      return { error: `Source name "${rawSource}" is duplicated after normalization.` };
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return { error: `Color scheme "${rawSource}" is invalid.` };
    const scheme = value as Record<string, unknown>;
    if (
      !hex.test(String(scheme.primaryColor ?? '')) ||
      !hex.test(String(scheme.secondaryColor ?? '')) ||
      !hex.test(String(scheme.textColor ?? ''))
    )
      return { error: `Color scheme "${rawSource}" must use #RRGGBB colors.` };
    colors[source] = {
      primaryColor: String(scheme.primaryColor).toLowerCase(),
      secondaryColor: String(scheme.secondaryColor).toLowerCase(),
      textColor: String(scheme.textColor).toLowerCase(),
    };
  }
  return { colors };
};

export const validateCollectionPosterAssets = (
  design: CollectionPosterDesign,
  assets: readonly PosterEditorAsset[]
): string | undefined => {
  for (const layer of design.elements) {
    if (layer.type !== 'raster' && layer.type !== 'svg') continue;
    const assetId = layer.properties.assetId;
    const path =
      layer.type === 'svg'
        ? layer.properties.iconPath
        : layer.properties.imagePath;
    if (!assetId && !path) continue;
    if (typeof assetId !== 'string' || !assetId)
      return `Layer "${layer.name}" must select a stored Vynode asset.`;
    const asset = assets.find((item) => item.id === assetId);
    if (!asset)
      return `Layer "${layer.name}" references an asset that no longer exists.`;
    if (
      (layer.type === 'svg' && asset.kind !== 'svg') ||
      (layer.type === 'raster' && asset.kind !== 'raster')
    )
      return `Layer "${layer.name}" uses the wrong asset type.`;
    const expectedPath = `/api/posters/collections/assets/${encodeURIComponent(asset.id)}`;
    if (path !== expectedPath)
      return `Layer "${layer.name}" contains an invalid asset reference.`;
  }
  return undefined;
};

export interface ControlPlaneDependencies {
  onboarding: OnboardingService;
  plexLogin: PlexLoginService;
  plexServer: PlexServerConfigurationService;
  plexServerDirectory: PlexServerDirectory;
  integrations?: IntegrationConfigurationService;
  collectionSourceValidator?: (input: {
    type: CollectionDraft['sourceType'];
    subtype: string;
    customUrl?: string;
  }) => Promise<
    | {
        valid: true;
        title?: string;
        contentType?: 'movie' | 'show' | 'mixed';
        message?: string;
      }
    | undefined
  >;
  traktOAuth?: TraktOAuthService;
  downloads?: ArrConfigurationService;
  arrCollectionSources?: {
    servers(kind: ArrKind): Promise<
      readonly { id: string; name: string; kind: ArrKind }[]
    >;
    tags(
      serverId: string
    ): Promise<readonly { id: number; label: string }[]>;
  };
  fetchingPolicy?: {
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
  placeholders?: PlaceholderSettingsService;
  placeholderInventory?: {
    get(): Promise<PlaceholderInventory>;
  };
  directoryBrowser?: MountedDirectoryBrowser;
  youtubeCookieStatus?: () => Promise<{
    state: 'missing' | 'ready' | 'present-but-disabled';
    fileName: string;
  }>;
  seerr?: SeerrConfigurationService;
  watchlists?: WatchlistSettingsService;
  plexWebhook?: PlexPlaceholderWebhookService;
  dashboardJobs?: DashboardJobService;
  dashboardInsights?: {
    summary(): Promise<DashboardSummary>;
    collectionStatistics(
      days: number
    ): Promise<readonly DashboardCollectionStatistic[]>;
    missingItems(
      filters: {
        mediaType?: 'movie' | 'show';
        requestStatus?: DashboardMissingItem['requestStatus'];
        collectionSource?: string;
        requestService?: string;
      },
      limit: number,
      offset: number
    ): Promise<{ results: readonly DashboardMissingItem[]; total: number }>;
    syncMissingItems(): Promise<void>;
  };
  collectionSurface?: {
    get(): Promise<CollectionSurface>;
    updatePlacement(
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
    ): Promise<ManagedCollection | undefined>;
    reorderPlacement?(
      firstId: string,
      secondId: string,
      orderKey: 'sharedOrder' | 'libraryOrder'
    ): Promise<boolean>;
    save(
      id: string | undefined,
      draft: CollectionDraft
    ): Promise<ManagedCollection | undefined>;
    copy(id: string): Promise<ManagedCollection | undefined>;
    delete(id: string): Promise<boolean>;
    link(
      masterId: string,
      memberIds: readonly string[]
    ): Promise<CollectionLinkResult | undefined>;
    unlink(id: string): Promise<CollectionLinkResult | undefined>;
    discoverPlex(): Promise<PlexDiscoveryResult>;
    updateDiscoveredPlexItem(
      id: string,
      draft: PlexDiscoveredItemDraft
    ): Promise<PlexDiscoveredItem | undefined>;
    linkDiscoveredPlexItems(
      masterId: string,
      memberIds: readonly string[]
    ): Promise<PlexDiscoveredLinkResult | undefined>;
    unlinkDiscoveredPlexItems(
      id: string
    ): Promise<PlexDiscoveredLinkResult | undefined>;
    cleanupMissingPlexItems(): Promise<PlexMissingCleanupResult>;
    searchPlexItems?(
      libraryId: string,
      query: string,
      itemType?: 'movie' | 'show' | 'season' | 'episode'
    ): Promise<readonly PosterTestSearchItem[]>;
    plexGeneratorValues?(
      libraryId: string,
      subtype: PlexLibraryGeneratorSubtype
    ): Promise<readonly PlexLibraryGeneratorValue[]>;
    preview?(id: string, signal?: AbortSignal): Promise<CollectionPreviewResult | undefined>;
  };
  generalSettings?: {
    get(): Promise<GeneralSettings>;
    save(
      expectedRevision: number,
      draft: GeneralSettingsDraft
    ): Promise<GeneralSettings | undefined>;
    regenerateApiKey(): Promise<GeneralSettings>;
    clearImageCache(): Promise<GeneralSettings>;
  };
  applicationLogs?: {
    list(): Promise<readonly ApplicationLogEntry[]>;
    appDataPath(): Promise<string>;
    sensitiveValues?(): Promise<readonly string[]>;
    record?(entry: ApplicationLogEntry): Promise<void>;
  };
  jobsAndCache?: {
    jobs(): Promise<readonly BackgroundJob[]>;
    run(id: string): Promise<BackgroundJob | undefined>;
    cancel(id: string): Promise<BackgroundJob | undefined>;
    schedule(
      id: string,
      cronSchedule: string
    ): Promise<BackgroundJob | undefined>;
    caches(): Promise<readonly CacheStatistic[]>;
    flushCache(id: string): Promise<CacheStatistic | undefined>;
  };
  aboutInformation?: () => Promise<AboutInformation>;
  posterOverlays?: {
    get(): Promise<PosterOverlayWorkspace>;
    saveSource(
      expectedRevision: number,
      source: PosterSource
    ): Promise<PosterOverlayWorkspace | undefined>;
    updateLibrary(
      id: string,
      input: {
        enabledTemplateIds?: readonly string[];
        tmdbLanguage?: string;
        enableEpisodeScanning?: boolean;
        maintainerrSeasonOverlays?: boolean;
      }
    ): Promise<PosterOverlayWorkspace | undefined>;
    startLibraryJob?(id: string): Promise<PosterOverlayWorkspace | undefined>;
    startAllLibraryJobs?(): Promise<PosterOverlayWorkspace | undefined>;
    cancelLibraryJob?(id: string): Promise<PosterOverlayWorkspace | undefined>;
    resetLibrary?(id: string): Promise<PosterOverlayWorkspace | undefined>;
    generateLocalFolders?(): Promise<LocalPosterWorkspaceResult>;
    populateLocalPosters?(): Promise<LocalPosterWorkspaceResult>;
    searchItems?(
      query: string,
      libraryId?: string
    ): Promise<readonly PosterTestSearchItem[]>;
    posterForItem?(ratingKey: string): Promise<Uint8Array | undefined>;
    testItem?(ratingKey: string): Promise<PosterOverlayTestResult | undefined>;
    applyItem?(ratingKey: string): Promise<PosterOverlayWorkspace | undefined>;
    resetItem?(ratingKey: string): Promise<PosterOverlayWorkspace | undefined>;
    saveTemplate?(
      id: string | undefined,
      input: Omit<
        OverlayTemplateSummary,
        'id' | 'displayOrder' | 'elementCount'
      >
    ): Promise<PosterOverlayWorkspace>;
    duplicateTemplate?(id: string): Promise<PosterOverlayWorkspace | undefined>;
    deleteTemplate?(id: string): Promise<PosterOverlayWorkspace | undefined>;
    copyElements?(
      sourceId: string,
      targetIds: readonly string[],
      elementIds: readonly string[]
    ): Promise<
      | {
          workspace: PosterOverlayWorkspace;
          copiedTargets: number;
          copiedElements: number;
        }
      | undefined
    >;
  };
  collectionPosters?: {
    get(): Promise<CollectionPosterWorkspace>;
    saveTemplate(
      id: string | undefined,
      input: {
        name: string;
        description: string;
        design: CollectionPosterDesign;
      }
    ): Promise<CollectionPosterWorkspace>;
    duplicateTemplate(
      id: string
    ): Promise<CollectionPosterWorkspace | undefined>;
    setDefault(id: string): Promise<CollectionPosterWorkspace | undefined>;
    deleteTemplate(id: string): Promise<CollectionPosterWorkspace | undefined>;
    savePoster(
      id: string | undefined,
      input: {
        name: string;
        description: string;
        design: CollectionPosterDesign;
      }
    ): Promise<CollectionPosterWorkspace>;
    duplicatePoster(id: string): Promise<CollectionPosterWorkspace | undefined>;
    deletePosters(
      ids: readonly string[],
      force: boolean
    ): Promise<{
      workspace: CollectionPosterWorkspace;
      blocked: CollectionPosterWorkspace['savedPosters'];
    }>;
    importSourceColors(
      colors: Readonly<Record<string, SourceColorScheme>>
    ): Promise<CollectionPosterWorkspace>;
    saveAsset(input: {
      name: string;
      mimeType: string;
      bytes: Uint8Array;
    }): Promise<PosterEditorAsset>;
    readAsset(id: string): Promise<
      | {
          asset: PosterEditorAsset;
          bytes: Uint8Array;
        }
      | undefined
    >;
    deleteAsset?(id: string): Promise<boolean>;
  };
  ownerPlexTokenReference(): Promise<string>;
  sessions: SessionRepository & {
    resolve(sessionId: string): Promise<AuthenticatedPrincipal | undefined>;
  };
  apiKeyAuthentication?: {
    authenticate(apiKey: string): Promise<AuthenticatedPrincipal | undefined>;
  };
  allowedOrigin?: string;
  trustProxy?: boolean;
  healthCheck?(): Promise<void>;
  production: boolean;
  now(): Date;
}

export const createControlPlane = async (
  dependencies: ControlPlaneDependencies
): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false,
    bodyLimit: 15 * 1024 * 1024,
    trustProxy: dependencies.trustProxy ?? false,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fields: 10, files: 1, fileSize: 10 * 1024 * 1024 },
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://image.tmdb.org; connect-src 'self'; form-action 'self'"
    );
  });
  app.addHook('onError', async (request, _reply, error) => {
    if (!dependencies.applicationLogs?.record) return;
    await dependencies.applicationLogs.record({
      id: `error-${dependencies.now().getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: dependencies.now().toISOString(),
      level: 'error',
      label: 'request.error',
      message: error.message,
      data: {
        method: request.method,
        path: request.url.split('?')[0] ?? request.url,
        statusCode: error.statusCode ?? 500,
      },
    });
  });

  const roleRank = {
    viewer: 0,
    operator: 1,
    administrator: 2,
    owner: 3,
  } as const;
  const administratorMutationPrefixes = [
    '/api/settings/',
    '/api/seerr',
    '/api/watchlists',
    '/api/placeholders',
    '/api/fetching-policy',
    '/api/downloads',
    '/api/integrations',
    '/api/media-servers/',
  ] as const;
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    const authorization = request.headers.authorization;
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const headerKey = request.headers['x-api-key'];
    const apiKey = bearer ?? (typeof headerKey === 'string' ? headerKey : undefined);
    const safeMethod = request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS';
    if (
      dependencies.allowedOrigin &&
      !safeMethod &&
      path !== '/plex-webhook' &&
      !apiKey &&
      request.headers.origin !== dependencies.allowedOrigin
    )
      return reply.code(403).send({
        code: 'csrf-origin-invalid',
        message: 'This request did not originate from the configured Vynode address.',
      });
    if (
      path === '/health' ||
      path === '/api/health' ||
      path === '/api/onboarding' ||
      path === '/plex-webhook' ||
      path.startsWith('/api/auth/')
    )
      return;
    const onboarding = await dependencies.onboarding.get();
    if (!onboarding.activatedAt) return;
    const sessionId = request.cookies[sessionCookie];
    const principal = sessionId
      ? await dependencies.sessions.resolve(sessionId)
      : apiKey && dependencies.apiKeyAuthentication
        ? await dependencies.apiKeyAuthentication.authenticate(apiKey)
        : undefined;
    if (!principal)
      return reply.code(401).send({
        code: 'authentication-required',
        message: 'Sign in is required.',
      });
    if (safeMethod) return;
    const requiredRole = administratorMutationPrefixes.some((prefix) =>
      path.startsWith(prefix)
    )
      ? 'administrator'
      : 'operator';
    if (roleRank[principal.role] < roleRank[requiredRole])
      return reply.code(403).send({
        code: 'insufficient-role',
        message:
          requiredRole === 'administrator'
            ? 'Administrator access is required to change this configuration.'
            : 'Operator access is required to perform this action.',
      });
  });

  const healthHandler = async (_request: unknown, reply: { code(statusCode: number): { send(payload: unknown): unknown } }) => {
    try {
      await dependencies.healthCheck?.();
      return {
        status: 'ok',
        checkedAt: dependencies.now().toISOString(),
      };
    } catch {
      return reply.code(503).send({
        status: 'unavailable',
        checkedAt: dependencies.now().toISOString(),
      });
    }
  };
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  app.get('/api/posters/overlays', async (_request, reply) => {
    if (!dependencies.posterOverlays) {
      return reply
        .code(503)
        .send({ message: 'Poster overlay storage is unavailable.' });
    }
    return dependencies.posterOverlays.get();
  });
  const importAgregarrTemplate = async (
    kind: AgregarrTemplateKind,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    if (!dependencies.collectionPosters)
      return reply
        .code(503)
        .send({ message: 'Poster asset storage is unavailable.' });
    if (kind === 'overlay' && !dependencies.posterOverlays?.saveTemplate)
      return reply
        .code(503)
        .send({ message: 'Overlay template storage is unavailable.' });
    let upload;
    try {
      upload = await request.file({
        limits: { fields: 0, files: 1, fileSize: 50 * 1024 * 1024 },
      });
    } catch (error) {
      return reply.code(400).send({
        message:
          error instanceof Error
            ? error.message
            : 'Unable to read the Agregarr archive.',
      });
    }
    if (!upload)
      return reply
        .code(400)
        .send({ message: 'Choose an Agregarr template ZIP archive.' });
    if (
      !upload.filename.toLowerCase().endsWith('.zip') &&
      upload.mimetype !== 'application/zip' &&
      upload.mimetype !== 'application/x-zip-compressed'
    )
      return reply
        .code(400)
        .send({ message: 'Agregarr template imports must be ZIP archives.' });
    const savedAssetIds: string[] = [];
    try {
      const archive = await readAgregarrArchive(await upload.toBuffer(), kind);
      const assetReferences = new Map<
        string,
        {
          id: string;
          name: string;
          collectionPath: string;
          overlayPath: string;
          kind: 'raster' | 'svg';
          crop?: import('./agregarr-template-import.js').AgregarrAssetCrop;
        }
      >();
      for (const imported of archive.assets) {
        const normalized = await normalizeAgregarrAsset(imported);
        const asset = await dependencies.collectionPosters.saveAsset(
          normalized.asset
        );
        savedAssetIds.push(asset.id);
        assetReferences.set(imported.name.toLowerCase(), {
          id: asset.id,
          name: imported.name,
          collectionPath: `/api/posters/collections/assets/${encodeURIComponent(asset.id)}`,
          overlayPath: `asset://${asset.id}`,
          kind: asset.kind,
          ...(normalized.crop ? { crop: normalized.crop } : {}),
        });
      }
      if (kind === 'collection-poster') {
        const current = await dependencies.collectionPosters.get();
        const importedName = uniqueImportedName(
          archive.name,
          current.templates.map((item) => item.name)
        );
        const translated = translateAgregarrCollectionPoster(
          archive,
          assetReferences
        );
        const validationError = validateCollectionPosterInput({
          name: importedName.name,
          description: archive.description,
          design: translated.design,
        });
        if (validationError) throw new Error(validationError);
        const assetError = validateCollectionPosterAssets(
          translated.design,
          (await dependencies.collectionPosters.get()).assets
        );
        if (assetError) throw new Error(assetError);
        const workspace = await dependencies.collectionPosters.saveTemplate(
          undefined,
          {
            name: importedName.name,
            description: archive.description,
            design: translated.design,
          }
        );
        return reply.code(201).send({
          format: 'agregarr',
          kind,
          version: archive.version,
          name: importedName.name,
          renamed: importedName.renamed,
          importedAssets: savedAssetIds.length,
          importedLayers: translated.design.elements.length,
          warnings: translated.warnings,
          workspace,
        });
      }
      const overlayStorage = dependencies.posterOverlays!;
      const current = await overlayStorage.get();
      const importedName = uniqueImportedName(
        archive.name,
        current.templates.map((item) => item.name)
      );
      const translated = translateAgregarrOverlay(archive, assetReferences);
      const input: OverlayTemplateInput = {
        name: importedName.name,
        description: archive.description,
        type: archive.type || 'generic',
        tags: ['imported', 'agregarr'],
        enabled: false,
        conditionSummary: translated.condition
          ? 'Imported Agregarr condition'
          : 'Always applies',
        accent: '#f3ad32',
        design: translated.design,
        ...(translated.condition ? { condition: translated.condition } : {}),
      };
      const validationError = validateOverlayTemplateInput(input);
      if (validationError) throw new Error(validationError);
      const workspace = await overlayStorage.saveTemplate!(undefined, input);
      return reply.code(201).send({
        format: 'agregarr',
        kind,
        version: archive.version,
        name: importedName.name,
        renamed: importedName.renamed,
        importedAssets: savedAssetIds.length,
        importedLayers: translated.design.elements.length,
        warnings: translated.warnings,
        workspace,
      });
    } catch (error) {
      if (dependencies.collectionPosters.deleteAsset)
        await Promise.allSettled(
          savedAssetIds.map((id) =>
            dependencies.collectionPosters!.deleteAsset!(id)
          )
        );
      return reply.code(400).send({
        message:
          error instanceof Error
            ? error.message
            : 'Unable to import the Agregarr template.',
      });
    }
  };
  app.post(
    '/api/posters/overlays/templates/import/agregarr',
    async (request, reply) =>
      importAgregarrTemplate('overlay', request, reply)
  );
  app.post(
    '/api/posters/collections/templates/import/agregarr',
    async (request, reply) =>
      importAgregarrTemplate('collection-poster', request, reply)
  );
  app.post<{ Body: OverlayTemplateInput }>(
    '/api/posters/overlays/templates',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.saveTemplate)
        return reply
          .code(503)
          .send({ message: 'Overlay template storage is unavailable.' });
      const validationError = validateOverlayTemplateInput(request.body);
      if (validationError)
        return reply.code(400).send({ message: validationError });
      const current = await dependencies.posterOverlays.get();
      if (
        current.templates.some(
          (item) =>
            item.name.trim().toLowerCase() ===
            request.body.name.trim().toLowerCase()
        )
      )
        return reply
          .code(409)
          .send({
            message: 'An overlay template with this name already exists.',
          });
      return dependencies.posterOverlays.saveTemplate(undefined, request.body);
    }
  );
  app.put<{ Params: { id: string }; Body: OverlayTemplateInput }>(
    '/api/posters/overlays/templates/:id',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.saveTemplate)
        return reply
          .code(503)
          .send({ message: 'Overlay template storage is unavailable.' });
      const validationError = validateOverlayTemplateInput(request.body);
      if (validationError)
        return reply.code(400).send({ message: validationError });
      const current = await dependencies.posterOverlays.get();
      if (!current.templates.some((item) => item.id === request.params.id))
        return reply
          .code(404)
          .send({ message: 'Overlay template was not found.' });
      if (
        current.templates.some(
          (item) =>
            item.id !== request.params.id &&
            item.name.trim().toLowerCase() ===
              request.body.name.trim().toLowerCase()
        )
      )
        return reply
          .code(409)
          .send({
            message: 'An overlay template with this name already exists.',
          });
      return dependencies.posterOverlays.saveTemplate(
        request.params.id,
        request.body
      );
    }
  );
  app.post<{ Params: { id: string } }>(
    '/api/posters/overlays/templates/:id/duplicate',
    async (request, reply) => {
      const result = await dependencies.posterOverlays?.duplicateTemplate?.(
        request.params.id
      );
      return (
        result ??
        reply.code(404).send({ message: 'Overlay template was not found.' })
      );
    }
  );
  app.delete<{ Params: { id: string } }>(
    '/api/posters/overlays/templates/:id',
    async (request, reply) => {
      const result = await dependencies.posterOverlays?.deleteTemplate?.(
        request.params.id
      );
      return (
        result ??
        reply.code(404).send({ message: 'Overlay template was not found.' })
      );
    }
  );
  app.post<{
    Body: {
      sourceTemplateId: string;
      targetTemplateIds: readonly string[];
      elementIds: readonly string[];
    };
  }>(
    '/api/posters/overlays/templates/copy-elements',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.copyElements)
        return reply
          .code(503)
          .send({ message: 'Overlay element copying is unavailable.' });
      const { sourceTemplateId, targetTemplateIds, elementIds } = request.body;
      if (!sourceTemplateId || !targetTemplateIds?.length)
        return reply
          .code(400)
          .send({
            message:
              'Select a source template and at least one target template.',
          });
      if (!elementIds?.length)
        return reply
          .code(400)
          .send({ message: 'Select at least one element to copy.' });
      if (targetTemplateIds.includes(sourceTemplateId))
        return reply
          .code(400)
          .send({
            message: 'The source template cannot also be a copy target.',
          });
      const result = await dependencies.posterOverlays.copyElements(
        sourceTemplateId,
        targetTemplateIds,
        elementIds
      );
      return (
        result ??
        reply
          .code(404)
          .send({
            message: 'The source template or selected elements were not found.',
          })
      );
    }
  );

  app.get('/api/posters/collections', async (_request, reply) => {
    if (!dependencies.collectionPosters)
      return reply
        .code(503)
        .send({ message: 'Collection poster storage is unavailable.' });
    return dependencies.collectionPosters.get();
  });
  app.post<{ Body: unknown }>(
    '/api/posters/collections/source-colors/import',
    async (request, reply) => {
      if (!dependencies.collectionPosters)
        return reply
          .code(503)
          .send({ message: 'Collection poster storage is unavailable.' });
      const result = validateSourceColorsImport(request.body);
      if ('error' in result)
        return reply.code(400).send({ message: result.error });
      const workspace =
        await dependencies.collectionPosters.importSourceColors(result.colors);
      return {
        workspace,
        importCount: Object.keys(result.colors).length,
      };
    }
  );
  app.post('/api/posters/collections/assets', async (request, reply) => {
    if (!dependencies.collectionPosters)
      return reply
        .code(503)
        .send({ message: 'Collection poster storage is unavailable.' });
    let upload;
    try {
      upload = await request.file();
    } catch (error) {
      return reply.code(400).send({
        message:
          error instanceof Error
            ? error.message
            : 'Unable to read the poster asset upload.',
      });
    }
    if (!upload)
      return reply.code(400).send({ message: 'Choose a poster asset file.' });
    let bytes: Buffer;
    try {
      bytes = await upload.toBuffer();
    } catch (error) {
      return reply.code(400).send({
        message:
          error instanceof Error
            ? error.message
            : 'Unable to read the poster asset upload.',
      });
    }
    try {
      const asset = await dependencies.collectionPosters.saveAsset({
        name: upload.filename,
        mimeType: upload.mimetype,
        bytes,
      });
      return reply.code(201).send({
        asset,
        workspace: await dependencies.collectionPosters.get(),
      });
    } catch (error) {
      return reply.code(400).send({
        message:
          error instanceof Error
            ? error.message
            : 'Unable to store the poster asset.',
      });
    }
  });
  app.get<{ Params: { id: string } }>(
    '/api/posters/collections/assets/:id',
    async (request, reply) => {
      const result = await dependencies.collectionPosters?.readAsset(
        request.params.id
      );
      if (!result)
        return reply.code(404).send({ message: 'Poster asset was not found.' });
      return reply
        .header('content-type', result.asset.mimeType)
        .header('content-length', String(result.asset.size))
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(Buffer.from(result.bytes));
    }
  );
  app.post<{
    Body: { name: string; description: string; design: CollectionPosterDesign };
  }>('/api/posters/collections/templates', async (request, reply) => {
    if (!dependencies.collectionPosters)
      return reply
        .code(503)
        .send({ message: 'Collection poster storage is unavailable.' });
    const validationError = validateCollectionPosterInput(request.body);
    if (validationError)
      return reply.code(400).send({ message: validationError });
    const current = await dependencies.collectionPosters.get();
    const assetError = validateCollectionPosterAssets(
      request.body.design,
      current.assets
    );
    if (assetError) return reply.code(400).send({ message: assetError });
    if (
      current.templates.some(
        (item) =>
          item.name.trim().toLowerCase() ===
          request.body.name.trim().toLowerCase()
      )
    )
      return reply
        .code(409)
        .send({ message: 'A poster template with this name already exists.' });
    return dependencies.collectionPosters.saveTemplate(undefined, request.body);
  });
  app.put<{
    Params: { id: string };
    Body: { name: string; description: string; design: CollectionPosterDesign };
  }>('/api/posters/collections/templates/:id', async (request, reply) => {
    if (!dependencies.collectionPosters)
      return reply
        .code(503)
        .send({ message: 'Collection poster storage is unavailable.' });
    const validationError = validateCollectionPosterInput(request.body);
    if (validationError)
      return reply.code(400).send({ message: validationError });
    const current = await dependencies.collectionPosters.get();
    const assetError = validateCollectionPosterAssets(
      request.body.design,
      current.assets
    );
    if (assetError) return reply.code(400).send({ message: assetError });
    if (!current.templates.some((item) => item.id === request.params.id))
      return reply.code(404).send({ message: 'Poster template was not found.' });
    if (
      current.templates.some(
        (item) =>
          item.id !== request.params.id &&
          item.name.trim().toLowerCase() ===
            request.body.name.trim().toLowerCase()
      )
    )
      return reply
        .code(409)
        .send({ message: 'A poster template with this name already exists.' });
    return dependencies.collectionPosters.saveTemplate(
      request.params.id,
      request.body
    );
  });
  app.post<{ Params: { id: string } }>(
    '/api/posters/collections/templates/:id/duplicate',
    async (request, reply) => {
      const result = await dependencies.collectionPosters?.duplicateTemplate(
        request.params.id
      );
      return (
        result ??
        reply.code(404).send({ message: 'Poster template was not found.' })
      );
    }
  );
  app.post<{ Params: { id: string } }>(
    '/api/posters/collections/templates/:id/default',
    async (request, reply) => {
      const result = await dependencies.collectionPosters?.setDefault(
        request.params.id
      );
      return (
        result ??
        reply.code(404).send({ message: 'Poster template was not found.' })
      );
    }
  );
  app.delete<{ Params: { id: string } }>(
    '/api/posters/collections/templates/:id',
    async (request, reply) => {
      const current = await dependencies.collectionPosters?.get();
      const template = current?.templates.find(
        (item) => item.id === request.params.id
      );
      if (template?.isDefault)
        return reply.code(409).send({
          message:
            'Choose another default template before deleting this template.',
        });
      const result = await dependencies.collectionPosters?.deleteTemplate(
        request.params.id
      );
      return (
        result ??
        reply.code(404).send({ message: 'Poster template was not found.' })
      );
    }
  );
  app.post<{
    Body: { name: string; description: string; design: CollectionPosterDesign };
  }>('/api/posters/collections/saved', async (request, reply) => {
    if (!dependencies.collectionPosters)
      return reply
        .code(503)
        .send({ message: 'Collection poster storage is unavailable.' });
    const validationError = validateCollectionPosterInput(request.body);
    if (validationError)
      return reply.code(400).send({ message: validationError });
    const current = await dependencies.collectionPosters.get();
    const assetError = validateCollectionPosterAssets(
      request.body.design,
      current.assets
    );
    if (assetError) return reply.code(400).send({ message: assetError });
    if (
      current.savedPosters.some(
        (item) =>
          item.name.trim().toLowerCase() ===
          request.body.name.trim().toLowerCase()
      )
    )
      return reply
        .code(409)
        .send({ message: 'A saved poster with this name already exists.' });
    return dependencies.collectionPosters.savePoster(undefined, request.body);
  });
  app.put<{
    Params: { id: string };
    Body: { name: string; description: string; design: CollectionPosterDesign };
  }>('/api/posters/collections/saved/:id', async (request, reply) => {
    if (!dependencies.collectionPosters)
      return reply
        .code(503)
        .send({ message: 'Collection poster storage is unavailable.' });
    const validationError = validateCollectionPosterInput(request.body);
    if (validationError)
      return reply.code(400).send({ message: validationError });
    const current = await dependencies.collectionPosters.get();
    const assetError = validateCollectionPosterAssets(
      request.body.design,
      current.assets
    );
    if (assetError) return reply.code(400).send({ message: assetError });
    const poster = current.savedPosters.find(
      (item) => item.id === request.params.id
    );
    if (!poster)
      return reply.code(404).send({ message: 'Saved poster was not found.' });
    if (!poster.isEditable)
      return reply
        .code(409)
        .send({ message: 'File-source posters cannot be edited.' });
    if (
      current.savedPosters.some(
        (item) =>
          item.id !== request.params.id &&
          item.name.trim().toLowerCase() ===
            request.body.name.trim().toLowerCase()
      )
    )
      return reply
        .code(409)
        .send({ message: 'A saved poster with this name already exists.' });
    return dependencies.collectionPosters.savePoster(
      request.params.id,
      request.body
    );
  });
  app.post<{ Params: { id: string } }>(
    '/api/posters/collections/saved/:id/duplicate',
    async (request, reply) => {
      const result = await dependencies.collectionPosters?.duplicatePoster(
        request.params.id
      );
      return (
        result ??
        reply.code(404).send({ message: 'Saved poster was not found.' })
      );
    }
  );
  app.post<{ Body: { ids: readonly string[]; force?: boolean } }>(
    '/api/posters/collections/saved/delete',
    async (request, reply) => {
      if (!dependencies.collectionPosters)
        return reply
          .code(503)
          .send({ message: 'Collection poster storage is unavailable.' });
      if (
        !Array.isArray(request.body?.ids) ||
        request.body.ids.length === 0 ||
        request.body.ids.length > 100 ||
        request.body.ids.some(
          (id) => typeof id !== 'string' || !id.trim()
        ) ||
        new Set(request.body.ids).size !== request.body.ids.length
      )
        return reply.code(400).send({
          message: 'Choose between 1 and 100 unique saved posters.',
        });
      const result = await dependencies.collectionPosters.deletePosters(
        request.body.ids,
        request.body.force === true
      );
      if (result.blocked.length) return reply.code(409).send(result);
      return result;
    }
  );

  app.put<{
    Body: { expectedRevision: number; source: PosterSource };
  }>('/api/posters/overlays/source', async (request, reply) => {
    if (!dependencies.posterOverlays) {
      return reply
        .code(503)
        .send({ message: 'Poster overlay storage is unavailable.' });
    }
    const updated = await dependencies.posterOverlays.saveSource(
      request.body.expectedRevision,
      request.body.source
    );
    if (!updated) {
      return reply.code(409).send({
        message:
          'Poster source changed in another session. Reload and try again.',
      });
    }
    return updated;
  });

  app.post(
    '/api/posters/overlays/source/local/generate-folders',
    async (_request, reply) => {
      if (!dependencies.posterOverlays?.generateLocalFolders)
        return reply.code(503).send({ message: 'Local poster folder generation is unavailable.' });
      try {
        return await dependencies.posterOverlays.generateLocalFolders();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Folder generation failed.';
        return reply.code(message.includes('already running') || message.includes('Cannot start') ? 409 : 500).send({ message });
      }
    }
  );

  app.post(
    '/api/posters/overlays/source/local/populate',
    async (_request, reply) => {
      if (!dependencies.posterOverlays?.populateLocalPosters)
        return reply.code(503).send({ message: 'Local Plex poster population is unavailable.' });
      try {
        return await dependencies.posterOverlays.populateLocalPosters();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Poster population failed.';
        return reply.code(message.includes('already running') || message.includes('Cannot start') ? 409 : 500).send({ message });
      }
    }
  );

  app.patch<{
    Params: { id: string };
    Body: {
      enabledTemplateIds?: readonly string[];
      tmdbLanguage?: string;
      enableEpisodeScanning?: boolean;
      maintainerrSeasonOverlays?: boolean;
    };
  }>('/api/posters/overlays/libraries/:id', async (request, reply) => {
    if (!dependencies.posterOverlays) {
      return reply
        .code(503)
        .send({ message: 'Poster overlay storage is unavailable.' });
    }
    const updated = await dependencies.posterOverlays.updateLibrary(
      request.params.id,
      request.body
    );
    if (!updated) {
      return reply.code(404).send({ message: 'Poster library was not found.' });
    }
    return updated;
  });

  app.post<{
    Body: {
      firstId?: string;
      secondId?: string;
      orderKey?: 'sharedOrder' | 'libraryOrder';
    };
  }>('/api/collections/placement/reorder', async (request, reply) => {
    if (!dependencies.collectionSurface?.reorderPlacement)
      return reply
        .code(503)
        .send({ message: 'Atomic collection reordering is unavailable.' });
    const { firstId, secondId, orderKey } = request.body ?? {};
    if (
      !firstId ||
      !secondId ||
      firstId === secondId ||
      !['sharedOrder', 'libraryOrder'].includes(orderKey ?? '')
    )
      return reply.code(400).send({
        code: 'invalid-collection-reorder',
        message: 'Choose two different collections and a valid order surface.',
      });
    const reordered = await dependencies.collectionSurface.reorderPlacement(
      firstId,
      secondId,
      orderKey!
    );
    if (!reordered)
      return reply.code(409).send({
        code: 'collection-reorder-conflict',
        message:
          'The collections could not be reordered. Refresh and try again.',
      });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>(
    '/api/posters/overlays/libraries/:id/apply',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.startLibraryJob) {
        return reply
          .code(503)
          .send({ message: 'Poster overlay jobs are unavailable.' });
      }
      const updated = await dependencies.posterOverlays.startLibraryJob(
        request.params.id
      );
      if (!updated)
        return reply
          .code(409)
          .send({
            message:
              'This library is already processing or could not be found.',
          });
      return updated;
    }
  );

  app.post(
    '/api/posters/overlays/libraries/apply-all',
    async (_request, reply) => {
      if (!dependencies.posterOverlays?.startAllLibraryJobs) {
        return reply
          .code(503)
          .send({ message: 'Batch poster overlay jobs are unavailable.' });
      }
      const updated = await dependencies.posterOverlays.startAllLibraryJobs();
      if (!updated)
        return reply.code(409).send({
          message: 'Another poster operation is already running.',
        });
      return updated;
    }
  );

  app.post('/api/collections/discovery/scan', async (_request, reply) => {
    if (!dependencies.collectionSurface) return reply.code(503).send();
    try {
      return await dependencies.collectionSurface.discoverPlex();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Plex discovery failed.';
      return reply.code(message.includes('already running') ? 409 : 502).send({
        code: 'plex-discovery-failed',
        message,
      });
    }
  });

  app.get<{
    Querystring: { libraryId?: string; query?: string; itemType?: string };
  }>('/api/collections/plex-items', async (request, reply) => {
    if (!dependencies.collectionSurface?.searchPlexItems)
      return reply
        .code(503)
        .send({ message: 'Plex item search is unavailable.' });
    const libraryId = request.query.libraryId?.trim() ?? '';
    const query = request.query.query?.trim() ?? '';
    const itemType = request.query.itemType?.trim();
    if (!/^\d+$/.test(libraryId))
      return reply
        .code(400)
        .send({ message: 'Select a verified Plex library.' });
    if (query.length < 2)
      return reply
        .code(400)
        .send({ message: 'Enter at least two characters to search.' });
    if (itemType && !['movie', 'show', 'season', 'episode'].includes(itemType))
      return reply.code(400).send({ message: 'Choose a valid Plex item type.' });
    return {
      results: await dependencies.collectionSurface.searchPlexItems(
        libraryId,
        query,
        itemType as 'movie' | 'show' | 'season' | 'episode' | undefined
      ),
    };
  });

  app.get<{
    Querystring: { libraryId?: string; subtype?: string };
  }>('/api/collections/plex-generator-values', async (request, reply) => {
    if (!dependencies.collectionSurface?.plexGeneratorValues)
      return reply
        .code(503)
        .send({ message: 'Plex library value discovery is unavailable.' });
    const libraryId = request.query.libraryId?.trim() ?? '';
    const subtype = request.query.subtype?.trim() ?? '';
    if (!/^\d+$/.test(libraryId))
      return reply
        .code(400)
        .send({ message: 'Select a verified Plex library.' });
    if (
      !['genres', 'decades', 'resolutions', 'content-ratings'].includes(
        subtype
      )
    )
      return reply
        .code(400)
        .send({ message: 'Choose a supported Plex generator subtype.' });
    return {
      values: await dependencies.collectionSurface.plexGeneratorValues(
        libraryId,
        subtype as PlexLibraryGeneratorSubtype
      ),
    };
  });

  app.put<{ Params: { id: string }; Body: PlexDiscoveredItemDraft }>(
    '/api/collections/discovery/items/:id',
    async (request, reply) => {
      if (!dependencies.collectionSurface) return reply.code(503).send();
      const draft = request.body;
      const schedule = draft?.timeRestriction;
      const weekdays = [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ] as const;
      const validDate = (value: string) => {
        const match = /^(\d{2})-(\d{2})$/.exec(value);
        if (!match) return false;
        const day = Number(match[1]);
        const month = Number(match[2]);
        return day >= 1 && day <= 31 && month >= 1 && month <= 12;
      };
      const poster = draft?.posterSettings;
      const metadata = draft?.metadataSettings;
      const validAsset = (asset?: CollectionAssetReference) =>
        !asset ||
        (typeof asset.id === 'string' &&
          typeof asset.name === 'string' &&
          typeof asset.mimeType === 'string' &&
          typeof asset.previewDataUrl === 'string' &&
          asset.size > 0 &&
          asset.size <= 10 * 1024 * 1024);
      const validArtwork =
        (poster === undefined && metadata === undefined) ||
        (poster !== undefined &&
          [
            'autoGenerate',
            'applyOverlaysDuringSync',
            'useTmdbFranchisePoster',
            'hideIndividualItems',
          ].every(
            (key) => typeof poster[key as keyof typeof poster] === 'boolean'
          ) &&
          metadata !== undefined &&
          [
            'enableCustomSummary',
            'enableCustomWallpaper',
            'enableCustomTheme',
          ].every(
            (key) => typeof metadata[key as keyof typeof metadata] === 'boolean'
          ) &&
          typeof metadata.customSummary === 'string' &&
          metadata.customSummary.length <= 5000 &&
          (!metadata.enableCustomSummary ||
            metadata.customSummary.trim().length > 0) &&
          (!metadata.enableCustomWallpaper || !!metadata.wallpaper) &&
          (!metadata.enableCustomTheme || !!metadata.theme) &&
          validAsset(metadata.wallpaper) &&
          validAsset(metadata.theme));
      if (
        !draft ||
        !Number.isInteger(draft.homeOrder) ||
        draft.homeOrder < 0 ||
        !Number.isInteger(draft.libraryOrder) ||
        draft.libraryOrder < 0 ||
        !draft.visibility ||
        ['usersHome', 'serverOwnerHome', 'libraryRecommended'].some(
          (key) =>
            typeof draft.visibility[key as keyof typeof draft.visibility] !==
            'boolean'
        ) ||
        (draft.titleSort !== undefined &&
          typeof draft.titleSort !== 'string') ||
        !schedule ||
        typeof schedule.alwaysActive !== 'boolean' ||
        schedule.removeFromPlexWhenInactive !== false ||
        !schedule.inactiveVisibility ||
        ['usersHome', 'serverOwnerHome', 'libraryRecommended'].some(
          (key) =>
            typeof schedule.inactiveVisibility[
              key as keyof typeof schedule.inactiveVisibility
            ] !== 'boolean'
        ) ||
        !Array.isArray(schedule.dateRanges) ||
        schedule.dateRanges.some(
          (range) => !validDate(range.startDate) || !validDate(range.endDate)
        ) ||
        !schedule.weeklySchedule ||
        weekdays.some(
          (day) => typeof schedule.weeklySchedule[day] !== 'boolean'
        ) ||
        !validArtwork
      ) {
        return reply.code(400).send({
          code: 'invalid-discovered-item',
          message:
            'Visibility, schedule, or artwork values are invalid. Dates must use DD-MM, assets must be 10 MB or smaller, and discovered items cannot be removed from Plex.',
        });
      }
      const item =
        await dependencies.collectionSurface.updateDiscoveredPlexItem(
          request.params.id,
          draft
        );
      return (
        item ??
        reply.code(404).send({ message: 'Discovered Plex item was not found.' })
      );
    }
  );

  app.delete('/api/collections/discovery/missing', async (_request, reply) => {
    if (!dependencies.collectionSurface) return reply.code(503).send();
    return dependencies.collectionSurface.cleanupMissingPlexItems();
  });

  app.post<{ Params: { id: string }; Body: { memberIds?: string[] } }>(
    '/api/collections/discovery/items/:id/link',
    async (request, reply) => {
      if (!dependencies.collectionSurface) return reply.code(503).send();
      const memberIds = request.body?.memberIds;
      if (
        !Array.isArray(memberIds) ||
        memberIds.length === 0 ||
        memberIds.some((id) => typeof id !== 'string' || !id.trim())
      ) {
        return reply.code(400).send({
          message: 'Choose at least one discovered Plex item to link.',
        });
      }
      const result =
        await dependencies.collectionSurface.linkDiscoveredPlexItems(
          request.params.id,
          memberIds
        );
      return (
        result ??
        reply.code(409).send({
          message:
            'Choose matching Plex items in different compatible libraries.',
        })
      );
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/collections/discovery/items/:id/unlink',
    async (request, reply) => {
      if (!dependencies.collectionSurface) return reply.code(503).send();
      const result =
        await dependencies.collectionSurface.unlinkDiscoveredPlexItems(
          request.params.id
        );
      return (
        result ??
        reply.code(409).send({
          message: 'This discovered Plex item is not in an active link group.',
        })
      );
    }
  );

  app.get<{ Querystring: { query?: string; libraryId?: string } }>(
    '/api/posters/overlays/test-items',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.searchItems) {
        return reply
          .code(503)
          .send({ message: 'Poster test search is unavailable.' });
      }
      const query = request.query.query?.trim() ?? '';
      return {
        results: await dependencies.posterOverlays.searchItems(
          query,
          request.query.libraryId?.trim() || undefined
        ),
      };
    }
  );

  app.get<{ Params: { ratingKey: string } }>(
    '/api/posters/overlays/items/:ratingKey/poster',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.posterForItem)
        return reply
          .code(503)
          .send({ message: 'Plex poster preview is unavailable.' });
      const bytes = await dependencies.posterOverlays.posterForItem(
        request.params.ratingKey
      );
      if (!bytes)
        return reply.code(404).send({ message: 'Poster was not found.' });
      return reply.type('image/jpeg').send(Buffer.from(bytes));
    }
  );

  app.post<{ Body: { ratingKey: string } }>(
    '/api/posters/overlays/test',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.testItem) {
        return reply
          .code(503)
          .send({ message: 'Poster testing is unavailable.' });
      }
      const result = await dependencies.posterOverlays.testItem(
        request.body.ratingKey
      );
      if (!result)
        return reply
          .code(404)
          .send({ message: 'The selected Plex item was not found.' });
      return result;
    }
  );

  app.post<{ Params: { ratingKey: string } }>(
    '/api/posters/overlays/items/:ratingKey/apply',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.applyItem)
        return reply.code(503).send({ message: 'Single-item poster application is unavailable.' });
      const result = await dependencies.posterOverlays.applyItem(
        request.params.ratingKey
      );
      if (!result)
        return reply.code(404).send({ message: 'The selected Plex item was not found.' });
      return result;
    }
  );

  app.post<{ Params: { ratingKey: string } }>(
    '/api/posters/overlays/items/:ratingKey/reset',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.resetItem)
        return reply.code(503).send({ message: 'Single-item poster restoration is unavailable.' });
      const result = await dependencies.posterOverlays.resetItem(
        request.params.ratingKey
      );
      if (!result)
        return reply.code(404).send({ message: 'The selected Plex item was not found.' });
      return result;
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/posters/overlays/libraries/:id/cancel',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.cancelLibraryJob) {
        return reply
          .code(503)
          .send({ message: 'Poster overlay jobs are unavailable.' });
      }
      const updated = await dependencies.posterOverlays.cancelLibraryJob(
        request.params.id
      );
      if (!updated)
        return reply
          .code(409)
          .send({
            message: 'No active overlay job was found for this library.',
          });
      return updated;
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/posters/overlays/libraries/:id/reset',
    async (request, reply) => {
      if (!dependencies.posterOverlays?.resetLibrary) {
        return reply
          .code(503)
          .send({ message: 'Poster reset jobs are unavailable.' });
      }
      const updated = await dependencies.posterOverlays.resetLibrary(
        request.params.id
      );
      if (!updated)
        return reply
          .code(409)
          .send({
            message:
              'This library is already processing or could not be found.',
          });
      return updated;
    }
  );

  app.get<{ Params: { kind: DashboardJobKind } }>(
    '/api/dashboard/jobs/:kind',
    async (request, reply) => {
      if (!dependencies.dashboardJobs) return reply.code(503).send();
      if (!['collections', 'overlays'].includes(request.params.kind)) {
        return reply.code(400).send({ message: 'Unknown dashboard job type.' });
      }
      return dependencies.dashboardJobs.status(request.params.kind);
    }
  );

  app.post<{ Params: { kind: DashboardJobKind } }>(
    '/api/dashboard/jobs/:kind/start',
    async (request, reply) => {
      if (!dependencies.dashboardJobs) return reply.code(503).send();
      if (!['collections', 'overlays'].includes(request.params.kind)) {
        return reply.code(400).send({ message: 'Unknown dashboard job type.' });
      }
      try {
        return reply
          .code(202)
          .send(await dependencies.dashboardJobs.start(request.params.kind));
      } catch (error) {
        return reply.code(409).send({
          code: 'job-already-running',
          message:
            error instanceof Error ? error.message : 'Job is already running.',
        });
      }
    }
  );

  app.get('/api/dashboard/summary', async (_request, reply) => {
    if (!dependencies.dashboardInsights) return reply.code(503).send();
    return dependencies.dashboardInsights.summary();
  });

  app.get<{ Querystring: { days?: string } }>(
    '/api/dashboard/collection-statistics',
    async (request, reply) => {
      if (!dependencies.dashboardInsights) return reply.code(503).send();
      const days = Number(request.query.days ?? 30);
      if (!Number.isInteger(days) || days < 0 || days > 9999) {
        return reply.code(400).send({
          message: 'Days must be a whole number from 0 through 9999.',
        });
      }
      return {
        collections:
          await dependencies.dashboardInsights.collectionStatistics(days),
        days,
        timestamp: dependencies.now().toISOString(),
      };
    }
  );

  app.get<{
    Querystring: {
      mediaType?: 'movie' | 'show';
      requestStatus?: DashboardMissingItem['requestStatus'];
      collectionSource?: string;
      requestService?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/dashboard/missing-items', async (request, reply) => {
    if (!dependencies.dashboardInsights) return reply.code(503).send();
    const mediaType = request.query.mediaType;
    const requestStatus = request.query.requestStatus;
    const limit = Number(request.query.limit ?? 5);
    const offset = Number(request.query.offset ?? 0);
    if (
      (mediaType !== undefined && !['movie', 'show'].includes(mediaType)) ||
      (requestStatus !== undefined &&
        ![
          'pending',
          'approved',
          'declined',
          'available',
          'processing',
          'failed',
          'partially-available',
        ].includes(requestStatus)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      return reply.code(400).send({ message: 'Invalid missing-item query.' });
    }
    const page = await dependencies.dashboardInsights.missingItems(
      {
        ...(mediaType ? { mediaType } : {}),
        ...(requestStatus ? { requestStatus } : {}),
        ...(request.query.collectionSource?.trim()
          ? { collectionSource: request.query.collectionSource.trim() }
          : {}),
        ...(request.query.requestService?.trim()
          ? { requestService: request.query.requestService.trim() }
          : {}),
      },
      limit,
      offset
    );
    return {
      ...page,
      limit,
      offset,
      timestamp: dependencies.now().toISOString(),
    };
  });

  app.post('/api/dashboard/missing-items/sync', async (_request, reply) => {
    if (!dependencies.dashboardInsights) return reply.code(503).send();
    await dependencies.dashboardInsights.syncMissingItems();
    return reply.code(202).send({ accepted: true });
  });

  app.get('/api/collections', async (_request, reply) => {
    if (!dependencies.collectionSurface) return reply.code(503).send();
    return dependencies.collectionSurface.get();
  });
  app.post<{ Params: { id: string } }>(
    '/api/collections/:id/sync',
    async (request, reply) => {
      if (!dependencies.collectionSurface || !dependencies.dashboardJobs)
        return reply
          .code(503)
          .send({ message: 'Collection synchronization is unavailable.' });
      const surface = await dependencies.collectionSurface.get();
      if (!surface.collections.some((item) => item.id === request.params.id))
        return reply
          .code(404)
          .send({ message: 'Collection was not found.' });
      try {
        return reply
          .code(202)
          .send(
            await dependencies.dashboardJobs.startSelected('collections', [
              request.params.id,
            ])
          );
      } catch (error) {
        return reply.code(409).send({
          code: 'collection-sync-conflict',
          message:
            error instanceof Error
              ? error.message
              : 'Collection synchronization is already running.',
        });
      }
    }
  );
  app.get<{ Params: { id: string } }>(
    '/api/collections/:id/preview',
    async (request, reply) => {
      if (!dependencies.collectionSurface?.preview)
        return reply
          .code(503)
          .send({ message: 'Collection preview is unavailable.' });
      try {
        const preview = await dependencies.collectionSurface.preview(
          request.params.id
        );
        return (
          preview ??
          reply.code(404).send({ message: 'Collection was not found.' })
        );
      } catch (error) {
        return reply.code(502).send({
          code: 'collection-preview-failed',
          message:
            error instanceof Error
              ? error.message
              : 'Collection preview failed.',
        });
      }
    }
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<
      Pick<
        ManagedCollection,
        | 'homeVisible'
        | 'recommendedVisible'
        | 'libraryVisible'
        | 'sharedOrder'
        | 'libraryOrder'
      >
    >;
  }>('/api/collections/:id/placement', async (request, reply) => {
    if (!dependencies.collectionSurface) return reply.code(503).send();
    const input = request.body ?? {};
    const allowed = new Set([
      'homeVisible',
      'recommendedVisible',
      'libraryVisible',
      'sharedOrder',
      'libraryOrder',
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
      return reply.code(400).send({
        code: 'invalid-collection-placement',
        message: 'Only collection visibility and ordering can be changed here.',
      });
    }
    const updated = await dependencies.collectionSurface.updatePlacement(
      request.params.id,
      input
    );
    if (!updated) {
      return reply.code(404).send({
        code: 'collection-not-found',
        message: 'That collection no longer exists.',
      });
    }
    return updated;
  });

  app.post<{
    Body: {
      type: CollectionDraft['sourceType'];
      subtype: string;
      customUrl?: string;
    };
  }>('/api/collections/source/validate', async (request, reply) => {
    const { type, subtype, customUrl } = request.body ?? {};
    if (!type || !subtype)
      return reply
        .code(400)
        .send({ valid: false, message: 'Choose a source and subtype first.' });
    if (dependencies.collectionSourceValidator) {
      try {
        const validated = await dependencies.collectionSourceValidator({
          type,
          subtype,
          ...(customUrl ? { customUrl } : {}),
        });
        if (validated) return validated;
      } catch (error) {
        return reply.code(400).send({
          valid: false,
          message:
            error instanceof Error
              ? error.message
              : 'The collection source could not be validated.',
        });
      }
    }
    if (
      subtype === 'custom' ||
      (type === 'letterboxd' && subtype === 'watchlist')
    ) {
      try {
        const url = new URL(customUrl ?? '');
        const providers: Partial<
          Record<CollectionDraft['sourceType'], readonly string[]>
        > = {
          trakt: ['trakt.tv', 'app.trakt.tv'],
          tmdb: ['themoviedb.org', 'www.themoviedb.org'],
          imdb: ['imdb.com', 'www.imdb.com'],
          letterboxd: ['letterboxd.com', 'www.letterboxd.com'],
          mdblist: ['mdblist.com', 'www.mdblist.com'],
          anilist: ['anilist.co', 'www.anilist.co'],
        };
        if (!providers[type]?.includes(url.hostname.toLowerCase()))
          return reply
            .code(400)
            .send({ valid: false, message: `Enter a valid ${type} URL.` });
        const path = url.pathname.toLowerCase();
        const contentType =
          path.includes('/tv') || path.includes('anime')
            ? 'show'
            : path.includes('/movie')
              ? 'movie'
              : 'mixed';
        return {
          valid: true,
          title:
            url.pathname
              .split('/')
              .filter(Boolean)
              .at(-1)
              ?.replace(/[-_]/g, ' ') || `${type} custom list`,
          contentType,
        };
      } catch {
        return reply
          .code(400)
          .send({ valid: false, message: `Enter a valid ${type} URL.` });
      }
    }
    const contentType =
      type === 'mal' || type === 'anilist' || type === 'sonarrtag'
        ? 'show'
        : type === 'radarrtag'
          ? 'movie'
          : 'mixed';
    return {
      valid: true,
      title: `${type} ${subtype}`.replace(/[_-]/g, ' '),
      contentType,
    };
  });

  const validateCollectionDraft = async (
    draft: CollectionDraft | undefined
  ) => {
    if (!draft?.title?.trim() || !draft.libraryId)
      return 'Collection name and Plex library are required.';
    const itemType = draft.itemType ?? draft.mediaType;
    if (itemType === 'movie' && draft.mediaType !== 'movie')
      return 'Movie collections require a Movie library.';
    if ((itemType === 'show' || itemType === 'season' || itemType === 'episode') && draft.mediaType !== 'show')
      return 'TV show, season, and episode collections require a TV library.';
    if ((itemType === 'season' || itemType === 'episode') && draft.sourceType !== 'manual')
      return 'Season and episode collections currently require manually selected Plex items.';
    if ((itemType === 'season' || itemType === 'episode') && draft.behaviorSettings?.showUnwatchedOnly)
      return 'Unwatched-only filtering is available for Movies and TV Shows, not seasons or episodes.';
    const settings = draft.sourceSettings;
    if (
      !settings ||
      !Number.isInteger(settings.maxItems) ||
      settings.maxItems < 1 ||
      settings.maxItems > 9999
    ) {
      return 'Maximum items must be a whole number between 1 and 9,999.';
    }
    const subtypeOptional = [
      'manual',
      'networks',
      'originals',
      'radarrtag',
      'sonarrtag',
      'multi-source',
    ];
    if (!subtypeOptional.includes(draft.sourceType) && !settings.subtype)
      return 'Choose a collection subtype.';
    if (draft.sourceType === 'manual') {
      if (!settings.manualMembers?.length)
        return 'Add at least one Plex item to the manual collection.';
      if (
        itemType === 'season' &&
        settings.manualMembers.some((member) => member.type !== 'season')
      ) return 'Season collections can contain only Plex seasons.';
      if (
        itemType === 'episode' &&
        settings.manualMembers.some((member) => member.type !== 'episode')
      ) return 'Episode collections can contain only Plex episodes.';
    }
    if (
      draft.sourceType === 'seerr' &&
      settings.subtype === 'user' &&
      (!Number.isInteger(settings.seerrUserId) || settings.seerrUserId! < 1)
    ) return 'Choose a valid Seerr user ID for this private collection.';
    if (
      draft.sourceType === 'radarrtag' ||
      draft.sourceType === 'sonarrtag'
    ) {
      const expectedMediaType =
        draft.sourceType === 'radarrtag' ? 'movie' : 'show';
      if (draft.mediaType !== expectedMediaType)
        return draft.sourceType === 'radarrtag'
          ? 'Radarr tag sources require a Movie library.'
          : 'Sonarr tag sources require a TV library.';
      if (
        !settings.arrServerId?.trim() ||
        !Number.isInteger(settings.arrTagId) ||
        Number(settings.arrTagId) < 1
      )
        return `Choose a verified ${draft.sourceType === 'radarrtag' ? 'Radarr' : 'Sonarr'} server and tag.`;
    }
    if (
      draft.sourceType === 'plex' &&
      ['genres', 'decades', 'resolutions', 'content-ratings'].includes(
        settings.subtype
      )
    ) {
      const generator = settings.plexGenerator;
      if (!generator)
        return 'Configure the Plex library value generator.';
      if (
        !generator.titleTemplate.trim() ||
        !generator.titleTemplate.includes('{value}')
      )
        return 'The collection title template must contain {value}.';
      if (
        settings.subtype === 'content-ratings' &&
        !generator.enabledRatingGroups.length
      )
        return 'Enable at least one content-rating group.';
    }
    if (draft.sourceType === 'multi-source') {
      const multi = draft.multiSourceSettings;
      if (!multi || multi.sources.length < 2)
        return 'Multi-source collections require at least two sources.';
      if (
        new Set(multi.sources.map((source) => source.id)).size !==
        multi.sources.length
      )
        return 'Every combined source must have a unique identifier.';
      if (multi.sources.some((source) => !source.type || !source.subtype))
        return 'Choose a type and subtype for every combined source.';
      if (multi.sources.some((source) => source.validation?.state !== 'valid'))
        return 'Validate every combined source before saving.';
      const contentTypes = new Set(
        multi.sources.map((source) => source.validation?.contentType)
      );
      const mixed =
        contentTypes.has('mixed') ||
        (contentTypes.has('movie') && contentTypes.has('show'));
      if (mixed && multi.combineMode !== 'cycle-lists')
        return 'Mixed movie and show sources must use Cycle lists mode.';
    }
    const metadata = draft.metadataSettings;
    if (!metadata) return 'Collection metadata settings are required.';
    if (metadata.enableCustomSummary && !metadata.customSummary.trim())
      return 'Enter a custom collection summary or turn the option off.';
    if (metadata.customSummary.length > 5000)
      return 'Custom collection summaries cannot exceed 5,000 characters.';
    if (metadata.enableCustomWallpaper && !metadata.wallpaper)
      return 'Upload a custom wallpaper or turn the option off.';
    if (metadata.enableCustomTheme && !metadata.theme)
      return 'Upload custom theme music or turn the option off.';
    for (const asset of [metadata.wallpaper, metadata.theme]) {
      if (!asset) continue;
      if (asset.size <= 0 || asset.size > 10 * 1024 * 1024)
        return 'Collection artwork and theme files must be smaller than 10 MB.';
      if (!asset.previewDataUrl.startsWith(`data:${asset.mimeType};base64,`))
        return 'Collection asset data does not match its declared media type.';
    }
    if (
      draft.sourceType === 'tmdb' &&
      settings.subtype === 'advanced_custom_tmdb'
    ) {
      const discover = draft.tmdbDiscoverSettings;
      if (!discover?.filterGroups.length)
        return 'Add at least one TMDB advanced filter group.';
      const allowedFields = new Set([
        'watch_region',
        'with_watch_providers',
        'with_watch_monetization_types',
        'with_genres',
        'without_genres',
        'with_cast',
        'with_crew',
        'with_people',
        'with_companies',
        'with_keywords',
        'without_keywords',
        'with_networks',
        'first_air_date_year',
        'first_air_date.gte',
        'first_air_date.lte',
        'air_date.gte',
        'air_date.lte',
        'include_null_first_air_dates',
        'screened_theatrically',
        'with_status',
        'with_type',
        'timezone',
        'with_release_type',
        'vote_average.gte',
        'vote_average.lte',
        'vote_count.gte',
        'vote_count.lte',
        'primary_release_year',
        'primary_release_date.gte',
        'primary_release_date.lte',
        'release_date.gte',
        'release_date.lte',
        'with_runtime.gte',
        'with_runtime.lte',
        'with_original_language',
        'with_origin_country',
        'certification_country',
        'certification',
        'certification.gte',
        'certification.lte',
        'include_adult',
        'include_video',
      ]);
      const groupIds = discover.filterGroups.map((group) => group.id);
      if (new Set(groupIds).size !== groupIds.length)
        return 'Every TMDB filter group must have a unique identifier.';
      for (const group of discover.filterGroups) {
        if (!group.filters.length)
          return 'Every TMDB filter group must contain at least one filter.';
        if (
          new Set(group.filters.map((rule) => rule.id)).size !==
          group.filters.length
        )
          return 'Every TMDB filter must have a unique identifier within its group.';
        for (const rule of group.filters) {
          if (!allowedFields.has(rule.field))
            return `Unsupported TMDB discover field: ${rule.field}.`;
          if (typeof rule.value === 'string' && !rule.value.trim())
            return `Enter a value for TMDB field ${rule.field}.`;
          if (typeof rule.value === 'number' && !Number.isFinite(rule.value))
            return `Enter a valid number for TMDB field ${rule.field}.`;
        }
      }
    }
    const urlHosts: Partial<
      Record<CollectionDraft['sourceType'], readonly string[]>
    > = {
      trakt: ['trakt.tv', 'app.trakt.tv'],
      tmdb: ['themoviedb.org', 'www.themoviedb.org'],
      imdb: ['imdb.com', 'www.imdb.com'],
      letterboxd: ['letterboxd.com', 'www.letterboxd.com'],
      mdblist: ['mdblist.com', 'www.mdblist.com'],
      anilist: ['anilist.co', 'www.anilist.co'],
    };
    const needsUrl =
      !!urlHosts[draft.sourceType] &&
      (settings.subtype === 'custom' ||
        (draft.sourceType === 'letterboxd' &&
          settings.subtype === 'watchlist'));
    if (needsUrl) {
      try {
        if (draft.sourceType === 'mdblist') {
          parseMDBListUrl(settings.customUrl ?? '');
        }
        const parsed = new URL(settings.customUrl ?? '');
        if (
          parsed.protocol !== 'https:' ||
          !urlHosts[draft.sourceType]?.includes(parsed.hostname.toLowerCase())
        )
          return `Enter a valid ${draft.sourceType} URL.`;
      } catch {
        return `Enter a valid ${draft.sourceType} URL.`;
      }
    }
    if (
      settings.subtype === 'random' &&
      ['trakt', 'imdb', 'letterboxd'].includes(draft.sourceType)
    ) {
      const values = (settings.randomListUrls ?? [])
        .map((value) => value.trim())
        .filter((value) => value && !value.startsWith('#'));
      if (!values.length)
        return 'Add at least one public list URL to the random list pool.';
      const allowedHosts: Record<string, readonly string[]> = {
        trakt: ['trakt.tv', 'app.trakt.tv'],
        imdb: ['imdb.com', 'www.imdb.com'],
        letterboxd: ['letterboxd.com', 'www.letterboxd.com'],
      };
      try {
        for (const value of values) {
          const parsed = new URL(value);
          if (
            parsed.protocol !== 'https:' ||
            !allowedHosts[draft.sourceType]?.includes(
              parsed.hostname.toLowerCase()
            )
          )
            throw new Error('invalid host');
        }
      } catch {
        return `Every random list entry must be a valid HTTPS ${draft.sourceType} URL.`;
      }
    }
    const behavior = draft.behaviorSettings;
    if (!behavior)
      return 'Collection visibility and scheduling settings are required.';
    if ((behavior.excludedTitles?.length ?? 0) > 500)
      return 'A collection can exclude at most 500 exact titles.';
    if ((behavior.mutuallyExclusiveCollectionIds?.length ?? 0) > 100)
      return 'A collection can reference at most 100 mutually exclusive collections.';
    if (behavior.mutuallyExclusiveCollectionIds?.some((value) => !/^[0-9a-f-]{36}$/i.test(value)))
      return 'Mutually exclusive collections must use valid managed collection IDs.';
    const restriction = behavior.timeRestriction;
    if (!restriction.alwaysActive) {
      if (!Object.values(restriction.weeklySchedule).some(Boolean))
        return 'Select at least one active day of the week.';
      const datePattern = /^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])$/;
      if (
        restriction.dateRanges.some(
          (range) =>
            !datePattern.test(range.startDate) ||
            !datePattern.test(range.endDate)
        )
      ) {
        return 'Active date ranges must use valid DD-MM values.';
      }
    }
    const schedule = behavior.syncSchedule;
    if (schedule.enabled && schedule.scheduleType === 'custom') {
      const fields = schedule.customCron.trim().split(/\s+/);
      if (fields.length !== 5)
        return 'Custom collection schedules must use a five-part cron expression.';
    }
    if (
      schedule.enabled &&
      schedule.scheduleType === 'preset' &&
      !schedule.startNow
    ) {
      if (
        !/^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])$/.test(schedule.startDate) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.startTime)
      ) {
        return 'Schedule start date and time must use DD-MM and HH:MM formats.';
      }
    }
    const missing = draft.missingMediaSettings;
    if (!missing) return 'Missing-media settings are required.';
    if (
      missing.enabled &&
      !missing.searchMissingMovies &&
      !missing.searchMissingTv
    )
      return 'Select missing movies, missing TV shows, or turn off missing-item grabbing.';
    if (missing.enabled && missing.downloadMode === 'direct') {
      const destinations = [
        ...(missing.searchMissingMovies
          ? [['Radarr', missing.directRadarr] as const]
          : []),
        ...(missing.searchMissingTv
          ? [['Sonarr', missing.directSonarr] as const]
          : []),
      ];
      const monitorTypes = new Set([
        'all',
        'future',
        'missing',
        'existing',
        'pilot',
        'firstSeason',
        'latestSeason',
        'none',
      ]);
      for (const [service, destination] of destinations) {
        if (
          !destination?.serverId ||
          destination.profileId === undefined ||
          !destination.rootFolder
        ) {
          return `Choose a ${service} server, quality profile, and root folder for direct downloads.`;
        }
        if (
          !Number.isInteger(destination.profileId) ||
          destination.profileId < 0
        ) {
          return `${service} quality profile identifiers must be non-negative whole numbers.`;
        }
        if (
          new Set(destination.tagIds).size !== destination.tagIds.length ||
          destination.tagIds.some(
            (tagId) => !Number.isInteger(tagId) || tagId < 0
          )
        ) {
          return `${service} tags must use unique non-negative whole-number identifiers.`;
        }
        if (
          service === 'Sonarr' &&
          !monitorTypes.has(destination.monitorType)
        ) {
          return 'Choose a supported Sonarr monitor type.';
        }
        if (!dependencies.watchlists) {
          return `${service} destination options are unavailable. Configure downloads and retry.`;
        }
        try {
          const options = await dependencies.watchlists.options(
            service === 'Radarr' ? 'radarr' : 'sonarr'
          );
          const serverOptions = options.serverOptions[destination.serverId];
          if (
            !options.servers.some(
              (server) => server.id === destination.serverId
            ) ||
            !serverOptions ||
            !serverOptions.profiles.some(
              (profile) => profile.id === destination.profileId
            ) ||
            !serverOptions.rootFolders.some(
              (folder) => folder.path === destination.rootFolder
            ) ||
            destination.tagIds.some(
              (tagId) => !serverOptions.tags.some((tag) => tag.id === tagId)
            )
          ) {
            return `The selected ${service} server, quality profile, root folder, or tag is no longer available. Reload destination options before saving.`;
          }
        } catch {
          return `${service} destination options could not be verified. Retry after confirming the download service is reachable.`;
        }
      }
    }
    if (missing.enabled && missing.downloadMode === 'seerr') {
      const destinations = [
        ...(missing.searchMissingMovies
          ? [['Radarr', missing.seerrRadarr] as const]
          : []),
        ...(missing.searchMissingTv
          ? [['Sonarr', missing.seerrSonarr] as const]
          : []),
      ];
      if (!dependencies.seerr) {
        return 'Seerr destination options are unavailable. Configure Seerr and retry.';
      }
      let options: Awaited<ReturnType<SeerrConfigurationService['options']>>;
      try {
        options = await dependencies.seerr.options();
      } catch {
        return 'Seerr destination options could not be verified. Retest the Seerr connection and retry.';
      }
      for (const [service, destination] of destinations) {
        if (
          destination?.serverId === undefined ||
          destination.profileId === undefined ||
          !destination.rootFolder
        ) {
          return `Choose a Seerr ${service} server, quality profile, and root folder.`;
        }
        if (
          !Number.isInteger(destination.serverId) ||
          destination.serverId < 0 ||
          !Number.isInteger(destination.profileId) ||
          destination.profileId < 0 ||
          new Set(destination.tagIds).size !== destination.tagIds.length ||
          destination.tagIds.some(
            (tagId) => !Number.isInteger(tagId) || tagId < 0
          )
        ) {
          return `Seerr ${service} destination identifiers must be unique non-negative whole numbers.`;
        }
        const servers =
          service === 'Radarr'
            ? options.servers.radarr
            : options.servers.sonarr;
        const serverOptions =
          service === 'Radarr'
            ? options.radarrServerOptions[destination.serverId]
            : options.sonarrServerOptions[destination.serverId];
        if (
          !servers.some((server) => server.id === destination.serverId) ||
          !serverOptions ||
          !serverOptions.profiles.some(
            (profile) => profile.id === destination.profileId
          ) ||
          !serverOptions.rootFolders.some(
            (folder) => folder.path === destination.rootFolder
          ) ||
          destination.tagIds.some(
            (tagId) => !serverOptions.tags.some((tag) => tag.id === tagId)
          )
        ) {
          return `The selected Seerr ${service} server, quality profile, root folder, or tag is no longer available. Reload destination options before saving.`;
        }
      }
    }
    if (
      missing.maxSeasonsToRequest < 0 ||
      missing.maxSeasonsToRequest > 50 ||
      missing.seasonsPerShowLimit < 0 ||
      missing.seasonsPerShowLimit > 50
    ) {
      return 'Season request limits must be between 0 and 50.';
    }
    if (
      missing.createPlaceholders &&
      (missing.placeholderDaysAhead < 1 || missing.placeholderDaysAhead > 730)
    ) {
      return 'Placeholder days ahead must be between 1 and 730.';
    }
    if (
      missing.createPlaceholders &&
      (missing.placeholderReleasedDays < 1 ||
        missing.placeholderReleasedDays > 30)
    ) {
      return 'Released placeholder retention must be between 1 and 30 days.';
    }
    for (const filters of [
      missing.requestFilters,
      missing.placeholderFilters,
    ]) {
      if (filters.maximumPosition < 0 || filters.maximumPosition > 9999)
        return 'Maximum source position must be between 0 and 9,999.';
      if (filters.minimumYear < 0 || filters.minimumYear > 2200)
        return 'Minimum release year must be between 0 and 2,200.';
      if (filters.minimumImdbRating < 0 || filters.minimumImdbRating > 10)
        return 'Minimum IMDb rating must be between 0 and 10.';
      if (
        filters.minimumRottenTomatoesRating < 0 ||
        filters.minimumRottenTomatoesRating > 100 ||
        filters.minimumRottenTomatoesAudienceRating < 0 ||
        filters.minimumRottenTomatoesAudienceRating > 100
      ) {
        return 'Rotten Tomatoes ratings must be between 0 and 100.';
      }
    }
    return undefined;
  };

  app.post<{ Body: CollectionDraft }>(
    '/api/collections',
    async (request, reply) => {
      if (!dependencies.collectionSurface) return reply.code(503).send();
      const validationError = await validateCollectionDraft(request.body);
      if (validationError) {
        return reply.code(400).send({
          code: 'invalid-collection',
          message: validationError,
        });
      }
      return reply
        .code(201)
        .send(
          await dependencies.collectionSurface.save(undefined, request.body)
        );
    }
  );

  app.put<{ Params: { id: string }; Body: CollectionDraft }>(
    '/api/collections/:id',
    async (request, reply) => {
      if (!dependencies.collectionSurface) return reply.code(503).send();
      const validationError = await validateCollectionDraft(request.body);
      if (validationError) {
        return reply.code(400).send({
          code: 'invalid-collection',
          message: validationError,
        });
      }
      const collection = await dependencies.collectionSurface.save(
        request.params.id,
        request.body
      );
      return collection
        ? collection
        : reply.code(404).send({ message: 'Collection was not found.' });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/collections/:id/copy',
    async (request, reply) => {
      if (!dependencies.collectionSurface) return reply.code(503).send();
      const collection = await dependencies.collectionSurface.copy(
        request.params.id
      );
      return collection
        ? reply.code(201).send(collection)
        : reply.code(404).send({ message: 'Collection was not found.' });
    }
  );

  app.post<{ Params: { id: string }; Body: { memberIds?: string[] } }>(
    '/api/collections/:id/link',
    async (request, reply) => {
      if (!dependencies.collectionSurface) return reply.code(503).send();
      const memberIds = request.body?.memberIds;
      if (
        !Array.isArray(memberIds) ||
        memberIds.some((id) => typeof id !== 'string')
      ) {
        return reply
          .code(400)
          .send({ message: 'memberIds must be an array of collection IDs.' });
      }
      const result = await dependencies.collectionSurface.link(
        request.params.id,
        memberIds
      );
      return (
        result ??
        reply.code(409).send({
          message: 'Choose compatible collections in different Plex libraries.',
        })
      );
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/collections/:id/unlink',
    async (request, reply) => {
      if (!dependencies.collectionSurface) return reply.code(503).send();
      const result = await dependencies.collectionSurface.unlink(
        request.params.id
      );
      return (
        result ??
        reply
          .code(409)
          .send({ message: 'This collection is not in an active link group.' })
      );
    }
  );

  app.get('/api/settings/about', async (_request, reply) => {
    if (!dependencies.aboutInformation) return reply.code(503).send();
    return dependencies.aboutInformation();
  });

  app.delete<{ Params: { id: string } }>(
    '/api/collections/:id',
    async (request, reply) => {
      if (!dependencies.collectionSurface) return reply.code(503).send();
      return (await dependencies.collectionSurface.delete(request.params.id))
        ? reply.code(204).send()
        : reply.code(404).send({ message: 'Collection was not found.' });
    }
  );

  app.get('/api/settings/general', async (_request, reply) => {
    if (!dependencies.generalSettings) return reply.code(503).send();
    return dependencies.generalSettings.get();
  });

  app.put<{
    Body: { expectedRevision: number; settings: GeneralSettingsDraft };
  }>('/api/settings/general', async (request, reply) => {
    if (!dependencies.generalSettings) return reply.code(503).send();
    const settings = request.body?.settings;
    if (
      !Number.isInteger(request.body?.expectedRevision) ||
      !settings?.applicationTitle?.trim() ||
      !settings.applicationUrl ||
      !settings.locale ||
      !Number.isInteger(settings.imageCacheDays) ||
      settings.imageCacheDays < 1 ||
      settings.imageCacheDays > 3650 ||
      (settings.globalExcludedTitles?.length ?? 0) > 500 ||
      settings.globalExcludedTitles?.some(
        (title) => typeof title !== 'string' || !title.trim() || title.length > 300
      )
    ) {
      return reply.code(400).send({
        code: 'invalid-general-settings',
        message:
          'Review the application name, URL, locale, and cache duration.',
      });
    }
    try {
      new URL(settings.applicationUrl);
    } catch {
      return reply.code(400).send({
        code: 'invalid-application-url',
        message: 'Application URL must be a complete http or https URL.',
      });
    }
    if (!/^https?:\/\//i.test(settings.applicationUrl)) {
      return reply.code(400).send({
        code: 'invalid-application-url',
        message: 'Application URL must use http or https.',
      });
    }
    const saved = await dependencies.generalSettings.save(
      request.body.expectedRevision,
      settings
    );
    return saved
      ? saved
      : reply.code(409).send({
          code: 'settings-conflict',
          message: 'Settings changed in another browser. Reload and try again.',
        });
  });

  app.post(
    '/api/settings/general/regenerate-api-key',
    async (_request, reply) => {
      if (!dependencies.generalSettings) return reply.code(503).send();
      return dependencies.generalSettings.regenerateApiKey();
    }
  );

  app.post(
    '/api/settings/general/clear-image-cache',
    async (_request, reply) => {
      if (!dependencies.generalSettings) return reply.code(503).send();
      return dependencies.generalSettings.clearImageCache();
    }
  );

  app.get<{
    Querystring: {
      level?: ApplicationLogEntry['level'];
      search?: string;
      page?: string;
      pageSize?: string;
    };
  }>('/api/settings/logs', async (request, reply) => {
    if (!dependencies.applicationLogs) return reply.code(503).send();
    const level = request.query.level ?? 'debug';
    const page = Number(request.query.page ?? 1);
    const pageSize = Number(request.query.pageSize ?? 25);
    if (
      !['debug', 'info', 'warn', 'error'].includes(level) ||
      !Number.isInteger(page) ||
      page < 1 ||
      ![10, 25, 50, 100].includes(pageSize)
    ) {
      return reply.code(400).send({ message: 'Invalid log query.' });
    }
    const rank = { debug: 0, info: 1, warn: 2, error: 3 };
    const search = request.query.search?.trim().toLowerCase() ?? '';
    const sensitiveValues =
      (await dependencies.applicationLogs.sensitiveValues?.()) ?? [];
    const all = (await dependencies.applicationLogs.list())
      .map((entry) => redactApplicationLogEntry(entry, sensitiveValues))
      .filter(
        (entry) =>
          rank[entry.level] >= rank[level] &&
          (!search ||
            `${entry.label ?? ''} ${entry.message} ${JSON.stringify(entry.data ?? {})}`
              .toLowerCase()
              .includes(search))
      )
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    const safePage = Math.min(page, pages);
    return {
      results: all.slice((safePage - 1) * pageSize, safePage * pageSize),
      total: all.length,
      page: safePage,
      pageSize,
      pages,
      appDataPath: await dependencies.applicationLogs.appDataPath(),
      timestamp: dependencies.now().toISOString(),
    };
  });

  app.get('/api/settings/logs/export', async (_request, reply) => {
    if (!dependencies.applicationLogs) return reply.code(503).send();
    const sensitiveValues =
      (await dependencies.applicationLogs.sensitiveValues?.()) ?? [];
    const payload = {
      generatedAt: dependencies.now().toISOString(),
      note: 'Secrets and authentication values are excluded from this diagnostic export.',
      ...(dependencies.aboutInformation
        ? { system: await dependencies.aboutInformation() }
        : {}),
      logs: (await dependencies.applicationLogs.list()).map((entry) =>
        redactApplicationLogEntry(entry, sensitiveValues)
      ),
    };
    return reply
      .header('cache-control', 'no-store')
      .header('content-disposition', 'attachment; filename="vynode-debug.json"')
      .type('application/json')
      .send(JSON.stringify(payload, null, 2));
  });

  app.get('/api/settings/jobs', async (_request, reply) => {
    if (!dependencies.jobsAndCache) return reply.code(503).send();
    return dependencies.jobsAndCache.jobs();
  });

  app.post<{ Params: { id: string } }>(
    '/api/settings/jobs/:id/run',
    async (request, reply) => {
      if (!dependencies.jobsAndCache) return reply.code(503).send();
      const current = (await dependencies.jobsAndCache.jobs()).find(
        (item) => item.id === request.params.id
      );
      if (!current)
        return reply.code(404).send({ message: 'Job was not found.' });
      if (current.running)
        return reply.code(409).send({ message: 'Job is already running.' });
      const job = await dependencies.jobsAndCache.run(request.params.id);
      return job
        ? reply.code(202).send(job)
        : reply.code(404).send({ message: 'Job was not found.' });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/settings/jobs/:id/cancel',
    async (request, reply) => {
      if (!dependencies.jobsAndCache) return reply.code(503).send();
      const current = (await dependencies.jobsAndCache.jobs()).find(
        (item) => item.id === request.params.id
      );
      if (!current)
        return reply.code(404).send({ message: 'Job was not found.' });
      if (!current.running)
        return reply.code(409).send({ message: 'Job is not running.' });
      const job = await dependencies.jobsAndCache.cancel(request.params.id);
      return job
        ? reply.code(202).send(job)
        : reply.code(404).send({ message: 'Job was not found.' });
    }
  );

  app.put<{ Params: { id: string }; Body: { cronSchedule: string } }>(
    '/api/settings/jobs/:id/schedule',
    async (request, reply) => {
      if (!dependencies.jobsAndCache) return reply.code(503).send();
      const cronSchedule = request.body?.cronSchedule?.trim();
      if (!cronSchedule || !isValidCronExpression(cronSchedule)) {
        return reply.code(400).send({
          message:
            'Schedule must be a valid numeric six-part CRON expression: second minute hour day month weekday.',
        });
      }
      const current = (await dependencies.jobsAndCache.jobs()).find(
        (item) => item.id === request.params.id
      );
      if (!current)
        return reply.code(404).send({ message: 'Job was not found.' });
      if (current.running)
        return reply
          .code(409)
          .send({ message: 'Stop the job before changing its schedule.' });
      const job = await dependencies.jobsAndCache.schedule(
        request.params.id,
        cronSchedule
      );
      return job
        ? job
        : reply.code(404).send({ message: 'Job was not found.' });
    }
  );

  app.get('/api/settings/caches', async (_request, reply) => {
    if (!dependencies.jobsAndCache) return reply.code(503).send();
    return dependencies.jobsAndCache.caches();
  });

  app.post<{ Params: { id: string } }>(
    '/api/settings/caches/:id/flush',
    async (request, reply) => {
      if (!dependencies.jobsAndCache) return reply.code(503).send();
      const current = (await dependencies.jobsAndCache.caches()).find(
        (item) => item.id === request.params.id
      );
      if (!current)
        return reply.code(404).send({ message: 'Cache was not found.' });
      if (current.keys === 0)
        return reply.code(409).send({ message: 'Cache is already empty.' });
      const cache = await dependencies.jobsAndCache.flushCache(
        request.params.id
      );
      return cache
        ? cache
        : reply.code(404).send({ message: 'Cache was not found.' });
    }
  );

  app.post<{ Params: { kind: DashboardJobKind } }>(
    '/api/dashboard/jobs/:kind/cancel',
    async (request, reply) => {
      if (!dependencies.dashboardJobs) return reply.code(503).send();
      if (!['collections', 'overlays'].includes(request.params.kind)) {
        return reply.code(400).send({ message: 'Unknown dashboard job type.' });
      }
      try {
        return reply
          .code(202)
          .send(dependencies.dashboardJobs.cancel(request.params.kind));
      } catch (error) {
        return reply.code(409).send({
          code: 'job-not-running',
          message:
            error instanceof Error ? error.message : 'Job is not running.',
        });
      }
    }
  );

  app.get('/api/plex-webhook/status', async (_request, reply) => {
    if (!dependencies.plexWebhook) return reply.code(503).send();
    return dependencies.plexWebhook.getStatus();
  });

  app.post<{ Body: PlexWebhookPayload }>(
    '/plex-webhook',
    async (request, reply) => {
      if (!dependencies.plexWebhook) return reply.code(503).send();
      let payload: PlexWebhookPayload | undefined;
      try {
        if (request.isMultipart()) {
          for await (const part of request.parts()) {
            if (part.type === 'file') {
              part.file.resume();
              continue;
            }
            if (
              part.fieldname === 'payload' &&
              typeof part.value === 'string'
            ) {
              payload = JSON.parse(part.value) as PlexWebhookPayload;
            }
          }
        } else {
          payload = request.body;
        }
      } catch {
        return reply.code(400).send({
          code: 'invalid-webhook',
          message: 'The Plex webhook payload is missing or invalid JSON.',
        });
      }
      if (!payload || typeof payload.event !== 'string') {
        return reply.code(400).send({
          code: 'invalid-webhook',
          message: 'The Plex webhook payload must include an event.',
        });
      }
      await dependencies.plexWebhook.receive(payload);
      return reply.code(202).send({ accepted: true });
    }
  );

  app.get('/api/onboarding', async () => dependencies.onboarding.get());

  app.get('/api/seerr', async (_request, reply) => {
    if (!dependencies.seerr) return reply.code(503).send();
    const configuration = await dependencies.seerr.get();
    if (!configuration) return reply.code(204).send();
    return configuration;
  });

  app.get('/api/seerr/options', async (_request, reply) => {
    if (!dependencies.seerr) return reply.code(503).send();
    try {
      return await dependencies.seerr.options();
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(400)
          .send({ code: error.code, message: error.message });
      }
      return reply.code(503).send({
        code: 'seerr-options-unavailable',
        message: 'Seerr destination options could not be loaded.',
      });
    }
  });

  app.post<{
    Params: { kind: ArrKind };
    Body: { serverId: number; label: string };
  }>('/api/seerr/tags/:kind', async (request, reply) => {
    if (!dependencies.seerr) return reply.code(503).send();
    if (!['radarr', 'sonarr'].includes(request.params.kind)) {
      return reply.code(400).send({
        code: 'invalid-selection',
        message: 'Unknown Seerr destination type.',
      });
    }
    try {
      return await dependencies.seerr.createTag(
        request.params.kind,
        request.body.serverId,
        request.body.label
      );
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(400)
          .send({ code: error.code, message: error.message });
      }
      return reply.code(503).send({
        code: 'seerr-tag-create-failed',
        message: 'The destination tag could not be created through Seerr.',
      });
    }
  });

  app.post<{ Body: { endpoint: SeerrEndpointDraft } }>(
    '/api/seerr/test',
    async (request, reply) => {
      if (!dependencies.seerr) return reply.code(503).send();
      try {
        return await dependencies.seerr.test(request.body.endpoint);
      } catch (error) {
        if (error instanceof DownloadConfigurationError) {
          return reply.code(400).send({
            code: error.code,
            message: error.message,
          });
        }
        const safeMessage = error instanceof Error && /^(Seerr (request failed with status \d+|returned invalid download-server settings)|Radarr request failed with status \d+|Sonarr request failed with status \d+)\.?$/.test(error.message)
          ? `${error.message}${/returned invalid/.test(error.message) ? ' Check the URL base; most Seerr installations leave it blank.' : ''}`
          : 'Seerr could not be reached. Check that the hostname is reachable from the Vynode container.';
        return reply.code(503).send({
          code: 'seerr-unavailable',
          message: safeMessage,
        });
      }
    }
  );

  app.put<{
    Body: {
      expectedRevision: number;
      endpoint: SeerrEndpointDraft;
      testReceipt: string;
      radarr: SeerrDestination;
      sonarr: SeerrDestination;
      userCreationMode: ServiceUserCreationMode;
    };
  }>('/api/seerr', async (request, reply) => {
    if (!dependencies.seerr) return reply.code(503).send();
    try {
      return await dependencies.seerr.save(request.body);
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(error.code === 'configuration-conflict' ? 409 : 400)
          .send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/api/seerr/removal-impact', async (_request, reply) => {
    if (!dependencies.seerr) return reply.code(503).send();
    try {
      return await dependencies.seerr.removalImpact();
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(404)
          .send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.delete<{
    Body: { expectedRevision: number; confirmed: boolean };
  }>('/api/seerr', async (request, reply) => {
    if (!dependencies.seerr) return reply.code(503).send();
    try {
      await dependencies.seerr.remove(request.body);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(error.code === 'configuration-conflict' ? 409 : 400)
          .send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/api/watchlists', async (_request, reply) => {
    if (!dependencies.watchlists) return reply.code(503).send();
    return dependencies.watchlists.get();
  });

  app.get<{ Params: { kind: ArrKind } }>(
    '/api/watchlists/options/:kind',
    async (request, reply) => {
      if (!dependencies.watchlists) return reply.code(503).send();
      if (!['radarr', 'sonarr'].includes(request.params.kind)) {
        return reply.code(400).send({
          code: 'invalid-selection',
          message: 'Unknown watchlist destination type.',
        });
      }
      try {
        return await dependencies.watchlists.options(request.params.kind);
      } catch {
        return reply.code(503).send({
          code: 'option-load-failed',
          message: 'Download destination options could not be loaded.',
        });
      }
    }
  );

  app.post<{
    Params: { kind: ArrKind };
    Body: { serverId: string; label: string };
  }>('/api/watchlists/tags/:kind', async (request, reply) => {
    if (!dependencies.watchlists) return reply.code(503).send();
    try {
      return await dependencies.watchlists.createTag(
        request.params.kind,
        request.body.serverId,
        request.body.label
      );
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(400)
          .send({ code: error.code, message: error.message });
      }
      return reply.code(503).send({
        code: 'tag-create-failed',
        message: 'The tag could not be created on the selected server.',
      });
    }
  });

  app.put<{
    Body: {
      expectedRevision: number;
      enableOwner: boolean;
      enableUsers: boolean;
      radarr: WatchlistDestination;
      sonarr: WatchlistDestination;
    };
  }>('/api/watchlists', async (request, reply) => {
    if (!dependencies.watchlists) return reply.code(503).send();
    try {
      return await dependencies.watchlists.save(request.body);
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(error.code === 'configuration-conflict' ? 409 : 400)
          .send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/api/placeholders', async (_request, reply) => {
    if (!dependencies.placeholders) return reply.code(503).send();
    return dependencies.placeholders.get();
  });

  app.get('/api/placeholders/inventory', async (_request, reply) => {
    if (!dependencies.placeholderInventory) return reply.code(503).send();
    return dependencies.placeholderInventory.get();
  });

  app.put<{
    Body: {
      expectedRevision: number;
      libraryRoots: Record<string, string>;
      skipYoutubeTrailerDownloads: boolean;
    };
  }>('/api/placeholders', async (request, reply) => {
    if (!dependencies.placeholders) return reply.code(503).send();
    try {
      return await dependencies.placeholders.save(request.body);
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(error.code === 'configuration-conflict' ? 409 : 400)
          .send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get<{ Querystring: { path?: string } }>(
    '/api/directories',
    async (request, reply) => {
      if (!dependencies.directoryBrowser) return reply.code(503).send();
      try {
        return await dependencies.directoryBrowser.browse(request.query.path);
      } catch (error) {
        if (error instanceof DownloadConfigurationError) {
          return reply.code(400).send({
            code: error.code,
            message: error.message,
          });
        }
        return reply.code(404).send({
          code: 'directory-unavailable',
          message: 'The directory is missing or cannot be read.',
        });
      }
    }
  );

  app.get('/api/youtube-cookie-status', async (_request, reply) => {
    if (!dependencies.youtubeCookieStatus) return reply.code(503).send();
    return dependencies.youtubeCookieStatus();
  });

  app.get('/api/fetching-policy', async (_request, reply) => {
    if (!dependencies.fetchingPolicy) return reply.code(503).send();
    return dependencies.fetchingPolicy.get();
  });

  app.put<{
    Body: {
      expectedRevision: number;
      letterboxdUsePlainHttp: boolean;
      flixpatrolUsePlainHttp: boolean;
    };
  }>('/api/fetching-policy', async (request, reply) => {
    if (!dependencies.fetchingPolicy) return reply.code(503).send();
    const saved = await dependencies.fetchingPolicy.save(
      request.body.expectedRevision,
      {
        letterboxdUsePlainHttp: request.body.letterboxdUsePlainHttp,
        flixpatrolUsePlainHttp: request.body.flixpatrolUsePlainHttp,
      }
    );
    if (!saved) {
      return reply.code(409).send({
        code: 'fetching-policy-conflict',
        message: 'Fetching settings changed; reload and retry.',
      });
    }
    return saved;
  });

  app.get<{ Params: { kind: ArrKind } }>(
    '/api/download-services/:kind',
    async (request, reply) => {
      if (!dependencies.downloads) return reply.code(503).send();
      return dependencies.downloads.list(request.params.kind);
    }
  );

  app.get<{ Params: { kind: ArrKind } }>(
    '/api/collection-sources/arr/:kind',
    async (request, reply) => {
      if (!dependencies.arrCollectionSources) return reply.code(503).send();
      if (!['radarr', 'sonarr'].includes(request.params.kind))
        return reply.code(400).send({
          code: 'invalid-arr-kind',
          message: 'Choose Radarr or Sonarr.',
        });
      return dependencies.arrCollectionSources.servers(request.params.kind);
    }
  );

  app.get<{ Params: { serverId: string } }>(
    '/api/collection-sources/arr-server/:serverId/tags',
    async (request, reply) => {
      if (!dependencies.arrCollectionSources) return reply.code(503).send();
      try {
        return await dependencies.arrCollectionSources.tags(
          request.params.serverId
        );
      } catch (error) {
        return reply.code(400).send({
          code: 'invalid-arr-source',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to load download-service tags.',
        });
      }
    }
  );

  app.post<{ Body: { endpoint: ArrEndpointDraft } }>(
    '/api/download-services/test',
    async (request, reply) => {
      if (!dependencies.downloads) return reply.code(503).send();
      try {
        return await dependencies.downloads.test(request.body.endpoint);
      } catch (error) {
        if (error instanceof DownloadConfigurationError) {
          return reply.code(400).send({
            code: error.code,
            message: error.message,
          });
        }
        return reply.code(503).send({
          code: 'download-service-unavailable',
          message: 'The download service could not be verified.',
        });
      }
    }
  );

  app.put<{
    Params: { id: string };
    Body: {
      expectedRevision: number;
      endpoint: ArrEndpointDraft;
      selection: ArrSelection;
      testReceipt: string;
    };
  }>('/api/download-services/:id', async (request, reply) => {
    if (!dependencies.downloads) return reply.code(503).send();
    try {
      return await dependencies.downloads.save({
        ...(request.params.id === 'new' ? {} : { id: request.params.id }),
        ...request.body,
      });
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(error.code === 'configuration-conflict' ? 409 : 400)
          .send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/download-services/:id/removal-impact',
    async (request, reply) => {
      if (!dependencies.downloads) return reply.code(503).send();
      try {
        return await dependencies.downloads.removalImpact(request.params.id);
      } catch (error) {
        if (error instanceof DownloadConfigurationError) {
          return reply
            .code(404)
            .send({ code: error.code, message: error.message });
        }
        throw error;
      }
    }
  );

  app.delete<{
    Params: { id: string };
    Body: { expectedRevision: number; confirmed: boolean };
  }>('/api/download-services/:id', async (request, reply) => {
    if (!dependencies.downloads) return reply.code(503).send();
    try {
      await dependencies.downloads.remove({
        id: request.params.id,
        ...request.body,
      });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof DownloadConfigurationError) {
        return reply
          .code(error.code === 'configuration-conflict' ? 409 : 400)
          .send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: IntegrationId } }>(
    '/api/integrations/:id',
    async (request, reply) => {
      if (!dependencies.integrations) return reply.code(503).send();
      const configuration = await dependencies.integrations.get(
        request.params.id
      );
      if (!configuration) return reply.code(204).send();
      return configuration;
    }
  );

  app.post<{ Body: { draft: IntegrationDraft } }>(
    '/api/integrations/test',
    async (request, reply) => {
      if (!dependencies.integrations) return reply.code(503).send();
      try {
        return await dependencies.integrations.test(request.body.draft);
      } catch (error) {
        if (error instanceof IntegrationConfigurationError) {
          return reply.code(400).send({
            code: error.code,
            message: error.message,
          });
        }
        if (error instanceof TraktApiError) {
          return reply.code(503).send({
            code: 'integration-unavailable',
            message: error.message,
          });
        }
        return reply.code(503).send({
          code: 'integration-unavailable',
          message: 'The integration could not be verified.',
        });
      }
    }
  );

  app.get('/api/integrations/trakt/oauth', async (_request, reply) => {
    if (!dependencies.traktOAuth) return reply.code(503).send();
    return dependencies.traktOAuth.status();
  });

  app.post<{ Body: { redirectUri: string } }>(
    '/api/integrations/trakt/oauth/attempts',
    async (request, reply) => {
      if (!dependencies.traktOAuth) return reply.code(503).send();
      try {
        return await dependencies.traktOAuth.begin(request.body.redirectUri);
      } catch (error) {
        return reply.code(400).send({
          code: 'trakt-oauth-unavailable',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to begin Trakt authorization.',
        });
      }
    }
  );

  app.post<{ Body: { code: string; state: string } }>(
    '/api/integrations/trakt/oauth/exchange',
    async (request, reply) => {
      if (!dependencies.traktOAuth) return reply.code(503).send();
      try {
        return await dependencies.traktOAuth.exchange(
          request.body.code,
          request.body.state
        );
      } catch (error) {
        return reply.code(400).send({
          code: 'trakt-oauth-exchange-failed',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to complete Trakt authorization.',
        });
      }
    }
  );

  app.delete('/api/integrations/trakt/oauth', async (_request, reply) => {
    if (!dependencies.traktOAuth) return reply.code(503).send();
    await dependencies.traktOAuth.disconnect();
    return reply.code(204).send();
  });

  app.post<{ Body: { redirectUri: string } }>(
    '/api/integrations/trakt/oauth/refresh',
    async (request, reply) => {
      if (!dependencies.traktOAuth) return reply.code(503).send();
      try {
        return await dependencies.traktOAuth.refreshNow(
          request.body.redirectUri
        );
      } catch (error) {
        return reply.code(400).send({
          code: 'trakt-oauth-refresh-failed',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to refresh Trakt authorization.',
        });
      }
    }
  );

  app.put<{
    Params: { id: IntegrationId };
    Body: {
      expectedRevision: number;
      draft: IntegrationDraft;
      verificationReceipt: string;
    };
  }>('/api/integrations/:id', async (request, reply) => {
    if (!dependencies.integrations) return reply.code(503).send();
    if (request.body?.draft?.id !== request.params.id) {
      return reply.code(400).send({
        code: 'integration-id-mismatch',
        message: 'Route and integration identifiers must match.',
      });
    }
    try {
      const previous =
        request.params.id === 'trakt'
          ? await dependencies.integrations.get('trakt')
          : undefined;
      const saved = await dependencies.integrations.save(request.body);
      if (
        request.params.id === 'trakt' &&
        dependencies.traktOAuth &&
        (saved.values.mode === 'basic' ||
          (previous &&
            previous.values.clientId !== saved.values.clientId))
      ) {
        await dependencies.traktOAuth.disconnect();
      }
      return saved;
    } catch (error) {
      if (error instanceof IntegrationConfigurationError) {
        return reply
          .code(error.code === 'configuration-conflict' ? 409 : 400)
          .send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.delete<{
    Params: { id: IntegrationId };
    Querystring: { expectedRevision: string };
  }>('/api/integrations/:id', async (request, reply) => {
    if (!dependencies.integrations) return reply.code(503).send();
    try {
      await dependencies.integrations.disconnect(
        request.params.id,
        Number(request.query.expectedRevision)
      );
      if (request.params.id === 'trakt' && dependencies.traktOAuth) {
        await dependencies.traktOAuth.disconnect();
      }
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof IntegrationConfigurationError) {
        return reply.code(409).send({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  });

  app.get('/api/media-servers/plex', async (_request, reply) => {
    const configuration = await dependencies.plexServer.get();
    if (!configuration) return reply.code(204).send();
    return configuration;
  });

  app.get('/api/media-servers/plex/candidates', async (_request, reply) => {
    try {
      const candidates = await dependencies.plexServerDirectory.discover(
        await dependencies.ownerPlexTokenReference()
      );
      return [...candidates].sort(
        (left, right) =>
          Number(right.reachable) - Number(left.reachable) ||
          Number(right.local) - Number(left.local) ||
          (left.latencyMs ?? Number.MAX_SAFE_INTEGER) -
            (right.latencyMs ?? Number.MAX_SAFE_INTEGER)
      );
    } catch {
      return reply.code(503).send({
        code: 'plex-discovery-unavailable',
        message:
          'Plex server discovery is unavailable. Enter the connection manually.',
      });
    }
  });

  app.put<{
    Body: {
      expectedRevision: number;
      input: PlexConnectionInput;
      confirmMachineChange?: boolean;
    };
  }>('/api/media-servers/plex', async (request, reply) => {
    if (
      !Number.isInteger(request.body?.expectedRevision) ||
      !request.body?.input
    ) {
      return reply.code(400).send({
        code: 'invalid-plex-configuration',
        message: 'Expected revision and Plex configuration are required.',
      });
    }
    try {
      return await dependencies.plexServer.save({
        expectedRevision: request.body.expectedRevision,
        input: request.body.input,
        plexTokenReference: await dependencies.ownerPlexTokenReference(),
        confirmMachineChange: request.body.confirmMachineChange ?? false,
        now: dependencies.now().toISOString(),
      });
    } catch (error) {
      if (error instanceof PlexConfigurationError) {
        const status =
          error.code === 'configuration-conflict'
            ? 409
            : error.code === 'machine-change-confirmation-required'
              ? 412
              : 400;
        return reply.code(status).send({
          code: error.code,
          message: error.message,
        });
      }
      return reply.code(503).send({
        code: 'plex-server-unavailable',
        message: 'The Plex server could not be verified.',
      });
    }
  });

  app.post<{
    Body: { expectedRevision: number; event: OnboardingEvent };
  }>('/api/onboarding/events', async (request, reply) => {
    if (
      !Number.isInteger(request.body?.expectedRevision) ||
      !request.body?.event
    ) {
      return reply.code(400).send({
        code: 'invalid-onboarding-event',
        message: 'Expected revision and event are required.',
      });
    }
    try {
      if (request.body.event.type === 'activate') {
        const plex = await dependencies.plexServer.get();
        if (!plex || plex.libraries.length === 0) {
          return reply.code(400).send({
            code: 'activation-blocked',
            message:
              'Verify a Plex server and its libraries before activation.',
          });
        }
        try {
          await dependencies.ownerPlexTokenReference();
        } catch {
          return reply.code(400).send({
            code: 'activation-blocked',
            message: 'Reconnect the Plex owner account before activation.',
          });
        }
      }
      return await dependencies.onboarding.apply(
        request.body.expectedRevision,
        request.body.event
      );
    } catch (error) {
      if (error instanceof OnboardingConflictError) {
        return reply.code(409).send({
          code: 'onboarding-conflict',
          message: error.message,
          current: error.current,
        });
      }
      throw error;
    }
  });

  app.post('/api/auth/plex/attempts', async (_request, reply) => {
    try {
      return await dependencies.plexLogin.begin();
    } catch {
      return reply.code(503).send({
        code: 'plex-unavailable',
        message: 'Plex authentication is temporarily unavailable.',
      });
    }
  });

  app.post<{ Body: { token: string } }>(
    '/api/auth/plex/manual',
    async (request, reply) => {
      if (!request.body?.token?.trim()) {
        return reply.code(400).send({
          code: 'plex-token-required',
          message: 'Enter a Plex authentication token.',
        });
      }
      try {
        const result = await dependencies.plexLogin.signInWithToken(
          request.body.token,
          request.cookies[sessionCookie]
        );
        reply.setCookie(sessionCookie, result.session.sessionId, {
          httpOnly: true,
          sameSite: 'lax',
          secure: dependencies.production,
          path: '/',
          expires: new Date(result.session.expiresAt),
        });
        return {
          account: {
            id: result.account.id,
            username: result.account.username,
            title: result.account.title,
          },
        };
      } catch {
        return reply.code(401).send({
          code: 'invalid-plex-token',
          message: 'Plex could not verify that token.',
        });
      }
    }
  );

  app.get<{ Params: { attemptId: string } }>(
    '/api/auth/plex/attempts/:attemptId',
    async (request, reply) => {
      const attempt = dependencies.plexLogin.get(request.params.attemptId);
      if (!attempt) {
        return reply.code(404).send({
          code: 'login-attempt-not-found',
          message: 'Login attempt was not found.',
        });
      }
      return attempt;
    }
  );

  app.post<{ Params: { attemptId: string } }>(
    '/api/auth/plex/attempts/:attemptId/poll',
    async (request, reply) => {
      try {
        const result = await dependencies.plexLogin.poll(
          request.params.attemptId,
          request.cookies[sessionCookie]
        );
        if ('session' in result) {
          reply.setCookie(sessionCookie, result.session.sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            secure: dependencies.production,
            path: '/',
            expires: new Date(result.session.expiresAt),
          });
        }
        return result.attempt;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Login attempt not found'
        ) {
          return reply.code(404).send({
            code: 'login-attempt-not-found',
            message: 'Login attempt was not found.',
          });
        }
        return reply.code(503).send({
          code: 'plex-unavailable',
          message: 'Plex authentication is temporarily unavailable.',
        });
      }
    }
  );

  app.delete<{ Params: { attemptId: string } }>(
    '/api/auth/plex/attempts/:attemptId',
    async (request, reply) => {
      const attempt = dependencies.plexLogin.cancel(request.params.attemptId);
      if (!attempt) {
        return reply.code(409).send({
          code: 'login-attempt-not-cancellable',
          message: 'Login attempt cannot be cancelled.',
        });
      }
      return attempt;
    }
  );

  app.get('/api/auth/me', async (request, reply) => {
    const sessionId = request.cookies[sessionCookie];
    const principal = sessionId
      ? await dependencies.sessions.resolve(sessionId)
      : undefined;
    if (!principal) {
      return reply.code(401).send({
        code: 'authentication-required',
        message: 'Sign in is required.',
      });
    }
    return principal;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[sessionCookie];
    if (sessionId) await dependencies.sessions.revoke(sessionId);
    reply.clearCookie(sessionCookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: dependencies.production,
      path: '/',
    });
    return reply.code(204).send();
  });

  return app;
};
