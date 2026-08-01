import type { DurableJob, FileDurableJobRepository } from '@vynode/jobs';

export interface JobExecutionContext {
  signal: AbortSignal;
  reportProgress(progress: number): Promise<void>;
  cancellationRequested(): Promise<boolean>;
}

export type DurableJobHandler = (
  job: DurableJob,
  context: JobExecutionContext
) => Promise<unknown>;

export interface DurableWorkerOptions {
  repository: FileDurableJobRepository;
  workerId: string;
  handlers: Readonly<Record<string, DurableJobHandler>>;
  leaseMilliseconds?: number;
  pollMilliseconds?: number;
  now?: () => Date;
}

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((complete) => {
    if (signal.aborted) return complete();
    const timer = setTimeout(complete, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        complete();
      },
      { once: true }
    );
  });

export class DurableWorker {
  private readonly repository: FileDurableJobRepository;
  private readonly workerId: string;
  private readonly handlers: Readonly<Record<string, DurableJobHandler>>;
  private readonly leaseMilliseconds: number;
  private readonly pollMilliseconds: number;
  private readonly now: () => Date;

  public constructor(options: DurableWorkerOptions) {
    if (!options.workerId.trim()) throw new Error('A worker identity is required.');
    this.repository = options.repository;
    this.workerId = options.workerId;
    this.handlers = options.handlers;
    this.leaseMilliseconds = Math.max(1_000, options.leaseMilliseconds ?? 30_000);
    this.pollMilliseconds = Math.max(25, options.pollMilliseconds ?? 1_000);
    this.now = options.now ?? (() => new Date());
  }

  public async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const processed = await this.runOnce(signal);
      if (!processed) await wait(this.pollMilliseconds, signal);
    }
  }

  public async runOnce(signal = new AbortController().signal): Promise<boolean> {
    await this.repository.recoverExpired(this.now());
    if (signal.aborted) return false;
    const job = await this.repository.claim(
      this.workerId,
      this.leaseMilliseconds,
      this.now()
    );
    if (!job) return false;
    const handler = this.handlers[job.kind];
    if (!handler) {
      await this.repository.fail(
        job.id,
        this.workerId,
        `No worker handler is registered for job kind "${job.kind}".`,
        this.now()
      );
      return true;
    }

    const execution = new AbortController();
    const abort = () => execution.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    try {
      const context: JobExecutionContext = {
        signal: execution.signal,
        reportProgress: async (progress) => {
          const current = await this.repository.heartbeat(
            job.id,
            this.workerId,
            progress,
            this.leaseMilliseconds,
            this.now()
          );
          if (current?.cancellationRequested) execution.abort('cancelled');
        },
        cancellationRequested: async () => {
          const current = await this.repository.get(job.id);
          if (current?.cancellationRequested) execution.abort('cancelled');
          return current?.cancellationRequested ?? true;
        },
      };
      const result = await handler(job, context);
      await this.repository.complete(job.id, this.workerId, result, this.now());
    } catch (error) {
      await this.repository.fail(
        job.id,
        this.workerId,
        error instanceof Error ? error.message : 'The worker handler failed.',
        this.now()
      );
    } finally {
      signal.removeEventListener('abort', abort);
    }
    return true;
  }
}
