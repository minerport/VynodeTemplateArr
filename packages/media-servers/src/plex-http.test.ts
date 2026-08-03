import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import test from 'node:test';

import {
  PlexHttpTransport,
  PlexManagementClient,
  PlexTransportError,
} from './plex-http.js';

interface CapturedRequest {
  method: string;
  url: string;
  token?: string;
  contentType?: string;
  body: Buffer;
}

const withServer = async (
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (port: number) => Promise<void>
) => {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
};

const transportFor = (
  port: number,
  overrides: Partial<ConstructorParameters<typeof PlexHttpTransport>[0]> = {}
) =>
  new PlexHttpTransport({
    connection: {
      host: '127.0.0.1',
      port,
      transport: 'http',
      autoEmptyTrash: false,
    },
    token: async () => 'owner-secret-token',
    clientIdentifier: 'vynode-test-installation',
    timeoutMs: 1_000,
    ...overrides,
  });

test('sends Plex authentication in headers and parses JSON without exposing the token in the URL', async () => {
  await withServer(
    (request, response) => {
      assert.equal(request.method, 'GET');
      assert.equal(request.url, '/hubs/sections/1/manage');
      assert.equal(request.headers['x-plex-token'], 'owner-secret-token');
      assert.equal(
        request.headers['x-plex-client-identifier'],
        'vynode-test-installation'
      );
      assert.equal(request.headers.accept, 'application/json');
      response.setHeader('content-type', 'application/json');
      response.end('{"MediaContainer":{"size":1}}');
    },
    async (port) => {
      const result = await transportFor(port).query('/hubs/sections/1/manage');
      assert.deepEqual(result, { MediaContainer: { size: 1 } });
    }
  );
});

test('emits the exact Plex visibility, ordering, sort-title, and binary asset mutation payloads', async () => {
  const captured: CapturedRequest[] = [];
  await withServer(
    (request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        captured.push({
          method: request.method ?? '',
          url: request.url ?? '',
          ...(typeof request.headers['x-plex-token'] === 'string'
            ? { token: request.headers['x-plex-token'] }
            : {}),
          ...(typeof request.headers['content-type'] === 'string'
            ? { contentType: request.headers['content-type'] }
            : {}),
          body: Buffer.concat(chunks),
        });
        response.statusCode = 200;
        response.end();
      });
    },
    async (port) => {
      const client = new PlexManagementClient(transportFor(port));
      await client.updateDiscoveredVisibility(
        {
          kind: 'pre-existing-collection',
          libraryId: '1',
          plexKey: '35954',
        },
        {
          usersHome: false,
          serverOwnerHome: true,
          libraryRecommended: true,
        }
      );
      await client.updateHubVisibility('1', 'movie.recentlyadded', {
        usersHome: true,
        serverOwnerHome: false,
        libraryRecommended: true,
      });
      await client.moveHub('1', 'movie.recentlyadded', 'movie.toprated');
      await client.updateCollectionSortTitle('35954', 'Awards First');
      await client.updateCollectionSummary(
        '35954',
        'Award winners & favorites'
      );
      await client.uploadCollectionAsset(
        '35954',
        'poster',
        new Uint8Array([1, 2, 3])
      );
    }
  );

  assert.deepEqual(
    captured.map((item) => [item.method, item.url]),
    [
      ['GET', '/hubs/sections/1/manage'],
      ['POST', '/hubs/sections/1/manage?metadataItemId=35954'],
      [
        'PUT',
        '/hubs/sections/1/manage/custom.collection.1.35954?promotedToRecommended=1&promotedToOwnHome=1&promotedToSharedHome=0',
      ],
      [
        'PUT',
        '/hubs/sections/1/manage/movie.recentlyadded?promotedToRecommended=1&promotedToOwnHome=0&promotedToSharedHome=1',
      ],
      [
        'PUT',
        '/hubs/sections/1/manage/movie.recentlyadded/move?after=movie.toprated',
      ],
      [
        'PUT',
        '/library/metadata/35954?type=18&id=35954&titleSort.value=Awards+First&titleSort.locked=1',
      ],
      ['PUT', '/library/metadata/35954?summary=Award+winners+%26+favorites'],
      ['POST', '/library/metadata/35954/posters'],
      ['PUT', '/library/metadata/35954?thumb.locked=1'],
    ]
  );
  assert.equal(captured[7]?.contentType, 'application/octet-stream');
  assert.deepEqual(captured[7]?.body, Buffer.from([1, 2, 3]));
  assert.ok(captured.every((item) => item.token === 'owner-secret-token'));
});

