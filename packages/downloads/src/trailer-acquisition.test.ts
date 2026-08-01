import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  YtDlpTrailerMediaSource,
  type TrailerProcessRunner,
} from './trailer-acquisition.js';

const candidate = {
  key: 'movie:tmdb:42',
  mediaType: 'movie' as const,
  title: 'The Future',
  year: 2027,
  tmdbId: 42,
};

test('downloads and caches the first bounded official trailer search result', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vynode-trailer-'));
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: TrailerProcessRunner = {
    async run(command, args) {
      calls.push({ command, args });
      const output = args[args.indexOf('--output') + 1]!;
      await writeFile(output, new Uint8Array([9, 8, 7]));
    },
  };
  const source = new YtDlpTrailerMediaSource({
    cacheDirectory: directory,
    genericMedia: new Uint8Array([1]),
    skipYoutube: () => false,
    runner,
  });

  assert.deepEqual(
    Array.from(await source.media(candidate)),
    [9, 8, 7]
  );
  assert.deepEqual(
    Array.from(await source.media(candidate)),
    [9, 8, 7]
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, 'yt-dlp');
  assert.ok(calls[0]?.args.includes('duration <= 210'));
  assert.ok(
    calls[0]?.args.includes('ytsearch1:The Future 2027 official trailer')
  );
  assert.deepEqual(
    await readFile(path.join(directory, 'movie-42.mp4')),
    Buffer.from([9, 8, 7])
  );
});

test('uses generic media when disabled or when yt-dlp fails', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vynode-trailer-'));
  const generic = new Uint8Array([1, 2, 3]);
  const failing: TrailerProcessRunner = {
    async run() {
      throw new Error('network failed');
    },
  };
  const disabled = new YtDlpTrailerMediaSource({
    cacheDirectory: directory,
    genericMedia: generic,
    skipYoutube: () => true,
    runner: failing,
  });
  const fallback = new YtDlpTrailerMediaSource({
    cacheDirectory: directory,
    genericMedia: generic,
    skipYoutube: () => false,
    runner: failing,
  });

  assert.deepEqual(await disabled.media(candidate), generic);
  assert.deepEqual(await fallback.media(candidate), generic);
});
