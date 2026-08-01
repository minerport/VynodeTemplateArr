import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EncryptedSecretVault, SqliteAuditLog, SqliteIdentityRepository, SqliteJsonRepository, SqliteSessionRepository, VynodeSqliteStorage } from './index.js';

test('applies migrations once and persists versioned JSON across restarts', async () => {
  const dir=await mkdtemp(join(tmpdir(),'vynode-storage-')); const path=join(dir,'vynode.db');
  try { const first=new VynodeSqliteStorage(path); assert.deepEqual(first.migrationVersions(),[1,2]); const repo=new SqliteJsonRepository<{enabled:boolean}>(first,'settings'); assert.equal(repo.put('general',{enabled:true}).revision,1); assert.throws(()=>repo.put('general',{enabled:false},0),/changed/); first.close(); const second=new VynodeSqliteStorage(path); assert.deepEqual(new SqliteJsonRepository<{enabled:boolean}>(second,'settings').get('general')?.value,{enabled:true}); assert.deepEqual(second.migrationVersions(),[1,2]); second.close(); } finally { await rm(dir,{recursive:true,force:true}); }
});

test('encrypts secrets at rest and rejects the wrong master key', async () => {
  const dir=await mkdtemp(join(tmpdir(),'vynode-storage-')); const path=join(dir,'vynode.db');
  try { const storage=new VynodeSqliteStorage(path); const vault=new EncryptedSecretVault(storage,Buffer.alloc(32,7)); vault.set('plex-token','plain-secret-value'); assert.equal(vault.get('plex-token'),'plain-secret-value'); storage.close(); assert.doesNotMatch((await readFile(path)).toString('latin1'),/plain-secret-value/); const reopened=new VynodeSqliteStorage(path); assert.throws(()=>new EncryptedSecretVault(reopened,Buffer.alloc(32,8)).get('plex-token'),/could not be decrypted/); reopened.close(); } finally { await rm(dir,{recursive:true,force:true}); }
});

test('records bounded structured audit history', async () => {
  const dir=await mkdtemp(join(tmpdir(),'vynode-storage-'));
  try { const storage=new VynodeSqliteStorage(join(dir,'vynode.db')); const audit=new SqliteAuditLog(storage); audit.append({actorId:'owner',action:'collection.sync',target:'collection:1',outcome:'success',details:{applied:2}}); assert.deepEqual(audit.recent(1)[0]?.details,{applied:2}); storage.close(); } finally { await rm(dir,{recursive:true,force:true}); }
});

test('stores only session hashes and supports rotation, expiry, and revocation', async () => {
  const dir=await mkdtemp(join(tmpdir(),'vynode-storage-')); const path=join(dir,'vynode.db');
  let now=new Date('2026-01-01T00:00:00.000Z');
  try { const storage=new VynodeSqliteStorage(path); const sessions=new SqliteSessionRepository(storage,async()=>({role:'owner',mediaServerScopes:['plex-one']}),60_000,()=>now); const first=await sessions.rotateForUser(undefined,'owner'); assert.equal((await sessions.resolve(first.sessionId))?.role,'owner'); assert.doesNotMatch((await readFile(path)).toString('latin1'),new RegExp(first.sessionId)); const second=await sessions.rotateForUser(first.sessionId,'owner'); assert.equal(await sessions.resolve(first.sessionId),undefined); assert.equal((await sessions.resolve(second.sessionId))?.sessionId,second.sessionId); await sessions.revoke(second.sessionId); assert.equal(await sessions.resolve(second.sessionId),undefined); const expiring=await sessions.rotateForUser(undefined,'owner'); now=new Date('2026-01-01T00:02:00.000Z'); assert.equal(await sessions.resolve(expiring.sessionId),undefined); assert.ok(sessions.cleanupExpired()>=3); storage.close(); } finally { await rm(dir,{recursive:true,force:true}); }
});

test('persists identities, enforces one owner, and supports nested session rotation', async () => {
  const dir=await mkdtemp(join(tmpdir(),'vynode-identities-')); const path=join(dir,'vynode.db');
  try {
    const storage=new VynodeSqliteStorage(path); const identities=new SqliteIdentityRepository(storage);
    await identities.transaction(async()=>{
      await identities.save({id:'owner',role:'owner',plexAccountId:'plex-owner',verifiedEmail:'OWNER@EXAMPLE.COM',plexUsername:'owner',hasPlexPass:true,tokenReference:'owner-token',mediaServerScopes:['primary']});
      const sessions=new SqliteSessionRepository(storage,(id)=>identities.principalForUser(id));
      const session=await sessions.rotateForUser(undefined,'owner');
      assert.equal((await sessions.resolve(session.sessionId))?.role,'owner');
    });
    assert.equal((await identities.findByPlexAccountId('plex-owner'))?.verifiedEmail,'owner@example.com');
    await assert.rejects(()=>identities.save({id:'other',role:'owner',plexAccountId:'plex-other',verifiedEmail:'other@example.com',plexUsername:'other',hasPlexPass:false,tokenReference:'other-token'}));
    storage.close();
    const reopened=new VynodeSqliteStorage(path); assert.equal(await new SqliteIdentityRepository(reopened).count(),1); reopened.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});
