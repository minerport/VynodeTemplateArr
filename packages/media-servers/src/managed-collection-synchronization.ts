import type { ManagedCollection } from '@vynode/contracts';
import {
  managedCollectionLabel,
  type PlexManagedCollectionClient,
} from './plex-managed-collections.js';
import { plexItemIsActive } from './plex-production.js';

export interface ManagedCollectionSyncReport {
  collectionId: string;
  plexRatingKey: string;
  created: boolean;
  added: readonly string[];
  removed: readonly string[];
  failures: readonly string[];
  verifiedMemberKeys: readonly string[];
}

export class ManagedCollectionSynchronizer {
  public constructor(
    private readonly plex: Pick<
      PlexManagedCollectionClient,
      | 'addMembers'
      | 'create'
      | 'removeMembers'
      | 'rename'
      | 'reorderMembers'
      | 'snapshot'
    > &
      Partial<
        Pick<
          PlexManagedCollectionClient,
          | 'createUnwatchedSmart'
          | 'delete'
          | 'membersWithManagedLabel'
          | 'randomizeHubPosition'
          | 'setManagedLabel'
          | 'updateHubVisibility'
        >
      >,
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => number = Math.random
  ) {}

  public async synchronize(
    collection: ManagedCollection,
    desiredMemberKeys: readonly string[],
    signal?: AbortSignal
  ): Promise<ManagedCollectionSyncReport> {
    this.throwIfAborted(signal);
    const desired = [
      ...new Set(
        desiredMemberKeys
          .map((key) => key.trim())
          .filter((key) => /^\d+$/.test(key))
      ),
    ];
    if (!desired.length) {
      throw new Error(
        `Collection "${collection.title}" resolved no valid Plex members.`
      );
    }
    if (collection.behaviorSettings?.showUnwatchedOnly)
      return this.synchronizeUnwatched(collection, desired, signal);
    if (collection.plexRatingKey) {
      const current = await this.plex.snapshot(collection.plexRatingKey, signal);
      if (current.smart)
        return this.convertUnwatchedToRegular(collection, desired, signal);
    }

    let plexRatingKey = collection.plexRatingKey;
    let created = false;
    if (!plexRatingKey) {
      plexRatingKey = await this.plex.create(
        {
          title: collection.title,
          libraryId: collection.libraryId,
          mediaType: collection.itemType ?? collection.mediaType,
        },
        signal
      );
      created = true;
    }

    this.throwIfAborted(signal);
    const before = await this.plex.snapshot(plexRatingKey, signal);
    if (before.libraryId !== collection.libraryId) {
      throw new Error(
        `Plex collection ${plexRatingKey} belongs to library ${before.libraryId}, not ${collection.libraryId}.`
      );
    }
    if (before.smart) {
      throw new Error(
        `Cannot synchronize members of smart Plex collection ${plexRatingKey}.`
      );
    }
    if (before.title !== collection.title) {
      await this.plex.rename(
        plexRatingKey,
        collection.libraryId,
        collection.title,
        signal
      );
    }

    const desiredSet = new Set(desired);
    const currentSet = new Set(before.memberKeys);
    const toAdd = desired.filter((key) => !currentSet.has(key));
    const toRemove = before.memberKeys.filter((key) => !desiredSet.has(key));
    const addResult = await this.plex.addMembers(
      plexRatingKey,
      toAdd,
      signal
    );
    this.throwIfAborted(signal);
    const removeResult = await this.plex.removeMembers(
      plexRatingKey,
      toRemove,
      signal
    );
    this.throwIfAborted(signal);
    const membership = await this.plex.snapshot(plexRatingKey, signal);
    const failures = [
      ...addResult.failures.map((key) => `add:${key}`),
      ...removeResult.failures.map((key) => `remove:${key}`),
    ];
    const verifiedSet = new Set(membership.memberKeys);
    for (const key of desired) {
      if (!verifiedSet.has(key) && !failures.includes(`add:${key}`)) {
        failures.push(`verify-missing:${key}`);
      }
    }
    for (const key of membership.memberKeys) {
      if (!desiredSet.has(key) && !failures.includes(`remove:${key}`)) {
        failures.push(`verify-extra:${key}`);
      }
    }
    if (failures.length === 0) {
      const reorderResult = await this.plex.reorderMembers(
        plexRatingKey,
        desired,
        signal
      );
      failures.push(
        ...reorderResult.failures.map((key) => `reorder:${key}`)
      );
    }
    this.throwIfAborted(signal);
    const verified = await this.plex.snapshot(plexRatingKey, signal);
    if (
      failures.length === 0 &&
      (verified.memberKeys.length !== desired.length ||
        desired.some((key, index) => verified.memberKeys[index] !== key))
    )
      failures.push('verify-order');

    await this.applyPlacement(collection, plexRatingKey, failures, signal);

    return {
      collectionId: collection.id,
      plexRatingKey,
      created,
      added: addResult.added,
      removed: removeResult.removed,
      failures,
      verifiedMemberKeys: verified.memberKeys,
    };
  }

