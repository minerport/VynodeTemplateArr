import assert from 'node:assert/strict';
import test from 'node:test';
import type { SeerrConfiguration } from './index.js';
import {
  HttpSeerrRequestCoordinator,
  type SeerrMissingMediaSettings,
} from './seerr-request.js';

const configuration: SeerrConfiguration = {
  revision: 1,
  endpoint: { hostname: 'seerr.local', port: 5055, useSsl: false, urlBase: '' },
  secretReference: 'vault:seerr',
  secretConfigured: true,
  radarr: { serverId: 1, profileId: 2, rootFolder: '/movies', tagIds: [] },
  sonarr: { serverId: 3, profileId: 4, rootFolder: '/tv', tagIds: [] },
  userCreationMode: 'per-service',
  verifiedAt: '2026-07-30T10:00:00.000Z',
};

const settings: SeerrMissingMediaSettings = {
  autoApproveMovies: true,
  autoApproveTv: true,
  maxSeasonsToRequest: 0,
  seasonsPerShowLimit: 2,
  seasonGrabOrder: 'latest',
  seerrRadarr: { serverId: 1, profileId: 2, rootFolder: '/movies' },
  seerrSonarr: { serverId: 3, profileId: 4, rootFolder: '/tv' },
};

test('Seerr sends exact movie and selected TV season request payloads', async () => {
  const payloads: unknown[] = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/tv/200'))
      return Response.json({
        seasons: [
          { seasonNumber: 0, episodeCount: 4 },
          { seasonNumber: 1, episodeCount: 10, airDate: '2020-01-01' },
          { seasonNumber: 2, episodeCount: 10, airDate: '2021-01-01' },
          { seasonNumber: 3, episodeCount: 10, airDate: '2022-01-01' },
        ],
      });
    if (url.endsWith('/request')) {
      payloads.push(JSON.parse(String(init?.body)));
      return Response.json({ id: payloads.length, status: 2 }, { status: 201 });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const coordinator = new HttpSeerrRequestCoordinator(
    () => 'secret',
    request as typeof fetch
  );

  const report = await coordinator.execute(
    configuration,
    [
      { key: 'movie', mediaType: 'movie', title: 'Movie', tmdbId: 100 },
      { key: 'show', mediaType: 'show', title: 'Show', tmdbId: 200, tvdbId: 300 },
    ],
    settings
  );

  assert.equal(report.added, 2);
  assert.deepEqual(payloads[0], {
    mediaType: 'movie',
    mediaId: 100,
    is4k: false,
    serverId: 1,
    profileId: 2,
    rootFolder: '/movies',
  });
  assert.deepEqual(payloads[1], {
    mediaType: 'tv',
    mediaId: 200,
    tvdbId: 300,
    seasons: [3, 2],
    is4k: false,
    serverId: 3,
    profileId: 4,
    rootFolder: '/tv',
  });
});

test('Seerr approves pending requests only when configured and treats conflicts as existing', async () => {
  const calls: string[] = [];
  const coordinator = new HttpSeerrRequestCoordinator(
    () => 'secret',
    (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/request'))
        return calls.filter((entry) => entry.endsWith('/request')).length === 1
          ? Response.json({ id: 9, status: 1 }, { status: 201 })
          : new Response(null, { status: 409 });
      if (url.endsWith('/request/9/approve'))
        return Response.json({ id: 9, status: 2 });
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch
  );

  const report = await coordinator.execute(
    configuration,
    [
      { key: 'one', mediaType: 'movie', title: 'One', tmdbId: 1 },
      { key: 'two', mediaType: 'movie', title: 'Two', tmdbId: 2 },
    ],
    settings
  );

  assert.equal(report.added, 1);
  assert.equal(report.existing, 1);
  assert.ok(calls.some((url) => url.endsWith('/request/9/approve')));
});

test('Seerr isolates failures, skips missing TMDB identity, and propagates cancellation', async () => {
  const coordinator = new HttpSeerrRequestCoordinator(
    () => 'secret',
    (async () => new Response(null, { status: 503 })) as typeof fetch
  );
  const report = await coordinator.execute(
    configuration,
    [
      { key: 'missing', mediaType: 'movie', title: 'Missing' },
      { key: 'failed', mediaType: 'movie', title: 'Failed', tmdbId: 5 },
    ],
    settings
  );
  assert.equal(report.skipped, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.executions[1]?.message, 'Seerr request failed with status 503.');

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    coordinator.execute(
      configuration,
      [{ key: 'cancel', mediaType: 'movie', title: 'Cancel', tmdbId: 8 }],
      settings,
      controller.signal
    ),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
  );
});

test('Seerr retries failed requests and reconciles media availability', async () => {
  const calls: string[] = [];
  const coordinator = new HttpSeerrRequestCoordinator(
    () => 'secret',
    (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/request/12/retry'))
        return Response.json({ id: 12, status: 2 });
      if (url.endsWith('/request/12'))
        return Response.json({ id: 12, status: 2, media: { status: 4 } });
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch
  );

  assert.equal(await coordinator.retry(configuration, 12), 'approved');
  assert.equal(await coordinator.status(configuration, 12), 'partially-available');
  assert.equal(calls.length, 2);
});
