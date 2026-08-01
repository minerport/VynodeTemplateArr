import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  FilePlaceholderInventoryRepository,
  MountedDirectoryBrowser,
  PlaceholderSettingsService,
  type PlaceholderSettings,
} from '@vynode/downloads';
import type { PlexServerConfiguration } from '@vynode/media-servers';
import { SqliteJsonRepository, type VynodeSqliteStorage } from '@vynode/storage';

export class ProductionPlaceholderServices {
  public readonly settings: PlaceholderSettingsService;
  public readonly inventory: FilePlaceholderInventoryRepository;
  public readonly directoryBrowser: MountedDirectoryBrowser;
  readonly #values: SqliteJsonRepository<PlaceholderSettings>;
  readonly #cookiesPath: string;

  public constructor(
    storage: VynodeSqliteStorage,
    dataDirectory: string,
    mediaRoots: readonly string[],
    plexConfiguration: () => Promise<PlexServerConfiguration | undefined>
  ) {
    this.#values = new SqliteJsonRepository(storage, 'placeholder-settings');
    if (!this.#values.get('settings')) {
      this.#values.put('settings', { revision: 0, libraryRoots: {}, skipYoutubeTrailerDownloads: false });
    }
    this.settings = new PlaceholderSettingsService(
      {
        get: async () => structuredClone(this.#values.get('settings')!.value),
        compareAndSet: async (expectedRevision, next) => {
          const current = this.#values.get('settings')!;
          if (current.value.revision !== expectedRevision) return false;
          try { this.#values.put('settings', next, current.revision); return true; }
          catch (error) { if (error instanceof Error && /changed/.test(error.message)) return false; throw error; }
        },
      },
      async () => new Set((await plexConfiguration())?.libraries.filter((library) => library.available && (library.type === 'movie' || library.type === 'show')).map((library) => library.key) ?? []),
      mediaRoots
    );
    this.inventory = new FilePlaceholderInventoryRepository(resolve(dataDirectory, 'placeholders', 'inventory.json'));
    this.directoryBrowser = new MountedDirectoryBrowser(mediaRoots, {
      async directories(absolutePath) {
        return (await readdir(absolutePath, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      },
    });
    this.#cookiesPath = resolve(dataDirectory, 'youtube-cookies.txt');
  }

  public async youtubeCookieStatus() {
    const settings = await this.settings.get();
    const present = await stat(this.#cookiesPath).then((value) => value.isFile() && value.size > 0).catch(() => false);
    return {
      state: settings.skipYoutubeTrailerDownloads
        ? ('present-but-disabled' as const)
        : present ? ('ready' as const) : ('missing' as const),
      fileName: 'youtube-cookies.txt',
    };
  }
}
