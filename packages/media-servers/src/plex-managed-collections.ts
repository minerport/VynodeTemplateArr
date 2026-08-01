import type { CollectionVisibilitySettings } from '@vynode/contracts';
import type { PlexHttpTransport } from './plex-http.js';

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null
    ? (value as JsonRecord)
    : undefined;

const records = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : record(value)
      ? [record(value)!]
      : [];

const container = (value: unknown): JsonRecord =>
  record(record(value)?.MediaContainer) ?? {};

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

export interface PlexRegularCollectionSnapshot {
  ratingKey: string;
  title: string;
  libraryId: string;
  smart: boolean;
  memberKeys: readonly string[];
}

export interface PlexManagedCollectionClientOptions {
  transport: Pick<
    PlexHttpTransport,
    'delete' | 'post' | 'postJson' | 'put' | 'query'
  >;
  machineIdentifier: string;
  verifiedServerName: string;
  allowedMutationServerNames: ReadonlySet<string>;
}

export const managedCollectionLabel = (collectionId: string): string => {
  const normalized = collectionId.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(normalized))
    throw new Error('A valid managed collection ID is required for its Plex label.');
  return `Vynode Collection ${normalized}`;
};

const collectionType = (
  mediaType: 'episode' | 'movie' | 'season' | 'show'
): '1' | '2' | '3' | '4' =>
  mediaType === 'episode'
    ? '4'
    : mediaType === 'season'
      ? '3'
      : mediaType === 'show'
        ? '2'
        : '1';

const ratingKeyFromResponse = (value: unknown): string => {
  const metadata = records(container(value).Metadata)[0];
  return text(metadata?.ratingKey || record(metadata?.attributes)?.ratingKey);
};

export class PlexManagedCollectionClient {
  public constructor(private readonly options: PlexManagedCollectionClientOptions) {
    if (!options.machineIdentifier.trim()) {
      throw new Error('The verified Plex machine identifier is required.');
    }
  }

  public async snapshot(
    ratingKey: string,
    signal?: AbortSignal
  ): Promise<PlexRegularCollectionSnapshot> {
    const encoded = encodeURIComponent(ratingKey);
    const [metadataResponse, childrenResponse] = await Promise.all([
      this.options.transport.query(`/library/collections/${encoded}`, signal),
      this.options.transport.query(
        `/library/collections/${encoded}/children`,
        signal
      ),
    ]);
    const metadata = records(container(metadataResponse).Metadata)[0];
    if (!metadata) {
      throw new Error(`Plex collection ${ratingKey} was not found.`);
    }
    return {
      ratingKey: text(metadata.ratingKey) || ratingKey,
      title: text(metadata.title),
      libraryId: text(metadata.librarySectionID),
      smart:
        metadata.smart === true ||
        metadata.smart === 1 ||
        metadata.smart === '1',
      memberKeys: records(container(childrenResponse).Metadata)
        .map((item) => text(item.ratingKey))
        .filter(Boolean),
    };
  }

  public async updateHubVisibility(
    libraryId: string,
    ratingKey: string,
    visibility: CollectionVisibilitySettings,
    signal?: AbortSignal
  ): Promise<void> {
    this.assertMutationTarget();
    const parameters = new URLSearchParams({
      promotedToRecommended: visibility.libraryRecommended ? '1' : '0',
      promotedToOwnHome: visibility.serverOwnerHome ? '1' : '0',
      promotedToSharedHome: visibility.usersHome ? '1' : '0',
    });
    await this.options.transport.put(
      `/hubs/sections/${encodeURIComponent(libraryId)}/manage/${encodeURIComponent(`custom.collection.${libraryId}.${ratingKey}`)}?${parameters}`,
      signal
    );
  }

