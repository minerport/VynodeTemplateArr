import { createHash } from 'node:crypto';

import type {
  CollectionAssetReference,
  CollectionPosterDesign,
  CollectionPosterSettings,
  CollectionPosterWorkspace,
  PlexDiscoveredItem,
} from '@vynode/contracts';

export interface CollectionPosterRenderInputs {
  sourceType?: string;
  itemPosters: readonly Uint8Array[];
  personPoster?: Uint8Array;
  tmdbFranchisePoster?: Uint8Array;
  fingerprint: string;
}

export interface CollectionPosterRenderInputProvider {
  inputs(
    item: PlexDiscoveredItem,
    settings: CollectionPosterSettings,
    signal?: AbortSignal
  ): Promise<CollectionPosterRenderInputs>;
  uploadedPoster?(
    id: string,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined>;
}

export interface CollectionPosterNativeRenderer {
  render(
    design: CollectionPosterDesign,
    context: {
      title: string;
      sourceType?: string;
      sourceColors?: CollectionPosterWorkspace['sourceColors'];
      itemPosters?: readonly Uint8Array[];
      personPoster?: Uint8Array;
    },
    signal?: AbortSignal
  ): Promise<{ bytes: Uint8Array }>;
}

export interface CollectionPosterSynchronizationAssetsOptions {
  workspace(): Promise<CollectionPosterWorkspace>;
  renderInputs: CollectionPosterRenderInputProvider;
  renderer: CollectionPosterNativeRenderer;
  resolveCollectionAsset(
    reference: CollectionAssetReference
  ): Promise<Uint8Array>;
}

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const renderContext = (
  item: PlexDiscoveredItem,
  inputs: CollectionPosterRenderInputs,
  sourceColors: CollectionPosterWorkspace['sourceColors']
) => ({
  title: item.name,
  sourceColors,
  itemPosters: inputs.itemPosters,
  ...(inputs.sourceType ? { sourceType: inputs.sourceType } : {}),
  ...(inputs.personPoster ? { personPoster: inputs.personPoster } : {}),
});

export class CollectionPosterSynchronizationAssets {
  public constructor(
    private readonly options: CollectionPosterSynchronizationAssetsOptions
  ) {}

  public resolveAsset(
    reference: CollectionAssetReference
  ): Promise<Uint8Array> {
    return this.options.resolveCollectionAsset(reference);
  }

  public async renderPoster(
    item: PlexDiscoveredItem,
    settings: CollectionPosterSettings,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined> {
    const inputs = await this.options.renderInputs.inputs(item, settings, signal);
    if (settings.customPoster?.kind === 'upload') {
      const uploaded = await this.options.renderInputs.uploadedPoster?.(
        settings.customPoster.id,
        signal
      );
      if (!uploaded?.byteLength)
        throw new Error(
          `Uploaded poster "${settings.customPoster.name}" no longer exists.`
        );
      return uploaded;
    }
    const workspace = await this.options.workspace();
    const saved =
      settings.customPoster?.kind === 'saved'
        ? workspace.savedPosters.find(
            (poster) => poster.id === settings.customPoster!.id
          )
        : undefined;
    if (settings.customPoster?.kind === 'saved' && !saved)
      throw new Error(
        `Saved poster "${settings.customPoster.name}" no longer exists.`
      );
    if (saved)
      return (
        await this.options.renderer.render(
          saved.design,
          renderContext(item, inputs, workspace.sourceColors),
          signal
        )
      ).bytes;
    if (
      settings.useTmdbFranchisePoster &&
      inputs.tmdbFranchisePoster?.byteLength
    )
      return inputs.tmdbFranchisePoster;
    if (!settings.autoGenerate) return undefined;
    const template = settings.templateId
      ? workspace.templates.find((candidate) => candidate.id === settings.templateId)
      : workspace.templates.find((candidate) => candidate.isDefault);
    if (!template)
      throw new Error(
        settings.templateId
          ? 'The selected collection poster template no longer exists.'
          : 'No default collection poster template is configured.'
      );
    return (
      await this.options.renderer.render(
        template.design,
        renderContext(item, inputs, workspace.sourceColors),
        signal
      )
    ).bytes;
  }

  public async posterFingerprint(
    item: PlexDiscoveredItem,
    settings: CollectionPosterSettings,
    signal?: AbortSignal
  ): Promise<string> {
    const inputs = await this.options.renderInputs.inputs(item, settings, signal);
    const workspace = await this.options.workspace();
    const saved =
      settings.customPoster?.kind === 'saved'
        ? workspace.savedPosters.find(
            (poster) => poster.id === settings.customPoster!.id
          )
        : undefined;
    const template =
      !saved && settings.autoGenerate
        ? settings.templateId
          ? workspace.templates.find(
              (candidate) => candidate.id === settings.templateId
            )
          : workspace.templates.find((candidate) => candidate.isDefault)
        : undefined;
    return digest({
      itemId: item.id,
      name: item.name,
      settings,
      inputs: inputs.fingerprint,
      saved: saved
        ? {
            id: saved.id,
            updatedAt: saved.updatedAt,
            design: saved.design,
          }
        : undefined,
      template: template
        ? {
            id: template.id,
            updatedAt: template.updatedAt,
            design: template.design,
          }
        : undefined,
      sourceColors:
        (saved ?? template)?.design.background.useSourceColors
          ? workspace.sourceColors
          : undefined,
    });
  }
}
