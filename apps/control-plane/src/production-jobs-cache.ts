import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { BackgroundJob, CacheStatistic } from '@vynode/contracts';
import { SqliteJsonRepository, type VynodeSqliteStorage } from '@vynode/storage';

interface StoredJobs { jobs: BackgroundJob[] }
type JobExecutor = (signal: AbortSignal) => Promise<string>;

const nextExecution = (cronSchedule: string, now: Date): string => {
  const parts = cronSchedule.trim().split(/\s+/);
  const candidate = new Date(now.getTime() + 60_000);
  const minuteStep = /^\*\/(\d+)$/.exec(parts[1] ?? '')?.[1];
  const hourStep = /^\*\/(\d+)$/.exec(parts[2] ?? '')?.[1];
  if (minuteStep) candidate.setMinutes(Math.ceil(candidate.getMinutes() / Number(minuteStep)) * Number(minuteStep), Number(parts[0]) || 0, 0);
  else if (hourStep) candidate.setHours(Math.ceil(candidate.getHours() / Number(hourStep)) * Number(hourStep), Number(parts[1]) || 0, Number(parts[0]) || 0, 0);
  else candidate.setHours(candidate.getHours() + 1, Number(parts[1]) || 0, Number(parts[0]) || 0, 0);
  return candidate.toISOString();
};

const directorySize = async (directory: string): Promise<{ keys: number; bytes: number }> => {
  let keys = 0, bytes = 0;
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) { keys += 1; bytes += (await stat(path)).size; }
    }
  };
  await walk(directory);
  return { keys, bytes };
};

export class ProductionJobsAndCache {
  readonly #values: SqliteJsonRepository<StoredJobs>;
  readonly #controllers = new Map<string, AbortController>();
  readonly #cacheDirectories: Readonly<Record<string, string>>;

  public constructor(
    private readonly storage: VynodeSqliteStorage,
    dataDirectory: string,
    private readonly executors: Readonly<Record<string, JobExecutor>>,
    private readonly now: () => Date = () => new Date()
  ) {
    this.#values = new SqliteJsonRepository(storage, 'background-jobs');
    this.#cacheDirectories = { tmdb: resolve(dataDirectory, 'cache', 'tmdb'), trakt: resolve(dataDirectory, 'cache', 'trakt'), images: resolve(dataDirectory, 'cache', 'images') };
    if (!this.#values.get('jobs')) {
      const created = now();
      const definitions = [
        ['plex-collections-sync', 'Plex Collections Sync', 'process', 'hours', '0 0 */6 * * *'],
        ['overlay-application', 'Poster Overlay Application', 'process', 'hours', '0 15 */6 * * *'],
        ['watchlist-sync', 'Plex Watchlist Sync', 'command', 'minutes', '0 */10 * * * *'],
      ] as const;
      this.#values.put('jobs', { jobs: definitions.map(([id, name, type, interval, cronSchedule]) => ({ id, name, type, interval, cronSchedule, nextExecutionTime: nextExecution(cronSchedule, created), running: false })) });
    } else {
      const current = this.#values.get('jobs')!;
      this.#values.put('jobs', { jobs: current.value.jobs.map(({ startedAt: _startedAt, ...job }) => ({ ...job, running: false, ...(job.running ? { lastCompletedAt: now().toISOString(), lastOutcome: 'cancelled' as const, lastMessage: 'Interrupted by application restart; safe to run again.' } : {}) })) }, current.revision);
    }
  }

  async #mutate(operation: (jobs: BackgroundJob[]) => void) { return this.storage.transaction(async () => { const current = this.#values.get('jobs')!; const jobs = structuredClone(current.value.jobs); operation(jobs); this.#values.put('jobs', { jobs }, current.revision); return jobs; }); }
  public async jobs() { return structuredClone(this.#values.get('jobs')!.value.jobs); }
  public async run(id: string) {
    const job = (await this.jobs()).find((value) => value.id === id); const execute = this.executors[id];
    if (!job || !execute || job.running || this.#controllers.has(id)) return undefined;
    const controller = new AbortController(); this.#controllers.set(id, controller);
    const startedAt = this.now().toISOString();
    await this.#mutate((jobs) => { const index = jobs.findIndex((value) => value.id === id); jobs[index] = { ...jobs[index]!, running: true, startedAt }; });
    void execute(controller.signal).then(async (message) => { await this.#complete(id, 'success', message); }).catch(async (error) => { const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError'); await this.#complete(id, cancelled ? 'cancelled' : 'failed', cancelled ? 'Safe cancellation completed.' : error instanceof Error ? error.message : 'The job failed.'); }).finally(() => this.#controllers.delete(id));
    return (await this.jobs()).find((value) => value.id === id);
  }
  async #complete(id: string, outcome: 'success' | 'failed' | 'cancelled', message: string) { await this.#mutate((jobs) => { const index = jobs.findIndex((value) => value.id === id); if (index < 0) return; const current = jobs[index]!; const { startedAt: _startedAt, ...rest } = current; jobs[index] = { ...rest, running: false, lastCompletedAt: this.now().toISOString(), lastOutcome: outcome, lastMessage: message, nextExecutionTime: nextExecution(current.cronSchedule, this.now()) }; }); }
  public async cancel(id: string) { const controller = this.#controllers.get(id); if (!controller) return undefined; controller.abort(); return (await this.jobs()).find((value) => value.id === id); }
  public async schedule(id: string, cronSchedule: string) { let found = false; const jobs = await this.#mutate((values) => { const index = values.findIndex((value) => value.id === id); if (index < 0 || values[index]!.running) return; found = true; values[index] = { ...values[index]!, cronSchedule, nextExecutionTime: nextExecution(cronSchedule, this.now()) }; }); return found ? jobs.find((value) => value.id === id) : undefined; }
  public async caches(): Promise<readonly CacheStatistic[]> { return Promise.all(Object.entries(this.#cacheDirectories).map(async ([id, directory]) => { const value = await directorySize(directory); return { id, name: id === 'images' ? 'Image metadata' : `${id.toUpperCase()} API`, hits: 0, misses: 0, keys: value.keys, keySizeBytes: 0, valueSizeBytes: value.bytes }; })); }
  public async flushCache(id: string) { const directory = this.#cacheDirectories[id]; if (!directory) return undefined; await rm(directory, { recursive: true, force: true }); await mkdir(directory, { recursive: true }); return (await this.caches()).find((value) => value.id === id); }
}