  public async randomizeHubPosition(
    libraryId: string,
    ratingKey: string,
    randomValue: number,
    signal?: AbortSignal
  ): Promise<number> {
    this.assertMutationTarget();
    const identifier = `custom.collection.${libraryId}.${ratingKey}`;
    const managePath = `/hubs/sections/${encodeURIComponent(libraryId)}/manage`;
    const readIdentifiers = async (): Promise<string[]> => {
      const response = await this.options.transport.query(managePath, signal);
      return records(container(response).Hub)
        .map((hub) => text(hub.identifier))
        .filter(Boolean);
    };
    let identifiers = await readIdentifiers();
    if (!identifiers.includes(identifier)) {
      await this.options.transport.post(
        `${managePath}?metadataItemId=${encodeURIComponent(ratingKey)}`,
        signal
      );
      identifiers = await readIdentifiers();
    }
    if (!identifiers.includes(identifier)) {
      throw new Error(
        `Plex did not expose collection ${ratingKey} as a manageable hub.`
      );
    }
    const peers = identifiers.filter((value) => value !== identifier);
    const bounded = Number.isFinite(randomValue)
      ? Math.max(0, Math.min(0.999999999999, randomValue))
      : 0;
    const targetIndex = Math.floor(bounded * (peers.length + 1));
    const predecessor = targetIndex > 0 ? peers[targetIndex - 1] : undefined;
    const after = predecessor
      ? `?after=${encodeURIComponent(predecessor)}`
      : '';
    await this.options.transport.put(
      `${managePath}/${encodeURIComponent(identifier)}/move${after}`,
      signal
    );
    const verified = await readIdentifiers();
    if (verified.indexOf(identifier) !== targetIndex) {
      throw new Error(
        `Plex did not preserve the randomized Home position for collection ${ratingKey}.`
      );
    }
    return targetIndex + 1;
  }

  public async create(
    input: {
      title: string;
      libraryId: string;
      mediaType: 'episode' | 'movie' | 'season' | 'show';
    },
    signal?: AbortSignal
  ): Promise<string> {
    this.assertMutationTarget();
    const title = input.title.trim();
    if (!title) throw new Error('Collection title is required.');
    if (!/^\d+$/.test(input.libraryId)) {
      throw new Error('A numeric Plex library section ID is required.');
    }
    const parameters = new URLSearchParams({
      type: collectionType(input.mediaType),
      title,
      smart: '0',
      sectionId: input.libraryId,
    });
    const response = await this.options.transport.postJson(
      `/library/collections?${parameters}`,
      signal
    );
    const ratingKey = ratingKeyFromResponse(response);
    if (ratingKey) return ratingKey;

    const lookup = await this.options.transport.query(
      `/library/sections/${encodeURIComponent(input.libraryId)}/collections`,
      signal
    );
    const matches = records(container(lookup).Metadata).filter(
      (item) => text(item.title) === title
    );
    if (matches.length !== 1 || !text(matches[0]?.ratingKey)) {
      throw new Error(
        `Plex created "${title}" but its collection identity could not be verified.`
      );
    }
    return text(matches[0]!.ratingKey);
  }

  public async createUnwatchedSmart(
    input: {
      title: string;
      libraryId: string;
      mediaType: 'movie' | 'show';
      ownershipLabel: string;
    },
    signal?: AbortSignal
  ): Promise<string> {
    this.assertMutationTarget();
    if (!/^\d+$/.test(input.libraryId))
      throw new Error('A numeric Plex library section ID is required.');
    if (!input.title.trim()) throw new Error('Collection title is required.');
    if (!/^Vynode Collection [0-9a-f-]{36}$/.test(input.ownershipLabel))
      throw new Error('A valid Vynode collection ownership label is required.');
    const type = collectionType(input.mediaType);
    const filter = new URLSearchParams({
      type,
      label: input.ownershipLabel,
      unwatched: '1',
    });
    const uri = `server://${this.options.machineIdentifier}/com.plexapp.plugins.library/library/sections/${input.libraryId}/all?${filter}`;
    const parameters = new URLSearchParams({
      type,
      title: input.title.trim(),
      smart: '1',
      uri,
      sectionId: input.libraryId,
    });
    const response = await this.options.transport.postJson(
      `/library/collections?${parameters}`,
      signal
    );
    const ratingKey = ratingKeyFromResponse(response);
    if (!ratingKey)
      throw new Error(`Plex did not return an identity for "${input.title}".`);
    const snapshot = await this.snapshot(ratingKey, signal);
    if (!snapshot.smart || snapshot.libraryId !== input.libraryId)
      throw new Error(`Plex did not verify "${input.title}" as a smart collection.`);
    return ratingKey;
  }