test('uploads item posters and preserves unrelated labels when toggling Overlay', async () => {
  const captured: CapturedRequest[] = [];
  let metadataRead = 0;
  await withServer(
    (request, response) => {
      captured.push({
        method: request.method ?? '',
        url: request.url ?? '',
        body: Buffer.alloc(0),
      });
      if (request.method === 'GET') {
        metadataRead += 1;
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            MediaContainer: {
              Metadata: [
                {
                  Label:
                    metadataRead === 1
                      ? [{ tag: 'Favorite' }, { tag: 'overlay' }]
                      : [{ tag: 'Favorite' }],
                },
              ],
            },
          })
        );
        return;
      }
      response.statusCode = 200;
      response.end();
    },
    async (port) => {
      const client = new PlexManagementClient(transportFor(port));
      await client.uploadPoster('movie/101', new Uint8Array([4, 5, 6]));
      await client.setOverlayLabel('movie/101', false);
      await client.setOverlayLabel('movie/101', true);
      await client.unlockPoster('movie/101');
      await client.refreshMetadata('movie/101');
      await client.markUnplayed('movie/101');
    }
  );

  assert.deepEqual(
    captured.map((item) => [item.method, item.url]),
    [
      ['POST', '/library/metadata/movie%2F101/posters'],
      ['PUT', '/library/metadata/movie%2F101?thumb.locked=1'],
      ['GET', '/library/metadata/movie%2F101'],
      [
        'PUT',
        '/library/metadata/movie%2F101?label%5B0%5D.tag.tag=Favorite&label.locked=1',
      ],
      ['GET', '/library/metadata/movie%2F101'],
      [
        'PUT',
        '/library/metadata/movie%2F101?label%5B0%5D.tag.tag=Favorite&label%5B1%5D.tag.tag=Overlay&label.locked=1',
      ],
      ['PUT', '/library/metadata/movie%2F101?thumb.locked=0'],
      ['PUT', '/library/metadata/movie%2F101/refresh'],
      [
        'PUT',
        '/:/unscrobble?key=movie%2F101&identifier=com.plexapp.plugins.library',
      ],
    ]
  );
});

test('redacts credentials from authentication and malformed-response errors', async () => {
  let requestCount = 0;
  await withServer(
    (_request, response) => {
      requestCount += 1;
      if (requestCount === 1) {
        response.statusCode = 401;
        response.end('owner-secret-token');
      } else {
        response.statusCode = 200;
        response.end('<MediaContainer />');
      }
    },
    async (port) => {
      await assert.rejects(
        () => transportFor(port).query('/'),
        (error: unknown) => {
          assert.ok(error instanceof PlexTransportError);
          assert.equal(error.code, 'authentication');
          assert.doesNotMatch(error.message, /owner-secret-token/);
          return true;
        }
      );
      await assert.rejects(
        () => transportFor(port).query('/'),
        (error: unknown) => {
          assert.ok(error instanceof PlexTransportError);
          assert.equal(error.code, 'invalid-json');
          assert.doesNotMatch(error.message, /owner-secret-token/);
          return true;
        }
      );
    }
  );
});

test('does not re-promote a collection that is already present in Plex hub management', async () => {
  const methods: string[] = [];
  await withServer(
    (request, response) => {
      methods.push(request.method ?? '');
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        request.method === 'GET'
          ? '{"MediaContainer":{"Hub":[{"identifier":"custom.collection.1.35954"}]}}'
          : ''
      );
    },
    async (port) => {
      await new PlexManagementClient(
        transportFor(port)
      ).updateDiscoveredVisibility(
        {
          kind: 'pre-existing-collection',
          libraryId: '1',
          plexKey: '35954',
        },
        {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
        }
      );
    }
  );
  assert.deepEqual(methods, ['GET', 'PUT']);
});

test('enforces response limits and supports AbortSignal cancellation', async () => {
  let requestCount = 0;
  await withServer(
    (_request, response) => {
      requestCount += 1;
      if (requestCount === 1) {
        response.end('{"value":"too large"}');
        return;
      }
      setTimeout(() => response.end('{"late":true}'), 150);
    },
    async (port) => {
      await assert.rejects(
        () => transportFor(port, { maxResponseBytes: 5 }).query('/too-large'),
        (error: unknown) =>
          error instanceof PlexTransportError &&
          error.code === 'response-too-large'
      );
      const controller = new AbortController();
      const pending = transportFor(port).query('/slow', controller.signal);
      controller.abort();
      await assert.rejects(
        () => pending,
        (error: unknown) =>
          error instanceof PlexTransportError && error.code === 'aborted'
      );
    }
  );
});