  private async synchronizeUnwatched(
    collection: ManagedCollection,
    desired: readonly string[],
    signal?: AbortSignal
  ): Promise<ManagedCollectionSyncReport> {
    const client = this.plex;
    if (
      !client.createUnwatchedSmart ||
      !client.delete ||
      !client.membersWithManagedLabel ||
      !client.setManagedLabel
    ) throw new Error('Unwatched Plex smart collections are unavailable.');
    const ownershipLabel = managedCollectionLabel(collection.id);
    const originalLabels = await client.membersWithManagedLabel(
      collection.libraryId,
      collection.mediaType,
      ownershipLabel,
      signal
    );
    const originalSet = new Set(originalLabels);
    const desiredSet = new Set(desired);
    const added = desired.filter((key) => !originalSet.has(key));
    const removed = originalLabels.filter((key) => !desiredSet.has(key));
    let replacementKey: string | undefined;
    let created = false;
    const previousKey = collection.plexRatingKey;
    try {
      for (const key of added) {
        this.throwIfAborted(signal);
        await client.setManagedLabel(key, ownershipLabel, true, signal);
      }
      for (const key of removed) {
        this.throwIfAborted(signal);
        await client.setManagedLabel(key, ownershipLabel, false, signal);
      }
      const verifiedLabels = await client.membersWithManagedLabel(
        collection.libraryId,
        collection.mediaType,
        ownershipLabel,
        signal
      );
      if (
        verifiedLabels.length !== desired.length ||
        desired.some((key) => !verifiedLabels.includes(key))
      ) throw new Error('Plex did not preserve the exact unwatched source membership.');

      let plexRatingKey = previousKey;
      if (plexRatingKey) {
        const existing = await client.snapshot(plexRatingKey, signal);
        if (existing.libraryId !== collection.libraryId)
          throw new Error(
            `Plex collection ${plexRatingKey} belongs to library ${existing.libraryId}, not ${collection.libraryId}.`
          );
        if (!existing.smart) plexRatingKey = undefined;
        else if (existing.title !== collection.title)
          await client.rename(
            plexRatingKey,
            collection.libraryId,
            collection.title,
            signal
          );
      }
      if (!plexRatingKey) {
        replacementKey = await client.createUnwatchedSmart(
          {
            title: collection.title,
            libraryId: collection.libraryId,
            mediaType: collection.mediaType,
            ownershipLabel,
          },
          signal
        );
        plexRatingKey = replacementKey;
        created = true;
      }
      const verified = await client.snapshot(plexRatingKey, signal);
      if (!verified.smart)
        throw new Error(`Plex collection ${plexRatingKey} is not smart.`);
      const failures: string[] = [];
      await this.applyPlacement(collection, plexRatingKey, failures, signal);
      if (failures.length) throw new Error(failures.join(','));
      if (previousKey && previousKey !== plexRatingKey)
        await client.delete(previousKey, signal);
      return {
        collectionId: collection.id,
        plexRatingKey,
        created,
        added,
        removed,
        failures: [],
        verifiedMemberKeys: verified.memberKeys,
      };
    } catch (error) {
      if (replacementKey) await client.delete(replacementKey).catch(() => undefined);
      for (const key of added)
        await client.setManagedLabel(key, ownershipLabel, false).catch(() => undefined);
      for (const key of removed)
        await client.setManagedLabel(key, ownershipLabel, true).catch(() => undefined);
      throw error;
    }
  }