  public async setManagedLabel(
    ratingKey: string,
    ownershipLabel: string,
    enabled: boolean,
    signal?: AbortSignal
  ): Promise<void> {
    this.assertMutationTarget();
    if (!/^Vynode Collection [0-9a-f-]{36}$/.test(ownershipLabel))
      throw new Error('A valid Vynode collection ownership label is required.');
    const encoded = encodeURIComponent(ratingKey);
    const response = await this.options.transport.query(
      `/library/metadata/${encoded}`,
      signal
    );
    const metadata = records(container(response).Metadata)[0];
    if (!metadata) throw new Error(`Plex item ${ratingKey} was not found.`);
    const labels = records(metadata.Label)
      .map((entry) => text(entry.tag).trim())
      .filter(Boolean);
    const retained = labels.filter(
      (label) => label.toLowerCase() !== ownershipLabel.toLowerCase()
    );
    const updated = enabled ? [...retained, ownershipLabel] : retained;
    if (
      labels.length === updated.length &&
      labels.every((label, index) => label === updated[index])
    ) return;
    const parameters = new URLSearchParams();
    if (updated.length) {
      updated.forEach((label, index) =>
        parameters.set(`label[${index}].tag.tag`, label)
      );
      parameters.set('label.locked', '1');
    } else parameters.set('label[0].tag.tag-', '');
    await this.options.transport.put(
      `/library/metadata/${encoded}?${parameters}`,
      signal
    );
  }

  public async membersWithManagedLabel(
    libraryId: string,
    mediaType: 'movie' | 'show',
    ownershipLabel: string,
    signal?: AbortSignal
  ): Promise<readonly string[]> {
    if (!/^\d+$/.test(libraryId))
      throw new Error('A numeric Plex library section ID is required.');
    const parameters = new URLSearchParams({
      type: collectionType(mediaType),
      label: ownershipLabel,
    });
    const response = await this.options.transport.query(
      `/library/sections/${encodeURIComponent(libraryId)}/all?${parameters}`,
      signal
    );
    return records(container(response).Metadata)
      .map((item) => text(item.ratingKey))
      .filter((key) => /^\d+$/.test(key));
  }

  public async rename(
    ratingKey: string,
    libraryId: string,
    title: string,
    signal?: AbortSignal
  ): Promise<void> {
    this.assertMutationTarget();
    if (!title.trim()) throw new Error('Collection title is required.');
    const parameters = new URLSearchParams({
      type: '18',
      id: ratingKey,
      'title.value': title.trim(),
      'title.locked': '1',
    });
    await this.options.transport.put(
      `/library/sections/${encodeURIComponent(libraryId)}/all?${parameters}`,
      signal
    );
  }

  public async addMembers(
    ratingKey: string,
    memberKeys: readonly string[],
    signal?: AbortSignal
  ): Promise<{ added: readonly string[]; failures: readonly string[] }> {
    this.assertMutationTarget();
    const snapshot = await this.snapshot(ratingKey, signal);
    this.assertRegular(snapshot);
    const current = new Set(snapshot.memberKeys);
    const pending = [...new Set(memberKeys)]
      .filter((key) => /^\d+$/.test(key) && !current.has(key));
    if (!pending.length) return { added: [], failures: [] };
    const path = this.addPath(ratingKey, pending);
    try {
      await this.options.transport.put(path, signal);
      return { added: pending, failures: [] };
    } catch (bulkError) {
      const added: string[] = [];
      const failures: string[] = [];
      for (const key of pending) {
        try {
          await this.options.transport.put(
            this.addPath(ratingKey, [key]),
            signal
          );
          added.push(key);
        } catch {
          if (signal?.aborted) throw bulkError;
          failures.push(key);
        }
      }
      return { added, failures };
    }
  }

