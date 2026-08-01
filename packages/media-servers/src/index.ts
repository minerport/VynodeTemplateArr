import { isIP } from 'node:net';

export * from './plex-discovery.js';
export * from './plex-http.js';
export * from './plex-discovery-file.js';
export * from './plex-synchronization.js';
export * from './plex-production.js';
export * from './plex-assets.js';
export * from './collection-poster-assets.js';
export * from './plex-collection-poster-inputs.js';
export * from './plex-managed-collections.js';
export * from './plex-person-collections.js';
export * from './plex-library-generators.js';
export * from './managed-collection-synchronization.js';
export * from './plex-checkpoints-file.js';
export * from './missing-collection-members.js';
export * from './plex-connection.js';

export type PlexTransport =
  | 'http'
  | 'https-verify'
  | 'https-allow-self-signed';

export interface PlexConnectionInput {
  host: string;
  port: number;
  transport: PlexTransport;
  webAppUrl?: string;
  autoEmptyTrash: boolean;
}

export interface PlexLibrary {
  key: string;
  title: string;
  type: 'movie' | 'show' | 'artist' | 'photo' | 'unknown';
  language?: string;
  agent?: string;
  scanner?: string;
  locations: readonly string[];
  available: boolean;
  observedAt: string;
}

export interface PlexServerConfiguration extends PlexConnectionInput {
  revision: number;
  machineIdentifier: string;
  name: string;
  libraries: readonly PlexLibrary[];
  verifiedAt: string;
}

export interface PlexServerObservation {
  machineIdentifier: string;
  name: string;
  libraries: readonly Omit<PlexLibrary, 'available' | 'observedAt'>[];
}

export interface PlexConnectionCandidate {
  id: string;
  serverName: string;
  machineIdentifier: string;
  input: PlexConnectionInput;
  local: boolean;
  reachable: boolean;
  latencyMs?: number;
  diagnostic?: string;
}

export interface PlexServerDirectory {
  discover(
    plexTokenReference: string,
    signal?: AbortSignal
  ): Promise<readonly PlexConnectionCandidate[]>;
}

export interface PlexServerProbe {
  observe(
    input: PlexConnectionInput,
    plexTokenReference: string,
    signal?: AbortSignal
  ): Promise<PlexServerObservation>;
}

export interface PlexServerRepository {
  get(): Promise<PlexServerConfiguration | undefined>;
  compareAndSet(
    expectedRevision: number,
    next: PlexServerConfiguration
  ): Promise<boolean>;
}

export interface SavePlexServerCommand {
  expectedRevision: number;
  input: PlexConnectionInput;
  plexTokenReference: string;
  confirmMachineChange: boolean;
  now: string;
}

export class PlexConfigurationError extends Error {
  public constructor(
    public readonly code:
      | 'invalid-host'
      | 'invalid-port'
      | 'invalid-web-url'
      | 'machine-change-confirmation-required'
      | 'configuration-conflict',
    message: string
  ) {
    super(message);
  }
}

const hostnamePattern =
  /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i;

const normalizeHost = (value: string): string => {
  const trimmed = value.trim();
  const unwrapped =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1)
      : trimmed;
  if (
    !unwrapped ||
    unwrapped.includes('/') ||
    unwrapped.includes('@') ||
    unwrapped.includes('?') ||
    unwrapped.includes('#') ||
    unwrapped.includes('://') ||
    (isIP(unwrapped) === 0 && !hostnamePattern.test(unwrapped))
  ) {
    throw new PlexConfigurationError(
      'invalid-host',
      'Enter a DNS name or IP address without a scheme or path.'
    );
  }
  return unwrapped.toLowerCase();
};

const normalizeWebAppUrl = (value: string | undefined): string | undefined => {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error('unsupported URL');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new PlexConfigurationError(
      'invalid-web-url',
      'Enter a valid HTTP or HTTPS Plex Web URL.'
    );
  }
};

export const validatePlexConnection = (
  input: PlexConnectionInput
): PlexConnectionInput => {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new PlexConfigurationError(
      'invalid-port',
      'Port must be an integer from 1 through 65535.'
    );
  }
  const webAppUrl = normalizeWebAppUrl(input.webAppUrl);
  return {
    host: normalizeHost(input.host),
    port: input.port,
    transport: input.transport,
    autoEmptyTrash: input.autoEmptyTrash,
    ...(webAppUrl ? { webAppUrl } : {}),
  };
};

export class PlexServerConfigurationService {
  public constructor(
    private readonly repository: PlexServerRepository,
    private readonly probe: PlexServerProbe
  ) {}

  public get(): Promise<PlexServerConfiguration | undefined> {
    return this.repository.get();
  }

  public async save(
    command: SavePlexServerCommand,
    signal?: AbortSignal
  ): Promise<PlexServerConfiguration> {
    const current = await this.repository.get();
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== command.expectedRevision) {
      throw new PlexConfigurationError(
        'configuration-conflict',
        'Plex settings changed; reload and retry.'
      );
    }

    const input = validatePlexConnection(command.input);
    const observation = await this.probe.observe(
      input,
      command.plexTokenReference,
      signal
    );
    if (
      current?.machineIdentifier &&
      current.machineIdentifier !== observation.machineIdentifier &&
      !command.confirmMachineChange
    ) {
      throw new PlexConfigurationError(
        'machine-change-confirmation-required',
        `The connection points to a different Plex server: ${observation.name}.`
      );
    }

    const observedKeys = new Set(
      observation.libraries.map((library) => library.key)
    );
    const unavailable = (current?.libraries ?? [])
      .filter((library) => !observedKeys.has(library.key))
      .map((library) => ({
        ...library,
        available: false,
        observedAt: command.now,
      }));
    const next: PlexServerConfiguration = {
      ...input,
      revision: currentRevision + 1,
      machineIdentifier: observation.machineIdentifier,
      name: observation.name,
      libraries: [
        ...observation.libraries.map((library) => ({
          ...library,
          available: true,
          observedAt: command.now,
        })),
        ...unavailable,
      ],
      verifiedAt: command.now,
    };

    if (!(await this.repository.compareAndSet(currentRevision, next))) {
      throw new PlexConfigurationError(
        'configuration-conflict',
        'Plex settings changed; reload and retry.'
      );
    }
    return next;
  }
}
