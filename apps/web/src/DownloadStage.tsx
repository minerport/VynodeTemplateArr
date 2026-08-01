import type {
  ArrConfigurationView,
  ArrEndpointDraft,
  ArrKind,
  ArrProbeResult,
  AutomaticTagMode,
  RadarrAvailability,
  SonarrMonitorType,
  SonarrSeriesType,
  SeerrDestination,
  SeerrProbeResult,
  ServiceUserCreationMode,
  WatchlistDestination,
  WatchlistDestinationOptions,
} from '@vynode/downloads';
import type { PlexLibrary } from '@vynode/media-servers';
import { useEffect, useRef, useState } from 'react';

import { api } from './api';

const ServiceBadge = ({ letter }: { letter: string }) => (
  <span className="source-mark" aria-hidden="true">{letter}</span>
);

const serviceUrl = (endpoint: {
  hostname: string;
  port: number;
  useSsl: boolean;
  urlBase: string;
  externalUrl?: string;
}) =>
  endpoint.externalUrl ??
  `${endpoint.useSsl ? 'https' : 'http'}://${endpoint.hostname}:${endpoint.port}${endpoint.urlBase}`;

const ConfirmationDialog = ({
  title,
  description,
  consequences,
  confirmLabel,
  busy,
  message,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  consequences: readonly string[];
  confirmLabel: string;
  busy: boolean;
  message?: string;
  onConfirm(): void;
  onCancel(): void;
}) => {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);
  return (
  <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onCancel();
  }}>
    <section className="folder-modal confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
      <div className="modal-heading">
        <h3 id="confirmation-title">{title}</h3>
        <button className="icon-button" type="button" aria-label="Close confirmation" onClick={onCancel}>×</button>
      </div>
      <p id="confirmation-description">{description}</p>
      <strong>What will happen</strong>
      <ul className="consequence-list">
        {consequences.map((consequence) => <li key={consequence}>{consequence}</li>)}
      </ul>
      <p className="field-help">This only removes the connection and its stored credential from Vynode. It does not delete media or request history from the external service.</p>
      {message && <p className="error-banner" role="alert">{message}</p>}
      <div className="actions">
        <button ref={cancelButton} className="button secondary" type="button" disabled={busy} onClick={onCancel}>Keep connection</button>
        <button className="button danger" type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Removing…' : confirmLabel}</button>
      </div>
    </section>
  </div>
  );
};

