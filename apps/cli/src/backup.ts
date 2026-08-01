import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';

export interface BackupManifest {
  format: 'vynode-backup';
  version: 1;
  createdAt: string;
  files: Readonly<Record<string, string>>;
}

const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
const walk = async (root: string, current = root): Promise<string[]> => {
  const entries=await readdir(current,{withFileTypes:true}); const files:string[]=[];
  for(const entry of entries){ const path=join(current,entry.name); if(entry.isDirectory()) files.push(...await walk(root,path)); else if(entry.isFile()) files.push(relative(root,path).replaceAll('\\','/')); }
  return files.sort();
};
const assertSeparate = (dataDirectory: string, bundleDirectory: string) => {
  const data=resolve(dataDirectory); const bundle=resolve(bundleDirectory);
  if(data===bundle || bundle.startsWith(`${data}\\`) || data.startsWith(`${bundle}\\`)) throw new Error('The backup directory and data directory must be separate.');
};

export const createBackup = async (dataDirectory: string, bundleDirectory: string, now=new Date()): Promise<BackupManifest> => {
  assertSeparate(dataDirectory,bundleDirectory); const source=resolve(dataDirectory); const target=resolve(bundleDirectory);
  let databaseFile:string|undefined;
  for(const candidate of ['database/vynode.sqlite','vynode.db']) { try { if((await stat(join(source,candidate))).isFile()){ databaseFile=candidate; break; } } catch(error){ if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; } }
  if(!databaseFile) throw new Error('The Vynode database was not found in the data directory.');
  const sourceDatabase=join(source,databaseFile);
  await mkdir(dirname(target),{recursive:true}); const temporary=`${target}.partial-${process.pid}-${Date.now()}`;
  await rm(temporary,{recursive:true,force:true}); await mkdir(temporary,{recursive:true});
  const database=new DatabaseSync(sourceDatabase,{readOnly:true});
  const databaseDestination=join(temporary,databaseFile); await mkdir(dirname(databaseDestination),{recursive:true});
  try { await sqliteBackup(database,databaseDestination); } finally { database.close(); }
  for(const directory of ['assets','uploads']) { try { if((await stat(join(source,directory))).isDirectory()) await cp(join(source,directory),join(temporary,directory),{recursive:true}); } catch(error){ if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; } }
  const files:Record<string,string>={}; for(const file of await walk(temporary)) files[file]=await digest(join(temporary,file));
  const manifest:BackupManifest={format:'vynode-backup',version:1,createdAt:now.toISOString(),files};
  await writeFile(join(temporary,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,{encoding:'utf8',mode:0o600});
  await rm(target,{recursive:true,force:true}); await rename(temporary,target); return manifest;
};

export const verifyBackup = async (bundleDirectory: string): Promise<BackupManifest> => {
  const root=resolve(bundleDirectory); const parsed:unknown=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
  if(!parsed || typeof parsed!=='object' || (parsed as BackupManifest).format!=='vynode-backup' || (parsed as BackupManifest).version!==1) throw new Error('The backup manifest is unsupported.');
  const manifest=parsed as BackupManifest;
  for(const [file,expected] of Object.entries(manifest.files)) {
    if(isAbsolute(file) || file.split('/').includes('..')) throw new Error('The backup manifest contains an unsafe path.');
    if(await digest(join(root,file))!==expected) throw new Error(`Backup checksum verification failed for ${file}.`);
  }
  const databaseFile=Object.keys(manifest.files).find((file)=>file==='database/vynode.sqlite'||file==='vynode.db'); if(!databaseFile) throw new Error('The backup does not contain a Vynode database.');
  const database=new DatabaseSync(join(root,databaseFile),{readOnly:true}); try { const result=database.prepare('PRAGMA integrity_check').get(); if(String(result?.integrity_check)!=='ok') throw new Error('The backup database failed its integrity check.'); } finally { database.close(); }
  return manifest;
};

export const restoreBackup = async (bundleDirectory: string, dataDirectory: string): Promise<void> => {
  assertSeparate(dataDirectory,bundleDirectory); await verifyBackup(bundleDirectory);
  const source=resolve(bundleDirectory); const target=resolve(dataDirectory); const temporary=`${target}.restore-${process.pid}-${Date.now()}`;
  await rm(temporary,{recursive:true,force:true}); await mkdir(temporary,{recursive:true});
  for(const file of Object.keys((await verifyBackup(source)).files)){ const destination=join(temporary,file); await mkdir(dirname(destination),{recursive:true}); await copyFile(join(source,file),destination); }
  const previous=`${target}.pre-restore-${Date.now()}`; let moved=false;
  try { await stat(target); await rename(target,previous); moved=true; } catch(error){ if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  try { await rename(temporary,target); if(moved) await rm(previous,{recursive:true,force:true}); } catch(error){ if(moved) await rename(previous,target); throw error; }
};

const main = async () => {
  const [command,first,second]=process.argv.slice(2); if(!command || !first || (command!=='verify'&&!second)) throw new Error('Usage: backup <data-dir> <backup-dir> | verify <backup-dir> | restore <backup-dir> <data-dir>');
  if(command==='backup') await createBackup(first,second!); else if(command==='verify') await verifyBackup(first); else if(command==='restore') await restoreBackup(first,second!); else throw new Error(`Unknown command: ${basename(command)}`);
};
if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)) main().catch((error)=>{ console.error(error instanceof Error?error.message:String(error)); process.exitCode=1; });
