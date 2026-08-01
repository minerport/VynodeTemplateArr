import {
  nextOnboardingStage,
  onboardingStages,
  type OnboardingStage,
  type OnboardingState,
} from '@vynode/onboarding';
import type {
  PlexConnectionInput,
  PlexConnectionCandidate,
  PlexServerConfiguration,
  PlexTransport,
} from '@vynode/media-servers';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type PlexLoginAttempt } from './api';
import { SourceStage } from './SourceStage';
import { DownloadStage } from './DownloadStage';
import { MainApp } from './MainApp';
import type { AuthenticatedPrincipal } from '@vynode/contracts';
import './styles.css';

const labels: Record<
  OnboardingStage,
  { eyebrow: string; title: string; description: string }
> = {
  deployment: {
    eyebrow: 'Step 1',
    title: 'Check this installation',
    description:
      'Confirm the control plane is healthy before connecting any accounts.',
  },
  owner: {
    eyebrow: 'Step 2',
    title: 'Connect the owner account',
    description:
      'Sign in through Plex. Your Plex token is stored by the server and is never returned to this browser.',
  },
  'media-server': {
    eyebrow: 'Step 3',
    title: 'Choose media servers and libraries',
    description:
      'Choose a discovered Plex connection or enter it manually, then verify the server and its available libraries.',
  },
  sources: {
    eyebrow: 'Step 4 · Optional',
    title: 'Connect metadata sources',
    description:
      'Add the metadata and activity services you use. Each connection is tested before it can be saved.',
  },
  downloads: {
    eyebrow: 'Step 5 · Optional',
    title: 'Configure requests and downloads',
    description:
      'Connect request and download services, then choose profiles, roots, tags, placeholder, and watchlist policies.',
  },
  review: {
    eyebrow: 'Step 6',
    title: 'Review and activate',
    description:
      'Vynode will validate the entire configuration and activate it atomically.',
  },
};

const stageSatisfied = (
  state: OnboardingState,
  stage: OnboardingStage
): boolean =>
  state.completed.includes(stage) ||
  state.skipped.includes(stage as 'sources' | 'downloads');

const SetupStepper = ({ state }: { state: OnboardingState }) => (
  <ol className="stepper" aria-label="Setup progress">
    {onboardingStages.map((stage, index) => {
      const current = state.stage === stage;
      const complete = stageSatisfied(state, stage);
      return (
        <li
          key={stage}
          className={`${current ? 'current' : ''} ${
            complete ? 'complete' : ''
          }`}
          aria-current={current ? 'step' : undefined}
        >
          <span className="step-index" aria-hidden="true">
            {complete ? '✓' : index + 1}
          </span>
          <span>{labels[stage].title}</span>
        </li>
      );
    })}
  </ol>
);