const FolderPicker = ({
  initialPath,
  onSelect,
  onCancel,
}: {
  initialPath?: string;
  onSelect(path: string): void;
  onCancel(): void;
}) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [listing, setListing] = useState<Awaited<ReturnType<typeof api.directories>>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async (path?: string) => {
    setLoading(true);
    setError('');
    try {
      setListing(await api.directories(path));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load directories.'
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(initialPath);
  }, [initialPath]);
  useEffect(() => {
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="folder-modal" role="dialog" aria-modal="true" aria-labelledby="folder-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Server folder browser</p>
            <h3 id="folder-title">Select placeholder folder</h3>
          </div>
          <button ref={closeButton} className="icon-button" type="button" aria-label="Close folder browser" onClick={onCancel}>×</button>
        </div>
        <div className="current-path">
          <small>Current path</small>
          <code>{listing?.currentPath ?? initialPath ?? 'Loading…'}</code>
        </div>
        <div className="folder-navigation">
          <button className="button secondary" type="button" disabled={loading || !listing?.parentPath} onClick={() => void load(listing?.parentPath)}>
            Parent directory
          </button>
          <button className="button secondary" type="button" disabled={loading || !listing || listing.currentPath === listing.mountRoot} onClick={() => void load(listing?.mountRoot)}>
            Go to mounted root
          </button>
        </div>
        <div className="directory-list" aria-live="polite">
          {loading && <p>Loading directories…</p>}
          {!loading && error && <p className="folder-error" role="alert">{error}</p>}
          {!loading && !error && listing?.directories.length === 0 && <p>No subdirectories found.</p>}
          {!loading && !error && listing?.directories.map((directory) => (
            <button key={directory.path} type="button" onClick={() => void load(directory.path)}>
              <span aria-hidden="true">▰</span>
              <span>{directory.name}</span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
        <p className="selected-path">Selected: <code>{listing?.currentPath ?? initialPath}</code></p>
        <div className="actions">
          <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
          <button className="button primary" type="button" disabled={!listing || loading} onClick={() => listing && onSelect(listing.currentPath)}>Select folder</button>
        </div>
      </section>
    </div>
  );
};

const PlaceholderSection = () => {
  const [libraries, setLibraries] = useState<readonly PlexLibrary[]>([]);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof api.placeholders>>>();
  const [cookie, setCookie] = useState<Awaited<ReturnType<typeof api.youtubeCookieStatus>>>();
  const [webhook, setWebhook] = useState<Awaited<ReturnType<typeof api.plexWebhookStatus>>>();
  const [inventory, setInventory] = useState<Awaited<ReturnType<typeof api.placeholderInventory>>>();
  const [roots, setRoots] = useState<Record<string, string>>({});
  const [browsing, setBrowsing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [plex, placeholderValues, cookieStatus, webhookStatus, inventoryValues] = await Promise.all([
      api.plexConfiguration(),
      api.placeholders(),
      api.youtubeCookieStatus(),
      api.plexWebhookStatus(),
      api.placeholderInventory(),
    ]);
    setLibraries(
      (plex?.libraries ?? []).filter(
        (library) =>
          library.available &&
          (library.type === 'movie' || library.type === 'show')
      )
    );
    setSettings(placeholderValues);
    setRoots({ ...placeholderValues.libraryRoots });
    setCookie(cookieStatus);
    setWebhook(webhookStatus);
    setInventory(inventoryValues);
  };
  useEffect(() => {
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : 'Unable to load placeholder settings.')
    );
  }, []);

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setMessage('');
    try {
      const saved = await api.savePlaceholders(
        settings.revision,
        roots,
        settings.skipYoutubeTrailerDownloads
      );
      setSettings(saved);
      setMessage('Placeholder settings saved.');
      setCookie(await api.youtubeCookieStatus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save placeholder settings.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workflow-section" id="placeholders">
      <div className="workflow-heading">
        <div>
          <h3>Placeholder libraries and trailers</h3>
          <p>Choose a mounted server folder for every Plex movie and show library.</p>
        </div>
      </div>
      {libraries.length === 0 ? (
        <p className="empty-state">Verify a Plex server with movie or show libraries to configure placeholder folders.</p>
      ) : (
        <div className="library-root-list">
          {libraries.map((library) => (
            <div className="library-root-row" key={library.key}>
              <div>
                <label htmlFor={`placeholder-${library.key}`}>{library.title}</label>
                <small>{library.type === 'movie' ? 'Movie library' : 'TV library'} · Path inside the Vynode container where placeholder files will be created.</small>
              </div>
              <div className="browse-input">
                <input
                  id={`placeholder-${library.key}`}
                  value={roots[library.key] ?? ''}
                  onChange={(event) =>
                    setRoots({ ...roots, [library.key]: event.target.value })
                  }
                  placeholder={library.type === 'movie' ? 'C:\\media\\Movies' : 'C:\\media\\TV Shows'}
                />
                <button className="button secondary" type="button" onClick={() => setBrowsing(library.key)}>Browse</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {browsing && (
        <FolderPicker
          initialPath={roots[browsing] || undefined}
          onCancel={() => setBrowsing(undefined)}
          onSelect={(path) => {
            setRoots({ ...roots, [browsing]: path });
            setBrowsing(undefined);
          }}
        />
      )}
      <div className={`cookie-status ${cookie?.state ?? 'missing'}`}>
        <strong>
          {!cookie
            ? 'Checking YouTube cookie status…'
            : cookie.state === 'ready'
            ? 'YouTube cookies are ready'
            : cookie.state === 'present-but-disabled'
              ? 'YouTube cookies are present but trailer downloads are disabled'
              : 'YouTube cookies were not found'}
        </strong>
        <p>
          {!cookie
            ? 'The server is checking the configured cookie mount.'
            : cookie.state === 'missing'
            ? `Export signed-in YouTube cookies and mount them as ${cookie?.fileName ?? 'youtube-cookies.txt'} in the Vynode configuration directory.`
            : `${cookie.fileName} is mounted. Its contents are never displayed or logged.`}
        </p>
      </div>
      <label className="check-row compact">
        <input
          type="checkbox"
          checked={settings?.skipYoutubeTrailerDownloads ?? false}
          onChange={(event) =>
            settings &&
            setSettings({
              ...settings,
              skipYoutubeTrailerDownloads: event.target.checked,
            })
          }
        />
        <span>
          <strong>Skip YouTube trailer downloads</strong>
          <small>Use the bundled generic placeholder video. This is faster but placeholders will not contain each title’s trailer.</small>
        </span>
      </label>
      <div className="webhook-panel" aria-live="polite">
        <strong>Placeholder lifecycle inventory</strong>
        <p>Vynode tracks generated files until Plex indexes them, real media replaces them, or the configured retention period expires.</p>
        <div className="placeholder-inventory-summary">
          <div><strong>{inventory?.records.length ?? 0}</strong><span>Tracked</span></div>
          <div><strong>{inventory?.records.filter((record) => record.state === 'indexed').length ?? 0}</strong><span>Indexed in Plex</span></div>
          <div><strong>{inventory?.records.filter((record) => record.state === 'cleanup-pending').length ?? 0}</strong><span>Cleanup pending</span></div>
          <div><strong>{inventory?.records.filter((record) => record.state === 'error').length ?? 0}</strong><span>Needs attention</span></div>
        </div>
        {inventory?.records.length ? <div className="library-root-list">{inventory.records.map((record) => <div className="library-root-row" key={record.id}><div><strong>{record.title}{record.year ? ` (${record.year})` : ''}</strong><small>{record.mediaType === 'movie' ? 'Movie' : 'TV show'} · {record.state.replace('-', ' ')} · Library {record.libraryId}</small></div><code>{record.mediaPath}</code></div>)}</div> : <p className="empty-state">No placeholder files are currently tracked.</p>}
        <button className="button secondary" type="button" onClick={() => {
          void api.placeholderInventory().then(setInventory).catch((error) =>
            setMessage(error instanceof Error ? error.message : 'Unable to refresh placeholder inventory.')
          );
        }}>Refresh lifecycle inventory</button>
      </div>
      <div className="webhook-panel">
        <strong>Plex watched-state webhook</strong>
        <p>Requires Plex Pass. Add this exact URL in Plex Settings → Webhooks. It resets watched state only for recognized Vynode trailer placeholders.</p>
        <div className="webhook-address">
          <code>{window.location.origin}/plex-webhook</code>
          <button className="text-button" type="button" onClick={() => {
            void navigator.clipboard.writeText(`${window.location.origin}/plex-webhook`).then(
              () => setMessage('Webhook URL copied.'),
              () => setMessage('Copy the displayed webhook URL manually.')
            );
          }}>Copy URL</button>
        </div>
        <p className="field-help">Plex sends play, stop, and scrobble events as multipart form data. Duplicate deliveries are ignored safely; uploaded thumbnail data is discarded.</p>
        <div className={`webhook-state ${webhook?.state ?? 'waiting'}`} aria-live="polite">
          <strong>{webhook?.state === 'processed' ? 'Last event processed' : webhook?.state === 'failed' ? 'Last reset failed' : webhook?.state === 'ignored' ? 'Last event needed no action' : 'Waiting for a Plex event'}</strong>
          <span>{webhook?.detail ?? 'No Plex webhook has been received yet.'}</span>
          {webhook?.receivedAt && <small>{new Date(webhook.receivedAt).toLocaleString()} · {webhook.event}</small>}
        </div>
        <button className="button secondary" type="button" onClick={() => {
          void api.plexWebhookStatus().then(setWebhook).catch((error) =>
            setMessage(error instanceof Error ? error.message : 'Unable to refresh webhook status.')
          );
        }}>Refresh webhook status</button>
      </div>
      <div className="inline-actions">
        <button className="button primary" disabled={busy || !settings} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save placeholder settings'}
        </button>
        {message && <span className="source-feedback" role="status">{message}</span>}
      </div>
    </section>
  );
};

const DestinationFields = ({
  label,
  servers,
  options,
  value,
  onChange,
}: {
  label: string;
  servers: SeerrProbeResult['servers']['radarr'];
  options: SeerrProbeResult['radarrServerOptions'];
  value: SeerrDestination;
  onChange(value: SeerrDestination): void;
}) => {
  const selected = value.serverId === undefined ? undefined : options[value.serverId];
  const prefix = label.startsWith('Movies') ? 'seerr-radarr' : 'seerr-sonarr';
  return (
    <fieldset className="dependent-settings">
      <legend>{label}</legend>
      <div className="field-group">
        <label htmlFor={`${prefix}-server`}>{label} server</label>
        <select
          id={`${prefix}-server`}
          value={value.serverId ?? ''}
          onChange={(event) => {
            const serverId = event.target.value ? Number(event.target.value) : undefined;
            onChange({ ...(serverId === undefined ? {} : { serverId }), tagIds: [] });
          }}
        >
          <option value="">Do not set a default</option>
          {servers.map((server) => (
            <option key={server.id} value={server.id}>
              {server.name}{server.isDefault ? ' · Default' : ''}{server.is4k ? ' · 4K' : ''}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <>
          <div className="field-grid equal">
            <div className="field-group">
              <label htmlFor={`${prefix}-profile`}>{label} quality profile</label>
              <select id={`${prefix}-profile`} value={value.profileId ?? ''} onChange={(event) => onChange({ ...value, profileId: Number(event.target.value) })} required>
                <option value="">Select a quality profile</option>
                {selected.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor={`${prefix}-root`}>{label} root folder</label>
              <select id={`${prefix}-root`} value={value.rootFolder ?? ''} onChange={(event) => onChange({ ...value, rootFolder: event.target.value })} required>
                <option value="">Select a root folder</option>
                {selected.rootFolders.map((folder) => <option key={folder.id} value={folder.path}>{folder.path}</option>)}
              </select>
            </div>
          </div>
          <div className="field-group">
            <label id={`${prefix}-tags-label`}>Default tags</label>
            <p className="field-help">Tags applied to requests sent through this Seerr destination.</p>
            <div className="tag-options" role="group" aria-labelledby={`${prefix}-tags-label`}>
              {selected.tags.map((tag) => (
                <label key={tag.id}>
                  <input
                    type="checkbox"
                    checked={value.tagIds.includes(tag.id)}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        tagIds: event.target.checked
                          ? [...value.tagIds, tag.id]
                          : value.tagIds.filter((id) => id !== tag.id),
                      })
                    }
                  /> {tag.label}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </fieldset>
  );
};

const SeerrSection = () => {
  const [existing, setExisting] = useState<Awaited<ReturnType<typeof api.seerr>>>();
  const [editing, setEditing] = useState(false);
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('5055');
  const [useSsl, setUseSsl] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [urlBase, setUrlBase] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [tested, setTested] = useState<{ receipt: string; options: SeerrProbeResult }>();
  const [radarr, setRadarr] = useState<SeerrDestination>({ tagIds: [] });
  const [sonarr, setSonarr] = useState<SeerrDestination>({ tagIds: [] });
  const [userCreationMode, setUserCreationMode] = useState<ServiceUserCreationMode>('per-service');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [removal, setRemoval] = useState<Awaited<ReturnType<typeof api.seerrRemovalImpact>>>();
  const [removalMessage, setRemovalMessage] = useState('');

  const load = async () => {
    const configuration = await api.seerr();
    setExisting(configuration);
    if (configuration) {
      setHostname(configuration.endpoint.hostname);
      setPort(String(configuration.endpoint.port));
      setUseSsl(configuration.endpoint.useSsl);
      setUrlBase(configuration.endpoint.urlBase);
      setExternalUrl(configuration.endpoint.externalUrl ?? '');
      setRadarr(configuration.radarr);
      setSonarr(configuration.sonarr);
      setUserCreationMode(configuration.userCreationMode);
    }
  };
  useEffect(() => { void load(); }, []);
  const endpoint = () => ({
    hostname,
    port: Number(port),
    useSsl,
    apiKey,
    urlBase,
    ...(externalUrl ? { externalUrl } : {}),
  });
  const invalidate = () => {
    if (tested) {
      setTested(undefined);
      setRadarr({ tagIds: [] });
      setSonarr({ tagIds: [] });
      setMessage('Endpoint changed · test again to reload Seerr servers.');
    }
  };
  const test = async () => {
    setBusy(true);
    setMessage('Testing Seerr and loading every download server…');
    try {
      const result = await api.testSeerr(endpoint());
      setTested({ receipt: result.testReceipt, options: result.options });
      setMessage(`Verified · ${result.options.servers.radarr.length} Radarr and ${result.options.servers.sonarr.length} Sonarr servers found.`);
    } catch (error) {
      setTested(undefined);
      setMessage(error instanceof Error ? error.message : 'Unable to connect to Seerr.');
    } finally {
      setBusy(false);
    }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tested) return;
    setBusy(true);
    try {
      const saved = await api.saveSeerr(
        existing?.revision ?? 0,
        endpoint(),
        tested.receipt,
        radarr,
        sonarr,
        userCreationMode
      );
      setExisting(saved);
      setApiKey('');
      setEditing(false);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save Seerr.');
    } finally {
      setBusy(false);
    }
  };
  const reviewRemoval = async () => {
    setBusy(true);
    setMessage('Reviewing settings that depend on Seerr…');
    try {
      setRemoval(await api.seerrRemovalImpact());
      setRemovalMessage('');
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to review this connection.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!removal) return;
    setBusy(true);
    setRemovalMessage('');
    try {
      await api.removeSeerr(removal.configuration.revision, true);
      setRemoval(undefined);
      setExisting(undefined);
      setEditing(false);
      setMessage('Seerr disconnected. Radarr and Sonarr connections were kept.');
    } catch (error) {
      setRemovalMessage(error instanceof Error ? error.message : 'Unable to disconnect Seerr.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="workflow-section" id="seerr">
      <div className="workflow-heading">
        <div><h3>Seerr requests</h3><p>Connect requests, movie/series destinations, default profiles, roots, tags, and service-user creation.</p></div>
        <button className="button secondary" onClick={() => setEditing(true)}>{existing ? 'Edit Seerr' : 'Add Seerr connection'}</button>
      </div>
      {existing && !editing && (
        <article className="configured-row">
          <ServiceBadge letter="S" />
          <span><strong>Seerr</strong><small>{existing.endpoint.hostname}:{existing.endpoint.port}</small></span>
          <span className="source-state connected">Configured</span>
          <a className="text-button" href={serviceUrl(existing.endpoint)} target="_blank" rel="noreferrer">Open Seerr</a>
          <button className="text-button" type="button" onClick={() => setEditing(true)}>Edit</button>
          <button className="text-button danger-text" type="button" disabled={busy} onClick={() => void reviewRemoval()}>Disconnect</button>
        </article>
      )}
      {!existing && !editing && <p className="empty-state">Seerr is optional. Connect it for requests and Plex watchlist synchronization.</p>}
      {editing && (
        <form className="download-editor" onSubmit={(event) => void save(event)}>
          <div className="field-grid equal">
            <div className="field-group"><label htmlFor="seerr-host">Hostname or IP address</label><p className="field-help">Use the address Vynode can reach from its container, without http://, https://, or a path.</p><input id="seerr-host" value={hostname} onChange={(e) => { setHostname(e.target.value); invalidate(); }} required /></div>
            <div className="field-group"><label htmlFor="seerr-port">Port</label><p className="field-help">Usually 5055. Valid ports are 1 through 65535.</p><input id="seerr-port" type="number" inputMode="numeric" min={1} max={65535} value={port} onChange={(e) => { setPort(e.target.value); invalidate(); }} required /></div>
          </div>
          <label className="check-row compact"><input type="checkbox" checked={useSsl} onChange={(e) => { setUseSsl(e.target.checked); invalidate(); }} /><span><strong>Use HTTPS</strong></span></label>
          <div className="field-grid equal">
            <div className="field-group"><label htmlFor="seerr-key">API key</label><p className="field-help">Find this in Seerr Settings → General → API Key. It remains write-only after saving, so re-enter it whenever you update this connection.</p><input id="seerr-key" type="password" autoComplete="new-password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); invalidate(); }} placeholder={existing?.secretConfigured ? 'Re-enter to verify changes' : ''} required /></div>
            <div className="field-group"><label htmlFor="seerr-base">URL base</label><p className="field-help">Optional reverse-proxy path. Vynode normalizes it with one leading slash and no trailing slash.</p><input id="seerr-base" value={urlBase} onChange={(e) => { setUrlBase(e.target.value); invalidate(); }} placeholder="/seerr" /></div>
          </div>
          <div className="field-group"><label htmlFor="seerr-external">External URL</label><p className="field-help">Optional browser-facing URL used for links. Vynode removes its trailing slash.</p><input id="seerr-external" type="url" inputMode="url" value={externalUrl} onChange={(e) => { setExternalUrl(e.target.value); invalidate(); }} placeholder="https://requests.example.com" /></div>
          <div className="inline-actions"><button className="button secondary" type="button" disabled={busy || !hostname.trim() || !apiKey.trim() || Number(port) < 1 || Number(port) > 65535} onClick={() => void test()}>{busy ? 'Testing…' : 'Test connection'}</button>{message && <span className="source-feedback" role="status">{message}</span>}</div>
          {tested && (
            <>
              <DestinationFields label="Movies (Radarr) defaults" servers={tested.options.servers.radarr} options={tested.options.radarrServerOptions} value={radarr} onChange={setRadarr} />
              <DestinationFields label="TV shows (Sonarr) defaults" servers={tested.options.servers.sonarr} options={tested.options.sonarrServerOptions} value={sonarr} onChange={setSonarr} />
              <div className="field-group">
                <label htmlFor="service-user-mode">Create Seerr users for requests</label>
                <p className="field-help">Controls whether all automated requests share one service account or are separated for clearer attribution.</p>
                <select id="service-user-mode" value={userCreationMode} onChange={(e) => setUserCreationMode(e.target.value as ServiceUserCreationMode)}>
                  <option value="single">Single user (Vynode)</option>
                  <option value="per-service">Per service (TraktVynode, TMDBVynode)</option>
                  <option value="granular">Granular (TraktTrendingVynode, TMDBPopularVynode)</option>
                </select>
              </div>
            </>
          )}
          <div className="actions"><button className="button secondary" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="button primary" type="submit" disabled={!tested || busy}>Save Seerr connection</button></div>
        </form>
      )}
      {message && !editing && <p className="source-feedback" role="status">{message}</p>}
      {removal && (
        <ConfirmationDialog
          title="Disconnect Seerr?"
          description={`Vynode will stop using ${removal.configuration.endpoint.hostname}:${removal.configuration.endpoint.port} for requests and user provisioning.`}
          consequences={removal.consequences}
          confirmLabel="Disconnect Seerr"
          busy={busy}
          message={removalMessage}
          onCancel={() => setRemoval(undefined)}
          onConfirm={() => void remove()}
        />
      )}
    </section>
  );
};

const ArrEditor = ({
  kind,
  existing,
  onSaved,
  onCancel,
}: {
  kind: ArrKind;
  existing?: ArrConfigurationView;
  onSaved(): Promise<void>;
  onCancel(): void;
}) => {
  const values = existing?.endpoint;
  const selected = existing?.selection;
  const [name, setName] = useState(values?.name ?? (kind === 'radarr' ? 'Movies' : 'TV Shows'));
  const [hostname, setHostname] = useState(values?.hostname ?? '');
  const [port, setPort] = useState(String(values?.port ?? (kind === 'radarr' ? 7878 : 8989)));
  const [useSsl, setUseSsl] = useState(values?.useSsl ?? false);
  const [apiKey, setApiKey] = useState('');
  const [urlBase, setUrlBase] = useState(values?.urlBase ?? '');
  const [externalUrl, setExternalUrl] = useState(values?.externalUrl ?? '');
  const [isDefault, setIsDefault] = useState(selected?.isDefault ?? false);
  const [is4k, setIs4k] = useState(selected?.is4k ?? false);
  const [profileId, setProfileId] = useState(selected?.profileId ?? 0);
  const [rootFolder, setRootFolder] = useState(selected?.rootFolder ?? '');
  const [tagIds, setTagIds] = useState<readonly number[]>(selected?.tagIds ?? []);
  const [automaticTagMode, setAutomaticTagMode] = useState<AutomaticTagMode>(selected?.automaticTagMode ?? 'off');
  const [monitor, setMonitor] = useState(selected?.monitorByDefault ?? true);
  const [searchOnAdd, setSearchOnAdd] = useState(selected?.searchOnAdd ?? true);
  const [tagExisting, setTagExisting] = useState(selected?.tagExistingItems ?? false);
  const [availability, setAvailability] = useState<RadarrAvailability>(
    selected?.kind === 'radarr' ? selected.minimumAvailability : 'released'
  );
  const [seriesType, setSeriesType] = useState<SonarrSeriesType>(
    selected?.kind === 'sonarr' ? selected.seriesType : 'standard'
  );
  const [seasonFolders, setSeasonFolders] = useState(
    selected?.kind === 'sonarr' ? selected.seasonFolders : true
  );
  const [monitorType, setMonitorType] = useState<SonarrMonitorType>(
    selected?.kind === 'sonarr' ? selected.monitorType : 'all'
  );
  const [tested, setTested] = useState<{ receipt: string; options: ArrProbeResult }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const endpoint = (): ArrEndpointDraft => ({
    kind,
    name,
    hostname,
    port: Number(port),
    useSsl,
    apiKey,
    urlBase,
    ...(externalUrl ? { externalUrl } : {}),
  });

  const testConnection = async () => {
    setBusy(true);
    setMessage('Testing connection…');
    try {
      const result = await api.testDownloadService(endpoint());
      setTested({ receipt: result.testReceipt, options: result.options });
      setMessage(`Verified · ${result.options.serviceVersion}`);
      if (!profileId && result.options.profiles[0]) setProfileId(result.options.profiles[0].id);
      if (!rootFolder && result.options.rootFolders[0]) setRootFolder(result.options.rootFolders[0].path);
    } catch (error) {
      setTested(undefined);
      setMessage(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tested) {
      setMessage('Test this exact connection before saving.');
      return;
    }
    setBusy(true);
    try {
      const shared = {
        profileId,
        rootFolder,
        tagIds,
        isDefault,
        is4k,
        automaticTagMode,
        monitorByDefault: monitor,
        searchOnAdd,
        tagExistingItems: tagExisting,
      };
      const selection =
        kind === 'radarr'
          ? { kind, ...shared, minimumAvailability: availability }
          : { kind, ...shared, seriesType, seasonFolders, monitorType };
      await api.saveDownloadService(
        existing?.id,
        existing?.revision ?? 0,
        endpoint(),
        selection,
        tested.receipt
      );
      setMessage('Connected and saved.');
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save.');
    } finally {
      setBusy(false);
    }
  };

  const invalidate = () => {
    if (tested) {
      setTested(undefined);
      setMessage('Connection changed · test again to refresh options.');
    }
  };

  return (
    <form className="download-editor" onSubmit={(event) => void save(event)}>
      <div className="field-grid equal">
        <div className="field-group">
          <label htmlFor={`${kind}-name`}>Display name</label>
          <p className="field-help">A recognizable name shown throughout Vynode, such as {kind === 'radarr' ? 'Movies, Kids Movies, or Movies 4K' : 'TV Shows, Anime, or TV 4K'}.</p>
          <input id={`${kind}-name`} value={name} onChange={(e) => { setName(e.target.value); invalidate(); }} required />
        </div>
        <div className="field-group">
          <label htmlFor={`${kind}-host`}>Hostname</label>
          <p className="field-help">Use the address reachable from the Vynode container, without a protocol or path.</p>
          <input id={`${kind}-host`} value={hostname} onChange={(e) => { setHostname(e.target.value); invalidate(); }} required />
        </div>
      </div>
      <div className="field-grid equal">
        <div className="field-group">
          <label htmlFor={`${kind}-port`}>Port</label>
          <p className="field-help">Default: {kind === 'radarr' ? '7878' : '8989'}. Valid ports are 1 through 65535.</p>
          <input id={`${kind}-port`} type="number" inputMode="numeric" min={1} max={65535} value={port} onChange={(e) => { setPort(e.target.value); invalidate(); }} required />
        </div>
        <div className="field-group">
          <label htmlFor={`${kind}-base`}>URL base</label>
          <p className="field-help">Optional reverse-proxy path. Vynode normalizes it with one leading slash and no trailing slash.</p>
          <input id={`${kind}-base`} value={urlBase} onChange={(e) => { setUrlBase(e.target.value); invalidate(); }} placeholder="/optional-path" />
        </div>
      </div>
      <label className="check-row compact">
        <input type="checkbox" checked={useSsl} onChange={(e) => { setUseSsl(e.target.checked); invalidate(); }} />
        <span><strong>Use HTTPS</strong></span>
      </label>
      <p className="field-help">Enable only when this internal connection serves HTTPS directly.</p>
      <div className="field-grid equal">
        <div className="field-group">
          <label htmlFor={`${kind}-api-key`}>API key</label>
          <p className="field-help">Find this in {kind === 'radarr' ? 'Radarr' : 'Sonarr'} Settings → General → Security. Stored keys are never returned to the browser; enter it again when editing.</p>
          <input id={`${kind}-api-key`} type="password" autoComplete="new-password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); invalidate(); }} placeholder={existing?.secretConfigured ? 'Re-enter to verify changes' : ''} required />
        </div>
        <div className="field-group">
          <label htmlFor={`${kind}-external`}>External URL</label>
          <p className="field-help">Optional browser-facing address used by “Open {kind === 'radarr' ? 'Radarr' : 'Sonarr'}”. Vynode removes its trailing slash.</p>
          <input id={`${kind}-external`} type="url" inputMode="url" value={externalUrl} onChange={(e) => { setExternalUrl(e.target.value); invalidate(); }} placeholder="https://service.example.com" />
        </div>
      </div>
      <div className="inline-actions">
        <button className="button secondary" type="button" disabled={busy || !name.trim() || !hostname.trim() || !apiKey.trim() || Number(port) < 1 || Number(port) > 65535} onClick={() => void testConnection()}>
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        {message && <span className="source-feedback" role="status">{message}</span>}
      </div>

      <fieldset className="dependent-settings" disabled={!tested}>
        <legend>Download defaults</legend>
        <p className="field-help">Profiles, folders, and tags are loaded from the tested server.</p>
        <div className="field-grid equal">
          <div className="field-group">
            <label htmlFor={`${kind}-profile`}>Quality profile</label>
            <select id={`${kind}-profile`} value={profileId} onChange={(e) => setProfileId(Number(e.target.value))} required>
              <option value={0}>Select profile</option>
              {tested?.options.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor={`${kind}-root`}>Root folder</label>
            <select id={`${kind}-root`} value={rootFolder} onChange={(e) => setRootFolder(e.target.value)} required>
              <option value="">Select root folder</option>
              {tested?.options.rootFolders.map((folder) => <option key={folder.id} value={folder.path}>{folder.path}</option>)}
            </select>
          </div>
        </div>
        {kind === 'radarr' ? (
          <div className="field-group">
            <label htmlFor="radarr-availability">Minimum availability</label>
            <p className="field-help">Determines how early a requested movie is considered eligible for downloading.</p>
            <select id="radarr-availability" value={availability} onChange={(e) => setAvailability(e.target.value as RadarrAvailability)}>
              <option value="announced">Announced</option>
              <option value="inCinemas">In cinemas</option>
              <option value="released">Released</option>
            </select>
          </div>
        ) : (
          <div className="field-grid equal">
            <div className="field-group">
              <label htmlFor="sonarr-series-type">Series type</label>
              <p className="field-help">Choose Standard for most shows, Daily for date-based episodes, or Anime for absolute numbering.</p>
              <select id="sonarr-series-type" value={seriesType} onChange={(e) => setSeriesType(e.target.value as SonarrSeriesType)}>
                <option value="standard">Standard</option><option value="daily">Daily</option><option value="anime">Anime</option>
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="sonarr-monitor-type">Monitor type</label>
              <p className="field-help">Controls which episodes Sonarr monitors when Vynode adds a series.</p>
              <select id="sonarr-monitor-type" value={monitorType} onChange={(e) => setMonitorType(e.target.value as SonarrMonitorType)}>
                <option value="all">All episodes</option><option value="future">Future episodes</option><option value="missing">Missing episodes</option><option value="existing">Existing episodes</option><option value="pilot">Pilot</option><option value="firstSeason">First season</option><option value="latestSeason">Latest season</option><option value="none">None</option>
              </select>
            </div>
          </div>
        )}
        <div className="field-group">
          <label id={`${kind}-tags-label`}>Tags</label>
          <p className="field-help">Existing server tags applied to every item Vynode sends through this connection.</p>
          <div className="tag-options" role="group" aria-labelledby={`${kind}-tags-label`}>
            {tested?.options.tags.map((tag) => (
              <label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={(e) => setTagIds(e.target.checked ? [...tagIds, tag.id] : tagIds.filter((id) => id !== tag.id))} /> {tag.label}</label>
            ))}
          </div>
        </div>
        <div className="field-group">
          <label htmlFor={`${kind}-automatic-tags`}>Automatic tag mode</label>
          <p className="field-help">Optionally add Vynode-managed tags for cleanup, attribution, or collection-specific routing.</p>
          <select id={`${kind}-automatic-tags`} value={automaticTagMode} onChange={(e) => setAutomaticTagMode(e.target.value as AutomaticTagMode)}>
            <option value="off">Do not add automatic tags</option><option value="single">Single Vynode tag</option><option value="per-service">Per-service tags</option><option value="granular">Per-collection tags</option>
          </select>
        </div>
        <div className="toggle-grid">
          <label className="check-row compact"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /><span><strong>Default server</strong><small>Use for standard or 4K requests when no server is chosen explicitly.</small></span></label>
          <label className="check-row compact"><input type="checkbox" checked={is4k} onChange={(e) => setIs4k(e.target.checked)} /><span><strong>4K tier</strong><small>Keep this destination separate from standard-quality requests.</small></span></label>
          <label className="check-row compact"><input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} /><span><strong>Monitor by default</strong><small>Ask {kind === 'radarr' ? 'Radarr' : 'Sonarr'} to monitor newly added items.</small></span></label>
          <label className="check-row compact"><input type="checkbox" checked={searchOnAdd} onChange={(e) => setSearchOnAdd(e.target.checked)} /><span><strong>Search on add</strong><small>Start an automatic search immediately after adding an item.</small></span></label>
          <label className="check-row compact"><input type="checkbox" checked={tagExisting} onChange={(e) => setTagExisting(e.target.checked)} /><span><strong>Tag existing items</strong><small>Apply the selected tags when Vynode finds an item already on this server.</small></span></label>
          {kind === 'sonarr' && <label className="check-row compact"><input type="checkbox" checked={seasonFolders} onChange={(e) => setSeasonFolders(e.target.checked)} /><span><strong>Season folders</strong><small>Store episodes inside separate Season folders.</small></span></label>}
        </div>
      </fieldset>
      <div className="actions">
        <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
        <button className="button primary" type="submit" disabled={!tested || busy}>Save server</button>
      </div>
    </form>
  );
};

const ArrSection = ({ kind }: { kind: ArrKind }) => {
  const [items, setItems] = useState<readonly ArrConfigurationView[]>([]);
  const [editing, setEditing] = useState<ArrConfigurationView | 'new'>();
  const [removal, setRemoval] = useState<Awaited<ReturnType<typeof api.downloadServiceRemovalImpact>>>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => setItems(await api.downloadServices(kind));
  useEffect(() => { void load(); }, [kind]);
  const title = kind === 'radarr' ? 'Radarr' : 'Sonarr';
  const reviewRemoval = async (item: ArrConfigurationView) => {
    setBusy(true);
    setMessage('Checking where this server is used…');
    try {
      setRemoval(await api.downloadServiceRemovalImpact(item.id));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to review this server.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!removal) return;
    setBusy(true);
    setMessage('');
    try {
      await api.removeDownloadService(
        removal.configuration.id,
        removal.configuration.revision,
        true
      );
      setRemoval(undefined);
      await load();
      setMessage(`${title} server removed from Vynode.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to remove ${title}.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="workflow-section">
      <div className="workflow-heading">
        <div><h3>{title}</h3><p>{kind === 'radarr' ? 'Movie downloads and availability rules.' : 'Series downloads, monitoring, and season folders.'}</p></div>
        <button className="button secondary" onClick={() => setEditing('new')}>Add {title} server</button>
      </div>
      {items.length === 0 && !editing && <p className="empty-state">No {title} servers configured.</p>}
      {items.map((item) => (
        <article className="configured-row" key={item.id}>
          <ServiceBadge letter={title[0]} />
          <span><strong>{item.endpoint.name}</strong><small>{item.endpoint.hostname}:{item.endpoint.port}</small></span>
          <span className="row-badges">{item.selection.isDefault && <em>Default</em>}{item.selection.is4k && <em>4K</em>}</span>
          <a className="text-button" href={serviceUrl(item.endpoint)} target="_blank" rel="noreferrer">Open {title}</a>
          <button className="text-button" onClick={() => setEditing(item)}>Edit</button>
          <button className="text-button danger-text" disabled={busy} onClick={() => void reviewRemoval(item)}>Remove</button>
        </article>
      ))}
      {message && <p className="source-feedback" role="status">{message}</p>}
      {editing && <ArrEditor kind={kind} existing={editing === 'new' ? undefined : editing} onCancel={() => setEditing(undefined)} onSaved={async () => { await load(); setEditing(undefined); }} />}
      {removal && (
        <ConfirmationDialog
          title={`Remove ${removal.configuration.endpoint.name}?`}
          description={`This ${title} connection will no longer be available for new requests, missing-media actions, or watchlist synchronization.`}
          consequences={[
            ...(removal.references.length
              ? removal.references.map((reference) => `${reference} will need a replacement destination.`)
              : ['No active Vynode setting currently references this server.']),
            ...(removal.configuration.selection.isDefault
              ? [`This is the default ${removal.configuration.selection.is4k ? '4K' : 'standard'} ${title} server; choose another default after removal.`]
              : []),
            'Items, files, profiles, root folders, and tags on the external server will not be deleted.',
          ]}
          confirmLabel={`Remove ${title}`}
          busy={busy}
          message={message}
          onCancel={() => { setRemoval(undefined); setMessage(''); }}
          onConfirm={() => void remove()}
        />
      )}
    </section>
  );
};

const defaultWatchlistDestination = (kind: ArrKind): WatchlistDestination => ({
  tagIds: [],
  tagWithUsername: false,
  monitor: true,
  searchOnAdd: true,
  ...(kind === 'sonarr' ? { seasonFolders: true } : {}),
});

const WatchlistDestinationFields = ({
  kind,
  value,
  options,
  onChange,
}: {
  kind: ArrKind;
  value: WatchlistDestination;
  options?: WatchlistDestinationOptions;
  onChange(value: WatchlistDestination): void;
}) => {
  const label = kind === 'radarr' ? 'Movies' : 'TV shows';
  const prefix = `watchlist-${kind}`;
  const selected = value.serverId
    ? options?.serverOptions[value.serverId]
    : undefined;
  const [newTag, setNewTag] = useState('');
  const [createdTags, setCreatedTags] = useState<readonly { id: number; label: string }[]>([]);
  const [tagMessage, setTagMessage] = useState('');
  const createTag = async () => {
    if (!value.serverId || !newTag.trim()) return;
    setTagMessage('Creating tag…');
    try {
      const tag = await api.createWatchlistTag(kind, value.serverId, newTag);
      setCreatedTags((current) => [...current.filter((item) => item.id !== tag.id), tag]);
      onChange({ ...value, tagIds: [...new Set([...value.tagIds, tag.id])] });
      setNewTag('');
      setTagMessage(`Created “${tag.label}”.`);
    } catch (error) {
      setTagMessage(error instanceof Error ? error.message : 'Unable to create tag.');
    }
  };
  return (
    <fieldset className="dependent-settings">
      <legend>{label} destination</legend>
      <div className="field-group">
        <label htmlFor={`${prefix}-server`}>{kind === 'radarr' ? 'Radarr server' : 'Sonarr server'}</label>
        <p className="field-help">This is a download destination, not a Plex library. Changing it clears its profile, root folder, and tags.</p>
        <select
          id={`${prefix}-server`}
          value={value.serverId ?? ''}
          onChange={(event) =>
            onChange({
              ...defaultWatchlistDestination(kind),
              ...(event.target.value ? { serverId: event.target.value } : {}),
            })
          }
          required
        >
          <option value="">Select a server</option>
          {options?.servers.map((server) => (
            <option value={server.id} key={server.id}>
              {server.name}{server.isDefault ? ' · Default' : ''}{server.is4k ? ' · 4K' : ''}
            </option>
          ))}
        </select>
        {!options?.servers.length && <p className="error-banner" role="status">No verified {kind === 'radarr' ? 'Radarr' : 'Sonarr'} server is configured yet. Add and test one in the section above, then reload destinations.</p>}
      </div>
      {value.serverId && !selected && (
        <p className="error-banner" role="alert">Options for the selected server are unavailable. Reload the destination list.</p>
      )}
      {selected && (
        <>
          <div className="field-grid equal">
            <div className="field-group">
              <label htmlFor={`${prefix}-profile`}>{label} quality profile</label>
              <select id={`${prefix}-profile`} value={value.profileId ?? ''} onChange={(event) => onChange({ ...value, profileId: Number(event.target.value) })} required>
                <option value="">Select a quality profile</option>
                {selected.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor={`${prefix}-root`}>{label} root folder</label>
              <select id={`${prefix}-root`} value={value.rootFolder ?? ''} onChange={(event) => onChange({ ...value, rootFolder: event.target.value })} required>
                <option value="">Select a root folder</option>
                {selected.rootFolders.map((folder) => <option key={folder.id} value={folder.path}>{folder.path}</option>)}
              </select>
            </div>
          </div>
          <div className="field-group">
            <label id={`${prefix}-tags-label`}>{label} tags</label>
            <p className="field-help">Choose existing tags or create one directly on this server.</p>
            <div className="tag-options" role="group" aria-labelledby={`${prefix}-tags-label`}>
              {[...selected.tags, ...createdTags.filter((tag) => !selected.tags.some((item) => item.id === tag.id))].map((tag) => (
                <label key={tag.id}><input type="checkbox" checked={value.tagIds.includes(tag.id)} onChange={(event) => onChange({ ...value, tagIds: event.target.checked ? [...value.tagIds, tag.id] : value.tagIds.filter((id) => id !== tag.id) })} /> {tag.label}</label>
              ))}
            </div>
            <div className="inline-actions">
              <input aria-label={`New ${label.toLowerCase()} tag`} value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="New tag name" maxLength={64} />
              <button className="button secondary" type="button" onClick={() => void createTag()} disabled={!newTag.trim()}>Create tag</button>
              {tagMessage && <span className="source-feedback" role="status">{tagMessage}</span>}
            </div>
          </div>
          <div className="toggle-grid">
            <label><input type="checkbox" checked={value.tagWithUsername} onChange={(event) => onChange({ ...value, tagWithUsername: event.target.checked })} /> Tag with Plex username</label>
            <label><input type="checkbox" checked={value.monitor} onChange={(event) => onChange({ ...value, monitor: event.target.checked })} /> Monitor added items</label>
            <label><input type="checkbox" checked={value.searchOnAdd} onChange={(event) => onChange({ ...value, searchOnAdd: event.target.checked })} /> Search immediately</label>
            {kind === 'sonarr' && <label><input type="checkbox" checked={value.seasonFolders ?? true} onChange={(event) => onChange({ ...value, seasonFolders: event.target.checked })} /> Use season folders</label>}
          </div>
        </>
      )}
    </fieldset>
  );
};

const WatchlistSection = () => {
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof api.watchlists>>>();
  const [enableOwner, setEnableOwner] = useState(false);
  const [enableUsers, setEnableUsers] = useState(false);
  const [radarr, setRadarr] = useState<WatchlistDestination>(defaultWatchlistDestination('radarr'));
  const [sonarr, setSonarr] = useState<WatchlistDestination>(defaultWatchlistDestination('sonarr'));
  const [radarrOptions, setRadarrOptions] = useState<WatchlistDestinationOptions>();
  const [sonarrOptions, setSonarrOptions] = useState<WatchlistDestinationOptions>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    setLoading(true);
    setMessage('Loading configured download destinations…');
    try {
      const [current, movieOptions, showOptions] = await Promise.all([
        api.watchlists(),
        api.watchlistOptions('radarr'),
        api.watchlistOptions('sonarr'),
      ]);
      setSettings(current);
      setEnableOwner(current.enableOwner);
      setEnableUsers(current.enableUsers);
      setRadarr(current.radarr);
      setSonarr(current.sonarr);
      setRadarrOptions(movieOptions);
      setSonarrOptions(showOptions);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Download destination options could not be loaded.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setMessage('Saving watchlist synchronization…');
    try {
      const saved = await api.saveWatchlists(settings.revision, enableOwner, enableUsers, radarr, sonarr);
      setSettings(saved);
      setMessage('Watchlist settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save watchlist settings.');
    } finally {
      setBusy(false);
    }
  };
  const enabled = enableOwner;
  return (
    <section className="workflow-section" id="watchlists">
      <div className="workflow-heading">
        <div><h3>Plex watchlist sync</h3><p>Route the owner watchlist directly to Radarr and Sonarr, or use Seerr for linked-user identity routing.</p></div>
        {settings?.lastSyncAt ? <span className="audit-state">Last sync {new Date(settings.lastSyncAt).toLocaleString()}</span> : <span className="audit-state">Not synced yet</span>}
      </div>
      <form onSubmit={(event) => void save(event)}>
        <div className="toggle-grid">
          <label className="check-row compact"><input type="checkbox" checked={enableOwner} onChange={(event) => setEnableOwner(event.target.checked)} /><span><strong>Enable for the Plex owner</strong><small>Process additions from the installation owner’s Plex watchlist.</small></span></label>
          <label className="check-row compact"><input type="checkbox" checked={enableUsers} onChange={(event) => setEnableUsers(event.target.checked)} /><span><strong>Enable for linked Seerr users</strong><small>Trigger requests for linked users who enabled Plex watchlist sync in their Seerr profile.</small></span></label>
        </div>
        <p className="field-help">Owner sync routes directly to the movie and TV destinations below. Linked-user sync delegates identity, permissions, and request routing to Seerr and uses the destinations configured there.</p>
        {enabled && !loading && (
          <>
            <WatchlistDestinationFields kind="radarr" value={radarr} options={radarrOptions} onChange={setRadarr} />
            <WatchlistDestinationFields kind="sonarr" value={sonarr} options={sonarrOptions} onChange={setSonarr} />
          </>
        )}
        <div className="inline-actions">
          <button className="button primary" type="submit" disabled={busy || loading || !settings}>{busy ? 'Saving…' : 'Save watchlist settings'}</button>
          <button className="button secondary" type="button" disabled={loading} onClick={() => void load()}>Reload destinations</button>
          {message && <span className="source-feedback" role="status">{message}</span>}
        </div>
      </form>
    </section>
  );
};

export const DownloadStage = ({ busy, onComplete, settingsMode = false }: { busy: boolean; onComplete(): Promise<void>; settingsMode?: boolean }) => (
  <>
    <nav className="section-jump" aria-label="Download setup sections">
      <a href="#seerr">Seerr</a><a href="#radarr">Radarr</a><a href="#sonarr">Sonarr</a><a href="#placeholders">Placeholders</a><a href="#watchlists">Watchlists</a>
    </nav>
    <SeerrSection />
    <div id="radarr"><ArrSection kind="radarr" /></div>
    <div id="sonarr"><ArrSection kind="sonarr" /></div>
    <PlaceholderSection />
    <WatchlistSection />
    {!settingsMode && <div className="actions">
      <button className="button secondary" disabled={busy} onClick={() => void onComplete()}>Skip for now</button>
      <button className="button primary" disabled={busy} onClick={() => void onComplete()}>Continue</button>
    </div>}
  </>
);
