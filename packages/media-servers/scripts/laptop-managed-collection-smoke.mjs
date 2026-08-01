import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  ManagedCollectionSynchronizer,
  PlexHttpTransport,
  PlexManagedCollectionClient,
} from '../dist/index.js';

const statePath = process.argv[3];
const mode = process.argv[2];
if (!['create', 'unwatched', 'cleanup'].includes(mode) || !statePath) {
  throw new Error(
    'Usage: node laptop-managed-collection-smoke.mjs create|unwatched|cleanup <state-path>'
  );
}

const token = process.env.VYNODE_DEV_PLEX_TOKEN?.trim();
if (!token) throw new Error('VYNODE_DEV_PLEX_TOKEN is required.');

const connection = {
  host: '127.0.0.1',
  port: 32400,
  transport: 'http',
  autoEmptyTrash: false,
};
const transport = new PlexHttpTransport({
  connection,
  token: async () => token,
  clientIdentifier: 'vynode-laptop-managed-collection-smoke',
  product: 'Vynode Laptop Smoke Test',
});
const identityResponse = await transport.query('/');
const identity = identityResponse?.MediaContainer;
if (identity?.friendlyName !== 'Laptop') {
  throw new Error(
    `Smoke test is restricted to Laptop; received "${identity?.friendlyName ?? 'unknown'}".`
  );
}
const client = new PlexManagedCollectionClient({
  transport,
  machineIdentifier: String(identity.machineIdentifier),
  verifiedServerName: String(identity.friendlyName),
  allowedMutationServerNames: new Set(['Laptop']),
});

