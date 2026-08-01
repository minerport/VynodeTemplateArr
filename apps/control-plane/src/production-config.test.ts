import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { loadProductionConfiguration } from './production-config.js';

test('loads a secure production configuration and verifies its data directory', async () => {
  const directory=await mkdtemp(join(tmpdir(),'vynode-config-'));
  try { const firstRoot=join(directory,'movies'); const secondRoot=join(directory,'shows'); const config=await loadProductionConfiguration({VYNODE_DATA_DIR:directory,VYNODE_PUBLIC_URL:'https://vynode.example',VYNODE_MASTER_KEY:Buffer.alloc(32,9).toString('base64'),VYNODE_HOST:'0.0.0.0',VYNODE_PORT:'8080',VYNODE_TRUST_PROXY:'true',VYNODE_MEDIA_ROOTS:`${firstRoot}${delimiter}${secondRoot}`}); assert.equal(config.port,8080); assert.equal(config.secureCookies,true); assert.equal(config.trustProxy,true); assert.match(config.databasePath,/vynode\.sqlite$/); assert.deepEqual(config.mediaRoots,[firstRoot,secondRoot]); } finally { await rm(directory,{recursive:true,force:true}); }
});

test('rejects development secrets, weak keys, unsafe public URLs, and invalid ports', async () => {
  const directory=await mkdtemp(join(tmpdir(),'vynode-config-')); const base={VYNODE_DATA_DIR:directory,VYNODE_PUBLIC_URL:'https://vynode.example',VYNODE_MASTER_KEY:Buffer.alloc(32,1).toString('base64')};
  try { await assert.rejects(loadProductionConfiguration({...base,VYNODE_DEV_PLEX_TOKEN:'secret'}),/forbidden/); await assert.rejects(loadProductionConfiguration({...base,VYNODE_MASTER_KEY:'bad'}),/exactly 32/); await assert.rejects(loadProductionConfiguration({...base,VYNODE_PUBLIC_URL:'http://vynode.example'}),/HTTPS/); await assert.rejects(loadProductionConfiguration({...base,VYNODE_PORT:'70000'}),/65535/); await assert.rejects(loadProductionConfiguration({...base,VYNODE_MEDIA_ROOTS:'relative-media'}),/absolute path/); } finally { await rm(directory,{recursive:true,force:true}); }
});

test('allows direct HTTP access on private Unraid network addresses', async () => {
  const directory=await mkdtemp(join(tmpdir(),'vynode-config-'));
  try {
    for (const publicUrl of ['http://10.0.0.86:7945','http://192.168.1.20:7171','http://172.20.0.2:7171','http://tower.local:7171']) {
      const config=await loadProductionConfiguration({VYNODE_DATA_DIR:directory,VYNODE_PUBLIC_URL:publicUrl,VYNODE_MASTER_KEY:Buffer.alloc(32,2).toString('base64')});
      assert.equal(config.publicUrl,publicUrl);
      assert.equal(config.secureCookies,false);
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
});
