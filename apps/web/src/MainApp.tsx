import type {
  ApplicationLogEntry,
  AuthenticatedPrincipal,
  CollectionDraft,
  DashboardJobKind,
  DashboardJobStatus,
  GeneralSettingsDraft,
  ManagedCollection,
  PlexDiscoveredItem,
  PlexDiscoveredItemDraft,
} from '@vynode/contracts';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import type { PlexConnectionInput } from '@vynode/media-servers';
import { api } from './api';
import {
  CollectionBehaviorFields,
  defaultCollectionBehavior,
} from './CollectionBehaviorFields';
import {
  CollectionMetadataFields,
  defaultCollectionMetadata,
} from './CollectionMetadataFields';
import {
  CollectionMissingMediaFields,
  defaultMissingMediaSettings,
} from './CollectionMissingMediaFields';
import {
  CollectionMultiSourceFields,
  defaultMultiSourceSettings,
} from './CollectionMultiSourceFields';
import { CollectionPosterFields } from './CollectionPosterFields';
import {
  applyCollectionConfigTemplate,
  collectionConfigTemplates,
} from './CollectionConfigTemplates';
import {
  CollectionSourceFields,
  collectionSourceOptions,
} from './CollectionSourceFields';
import { DiscoveredScheduleFields } from './DiscoveredScheduleFields';
import { DownloadStage } from './DownloadStage';
import { SourceStage } from './SourceStage';
import {
  defaultTmdbDiscoverSettings,
  TmdbDiscoverFields,
} from './TmdbDiscoverFields';

const CollectionPostersPage = lazy(async () => {
  const module = await import('./CollectionPostersPage');
  return { default: module.CollectionPostersPage };
});

const PosterOverlaysPage = lazy(async () => {
  const module = await import('./PosterOverlaysPage');
  return { default: module.PosterOverlaysPage };
});

const PageLoading = () => (
  <section className="main-panel" aria-busy="true" aria-live="polite">
    <p className="source-feedback">Loading page…</p>
  </section>
);

const primaryRoutes = [
  { path: '/dashboard', label: 'Dashboard', mark: 'D' },
  { path: '/', label: 'Home', mark: 'H' },
  { path: '/recommended', label: 'Recommended', mark: 'R' },
  { path: '/library', label: 'Library', mark: 'L' },
  { path: '/allcollections', label: 'All Collections', mark: 'C' },
  { path: '/posters/overlays', label: 'Posters', mark: 'P' },
  { path: '/settings/main', label: 'Settings', mark: 'S' },
] as const;

const roleRank = {
  viewer: 0,
  operator: 1,
  administrator: 2,
  owner: 3,
} as const;

const minimumRoleForPath = (
  path: string
): AuthenticatedPrincipal['role'] => {
  if (path.startsWith('/settings')) return 'administrator';
  if (
    path.startsWith('/posters') ||
    path.startsWith('/allcollections')
  )
    return 'operator';
  return 'viewer';
};

const settingsTabs = [
  ['/settings/main', 'General'],
  ['/settings/plex', 'Plex'],
  ['/settings/sources', 'Sources'],
  ['/settings/downloads', 'Downloads'],
  ['/settings/logs', 'Logs'],
  ['/settings/jobs', 'Jobs'],
  ['/settings/about', 'About'],
] as const;

const posterTabs = [
  ['/posters/overlays', 'Poster Overlays'],
  ['/posters/collections', 'Collection Posters'],
] as const;

const pageCopy: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Home',
    description:
      'Collections and hubs on the Plex Home screen. Ordering is shared with Recommended while visibility can differ.',
  },
  '/dashboard': {
    title: 'Dashboard',
    description:
      'Overview of Vynode statistics, synchronization activity, and collection performance.',
  },
  '/recommended': {
    title: 'Recommended',
    description:
      'Collections and hubs in Plex Recommended tabs, with shared Home ordering and independent visibility.',
  },
  '/library': {
    title: 'Library',
    description:
      'Collections in each Plex Library tab, including independent ordering and visibility.',
  },
  '/allcollections': {
    title: 'All Collections',
    description:
      'Create, find, organize, preview, synchronize, copy, and manage every collection.',
  },
  '/posters/overlays': {
    title: 'Poster Overlays',
    description:
      'Configure overlay sources, library policies, templates, and synchronization.',
  },
  '/posters/collections': {
    title: 'Collection Posters',
    description:
      'Design and manage reusable collection poster templates and assets.',
  },
  '/settings/main': {
    title: 'General Settings',
    description:
      'Application identity, locale, URL, cache, security, and maintenance controls.',
  },
  '/settings/plex': {
    title: 'Plex Settings',
    description:
      'Owner account, server connection, libraries, security, and synchronization.',
  },
  '/settings/sources': {
    title: 'Sources',
    description:
      'Metadata providers, list services, analytics, maintenance, and fetching policies.',
  },
  '/settings/downloads': {
    title: 'Downloads',
    description:
      'Requests, download servers, placeholders, trailers, webhooks, and watchlists.',
  },
  '/settings/logs': {
    title: 'Logs',
    description:
      'Search, filter, inspect, refresh, and export application logs.',
  },
  '/settings/jobs': {
    title: 'Jobs and Cache',
    description:
      'Run, cancel, schedule, and inspect background jobs and cached data.',
  },
  '/settings/about': {
    title: 'About Vynode',
    description:
      'Version, build, runtime, updates, documentation, and support information.',
  },
};

const normalizePath = (value: string) => {
  if (value === '/settings') return '/settings/main';
  if (value === '/posters') return '/posters/overlays';
  return pageCopy[value] ? value : '/404';
};

