import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileDurableJobRepository } from '@vynode/jobs';
import type { ProductionCollectionSurface } from './production-collections.js';
import { ProductionCollectionJobRunner } from './production-collection-jobs.js';

const waitFor=async(check:()=>Promise<boolean>)=>{for(let i=0;i<100;i++){if(await check())return;await new Promise((resolve)=>setTimeout(resolve,10));}throw new Error('Timed out waiting for durable job.');};

test('durable collection jobs retry, deduplicate active work, and retain results',async()=>{const directory=await mkdtemp(join(tmpdir(),'vynode-jobs-'));try{const repository=new FileDurableJobRepository(join(directory,'queue.json'));let attempts=0;const collections={async synchronize(){attempts++;await new Promise((resolve)=>setTimeout(resolve,20));if(attempts===1)throw new Error('temporary Plex failure');return{plexRatingKey:'900',itemCount:2,created:true,failures:[]};}} as unknown as ProductionCollectionSurface;const runner=new ProductionCollectionJobRunner(repository,collections);const [first,second]=await Promise.all([runner.execute('one'),runner.execute('one')]);assert.equal(first.plexRatingKey,'900');assert.equal(second.plexRatingKey,'900');assert.equal(attempts,2);const jobs=await repository.list();assert.equal(jobs.length,1);assert.equal(jobs[0]?.status,'succeeded');assert.equal(jobs[0]?.attempts,2);}finally{await rm(directory,{recursive:true,force:true});}});

test('resume processes collection jobs left queued by a previous runtime',async()=>{const directory=await mkdtemp(join(tmpdir(),'vynode-resume-'));try{const repository=new FileDurableJobRepository(join(directory,'queue.json'));const queued=await repository.enqueue({kind:'collection.sync',input:{collectionId:'restored'}});let processed='';const collections={async synchronize(id:string){processed=id;return{plexRatingKey:'901',itemCount:1,created:false,failures:[]};}} as unknown as ProductionCollectionSurface;await new ProductionCollectionJobRunner(repository,collections).resume();await waitFor(async()=>['succeeded','failed'].includes((await repository.get(queued.id))?.status??''));assert.equal(processed,'restored');assert.equal((await repository.get(queued.id))?.status,'succeeded');}finally{await rm(directory,{recursive:true,force:true});}});
