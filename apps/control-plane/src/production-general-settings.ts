import type {
  AuthenticatedPrincipal,
  GeneralSettings,
  GeneralSettingsDraft,
} from '@vynode/contracts';
import {
  SqliteJsonRepository,
  type VynodeSqliteStorage,
} from '@vynode/storage';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

interface StoredGeneralSettings extends GeneralSettings {
  apiKeyHash: string;
}

const hash = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest();
const publicValue = (record: {
  revision: number;
  updatedAt: string;
  value: StoredGeneralSettings;
}): GeneralSettings => {
  const { apiKeyHash: _secret, ...value } = record.value;
  return {
    ...value,
    globalExcludedTitles: value.globalExcludedTitles ?? [],
    revision: record.revision,
    updatedAt: record.updatedAt,
  };
};

export class ProductionGeneralSettings {
  readonly #repository: SqliteJsonRepository<StoredGeneralSettings>;
  readonly #cacheDirectory: string;
  public constructor(
    storage: VynodeSqliteStorage,
    publicUrl: string,
    dataDirectory: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.#repository = new SqliteJsonRepository(storage, 'general-settings');
    this.#cacheDirectory = join(dataDirectory, 'cache', 'images');
    if (!this.#repository.get('general')) {
      const key = randomBytes(32).toString('base64url');
      this.#repository.put(
        'general',
        {
          revision: 0,
          applicationTitle: 'Vynode',
          applicationUrl: publicUrl,
          locale: 'en-US',
          cacheImages: true,
          imageCacheDays: 30,
          globalExcludedTitles: [],
          apiKeyPreview: `${key.slice(0, 6)}…${key.slice(-4)}`,
          cacheItemCount: 0,
          cacheSizeBytes: 0,
          updatedAt: this.now().toISOString(),
          apiKeyHash: hash(key).toString('hex'),
        },
        undefined,
        this.now()
      );
    }
  }
  public async get(): Promise<GeneralSettings> {
    return publicValue(this.#repository.get('general')!);
  }
  public async save(
    expectedRevision: number,
    draft: GeneralSettingsDraft
  ): Promise<GeneralSettings | undefined> {
    const current = this.#repository.get('general')!;
    if (current.revision !== expectedRevision) return undefined;
    const value: StoredGeneralSettings = {
      ...current.value,
      applicationTitle: draft.applicationTitle.trim(),
      applicationUrl: draft.applicationUrl.trim(),
      locale: draft.locale.trim(),
      cacheImages: draft.cacheImages,
      imageCacheDays: draft.imageCacheDays,
      globalExcludedTitles: [
        ...new Set(
          (
            draft.globalExcludedTitles ??
            current.value.globalExcludedTitles ??
            []
          )
            .map((title) => title.trim())
            .filter(Boolean)
        ),
      ],
      revision: expectedRevision + 1,
      updatedAt: this.now().toISOString(),
    };
    try {
      return publicValue(
        this.#repository.put('general', value, expectedRevision, this.now())
      );
    } catch {
      return undefined;
    }
  }
  public async regenerateApiKey(): Promise<GeneralSettings> {
    const key = randomBytes(32).toString('base64url');
    const current = this.#repository.get('general')!;
    const stored = this.#repository.put(
      'general',
      {
        ...current.value,
        revision: current.revision + 1,
        updatedAt: this.now().toISOString(),
        apiKeyPreview: `${key.slice(0, 6)}…${key.slice(-4)}`,
        apiKeyHash: hash(key).toString('hex'),
      },
      current.revision,
      this.now()
    );
    return { ...publicValue(stored), issuedApiKey: key };
  }
  public async clearImageCache(): Promise<GeneralSettings> {
    await rm(this.#cacheDirectory, { recursive: true, force: true });
    await mkdir(this.#cacheDirectory, { recursive: true });
    const current = this.#repository.get('general')!;
    return publicValue(
      this.#repository.put(
        'general',
        {
          ...current.value,
          revision: current.revision + 1,
          updatedAt: this.now().toISOString(),
          cacheItemCount: 0,
          cacheSizeBytes: 0,
        },
        current.revision,
        this.now()
      )
    );
  }
  public async authenticate(
    value: string
  ): Promise<AuthenticatedPrincipal | undefined> {
    if (!value) return undefined;
    const expected = Buffer.from(
      this.#repository.get('general')!.value.apiKeyHash,
      'hex'
    );
    const actual = hash(value);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return undefined;
    return {
      userId: 'api-key',
      role: 'administrator',
      mediaServerScopes: [],
      sessionId: 'api-key',
    };
  }
}
