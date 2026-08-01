import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type DurableJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface DurableJob<TInput = unknown, TResult = unknown> {
  id: string;
  kind: string;
  status: DurableJobStatus;
  input: TInput;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  maxAttempts: number;
  progress: number;
  cancellationRequested: boolean;
  idempotencyKey?: string;
  workerId?: string;
  leaseExpiresAt?: string;
  startedAt?: string;
  completedAt?: string;
  result?: TResult;
  error?: string;
}

export interface EnqueueJobInput<TInput> {
  kind: string;
  input: TInput;
  maxAttempts?: number;
  idempotencyKey?: string;
}

const wait = (milliseconds: number) =>
  new Promise<void>((complete) => setTimeout(complete, milliseconds));

const validStore = (value: unknown): value is DurableJob[] =>
  Array.isArray(value) &&
  value.every(
    (job) =>
      job &&
      typeof job === 'object' &&
      typeof job.id === 'string' &&
      typeof job.kind === 'string' &&
      ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(
        String(job.status)
      )
  );

/**
 * Small-install durable queue. Writes are atomic and an exclusive lock file
 * coordinates API and worker processes. The repository can later be replaced
 * by SQLite/PostgreSQL without changing the worker contract.
 */
export class FileDurableJobRepository {
  private readonly path: string;
  private readonly lockPath: string;

  public constructor(path: string) {
    this.path = resolve(path);
    this.lockPath = `${this.path}.lock`;
  }

  public async list(): Promise<readonly DurableJob[]> {
    return this.read();
  }

  public async get(id: string): Promise<DurableJob | undefined> {
    return (await this.read()).find((job) => job.id === id);
  }

  public async enqueue<TInput>(
    input: EnqueueJobInput<TInput>,
    now = new Date()
  ): Promise<DurableJob<TInput>> {
    if (!input.kind.trim()) throw new Error('A job kind is required.');
    return this.mutate((jobs) => {
      if (input.idempotencyKey) {
        const existing = jobs.find(
          (job) =>
            job.kind === input.kind &&
            job.idempotencyKey === input.idempotencyKey &&
            (job.status === 'queued' || job.status === 'running')
        );
        if (existing) return { jobs, value: existing as DurableJob<TInput> };
      }
      const timestamp = now.toISOString();
      const job: DurableJob<TInput> = {
        id: randomUUID(),
        kind: input.kind.trim(),
        status: 'queued',
        input: structuredClone(input.input),
        createdAt: timestamp,
        updatedAt: timestamp,
        attempts: 0,
        maxAttempts: Math.max(1, Math.min(100, input.maxAttempts ?? 3)),
        progress: 0,
        cancellationRequested: false,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
      };
      return { jobs: [...jobs, job], value: job };
    });
  }

  public async claim(
    workerId: string,
    leaseMilliseconds: number,
    now = new Date()
  ): Promise<DurableJob | undefined> {
    if (!workerId.trim()) throw new Error('A worker identity is required.');
    if (leaseMilliseconds < 1_000)
      throw new Error('A job lease must be at least one second.');
    return this.mutate((jobs) => {
      const candidate = jobs.find(
        (job) =>
          job.status === 'queued' &&
          !job.cancellationRequested &&
          job.attempts < job.maxAttempts
      );
      if (!candidate) return { jobs, value: undefined };
      const timestamp = now.toISOString();
      const claimed: DurableJob = {
        ...candidate,
        status: 'running',
        workerId,
        attempts: candidate.attempts + 1,
        startedAt: candidate.startedAt ?? timestamp,
        leaseExpiresAt: new Date(
          now.getTime() + leaseMilliseconds
        ).toISOString(),
        updatedAt: timestamp,
      };
      return {
        jobs: jobs.map((job) => (job.id === claimed.id ? claimed : job)),
        value: claimed,
      };
    });
  }

