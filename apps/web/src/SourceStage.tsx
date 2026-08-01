import type {
  IntegrationConfiguration,
  IntegrationDraft,
  IntegrationId,
} from '@vynode/integrations';
import { useEffect, useRef, useState } from 'react';

import { api } from './api';
import {
  TRAKT_RETURN_WINDOW_NAME,
  traktRedirectUriForLocation,
} from './traktRedirectUri';

const definitions: {
  id: IntegrationId;
  name: string;
  description: string;
  port?: number;
}[] = [
  {
    id: 'trakt',
    name: 'Trakt',
    description: 'Public lists with a Client ID and optional OAuth app credentials.',
  },
  {
    id: 'tmdb',
    name: 'TMDB',
    description: 'Charts, lists, discovery filters, franchises, networks, and metadata.',
  },
  {
    id: 'mdblist',
    name: 'MDBList',
    description: 'Custom lists, ratings, and provider metadata.',
  },
  {
    id: 'myanimelist',
    name: 'MyAnimeList',
    description: 'Anime rankings and list metadata using a Client ID.',
  },
  {
    id: 'tautulli',
    name: 'Tautulli',
    description: 'Plex activity and popularity-based collection sources.',
    port: 8181,
  },
  {
    id: 'maintainerr',
    name: 'Maintainerr',
    description:
      'Deletion countdown context for movie, show, and season poster overlays.',
    port: 6246,
  },
];