const DeploymentStage = ({
  busy,
  onComplete,
}: {
  busy: boolean;
  onComplete(): Promise<void>;
}) => {
  const [health, setHealth] = useState<
    'checking' | 'healthy' | 'failed'
  >('checking');
  const [message, setMessage] = useState('');

  const check = useCallback(async () => {
    setHealth('checking');
    setMessage('');
    try {
      await api.health();
      setHealth('healthy');
    } catch (error) {
      setHealth('failed');
      setMessage(error instanceof Error ? error.message : 'Health check failed');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <>
      <div className={`status-panel ${health}`}>
        <span className="status-dot" />
        <div>
          <strong>
            {health === 'checking'
              ? 'Checking services…'
              : health === 'healthy'
                ? 'Control plane is ready'
                : 'Control plane needs attention'}
          </strong>
          <p>
            {health === 'healthy'
              ? 'API access and the onboarding service are responding.'
              : message || 'Please wait while the service is checked.'}
          </p>
        </div>
      </div>
      <div className="actions">
        {health === 'failed' && (
          <button className="button secondary" onClick={() => void check()}>
            Check again
          </button>
        )}
        <button
          className="button primary"
          disabled={health !== 'healthy' || busy}
          onClick={() => void onComplete()}
        >
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </>
  );
};

const OwnerStage = ({
  busy,
  onAuthorized,
}: {
  busy: boolean;
  onAuthorized(): Promise<void>;
}) => {
  const [attempt, setAttempt] = useState<PlexLoginAttempt>();
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  const [token, setToken] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  useEffect(() => {
    if (!attempt || attempt.state !== 'pending') return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.pollPlexLogin(attempt.id);
        setAttempt(next);
        if (next.state === 'authorized') {
          window.clearInterval(timer);
          await onAuthorized();
        } else if (next.state !== 'pending') {
          window.clearInterval(timer);
          setError(
            next.state === 'expired'
              ? 'The Plex sign-in request expired. Start a new request.'
              : 'Plex sign-in was not completed.'
          );
        }
      } catch (pollError) {
        window.clearInterval(timer);
        setError(
          pollError instanceof Error
            ? pollError.message
            : 'Unable to check Plex sign-in.'
        );
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [attempt, onAuthorized]);

  const begin = async () => {
    setError('');
    try {
      const next = await api.beginPlexLogin();
      setAttempt(next);
      const popup = window.open(
        next.authorizationUrl,
        'vynode-plex-auth',
        'popup,width=600,height=700'
      );
      if (!popup) {
        setError(
          'Your browser blocked the Plex window. Allow popups and try again.'
        );
        await api.cancelPlexLogin(next.id);
      }
    } catch (beginError) {
      setError(
        beginError instanceof Error
          ? beginError.message
          : 'Unable to start Plex sign-in.'
      );
    }
  };

  const submitManual = async (event: React.FormEvent) => {
    event.preventDefault();
    setManualBusy(true);
    setError('');
    try {
      await api.manualPlexLogin(token);
      setToken('');
      await onAuthorized();
    } catch (manualError) {
      setError(
        manualError instanceof Error
          ? manualError.message
          : 'Plex could not verify that token.'
      );
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <>
      {error && (
        <div className="error-panel" role="alert">
          <strong>Sign-in needs attention</strong>
          <p>{error}</p>
        </div>
      )}
      <div className="account-panel">
        <div className="plex-mark" aria-hidden="true">
          P
        </div>
        <div>
          <strong>Plex account</strong>
          <p>
            {attempt?.state === 'pending'
              ? 'Finish signing in in the Plex window. This page will update automatically.'
              : 'The first connected account becomes the installation owner.'}
          </p>
        </div>
      </div>
      <div className="actions">
        <button
          className="button primary plex"
          disabled={busy || attempt?.state === 'pending'}
          onClick={() => void begin()}
        >
          {attempt?.state === 'pending' ? 'Waiting for Plex…' : 'Continue with Plex'}
        </button>
        {attempt?.state === 'pending' && attempt.authorizationUrl && (
          <>
            <a
              className="button secondary"
              href={attempt.authorizationUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Plex sign-in in a full tab
            </a>
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(attempt.authorizationUrl)
                  .catch(() =>
                    setError(
                      'The sign-in link could not be copied. Open it in a full tab instead.'
                    )
                  )
              }
            >
              Copy Plex sign-in link
            </button>
          </>
        )}
      </div>
      {!manual ? (
        <div className="manual-divider">
          <span>Web sign-in unavailable or prefer a token?</span>
          <button className="text-button" type="button" onClick={() => setManual(true)}>
            Enter a Plex token manually
          </button>
        </div>
      ) : (
        <form className="manual-auth-panel" onSubmit={(event) => void submitManual(event)}>
          <div className="field-group">
            <label htmlFor="plex-token">Plex authentication token</label>
            <p className="field-help">
              This fallback is verified directly with Plex and stored only in the server secret vault. It is never returned to this browser.
            </p>
            <input
              id="plex-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste the Plex token"
              required
            />
          </div>
          <div className="actions">
            <button className="button secondary" type="button" onClick={() => { setManual(false); setToken(''); }}>
              Use Plex Web instead
            </button>
            <button className="button primary" type="submit" disabled={manualBusy || !token.trim()}>
              {manualBusy ? 'Verifying…' : 'Verify token and continue'}
            </button>
          </div>
        </form>
      )}
    </>
  );
};

const AuthenticatedApplication = () => {
  const [principal, setPrincipal] = useState<AuthenticatedPrincipal>();
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const check = useCallback(async () => {
    setChecking(true);
    setSessionError('');
    try {
      setPrincipal(await api.authenticatedPrincipal());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setPrincipal(undefined);
      } else {
        setSessionError(
          error instanceof Error
            ? error.message
            : 'The session service could not be reached.'
        );
      }
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  if (checking) {
    return (
      <main className="center-message" aria-live="polite">
        Checking your session…
      </main>
    );
  }
  if (sessionError) {
    return (
      <main className="login-shell">
        <section className="login-card session-error" role="alert">
          <div className="brand">
            <span className="brand-mark">V</span>
            <span>Vynode</span>
          </div>
          <p className="eyebrow">Connection problem</p>
          <h1>We could not check your session</h1>
          <p>{sessionError}</p>
          <p>
            Your sign-in state has not been changed. Check that the Vynode
            service is running, then try again.
          </p>
          <button
            className="button primary"
            type="button"
            onClick={() => void check()}
          >
            Retry session check
          </button>
        </section>
      </main>
    );
  }
  if (!principal) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand"><span className="brand-mark">V</span><span>Vynode</span></div>
          <p className="eyebrow">Owner sign in</p>
          <h1>Welcome back</h1>
          <p>Sign in with the Plex owner account for this installation. Manual token entry is available only when Plex Web sign-in cannot be completed.</p>
          <OwnerStage busy={false} onAuthorized={check} />
        </section>
      </main>
    );
  }
  return (
    <MainApp
      principal={principal}
      onSignOut={async () => {
        await api.logout();
        setPrincipal(undefined);
      }}
    />
  );
};

const PlexServerStage = ({
  busy,
  onComplete,
}: {
  busy: boolean;
  onComplete(): Promise<void>;
}) => {
  const [existing, setExisting] = useState<PlexServerConfiguration>();
  const [candidates, setCandidates] = useState<
    readonly PlexConnectionCandidate[]
  >([]);
  const [mode, setMode] = useState<
    'discovering' | 'automatic' | 'manual'
  >('discovering');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('32400');
  const [transport, setTransport] = useState<PlexTransport>('http');
  const [webAppUrl, setWebAppUrl] = useState(
    'https://app.plex.tv/desktop'
  );
  const [autoEmptyTrash, setAutoEmptyTrash] = useState(true);

  useEffect(() => {
    void Promise.allSettled([
      api.plexConfiguration(),
      api.plexCandidates(),
    ])
      .then(([configurationResult, candidateResult]) => {
        if (configurationResult.status === 'fulfilled') {
          const configuration = configurationResult.value;
          if (configuration) {
            setExisting(configuration);
            setHost(configuration.host);
            setPort(String(configuration.port));
            setTransport(configuration.transport);
            setWebAppUrl(configuration.webAppUrl ?? '');
            setAutoEmptyTrash(configuration.autoEmptyTrash);
          }
        } else {
          setError(configurationResult.reason instanceof Error
            ? configurationResult.reason.message
            : 'Unable to load Plex settings.');
        }
        if (candidateResult.status === 'fulfilled') {
          setCandidates(candidateResult.value);
          setMode(
            candidateResult.value.some((candidate) => candidate.reachable)
              ? 'automatic'
              : 'manual'
          );
          if (!candidateResult.value.some((candidate) => candidate.reachable)) {
            setError(
              'No reachable Plex server was discovered. Enter the connection manually.'
            );
          }
        } else {
          setMode('manual');
          setError(
            candidateResult.reason instanceof Error
              ? candidateResult.reason.message
              : 'Plex discovery failed. Enter the connection manually.'
          );
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const saveInput = async (input: PlexConnectionInput) => {
    setSaving(true);
    setError('');
    try {
      const configuration = await api.savePlexConfiguration(
        existing?.revision ?? 0,
        input
      );
      setExisting(configuration);
      await onComplete();
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : 'Unable to verify and save the Plex server.';
      if (message.includes('changed; reload and retry')) {
        const refreshed = await api.plexConfiguration().catch(() => undefined);
        setExisting(refreshed);
        setError(
          'Plex settings changed in another session. The latest settings are loaded; verify your choice again.'
        );
        return;
      }
      setError(
        message
      );
    } finally {
      setSaving(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const numericPort = Number(port);
    if (!host.trim()) {
      setError('Enter the Plex server hostname or IP address.');
      return;
    }
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      setError('Port must be an integer from 1 through 65535.');
      return;
    }
    const input: PlexConnectionInput = {
      host,
      port: numericPort,
      transport,
      autoEmptyTrash,
      ...(webAppUrl.trim() ? { webAppUrl } : {}),
    };
    await saveInput(input);
  };

  if (loading) return <p className="inline-loading">Loading Plex settings…</p>;

  if (mode === 'automatic') {
    return (
      <div className="server-discovery">
        {error && (
          <div className="error-panel" role="alert">
            <strong>Plex discovery needs attention</strong>
            <p>{error}</p>
          </div>
        )}
        <div className="discovery-heading">
          <div>
            <strong>Servers from your Plex account</strong>
            <p>
              Reachable local connections are preferred automatically. You can
              choose another connection when needed.
            </p>
          </div>
          <span className="discovery-badge">Plex Web connected</span>
        </div>
        <div className="server-list">
          {candidates.map((candidate) => (
            <article
              className={`server-card ${
                candidate.reachable ? 'reachable' : 'unreachable'
              }`}
              key={candidate.id}
            >
              <div className="server-icon" aria-hidden="true">
                P
              </div>
              <div className="server-details">
                <strong>{candidate.serverName}</strong>
                <span>
                  {candidate.input.host}:{candidate.input.port}
                </span>
                <small>
                  {candidate.local ? 'Local connection' : 'Remote connection'}
                  {candidate.latencyMs !== undefined
                    ? ` · ${candidate.latencyMs} ms`
                    : ''}
                  {!candidate.reachable
                    ? ` · ${candidate.diagnostic ?? 'Unavailable'}`
                    : ''}
                </small>
              </div>
              <button
                className="button secondary"
                disabled={!candidate.reachable || busy || saving}
                onClick={() => void saveInput(candidate.input)}
              >
                {saving ? 'Verifying…' : 'Use this server'}
              </button>
            </article>
          ))}
        </div>
        <div className="manual-divider">
          <span>Can’t find the right server?</span>
          <button
            className="text-button"
            onClick={() => {
              setError('');
              setMode('manual');
            }}
          >
            Enter connection manually
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void save(event)} className="settings-form">
      {error && (
        <div className="error-panel" role="alert">
          <strong>Plex connection needs attention</strong>
          <p>{error}</p>
        </div>
      )}
      <div className="field-group">
        <label htmlFor="plex-host">
          Hostname or IP address <span aria-hidden="true">*</span>
        </label>
        <p className="field-help">
          Enter only the address. The transport is selected separately.
        </p>
        <div className="compound-input">
          <span>{transport === 'http' ? 'http://' : 'https://'}</span>
          <input
            id="plex-host"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="plex.local or 192.168.1.20"
            autoComplete="off"
            required
          />
        </div>
      </div>
      <div className="field-grid">
        <div className="field-group">
          <label htmlFor="plex-port">
            Port <span aria-hidden="true">*</span>
          </label>
          <input
            id="plex-port"
            inputMode="numeric"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            required
          />
        </div>
        <div className="field-group">
          <label htmlFor="plex-transport">Connection security</label>
          <select
            id="plex-transport"
            value={transport}
            onChange={(event) =>
              setTransport(event.target.value as PlexTransport)
            }
          >
            <option value="http">HTTP</option>
            <option value="https-verify">HTTPS — verify certificate</option>
            <option value="https-allow-self-signed">
              HTTPS — allow self-signed certificate
            </option>
          </select>
        </div>
      </div>
      <div className="field-group">
        <label htmlFor="plex-web-url">Plex Web URL</label>
        <p className="field-help">
          Used for links that open an item in Plex Web.
        </p>
        <input
          id="plex-web-url"
          inputMode="url"
          value={webAppUrl}
          onChange={(event) => setWebAppUrl(event.target.value)}
          placeholder="https://app.plex.tv/desktop"
        />
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={autoEmptyTrash}
          onChange={(event) => setAutoEmptyTrash(event.target.checked)}
        />
        <span>
          <strong>Automatically empty Plex trash</strong>
          <small>
            Allows placeholder cleanup to remove stale Plex entries. This can
            permanently remove unavailable metadata.
          </small>
        </span>
      </label>
      {existing && (
        <div className="verified-panel">
          <strong>{existing.name}</strong>
          <span>
            Verified · {existing.libraries.filter((library) => library.available).length}{' '}
            libraries found
          </span>
        </div>
      )}
      <div className="actions">
        {candidates.some((candidate) => candidate.reachable) && (
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setError('');
              setMode('automatic');
            }}
          >
            Back to discovered servers
          </button>
        )}
        <button
          className="button primary"
          type="submit"
          disabled={busy || saving}
        >
          {saving ? 'Testing connection…' : 'Verify, save, and continue'}
        </button>
      </div>
    </form>
  );
};

type ReviewData = {
  health: { status: 'ok'; checkedAt: string };
  plex: Awaited<ReturnType<typeof api.plexConfiguration>>;
  integrations: Array<NonNullable<Awaited<ReturnType<typeof api.integration>>>>;
  radarr: Awaited<ReturnType<typeof api.downloadServices>>;
  sonarr: Awaited<ReturnType<typeof api.downloadServices>>;
  seerr: Awaited<ReturnType<typeof api.seerr>>;
  placeholders: Awaited<ReturnType<typeof api.placeholders>>;
  watchlists: Awaited<ReturnType<typeof api.watchlists>>;
};

const ReviewStage = ({
  state,
  busy,
  onNavigate,
  onActivate,
}: {
  state: OnboardingState;
  busy: boolean;
  onNavigate(stage: OnboardingState['stage']): Promise<void>;
  onActivate(): Promise<void>;
}) => {
  const [data, setData] = useState<ReviewData>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const integrationIds = ['trakt', 'mdblist', 'myanimelist', 'tautulli', 'maintainerr'] as const;
  const load = async () => {
    setLoading(true);
    setMessage('Validating every setup section…');
    try {
      const [health, plex, integrations, radarr, sonarr, seerr, placeholders, watchlists] = await Promise.all([
        api.health(),
        api.plexConfiguration(),
        Promise.all(integrationIds.map((id) => api.integration(id))),
        api.downloadServices('radarr'),
        api.downloadServices('sonarr'),
        api.seerr(),
        api.placeholders(),
        api.watchlists(),
      ]);
      setData({
        health,
        plex,
        integrations: integrations.filter((item): item is NonNullable<typeof item> => Boolean(item)),
        radarr,
        sonarr,
        seerr,
        placeholders,
        watchlists,
      });
      setMessage('');
    } catch (error) {
      setData(undefined);
      setMessage(error instanceof Error ? error.message : 'Unable to validate setup.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const blocking = [
    ...(!data?.plex ? ['A verified Plex server is required before activation.'] : []),
    ...(data?.health.status !== 'ok' ? ['The Vynode control plane is not healthy.'] : []),
  ];
  const warnings = data ? [
    ...(state.skipped.includes('sources') || data.integrations.length === 0
      ? ['No metadata source is connected. Collections that require provider data will remain unavailable.']
      : []),
    ...(state.skipped.includes('downloads') || (data.radarr.length === 0 && data.sonarr.length === 0)
      ? ['No Radarr or Sonarr server is configured. Download and missing-media actions will be unavailable.']
      : []),
    ...(!data.radarr.some((item) => item.selection.isDefault && !item.selection.is4k)
      ? ['No default standard Radarr server is selected.']
      : []),
    ...(!data.sonarr.some((item) => item.selection.isDefault && !item.selection.is4k)
      ? ['No default standard Sonarr server is selected.']
      : []),
    ...(data.watchlists.enableOwner || data.watchlists.enableUsers
      ? []
      : ['Plex watchlist synchronization is disabled.']),
  ] : [];
  if (state.activatedAt) {
    return (
      <div className="activation-success" role="status">
        <span className="success-mark" aria-hidden="true">✓</span>
        <h3>Vynode is ready</h3>
        <p>Setup was activated on {new Date(state.activatedAt).toLocaleString()}. You can review these settings later from the application settings pages.</p>
        <a className="button primary" href="/">Open Vynode</a>
      </div>
    );
  }
  return (
    <div className="review-stage">
      <div className="review-toolbar">
        <div><strong>Configuration validation</strong><p className="field-help">Secrets are never shown here. “Configured” confirms only that an encrypted credential reference exists.</p></div>
        <button className="button secondary" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Validating…' : 'Run validation again'}</button>
      </div>
      {message && <div className="error-panel" role="alert"><strong>Validation could not finish</strong><p>{message}</p></div>}
      {data && (
        <>
          <section className="review-group">
            <div className="review-heading"><div><span>1</span><h3>Installation</h3></div><button className="text-button" onClick={() => void onNavigate('deployment')}>Edit installation</button></div>
            <dl><div><dt>Control plane</dt><dd className="review-good">Healthy</dd></div><div><dt>Checked</dt><dd>{new Date(data.health.checkedAt).toLocaleString()}</dd></div></dl>
          </section>
          <section className="review-group">
            <div className="review-heading"><div><span>2–3</span><h3>Plex owner and server</h3></div><button className="text-button" onClick={() => void onNavigate('media-server')}>Edit Plex server</button></div>
            <dl>
              <div><dt>Owner account</dt><dd className="review-good">Connected · token configured</dd></div>
              <div><dt>Server</dt><dd>{data.plex ? `${data.plex.name} · ${data.plex.host}:${data.plex.port}` : 'Not configured'}</dd></div>
              <div><dt>Connection security</dt><dd>{data.plex?.transport ?? 'Not configured'}</dd></div>
              <div><dt>Libraries</dt><dd>{data.plex ? `${data.plex.libraries.filter((library) => library.available).length} available` : 'None'}</dd></div>
            </dl>
          </section>
          <section className="review-group">
            <div className="review-heading"><div><span>4</span><h3>Metadata sources</h3></div><button className="text-button" onClick={() => void onNavigate('sources')}>Edit sources</button></div>
            {data.integrations.length ? <ul className="review-list">{data.integrations.map((item) => <li key={item.id}><strong>{item.id}</strong><span>Verified {new Date(item.verifiedAt).toLocaleString()}</span><em>{item.secretConfigured ? 'Credential configured' : 'No secret required'}</em></li>)}</ul> : <p className="empty-state">Optional step skipped · no metadata source credentials configured.</p>}
          </section>
          <section className="review-group">
            <div className="review-heading"><div><span>5</span><h3>Requests and downloads</h3></div><button className="text-button" onClick={() => void onNavigate('downloads')}>Edit downloads</button></div>
            <dl>
              <div><dt>Seerr</dt><dd>{data.seerr ? `${data.seerr.endpoint.hostname}:${data.seerr.endpoint.port} · credential configured` : 'Not configured'}</dd></div>
              <div><dt>Radarr</dt><dd>{data.radarr.length ? `${data.radarr.length} server${data.radarr.length === 1 ? '' : 's'}` : 'None'}</dd></div>
              <div><dt>Sonarr</dt><dd>{data.sonarr.length ? `${data.sonarr.length} server${data.sonarr.length === 1 ? '' : 's'}` : 'None'}</dd></div>
              <div><dt>Placeholder folders</dt><dd>{Object.keys(data.placeholders.libraryRoots).length} mapped</dd></div>
              <div><dt>Watchlists</dt><dd>{data.watchlists.enableOwner || data.watchlists.enableUsers ? 'Enabled' : 'Disabled'}</dd></div>
            </dl>
          </section>
          {blocking.length > 0 && <div className="review-findings blocking" role="alert"><strong>Activation blocked</strong><ul>{blocking.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {warnings.length > 0 && <div className="review-findings warning"><strong>Review these optional capabilities</strong><ul>{warnings.map((item) => <li key={item}>{item}</li>)}</ul><p>Warnings do not block activation; you can configure these capabilities later.</p></div>}
          <label className="check-row compact acknowledgement"><input type="checkbox" required form="activation-form" /><span><strong>I reviewed this configuration</strong><small>Activation locks first-run setup and opens the main Vynode application.</small></span></label>
          <form id="activation-form" onSubmit={(event) => { event.preventDefault(); void onActivate(); }}>
            <div className="actions"><button className="button secondary" type="button" disabled={busy} onClick={() => void onNavigate('downloads')}>Back to downloads</button><button className="button primary" type="submit" disabled={busy || loading || blocking.length > 0}>{busy ? 'Activating Vynode…' : 'Activate Vynode'}</button></div>
          </form>
        </>
      )}
    </div>
  );
};

export const App = () => {
  const [state, setState] = useState<OnboardingState>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await api.onboarding());
      setError('');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load setup.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completeAndAdvance = useCallback(async () => {
    if (!state) return;
    setBusy(true);
    try {
      let next = await api.onboardingEvent(state.revision, {
        type: 'complete',
        stage: state.stage,
      });
      const stage = nextOnboardingStage(next);
      if (stage) {
        next = await api.onboardingEvent(next.revision, {
          type: 'navigate',
          stage,
        });
      }
      setState(next);
      setError('');
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to save setup progress.'
      );
      await load();
    } finally {
      setBusy(false);
    }
  }, [load, state]);

  const navigateToStage = useCallback(async (stage: OnboardingState['stage']) => {
    if (!state) return;
    setBusy(true);
    try {
      setState(await api.onboardingEvent(state.revision, { type: 'navigate', stage }));
      setError('');
    } catch (navigationError) {
      setError(navigationError instanceof Error ? navigationError.message : 'Unable to open that setup section.');
      await load();
    } finally {
      setBusy(false);
    }
  }, [load, state]);

  const activate = useCallback(async () => {
    if (!state) return;
    setBusy(true);
    try {
      let next = state;
      if (!next.completed.includes('review')) {
        next = await api.onboardingEvent(next.revision, { type: 'complete', stage: 'review' });
      }
      next = await api.onboardingEvent(next.revision, {
        type: 'activate',
        activatedAt: new Date().toISOString(),
      });
      setState(next);
      setError('');
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : 'Activation failed. No setup settings were changed.');
      await load();
    } finally {
      setBusy(false);
    }
  }, [load, state]);

  if (loading) {
    return <main className="center-message">Loading setup…</main>;
  }
  if (!state) {
    return (
      <main className="center-message">
        <h1>Setup is unavailable</h1>
        <p>{error}</p>
        <button className="button primary" onClick={() => void load()}>
          Try again
        </button>
      </main>
    );
  }
  if (state.activatedAt) {
    return <AuthenticatedApplication />;
  }

  const copy = labels[state.stage];
  return (
    <main className="setup-shell">
      <aside className="setup-sidebar">
        <a href="/" className="brand" aria-label="Vynode home">
          <span className="brand-mark">V</span>
          <span>Vynode</span>
        </a>
        <div>
          <p className="sidebar-kicker">First-run setup</p>
          <h1>Build your media command center.</h1>
          <p className="sidebar-copy">
            Configure the essentials now. Every choice can be reviewed before
            activation.
          </p>
        </div>
        <SetupStepper state={state} />
        <p className="resume-note">
          Progress is saved automatically. You can safely close this page and
          return later.
        </p>
      </aside>
      <section className="setup-content">
        <div className="stage-card">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p className="stage-description">{copy.description}</p>
          {error && (
            <div className="error-panel" role="alert">
              <strong>We could not save that change</strong>
              <p>{error}</p>
            </div>
          )}
          {state.stage === 'deployment' && (
            <DeploymentStage busy={busy} onComplete={completeAndAdvance} />
          )}
          {state.stage === 'owner' && (
            <OwnerStage busy={busy} onAuthorized={completeAndAdvance} />
          )}
          {state.stage === 'media-server' && (
            <PlexServerStage busy={busy} onComplete={completeAndAdvance} />
          )}
          {state.stage === 'sources' && (
            <SourceStage busy={busy} onComplete={completeAndAdvance} />
          )}
          {state.stage === 'downloads' && (
            <DownloadStage busy={busy} onComplete={completeAndAdvance} />
          )}
          {state.stage === 'review' && (
            <ReviewStage
              state={state}
              busy={busy}
              onNavigate={navigateToStage}
              onActivate={activate}
            />
          )}
        </div>
      </section>
    </main>
  );
};