const navigate = (path: string) => {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

const AppLink = ({
  path,
  children,
  className,
  role,
}: {
  path: string;
  children: React.ReactNode;
  className?: string;
  role?: React.AriaRole;
}) => (
  <a
    href={path}
    className={className}
    role={role}
    onClick={(event) => {
      event.preventDefault();
      navigate(path);
    }}
  >
    {children}
  </a>
);

const activeJobPhases = new Set([
  'queued',
  'setup',
  'processing',
  'cleanup',
  'cancelling',
]);

const SyncJobCard = ({
  kind,
  canOperate,
}: {
  kind: DashboardJobKind;
  canOperate: boolean;
}) => {
  const title = kind === 'collections' ? 'Collection sync' : 'Overlay sync';
  const [status, setStatus] = useState<DashboardJobStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const requestSequence = useRef(0);
  const load = async () => {
    const requestId = ++requestSequence.current;
    try {
      const next = await api.dashboardJob(kind);
      if (requestId !== requestSequence.current) return;
      setStatus(next);
      setMessage('');
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setMessage(
        error instanceof Error
          ? error.message
          : `Unable to load ${title.toLowerCase()} status.`
      );
    }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(
      () => void load(),
      status && activeJobPhases.has(status.phase) ? 1000 : 5000
    );
    return () => window.clearInterval(timer);
  }, [status?.phase]);
  const start = async () => {
    requestSequence.current += 1;
    setBusy(true);
    setMessage(`Starting ${title.toLowerCase()}…`);
    try {
      setStatus(await api.startDashboardJob(kind));
      setMessage(`${title} started.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : `Unable to start ${title.toLowerCase()}.`
      );
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    requestSequence.current += 1;
    setBusy(true);
    setMessage(`Requesting a safe stop…`);
    try {
      setStatus(await api.cancelDashboardJob(kind));
      setMessage(
        'Cancellation requested. The current operation will stop safely.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : `Unable to stop ${title.toLowerCase()}.`
      );
    } finally {
      setBusy(false);
    }
  };
  const active = status ? activeJobPhases.has(status.phase) : false;
  return (
    <section className={`sync-card phase-${status?.phase ?? 'loading'}`}>
      <div className="sync-card-heading">
        <div>
          <span
            className={`status-dot ${active ? 'running' : (status?.phase ?? 'loading')}`}
            aria-hidden="true"
          />
          <div>
            <strong>{title}</strong>
            <small>{status?.phaseLabel ?? 'Loading status…'}</small>
          </div>
        </div>
        {active ? (
          <button
            className="button danger"
            type="button"
            aria-label={`Stop ${title.toLowerCase()}`}
            disabled={!canOperate || busy || status?.phase === 'cancelling'}
            onClick={() => void cancel()}
          >
            {busy || status?.phase === 'cancelling' ? 'Stopping…' : 'Stop'}
          </button>
        ) : (
          <button
            className="button primary"
            type="button"
            aria-label={`Start ${title.toLowerCase()}`}
            disabled={!canOperate || busy || !status}
            onClick={() => void start()}
          >
            {busy ? 'Starting…' : 'Start'}
          </button>
        )}
      </div>
      <div className="phase-stepper" aria-label={`${title} phases`}>
        {['Preparing', 'Syncing', 'Cleanup'].map((label, index) => {
          const phaseIndex =
            status?.phase === 'setup'
              ? 0
              : status?.phase === 'processing'
                ? 1
                : status?.phase === 'cleanup'
                  ? 2
                  : status?.phase === 'completed'
                    ? 3
                    : -1;
          return (
            <span
              key={label}
              className={
                index < phaseIndex || phaseIndex === 3
                  ? 'complete'
                  : index === phaseIndex
                    ? 'active'
                    : ''
              }
            >
              <i />
              {label}
            </span>
          );
        })}
      </div>
      <div className="progress-heading">
        <span>Progress</span>
        <strong>{status?.progressPercent ?? 0}%</strong>
      </div>
      <div
        className="job-progress"
        role="progressbar"
        aria-label={`${title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={status?.progressPercent ?? 0}
      >
        <span style={{ width: `${status?.progressPercent ?? 0}%` }} />
      </div>
      {status?.currentItem && (
        <div className="current-job-item">
          <small>Synchronizing</small>
          <strong>{status.currentItem.name}</strong>
          <span>
            {status.currentItem.sourceType} · Item{' '}
            {Math.min(status.processedItems + 1, status.totalItems)} of{' '}
            {status.totalItems}
          </span>
        </div>
      )}
      <div className="job-stat-grid">
        <span>
          <small>Synced</small>
          <strong>{status?.successCount ?? 0}</strong>
        </span>
        <span>
          <small>Errors</small>
          <strong>{status?.errorCount ?? 0}</strong>
        </span>
        <span>
          <small>Skipped</small>
          <strong>{status?.skippedCount ?? 0}</strong>
        </span>
        <span>
          <small>Created</small>
          <strong>{status?.createdCount ?? 0}</strong>
        </span>
      </div>
      {status?.recentOutcomes.length ? (
        <div className="recent-outcomes">
          <small>Recent</small>
          {status.recentOutcomes.map((outcome) => (
            <div key={`${outcome.id}-${outcome.durationMs}`}>
              <span className={outcome.outcome}>
                {outcome.outcome === 'success'
                  ? '✓'
                  : outcome.outcome === 'error'
                    ? '!'
                    : '→'}
              </span>
              <strong>{outcome.name}</strong>
              <em>{outcome.sourceType}</em>
              <small>{(outcome.durationMs / 1000).toFixed(1)}s</small>
              {outcome.errorMessage && <p>{outcome.errorMessage}</p>}
            </div>
          ))}
        </div>
      ) : null}
      <footer>
        <span>
          {active
            ? `Processed ${status?.processedItems ?? 0} / ${status?.totalItems ?? 0}`
            : status?.completedAt
              ? `${status.runningForSeconds}s elapsed`
              : 'Idle'}
        </span>
        {status?.estimatedSecondsRemaining !== undefined && active && (
          <span>ETA: {status.estimatedSecondsRemaining}s</span>
        )}
        {status?.completedAt && !active && (
          <time dateTime={status.completedAt}>
            {new Date(status.completedAt).toLocaleString()}
          </time>
        )}
      </footer>
      {message && (
        <p className="source-feedback" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {status?.message && (
        <p className="error-banner" role="alert">
          {status.message}
        </p>
      )}
    </section>
  );
};

const DashboardStatistics = () => {
  const [summary, setSummary] =
    useState<Awaited<ReturnType<typeof api.dashboardSummary>>>();
  const [error, setError] = useState('');
  const load = async () => {
    setError('');
    try {
      setSummary(await api.dashboardSummary());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load dashboard statistics.'
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  if (error)
    return (
      <div className="error-panel" role="alert">
        <strong>Failed to load dashboard statistics</strong>
        <p>{error}</p>
        <button
          className="button secondary"
          type="button"
          onClick={() => void load()}
        >
          Try again
        </button>
      </div>
    );
  if (!summary)
    return (
      <div className="stat-grid" aria-label="Loading dashboard statistics">
        {Array.from({ length: 4 }).map((_, index) => (
          <article className="skeleton-card" key={index} />
        ))}
      </div>
    );
  if (!summary.tautulliConnected)
    return (
      <section className="main-panel setup-required">
        <h3>Tautulli setup required</h3>
        <p>
          Configure Tautulli in Sources to view play statistics from your Plex
          server.
        </p>
        <AppLink path="/settings/sources" className="button primary">
          Configure Tautulli
        </AppLink>
      </section>
    );
  return (
    <div className="stat-grid">
      <article>
        <small>Collections</small>
        <strong>{summary.collections.managed}</strong>
        <span>{summary.collections.preExisting} pre-existing</span>
      </article>
      <article>
        <small>Collection views</small>
        <strong>{summary.activity?.collectionPlays ?? 0}</strong>
        <span>{summary.activity?.totalPlays ?? 0} total · this week</span>
      </article>
      <article>
        <small>Movie plays</small>
        <strong>{summary.activity?.moviePlays ?? 0}</strong>
        <span>This week</span>
      </article>
      <article>
        <small>TV plays</small>
        <strong>{summary.activity?.showPlays ?? 0}</strong>
        <span>This week</span>
      </article>
    </div>
  );
};

const CollectionStatistics = () => {
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState<'plays' | 'duration'>('plays');
  const [data, setData] =
    useState<Awaited<ReturnType<typeof api.dashboardCollectionStatistics>>>();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const requestSequence = useRef(0);
  const load = async (nextDays = days) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setMessage('Loading collection statistics…');
    try {
      const next = await api.dashboardCollectionStatistics(nextDays);
      if (requestId !== requestSequence.current) return;
      setData(next);
      setMessage('');
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load collection statistics.'
      );
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="main-panel collection-statistics">
      <div className="panel-heading">
        <h3>Collection statistics</h3>
        <div className="stat-controls">
          <label htmlFor="statistics-days">Days</label>
          <input
            id="statistics-days"
            type="number"
            min={0}
            max={9999}
            value={days}
            onChange={(event) =>
              setDays(
                Math.max(0, Math.min(9999, Number(event.target.value) || 0))
              )
            }
          />
          <button
            className="text-button"
            type="button"
            disabled={loading || data?.days === days}
            onClick={() => void load(days)}
          >
            Apply range
          </button>
          <button
            className={`text-button ${mode === 'plays' ? 'active' : ''}`}
            type="button"
            aria-pressed={mode === 'plays'}
            onClick={() => setMode('plays')}
          >
            Plays
          </button>
          <button
            className={`text-button ${mode === 'duration' ? 'active' : ''}`}
            type="button"
            aria-pressed={mode === 'duration'}
            onClick={() => setMode('duration')}
          >
            Duration
          </button>
        </div>
      </div>
      <p className="field-help">
        Use 0 days for all available history. Duration is displayed in watched
        hours.
      </p>
      {message && (
        <p className="source-feedback" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {data?.collections.length === 0 && (
        <p className="empty-state">
          No collection activity was recorded during this period.
        </p>
      )}
      <div className="statistic-rows">
        {data?.collections.map((collection) => (
          <article key={collection.ratingKey}>
            <span className="collection-icon" aria-hidden="true">
              C
            </span>
            <div>
              <strong>{collection.title}</strong>
              <small>
                {collection.itemCount} items · {collection.totalPlays} plays ·{' '}
                {(collection.totalDurationSeconds / 3600).toFixed(1)} hours ·{' '}
                {collection.viewerCount} viewers
              </small>
            </div>
            <span>
              <strong>
                {mode === 'plays'
                  ? collection.totalPlays
                  : (collection.totalDurationSeconds / 3600).toFixed(1)}
              </strong>
              <small>{mode === 'plays' ? 'plays' : 'hours'}</small>
            </span>
          </article>
        ))}
      </div>
      {data && (
        <footer>
          <small>
            Last updated {new Date(data.timestamp).toLocaleString()}
          </small>
          <button
            className="text-button"
            type="button"
            aria-label="Refresh collection statistics"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </footer>
      )}
    </section>
  );
};

const MissingItemsFeed = ({ canOperate }: { canOperate: boolean }) => {
  type MissingFilters = Parameters<typeof api.dashboardMissingItems>[0];
  const [mediaType, setMediaType] = useState<'movie' | 'show'>('movie');
  const [data, setData] =
    useState<Awaited<ReturnType<typeof api.dashboardMissingItems>>>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalFilters, setModalFilters] = useState<MissingFilters>({
    mediaType: 'movie',
  });
  const [modalOffset, setModalOffset] = useState(0);
  const modalLimit = 20;
  const closeModalButton = useRef<HTMLButtonElement>(null);
  const requestSequence = useRef(0);
  const load = async (
    filters: MissingFilters = { mediaType },
    limit = 5,
    offset = 0
  ) => {
    const requestId = ++requestSequence.current;
    setMessage('Loading missing items…');
    try {
      const next = await api.dashboardMissingItems(filters, limit, offset);
      if (requestId !== requestSequence.current) return;
      setData(next);
      setMessage('');
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setMessage(
        error instanceof Error ? error.message : 'Unable to load missing items.'
      );
    }
  };
  useEffect(() => {
    if (!modalOpen) void load({ mediaType });
  }, [mediaType]);
  useEffect(() => {
    if (modalOpen) void load(modalFilters, modalLimit, modalOffset);
  }, [modalOpen, modalFilters, modalOffset]);
  useEffect(() => {
    if (!modalOpen) return;
    closeModalButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModalOpen(false);
        void load({ mediaType }, 5);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [modalOpen, mediaType]);
  const refresh = async () => {
    requestSequence.current += 1;
    setBusy(true);
    setMessage('Synchronizing request status…');
    try {
      await api.syncDashboardMissingItems();
      await load(
        modalOpen ? modalFilters : { mediaType },
        modalOpen ? modalLimit : 5,
        modalOpen ? modalOffset : 0
      );
      setMessage('Request status synchronized.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to synchronize request status.'
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="main-panel missing-feed">
      <div className="panel-heading">
        <div>
          <h3>Recently added missing items</h3>
          <small>
            {data?.total ?? 0} {mediaType === 'movie' ? 'movie' : 'TV'}{' '}
            {(data?.total ?? 0) === 1 ? 'request' : 'requests'}
          </small>
        </div>
        <div>
          <button
            className={`text-button ${mediaType === 'movie' ? 'active' : ''}`}
            type="button"
            aria-pressed={mediaType === 'movie'}
            onClick={() => setMediaType('movie')}
          >
            Movies
          </button>
          <button
            className={`text-button ${mediaType === 'show' ? 'active' : ''}`}
            type="button"
            aria-pressed={mediaType === 'show'}
            onClick={() => setMediaType('show')}
          >
            TV Shows
          </button>
        </div>
      </div>
      {message && (
        <p className="source-feedback" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {data?.results.length === 0 && (
        <p className="empty-state">
          No recent missing-item requests were found.
        </p>
      )}
      <div className="missing-rows">
        {data?.results.map((item) => (
          <article key={item.id}>
            <span className="media-mark" aria-hidden="true">
              {item.mediaType === 'movie' ? 'M' : 'TV'}
            </span>
            <div>
              <strong>
                {item.title}
                {item.year ? ` (${item.year})` : ''}
              </strong>
              <small>
                From {item.collectionName} · via {item.collectionSource}
              </small>
              <em>
                {item.requestMethod === 'auto' ? 'Auto' : 'Manual'} ·{' '}
                {new Date(item.createdAt).toLocaleDateString()}
              </em>
            </div>
            <div className={`request-status ${item.requestStatus}`}>
              <strong>{item.requestStatus.replace('-', ' ')}</strong>
              <small>{item.requestService}</small>
            </div>
          </article>
        ))}
      </div>
      {data && (
        <footer>
          <div>
            <small>Showing recent missing-item requests</small>
            <small>
              Last updated {new Date(data.timestamp).toLocaleString()}
            </small>
          </div>
          <div>
            <button
              className="text-button"
              type="button"
              aria-label="Refresh missing-item status"
              disabled={!canOperate || busy}
              onClick={() => void refresh()}
            >
              {busy ? 'Synchronizing…' : 'Refresh'}
            </button>
            <button
              className="button secondary"
              type="button"
              aria-label={`View all ${mediaType === 'movie' ? 'movie' : 'TV'} requests`}
              disabled={busy}
              onClick={() => {
                setModalFilters({ mediaType });
                setModalOffset(0);
                setModalOpen(true);
              }}
            >
              View all
            </button>
          </div>
        </footer>
      )}
      {modalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setModalOpen(false);
              void load({ mediaType }, 5);
            }
          }}
        >
          <section
            className="folder-modal missing-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="missing-items-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Missing media</p>
                <h3 id="missing-items-title">All missing-item requests</h3>
              </div>
              <button
                ref={closeModalButton}
                className="icon-button"
                type="button"
                aria-label="Close missing items"
                onClick={() => {
                  setModalOpen(false);
                  void load({ mediaType }, 5);
                }}
              >
                ×
              </button>
            </div>
            <p className="field-help">
              Filter request history by media, lifecycle status, provider
              source, or destination service. Sync Status checks the configured
              request or download service.
            </p>
            <div className="missing-filter-grid">
              <label>
                Media type
                <select
                  value={modalFilters.mediaType ?? ''}
                  onChange={(event) => {
                    setModalOffset(0);
                    setModalFilters((current) => ({
                      ...current,
                      mediaType:
                        (event.target.value as 'movie' | 'show') || undefined,
                    }));
                  }}
                >
                  <option value="">All media types</option>
                  <option value="movie">Movies</option>
                  <option value="show">TV shows</option>
                </select>
              </label>
              <label>
                Status
                <select
                  value={modalFilters.requestStatus ?? ''}
                  onChange={(event) => {
                    setModalOffset(0);
                    setModalFilters((current) => ({
                      ...current,
                      requestStatus:
                        (event.target
                          .value as MissingFilters['requestStatus']) ||
                        undefined,
                    }));
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="declined">Declined</option>
                  <option value="available">Available</option>
                  <option value="processing">Processing</option>
                  <option value="failed">Failed</option>
                  <option value="partially-available">
                    Partially available
                  </option>
                </select>
              </label>
              <label>
                Source
                <select
                  value={modalFilters.collectionSource ?? ''}
                  onChange={(event) => {
                    setModalOffset(0);
                    setModalFilters((current) => ({
                      ...current,
                      collectionSource: event.target.value || undefined,
                    }));
                  }}
                >
                  <option value="">All sources</option>
                  <option value="trakt">Trakt</option>
                  <option value="tmdb">TMDB</option>
                  <option value="imdb">IMDb</option>
                  <option value="letterboxd">Letterboxd</option>
                  <option value="mdblist">MDBList</option>
                  <option value="mal">MyAnimeList</option>
                </select>
              </label>
              <label>
                Service
                <select
                  value={modalFilters.requestService ?? ''}
                  onChange={(event) => {
                    setModalOffset(0);
                    setModalFilters((current) => ({
                      ...current,
                      requestService: event.target.value || undefined,
                    }));
                  }}
                >
                  <option value="">All services</option>
                  <option value="Seerr">Seerr</option>
                  <option value="Radarr">Radarr</option>
                  <option value="Sonarr">Sonarr</option>
                </select>
              </label>
            </div>
            <div className="missing-filter-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setModalOffset(0);
                  setModalFilters({});
                }}
              >
                Clear filters
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={!canOperate || busy}
                onClick={() => void refresh()}
              >
                {busy ? 'Syncing…' : 'Sync Status'}
              </button>
            </div>
            <div className="missing-rows modal-list">
              {data?.results.length === 0 && (
                <p className="empty-state">
                  No missing-item requests match these filters. Clear or adjust
                  the filters to see more results.
                </p>
              )}
              {data?.results.map((item) => (
                <article key={item.id}>
                  <span className="media-mark" aria-hidden="true">
                    {item.mediaType === 'movie' ? 'M' : 'TV'}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.collectionName}</small>
                  </div>
                  <div className={`request-status ${item.requestStatus}`}>
                    <strong>{item.requestStatus.replace('-', ' ')}</strong>
                  </div>
                </article>
              ))}
            </div>
            {data && data.total > 0 && (
              <div className="missing-pagination">
                <small>
                  Showing {modalOffset + 1}–{Math.min(
                    modalOffset + modalLimit,
                    data.total
                  )}{' '}
                  of {data.total}
                </small>
                <div>
                  <button
                    className="text-button"
                    type="button"
                    disabled={modalOffset === 0 || busy}
                    onClick={() =>
                      setModalOffset((current) =>
                        Math.max(0, current - modalLimit)
                      )
                    }
                  >
                    Previous
                  </button>
                  <span>
                    {Math.floor(modalOffset / modalLimit) + 1} /{' '}
                    {Math.ceil(data.total / modalLimit)}
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    disabled={
                      modalOffset + modalLimit >= data.total || busy
                    }
                    onClick={() =>
                      setModalOffset((current) => current + modalLimit)
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  void load({ mediaType }, 5);
                }}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};

const DashboardOverview = ({ canOperate }: { canOperate: boolean }) => {
  return (
    <div className="dashboard-overview">
      <SyncJobCard kind="collections" canOperate={canOperate} />
      <SyncJobCard kind="overlays" canOperate={canOperate} />
      <DashboardStatistics />
      <div className="dashboard-columns">
        <CollectionStatistics />
        <MissingItemsFeed canOperate={canOperate} />
      </div>
    </div>
  );
};

type CollectionPlacementSurface = 'home' | 'recommended' | 'library';

const CollectionPlacementPage = ({
  surface,
  canManage,
}: {
  surface: CollectionPlacementSurface;
  canManage: boolean;
}) => {
  const [data, setData] =
    useState<Awaited<ReturnType<typeof api.collections>>>();
  const [libraryId, setLibraryId] = useState('');
  const [message, setMessage] = useState('Loading collections…');
  const [busyId, setBusyId] = useState('');
  const loadGeneration = useRef(0);
  const load = async () => {
    const generation = ++loadGeneration.current;
    setMessage('Loading collections…');
    try {
      const next = await api.collections();
      if (generation !== loadGeneration.current) return;
      setData(next);
      setLibraryId((current) =>
        next.libraries.some((library) => library.id === current)
          ? current
          : next.libraries[0]?.id || ''
      );
      setMessage('');
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setMessage(
        error instanceof Error ? error.message : 'Unable to load collections.'
      );
    }
  };
  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, []);
  const visibleKey =
    surface === 'home'
      ? 'homeVisible'
      : surface === 'recommended'
        ? 'recommendedVisible'
        : 'libraryVisible';
  const orderKey = surface === 'library' ? 'libraryOrder' : 'sharedOrder';
  const rows = useMemo(() => {
    const collections = data?.collections ?? [];
    return collections
      .filter(
        (collection) =>
          surface !== 'library' || collection.libraryId === libraryId
      )
      .slice()
      .sort((left, right) => left[orderKey] - right[orderKey]);
  }, [data, libraryId, orderKey, surface]);
  const save = async (
    collection: ManagedCollection,
    input: Parameters<typeof api.updateCollectionPlacement>[1],
    success: string
  ) => {
    setBusyId(collection.id);
    setMessage('Saving Plex placement…');
    try {
      await api.updateCollectionPlacement(collection.id, input);
      await load();
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to save placement.'
      );
    } finally {
      setBusyId('');
    }
  };
  const move = async (collection: ManagedCollection, direction: -1 | 1) => {
    const index = rows.findIndex((row) => row.id === collection.id);
    const neighbor = rows[index + direction];
    if (!neighbor) return;
    setBusyId(collection.id);
    setMessage('Saving collection order…');
    try {
      await api.reorderCollectionPlacement(
        collection.id,
        neighbor.id,
        orderKey
      );
      await load();
      setMessage(
        'Collection order saved. Home and Recommended share this order.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to reorder collections.'
      );
    } finally {
      setBusyId('');
    }
  };
  return (
    <section className="collection-placement">
      <div className="placement-toolbar">
        <div>
          <h2>
            {surface === 'home'
              ? 'Home hubs'
              : surface === 'recommended'
                ? 'Recommended hubs'
                : 'Library collections'}
          </h2>
          <p>
            {surface === 'library'
              ? 'Each library has independent visibility and ordering.'
              : 'Home and Recommended share ordering. Visibility is controlled separately for each surface.'}
          </p>
        </div>
        {canManage ? (
          <AppLink path="/allcollections?create=1" className="button primary">
            Create collection
          </AppLink>
        ) : (
          <span className="readonly-badge">Read-only access</span>
        )}
      </div>
      {surface === 'library' && (
        <div
          className="library-tabs"
          role="tablist"
          aria-label="Plex libraries"
        >
          {data?.libraries.map((library) => (
            <button
              key={library.id}
              id={`library-tab-${library.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
              type="button"
              role="tab"
              aria-selected={library.id === libraryId}
              aria-controls="library-collection-panel"
              tabIndex={library.id === libraryId ? 0 : -1}
              className={library.id === libraryId ? 'active' : ''}
              onClick={() => setLibraryId(library.id)}
              onKeyDown={(event) => {
                if (
                  !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                    event.key
                  )
                )
                  return;
                event.preventDefault();
                const libraries = data.libraries;
                const currentIndex = libraries.findIndex(
                  (item) => item.id === library.id
                );
                const nextIndex =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? libraries.length - 1
                      : (currentIndex +
                          (event.key === 'ArrowRight' ? 1 : -1) +
                          libraries.length) %
                        libraries.length;
                const next = libraries[nextIndex];
                if (!next) return;
                setLibraryId(next.id);
                document
                  .getElementById(
                    `library-tab-${next.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
                  )
                  ?.focus();
              }}
            >
              {library.name}
              <small>{library.collectionCount}</small>
            </button>
          ))}
        </div>
      )}
      {message && (
        <p className="source-feedback" role="status">
          {message}
        </p>
      )}
      {!message && rows.length === 0 && (
        <div className="main-panel empty-state">
          <strong>No collections are configured for this library.</strong>
          <p>Create a collection or choose another Plex library.</p>
        </div>
      )}
      <div
        className="placement-list"
        id={surface === 'library' ? 'library-collection-panel' : undefined}
        role={surface === 'library' ? 'tabpanel' : undefined}
        aria-labelledby={
          surface === 'library'
            ? `library-tab-${libraryId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
            : undefined
        }
      >
        {rows.map((collection, index) => (
          <article key={collection.id}>
            <div
              className="drag-order"
              aria-label={`${collection.title} position ${index + 1}`}
            >
              <span>{index + 1}</span>
              <div>
                <button
                  type="button"
                  aria-label={`Move ${collection.title} up`}
                  disabled={!canManage || index === 0 || !!busyId}
                  onClick={() => void move(collection, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${collection.title} down`}
                  disabled={
                    !canManage || index === rows.length - 1 || !!busyId
                  }
                  onClick={() => void move(collection, 1)}
                >
                  ↓
                </button>
              </div>
            </div>
            <div className="collection-poster" aria-hidden="true">
              {collection.mediaType === 'movie' ? 'M' : 'TV'}
            </div>
            <div className="placement-copy">
              <div>
                <strong>{collection.title}</strong>
                <span className={`collection-status ${collection.status}`}>
                  {collection.status.replace('-', ' ')}
                </span>
              </div>
              <p>{collection.description}</p>
              <small>
                {collection.libraryName} · {collection.itemCount} items ·{' '}
                {collection.sourceType.toUpperCase()}
              </small>
            </div>
            <label className="visibility-switch">
              <input
                type="checkbox"
                aria-label={`${collection.title} ${
                  surface === 'library' ? collection.libraryName : surface
                } visibility`}
                checked={collection[visibleKey]}
                disabled={!canManage || !!busyId}
                onChange={(event) =>
                  void save(
                    collection,
                    { [visibleKey]: event.target.checked },
                    `${collection.title} is now ${event.target.checked ? 'visible' : 'hidden'} on ${surface === 'library' ? collection.libraryName : surface}.`
                  )
                }
              />
              <span />
              {collection[visibleKey] ? 'Visible' : 'Hidden'}
            </label>
            {canManage && (
              <AppLink
                path={`/allcollections?edit=${encodeURIComponent(collection.id)}`}
                className="button secondary"
              >
                Edit
              </AppLink>
            )}
          </article>
        ))}
      </div>
      {data && (
        <p className="placement-updated">
          Placement data updated {new Date(data.timestamp).toLocaleString()}.
        </p>
      )}
    </section>
  );
};

const emptyCollectionDraft: CollectionDraft = {
  title: '',
  description: '',
  mediaType: 'movie',
  itemType: 'movie',
  libraryId: '',
  sourceType: 'manual',
  sourceSettings: { subtype: '', maxItems: 50, itemOrder: 'default' },
  posterSettings: {
    autoGenerate: true,
    applyOverlaysDuringSync: false,
    useTmdbFranchisePoster: false,
    hideIndividualItems: false,
  },
  behaviorSettings: defaultCollectionBehavior,
  missingMediaSettings: defaultMissingMediaSettings,
  multiSourceSettings: defaultMultiSourceSettings,
  metadataSettings: defaultCollectionMetadata,
  tmdbDiscoverSettings: defaultTmdbDiscoverSettings,
};

const AllCollectionsPage = () => {
  const [data, setData] =
    useState<Awaited<ReturnType<typeof api.collections>>>();
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState('all');
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [editorMessage, setEditorMessage] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('Loading collections…');
  const [editorId, setEditorId] = useState<string>();
  const [draft, setDraft] = useState<CollectionDraft>(emptyCollectionDraft);
  const [configTemplateId, setConfigTemplateId] = useState('');
  const [preview, setPreview] = useState<ManagedCollection>();
  const [previewResult, setPreviewResult] = useState<
    Awaited<ReturnType<typeof api.previewCollection>>
  >();
  const [previewMessage, setPreviewMessage] = useState('');
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [linkMaster, setLinkMaster] = useState<ManagedCollection>();
  const [linkMembers, setLinkMembers] = useState<Set<string>>(new Set());
  const [unlinkTarget, setUnlinkTarget] = useState<ManagedCollection>();
  const [discoveredEditor, setDiscoveredEditor] =
    useState<PlexDiscoveredItem>();
  const [discoveredDraft, setDiscoveredDraft] =
    useState<PlexDiscoveredItemDraft>();
  const [discoveredLinkMaster, setDiscoveredLinkMaster] =
    useState<PlexDiscoveredItem>();
  const [discoveredLinkMembers, setDiscoveredLinkMembers] = useState<
    Set<string>
  >(new Set());
  const [discoveredUnlinkTarget, setDiscoveredUnlinkTarget] =
    useState<PlexDiscoveredItem>();
  const [cleanupMissingOpen, setCleanupMissingOpen] = useState(false);
  const [showDiscoveredPlexItems, setShowDiscoveredPlexItems] = useState(false);
  const [busy, setBusy] = useState(false);
  const modalClose = useRef<HTMLButtonElement>(null);
  const load = async () => {
    setMessage('Loading collections…');
    try {
      setData(await api.collections());
      setMessage('');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to load collections.'
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!data) return;
    const parameters = new URLSearchParams(window.location.search);
    const editId = parameters.get('edit');
    if (parameters.has('create')) {
      setEditorId('');
      setConfigTemplateId('');
      const firstMovieLibrary = data.libraries.find(
        (item) => item.mediaType === 'movie'
      );
      setDraft({
        ...emptyCollectionDraft,
        libraryId: firstMovieLibrary?.id ?? '',
      });
    } else if (editId) {
      const collection = data.collections.find((item) => item.id === editId);
      if (collection) {
        setEditorId(collection.id);
        setConfigTemplateId('');
        setDraft({
          title: collection.title,
          description: collection.description,
          mediaType: collection.mediaType,
          itemType: collection.itemType ?? collection.mediaType,
          libraryId: collection.libraryId,
          sourceType: collection.sourceType,
          sourceSettings:
            collection.sourceSettings ?? emptyCollectionDraft.sourceSettings,
          posterSettings:
            collection.posterSettings ?? emptyCollectionDraft.posterSettings,
          behaviorSettings: collection.behaviorSettings ?? {
            ...defaultCollectionBehavior,
            visibility: {
              usersHome: collection.homeVisible,
              serverOwnerHome: collection.homeVisible,
              libraryRecommended: collection.recommendedVisible,
            },
          },
          missingMediaSettings:
            collection.missingMediaSettings ?? defaultMissingMediaSettings,
          multiSourceSettings:
            collection.multiSourceSettings ?? defaultMultiSourceSettings,
          metadataSettings:
            collection.metadataSettings ?? defaultCollectionMetadata,
          tmdbDiscoverSettings:
            collection.tmdbDiscoverSettings ?? defaultTmdbDiscoverSettings,
        });
      }
    }
  }, [data]);
  const modalOpen =
    editorId !== undefined ||
    !!preview ||
    deleteIds.length > 0 ||
    !!linkMaster ||
    !!unlinkTarget ||
    !!discoveredEditor ||
    !!discoveredLinkMaster ||
    !!discoveredUnlinkTarget ||
    cleanupMissingOpen;
  useEffect(() => {
    if (!modalOpen) return;
    modalClose.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEditorId(undefined);
        setPreview(undefined);
        setDeleteIds([]);
        setLinkMaster(undefined);
        setUnlinkTarget(undefined);
        setDiscoveredEditor(undefined);
        setDiscoveredLinkMaster(undefined);
        setDiscoveredLinkMembers(new Set());
        setDiscoveredUnlinkTarget(undefined);
        setCleanupMissingOpen(false);
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [modalOpen]);
  const filtered = useMemo(
    () =>
      (data?.collections ?? []).filter(
        (collection) =>
          (!query ||
            `${collection.title} ${collection.description}`
              .toLowerCase()
              .includes(query.toLowerCase())) &&
          (library === 'all' || collection.libraryId === library) &&
          (source === 'all' || collection.sourceType === source) &&
          (status === 'all' || collection.status === status)
      ),
    [data, library, query, source, status]
  );
  const filteredDiscovered = useMemo(
    () =>
      (data?.discoveredPlexItems ?? []).filter(
        (item) =>
          (library === 'all' || item.libraryId === library) &&
          (!query || item.name.toLowerCase().includes(query.toLowerCase()))
      ),
    [data, library, query]
  );
  const openPreview = async (collection: ManagedCollection) => {
    setPreview(collection);
    setPreviewResult(undefined);
    setPreviewMessage('Loading live source preview…');
    try {
      const result = await api.previewCollection(collection.id);
      setPreviewResult(result);
      setPreviewMessage('');
    } catch (error) {
      setPreviewMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load the live source preview.'
      );
    }
  };
  const syncCollection = async (collection: ManagedCollection) => {
    setBusy(true);
    setMessage(`Synchronizing ${collection.title} with Plex…`);
    const previousSync = collection.lastSyncedAt;
    try {
      await api.syncCollection(collection.id);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const [next, job] = await Promise.all([
          api.collections(),
          api.dashboardJob('collections'),
        ]);
        setData(next);
        const updated = next.collections.find(
          (item) => item.id === collection.id
        );
        if (
          updated &&
          updated.status !== 'syncing' &&
          updated.lastSyncedAt !== previousSync
        ) {
          setMessage(
            updated.status === 'ready'
              ? `${collection.title} synchronized and verified in Plex.`
              : `${collection.title} finished with an error. Review its status and the Dashboard outcome.`
          );
          return;
        }
        if (['completed', 'cancelled', 'failed'].includes(job.phase)) {
          const outcome = job.recentOutcomes.find(
            (item) => item.id === collection.id
          );
          if (outcome?.outcome === 'success') {
            setMessage(
              `${collection.title} synchronized and verified in Plex.`
            );
          } else if (outcome?.outcome === 'skipped') {
            setMessage(
              outcome.errorMessage ??
                `${collection.title} was safely skipped. No Plex changes were required.`
            );
          } else {
            setMessage(
              outcome?.errorMessage ??
                `${collection.title} finished with an error. Review the Dashboard outcome.`
            );
          }
          return;
        }
      }
      setMessage(
        `${collection.title} is still synchronizing. Progress remains available on the Dashboard.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : `Unable to synchronize ${collection.title}.`
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteTargets = useMemo(() => {
    const requested = new Set(deleteIds);
    for (const id of deleteIds) {
      const collection = data?.collections.find((item) => item.id === id);
      if (!collection?.isLinked || !collection.linkGroupId) continue;
      for (const member of data?.collections ?? []) {
        if (member.isLinked && member.linkGroupId === collection.linkGroupId)
          requested.add(member.id);
      }
    }
    return [...requested];
  }, [data, deleteIds]);
  const openEditor = (collection?: ManagedCollection) => {
    setEditorMessage('');
    setEditorId(collection?.id ?? '');
    const firstMovieLibrary = data?.libraries.find(
      (item) => item.mediaType === 'movie'
    );
    setDraft(
      collection
        ? {
            title: collection.title,
            description: collection.description,
            mediaType: collection.mediaType,
            itemType: collection.itemType ?? collection.mediaType,
            libraryId: collection.libraryId,
            sourceType: collection.sourceType,
            sourceSettings:
              collection.sourceSettings ?? emptyCollectionDraft.sourceSettings,
            posterSettings:
              collection.posterSettings ?? emptyCollectionDraft.posterSettings,
            behaviorSettings: collection.behaviorSettings ?? {
              ...defaultCollectionBehavior,
              visibility: {
                usersHome: collection.homeVisible,
                serverOwnerHome: collection.homeVisible,
                libraryRecommended: collection.recommendedVisible,
              },
            },
            missingMediaSettings:
              collection.missingMediaSettings ?? defaultMissingMediaSettings,
            multiSourceSettings:
              collection.multiSourceSettings ?? defaultMultiSourceSettings,
            metadataSettings:
              collection.metadataSettings ?? defaultCollectionMetadata,
            tmdbDiscoverSettings:
              collection.tmdbDiscoverSettings ?? defaultTmdbDiscoverSettings,
          }
        : {
            ...emptyCollectionDraft,
            libraryId: firstMovieLibrary?.id ?? '',
          }
    );
  };
  const saveEditor = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setEditorMessage('');
    setMessage('Saving collection…');
    try {
      await api.saveCollection(editorId || undefined, draft);
      setEditorId(undefined);
      window.history.replaceState({}, '', '/allcollections');
      await load();
      setMessage(
        editorId
          ? 'Collection changes saved.'
          : 'Collection created and ready to synchronize.'
      );
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Unable to save collection.';
      setEditorMessage(detail);
      setMessage(detail);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (collection: ManagedCollection) => {
    setBusy(true);
    try {
      await api.copyCollection(collection.id);
      await load();
      setMessage(
        `${collection.title} copied. The copy is hidden from Home and Recommended until reviewed.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to copy collection.'
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const groupRequests = new Set<string>();
      const requestIds = deleteTargets.filter((id) => {
        const collection = data?.collections.find((item) => item.id === id);
        const key =
          collection?.isLinked && collection.linkGroupId
            ? collection.linkGroupId
            : id;
        if (groupRequests.has(key)) return false;
        groupRequests.add(key);
        return true;
      });
      for (const id of requestIds) await api.deleteCollection(id);
      const count = deleteTargets.length;
      setDeleteIds([]);
      setSelected(new Set());
      await load();
      setMessage(
        `${count} collection${count === 1 ? '' : 's'} deleted from Vynode. Plex content is not deleted.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to delete collections.'
      );
    } finally {
      setBusy(false);
    }
  };
  const bulkVisibility = async (visible: boolean) => {
    setBusy(true);
    try {
      await Promise.all(
        [...selected].map((id) =>
          api.updateCollectionPlacement(id, {
            homeVisible: visible,
            recommendedVisible: visible,
            libraryVisible: visible,
          })
        )
      );
      await load();
      setMessage(
        `${selected.size} collections ${visible ? 'made visible' : 'hidden'} on all Plex surfaces.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to update selected collections.'
      );
    } finally {
      setBusy(false);
    }
  };
  const saveLinks = async () => {
    if (!linkMaster) return;
    setBusy(true);
    try {
      await api.linkCollections(linkMaster.id, [...linkMembers]);
      setLinkMaster(undefined);
      setLinkMembers(new Set());
      await load();
      setMessage(
        'Collections linked. Shared-setting edits now update every library atomically.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to link collections.'
      );
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (collection: ManagedCollection) => {
    setBusy(true);
    try {
      const result = await api.unlinkCollection(collection.id);
      await load();
      setMessage(
        `${result.collections.length} collections unlinked. Their group identity was preserved for relinking.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to unlink collections.'
      );
    } finally {
      setBusy(false);
    }
  };
  const discoverPlex = async () => {
    setBusy(true);
    setMessage(
      'Refreshing Plex libraries and scanning hubs and existing collections…'
    );
    try {
      const result = await api.discoverPlexCollections();
      await load();
      const summary = result.imported.length
        ? `Imported ${result.imported.length} new Plex item${result.imported.length === 1 ? '' : 's'}; validated ${result.validated} total.`
        : `Discovery complete. All ${result.validated} Plex hubs and collections were already imported.`;
      setMessage(
        result.warnings?.length
          ? `${summary} ${result.warnings.length} Plex source${result.warnings.length === 1 ? '' : 's'} could not be read: ${result.warnings.join(' ')}`
          : summary
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to scan Plex libraries.'
      );
    } finally {
      setBusy(false);
    }
  };
  const openDiscoveredEditor = (item: PlexDiscoveredItem) => {
    setDiscoveredEditor(item);
    setDiscoveredDraft({
      homeOrder: item.homeOrder,
      libraryOrder: item.libraryOrder,
      visibility: item.visibility,
      timeRestriction: item.timeRestriction,
      ...(item.kind === 'pre-existing-collection'
        ? {
            posterSettings:
              item.posterSettings ?? emptyCollectionDraft.posterSettings,
            metadataSettings:
              item.metadataSettings ?? defaultCollectionMetadata,
          }
        : {}),
      ...(item.titleSort ? { titleSort: item.titleSort } : {}),
    });
  };
  const saveDiscovered = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!discoveredEditor || !discoveredDraft) return;
    setBusy(true);
    try {
      await api.saveDiscoveredPlexItem(discoveredEditor.id, discoveredDraft);
      const name = discoveredEditor.name;
      setDiscoveredEditor(undefined);
      await load();
      setMessage(
        `${name} placement, schedule, and artwork settings saved for the next Plex synchronization.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to save the discovered Plex item.'
      );
    } finally {
      setBusy(false);
    }
  };
  const discoveredLinkCandidates = (master: PlexDiscoveredItem) =>
    (data?.discoveredPlexItems ?? []).filter(
      (item) =>
        item.id !== master.id &&
        !item.missing &&
        item.kind === master.kind &&
        item.mediaType === master.mediaType &&
        item.libraryId !== master.libraryId &&
        (master.kind === 'default-hub'
          ? item.plexKey === master.plexKey
          : item.name.trim().toLocaleLowerCase() ===
            master.name.trim().toLocaleLowerCase()) &&
        (!item.isLinked || item.linkGroupId === master.linkGroupId)
    );
  const saveDiscoveredLinks = async () => {
    if (!discoveredLinkMaster) return;
    setBusy(true);
    try {
      const result = await api.linkDiscoveredPlexItems(
        discoveredLinkMaster.id,
        [...discoveredLinkMembers]
      );
      setDiscoveredLinkMaster(undefined);
      setDiscoveredLinkMembers(new Set());
      await load();
      setMessage(
        `${result.items.length} Plex ${discoveredLinkMaster.kind === 'default-hub' ? 'hubs' : 'collections'} linked. Shared-setting edits now update every library atomically.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to link discovered Plex items.'
      );
    } finally {
      setBusy(false);
    }
  };
  const unlinkDiscovered = async (item: PlexDiscoveredItem) => {
    setBusy(true);
    try {
      const result = await api.unlinkDiscoveredPlexItems(item.id);
      await load();
      setMessage(
        `${result.items.length} Plex ${item.kind === 'default-hub' ? 'hubs' : 'collections'} unlinked. Each library can now be configured independently.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to unlink discovered Plex items.'
      );
    } finally {
      setBusy(false);
    }
  };
  const cleanupMissing = async () => {
    setBusy(true);
    try {
      const result = await api.cleanupMissingPlexItems();
      setCleanupMissingOpen(false);
      await load();
      setMessage(
        `${result.cleanupCount} missing configuration${result.cleanupCount === 1 ? '' : 's'} removed${result.plexHubDeleteCount ? `; ${result.plexHubDeleteCount} stale Plex hub promotion${result.plexHubDeleteCount === 1 ? '' : 's'} also cleared` : ''}.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to clean up missing Plex configurations.'
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="all-collections">
      <div className="placement-toolbar">
        <div>
          <h2>Managed collections</h2>
          <p>
            Search, filter, preview, synchronize, copy, and manage collections
            across every connected Plex library.
          </p>
        </div>
        <div className="actions">
          <button
            className="button secondary"
            type="button"
            disabled={
              busy ||
              data?.discoveryStatus?.running ||
              !data?.discoveryStatus?.enabled
            }
            onClick={() => void discoverPlex()}
          >
            {data?.discoveryStatus?.running
              ? 'Scanning Plex…'
              : 'Discover Plex items'}
          </button>
          <button
            className="button primary"
            type="button"
            onClick={() => openEditor()}
          >
            Create collection
          </button>
        </div>
      </div>
      <p className="field-help">
        Discovery refreshes the verified Plex library inventory, imports
        built-in hubs and existing Plex collections, and marks missing
        configurations without deleting them. It never imports music or photo
        libraries.
      </p>
      <div className="collection-filters">
        <label>
          Search
          <input
            type="search"
            value={query}
            placeholder="Name or description"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Library
          <select
            value={library}
            onChange={(event) => setLibrary(event.target.value)}
          >
            <option value="all">All libraries</option>
            {data?.libraries.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="all">All sources</option>
            {collectionSourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="needs-sync">Needs sync</option>
            <option value="syncing">Syncing</option>
            <option value="error">Error</option>
          </select>
        </label>
      </div>
      {selected.size > 0 && (
        <div
          className="bulk-bar"
          role="region"
          aria-label="Bulk collection actions"
        >
          <strong>{selected.size} selected</strong>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void bulkVisibility(true)}
          >
            Show everywhere
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void bulkVisibility(false)}
          >
            Hide everywhere
          </button>
          <button
            className="text-button danger-text"
            disabled={busy}
            onClick={() => setDeleteIds([...selected])}
          >
            Delete
          </button>
          <button
            className="text-button"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}
      {message && (
        <p className="source-feedback" role="status">
          {message}
        </p>
      )}
      {(data?.discoveredPlexItems?.length ?? 0) > 0 && (
        <section
          className="discovered-plex-panel"
          aria-labelledby="discovered-plex-title"
        >
          <div>
            <h3 id="discovered-plex-title">Discovered Plex items</h3>
            <p>
              These already exist in Plex. Vynode manages their placement,
              visibility, scheduling, and artwork without replacing their
              membership.
            </p>
            <button
              type="button"
              className="button secondary"
              aria-expanded={showDiscoveredPlexItems}
              onClick={() => setShowDiscoveredPlexItems((current) => !current)}
            >
              {showDiscoveredPlexItems ? 'Hide' : 'Show'}{' '}
              {filteredDiscovered.length} discovered Plex items
            </button>
            {(data?.discoveredPlexItems?.filter((item) => item.missing)
              .length ?? 0) > 0 && (
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => setCleanupMissingOpen(true)}
              >
                Clean up{' '}
                {
                  data?.discoveredPlexItems?.filter((item) => item.missing)
                    .length
                }{' '}
                missing
              </button>
            )}
          </div>
          {showDiscoveredPlexItems && <div className="discovered-plex-list">
            {filteredDiscovered.map((item) => (
              <article key={item.id}>
                <span className="collection-poster">
                  {item.kind === 'default-hub'
                    ? 'H'
                    : item.mediaType === 'movie'
                      ? 'M'
                      : 'TV'}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.kind === 'default-hub'
                      ? 'Built-in Plex hub'
                      : 'Pre-existing collection'}{' '}
                    · {item.libraryName} · Plex key {item.plexKey}
                  </small>
                </span>
                <span className="placement-badges">
                  <i className={item.visibility.usersHome ? 'on' : ''}>Home</i>
                  <i className={item.visibility.libraryRecommended ? 'on' : ''}>
                    Recommended
                  </i>
                  {item.isLinked && <i className="on">Linked</i>}
                  {item.isUnlinked && <i>Previously unlinked</i>}
                </span>
                <span
                  className={`collection-status ${item.missing ? 'error' : 'ready'}`}
                >
                  {item.missing ? 'missing from Plex' : 'validated'}
                </span>
                <span className="discovered-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={item.missing}
                    title={
                      item.missing
                        ? 'Run discovery again or clean up this missing configuration.'
                        : undefined
                    }
                    onClick={() => openDiscoveredEditor(item)}
                  >
                    Manage
                  </button>
                  {item.isLinked ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setDiscoveredUnlinkTarget(item)}
                    >
                      Unlink
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      disabled={
                        item.missing ||
                        discoveredLinkCandidates(item).length === 0
                      }
                      title={
                        item.missing
                          ? 'Missing Plex items cannot be linked.'
                          : discoveredLinkCandidates(item).length === 0
                            ? 'No matching item was discovered in another compatible library.'
                            : 'Configure matching Plex items together across libraries.'
                      }
                      onClick={() => {
                        setDiscoveredLinkMaster(item);
                        setDiscoveredLinkMembers(new Set());
                      }}
                    >
                      {item.isUnlinked ? 'Relink' : 'Link'}
                    </button>
                  )}
                </span>
              </article>
            ))}
          </div>}
        </section>
      )}
      <div className="collection-table">
        <div className="collection-table-head">
          <label>
            <input
              type="checkbox"
              aria-label="Select all filtered collections"
              checked={
                filtered.length > 0 &&
                filtered.every((item) => selected.has(item.id))
              }
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? new Set(filtered.map((item) => item.id))
                    : new Set()
                )
              }
            />{' '}
            Collection
          </label>
          <span>Library</span>
          <span>Placement</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        {filtered.map((collection) => (
          <article key={collection.id}>
            <label className="collection-title-cell">
              <input
                type="checkbox"
                aria-label={`Select ${collection.title}`}
                checked={selected.has(collection.id)}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    event.target.checked
                      ? next.add(collection.id)
                      : next.delete(collection.id);
                    return next;
                  })
                }
              />
              <span className="collection-poster">
                {collection.mediaType === 'movie' ? 'M' : 'TV'}
              </span>
              <span>
                <strong>
                  {collection.title}{' '}
                  {collection.isLinked && (
                    <i
                      className="link-badge"
                      title="Settings are linked across Plex libraries"
                    >
                      Linked
                    </i>
                  )}
                  {collection.isUnlinked && (
                    <i
                      className="link-badge muted"
                      title="Previously linked; can be relinked"
                    >
                      Unlinked
                    </i>
                  )}
                </strong>
                <small>
                  {collection.itemCount} items ·{' '}
                  {collection.sourceType.toUpperCase()}
                </small>
                {collection.lastSyncError && (
                  <small className="error-text">
                    Last sync error: {collection.lastSyncError}
                  </small>
                )}
              </span>
            </label>
            <span>{collection.libraryName}</span>
            <span className="placement-badges">
              <i className={collection.homeVisible ? 'on' : ''}>Home</i>
              <i className={collection.recommendedVisible ? 'on' : ''}>
                Recommended
              </i>
              <i className={collection.libraryVisible ? 'on' : ''}>Library</i>
            </span>
            <span className={`collection-status ${collection.status}`}>
              {collection.status.replace('-', ' ')}
            </span>
            <span className="row-actions">
              <button
                aria-label={`Sync ${collection.title}`}
                disabled={busy || collection.status === 'syncing'}
                onClick={() => void syncCollection(collection)}
              >
                {collection.status === 'syncing' ? 'Syncing…' : 'Sync'}
              </button>
              <button
                aria-label={`Preview ${collection.title}`}
                onClick={() => void openPreview(collection)}
              >
                Preview
              </button>
              <button
                aria-label={`Edit ${collection.title}`}
                onClick={() => openEditor(collection)}
              >
                Edit
              </button>
              {collection.isLinked ? (
                <button
                  aria-label={`Unlink ${collection.title}`}
                  disabled={busy}
                  onClick={() => setUnlinkTarget(collection)}
                >
                  Unlink
                </button>
              ) : (
                <button
                  aria-label={`Link ${collection.title}`}
                  disabled={busy}
                  onClick={() => {
                    setLinkMaster(collection);
                    setLinkMembers(new Set());
                  }}
                >
                  Link
                </button>
              )}
              <button
                aria-label={`Copy ${collection.title}`}
                disabled={busy}
                onClick={() => void copy(collection)}
              >
                Copy
              </button>
              <button
                aria-label={`Delete ${collection.title}`}
                onClick={() => setDeleteIds([collection.id])}
              >
                Delete
              </button>
            </span>
          </article>
        ))}
      </div>
      {!message && filtered.length === 0 && (
        <div className="main-panel empty-state">
          <strong>No collections match these filters.</strong>
          <p>Clear a filter or create a new collection.</p>
        </div>
      )}
      {editorId !== undefined && (
        <div className="modal-backdrop">
          <form
            className="folder-modal collection-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collection-editor-title"
            onSubmit={(event) => void saveEditor(event)}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Collection setup</p>
                <h3 id="collection-editor-title">
                  {editorId ? 'Edit collection' : 'Create collection'}
                </h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                type="button"
                aria-label="Close collection editor"
                onClick={() => setEditorId(undefined)}
              >
                ×
              </button>
            </div>
            {editorMessage && (
              <p className="source-feedback error-text" role="alert">
                {editorMessage}
              </p>
            )}
            {!editorId && (
              <section className="collection-template-picker">
                <label>
                  Start from a collection template
                  <select
                    value={configTemplateId}
                    onChange={(event) => {
                      const templateId = event.target.value;
                      setConfigTemplateId(templateId);
                      if (templateId) {
                        setDraft((current) =>
                          applyCollectionConfigTemplate(current, templateId)
                        );
                      }
                    }}
                  >
                    <option value="">Blank collection</option>
                    {[
                      'Plex value generators',
                      'Curated smart collections',
                    ].map((group) => (
                      <optgroup label={group} key={group}>
                        {collectionConfigTemplates
                          .filter((template) => template.group === group)
                          .map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  <small>
                    {configTemplateId
                      ? collectionConfigTemplates.find(
                          (template) => template.id === configTemplateId
                        )?.description
                      : 'Choose a tested starting point. Every populated setting remains editable before you save.'}
                  </small>
                </label>
              </section>
            )}
            <label>
              Collection name
              <input
                required
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
              <small>Shown as the Plex collection title.</small>
            </label>
            <label>
              Description
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
              <small>
                Optional context shown to administrators; providers may supply
                their own summary.
              </small>
            </label>
            <div className="field-grid">
              <label>
                Media type
                <select
                  disabled={Boolean(
                    editorId &&
                      data?.collections.find((item) => item.id === editorId)
                        ?.isLinked
                  )}
                  value={draft.mediaType}
                  onChange={(event) => {
                    const mediaType = event.target
                      .value as CollectionDraft['mediaType'];
                    const firstCompatibleLibrary = data?.libraries.find(
                      (item) => item.mediaType === mediaType
                    );
                    setDraft({
                      ...draft,
                      mediaType,
                      itemType: mediaType,
                      libraryId: firstCompatibleLibrary?.id ?? '',
                      sourceSettings: {
                        ...draft.sourceSettings,
                        manualMembers: [],
                      },
                    });
                  }}
                >
                  <option value="movie">Movies</option>
                  <option value="show">TV shows</option>
                </select>
                <small>
                  {editorId &&
                  data?.collections.find((item) => item.id === editorId)
                    ?.isLinked
                    ? 'Media type is fixed while this collection is linked.'
                    : 'Determines which Plex libraries and source results are compatible.'}
                </small>
              </label>
              <label>
                Collection items
                <select
                  value={draft.itemType ?? draft.mediaType}
                  onChange={(event) => {
                    const itemType = event.target
                      .value as NonNullable<CollectionDraft['itemType']>;
                    const mediaType = itemType === 'movie' ? 'movie' : 'show';
                    const firstCompatibleLibrary = data?.libraries.find(
                      (item) => item.mediaType === mediaType
                    );
                    setDraft({
                      ...draft,
                      itemType,
                      mediaType,
                      libraryId: firstCompatibleLibrary?.id ?? '',
                      sourceType:
                        itemType === 'season' || itemType === 'episode'
                          ? 'manual'
                          : draft.sourceType,
                      sourceSettings: {
                        ...draft.sourceSettings,
                        ...(itemType === 'season' || itemType === 'episode'
                          ? { subtype: '' }
                          : {}),
                        manualMembers: [],
                      },
                      behaviorSettings: {
                        ...draft.behaviorSettings,
                        ...(itemType === 'season' || itemType === 'episode'
                          ? { showUnwatchedOnly: false }
                          : {}),
                      },
                    });
                  }}
                >
                  <option value="movie">Movies</option>
                  <option value="show">TV shows</option>
                  <option value="season">TV seasons</option>
                  <option value="episode">TV episodes</option>
                </select>
                <small>
                  Season and episode collections use exact Plex identities from
                  a TV library.
                </small>
              </label>
              <label>
                Plex library
                <select
                  disabled={Boolean(
                    editorId &&
                      data?.collections.find((item) => item.id === editorId)
                        ?.isLinked
                  )}
                  value={draft.libraryId}
                  onChange={(event) =>
                    setDraft({ ...draft, libraryId: event.target.value })
                  }
                >
                  {data?.libraries
                    .filter((item) => item.mediaType === draft.mediaType)
                    .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <small>
                  {editorId &&
                  data?.collections.find((item) => item.id === editorId)
                    ?.isLinked
                    ? 'Library identity stays independent for each linked member. Unlink before moving it.'
                    : 'Items can only be added to this library.'}
                </small>
              </label>
            </div>
            <label>
              Source
              <select
                disabled={
                  draft.itemType === 'season' || draft.itemType === 'episode'
                }
                value={draft.sourceType}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    sourceType: event.target
                      .value as CollectionDraft['sourceType'],
                    sourceSettings: {
                      subtype: '',
                      maxItems: draft.sourceSettings.maxItems,
                      itemOrder: draft.sourceSettings.itemOrder,
                    },
                  })
                }
              >
                {collectionSourceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>
                Selecting a source reveals its required list, filter, and
                provider controls below.
              </small>
            </label>
            <CollectionSourceFields draft={draft} onChange={setDraft} />
            <TmdbDiscoverFields draft={draft} onChange={setDraft} />
            <CollectionMultiSourceFields
              draft={draft}
              onChange={setDraft}
              onMessage={setMessage}
            />
            <CollectionPosterFields
              draft={draft}
              onChange={setDraft}
              onMessage={setMessage}
            />
            <CollectionMetadataFields
              draft={draft}
              onChange={setDraft}
              onMessage={setMessage}
            />
            <CollectionBehaviorFields draft={draft} onChange={setDraft} />
            <CollectionMissingMediaFields draft={draft} onChange={setDraft} />
            <div className="actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditorId(undefined)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save collection'}
              </button>
            </div>
          </form>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop">
          <section
            className="folder-modal collection-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collection-preview-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Plex preview</p>
                <h3 id="collection-preview-title">{preview.title}</h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                aria-label="Close collection preview"
                onClick={() => setPreview(undefined)}
              >
                ×
              </button>
            </div>
            <div className="preview-hero">
              <span className="collection-poster">
                {preview.mediaType === 'movie' ? 'M' : 'TV'}
              </span>
              <div>
                <strong>{preview.title}</strong>
                <p>{preview.description || 'No description provided.'}</p>
                <small>
                  {preview.libraryName} ·{' '}
                  {previewResult?.fetchedCount ?? preview.itemCount}{' '}
                  {(previewResult?.fetchedCount ?? preview.itemCount) === 1
                    ? 'item'
                    : 'items'}
                </small>
              </div>
            </div>
            <p className="field-help">
              {preview.sourceType === 'plex' &&
              preview.sourceSettings?.plexGenerator
                ? 'This preview reads the values already present in the selected Plex library and shows which smart collections will be maintained without changing Plex.'
                : 'This preview reads the configured source and matches its external IDs against the selected Plex library without changing Plex.'}
            </p>
            {previewMessage && (
              <p className="dependency-notice" role="status">
                {previewMessage}
              </p>
            )}
            {previewResult && (
              <>
                <div className="preview-stat-grid">
                  <span>
                    <strong>{previewResult.fetchedCount}</strong>
                    <small>
                      {preview.sourceType === 'plex' &&
                      preview.sourceSettings?.plexGenerator
                        ? 'Plex values'
                        : 'Source items'}
                    </small>
                  </span>
                  <span>
                    <strong>{previewResult.matchedCount}</strong>
                    <small>
                      {preview.sourceType === 'plex' &&
                      preview.sourceSettings?.plexGenerator
                        ? 'Selected collections'
                        : 'Available in Plex'}
                    </small>
                  </span>
                  <span>
                    <strong>{previewResult.missingCount}</strong>
                    <small>
                      {preview.sourceType === 'plex' &&
                      preview.sourceSettings?.plexGenerator
                        ? 'Not selected'
                        : 'Missing from Plex'}
                    </small>
                  </span>
                </div>
                {previewResult.warnings.map((warning) => (
                  <p className="dependency-notice missing" key={warning}>
                    {warning}
                  </p>
                ))}
                <div
                  className="collection-preview-items"
                  aria-label="Collection preview items"
                >
                  {previewResult.items.map((item, index) => (
                    <article
                      key={`${item.tmdbId ?? item.plexRatingKey ?? item.title}-${index}`}
                    >
                      <span>
                        <strong>
                          {index + 1}. {item.title}
                        </strong>
                        <small>
                          {item.year ? `${item.year} · ` : ''}
                          {item.tmdbId ? `TMDB ${item.tmdbId}` : ''}
                          {item.tmdbId && item.plexRatingKey ? ' · ' : ''}
                          {item.plexRatingKey
                            ? `Plex ${item.plexRatingKey}`
                            : ''}
                        </small>
                      </span>
                      <i className={item.available ? 'available' : 'missing'}>
                        {item.available ? 'Available' : 'Missing'}
                      </i>
                    </article>
                  ))}
                  {!previewResult.items.length && (
                    <p className="empty-state">
                      The source returned no preview items.
                    </p>
                  )}
                </div>
              </>
            )}
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => setPreview(undefined)}
              >
                Close
              </button>
              <button
                className="button primary"
                disabled={
                  !previewResult ||
                  previewResult.fetchedCount === 0 ||
                  Boolean(previewMessage)
                }
                title={
                  previewMessage
                    ? 'Resolve the preview issue before synchronizing.'
                    : previewResult?.fetchedCount === 0
                      ? 'The source must return at least one item before synchronizing.'
                    : undefined
                }
                onClick={() => {
                  setPreview(undefined);
                  void syncCollection(preview);
                }}
              >
                Sync this collection
              </button>
            </div>
          </section>
        </div>
      )}
      {deleteIds.length > 0 && (
        <div className="modal-backdrop">
          <section
            className="folder-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-collection-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Confirm deletion</p>
                <h3 id="delete-collection-title">
                  Delete {deleteTargets.length} collection
                  {deleteTargets.length === 1 ? '' : 's'}?
                </h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                aria-label="Cancel collection deletion"
                onClick={() => setDeleteIds([])}
              >
                ×
              </button>
            </div>
            <p>
              {deleteTargets.length > deleteIds.length
                ? `Your selection includes an active linked group, so all ${deleteTargets.length} linked configurations will be removed together. `
                : ''}
              Existing Plex collection content is not deleted until a
              synchronization policy explicitly removes it.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => setDeleteIds([])}
              >
                Cancel
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy
                  ? 'Deleting…'
                  : `Delete ${deleteTargets.length === 1 ? 'collection' : 'collections'}`}
              </button>
            </div>
          </section>
        </div>
      )}
      {linkMaster && (
        <div className="modal-backdrop">
          <section
            className="folder-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-collection-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Linked libraries</p>
                <h3 id="link-collection-title">Link {linkMaster.title}</h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                aria-label="Cancel collection linking"
                onClick={() => setLinkMaster(undefined)}
              >
                ×
              </button>
            </div>
            <p>
              Choose matching collections in other Plex libraries. This
              collection is the master: its source, filters, metadata,
              schedules, and download routing will be copied to every selected
              member.
            </p>
            <div className="link-candidates">
              {(data?.collections ?? [])
                .filter(
                  (item) =>
                    item.id !== linkMaster.id &&
                    item.mediaType === linkMaster.mediaType &&
                    item.sourceType === linkMaster.sourceType &&
                    item.libraryId !== linkMaster.libraryId &&
                    (!item.isLinked ||
                      item.linkGroupId === linkMaster.linkGroupId)
                )
                .map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={linkMembers.has(item.id)}
                      onChange={(event) =>
                        setLinkMembers((current) => {
                          const next = new Set(current);
                          event.target.checked
                            ? next.add(item.id)
                            : next.delete(item.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.libraryName} · {item.sourceType.toUpperCase()}
                        {item.isUnlinked ? ' · previously unlinked' : ''}
                      </small>
                    </span>
                  </label>
                ))}
            </div>
            <p className="field-help">
              Library identity, Plex placement and ordering, current item state,
              and each library’s custom poster stay independent. Unlinking keeps
              the group identity for safe relinking.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => setLinkMaster(undefined)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || linkMembers.size === 0}
                onClick={() => void saveLinks()}
              >
                {busy ? 'Linking…' : `Link ${linkMembers.size + 1} collections`}
              </button>
            </div>
          </section>
        </div>
      )}
      {unlinkTarget && (
        <div className="modal-backdrop">
          <section
            className="folder-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unlink-collection-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Confirm unlink</p>
                <h3 id="unlink-collection-title">
                  Unlink this collection group?
                </h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                aria-label="Cancel collection unlinking"
                onClick={() => setUnlinkTarget(undefined)}
              >
                ×
              </button>
            </div>
            <p>
              {
                (data?.collections ?? []).filter(
                  (item) =>
                    item.isLinked &&
                    item.linkGroupId === unlinkTarget.linkGroupId
                ).length
              }{' '}
              linked collections named “{unlinkTarget.title}” will become
              independently editable. No Plex collection or media is deleted.
            </p>
            <p className="field-help">
              The link group identity is preserved, so any member can safely
              relink the group later.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => setUnlinkTarget(undefined)}
              >
                Keep linked
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => {
                  const target = unlinkTarget;
                  setUnlinkTarget(undefined);
                  void unlink(target);
                }}
              >
                {busy ? 'Unlinking…' : 'Unlink collections'}
              </button>
            </div>
          </section>
        </div>
      )}
      {discoveredLinkMaster && (
        <div className="modal-backdrop">
          <section
            className="folder-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-discovered-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Link discovered Plex items</p>
                <h3 id="link-discovered-title">
                  Link {discoveredLinkMaster.name}
                </h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                aria-label="Cancel discovered Plex linking"
                onClick={() => {
                  setDiscoveredLinkMaster(undefined);
                  setDiscoveredLinkMembers(new Set());
                }}
              >
                ×
              </button>
            </div>
            <p>
              Choose the matching{' '}
              {discoveredLinkMaster.kind === 'default-hub'
                ? 'built-in hub'
                : 'pre-existing collection'}{' '}
              in another Plex library. The selected master supplies shared
              visibility, schedules, poster rules, summary, and metadata.
            </p>
            <div className="link-master-summary">
              <strong>Master: {discoveredLinkMaster.name}</strong>
              <small>
                {discoveredLinkMaster.libraryName} · Plex key{' '}
                {discoveredLinkMaster.plexKey}
              </small>
            </div>
            <div className="link-candidates">
              {discoveredLinkCandidates(discoveredLinkMaster).map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={discoveredLinkMembers.has(item.id)}
                    onChange={(event) =>
                      setDiscoveredLinkMembers((current) => {
                        const next = new Set(current);
                        event.target.checked
                          ? next.add(item.id)
                          : next.delete(item.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.libraryName} · Plex key {item.plexKey}
                      {item.isUnlinked ? ' · previously unlinked' : ''}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <p className="field-help">
              Plex keys, library identity, ordering, and each library’s selected
              poster, wallpaper, and theme file stay independent. Linking never
              changes collection membership or deletes Plex content.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => {
                  setDiscoveredLinkMaster(undefined);
                  setDiscoveredLinkMembers(new Set());
                }}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || discoveredLinkMembers.size === 0}
                onClick={() => void saveDiscoveredLinks()}
              >
                {busy
                  ? 'Linking…'
                  : `Link ${discoveredLinkMembers.size + 1} Plex items`}
              </button>
            </div>
          </section>
        </div>
      )}
      {discoveredUnlinkTarget && (
        <div className="modal-backdrop">
          <section
            className="folder-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unlink-discovered-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Confirm unlink</p>
                <h3 id="unlink-discovered-title">
                  Unlink this Plex item group?
                </h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                aria-label="Cancel discovered Plex unlinking"
                onClick={() => setDiscoveredUnlinkTarget(undefined)}
              >
                ×
              </button>
            </div>
            <p>
              {
                (data?.discoveredPlexItems ?? []).filter(
                  (item) =>
                    item.isLinked &&
                    item.linkGroupId === discoveredUnlinkTarget.linkGroupId
                ).length
              }{' '}
              linked Plex items named “{discoveredUnlinkTarget.name}” will
              become independently editable. Their Plex collections, hubs,
              membership, and media remain unchanged.
            </p>
            <p className="field-help">
              Vynode preserves the link-group identity and every library’s
              current settings, so the group can be safely relinked later.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => setDiscoveredUnlinkTarget(undefined)}
              >
                Keep linked
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => {
                  const target = discoveredUnlinkTarget;
                  setDiscoveredUnlinkTarget(undefined);
                  void unlinkDiscovered(target);
                }}
              >
                {busy ? 'Unlinking…' : 'Unlink Plex items'}
              </button>
            </div>
          </section>
        </div>
      )}
      {cleanupMissingOpen && (
        <div className="modal-backdrop">
          <section
            className="folder-modal confirmation-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cleanup-missing-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Confirm cleanup</p>
                <h3 id="cleanup-missing-title">
                  Remove{' '}
                  {
                    data?.discoveredPlexItems?.filter((item) => item.missing)
                      .length
                  }{' '}
                  missing configuration?
                </h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                aria-label="Cancel missing configuration cleanup"
                onClick={() => setCleanupMissingOpen(false)}
              >
                ×
              </button>
            </div>
            <p>
              Vynode will permanently remove every configuration that the latest
              Plex discovery scan could not find. Any stale Home or Recommended
              hub promotion will also be removed when Plex is reachable.
            </p>
            <p className="field-help">
              Media files and Plex library items are never deleted. Run
              discovery again first if a library or collection may only be
              temporarily unavailable.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => setCleanupMissingOpen(false)}
              >
                Keep configurations
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => void cleanupMissing()}
              >
                {busy ? 'Cleaning up…' : 'Remove missing configurations'}
              </button>
            </div>
          </section>
        </div>
      )}
      {discoveredEditor && discoveredDraft && (
        <div className="modal-backdrop">
          <form
            className="folder-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discovered-item-title"
            onSubmit={(event) => void saveDiscovered(event)}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">
                  {discoveredEditor.kind === 'default-hub'
                    ? 'Built-in Plex hub'
                    : 'Pre-existing Plex collection'}
                </p>
                <h3 id="discovered-item-title">{discoveredEditor.name}</h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                type="button"
                aria-label="Close discovered item editor"
                onClick={() => setDiscoveredEditor(undefined)}
              >
                ×
              </button>
            </div>
            <p>
              Plex key {discoveredEditor.plexKey} ·{' '}
              {discoveredEditor.libraryName}. Vynode changes promotion and
              ordering only; collection membership remains owned by Plex.
            </p>
            <fieldset>
              <legend>Visibility</legend>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={discoveredDraft.visibility.usersHome}
                  onChange={(event) =>
                    setDiscoveredDraft({
                      ...discoveredDraft,
                      visibility: {
                        ...discoveredDraft.visibility,
                        usersHome: event.target.checked,
                      },
                    })
                  }
                />
                <span>
                  <strong>Users Home</strong>
                  <small>
                    Promote this item to managed users’ Home screens.
                  </small>
                </span>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={discoveredDraft.visibility.serverOwnerHome}
                  onChange={(event) =>
                    setDiscoveredDraft({
                      ...discoveredDraft,
                      visibility: {
                        ...discoveredDraft.visibility,
                        serverOwnerHome: event.target.checked,
                      },
                    })
                  }
                />
                <span>
                  <strong>Server Owner Home</strong>
                  <small>
                    Promote this item to the Plex server owner’s Home screen.
                  </small>
                </span>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={discoveredDraft.visibility.libraryRecommended}
                  onChange={(event) =>
                    setDiscoveredDraft({
                      ...discoveredDraft,
                      visibility: {
                        ...discoveredDraft.visibility,
                        libraryRecommended: event.target.checked,
                      },
                    })
                  }
                />
                <span>
                  <strong>Library Recommended</strong>
                  <small>
                    Show this item in the library’s Recommended tab.
                  </small>
                </span>
              </label>
            </fieldset>
            <div className="field-grid">
              <label>
                Home order
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={discoveredDraft.homeOrder}
                  onChange={(event) =>
                    setDiscoveredDraft({
                      ...discoveredDraft,
                      homeOrder: Number(event.target.value),
                    })
                  }
                />
                <small>
                  Zero keeps the item out of Home ordering when Home visibility
                  is disabled.
                </small>
              </label>
              <label>
                Library order
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={discoveredDraft.libraryOrder}
                  onChange={(event) =>
                    setDiscoveredDraft({
                      ...discoveredDraft,
                      libraryOrder: Number(event.target.value),
                    })
                  }
                />
                <small>
                  Zero keeps a collection in the alphabetical section; positive
                  values promote it.
                </small>
              </label>
            </div>
            {discoveredEditor.kind === 'pre-existing-collection' && (
              <label>
                Plex sort title
                <input
                  value={discoveredDraft.titleSort ?? ''}
                  onChange={(event) =>
                    setDiscoveredDraft({
                      ...discoveredDraft,
                      titleSort: event.target.value,
                    })
                  }
                />
                <small>
                  Controls alphabetical placement without renaming the Plex
                  collection.
                </small>
              </label>
            )}
            <DiscoveredScheduleFields
              draft={discoveredDraft}
              onChange={setDiscoveredDraft}
            />
            {discoveredEditor.kind === 'pre-existing-collection' &&
              discoveredDraft.posterSettings &&
              discoveredDraft.metadataSettings && (
                <>
                  <p className="field-help">
                    This collection already exists in Plex, so Vynode leaves
                    membership unchanged while synchronizing the artwork and
                    metadata choices below.
                  </p>
                  <CollectionPosterFields
                    draft={{
                      ...emptyCollectionDraft,
                      posterSettings: discoveredDraft.posterSettings,
                      metadataSettings: discoveredDraft.metadataSettings,
                    }}
                    onChange={(updated) =>
                      setDiscoveredDraft({
                        ...discoveredDraft,
                        posterSettings: updated.posterSettings,
                      })
                    }
                    onMessage={setMessage}
                  />
                  <CollectionMetadataFields
                    draft={{
                      ...emptyCollectionDraft,
                      posterSettings: discoveredDraft.posterSettings,
                      metadataSettings: discoveredDraft.metadataSettings,
                    }}
                    onChange={(updated) =>
                      setDiscoveredDraft({
                        ...discoveredDraft,
                        metadataSettings: updated.metadataSettings,
                      })
                    }
                    onMessage={setMessage}
                  />
                </>
              )}
            <div className="actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setDiscoveredEditor(undefined)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save Plex placement'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};

const GeneralSettingsPage = () => {
  const [settings, setSettings] =
    useState<Awaited<ReturnType<typeof api.generalSettings>>>();
  const [draft, setDraft] = useState<GeneralSettingsDraft>();
  const [message, setMessage] = useState('Loading general settings…');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<'key' | 'cache'>();
  const confirmationClose = useRef<HTMLButtonElement>(null);
  const load = async () => {
    setMessage('Loading general settings…');
    try {
      const next = await api.generalSettings();
      setSettings(next);
      setDraft({
        applicationTitle: next.applicationTitle,
        applicationUrl: next.applicationUrl,
        locale: next.locale,
        cacheImages: next.cacheImages,
        imageCacheDays: next.imageCacheDays,
        globalExcludedTitles: next.globalExcludedTitles ?? [],
      });
      setMessage('');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load general settings.'
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!confirmation) return;
    confirmationClose.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmation(undefined);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [confirmation]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings || !draft) return;
    setBusy(true);
    setMessage('Saving general settings…');
    try {
      const next = await api.saveGeneralSettings(settings.revision, draft);
      setSettings(next);
      setMessage('General settings saved.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to save general settings.'
      );
      await load();
    } finally {
      setBusy(false);
    }
  };
  const runMaintenance = async () => {
    if (!confirmation) return;
    setBusy(true);
    try {
      const next =
        confirmation === 'key'
          ? await api.regenerateApiKey()
          : await api.clearImageCache();
      setSettings(next);
      setConfirmation(undefined);
      setMessage(
        confirmation === 'key'
          ? 'API key regenerated. Existing API clients must use the new key.'
          : 'Image cache cleared. Posters will be downloaded again when needed.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Maintenance action failed.'
      );
    } finally {
      setBusy(false);
    }
  };
  if (!draft || !settings) {
    return (
      <section className="main-panel">
        {message && (
          <p className="source-feedback" role="status">
            {message}
          </p>
        )}
      </section>
    );
  }
  return (
    <form className="settings-form" onSubmit={(event) => void save(event)}>
      {message && (
        <p className="source-feedback" role="status">
          {message}
        </p>
      )}
      <section className="main-panel settings-section">
        <div>
          <h2>Application identity</h2>
          <p>
            These values appear in browser titles, links, notifications, and
            externally generated callback URLs.
          </p>
        </div>
        <label>
          Application name
          <input
            required
            maxLength={80}
            value={draft.applicationTitle}
            onChange={(event) =>
              setDraft({ ...draft, applicationTitle: event.target.value })
            }
          />
          <small>Use a recognizable name for this Vynode installation.</small>
        </label>
        <label>
          Application URL
          <input
            required
            type="url"
            value={draft.applicationUrl}
            onChange={(event) =>
              setDraft({ ...draft, applicationUrl: event.target.value })
            }
          />
          <small>
            Enter the complete URL users use to reach Vynode. Reverse-proxy
            installations should use the public HTTPS address.
          </small>
        </label>
        <label>
          Language and locale
          <select
            value={draft.locale}
            onChange={(event) =>
              setDraft({ ...draft, locale: event.target.value })
            }
          >
            <option value="en-US">English (United States)</option>
            <option value="en-GB">English (United Kingdom)</option>
            <option value="de-DE">Deutsch</option>
            <option value="es-ES">Español</option>
            <option value="fr-FR">Français</option>
          </select>
          <small>
            Controls dates, numbers, and translated interface text where
            available.
          </small>
        </label>
      </section>
      <section className="main-panel settings-section">
        <div><h2>Global collection exclusions</h2><p>Prevent exact titles from appearing in any managed collection.</p></div>
        <label>Excluded titles<textarea rows={7} value={(draft.globalExcludedTitles ?? []).join('\n')} placeholder="One exact title per line" onChange={(event) => setDraft({ ...draft, globalExcludedTitles: [...new Set(event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))] })} /><small>Matching ignores capitalization and is enforced in previews, missing-media routing, and Plex synchronization.</small></label>
      </section>
      <section className="main-panel settings-section">
        <div>
          <h2>Images and cache</h2>
          <p>
            Control local artwork caching. Disabling it reduces disk use but
            increases provider requests and page load time.
          </p>
        </div>
        <label className="setting-check">
          <input
            type="checkbox"
            checked={draft.cacheImages}
            onChange={(event) =>
              setDraft({ ...draft, cacheImages: event.target.checked })
            }
          />
          <span>
            <strong>Cache poster and background images</strong>
            <small>
              Keep remote artwork locally for faster browsing and poster
              generation.
            </small>
          </span>
        </label>
        <label>
          Keep cached images for
          <input
            type="number"
            min={1}
            max={3650}
            disabled={!draft.cacheImages}
            value={draft.imageCacheDays}
            onChange={(event) =>
              setDraft({
                ...draft,
                imageCacheDays: Math.max(
                  1,
                  Math.min(3650, Number(event.target.value) || 1)
                ),
              })
            }
          />
          <small>
            Days before unused artwork is eligible for cleanup. Current cache:{' '}
            {settings.cacheItemCount} files ·{' '}
            {(settings.cacheSizeBytes / 1_048_576).toFixed(1)} MB.
          </small>
        </label>
        <button
          className="button secondary align-start"
          type="button"
          disabled={settings.cacheItemCount === 0}
          onClick={() => setConfirmation('cache')}
        >
          Clear image cache
        </button>
      </section>
      <section className="main-panel settings-section">
        <div>
          <h2>API access</h2>
          <p>
            The API key authorizes external automation. A newly generated key
            is shown once; afterward only its masked preview is retained.
          </p>
        </div>
        {settings.issuedApiKey && (
          <div className="key-row">
            <code>{settings.issuedApiKey}</code>
            <button className="button secondary" type="button" onClick={() => void navigator.clipboard.writeText(settings.issuedApiKey!)}>Copy new key</button>
          </div>
        )}
        <div className="key-row">
          <code>{settings.apiKeyPreview}</code>
          <button
            className="button secondary"
            type="button"
            onClick={() => setConfirmation('key')}
          >
            Regenerate API key
          </button>
        </div>
        <p className="field-help">
          Regenerating immediately invalidates the previous key. Update every
          external client before its next request.
        </p>
      </section>
      <div className="sticky-save">
        <span>Last saved {new Date(settings.updatedAt).toLocaleString()}</span>
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      {confirmation && (
        <div className="modal-backdrop">
          <section
            className="folder-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="maintenance-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Confirm maintenance</p>
                <h3 id="maintenance-title">
                  {confirmation === 'key'
                    ? 'Regenerate the API key?'
                    : 'Clear the image cache?'}
                </h3>
              </div>
              <button
                ref={confirmationClose}
                className="icon-button"
                type="button"
                aria-label="Cancel maintenance action"
                onClick={() => setConfirmation(undefined)}
              >
                ×
              </button>
            </div>
            <p>
              {confirmation === 'key'
                ? 'The current key will stop working immediately. Existing integrations and scripts must be updated with the replacement.'
                : `All ${settings.cacheItemCount} cached images (${(settings.cacheSizeBytes / 1_048_576).toFixed(1)} MB) will be removed. Artwork will be downloaded again as pages and jobs need it.`}
            </p>
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setConfirmation(undefined)}
              >
                Cancel
              </button>
              <button
                className="button danger"
                type="button"
                disabled={busy}
                onClick={() => void runMaintenance()}
              >
                {busy
                  ? 'Working…'
                  : confirmation === 'key'
                    ? 'Regenerate key'
                    : 'Clear cache'}
              </button>
            </div>
          </section>
        </div>
      )}
    </form>
  );
};

const PlexSettingsPage = () => {
  const [configuration, setConfiguration] =
    useState<Awaited<ReturnType<typeof api.plexConfiguration>>>();
  const [draft, setDraft] = useState<PlexConnectionInput>({
    host: '',
    port: 32400,
    transport: 'https-verify',
    webAppUrl: 'https://app.plex.tv/desktop',
    autoEmptyTrash: true,
  });
  const [candidates, setCandidates] =
    useState<Awaited<ReturnType<typeof api.plexCandidates>>>();
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [machineConfirmation, setMachineConfirmation] = useState(false);
  const confirmClose = useRef<HTMLButtonElement>(null);
  const load = async () => {
    setLoading(true);
    try {
      const next = await api.plexConfiguration();
      setConfiguration(next);
      if (next) {
        setDraft({
          host: next.host,
          port: next.port,
          transport: next.transport,
          ...(next.webAppUrl ? { webAppUrl: next.webAppUrl } : {}),
          autoEmptyTrash: next.autoEmptyTrash,
        });
      }
      setMessage('');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to load Plex settings.'
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!machineConfirmation) return;
    confirmClose.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMachineConfirmation(false);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [machineConfirmation]);
  const discover = async () => {
    setDiscovering(true);
    setMessage('Retrieving servers from the Plex owner account…');
    try {
      const next = await api.plexCandidates();
      setCandidates(next);
      setMessage(
        next.length
          ? 'Server list retrieved. Choose a reachable endpoint to prefill the form; it will not be saved until verified.'
          : 'No Plex servers were returned. Enter the endpoint manually.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to retrieve Plex servers. Enter the endpoint manually.'
      );
    } finally {
      setDiscovering(false);
    }
  };
  const save = async (confirmMachineChange = false) => {
    setSaving(true);
    setMessage('Verifying the Plex server and refreshing libraries…');
    try {
      const next = await api.savePlexConfiguration(
        configuration?.revision ?? 0,
        draft,
        confirmMachineChange
      );
      setConfiguration(next);
      setDraft({
        host: next.host,
        port: next.port,
        transport: next.transport,
        ...(next.webAppUrl ? { webAppUrl: next.webAppUrl } : {}),
        autoEmptyTrash: next.autoEmptyTrash,
      });
      setMachineConfirmation(false);
      setMessage(
        `Connected to ${next.name}. ${next.libraries.length} libraries verified.`
      );
    } catch (error) {
      const text =
        error instanceof Error
          ? error.message
          : 'Unable to verify Plex settings.';
      const requiresMachineConfirmation =
        /machine|server identity|different Plex/i.test(text);
      if (requiresMachineConfirmation) {
        setMachineConfirmation(true);
      } else {
        await load();
      }
      setMessage(text);
    } finally {
      setSaving(false);
    }
  };
  if (loading) {
    return (
      <section className="main-panel">
        <p className="source-feedback" role="status">
          Loading Plex settings…
        </p>
      </section>
    );
  }
  const insecure = draft.transport !== 'https-verify';
  return (
    <div className="settings-form plex-settings-page">
      <section className="main-panel settings-section plex-discovery-section">
        <div>
          <h2>Server discovery</h2>
          <p>
            Retrieve endpoints owned by the connected Plex account, or enter an
            address manually.
          </p>
        </div>
        <div className="discovery-actions">
          <button
            className="button secondary"
            type="button"
            disabled={discovering}
            onClick={() => void discover()}
          >
            {discovering ? 'Retrieving servers…' : 'Find Plex servers'}
          </button>
          <small>
            Discovery only prefills the connection form. Saving always performs
            a fresh verification.
          </small>
        </div>
        {candidates && (
          <div className="plex-candidate-list">
            {candidates.map((candidate) => (
              <article
                key={candidate.id}
                className={candidate.reachable ? '' : 'unreachable'}
              >
                <div>
                  <strong>{candidate.serverName}</strong>
                  <small>
                    {candidate.local ? 'Local' : 'Remote'} ·{' '}
                    {candidate.input.transport === 'http' ? 'HTTP' : 'Secure'}
                    {candidate.latencyMs !== undefined
                      ? ` · ${candidate.latencyMs} ms`
                      : ''}
                  </small>
                  <code>
                    {candidate.input.host}:{candidate.input.port}
                  </code>
                </div>
                <span className={candidate.reachable ? 'reachable' : ''}>
                  {candidate.reachable ? 'Reachable' : 'Unavailable'}
                </span>
                <button
                  className="button secondary"
                  type="button"
                  disabled={!candidate.reachable}
                  onClick={() => {
                    setDraft(candidate.input);
                    setMessage(
                      `${candidate.serverName} selected. Review the fields, then save and verify.`
                    );
                  }}
                >
                  Use this endpoint
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
      {message && (
        <p className="source-feedback" role="status">
          {message}
        </p>
      )}
      <section className="main-panel settings-section">
        <div>
          <h2>Plex connection</h2>
          <p>
            Vynode uses this endpoint for library discovery, collections, hubs,
            overlays, placeholders, and synchronization.
          </p>
        </div>
        <label>
          Hostname or IP address
          <input
            required
            value={draft.host}
            onChange={(event) =>
              setDraft({
                ...draft,
                host: event.target.value.replace(/^https?:\/\//i, ''),
              })
            }
            placeholder="plex.example.com"
          />
          <small>
            Enter only the host. Vynode adds the selected protocol and port.
          </small>
        </label>
        <label>
          Port
          <input
            required
            type="number"
            min={1}
            max={65535}
            value={draft.port}
            onChange={(event) =>
              setDraft({
                ...draft,
                port: Math.max(
                  1,
                  Math.min(65535, Number(event.target.value) || 32400)
                ),
              })
            }
          />
          <small>
            Plex normally uses port 32400. Use the port reachable from the
            Vynode server.
          </small>
        </label>
        <label>
          Connection security
          <select
            value={draft.transport}
            onChange={(event) =>
              setDraft({
                ...draft,
                transport: event.target
                  .value as PlexConnectionInput['transport'],
              })
            }
          >
            <option value="https-verify">HTTPS — verify certificate</option>
            <option value="https-allow-self-signed">
              HTTPS — allow self-signed certificate
            </option>
            <option value="http">HTTP — unencrypted</option>
          </select>
          <small>
            {insecure
              ? 'Use only on a trusted network. This weakens protection for Plex credentials and metadata in transit.'
              : 'Certificate verification protects the Plex connection from interception.'}
          </small>
        </label>
        <label>
          Plex Web App URL
          <input
            type="url"
            value={draft.webAppUrl ?? ''}
            placeholder="https://app.plex.tv/desktop"
            onChange={(event) =>
              setDraft({ ...draft, webAppUrl: event.target.value })
            }
          />
          <small>
            Optional. “Open in Plex” links use this address instead of the
            hosted Plex Web app.
          </small>
        </label>
        <label className="setting-check">
          <input
            type="checkbox"
            checked={draft.autoEmptyTrash}
            onChange={(event) =>
              setDraft({ ...draft, autoEmptyTrash: event.target.checked })
            }
          />
          <span>
            <strong>Automatically empty Plex library trash</strong>
            <small>
              After placeholder cleanup, remove ghost entries from Plex. Saving
              this option does not empty trash immediately.
            </small>
          </span>
        </label>
        <button
          className="button primary align-start"
          type="button"
          disabled={saving || !draft.host || !draft.port}
          onClick={() => void save()}
        >
          {saving ? 'Verifying…' : 'Save and verify'}
        </button>
      </section>
      <section className="main-panel plex-library-section">
        <div className="panel-heading">
          <div>
            <h2>Verified libraries</h2>
            <p>
              These libraries become targets for collections, placeholders,
              watchlists, downloads, and poster overlays.
            </p>
          </div>
          {configuration && (
            <small>
              Verified {new Date(configuration.verifiedAt).toLocaleString()}
            </small>
          )}
        </div>
        {!configuration && (
          <div className="empty-state">
            <strong>No verified Plex server</strong>
            <p>Save and verify the connection to discover libraries.</p>
          </div>
        )}
        {configuration && (
          <article
            className="verified-plex-identity"
            aria-label={`Verified Plex server ${configuration.name}`}
          >
            <span className="media-mark">P</span>
            <div>
              <small>Verified synchronization target</small>
              <strong>{configuration.name}</strong>
              <code>
                {configuration.host}:{configuration.port}
              </code>
              <small>
                Machine identifier: {configuration.machineIdentifier}
              </small>
            </div>
            <span className="verified-target-badge">Verified</span>
            <p>
              Collection, poster, overlay, placeholder, and maintenance actions
              affect this server. Verify the server name before starting a job.
            </p>
          </article>
        )}
        {configuration && configuration.libraries.length === 0 && (
          <div className="empty-state">
            <strong>No supported libraries found</strong>
            <p>Vynode requires at least one Plex movie or TV library.</p>
          </div>
        )}
        <div className="verified-library-list">
          {configuration?.libraries.map((library) => (
            <article key={library.key}>
              <span className="media-mark">
                {library.type === 'movie' ? 'M' : 'TV'}
              </span>
              <div>
                <strong>{library.title}</strong>
                <small>
                  Key {library.key} · {library.scanner} · {library.agent}
                </small>
                {library.locations.map((location) => (
                  <code key={location}>{location}</code>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      {machineConfirmation && (
        <div className="modal-backdrop">
          <section
            className="folder-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="plex-machine-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Confirm server change</p>
                <h3 id="plex-machine-title">
                  Connect a different Plex server?
                </h3>
              </div>
              <button
                ref={confirmClose}
                className="icon-button"
                aria-label="Cancel Plex server change"
                onClick={() => setMachineConfirmation(false)}
              >
                ×
              </button>
            </div>
            <p>
              The verified machine identity changed. Library keys, collection
              targets, placeholder roots, overlay policies, and download
              destinations may refer to the previous server. Confirm only after
              reviewing those dependent settings.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => setMachineConfirmation(false)}
              >
                Cancel
              </button>
              <button
                className="button danger"
                disabled={saving}
                onClick={() => void save(true)}
              >
                {saving ? 'Verifying…' : 'Connect different server'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const SourcesSettingsPage = () => (
  <div className="settings-form sources-settings-page">
    <section className="main-panel">
      <div className="placement-toolbar">
        <div>
          <h2>Collection and analytics sources</h2>
          <p>
            Connect optional providers, choose protected-page fetching behavior,
            and manage write-only credentials. Every changed connection is
            tested before it can replace the saved configuration.
          </p>
        </div>
      </div>
      <SourceStage busy={false} settingsMode onComplete={async () => {}} />
    </section>
  </div>
);

const DownloadsSettingsPage = () => (
  <div className="settings-form downloads-settings-page">
    <section className="main-panel">
      <div className="placement-toolbar">
        <div>
          <h2>Requests, downloads, and missing media</h2>
          <p>
            Configure request routing, download servers, placeholder files,
            watched-state recovery, trailers, and Plex watchlist
            synchronization. Dependent profiles, roots, and tags always come
            from the exact server connection that was tested.
          </p>
        </div>
      </div>
      <DownloadStage busy={false} settingsMode onComplete={async () => {}} />
    </section>
  </div>
);

const LogsSettingsPage = () => {
  const saved = useMemo(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem('vynode-log-display') ?? '{}'
      ) as {
        level?: ApplicationLogEntry['level'];
        pageSize?: number;
      };
    } catch {
      return {};
    }
  }, []);
  const savedLevel = ['debug', 'info', 'warn', 'error'].includes(
    saved.level ?? ''
  )
    ? saved.level
    : undefined;
  const savedPageSize = [10, 25, 50, 100].includes(saved.pageSize ?? 0)
    ? saved.pageSize
    : undefined;
  const [level, setLevel] = useState<ApplicationLogEntry['level']>(
    savedLevel ?? 'debug'
  );
  const [pageSize, setPageSize] = useState(savedPageSize ?? 25);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [live, setLive] = useState(true);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.logs>>>();
  const [message, setMessage] = useState('Loading logs…');
  const [loading, setLoading] = useState(true);
  const [activeLog, setActiveLog] = useState<ApplicationLogEntry>();
  const detailClose = useRef<HTMLButtonElement>(null);
  const requestSequence = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    window.localStorage.setItem(
      'vynode-log-display',
      JSON.stringify({ level, pageSize })
    );
  }, [level, pageSize]);
  const load = async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      const next = await api.logs(level, debouncedSearch, page, pageSize);
      if (requestId !== requestSequence.current) return;
      setData(next);
      if (next.page !== page) setPage(next.page);
      setMessage('');
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setMessage(
        error instanceof Error ? error.message : 'Unable to load logs.'
      );
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    if (!live) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [level, debouncedSearch, page, pageSize, live]);
  useEffect(() => {
    if (!activeLog) return;
    detailClose.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveLog(undefined);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [activeLog]);
  const copy = async (entry: ApplicationLogEntry) => {
    const text = `${entry.timestamp} [${entry.level.toUpperCase()}]${entry.label ? `[${entry.label}]` : ''}: ${entry.message}${entry.data ? ` ${JSON.stringify(entry.data)}` : ''}`;
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Log entry copied to the clipboard.');
    } catch {
      setMessage(
        'Clipboard access was unavailable. Copy the entry from the details panel.'
      );
    }
  };
  return (
    <section className="logs-page">
      <div className="placement-toolbar">
        <div>
          <h2>Application logs</h2>
          <p>
            Logs are also written to{' '}
            <code>
              {data?.appDataPath ?? 'the application data directory'}
              \logs\vynode.log
            </code>{' '}
            and standard output.
          </p>
        </div>
        <a className="button primary" href="/api/settings/logs/export" download>
          Export debugging info
        </a>
      </div>
      <div className="log-toolbar" aria-label="Log filters">
        <label>
          Search
          <input
            type="search"
            value={search}
            placeholder="Message, label, or detail"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Minimum severity
          <select
            value={level}
            onChange={(event) => {
              setLevel(event.target.value as ApplicationLogEntry['level']);
              setPage(1);
            }}
          >
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label>
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <button
          className={`button ${live ? 'secondary' : 'primary'}`}
          type="button"
          aria-pressed={!live}
          onClick={() => setLive((value) => !value)}
        >
          {live ? 'Pause live logs' : 'Resume live logs'}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
      <p className="field-help">
        Severity is inclusive: selecting Warning shows warning and error
        entries. Search waits briefly while you type and matches structured
        detail values.{' '}
        {live
          ? 'Live refresh runs every five seconds.'
          : 'Live refresh is paused.'}
      </p>
      {message && (
        <p className="source-feedback" role="status" aria-live="polite">
          {message}
        </p>
      )}
      <div className="log-table" role="table" aria-label="Application logs">
        <div className="log-head" role="row">
          <span role="columnheader">Timestamp</span>
          <span role="columnheader">Severity</span>
          <span role="columnheader">Label</span>
          <span role="columnheader">Message</span>
          <span role="columnheader">Actions</span>
        </div>
        {data?.results.map((entry) => (
          <article key={entry.id} role="row">
            <time dateTime={entry.timestamp} role="cell">
              {new Date(entry.timestamp).toLocaleString()}
            </time>
            <span className={`log-level ${entry.level}`} role="cell">
              {entry.level}
            </span>
            <span role="cell">{entry.label ?? '—'}</span>
            <p role="cell">{entry.message}</p>
            <span className="row-actions" role="cell">
              <button
                type="button"
                aria-label={`View details for ${entry.message}`}
                onClick={() => setActiveLog(entry)}
              >
                Details
              </button>
              <button
                type="button"
                aria-label={`Copy ${entry.message}`}
                onClick={() => void copy(entry)}
              >
                Copy
              </button>
            </span>
          </article>
        ))}
      </div>
      {!message && data?.results.length === 0 && (
        <div className="main-panel empty-state">
          <strong>No matching log entries</strong>
          <p>Change the severity or clear the search filter.</p>
        </div>
      )}
      {data && (
        <div className="log-pagination">
          <span>
            Showing {data.results.length} of {data.total} entries · Page{' '}
            {data.page} of {data.pages}
          </span>
          <button
            className="button secondary"
            type="button"
            disabled={data.page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={data.page >= data.pages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      )}
      {activeLog && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActiveLog(undefined);
          }}
        >
          <section
            className="folder-modal log-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="log-detail-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Log details</p>
                <h3 id="log-detail-title">
                  {activeLog.label ?? 'Application'} ·{' '}
                  {activeLog.level.toUpperCase()}
                </h3>
              </div>
              <button
                ref={detailClose}
                className="icon-button"
                type="button"
                aria-label="Close log details"
                onClick={() => setActiveLog(undefined)}
              >
                ×
              </button>
            </div>
            <dl>
              <div>
                <dt>Timestamp</dt>
                <dd>{new Date(activeLog.timestamp).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Severity</dt>
                <dd>
                  <span className={`log-level ${activeLog.level}`}>
                    {activeLog.level}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Label</dt>
                <dd>{activeLog.label ?? 'None'}</dd>
              </div>
              <div>
                <dt>Message</dt>
                <dd>{activeLog.message}</dd>
              </div>
            </dl>
            {activeLog.data && (
              <div>
                <strong>Additional data</strong>
                <pre>{JSON.stringify(activeLog.data, null, 2)}</pre>
              </div>
            )}
            <p className="field-help">
              Credentials and registered secret values are redacted before logs
              reach this interface or the diagnostic export.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setActiveLog(undefined)}
              >
                Close
              </button>
              <button
                className="button primary"
                type="button"
                onClick={() => void copy(activeLog)}
              >
                Copy entry
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};

const isValidCronDraft = (expression: string): boolean => {
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
      return (
        (start === undefined || (start >= minimum && start <= maximum)) &&
        (end === undefined ||
          (end >= minimum && end <= maximum && end >= (start ?? minimum))) &&
        (step === undefined || (step >= 1 && step <= maximum))
      );
    });
  });
};

const JobsSettingsPage = () => {
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof api.jobs>>>([]);
  const [caches, setCaches] = useState<Awaited<ReturnType<typeof api.caches>>>(
    []
  );
  const [message, setMessage] = useState('Loading jobs and caches…');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');
  const [busyId, setBusyId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [customSchedule, setCustomSchedule] = useState(false);
  const [preset, setPreset] = useState('0 0 */6 * * *');
  const [cron, setCron] = useState('');
  const [flushId, setFlushId] = useState('');
  const modalClose = useRef<HTMLButtonElement>(null);
  const requestSequence = useRef(0);
  const load = async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      const [nextJobs, nextCaches] = await Promise.all([
        api.jobs(),
        api.caches(),
      ]);
      if (requestId !== requestSequence.current) return;
      setJobs(nextJobs);
      setCaches(nextCaches);
      setUpdatedAt(new Date().toISOString());
      setMessage('');
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load jobs and caches.'
      );
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!scheduleId && !flushId) return;
    modalClose.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setScheduleId('');
        setFlushId('');
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [scheduleId, flushId]);
  const toggleJob = async (id: string, running: boolean) => {
    requestSequence.current += 1;
    setBusyId(id);
    try {
      const updated = await (running ? api.cancelJob(id) : api.runJob(id));
      setJobs((current) =>
        current.map((job) => (job.id === updated.id ? updated : job))
      );
      await load();
      setMessage(
        running
          ? 'Safe cancellation requested.'
          : 'Job started. Progress appears here and on the Dashboard when applicable.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to update job.'
      );
    } finally {
      setBusyId('');
    }
  };
  const openSchedule = (id: string) => {
    const job = jobs.find((item) => item.id === id);
    if (!job) return;
    setScheduleId(id);
    setCron(job.cronSchedule);
    setPreset(job.cronSchedule);
    setCustomSchedule(
      ![
        '0 */10 * * * *',
        '0 */30 * * * *',
        '0 0 */6 * * *',
        '0 0 */12 * * *',
        '0 0 0 * * *',
      ].includes(job.cronSchedule)
    );
  };
  const saveSchedule = async () => {
    const expression = customSchedule ? cron.trim() : preset;
    requestSequence.current += 1;
    setBusyId(scheduleId);
    try {
      const updated = await api.scheduleJob(scheduleId, expression);
      setJobs((current) =>
        current.map((job) => (job.id === updated.id ? updated : job))
      );
      setScheduleId('');
      await load();
      setMessage(
        'Job schedule saved. The next execution time was recalculated.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to save schedule.'
      );
    } finally {
      setBusyId('');
    }
  };
  const flush = async () => {
    requestSequence.current += 1;
    setBusyId(flushId);
    try {
      const updated = await api.flushCache(flushId);
      setCaches((current) =>
        current.map((cache) => (cache.id === updated.id ? updated : cache))
      );
      setFlushId('');
      await load();
      setMessage(
        'Cache flushed. The next dependent request will rebuild missing entries.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to flush cache.'
      );
    } finally {
      setBusyId('');
    }
  };
  const scheduleJob = jobs.find((item) => item.id === scheduleId);
  const flushCache = caches.find((item) => item.id === flushId);
  const cronIsValid = !customSchedule || isValidCronDraft(cron);
  return (
    <section className="jobs-page">
      <div className="jobs-toolbar">
        <p className="field-help">
          Automatically refreshed every five seconds.
          {updatedAt
            ? ` Last updated ${new Date(updatedAt).toLocaleTimeString()}.`
            : ''}
        </p>
        <button
          className="button secondary"
          type="button"
          disabled={loading || !!busyId}
          onClick={() => void load()}
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
      {message && (
        <p className="source-feedback" role="status" aria-live="polite">
          {message}
        </p>
      )}
      <section className="main-panel jobs-section">
        <div>
          <h2>Scheduled jobs</h2>
          <p>
            Vynode runs synchronization and maintenance automatically. Manual
            runs use the same locks, cancellation signals, and dependency checks
            as scheduled executions.
          </p>
        </div>
        <div className="jobs-table" role="table" aria-label="Scheduled jobs">
          <div className="jobs-head" role="row">
            <span role="columnheader">Job</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Schedule</span>
            <span role="columnheader">Next execution</span>
            <span role="columnheader">Actions</span>
          </div>
          {jobs.map((job) => (
            <article key={job.id} role="row">
              <div role="cell">
                <strong>{job.name}</strong>
                <small>
                  {job.running
                    ? `Running since ${new Date(job.startedAt ?? '').toLocaleString()}`
                    : job.lastCompletedAt
                      ? `${job.lastOutcome ?? 'success'} · ${new Date(job.lastCompletedAt).toLocaleString()}`
                      : job.id}
                </small>
                {!job.running && job.lastMessage && (
                  <small>{job.lastMessage}</small>
                )}
              </div>
              <span className="job-type" role="cell">
                {job.type}
                <small>{job.interval}</small>
              </span>
              <code role="cell">{job.cronSchedule}</code>
              <span className="job-next" role="cell">
                <time dateTime={job.nextExecutionTime}>
                  {new Date(job.nextExecutionTime).toLocaleString()}
                </time>
                {job.followingExecutionTime && (
                  <small>
                    Following:{' '}
                    {new Date(job.followingExecutionTime).toLocaleString()}
                  </small>
                )}
              </span>
              <span className="row-actions" role="cell">
                <button
                  type="button"
                  aria-label={`${job.running ? 'Cancel' : 'Run'} ${job.name}`}
                  disabled={!!busyId}
                  onClick={() => void toggleJob(job.id, job.running)}
                >
                  {job.running ? 'Cancel' : 'Run now'}
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${job.name} schedule`}
                  disabled={job.running || !!busyId}
                  onClick={() => openSchedule(job.id)}
                >
                  Schedule
                </button>
              </span>
            </article>
          ))}
        </div>
      </section>
      <section className="main-panel jobs-section">
        <div>
          <h2>API caches</h2>
          <p>
            Cached provider responses reduce page time and external API use.
            Flushing does not remove collections or settings, but the next
            requests may be slower and consume provider quotas.
          </p>
        </div>
        <div className="cache-grid">
          {caches.map((cache) => (
            <article key={cache.id}>
              <div>
                <strong>{cache.name}</strong>
                <small>
                  {cache.keys} keys ·{' '}
                  {((cache.keySizeBytes + cache.valueSizeBytes) / 1024).toFixed(
                    1
                  )}{' '}
                  KB
                </small>
              </div>
              <dl>
                <div>
                  <dt>Hits</dt>
                  <dd>{cache.hits}</dd>
                </div>
                <div>
                  <dt>Misses</dt>
                  <dd>{cache.misses}</dd>
                </div>
              </dl>
              <button
                className="button secondary"
                type="button"
                disabled={cache.keys === 0 || !!busyId}
                onClick={() => setFlushId(cache.id)}
              >
                Flush cache
              </button>
            </article>
          ))}
        </div>
      </section>
      {scheduleJob && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setScheduleId('');
          }}
        >
          <section
            className="folder-modal schedule-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Job schedule</p>
                <h3 id="schedule-title">{scheduleJob.name}</h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                type="button"
                aria-label="Close schedule editor"
                onClick={() => setScheduleId('')}
              >
                ×
              </button>
            </div>
            <p className="field-help">
              Current schedule: <code>{scheduleJob.cronSchedule}</code>.
              Schedules use six parts: second, minute, hour, day, month,
              weekday.
            </p>
            <div className="toggle-grid">
              <label>
                <input
                  type="radio"
                  name="schedule-mode"
                  checked={!customSchedule}
                  onChange={() => setCustomSchedule(false)}
                />{' '}
                Preset interval
              </label>
              <label>
                <input
                  type="radio"
                  name="schedule-mode"
                  checked={customSchedule}
                  onChange={() => setCustomSchedule(true)}
                />{' '}
                Custom CRON
              </label>
            </div>
            {customSchedule ? (
              <label>
                CRON expression
                <input
                  value={cron}
                  placeholder="0 */15 * * * *"
                  onChange={(event) => setCron(event.target.value)}
                />
                <small>
                  Example: <code>0 */15 * * * *</code> runs every 15 minutes.
                </small>
                {!cronIsValid && (
                  <small className="field-error" role="alert">
                    Enter six valid numeric CRON fields. Seconds and minutes
                    are 0–59, hours 0–23, days 1–31, months 1–12, and weekdays
                    0–7.
                  </small>
                )}
              </label>
            ) : (
              <label>
                Interval
                <select
                  value={preset}
                  onChange={(event) => setPreset(event.target.value)}
                >
                  <option value="0 */10 * * * *">Every 10 minutes</option>
                  <option value="0 */30 * * * *">Every 30 minutes</option>
                  <option value="0 0 */6 * * *">Every 6 hours</option>
                  <option value="0 0 */12 * * *">Every 12 hours</option>
                  <option value="0 0 0 * * *">Daily at midnight</option>
                </select>
              </label>
            )}
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setScheduleId('')}
              >
                Cancel
              </button>
              <button
                className="button primary"
                type="button"
                disabled={!!busyId || !cronIsValid}
                onClick={() => void saveSchedule()}
              >
                {busyId ? 'Saving…' : 'Save schedule'}
              </button>
            </div>
          </section>
        </div>
      )}
      {flushCache && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFlushId('');
          }}
        >
          <section
            className="folder-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="flush-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Confirm cache flush</p>
                <h3 id="flush-title">Flush {flushCache.name}?</h3>
              </div>
              <button
                ref={modalClose}
                className="icon-button"
                type="button"
                aria-label="Cancel cache flush"
                onClick={() => setFlushId('')}
              >
                ×
              </button>
            </div>
            <p>
              {flushCache.keys} cached entries using{' '}
              {(
                (flushCache.keySizeBytes + flushCache.valueSizeBytes) /
                1024
              ).toFixed(1)}{' '}
              KB will be removed. Collections and settings remain intact;
              provider requests will rebuild entries as needed.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setFlushId('')}
              >
                Cancel
              </button>
              <button
                className="button danger"
                type="button"
                disabled={!!busyId}
                onClick={() => void flush()}
              >
                {busyId ? 'Flushing…' : 'Flush cache'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};

