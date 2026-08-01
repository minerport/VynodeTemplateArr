import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProductionRuntime } from './production-runtime.js';

test('creates one production runtime with encrypted secrets, identities, sessions, and audit', async () => {
  const directory=await mkdtemp(join(tmpdir(),'vynode-runtime-'));
  try {
    const runtime=await createProductionRuntime({VYNODE_DATA_DIR:directory,VYNODE_PUBLIC_URL:'http://127.0.0.1:7171',VYNODE_MASTER_KEY:Buffer.alloc(32,4).toString('base64')});
    runtime.secrets.set('plex','token'); assert.equal(runtime.secrets.get('plex'),'token');
    await runtime.identities.save({id:'owner',role:'owner',plexAccountId:'plex-1',verifiedEmail:'owner@example.com',plexUsername:'owner',hasPlexPass:true,tokenReference:'plex',mediaServerScopes:['server-1']});
    const session=await runtime.sessions.rotateForUser(undefined,'owner');
    assert.deepEqual(await runtime.sessions.resolve(session.sessionId),{userId:'owner',role:'owner',mediaServerScopes:['server-1'],sessionId:session.sessionId});
    assert.equal(runtime.audit.recent(1)[0]?.action,'runtime.start'); runtime.close();
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('bootstraps the first authorized Plex account as the durable owner', async () => {
  const directory=await mkdtemp(join(tmpdir(),'vynode-owner-'));
  try {
    const fetch:typeof globalThis.fetch=async()=>Response.json({id:10,email:'OWNER@example.com',username:'owner',subscription:{active:true}});
    const runtime=await createProductionRuntime({VYNODE_DATA_DIR:directory,VYNODE_PUBLIC_URL:'http://127.0.0.1:7171',VYNODE_MASTER_KEY:Buffer.alloc(32,5).toString('base64')},{fetch});
    const result=await runtime.plexLogin.signInWithToken('owner-secret');
    const identity=await runtime.identities.findById('owner');
    assert.equal(identity?.role,'owner');
    assert.equal(identity?.verifiedEmail,'owner@example.com');
    assert.equal(runtime.secrets.get(identity!.tokenReference),'owner-secret');
    assert.equal((await runtime.sessions.resolve(result.session.sessionId))?.userId,'owner');
    const installationId=runtime.installationId; runtime.close();
    const reopened=await createProductionRuntime({VYNODE_DATA_DIR:directory,VYNODE_PUBLIC_URL:'http://127.0.0.1:7171',VYNODE_MASTER_KEY:Buffer.alloc(32,5).toString('base64')},{fetch}); assert.equal(reopened.installationId,installationId); reopened.close();
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('tests and durably stores encrypted TMDB integration settings',async()=>{const directory=await mkdtemp(join(tmpdir(),'vynode-tmdb-'));try{const runtime=await createProductionRuntime({VYNODE_DATA_DIR:directory,VYNODE_PUBLIC_URL:'http://127.0.0.1:7171',VYNODE_MASTER_KEY:Buffer.alloc(32,9).toString('base64')},{fetch:async()=>Response.json({results:[{id:1,title:'Movie'}],total_pages:1})});const receipt=await runtime.integrations.test({id:'tmdb',apiKey:'tmdb-secret'});const saved=await runtime.integrations.save({expectedRevision:0,draft:{id:'tmdb',apiKey:'tmdb-secret'},verificationReceipt:receipt.verificationReceipt});assert.equal(saved.secretConfigured,true);assert.deepEqual(saved.values,{});runtime.close();}finally{await rm(directory,{recursive:true,force:true});}});
