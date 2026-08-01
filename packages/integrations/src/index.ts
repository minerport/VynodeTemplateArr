import { createHash, randomUUID } from 'node:crypto';

export * from './trakt.js';
export * from './trakt-oauth.js';
export * from './myanimelist.js';
export * from './anilist.js';
export * from './mdblist.js';
export * from './tautulli.js';
export * from './maintainerr.js';
export * from './imdb.js';

export type IntegrationId =
  | 'trakt'
  | 'tmdb'
  | 'mdblist'
  | 'myanimelist'
  | 'tautulli'
  | 'maintainerr';

export type IntegrationDraft =
  | {
      id: 'trakt';
      clientId: string;
      clientSecret?: string;
      mode: 'basic' | 'oauth';
    }
  | {
      id: 'mdblist' | 'myanimelist' | 'tmdb';
      apiKey: string;
    }
  | {
      id: 'tautulli';
      hostname: string;
      port: number;
      useSsl: boolean;
      urlBase: string;
      externalUrl?: string;
      apiKey: string;
    }
  | {
      id: 'maintainerr';
      hostname: string;
      port: number;
      useSsl: boolean;
      urlBase: string;
      externalUrl?: string;
      apiKey?: string;
    };

export interface IntegrationConfiguration {
  id: IntegrationId;
  revision: number;
  configured: boolean;
  secretConfigured: boolean;
  values: Record<string, string | number | boolean>;
  verifiedAt: string;
}

export interface StoredIntegration extends IntegrationConfiguration {
  secretReference?: string;
}

export interface IntegrationRepository {
  get(id: IntegrationId): Promise<StoredIntegration | undefined>;
  compareAndSet(
    id: IntegrationId,
    expectedRevision: number,
    next: StoredIntegration
  ): Promise<boolean>;
  delete(id: IntegrationId, expectedRevision: number): Promise<boolean>;
}

export interface IntegrationSecretVault {
  store(secret: string): Promise<string>;
  remove(reference: string): Promise<void>;
}

export interface IntegrationTester {
  test(draft: IntegrationDraft, signal?: AbortSignal): Promise<void>;
}

export class IntegrationConfigurationError extends Error {
  public constructor(
    public readonly code:
      | 'invalid-configuration'
      | 'verification-required'
      | 'verification-expired'
      | 'configuration-conflict',
    message: string
  ) {
    super(message);
  }
}

interface Receipt {
  id: IntegrationId;
  fingerprint: string;
  expiresAt: number;
}

const normalizePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
};

const normalizeExternalUrl = (value?: string): string | undefined => {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error('invalid');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new IntegrationConfigurationError(
      'invalid-configuration',
      'External URL must be a valid HTTP or HTTPS URL.'
    );
  }
};

export const normalizeIntegrationDraft = (
  draft: IntegrationDraft
): IntegrationDraft => {
  if (draft.id === 'trakt') {
    const clientId = draft.clientId.trim();
    const clientSecret = draft.clientSecret?.trim();
    if (!clientId) {
      throw new IntegrationConfigurationError(
        'invalid-configuration',
        'Trakt Client ID is required.'
      );
    }
    return {
      id: draft.id,
      clientId,
      mode: draft.mode,
      ...(clientSecret ? { clientSecret } : {}),
    };
  }
  if (draft.id === 'mdblist' || draft.id === 'myanimelist' || draft.id === 'tmdb') {
    const apiKey = draft.apiKey.trim();
    if (!apiKey) {
      throw new IntegrationConfigurationError(
        'invalid-configuration',
        'API key is required.'
      );
    }
    return { id: draft.id, apiKey };
  }
  if (!('hostname' in draft)) {
    throw new IntegrationConfigurationError(
      'invalid-configuration',
      'Unsupported integration configuration.'
    );
  }
  const hostname = draft.hostname.trim().toLowerCase();
  if (
    !hostname ||
    hostname.includes('://') ||
    hostname.includes('/') ||
    !Number.isInteger(draft.port) ||
    draft.port < 1 ||
    draft.port > 65535 ||
    (draft.id !== 'maintainerr' && !draft.apiKey?.trim())
  ) {
    throw new IntegrationConfigurationError(
      'invalid-configuration',
      draft.id === 'maintainerr'
        ? 'Maintainerr hostname and a port from 1 through 65535 are required.'
        : 'Hostname, a port from 1 through 65535, and API key are required.'
    );
  }
  const externalUrl = normalizeExternalUrl(draft.externalUrl);
  const endpoint = {
    hostname,
    port: draft.port,
    useSsl: draft.useSsl,
    urlBase: normalizePath(draft.urlBase),
    ...(externalUrl ? { externalUrl } : {}),
  };
  if (draft.id === 'tautulli')
    return {
      id: draft.id,
      ...endpoint,
      apiKey: draft.apiKey.trim(),
    };
  return {
    id: draft.id,
    ...endpoint,
    ...(draft.apiKey?.trim() ? { apiKey: draft.apiKey.trim() } : {}),
  };
};

const fingerprint = (draft: IntegrationDraft): string =>
  createHash('sha256')
    .update(JSON.stringify(draft, Object.keys(draft).sort()))
    .digest('hex');

