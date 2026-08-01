import { createHash } from 'node:crypto';

import type {
  OverlayTemplateSummary,
  PosterSource,
} from '@vynode/contracts';

import {
  type PosterMediaItem,
} from './index.js';
import { PosterOperationCoordinator } from './operations.js';
import {
  OverlayContextBuilder,
  type PlexOverlayMedia,
} from './context.js';
import type { OverlayRenderContext } from './conditions.js';
import type { OverlayRenderReport } from './renderer.js';

export interface OverlayApplicationItem
  extends PosterMediaItem,
    PlexOverlayMedia {}

export interface OverlayApplicationState {
  ratingKey: string;
  basePosterKey: string;
  basePosterHash: string;
  lastAppliedHash?: string;
  appliedTemplateIds: readonly string[];
  updatedAt: string;
}

export interface OverlayBasePosterStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface OverlayApplicationStateRepository {
  get(ratingKey: string): Promise<OverlayApplicationState | undefined>;
  put(state: OverlayApplicationState): Promise<void>;
  delete(ratingKey: string): Promise<void>;
}

export interface PlexPosterWriter {
  uploadPoster(
    ratingKey: string,
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Promise<void>;
  setOverlayLabel(
    ratingKey: string,
    enabled: boolean,
    signal?: AbortSignal
  ): Promise<void>;
}

export interface OverlayPosterAcquirer {
  acquire(
    source: PosterSource,
    item: PosterMediaItem,
    language: string,
    signal?: AbortSignal
  ): Promise<{ bytes: Uint8Array; source: PosterSource; fallbackFrom?: PosterSource }>;
}

export interface OverlayPosterRenderer {
  render(
    poster: Uint8Array,
    templates: readonly OverlayTemplateSummary[],
    context: OverlayRenderContext,
    signal?: AbortSignal
  ): Promise<OverlayRenderReport>;
}

export interface OverlayItemResult {
  ratingKey: string;
  status: 'applied' | 'restored' | 'skipped' | 'failed';
  reason?: string;
  appliedTemplateIds?: readonly string[];
}

export interface OverlayRunResult {
  items: readonly OverlayItemResult[];
  applied: number;
  restored: number;
  skipped: number;
  failed: number;
}

export interface BasePosterDownloadResult {
  items: readonly OverlayItemResult[];
  downloaded: number;
  failed: number;
}

export interface OverlayApplicationServiceOptions {
  acquisition: OverlayPosterAcquirer;
  contexts: OverlayContextBuilder;
  renderer: OverlayPosterRenderer;
  plex: PlexPosterWriter;
  bases: OverlayBasePosterStore;
  states: OverlayApplicationStateRepository;
  coordinator?: PosterOperationCoordinator;
  now?: () => Date;
}

const digest = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

const summarize = (items: readonly OverlayItemResult[]): OverlayRunResult => ({
  items,
  applied: items.filter((item) => item.status === 'applied').length,
  restored: items.filter((item) => item.status === 'restored').length,
  skipped: items.filter((item) => item.status === 'skipped').length,
  failed: items.filter((item) => item.status === 'failed').length,
});

export class OverlayApplicationService {
  private readonly coordinator: PosterOperationCoordinator;
  private readonly now: () => Date;

  public constructor(private readonly options: OverlayApplicationServiceOptions) {
    this.coordinator = options.coordinator ?? new PosterOperationCoordinator();
    this.now = options.now ?? (() => new Date());
  }

  public async preservedBasePoster(
    ratingKey: string
  ): Promise<Uint8Array | undefined> {
    const state = await this.options.states.get(ratingKey);
    if (!state) return undefined;
    const bytes = await this.options.bases.get(state.basePosterKey);
    if (!bytes || digest(bytes) !== state.basePosterHash) return undefined;
    return bytes;
  }