  private async convertUnwatchedToRegular(
    collection: ManagedCollection,
    desired: readonly string[],
    signal?: AbortSignal
  ): Promise<ManagedCollectionSyncReport> {
    const client = this.plex;
    if (!client.delete || !client.membersWithManagedLabel || !client.setManagedLabel)
      throw new Error('Unwatched Plex smart collection conversion is unavailable.');
    const previousKey = collection.plexRatingKey!;
    const { plexRatingKey: _previousRatingKey, ...regularCollection } = collection;
    const replacementTitle = `${collection.title} (Vynode replacement ${collection.id.slice(0, 8)})`;
    const regular = await this.synchronize(
      { ...regularCollection, title: replacementTitle },
      desired,
      signal
    );
    if (regular.failures.length) {
      await client.delete(regular.plexRatingKey).catch(() => undefined);
      throw new Error(
        `The replacement regular collection failed verification: ${regular.failures.join(',')}.`
      );
    }
    const ownershipLabel = managedCollectionLabel(collection.id);
    const labeled = await client.membersWithManagedLabel(
      collection.libraryId,
      collection.mediaType,
      ownershipLabel,
      signal
    );
    const removed: string[] = [];
    const retiredTitle = `${collection.title} (Vynode retired ${collection.id.slice(0, 8)})`;
    let previousRenamed = false;
    let replacementRenamed = false;
    try {
      for (const key of labeled) {
        this.throwIfAborted(signal);
        await client.setManagedLabel(key, ownershipLabel, false, signal);
        removed.push(key);
      }
      const afterLabelCleanup = await client.snapshot(
        regular.plexRatingKey,
        signal
      );
      if (
        afterLabelCleanup.memberKeys.length !== desired.length ||
        desired.some((key) => !afterLabelCleanup.memberKeys.includes(key))
      ) throw new Error('The regular replacement lost membership during label cleanup.');
      await client.rename(
        previousKey,
        collection.libraryId,
        retiredTitle,
        signal
      );
      previousRenamed = true;
      await client.rename(
        regular.plexRatingKey,
        collection.libraryId,
        collection.title,
        signal
      );
      replacementRenamed = true;
      await client.delete(previousKey, signal);
      return regular;
    } catch (error) {
      if (replacementRenamed)
        await client.rename(
          regular.plexRatingKey,
          collection.libraryId,
          replacementTitle
        ).catch(() => undefined);
      if (previousRenamed)
        await client.rename(
          previousKey,
          collection.libraryId,
          collection.title
        ).catch(() => undefined);
      for (const key of removed)
        await client.setManagedLabel(key, ownershipLabel, true).catch(() => undefined);
      await client.delete(regular.plexRatingKey).catch(() => undefined);
      throw error;
    }
  }

  private async applyPlacement(
    collection: ManagedCollection,
    plexRatingKey: string,
    failures: string[],
    signal?: AbortSignal
  ): Promise<void> {
    if (collection.behaviorSettings?.timeRestriction && this.plex.updateHubVisibility) {
      const active = plexItemIsActive(
        collection.behaviorSettings.timeRestriction,
        this.now()
      );
      const visibility = active
        ? collection.behaviorSettings.visibility
        : collection.behaviorSettings.timeRestriction.inactiveVisibility;
      try {
        await this.plex.updateHubVisibility(
          collection.libraryId,
          plexRatingKey,
          visibility,
          signal
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push('visibility');
      }
      if (
        active &&
        collection.behaviorSettings.randomizeHomeOrder &&
        (visibility.usersHome || visibility.serverOwnerHome)
      ) {
        const randomizeHubPosition = this.plex.randomizeHubPosition;
        if (!randomizeHubPosition) failures.push('home-order-unavailable');
        else {
          try {
            await randomizeHubPosition.call(
              this.plex,
              collection.libraryId,
              plexRatingKey,
              this.random(),
              signal
            );
          } catch (error) {
            if (signal?.aborted) throw error;
            failures.push('home-order');
          }
        }
      }
    }

  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }
}