const IntegrationEditor = ({
  definition,
  settingsMode,
}: {
  definition: (typeof definitions)[number];
  settingsMode: boolean;
}) => {
  const [existing, setExisting] = useState<IntegrationConfiguration>();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [oauth, setOauth] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState(String(definition.port ?? ''));
  const [useSsl, setUseSsl] = useState(false);
  const [urlBase, setUrlBase] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [traktConnected, setTraktConnected] = useState(false);
  const [traktExpiresAt, setTraktExpiresAt] = useState('');
  const traktCallbackStarted = useRef(false);
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'error'>(
    'neutral'
  );

  useEffect(() => {
    void api.integration(definition.id).then((configuration) => {
      setExisting(configuration);
      if (!configuration) return;
      const values = configuration.values;
      setClientId(String(values.clientId ?? ''));
      setOauth(values.mode === 'oauth');
      setHostname(String(values.hostname ?? ''));
      setPort(String(values.port ?? definition.port ?? ''));
      setUseSsl(Boolean(values.useSsl));
      setUrlBase(String(values.urlBase ?? ''));
      setExternalUrl(String(values.externalUrl ?? ''));
    });
  }, [definition]);

  useEffect(() => {
    if (definition.id !== 'trakt') return;
    void api.traktOAuthStatus().then((result) => {
      setTraktConnected(result.connected);
      setTraktExpiresAt(result.expiresAt ?? '');
    });
    const query = new URLSearchParams(window.location.search);
    const code = query.get('code');
    const state = query.get('state');
    if (!code || !state) return;
    if (traktCallbackStarted.current) return;
    traktCallbackStarted.current = true;
    setExpanded(true);
    setBusy(true);
    setStatusTone('neutral');
    setStatus('Completing Trakt account authorization…');
    void api
      .exchangeTraktOAuth(code, state)
      .then((result) => {
        setTraktConnected(result.connected);
        setTraktExpiresAt(result.expiresAt ?? '');
        setStatusTone('success');
        setStatus('Trakt account connected successfully.');
      })
      .catch((error: unknown) => {
        setStatusTone('error');
        setStatus(
          error instanceof Error
            ? error.message
            : 'Unable to complete Trakt authorization.'
        );
      })
      .finally(() => {
        setBusy(false);
        const clean = new URL(window.location.href);
        clean.searchParams.delete('code');
        clean.searchParams.delete('state');
        clean.searchParams.delete('oauth');
        window.history.replaceState({}, '', `${clean.pathname}${clean.search}`);
      });
  }, [definition.id]);

  const draft = (): IntegrationDraft => {
    if (definition.id === 'trakt') {
      return {
        id: 'trakt',
        clientId,
        mode: oauth ? 'oauth' : 'basic',
        ...(clientSecret ? { clientSecret } : {}),
      };
    }
    if (
      definition.id === 'tmdb' ||
      definition.id === 'mdblist' ||
      definition.id === 'myanimelist'
    ) {
      return { id: definition.id, apiKey };
    }
    const endpoint = {
      hostname,
      port: Number(port),
      useSsl,
      urlBase,
      externalUrl,
    };
    if (definition.id === 'tautulli')
      return { id: definition.id, ...endpoint, apiKey };
    return {
      id: 'maintainerr',
      ...endpoint,
      ...(apiKey ? { apiKey } : {}),
    };
  };

  const verifyAndSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatusTone('neutral');
    setStatus(
      definition.id === 'trakt' && oauth
        ? 'Testing the Trakt Client ID…'
        : 'Testing connection…'
    );
    try {
      const input = draft();
      const receipt = await api.testIntegration(input);
      setStatus(
        definition.id === 'trakt' && oauth
          ? 'Saving OAuth application credentials securely…'
          : 'Connection verified. Saving…'
      );
      const saved = await api.saveIntegration(
        existing?.revision ?? 0,
        input,
        receipt.verificationReceipt
      );
      setExisting(saved);
      setApiKey('');
      setClientSecret('');
      setStatusTone('success');
      setStatus(
        definition.id === 'trakt' && oauth
          ? 'Trakt Client ID verified and OAuth application saved. Connect your account to validate the secret and finish authorization.'
          : 'Connection verified and configuration saved.'
      );
    } catch (error) {
      setStatusTone('error');
      setStatus(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!existing) return;
    setBusy(true);
    setStatusTone('neutral');
    setStatus('Disconnecting and removing stored credentials…');
    try {
      await api.disconnectIntegration(definition.id, existing.revision);
      setExisting(undefined);
      setApiKey('');
      setClientSecret('');
      setConfirmDisconnect(false);
      setStatusTone('success');
      setStatus(
        `${definition.name} disconnected. Dependent collections remain configured but cannot refresh until this source is reconnected.`
      );
    } catch (error) {
      setStatusTone('error');
      setStatus(
        error instanceof Error
          ? error.message
          : 'Unable to disconnect this source.'
      );
    } finally {
      setBusy(false);
    }
  };

  const traktRedirectUri =
    typeof window === 'undefined'
      ? ''
      : traktRedirectUriForLocation(window.location);

  const connectTrakt = async () => {
    setBusy(true);
    setStatusTone('neutral');
    setStatus('Preparing secure Trakt authorization…');
    try {
      const attempt = await api.beginTraktOAuth(traktRedirectUri);
      const callbackOrigin = new URL(traktRedirectUri).origin;
      window.name =
        callbackOrigin === window.location.origin
          ? ''
          : `${TRAKT_RETURN_WINDOW_NAME}${window.location.origin}`;
      window.location.assign(attempt.authorizeUrl);
    } catch (error) {
      setBusy(false);
      setStatusTone('error');
      setStatus(
        error instanceof Error
          ? error.message
          : 'Unable to begin Trakt authorization.'
      );
    }
  };

  const disconnectTrakt = async () => {
    setBusy(true);
    setStatusTone('neutral');
    setStatus('Disconnecting the Trakt account…');
    try {
      await api.disconnectTraktOAuth();
      setTraktConnected(false);
      setTraktExpiresAt('');
      setStatusTone('success');
      setStatus(
        'Trakt account disconnected. OAuth application credentials remain saved.'
      );
    } catch (error) {
      setStatusTone('error');
      setStatus(
        error instanceof Error
          ? error.message
          : 'Unable to disconnect the Trakt account.'
      );
    } finally {
      setBusy(false);
    }
  };

  const refreshTrakt = async () => {
    setBusy(true);
    setStatusTone('neutral');
    setStatus('Refreshing Trakt authorization securely…');
    try {
      const result = await api.refreshTraktOAuth(traktRedirectUri);
      setTraktConnected(result.connected);
      setTraktExpiresAt(result.expiresAt ?? '');
      setStatusTone('success');
      setStatus('Trakt authorization refreshed successfully.');
    } catch (error) {
      setStatusTone('error');
      setStatus(
        error instanceof Error
          ? error.message
          : 'Unable to refresh Trakt authorization.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`source-card ${expanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="source-summary"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="source-mark">{definition.name.slice(0, 1)}</span>
        <span>
          <strong>{definition.name}</strong>
          <small>{definition.description}</small>
        </span>
        <span className="source-summary-state">
          <span className={existing ? 'source-state connected' : 'source-state'}>
            {existing ? 'Configured' : 'Optional'}
          </span>
          <span className="source-chevron" aria-hidden="true">⌄</span>
        </span>
      </button>
      {expanded && (
        <form className="source-editor" onSubmit={(event) => void verifyAndSave(event)}>
          {definition.id === 'trakt' && (
            <>
              <label className="check-row compact">
                <input
                  type="checkbox"
                  checked={oauth}
                  onChange={(event) => setOauth(event.target.checked)}
                />
                <span>
                  <strong>Configure Trakt OAuth app credentials</strong>
                  <small>Leave off when you only need public lists with a Client ID.</small>
                </span>
              </label>
              <div className="field-group">
                <label htmlFor="trakt-client-id">Client ID</label>
                  <input id="trakt-client-id" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} required />
                <p className="field-help">Create a Trakt API application and enter its public Client ID. Public lists do not require account authorization.</p>
              </div>
              {oauth && (
                <>
                  <div className="field-group">
                    <label htmlFor="trakt-client-secret">Client secret</label>
                    <input id="trakt-client-secret" type="password" autoComplete="new-password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={existing?.secretConfigured ? 'Re-enter only when changing app credentials' : ''} required={!existing?.secretConfigured} />
                    <p className="field-help">Required for account authorization. It is write-only after saving and is never returned to this browser.</p>
                  </div>
                  <div className="field-group">
                    <label htmlFor="trakt-redirect-uri">Trakt redirect URI</label>
                    <input id="trakt-redirect-uri" value={traktRedirectUri} readOnly />
                    <p className="field-help">Add this exact URI to your Trakt API application. Local development always uses localhost, even when Vynode was opened through 127.0.0.1, so Trakt receives one stable callback.</p>
                  </div>
                  {existing?.values.mode === 'oauth' && (
                    <section className="oauth-account-panel" aria-label="Trakt account connection">
                      <div>
                        <strong>
                          {traktConnected
                            ? 'Trakt account connected'
                            : 'Trakt account not connected'}
                        </strong>
                        <p className="field-help">
                          {traktConnected
                            ? `Private sources are available${traktExpiresAt ? `; access renews automatically before ${new Date(traktExpiresAt).toLocaleString()}` : ''}.`
                            : 'Connect an account to use recommendations and watchlists. Public lists remain available without this step.'}
                        </p>
                      </div>
                      <div className="inline-actions">
                        {traktConnected && (
                          <button
                            className="button secondary"
                            type="button"
                            disabled={busy}
                            onClick={() => void refreshTrakt()}
                          >
                            Refresh authorization
                          </button>
                        )}
                        <button
                          className={`button ${traktConnected ? 'danger' : 'secondary'}`}
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void (traktConnected
                              ? disconnectTrakt()
                              : connectTrakt())
                          }
                        >
                          {traktConnected
                            ? 'Disconnect Trakt account'
                            : 'Connect Trakt account'}
                        </button>
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
          {(definition.id === 'tmdb' || definition.id === 'mdblist' || definition.id === 'myanimelist') && (
            <div className="field-group">
              <label htmlFor={`${definition.id}-key`}>
                {definition.id === 'myanimelist' ? 'Client ID' : 'API key'}
              </label>
              <input id={`${definition.id}-key`} type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={existing?.secretConfigured ? 'Re-enter to verify changes' : ''} required />
              <p className="field-help">
                {definition.id === 'myanimelist' ? (
                  'Use the Client ID from a MyAnimeList API application. It remains write-only after saving, so re-enter it when updating this configuration.'
                ) : (
                  <>
                    Create or copy an API key from{' '}
                    <a
                      href="https://mdblist.com/preferences/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      MDBList Preferences
                    </a>
                    . It remains write-only after saving, so re-enter it when
                    updating this configuration.
                  </>
                )}
              </p>
            </div>
          )}
          {(definition.id === 'tautulli' || definition.id === 'maintainerr') && (
            <>
              <div className="field-grid">
                <div className="field-group">
                  <label htmlFor={`${definition.id}-host`}>Hostname</label>
                  <input id={`${definition.id}-host`} value={hostname} onChange={(e) => setHostname(e.target.value)} required />
                  <p className="field-help">Address reachable from the Vynode server. Do not include a protocol or path.</p>
                </div>
                <div className="field-group">
                  <label htmlFor={`${definition.id}-port`}>Port</label>
                  <input id={`${definition.id}-port`} type="number" inputMode="numeric" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} required />
                  <p className="field-help">Use the service port reachable from Vynode.</p>
                </div>
              </div>
              <label className="check-row compact">
                <input type="checkbox" checked={useSsl} onChange={(e) => setUseSsl(e.target.checked)} />
                <span><strong>Use HTTPS</strong></span>
              </label>
              <div className="field-grid">
                <div className="field-group">
                  <label htmlFor={`${definition.id}-base`}>URL base</label>
                  <input id={`${definition.id}-base`} value={urlBase} onChange={(e) => setUrlBase(e.target.value)} placeholder="/optional-path" />
                  <p className="field-help">Optional reverse-proxy subpath, normalized with one leading slash.</p>
                </div>
                <div className="field-group">
                  <label htmlFor={`${definition.id}-external`}>External URL</label>
                  <input id={`${definition.id}-external`} inputMode="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://service.example.com" />
                  <p className="field-help">Optional browser-facing URL used by Open actions; it does not change the server endpoint.</p>
                </div>
              </div>
              <div className="field-group">
                <label htmlFor={`${definition.id}-key`}>API key</label>
                <input id={`${definition.id}-key`} type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={existing?.secretConfigured ? 'Re-enter to verify changes' : definition.id === 'maintainerr' ? 'Optional; reserved for future Maintainerr authentication' : ''} required={definition.id === 'tautulli'} />
                <p className="field-help">{definition.id === 'maintainerr' ? 'Optional. Maintainerr currently exposes its API without authentication; keep the service on a trusted private network. If a future release enforces its reserved API key, Vynode will send it only to this endpoint.' : 'Required whenever you test changes. It replaces the stored secret only after verification succeeds.'}</p>
              </div>
            </>
          )}
          {status && <p className={`source-feedback ${statusTone}`} role="status">{status}</p>}
          <div className="actions">
            {settingsMode && existing && (
              <button className="button danger" type="button" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </button>
            )}
            <button className="button primary" type="submit" disabled={busy}>
              {busy
                ? definition.id === 'trakt' && oauth
                  ? 'Saving OAuth application…'
                  : 'Testing and saving…'
                : existing
                  ? definition.id === 'trakt' && oauth
                    ? 'Save OAuth app changes'
                    : 'Test and save changes'
                  : definition.id === 'trakt' && oauth
                    ? 'Save OAuth application'
                    : 'Test and save connection'}
            </button>
          </div>
          {confirmDisconnect && (
            <div className="modal-backdrop">
              <section className="folder-modal" role="alertdialog" aria-modal="true" aria-labelledby={`${definition.id}-disconnect-title`}>
                <div className="modal-heading">
                  <div><p className="eyebrow">Confirm disconnect</p><h3 id={`${definition.id}-disconnect-title`}>Disconnect {definition.name}?</h3></div>
                  <button className="icon-button" type="button" aria-label={`Cancel ${definition.name} disconnect`} onClick={() => setConfirmDisconnect(false)}>×</button>
                </div>
                <p>The stored credential will be removed. Existing collection definitions are preserved, but source refreshes and dependent statistics or maintenance workflows will fail until this service is reconnected.</p>
                <div className="actions">
                  <button className="button secondary" type="button" onClick={() => setConfirmDisconnect(false)}>Cancel</button>
                  <button className="button danger" type="button" disabled={busy} onClick={() => void disconnect()}>{busy ? 'Disconnecting…' : `Disconnect ${definition.name}`}</button>
                </div>
              </section>
            </div>
          )}
        </form>
      )}
    </article>
  );
};

export const SourceStage = ({
  busy,
  onComplete,
  settingsMode = false,
}: {
  busy: boolean;
  onComplete(): Promise<void>;
  settingsMode?: boolean;
}) => {
  const [policy, setPolicy] = useState({
    revision: 0,
    letterboxdUsePlainHttp: false,
    flixpatrolUsePlainHttp: false,
  });
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyMessage, setPolicyMessage] = useState('');
  useEffect(() => {
    void api.fetchingPolicy().then(setPolicy);
  }, []);
  const savePolicy = async () => {
    setPolicyBusy(true);
    setPolicyMessage('');
    try {
      setPolicy(
        await api.saveFetchingPolicy(
          policy.revision,
          policy.letterboxdUsePlainHttp,
          policy.flixpatrolUsePlainHttp
        )
      );
      setPolicyMessage('Fetching settings saved.');
    } catch (error) {
      setPolicyMessage(
        error instanceof Error ? error.message : 'Unable to save fetching settings.'
      );
    } finally {
      setPolicyBusy(false);
    }
  };
  return <>
    <div className="info-panel">
      <strong>IMDb, TMDB, and Letterboxd need no credentials</strong>
      <p>They are available automatically. Add only the services you use.</p>
    </div>
    <section className="workflow-section source-policy">
      <div className="workflow-heading">
        <div>
          <h3>Fetching policy</h3>
          <p>Choose the faster direct request method or browser automation for protected pages.</p>
        </div>
      </div>
      <label className="check-row compact">
        <input
          type="checkbox"
          checked={policy.letterboxdUsePlainHttp}
          onChange={(event) =>
            setPolicy({ ...policy, letterboxdUsePlainHttp: event.target.checked })
          }
        />
        <span>
          <strong>Use plain HTTP for Letterboxd</strong>
          <small>Faster direct requests. Turn this off to use browser automation when Cloudflare challenges appear.</small>
        </span>
      </label>
      <label className="check-row compact">
        <input
          type="checkbox"
          checked={policy.flixpatrolUsePlainHttp}
          onChange={(event) =>
            setPolicy({ ...policy, flixpatrolUsePlainHttp: event.target.checked })
          }
        />
        <span>
          <strong>Use plain HTTP for FlixPatrol</strong>
          <small>Faster direct requests. Turn this off to use browser automation when protected pages reject them.</small>
        </span>
      </label>
      <div className="inline-actions">
        <button className="button secondary" disabled={policyBusy} onClick={() => void savePolicy()}>
          {policyBusy ? 'Saving…' : 'Save fetching policy'}
        </button>
        {policyMessage && <span className="source-feedback" role="status">{policyMessage}</span>}
      </div>
    </section>
    <div className="source-list">
      {definitions.map((definition) => (
        <IntegrationEditor key={definition.id} definition={definition} settingsMode={settingsMode} />
      ))}
    </div>
    {!settingsMode && <div className="actions source-stage-actions">
      <button className="button secondary" disabled={busy} onClick={() => void onComplete()}>
        Skip for now
      </button>
      <button className="button primary" disabled={busy} onClick={() => void onComplete()}>
        Continue
      </button>
    </div>}
  </>;
};
