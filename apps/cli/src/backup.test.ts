import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createBackup, restoreBackup, verifyBackup } from './backup.js';

test('creates, verifies, and restores a consistent backup',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vynode-backup-')); const data=join(root,'data'); const bundle=join(root,'bundle'); const restored=join(root,'restored');
  try { await mkdir(data); const db=new DatabaseSync(join(data,'vynode.db')); db.exec('CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES (\'ready\')'); db.close(); await createBackup(data,bundle,new Date('2026-01-01T00:00:00.000Z')); assert.equal((await verifyBackup(bundle)).createdAt,'2026-01-01T00:00:00.000Z'); await restoreBackup(bundle,restored); const copy=new DatabaseSync(join(restored,'vynode.db'),{readOnly:true}); assert.equal(copy.prepare('SELECT value FROM sample').get()?.value,'ready'); copy.close(); await writeFile(join(bundle,'vynode.db'),'tampered'); await assert.rejects(()=>verifyBackup(bundle),/checksum/); } finally { await rm(root,{recursive:true,force:true}); }
});

test('backs up the production database layout',async()=>{ const root=await mkdtemp(join(tmpdir(),'vynode-production-backup-')); const data=join(root,'data'),bundle=join(root,'bundle'); try { await mkdir(join(data,'database'),{recursive:true}); const db=new DatabaseSync(join(data,'database','vynode.sqlite')); db.exec('CREATE TABLE production(value TEXT)'); db.close(); const manifest=await createBackup(data,bundle); assert.ok(manifest.files['database/vynode.sqlite']); await verifyBackup(bundle); } finally { await rm(root,{recursive:true,force:true}); } });
