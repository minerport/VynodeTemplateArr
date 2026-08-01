import { createHash } from 'node:crypto';

import type { ChangePlan, PlannedChange } from '@vynode/contracts';
export * from './source-composition.js';

export interface CollectionMember {
  key: string;
  title: string;
}

export interface CollectionSnapshot {
  targetAdapterId: string;
  collectionKey: string;
  title: string;
  exists: boolean;
  members: readonly CollectionMember[];
  visibleOnHome: boolean;
  visibleInLibrary: boolean;
  visibleOnRecommended: boolean;
}

export interface DesiredCollection {
  targetAdapterId: string;
  collectionKey: string;
  title: string;
  members: readonly CollectionMember[];
  visibleOnHome: boolean;
  visibleInLibrary: boolean;
  visibleOnRecommended: boolean;
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

const hash = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex');

const changeId = (
  operation: PlannedChange['operation'],
  resourceKey: string,
  input: Readonly<Record<string, unknown>>
): string => hash({ operation, resourceKey, input }).slice(0, 24);

const makeChange = (
  change: Omit<PlannedChange, 'id' | 'dependsOn'> & {
    dependsOn?: readonly string[];
  }
): PlannedChange => ({
  ...change,
  id: changeId(change.operation, change.resourceKey, change.input),
  dependsOn: change.dependsOn ?? [],
});

export const planCollectionSync = (
  current: CollectionSnapshot,
  desired: DesiredCollection,
  createdAt: string
): ChangePlan => {
  if (
    current.targetAdapterId !== desired.targetAdapterId ||
    current.collectionKey !== desired.collectionKey
  ) {
    throw new Error('Current and desired collection identities must match');
  }

  const changes: PlannedChange[] = [];
  let createChangeId: string | undefined;

  if (!current.exists) {
    const create = makeChange({
      operation: 'collection.create',
      risk: 'reversible',
      targetAdapterId: desired.targetAdapterId,
      resourceKey: desired.collectionKey,
      summary: `Create collection "${desired.title}"`,
      input: { title: desired.title },
      inverse: {
        id: '',
        operation: 'collection.delete',
        risk: 'destructive',
        targetAdapterId: desired.targetAdapterId,
        resourceKey: desired.collectionKey,
        summary: `Delete collection "${desired.title}"`,
        input: {},
        dependsOn: [],
      },
    });
    changes.push(create);
    createChangeId = create.id;
  } else if (current.title !== desired.title) {
    changes.push(
      makeChange({
        operation: 'collection.update',
        risk: 'reversible',
        targetAdapterId: desired.targetAdapterId,
        resourceKey: desired.collectionKey,
        summary: `Rename collection to "${desired.title}"`,
        input: { title: desired.title },
        inverse: {
          id: '',
          operation: 'collection.update',
          risk: 'reversible',
          targetAdapterId: desired.targetAdapterId,
          resourceKey: desired.collectionKey,
          summary: `Restore collection title to "${current.title}"`,
          input: { title: current.title },
          dependsOn: [],
        },
      })
    );
  }

  const currentKeys = new Set(current.members.map((member) => member.key));
  const desiredKeys = new Set(desired.members.map((member) => member.key));
  const added = desired.members.filter((member) => !currentKeys.has(member.key));
  const removed = current.members.filter(
    (member) => !desiredKeys.has(member.key)
  );

  if (added.length > 0) {
    changes.push(
      makeChange({
        operation: 'collection.members.add',
        risk: 'reversible',
        targetAdapterId: desired.targetAdapterId,
        resourceKey: desired.collectionKey,
        summary: `Add ${added.length} collection member(s)`,
        input: { memberKeys: added.map((member) => member.key) },
        dependsOn: createChangeId ? [createChangeId] : [],
      })
    );
  }

  if (removed.length > 0) {
    changes.push(
      makeChange({
        operation: 'collection.members.remove',
        risk: 'reversible',
        targetAdapterId: desired.targetAdapterId,
        resourceKey: desired.collectionKey,
        summary: `Remove ${removed.length} collection member(s)`,
        input: { memberKeys: removed.map((member) => member.key) },
        dependsOn: createChangeId ? [createChangeId] : [],
      })
    );
  }

  const currentOrder = current.members
    .filter((member) => desiredKeys.has(member.key))
    .map((member) => member.key);
  const desiredOrder = desired.members.map((member) => member.key);
  if (stableJson(currentOrder) !== stableJson(desiredOrder)) {
    changes.push(
      makeChange({
        operation: 'collection.members.reorder',
        risk: 'reversible',
        targetAdapterId: desired.targetAdapterId,
        resourceKey: desired.collectionKey,
        summary: `Set order for ${desiredOrder.length} collection member(s)`,
        input: { memberKeys: desiredOrder },
        dependsOn: changes
          .filter((change) =>
            ['collection.create', 'collection.members.add'].includes(
              change.operation
            )
          )
          .map((change) => change.id),
      })
    );
  }

  const visibilityChanged =
    current.visibleOnHome !== desired.visibleOnHome ||
    current.visibleInLibrary !== desired.visibleInLibrary ||
    current.visibleOnRecommended !== desired.visibleOnRecommended;
  if (visibilityChanged) {
    changes.push(
      makeChange({
        operation: 'collection.visibility.update',
        risk: 'reversible',
        targetAdapterId: desired.targetAdapterId,
        resourceKey: desired.collectionKey,
        summary: 'Update collection visibility',
        input: {
          home: desired.visibleOnHome,
          library: desired.visibleInLibrary,
          recommended: desired.visibleOnRecommended,
        },
        dependsOn: createChangeId ? [createChangeId] : [],
      })
    );
  }

  const sourceSnapshotHash = hash(current);
  const policyHash = hash(desired);
  return {
    id: hash({ sourceSnapshotHash, policyHash, changes }).slice(0, 32),
    schemaVersion: 1,
    createdAt,
    sourceSnapshotHash,
    targetSnapshotHash: sourceSnapshotHash,
    policyHash,
    changes,
    warnings: [],
  };
};
