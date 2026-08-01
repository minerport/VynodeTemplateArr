import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ImdbClient,
  parseImdbHtml,
  parseImdbTitleHtml,
  parseImdbListUrl,
  ResilientImdbTransport,
  type ImdbTransport,
} from './imdb.js';

const jsonLd = `<script type="application/ld+json">${JSON.stringify({
  '@type': 'ItemList',
  itemListElement: [
    { item: { '@type': 'Movie', url: 'https://www.imdb.com/title/tt0111161/', name: 'The Shawshank Redemption', datePublished: '1994-09-23' } },
    { item: { '@type': 'TVSeries', url: 'https://www.imdb.com/title/tt0903747/', name: 'Breaking Bad', datePublished: '2008-01-20' } },
  ],
})}</script>`;

test('validates IMDb custom list URLs and parses chart JSON-LD by media type', () => {
  assert.equal(
    parseImdbListUrl('https://imdb.com/list/ls123456789').toString(),
    'https://www.imdb.com/list/ls123456789/'
  );
  assert.throws(() => parseImdbListUrl('https://example.com/list/ls1'));
  assert.deepEqual(parseImdbHtml(jsonLd, 'movie'), [{
    imdbId: 'tt0111161',
    title: 'The Shawshank Redemption',
    mediaType: 'movie',
    year: 1994,
  }]);
  assert.deepEqual(parseImdbHtml(jsonLd, 'show'), [{
    imdbId: 'tt0903747',
    title: 'Breaking Bad',
    mediaType: 'show',
    year: 2008,
  }]);
});

test('parses reusable title metadata for overlay enrichment', async () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'TVSeries',
    url: 'https://www.imdb.com/title/tt7235466/',
    name: '9-1-1',
    alternateName: '911',
    description: 'First responders face emergencies.',
    contentRating: 'TV-14',
    genre: ['Action', 'Drama'],
    keywords: 'first responder,firefighter,police officer',
    duration: 'PT43M',
    datePublished: '2018-01-03',
    aggregateRating: { ratingValue: 7.9, ratingCount: 61000 },
    actor: [{ name: 'Angela Bassett' }, { name: 'Peter Krause' }],
    director: [{ name: 'Bradley Buecker' }],
    creator: [{ name: 'Ryan Murphy' }],
  })}</script>`;
  assert.deepEqual(parseImdbTitleHtml(html, 'tt7235466'), {
    imdbId: 'tt7235466',
    title: '9-1-1',
    alternateTitle: '911',
    description: 'First responders face emergencies.',
    contentRating: 'TV-14',
    genres: ['Action', 'Drama'],
    keywords: ['first responder', 'firefighter', 'police officer'],
    actors: ['Angela Bassett', 'Peter Krause'],
    directors: ['Bradley Buecker'],
    creators: ['Ryan Murphy'],
    rating: 7.9,
    ratingCount: 61000,
    durationMinutes: 43,
    releaseDate: '2018-01-03',
  });
  const client = new ImdbClient({
    async get(url) {
      assert.equal(url, 'https://www.imdb.com/title/tt7235466/');
      return { status: 200, body: html };
    },
  });
  assert.equal((await client.title('tt7235466')).contentRating, 'TV-14');
});

test('normalizes, limits, and ranks IMDb source results', async () => {
  const transport: ImdbTransport = {
    async get() { return { status: 200, body: jsonLd }; },
  };
  assert.deepEqual(await new ImdbClient(transport).source({
    mediaType: 'movie',
    subtype: 'top_250',
    limit: 1,
  }), [{
    imdbId: 'tt0111161',
    title: 'The Shawshank Redemption',
    mediaType: 'movie',
    year: 1994,
    rank: 0,
  }]);
});

test('reports IMDb WAF challenges and invalid empty payloads instead of succeeding', async () => {
  await assert.rejects(
    new ImdbClient({ async get() { return { status: 202, body: '' }; } }).source({
      mediaType: 'movie',
      subtype: 'popular',
      limit: 10,
    }),
    /web-application firewall/
  );
  await assert.rejects(
    new ImdbClient({ async get() { return { status: 200, body: '<html />' }; } }).source({
      mediaType: 'show',
      subtype: 'popular',
      limit: 10,
    }),
    /no recognizable list items/
  );
});

test('falls back to the browser only for IMDb WAF responses', async () => {
  const calls: string[] = [];
  const direct: ImdbTransport = {
    async get() {
      calls.push('direct');
      return { status: 202, body: 'challenge' };
    },
  };
  const browser: ImdbTransport = {
    async get() {
      calls.push('browser');
      return { status: 200, body: jsonLd };
    },
  };
  const response = await new ResilientImdbTransport(direct, browser).get(
    'https://www.imdb.com/chart/top/'
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['direct', 'browser']);

  calls.length = 0;
  const directSuccess: ImdbTransport = {
    async get() {
      calls.push('direct');
      return { status: 200, body: jsonLd };
    },
  };
  await new ResilientImdbTransport(directSuccess, browser).get(
    'https://www.imdb.com/chart/top/'
  );
  assert.deepEqual(calls, ['direct']);
});