const publicValues = (
  draft: IntegrationDraft
): Record<string, string | number | boolean> => {
  if (draft.id === 'trakt') {
    return { clientId: draft.clientId, mode: draft.mode };
  }
  if (!('hostname' in draft)) return {};
  return {
    hostname: draft.hostname,
    port: draft.port,
    useSsl: draft.useSsl,
    urlBase: draft.urlBase,
    ...(draft.externalUrl ? { externalUrl: draft.externalUrl } : {}),
  };
};

const secretFrom = (draft: IntegrationDraft): string | undefined =>
  draft.id === 'trakt'
    ? draft.clientSecret
    : draft.apiKey;

export class IntegrationConfigurationService {
  private readonly receipts = new Map<string, Receipt>();

  public constructor(
    private readonly repository: IntegrationRepository,
    private readonly vault: IntegrationSecretVault,
    private readonly tester: IntegrationTester,
    private readonly now: () => Date,
    private readonly receiptLifetimeMs = 10 * 60 * 1000
  ) {}

  public async get(
    id: IntegrationId
  ): Promise<IntegrationConfiguration | undefined> {
    const stored = await this.repository.get(id);
    if (!stored) return undefined;
    const { secretReference: _secretReference, ...configuration } = stored;
    return configuration;
  }

  public async test(
    draft: IntegrationDraft,
    signal?: AbortSignal
  ): Promise<{ verificationReceipt: string; expiresAt: string }> {
    const normalized = normalizeIntegrationDraft(draft);
    await this.tester.test(normalized, signal);
    const verificationReceipt = randomUUID();
    const expiresAt = this.now().getTime() + this.receiptLifetimeMs;
    this.receipts.set(verificationReceipt, {
      id: normalized.id,
      fingerprint: fingerprint(normalized),
      expiresAt,
    });
    return {
      verificationReceipt,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  public async save(command: {
    expectedRevision: number;
    draft: IntegrationDraft;
    verificationReceipt: string;
  }): Promise<IntegrationConfiguration> {
    const normalized = normalizeIntegrationDraft(command.draft);
    const receipt = this.receipts.get(command.verificationReceipt);
    if (!receipt || receipt.id !== normalized.id) {
      throw new IntegrationConfigurationError(
        'verification-required',
        'Test this exact configuration before saving.'
      );
    }
    if (receipt.expiresAt < this.now().getTime()) {
      this.receipts.delete(command.verificationReceipt);
      throw new IntegrationConfigurationError(
        'verification-expired',
        'The successful connection test expired; test again.'
      );
    }
    if (receipt.fingerprint !== fingerprint(normalized)) {
      throw new IntegrationConfigurationError(
        'verification-required',
        'The configuration changed after its connection test.'
      );
    }
    const current = await this.repository.get(normalized.id);
    if ((current?.revision ?? 0) !== command.expectedRevision) {
      throw new IntegrationConfigurationError(
        'configuration-conflict',
        'Integration settings changed; reload and retry.'
      );
    }
    const secret = secretFrom(normalized);
    if (
      normalized.id === 'trakt' &&
      normalized.mode === 'oauth' &&
      !secret &&
      !current?.secretReference
    ) {
      throw new IntegrationConfigurationError(
        'invalid-configuration',
        'Trakt OAuth requires a client secret.'
      );
    }
    const retainExistingSecret =
      normalized.id !== 'trakt' || normalized.mode === 'oauth';
    const secretReference = secret
      ? await this.vault.store(secret)
      : retainExistingSecret
        ? current?.secretReference
        : undefined;
    const next: StoredIntegration = {
      id: normalized.id,
      revision: command.expectedRevision + 1,
      configured: true,
      secretConfigured: Boolean(secretReference),
      values: publicValues(normalized),
      verifiedAt: this.now().toISOString(),
      ...(secretReference ? { secretReference } : {}),
    };
    if (
      !(await this.repository.compareAndSet(
        normalized.id,
        command.expectedRevision,
        next
      ))
    ) {
      if (secret && secretReference) await this.vault.remove(secretReference);
      throw new IntegrationConfigurationError(
        'configuration-conflict',
        'Integration settings changed; reload and retry.'
      );
    }
    this.receipts.delete(command.verificationReceipt);
    if (
      current?.secretReference &&
      current.secretReference !== secretReference
    )
      await this.vault.remove(current.secretReference);
    return this.get(normalized.id) as Promise<IntegrationConfiguration>;
  }

  public async disconnect(
    id: IntegrationId,
    expectedRevision: number
  ): Promise<void> {
    const current = await this.repository.get(id);
    if (
      !current ||
      current.revision !== expectedRevision ||
      !(await this.repository.delete(id, expectedRevision))
    ) {
      throw new IntegrationConfigurationError(
        'configuration-conflict',
        'Integration settings changed; reload and retry.'
      );
    }
    if (current.secretReference) await this.vault.remove(current.secretReference);
  }
}
export * from './tmdb.js';
export * from './letterboxd.js';
export * from './flixpatrol.js';