  public async removeMembers(
    ratingKey: string,
    memberKeys: readonly string[],
    signal?: AbortSignal
  ): Promise<{ removed: readonly string[]; failures: readonly string[] }> {
    this.assertMutationTarget();
    const snapshot = await this.snapshot(ratingKey, signal);
    this.assertRegular(snapshot);
    const current = new Set(snapshot.memberKeys);
    const pending = [...new Set(memberKeys)].filter(
      (key) => /^\d+$/.test(key) && current.has(key)
    );
    const removed: string[] = [];
    const failures: string[] = [];
    for (const key of pending) {
      try {
        await this.options.transport.delete(
          `/library/collections/${encodeURIComponent(ratingKey)}/items/${encodeURIComponent(key)}`,
          signal
        );
        removed.push(key);
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push(key);
      }
    }
    return { removed, failures };
  }

  public async reorderMembers(
    ratingKey: string,
    desiredMemberKeys: readonly string[],
    signal?: AbortSignal
  ): Promise<{ moved: readonly string[]; failures: readonly string[] }> {
    this.assertMutationTarget();
    const snapshot = await this.snapshot(ratingKey, signal);
    this.assertRegular(snapshot);
    const desired = [...new Set(desiredMemberKeys)].filter((key) =>
      /^\d+$/.test(key)
    );
    if (
      snapshot.memberKeys.length !== desired.length ||
      desired.some((key) => !snapshot.memberKeys.includes(key))
    )
      throw new Error(
        `Cannot reorder Plex collection ${ratingKey} until membership exactly matches the desired items.`
      );
    const current = [...snapshot.memberKeys];
    const moved: string[] = [];
    const failures: string[] = [];
    for (let index = 0; index < desired.length; index += 1) {
      signal?.throwIfAborted();
      const item = desired[index]!;
      if (current[index] === item) continue;
      const parameters =
        index === 0
          ? ''
          : `?after=${encodeURIComponent(desired[index - 1]!)}`;
      try {
        await this.options.transport.put(
          `/library/collections/${encodeURIComponent(ratingKey)}/items/${encodeURIComponent(item)}/move${parameters}`,
          signal
        );
        const previousIndex = current.indexOf(item);
        if (previousIndex >= 0) current.splice(previousIndex, 1);
        current.splice(index, 0, item);
        moved.push(item);
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push(item);
      }
    }
    return { moved, failures };
  }

  public async delete(
    ratingKey: string,
    signal?: AbortSignal
  ): Promise<void> {
    this.assertMutationTarget();
    await this.options.transport.delete(
      `/library/collections/${encodeURIComponent(ratingKey)}`,
      signal
    );
  }

  private addPath(ratingKey: string, memberKeys: readonly string[]): string {
    const uri = `server://${this.options.machineIdentifier}/com.plexapp.plugins.library/library/metadata/${memberKeys.join(',')}`;
    return `/library/collections/${encodeURIComponent(ratingKey)}/items?uri=${encodeURIComponent(uri)}`;
  }

  private assertMutationTarget(): void {
    if (
      !this.options.allowedMutationServerNames.has(
        this.options.verifiedServerName
      )
    ) {
      throw new Error(
        `Plex collection mutation is blocked for server "${this.options.verifiedServerName}".`
      );
    }
  }

  private assertRegular(snapshot: PlexRegularCollectionSnapshot): void {
    if (snapshot.smart) {
      throw new Error(
        `Cannot modify members of smart Plex collection ${snapshot.ratingKey}.`
      );
    }
  }
}
