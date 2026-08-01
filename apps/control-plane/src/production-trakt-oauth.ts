import type { TraktOAuthRepository, TraktOAuthTokens } from '@vynode/integrations';
import { EncryptedSecretVault, SqliteJsonRepository, type VynodeSqliteStorage } from '@vynode/storage';

interface StoredTraktTokens {
  accessTokenReference: string;
  refreshTokenReference: string;
  expiresAt: string;
  scope?: string;
  tokenType: string;
}

export class ProductionTraktOAuthRepository implements TraktOAuthRepository {
  readonly #values: SqliteJsonRepository<StoredTraktTokens>;
  public constructor(storage: VynodeSqliteStorage, private readonly secrets: EncryptedSecretVault) {
    this.#values = new SqliteJsonRepository(storage, 'trakt-oauth');
  }
  public async get(): Promise<TraktOAuthTokens | undefined> {
    const stored = this.#values.get('tokens')?.value;
    if (!stored) return undefined;
    const accessToken = this.secrets.get(stored.accessTokenReference);
    const refreshToken = this.secrets.get(stored.refreshTokenReference);
    if (!accessToken || !refreshToken) throw new Error('Stored Trakt authorization is incomplete. Reconnect Trakt.');
    return { accessToken, refreshToken, expiresAt: stored.expiresAt, ...(stored.scope ? { scope: stored.scope } : {}), tokenType: stored.tokenType };
  }
  public async save(tokens: TraktOAuthTokens): Promise<void> {
    const previous = this.#values.get('tokens');
    const accessTokenReference = await this.secrets.store(tokens.accessToken);
    const refreshTokenReference = await this.secrets.store(tokens.refreshToken);
    try {
      this.#values.put('tokens', { accessTokenReference, refreshTokenReference, expiresAt: tokens.expiresAt, ...(tokens.scope ? { scope: tokens.scope } : {}), tokenType: tokens.tokenType }, previous?.revision ?? 0);
    } catch (error) {
      this.secrets.delete(accessTokenReference); this.secrets.delete(refreshTokenReference); throw error;
    }
    if (previous) { this.secrets.delete(previous.value.accessTokenReference); this.secrets.delete(previous.value.refreshTokenReference); }
  }
  public async delete(): Promise<void> {
    const previous = this.#values.get('tokens');
    if (!previous) return;
    if (this.#values.delete('tokens')) { this.secrets.delete(previous.value.accessTokenReference); this.secrets.delete(previous.value.refreshTokenReference); }
  }
}
