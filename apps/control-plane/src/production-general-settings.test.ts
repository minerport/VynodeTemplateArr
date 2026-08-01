import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VynodeSqliteStorage } from '@vynode/storage';
import { ProductionGeneralSettings } from './production-general-settings.js';

test('persists general settings and stores only a hash of issued API keys',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vynode-general-')); const database=join(directory,'vynode.sqlite');
  try{
    const storage=new VynodeSqliteStorage(database); const service=new ProductionGeneralSettings(storage,'http://127.0.0.1:7171',directory);
    const issued=await service.regenerateApiKey(); assert.ok(issued.issuedApiKey); assert.equal((await service.authenticate(issued.issuedApiKey!))?.role,'administrator');
    const saved=await service.save(issued.revision,{applicationTitle:' My Vynode ',applicationUrl:'https://vynode.example/',locale:'en-GB',cacheImages:false,imageCacheDays:7,globalExcludedTitles:[' Skip Me ','Skip Me']});
    assert.equal(saved?.applicationTitle,'My Vynode'); assert.deepEqual(saved?.globalExcludedTitles,['Skip Me']); storage.close();
    const bytes=await readFile(database); assert.equal(bytes.includes(Buffer.from(issued.issuedApiKey!)),false);
    const reopenedStorage=new VynodeSqliteStorage(database); const reopened=new ProductionGeneralSettings(reopenedStorage,'http://wrong.example',directory);
    assert.equal((await reopened.get()).applicationUrl,'https://vynode.example/'); assert.ok(await reopened.authenticate(issued.issuedApiKey!)); reopenedStorage.close();
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('rotation invalidates the previous key and cache clearing is scoped to image cache',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vynode-key-'));
  try{
    const storage=new VynodeSqliteStorage(join(directory,'vynode.sqlite')); const service=new ProductionGeneralSettings(storage,'http://127.0.0.1:7171',directory);
    const first=(await service.regenerateApiKey()).issuedApiKey!; const second=(await service.regenerateApiKey()).issuedApiKey!;
    assert.equal(await service.authenticate(first),undefined); assert.ok(await service.authenticate(second));
    const cached=join(directory,'cache','images','poster.jpg'); const sibling=join(directory,'cache','keep.txt');
    await mkdir(join(directory,'cache','images'),{recursive:true});
    await writeFile(cached,'poster'); await writeFile(sibling,'keep'); await service.clearImageCache();
    assert.equal(await readFile(sibling,'utf8'),'keep'); await assert.rejects(readFile(cached)); storage.close();
  }finally{await rm(directory,{recursive:true,force:true});}
});
