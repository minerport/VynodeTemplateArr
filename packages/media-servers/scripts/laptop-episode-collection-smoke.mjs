import {
  PlexHttpTransport,
  PlexManagedCollectionClient,
} from '../dist/index.js';

const token = process.env.VYNODE_DEV_PLEX_TOKEN?.trim();
if (!token) throw new Error('VYNODE_DEV_PLEX_TOKEN is required.');
const transport = new PlexHttpTransport({
  connection: {
    host: '127.0.0.1',
    port: 32400,
    transport: 'http',
    autoEmptyTrash: false,
  },
  token: async () => token,
  clientIdentifier: 'vynode-laptop-episode-collection-smoke',
  product: 'Vynode Laptop Episode Smoke Test',
});
const identity = (await transport.query('/'))?.MediaContainer;
if (identity?.friendlyName !== 'Laptop')
  throw new Error('Episode smoke test is restricted to Laptop.');
const sections = (await transport.query('/library/sections'))?.MediaContainer
  ?.Directory;
const library = (Array.isArray(sections) ? sections : []).find(
  (item) => item?.type === 'show'
);
if (!library?.key) throw new Error('Laptop has no TV library.');
const libraryId = String(library.key);
const payload = await transport.query(
  `/library/sections/${encodeURIComponent(libraryId)}/all?type=4&sort=titleSort&X-Plex-Container-Start=0&X-Plex-Container-Size=2`
);
const episodes = Array.isArray(payload?.MediaContainer?.Metadata)
  ? payload.MediaContainer.Metadata
  : [];
const memberKeys = episodes
  .map((item) => String(item?.ratingKey ?? ''))
  .filter(Boolean)
  .slice(0, 2);
if (memberKeys.length < 2)
  throw new Error('Laptop TV library requires at least two episodes.');
const client = new PlexManagedCollectionClient({
  transport,
  machineIdentifier: String(identity.machineIdentifier),
  verifiedServerName: 'Laptop',
  allowedMutationServerNames: new Set(['Laptop']),
});
const title = `Vynode Episode Integration Test ${Date.now()}`;
let ratingKey;
try {
  ratingKey = await client.create({ title, libraryId, mediaType: 'episode' });
  const addition = await client.addMembers(ratingKey, memberKeys);
  if (addition.failures.length)
    throw new Error(`Failed to add ${addition.failures.length} episode members.`);
  const snapshot = await client.snapshot(ratingKey);
  if (
    snapshot.title !== title ||
    snapshot.smart ||
    snapshot.memberKeys.length !== memberKeys.length
  )
    throw new Error('Temporary episode collection verification did not match.');
  process.stdout.write(
    `${JSON.stringify({ server: 'Laptop', libraryId, ratingKey, memberKeys, verifiedMembers: snapshot.memberKeys })}\n`
  );
} finally {
  if (ratingKey) await client.delete(ratingKey).catch(() => undefined);
}