const safeExternalResourceUrl = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const AboutSettingsPage = () => {
  const [about, setAbout] = useState<Awaited<ReturnType<typeof api.about>>>();
  const [message, setMessage] = useState('Loading build information…');
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      setAbout(await api.about());
      setMessage('');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load build information.'
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  if (!about) {
    return (
      <section className="main-panel">
        {message && (
          <p className="source-feedback" role="status" aria-live="polite">
            {message}
          </p>
        )}
      </section>
    );
  }
  const uptimeHours = Math.floor(about.uptimeSeconds / 3600);
  const uptimeMinutes = Math.floor((about.uptimeSeconds % 3600) / 60);
  const documentationUrl = safeExternalResourceUrl(about.documentationUrl);
  const issueUrl = safeExternalResourceUrl(about.issueUrl);
  const sourceUrl = safeExternalResourceUrl(about.sourceUrl);
  return (
    <section className="about-page">
      {message && (
        <p className="source-feedback" role="status" aria-live="polite">
          {message}
        </p>
      )}
      <section className="about-hero">
        <span className="brand-mark">V</span>
        <div>
          <p className="eyebrow">Media automation control plane</p>
          <h2>Vynode</h2>
          <p>
            An independent application for Plex collections, hubs, requests,
            downloads, placeholders, posters, and overlays.
          </p>
        </div>
        <span
          className={`update-state ${
            about.updateAvailable
              ? 'available'
              : about.updateCheckAvailable === false
                ? 'unavailable'
                : ''
          }`}
        >
          {about.updateAvailable
            ? `Update available · ${about.latestVersion}`
            : about.updateCheckAvailable === false
              ? 'Update check unavailable'
              : 'Up to date'}
        </span>
      </section>
      {about.restartRequired && (
        <div className="warning-panel">
          <strong>Restart required</strong>
          <p>
            An installed update or configuration change will not be active until
            Vynode restarts.
          </p>
        </div>
      )}
      <div className="about-grid">
        <section className="main-panel">
          <h3>Build</h3>
          <dl>
            <div>
              <dt>Version</dt>
              <dd>{about.version}</dd>
            </div>
            <div>
              <dt>Build</dt>
              <dd>{about.build}</dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd>
                <code>{about.commit}</code>
              </dd>
            </div>
            <div>
              <dt>License</dt>
              <dd>{about.license}</dd>
            </div>
          </dl>
        </section>
        <section className="main-panel">
          <h3>Runtime</h3>
          <dl>
            <div>
              <dt>Node.js</dt>
              <dd>{about.nodeVersion}</dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd>
                {about.platform} · {about.architecture}
              </dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{about.timezone}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>
                {uptimeHours}h {uptimeMinutes}m
              </dd>
            </div>
          </dl>
        </section>
        <section className="main-panel">
          <h3>Installation</h3>
          <dl>
            <div>
              <dt>Application data</dt>
              <dd>
                <code>{about.appDataPath}</code>
              </dd>
            </div>
            <div>
              <dt>Latest known version</dt>
              <dd>
                {about.updateCheckAvailable === false
                  ? 'Not checked'
                  : about.latestVersion}
              </dd>
            </div>
          </dl>
          <button
            className="button secondary align-start"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? 'Checking status…' : 'Check status again'}
          </button>
        </section>
        <section className="main-panel">
          <h3>Project resources</h3>
          <p className="field-help">
            Resource links are configured by the Vynode distribution. No link to
            the reference application is implied.
          </p>
          <div className="resource-links">
            {documentationUrl ? (
              <a
                className="button secondary"
                href={documentationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Documentation
              </a>
            ) : (
              <button className="button secondary" type="button" disabled>
                Documentation unavailable
              </button>
            )}
            {issueUrl ? (
              <a
                className="button secondary"
                href={issueUrl}
                target="_blank"
                rel="noreferrer"
              >
                Report an issue
              </a>
            ) : (
              <button className="button secondary" type="button" disabled>
                Issue tracker unavailable
              </button>
            )}
            {sourceUrl ? (
              <a
                className="button secondary"
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source code
              </a>
            ) : (
              <button className="button secondary" type="button" disabled>
                Source link unavailable
              </button>
            )}
          </div>
        </section>
      </div>
    </section>
  );
};

