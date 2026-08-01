import { randomUUID } from 'node:crypto';
import type {
  DashboardJobKind,
  DashboardJobOutcome,
  DashboardJobStatus,
} from '@vynode/contracts';

export interface DashboardJobExecutor {
  items(kind: DashboardJobKind): Promise<readonly {
    id: string;
    name: string;
    sourceType: string;
  }[]>;
  process(
    kind: DashboardJobKind,
    item: { id: string; name: string; sourceType: string },
    signal: AbortSignal
  ): Promise<
    Omit<DashboardJobOutcome, 'id' | 'name' | 'sourceType'> & {
      created?: boolean;
    }
  >;
  cleanup(kind: DashboardJobKind, signal: AbortSignal): Promise<void>;
}

type ActiveRun = {
  status: DashboardJobStatus;
  controller: AbortController;
};

export interface DashboardJobHistoryRepository {
  load(): Partial<Record<DashboardJobKind, DashboardJobStatus>>;
  save(kind: DashboardJobKind, status: DashboardJobStatus): void;
}

const activePhases = new Set(['queued', 'setup', 'processing', 'cleanup', 'cancelling']);

export class DashboardJobService {
  private readonly runs = new Map<DashboardJobKind, ActiveRun>();
  private readonly last = new Map<DashboardJobKind, DashboardJobStatus>();

  public constructor(
    private readonly executor: DashboardJobExecutor,
    private readonly now: () => Date,
    private readonly history?: DashboardJobHistoryRepository
  ) {
    for (const [kind, status] of Object.entries(history?.load() ?? {})) {
      if (status) this.last.set(kind as DashboardJobKind, status);
    }
  }

  public status(kind: DashboardJobKind): DashboardJobStatus {
    const active = this.runs.get(kind)?.status;
    const status = active ?? this.last.get(kind) ?? {
      kind,
      phase: 'idle' as const,
      phaseLabel: 'Idle',
      progressPercent: 0,
      processedItems: 0,
      totalItems: 0,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      createdCount: 0,
      recentOutcomes: [],
      runningForSeconds: 0,
    };
    if (!status.startedAt || !activePhases.has(status.phase)) return status;
    return {
      ...status,
      runningForSeconds: Math.max(
        0,
        Math.floor((this.now().getTime() - new Date(status.startedAt).getTime()) / 1000)
      ),
    };
  }

  public async start(kind: DashboardJobKind): Promise<DashboardJobStatus> {
    return this.startSelected(kind);
  }

  public async startSelected(
    kind: DashboardJobKind,
    itemIds?: readonly string[]
  ): Promise<DashboardJobStatus> {
    if (this.runs.has(kind)) {
      throw new Error(`${kind} synchronization is already running.`);
    }
    const startedAt = this.now().toISOString();
    const run: ActiveRun = {
      controller: new AbortController(),
      status: {
        kind,
        runId: randomUUID(),
        phase: 'queued',
        phaseLabel: 'Queued',
        progressPercent: 0,
        processedItems: 0,
        totalItems: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
        createdCount: 0,
        recentOutcomes: [],
        startedAt,
        runningForSeconds: 0,
      },
    };
    this.runs.set(kind, run);
    void this.execute(kind, run, itemIds);
    return this.status(kind);
  }

  public cancel(kind: DashboardJobKind): DashboardJobStatus {
    const run = this.runs.get(kind);
    if (!run) throw new Error(`No ${kind} synchronization is running.`);
    run.status = {
      ...run.status,
      phase: 'cancelling',
      phaseLabel: 'Stopping safely…',
    };
    run.controller.abort();
    return this.status(kind);
  }

  private async execute(
    kind: DashboardJobKind,
    run: ActiveRun,
    itemIds?: readonly string[]
  ): Promise<void> {
    try {
      run.status = { ...run.status, phase: 'setup', phaseLabel: 'Preparing' };
      const availableItems = await this.executor.items(kind);
      const selected = itemIds ? new Set(itemIds) : undefined;
      const items = selected
        ? availableItems.filter((item) => selected.has(item.id))
        : availableItems;
      run.status = {
        ...run.status,
        phase: 'processing',
        phaseLabel: items.length ? 'Synchronizing' : 'Nothing to synchronize',
        totalItems: items.length,
      };
      for (const item of items) {
        if (run.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        run.status = { ...run.status, currentItem: item };
        const started = this.now().getTime();
        let outcome: DashboardJobOutcome;
        let created = false;
        try {
          const result = await this.executor.process(kind, item, run.controller.signal);
          created = result.created ?? false;
          outcome = {
            id: item.id,
            name: item.name,
            sourceType: item.sourceType,
            durationMs: Math.max(result.durationMs, this.now().getTime() - started),
            outcome: result.outcome,
            ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
          };
        } catch (error) {
          if (run.controller.signal.aborted) throw error;
          outcome = {
            id: item.id,
            name: item.name,
            sourceType: item.sourceType,
            durationMs: this.now().getTime() - started,
            outcome: 'error',
            errorMessage: error instanceof Error ? error.message : 'Unknown synchronization error',
          };
        }
        const processedItems = run.status.processedItems + 1;
        run.status = {
          ...run.status,
          processedItems,
          progressPercent: items.length ? Math.round(processedItems / items.length * 100) : 100,
          successCount: run.status.successCount + Number(outcome.outcome === 'success'),
          errorCount: run.status.errorCount + Number(outcome.outcome === 'error'),
          skippedCount: run.status.skippedCount + Number(outcome.outcome === 'skipped'),
          createdCount: run.status.createdCount + Number(created),
          recentOutcomes: [outcome, ...run.status.recentOutcomes].slice(0, 5),
        };
      }
      const { currentItem: _currentItem, ...withoutCurrentItem } = run.status;
      run.status = { ...withoutCurrentItem, phase: 'cleanup', phaseLabel: 'Cleaning up' };
      await this.executor.cleanup(kind, run.controller.signal);
      this.finish(kind, run, 'completed', 'Complete');
    } catch (error) {
      if (run.controller.signal.aborted) {
        this.finish(kind, run, 'cancelled', 'Cancelled');
      } else {
        this.finish(kind, run, 'failed', 'Failed', error instanceof Error ? error.message : 'Synchronization failed.');
      }
    }
  }

  private finish(
    kind: DashboardJobKind,
    run: ActiveRun,
    phase: 'completed' | 'cancelled' | 'failed',
    phaseLabel: string,
    message?: string
  ) {
    const completedAt = this.now().toISOString();
    const { currentItem: _currentItem, ...withoutCurrentItem } = run.status;
    const status: DashboardJobStatus = {
      ...withoutCurrentItem,
      phase,
      phaseLabel,
      completedAt,
      progressPercent: phase === 'completed' ? 100 : run.status.progressPercent,
      runningForSeconds: Math.max(
        0,
        Math.floor((new Date(completedAt).getTime() - new Date(run.status.startedAt!).getTime()) / 1000)
      ),
      ...(message ? { message } : {}),
    };
    this.last.set(kind, status);
    this.history?.save(kind, status);
    this.runs.delete(kind);
  }
}