if (mode === 'cleanup') {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (state.ownershipLabel && Array.isArray(state.memberKeys)) {
    for (const ratingKey of state.memberKeys)
      await client.setManagedLabel(
        String(ratingKey),
        String(state.ownershipLabel),
        false
      );
  }
  await client.delete(String(state.ratingKey));
  await rm(statePath, { force: true });
  process.stdout.write(
    `${JSON.stringify({ server: 'Laptop', deleted: state.ratingKey })}\n`
  );
} else {
  const libraryResponse = await transport.query(
    '/library/sections/1/all?type=1&sort=titleSort&X-Plex-Container-Start=0&X-Plex-Container-Size=2'
  );
  const members = Array.isArray(libraryResponse?.MediaContainer?.Metadata)
    ? libraryResponse.MediaContainer.Metadata
    : [];
  const memberKeys = members
    .map((item) => String(item.ratingKey ?? ''))
    .filter(Boolean)
    .slice(0, 2);
  if (memberKeys.length < 2) {
    throw new Error('Laptop Movies requires at least two items for this test.');
  }
  const title = `Vynode Integration Test ${Date.now()}`;
  const ownershipLabel =
    mode === 'unwatched'
      ? `Vynode Collection ${crypto.randomUUID()}`
      : undefined;
  if (ownershipLabel)
    for (const ratingKey of memberKeys)
      await client.setManagedLabel(ratingKey, ownershipLabel, true);
  const ratingKey = ownershipLabel
    ? await client.createUnwatchedSmart({
        title,
        libraryId: '1',
        mediaType: 'movie',
        ownershipLabel,
      })
    : await client.create({
        title,
        libraryId: '1',
        mediaType: 'movie',
      });
  let finalRatingKey = ratingKey;
  try {
    const addition = ownershipLabel
      ? { failures: [] }
      : await client.addMembers(ratingKey, memberKeys);
    if (addition.failures.length) {
      throw new Error(
        `Failed to add ${addition.failures.length} temporary collection members.`
      );
    }
    const snapshot = await client.snapshot(ratingKey);
    if (
      snapshot.title !== title ||
      snapshot.smart !== Boolean(ownershipLabel) ||
      (!ownershipLabel && snapshot.memberKeys.length !== memberKeys.length)
    ) {
      throw new Error('Temporary collection verification did not match.');
    }
    await client.updateHubVisibility('1', ratingKey, {
      usersHome: false,
      serverOwnerHome: true,
      libraryRecommended: true,
    });
    const hubIdentifier = `custom.collection.1.${ratingKey}`;
    const hubIdentifiers = async () => {
      const response = await transport.query('/hubs/sections/1/manage');
      return (Array.isArray(response?.MediaContainer?.Hub)
        ? response.MediaContainer.Hub
        : []
      )
        .map((hub) => String(hub.identifier ?? ''))
        .filter(Boolean);
    };
    const beforePosition = await client.randomizeHubPosition(
      '1',
      ratingKey,
      0
    );
    const positionedHubs = await hubIdentifiers();
    const randomValue = beforePosition === positionedHubs.length ? 0 : 0.999999;
    const randomizedPosition = await client.randomizeHubPosition(
      '1',
      ratingKey,
      randomValue
    );
    const afterHubs = await hubIdentifiers();
    const verifiedPosition = afterHubs.indexOf(hubIdentifier) + 1;
    if (
      beforePosition < 1 ||
      randomizedPosition !== verifiedPosition ||
      beforePosition === verifiedPosition
    ) {
      throw new Error(
        `Randomized Home position verification did not match (before ${beforePosition}, returned ${randomizedPosition}, verified ${verifiedPosition}, hubs ${afterHubs.length}).`
      );
    }
    let convertedRatingKey;
    if (ownershipLabel) {
      const collectionId = ownershipLabel.slice('Vynode Collection '.length);
      const conversion = await new ManagedCollectionSynchronizer(
        client
      ).synchronize(
        {
          id: collectionId,
          title,
          description: '',
          mediaType: 'movie',
          libraryId: '1',
          libraryName: 'Movies',
          sourceType: 'manual',
          itemCount: memberKeys.length,
          homeVisible: true,
          recommendedVisible: true,
          libraryVisible: true,
          sharedOrder: 0,
          libraryOrder: 0,
          status: 'ready',
          plexRatingKey: ratingKey,
          behaviorSettings: {
            visibility: {
              usersHome: false,
              serverOwnerHome: true,
              libraryRecommended: true,
            },
            randomizeHomeOrder: false,
            showUnwatchedOnly: false,
            smartCollectionSort: 'titleAsc',
            timeRestriction: {
              alwaysActive: true,
              removeFromPlexWhenInactive: false,
              inactiveVisibility: {
                usersHome: false,
                serverOwnerHome: false,
                libraryRecommended: false,
              },
              dateRanges: [],
              weeklySchedule: {
                monday: true,
                tuesday: true,
                wednesday: true,
                thursday: true,
                friday: true,
                saturday: true,
                sunday: true,
              },
            },
            syncSchedule: {
              enabled: false,
              scheduleType: 'preset',
              preset: '1d',
              customCron: '',
              startNow: true,
              startDate: '01-01',
              startTime: '09:00',
            },
          },
        },
        memberKeys
      );
      const converted = await client.snapshot(conversion.plexRatingKey);
      if (converted.smart || converted.memberKeys.length !== memberKeys.length)
        throw new Error(
          `Reverse smart-to-regular verification did not match (old ${ratingKey}, new ${conversion.plexRatingKey}, smart ${converted.smart}, members ${converted.memberKeys.length}, expected ${memberKeys.length}, report-members ${conversion.verifiedMemberKeys.length}, failures ${conversion.failures.join(',')}).`
        );
      finalRatingKey = conversion.plexRatingKey;
      convertedRatingKey = conversion.plexRatingKey;
    }
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(
      statePath,
      `${JSON.stringify({ ratingKey: finalRatingKey, title, memberKeys, beforePosition, verifiedPosition, ...(ownershipLabel ? { ownershipLabel, smartRatingKey: ratingKey, convertedRatingKey } : {}) }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    process.stdout.write(
      `${JSON.stringify({
        server: 'Laptop',
        ratingKey,
        title,
        memberCount: snapshot.memberKeys.length,
        smart: snapshot.smart,
        beforePosition,
        verifiedPosition,
        ...(convertedRatingKey ? { convertedRatingKey } : {}),
      })}\n`
    );
  } catch (error) {
    await client.delete(finalRatingKey).catch(() => undefined);
    if (ownershipLabel)
      for (const memberKey of memberKeys)
        await client
          .setManagedLabel(memberKey, ownershipLabel, false)
          .catch(() => undefined);
    throw error;
  }
}