  public apply(
    items: readonly OverlayApplicationItem[],
    templates: readonly OverlayTemplateSummary[],
    source: PosterSource,
    language: string,
    signal?: AbortSignal
  ): Promise<OverlayRunResult> {
    return this.coordinator.run('apply-overlays', async () => {
      const results: OverlayItemResult[] = [];
      for (const item of items) {
        signal?.throwIfAborted();
        try {
          results.push(
            await this.applyItem(item, templates, source, language, signal)
          );
        } catch (error) {
          if (signal?.aborted) throw error;
          results.push({
            ratingKey: item.ratingKey,
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return summarize(results);
    });
  }

  public reset(
    items: readonly Pick<OverlayApplicationItem, 'ratingKey'>[],
    signal?: AbortSignal
  ): Promise<OverlayRunResult> {
    return this.coordinator.run('reset-posters', async () => {
      const results: OverlayItemResult[] = [];
      for (const item of items) {
        signal?.throwIfAborted();
        try {
          const state = await this.options.states.get(item.ratingKey);
          if (!state) {
            results.push({
              ratingKey: item.ratingKey,
              status: 'skipped',
              reason: 'No preserved base poster is recorded.',
            });
            continue;
          }
          const base = await this.options.bases.get(state.basePosterKey);
          if (!base || digest(base) !== state.basePosterHash) {
            results.push({
              ratingKey: item.ratingKey,
              status: 'failed',
              reason: 'The preserved base poster is missing or corrupt.',
            });
            continue;
          }
          await this.options.plex.uploadPoster(item.ratingKey, base, signal);
          await this.options.plex.setOverlayLabel(item.ratingKey, false, signal);
          await this.options.states.delete(item.ratingKey);
          await this.options.bases.delete?.(state.basePosterKey);
          results.push({ ratingKey: item.ratingKey, status: 'restored' });
        } catch (error) {
          if (signal?.aborted) throw error;
          results.push({
            ratingKey: item.ratingKey,
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return summarize(results);
    });
  }

  public downloadCleanPlexBases(
    items: readonly OverlayApplicationItem[],
    signal?: AbortSignal
  ): Promise<BasePosterDownloadResult> {
    return this.coordinator.run('download-base-posters', async () => {
      const results: OverlayItemResult[] = [];
      for (const item of items) {
        signal?.throwIfAborted();
        try {
          const acquired = await this.options.acquisition.acquire(
            'plex',
            item,
            '',
            signal
          );
          const basePosterKey = `base:${item.ratingKey}`;
          await this.options.bases.put(basePosterKey, acquired.bytes);
          await this.options.states.put({
            ratingKey: item.ratingKey,
            basePosterKey,
            basePosterHash: digest(acquired.bytes),
            appliedTemplateIds: [],
            updatedAt: this.now().toISOString(),
          });
          await this.options.plex.setOverlayLabel(item.ratingKey, false, signal);
          results.push({ ratingKey: item.ratingKey, status: 'applied' });
        } catch (error) {
          if (signal?.aborted) throw error;
          results.push({
            ratingKey: item.ratingKey,
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return {
        items: results,
        downloaded: results.filter((item) => item.status === 'applied').length,
        failed: results.filter((item) => item.status === 'failed').length,
      };
    });
  }

  private async applyItem(
    item: OverlayApplicationItem,
    templates: readonly OverlayTemplateSummary[],
    source: PosterSource,
    language: string,
    signal?: AbortSignal
  ): Promise<OverlayItemResult> {
    const previous = await this.options.states.get(item.ratingKey);
    const acquired = await this.options.acquisition.acquire(
      source,
      item,
      language,
      signal
    );
    let renderBase = acquired.bytes;
    if (previous) {
      const preserved = await this.options.bases.get(previous.basePosterKey);
      if (!preserved || digest(preserved) !== previous.basePosterHash) {
        throw new Error('The preserved base poster is missing or corrupt.');
      }
      renderBase = preserved;
    }
    const context = await this.options.contexts.build(item, templates, {
      isPlaceholder: (item.labels ?? []).some((label) =>
        ['trailer-placeholder', 'vynode-placeholder'].includes(
          label.toLowerCase()
        )
      ),
      ...(signal ? { signal } : {}),
    });
    if (context.criticalProviderFailed) {
      return {
        ratingKey: item.ratingKey,
        status: 'skipped',
        reason: context.warnings
          .map((warning) => `${warning.provider}: ${warning.message}`)
          .join(' · '),
      };
    }
    const rendered: OverlayRenderReport = await this.options.renderer.render(
      renderBase,
      templates,
      context.context,
      signal
    );
    if (rendered.appliedTemplateIds.length === 0) {
      if (previous) {
        await this.options.plex.uploadPoster(
          item.ratingKey,
          renderBase,
          signal
        );
        await this.options.plex.setOverlayLabel(item.ratingKey, false, signal);
        await this.options.states.delete(item.ratingKey);
        await this.options.bases.delete?.(previous.basePosterKey);
        return {
          ratingKey: item.ratingKey,
          status: 'restored',
          reason:
            'Previously applied overlays no longer match the current configuration.',
        };
      }
      return {
        ratingKey: item.ratingKey,
        status: 'skipped',
        reason: 'No enabled overlay template matched this item.',
      };
    }

    const renderedHash = digest(rendered.bytes);
    if (previous?.lastAppliedHash === renderedHash) {
      return {
        ratingKey: item.ratingKey,
        status: 'skipped',
        reason: 'The rendered poster is unchanged.',
        appliedTemplateIds: rendered.appliedTemplateIds,
      };
    }

    const basePosterKey = previous?.basePosterKey ?? `base:${item.ratingKey}`;
    if (!previous) await this.options.bases.put(basePosterKey, acquired.bytes);
    const basePosterHash = previous?.basePosterHash ?? digest(acquired.bytes);

    await this.options.plex.uploadPoster(item.ratingKey, rendered.bytes, signal);
    await this.options.plex.setOverlayLabel(item.ratingKey, true, signal);
    await this.options.states.put({
      ratingKey: item.ratingKey,
      basePosterKey,
      basePosterHash,
      lastAppliedHash: renderedHash,
      appliedTemplateIds: rendered.appliedTemplateIds,
      updatedAt: this.now().toISOString(),
    });
    return {
      ratingKey: item.ratingKey,
      status: 'applied',
      appliedTemplateIds: rendered.appliedTemplateIds,
    };
  }
}
