import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EncryptedSecretVault, VynodeSqliteStorage } from '@vynode/storage';
import { ProductionTraktOAuthRepository } from './production-trakt-oauth.js';

test('encrypts, rotates, reloads, and deletes Trakt OAuth tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-trakt-oauth-'));
  const databasePath = join(directory, 'vynode.sqlite');
  const key = Buffer.alloc(32, 7);
  let storage = new VynodeSqliteStorage(databasePath);
  try {
    let repository = new ProductionTraktOAuthRepository(storage, new EncryptedSecretVault(storage, key));
    await repository.save({ accessToken: 'access-secret-one', refreshToken: 'refresh-secret-one', expiresAt: '2026-08-02T00:00:00.000Z', tokenType: 'bearer' });
    await repository.save({ accessToken: 'access-secret-two', refreshToken: 'refresh-secret-two', expiresAt: '2026-08-03T00:00:00.000Z', scope: 'public', tokenType: 'bearer' });
    assert.equal((await repository.get())?.accessToken, 'access-secret-two');
    storage.close();
    assert.doesNotMatch((await readFile(databasePath)).toString('utf8'), /access-secret|refresh-secret/);
    storage = new VynodeSqliteStorage(databasePath);
    repository = new ProductionTraktOAuthRepository(storage, new EncryptedSecretVault(storage, key));
    assert.equal((await repository.get())?.scope, 'public');
    await repository.delete();
    assert.equal(await repository.get(), undefined);
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