export const MainApp = ({
  principal,
  onSignOut,
}: {
  principal: AuthenticatedPrincipal;
  onSignOut(): Promise<void>;
}) => {
  const [path, setPath] = useState(() =>
    normalizePath(window.location.pathname)
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const ownerMenu = useRef<HTMLDivElement>(null);
  const ownerMenuButton = useRef<HTMLButtonElement>(null);
  const drawerButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const roleLabel =
    principal.role === 'administrator'
      ? 'Administrator'
      : principal.role === 'operator'
        ? 'Operator'
        : principal.role === 'viewer'
          ? 'Viewer'
          : 'Owner';
  const avatarLabel = roleLabel.slice(0, 1);
  const canOperate = roleRank[principal.role] >= roleRank.operator;
  const canAdminister =
    roleRank[principal.role] >= roleRank.administrator;
  const canAccessCurrentPath =
    roleRank[principal.role] >= roleRank[minimumRoleForPath(path)];
  useEffect(() => {
    const update = () => {
      setPath(normalizePath(window.location.pathname));
      setDrawerOpen(false);
    };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  useEffect(() => {
    const title = pageCopy[path]?.title ?? 'Page not found';
    document.title = `${title} · Vynode`;
  }, [path]);
  useEffect(() => {
    if (!ownerMenuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (
        event instanceof MouseEvent &&
        ownerMenu.current?.contains(event.target as Node)
      )
        return;
      setOwnerMenuOpen(false);
      if (event instanceof KeyboardEvent) ownerMenuButton.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [ownerMenuOpen]);
  useEffect(() => {
    if (!drawerOpen) return;
    drawer.current?.querySelector<HTMLElement>('a')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawerOpen(false);
      drawerButton.current?.focus();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [drawerOpen]);
  const copy = pageCopy[path] ?? {
    title: 'Page not found',
    description: 'The requested Vynode page does not exist or has moved.',
  };
  const tabSet = useMemo(
    () =>
      path.startsWith('/settings')
        ? settingsTabs
        : path.startsWith('/posters')
          ? posterTabs
          : undefined,
    [path]
  );
  return (
    <main className="main-shell">
      <button
        ref={drawerButton}
        className="mobile-menu button secondary"
        type="button"
        aria-label={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={drawerOpen}
        aria-controls="main-navigation"
        onClick={() => setDrawerOpen(!drawerOpen)}
      >
        Menu
      </button>
      <aside
        ref={drawer}
        className={`main-sidebar ${drawerOpen ? 'open' : ''}`}
        id="main-navigation"
      >
        <AppLink path="/" className="brand">
          <span className="brand-mark">V</span>
          <span>Vynode</span>
        </AppLink>
        <nav aria-label="Main navigation">
          {primaryRoutes
            .filter(
              (route) =>
                roleRank[principal.role] >=
                roleRank[minimumRoleForPath(route.path)]
            )
            .map((route) => {
            const active =
              route.path === '/'
                ? path === '/'
                : path.startsWith(route.path.split('/').slice(0, 2).join('/'));
            return (
              <AppLink
                key={route.path}
                path={route.path}
                className={`main-nav-link ${active ? 'active' : ''}`}
              >
                <span aria-hidden="true">{route.mark}</span>
                {route.label}
              </AppLink>
            );
            })}
        </nav>
        <div className="sidebar-version">
          <small>Serious test build</small>
          <span>Vynode 0.1.0-rc.11</span>
        </div>
      </aside>
      <section className="main-content">
        <header className="main-header">
          <div>
            <p className="eyebrow">Vynode</p>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <div className="owner-menu-wrap" ref={ownerMenu}>
            <button
              ref={ownerMenuButton}
              className="owner-menu"
              type="button"
              aria-label={`${ownerMenuOpen ? 'Close' : 'Open'} ${roleLabel.toLowerCase()} account menu`}
              aria-haspopup="menu"
              aria-expanded={ownerMenuOpen}
              onClick={() => setOwnerMenuOpen((open) => !open)}
            >
              <span>{avatarLabel}</span>
              <strong>{roleLabel}</strong>
              <small aria-hidden="true">{ownerMenuOpen ? '▲' : '▼'}</small>
            </button>
            {ownerMenuOpen && (
              <div className="owner-popover" role="menu">
                <div>
                  <span>{avatarLabel}</span>
                  <p>
                    <strong>{roleLabel} account</strong>
                    <small>{principal.userId}</small>
                  </p>
                </div>
                {canAdminister && (
                  <>
                    <AppLink path="/settings/plex" className="owner-menu-item" role="menuitem">
                      Plex account and server
                    </AppLink>
                    <AppLink path="/settings/main" className="owner-menu-item" role="menuitem">
                      Application settings
                    </AppLink>
                  </>
                )}
                <AppLink path="/settings/about" className="owner-menu-item" role="menuitem">
                  About Vynode
                </AppLink>
                <button
                  className="owner-menu-item sign-out"
                  role="menuitem"
                  type="button"
                  disabled={signingOut}
                  onClick={() => {
                    setSigningOut(true);
                    setSignOutError('');
                    void onSignOut()
                      .catch((error: unknown) =>
                        setSignOutError(
                          error instanceof Error
                            ? error.message
                            : 'Sign out could not be completed.'
                        )
                      )
                      .finally(() => setSigningOut(false));
                  }}
                >
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
                {signOutError && (
                  <p className="owner-menu-error" role="alert">
                    {signOutError}
                  </p>
                )}
              </div>
            )}
          </div>
        </header>
        {tabSet && canAccessCurrentPath && (
          <nav
            className="page-tabs"
            aria-label={
              path.startsWith('/settings')
                ? 'Settings sections'
                : 'Poster sections'
            }
          >
            {tabSet.map(([tabPath, label]) => (
              <AppLink
                key={tabPath}
                path={tabPath}
                className={path === tabPath ? 'active' : ''}
              >
                {label}
              </AppLink>
            ))}
          </nav>
        )}
        {!canAccessCurrentPath ? (
          <section className="main-panel permission-denied" role="alert">
            <p className="eyebrow">Permission required</p>
            <h2>This account cannot open this page</h2>
            <p>
              {minimumRoleForPath(path) === 'administrator'
                ? 'Administrator access is required for application configuration.'
                : 'Operator access is required for collection editing and poster operations.'}
            </p>
            <AppLink path="/dashboard" className="button primary">
              Return to dashboard
            </AppLink>
          </section>
        ) : path === '/dashboard' ? (
          <DashboardOverview canOperate={canOperate} />
        ) : path === '/' ? (
          <CollectionPlacementPage surface="home" canManage={canOperate} />
        ) : path === '/recommended' ? (
          <CollectionPlacementPage surface="recommended" canManage={canOperate} />
        ) : path === '/library' ? (
          <CollectionPlacementPage surface="library" canManage={canOperate} />
        ) : path === '/allcollections' ? (
          <AllCollectionsPage />
        ) : path === '/posters/overlays' ? (
          <Suspense fallback={<PageLoading />}>
            <PosterOverlaysPage />
          </Suspense>
        ) : path === '/posters/collections' ? (
          <Suspense fallback={<PageLoading />}>
            <CollectionPostersPage />
          </Suspense>
        ) : path === '/settings/main' ? (
          <GeneralSettingsPage />
        ) : path === '/settings/plex' ? (
          <PlexSettingsPage />
        ) : path === '/settings/sources' ? (
          <SourcesSettingsPage />
        ) : path === '/settings/downloads' ? (
          <DownloadsSettingsPage />
        ) : path === '/settings/logs' ? (
          <LogsSettingsPage />
        ) : path === '/settings/jobs' ? (
          <JobsSettingsPage />
        ) : path === '/settings/about' ? (
          <AboutSettingsPage />
        ) : path === '/404' ? (
          <section className="main-panel not-found">
            <h2>Page not found</h2>
            <p>Check the address or return to the dashboard.</p>
            <AppLink path="/dashboard" className="button primary">
              Return to dashboard
            </AppLink>
          </section>
        ) : (
          <section className="main-panel">
            <div className="audit-banner">
              <strong>Parity implementation in progress</strong>
              <p>
                This route is registered and visually available. Its original
                controls and backend actions are being ported against the page
                registry before it is marked complete.
              </p>
            </div>
            <p className="empty-state">No records are available yet.</p>
          </section>
        )}
      </section>
      {drawerOpen && (
        <button
          className="drawer-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}
    </main>
  );
};