  public async heartbeat(
    id: string,
    workerId: string,
    progress: number,
    leaseMilliseconds: number,
    now = new Date()
  ): Promise<DurableJob | undefined> {
    return this.updateOwned(id, workerId, (job) => ({
      ...job,
      progress: Math.max(0, Math.min(100, progress)),
      leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds).toISOString(),
      updatedAt: now.toISOString(),
    }));
  }

  public async complete(
    id: string,
    workerId: string,
    result: unknown,
    now = new Date()
  ): Promise<DurableJob | undefined> {
    return this.updateOwned(id, workerId, (job) => {
      const { workerId: _workerId, leaseExpiresAt: _lease, ...rest } = job;
      return {
        ...rest,
        status: job.cancellationRequested ? 'cancelled' : 'succeeded',
        progress: 100,
        result: structuredClone(result),
        completedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    });
  }

  public async fail(
    id: string,
    workerId: string,
    message: string,
    now = new Date()
  ): Promise<DurableJob | undefined> {
    return this.updateOwned(id, workerId, (job) => {
      const terminal = job.attempts >= job.maxAttempts;
      const {
        workerId: _workerId,
        leaseExpiresAt: _lease,
        completedAt: _completedAt,
        ...rest
      } = job;
      return {
        ...rest,
        status: job.cancellationRequested
          ? 'cancelled'
          : terminal
            ? 'failed'
            : 'queued',
        error: message.slice(0, 4_000),
        ...(terminal || job.cancellationRequested
          ? { completedAt: now.toISOString() }
          : {}),
        updatedAt: now.toISOString(),
      };
    });
  }

  public async requestCancellation(
    id: string,
    now = new Date()
  ): Promise<DurableJob | undefined> {
    return this.mutate((jobs) => {
      const current = jobs.find((job) => job.id === id);
      if (!current) return { jobs, value: undefined };
      if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'cancelled')
        return { jobs, value: current };
      const updated: DurableJob = {
        ...current,
        cancellationRequested: true,
        status: current.status === 'queued' ? 'cancelled' : current.status,
        ...(current.status === 'queued'
          ? { completedAt: now.toISOString() }
          : {}),
        updatedAt: now.toISOString(),
      };
      return {
        jobs: jobs.map((job) => (job.id === id ? updated : job)),
        value: updated,
      };
    });
  }

  public async recoverExpired(now = new Date()): Promise<number> {
    return this.mutate((jobs) => {
      let recovered = 0;
      const updated = jobs.map((job): DurableJob => {
        if (
          job.status !== 'running' ||
          !job.leaseExpiresAt ||
          Date.parse(job.leaseExpiresAt) > now.getTime()
        )
          return job;
        recovered += 1;
        const terminal = job.attempts >= job.maxAttempts;
        const {
          workerId: _workerId,
          leaseExpiresAt: _lease,
          completedAt: _completedAt,
          error: _error,
          ...rest
        } = job;
        return {
          ...rest,
          status: job.cancellationRequested
            ? 'cancelled'
            : terminal
              ? 'failed'
              : 'queued',
          ...(terminal
            ? { error: 'The worker lease expired.' }
            : job.error
              ? { error: job.error }
              : {}),
          ...(terminal || job.cancellationRequested
            ? { completedAt: now.toISOString() }
            : {}),
          updatedAt: now.toISOString(),
        };
      });
      return { jobs: updated, value: recovered };
    });
  }

  private async updateOwned(
    id: string,
    workerId: string,
    update: (job: DurableJob) => DurableJob
  ): Promise<DurableJob | undefined> {
    return this.mutate((jobs) => {
      const current = jobs.find((job) => job.id === id);
      if (!current) return { jobs, value: undefined };
      if (current.status !== 'running' || current.workerId !== workerId)
        throw new Error('The job is not leased by this worker.');
      const updated = update(current);
      return {
        jobs: jobs.map((job) => (job.id === id ? updated : job)),
        value: updated,
      };
    });
  }

  private async read(): Promise<DurableJob[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!validStore(parsed)) throw new Error('The durable job store is invalid.');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async mutate<T>(
    operation: (jobs: DurableJob[]) => { jobs: DurableJob[]; value: T }
  ): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const release = await this.acquireLock();
    try {
      const result = operation(await this.read());
      const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(result.jobs, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.path);
      return result.value;
    } finally {
      await release();
    }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const handle = await open(this.lockPath, 'wx', 0o600);
        await handle.writeFile(`${process.pid}\n${Date.now()}\n`);
        return async () => {
          await handle.close();
          await rm(this.lockPath, { force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const metadata = await stat(this.lockPath);
          if (Date.now() - metadata.mtimeMs > 30_000)
            await rm(this.lockPath, { force: true });
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code !== 'ENOENT')
            throw lockError;
        }
        await wait(10);
      }
    }
    throw new Error('Timed out acquiring the durable job-store lock.');
  }
}
