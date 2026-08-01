import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PlaceholderCandidate } from './placeholder-lifecycle.js';

export interface TrailerProcessRunner {
  run(
    command: string,
    args: readonly string[],
    signal?: AbortSignal
  ): Promise<void>;
}

export interface PlaceholderMediaSource {
  media(
    candidate: PlaceholderCandidate,
    signal?: AbortSignal
  ): Promise<Uint8Array>;
}

const safeCacheName = (candidate: PlaceholderCandidate): string => {
  const identity =
    candidate.tmdbId ?? candidate.tvdbId ?? candidate.key.replace(/\W+/g, '-');
  return `${candidate.mediaType}-${identity}.mp4`;
};

export class SpawnTrailerProcessRunner implements TrailerProcessRunner {
  public async run(
    command: string,
    args: readonly string[],
    signal?: AbortSignal
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [...args], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        ...(signal ? { signal } : {}),
      });
      let errorOutput = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        errorOutput = `${errorOutput}${chunk}`.slice(-8_192);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `yt-dlp exited with code ${code ?? 'unknown'}${
                errorOutput.trim() ? `: ${errorOutput.trim()}` : ''
              }`
            )
          );
      });
    });
  }
}

export interface YtDlpTrailerMediaSourceOptions {
  cacheDirectory: string;
  genericMedia: Uint8Array;
  skipYoutube: () => boolean;
  cookiesPath?: string;
  executable?: string;
  ffmpegLocation?: string;
  useSystemCertificates?: boolean;
  javascriptRuntime?: string;
  maximumDurationSeconds?: number;
  runner?: TrailerProcessRunner;
}

export class YtDlpTrailerMediaSource implements PlaceholderMediaSource {
  private readonly runner: TrailerProcessRunner;

  public constructor(
    private readonly options: YtDlpTrailerMediaSourceOptions
  ) {
    if (!options.genericMedia.byteLength)
      throw new Error('Generic placeholder media cannot be empty.');
    this.runner = options.runner ?? new SpawnTrailerProcessRunner();
  }

  public async media(
    candidate: PlaceholderCandidate,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    signal?.throwIfAborted();
    if (this.options.skipYoutube()) return this.options.genericMedia;
    await mkdir(this.options.cacheDirectory, { recursive: true });
    const cached = path.join(
      this.options.cacheDirectory,
      safeCacheName(candidate)
    );
    try {
      if ((await stat(cached)).size > 0)
        return new Uint8Array(await readFile(cached));
    } catch {
      // A cache miss is the normal download path.
    }
    const temporary = `${cached}.${process.pid}.${Date.now()}.part`;
    const query = `${candidate.title}${
      candidate.year ? ` ${candidate.year}` : ''
    } official trailer`;
    const args = [
      ...(this.options.useSystemCertificates
        ? ['--compat-options', 'no-certifi']
        : []),
      ...(this.options.javascriptRuntime
        ? ['--js-runtimes', `deno:${this.options.javascriptRuntime}`]
        : []),
      '--no-playlist',
      '--break-on-reject',
      '--match-filter',
      `duration <= ${this.options.maximumDurationSeconds ?? 210}`,
      '--max-filesize',
      '150M',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      '--socket-timeout',
      '20',
      '-f',
      'best[height<=1080][ext=mp4]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]',
      '--merge-output-format',
      'mp4',
      '--output',
      temporary,
    ];
    if (this.options.cookiesPath) {
      try {
        await stat(this.options.cookiesPath);
        args.push('--cookies', this.options.cookiesPath);
      } catch {
        // Cookies are optional. yt-dlp can still attempt an anonymous download.
      }
    }
    if (this.options.ffmpegLocation)
      args.push('--ffmpeg-location', this.options.ffmpegLocation);
    args.push(`ytsearch1:${query}`);
    try {
      await this.runner.run(
        this.options.executable ?? 'yt-dlp',
        args,
        signal
      );
      signal?.throwIfAborted();
      if ((await stat(temporary)).size === 0)
        throw new Error('yt-dlp produced an empty trailer.');
      await rename(temporary, cached);
      return new Uint8Array(await readFile(cached));
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        throw error;
      return this.options.genericMedia;
    }
  }
}
