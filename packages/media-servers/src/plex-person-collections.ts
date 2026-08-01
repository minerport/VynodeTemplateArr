import type { PlexHttpTransport } from './plex-http.js';

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null ? (value as JsonRecord) : undefined;
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

export type PlexPersonKind = 'actors' | 'directors';

export interface PlexPersonCount {
  name: string;
  count: number;
}

export interface PlexPersonCollectionClientOptions {
  transport: Pick<PlexHttpTransport, 'delete' | 'postJson' | 'query'>;
  machineIdentifier: string;
  verifiedServerName: string;
  allowedMutationServerNames: ReadonlySet<string>;
}

export class PlexPersonCollectionClient {
  public constructor(private readonly options: PlexPersonCollectionClientOptions) {
    if (!options.machineIdentifier.trim())
      throw new Error('The verified Plex machine identifier is required.');
  }

  public async people(
    libraryId: string,
    mediaType: 'movie' | 'show',
    kind: PlexPersonKind,
    signal?: AbortSignal
  ): Promise<readonly PlexPersonCount[]> {
    if (!/^\d+$/.test(libraryId))
      throw new Error('A numeric Plex library section ID is required.');
    const response = await this.options.transport.query(
      `/library/sections/${encodeURIComponent(libraryId)}/all?type=${mediaType === 'movie' ? '1' : '2'}&label%21=trailer-placeholder`,
      signal
    );
    const counts = new Map<string, { name: string; count: number }>();
    for (const item of records(container(response).Metadata)) {
      const entries = records(kind === 'actors' ? item.Role : item.Director);
      const seen = new Set<string>();
      for (const entry of entries) {
        const name = text(entry.tag).trim();
        const normalized = name.toLocaleLowerCase();
        if (!name || seen.has(normalized)) continue;
        seen.add(normalized);
        const current = counts.get(normalized);
        counts.set(normalized, {
          name: current?.name ?? name,
          count: (current?.count ?? 0) + 1,
        });
      }
    }
    return [...counts.values()].sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name)
    );
  }

  public async createSmart(
    input: {
      title: string;
      libraryId: string;
      mediaType: 'movie' | 'show';
      kind: PlexPersonKind;
      personName: string;
      maxItems?: number;
    },
    signal?: AbortSignal
  ): Promise<string> {
    this.assertMutationTarget();
    if (!input.title.trim() || !input.personName.trim())
      throw new Error('Collection title and person name are required.');
    const type = input.mediaType === 'movie' ? '1' : '2';
    const filter = new URLSearchParams({
      type,
      [input.kind === 'actors' ? 'actor' : 'director']: input.personName.trim(),
      'label!': 'trailer-placeholder',
    });
    if (input.maxItems && input.maxItems > 0)
      filter.set('limit', String(Math.floor(input.maxItems)));
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
    const metadata = records(container(response).Metadata)[0];
    const ratingKey = text(metadata?.ratingKey);
    if (!ratingKey)
      throw new Error(`Plex did not return an identity for "${input.title}".`);
    try {
      await this.verify(ratingKey, input, signal);
    } catch (error) {
      await this.options.transport.delete(
        `/library/collections/${encodeURIComponent(ratingKey)}`,
        signal
      ).catch(() => undefined);
      throw error;
    }
    return ratingKey;
  }

  public async verify(
    ratingKey: string,
    expected: {
      libraryId: string;
      kind: PlexPersonKind;
      personName: string;
    },
    signal?: AbortSignal
  ): Promise<void> {
    const response = await this.options.transport.query(
      `/library/collections/${encodeURIComponent(ratingKey)}`,
      signal
    );
    const metadata = records(container(response).Metadata)[0];
    if (!metadata) throw new Error(`Plex collection ${ratingKey} was not found.`);
    if (!(metadata.smart === true || metadata.smart === 1 || metadata.smart === '1'))
      throw new Error(`Plex collection ${ratingKey} is not smart.`);
    if (text(metadata.librarySectionID) !== expected.libraryId)
      throw new Error(`Plex collection ${ratingKey} belongs to a different library.`);
    const content = text(metadata.content);
    if (content) {
      let savedPerson = '';
      try {
        savedPerson = new URL(content).searchParams.get(
          expected.kind === 'actors' ? 'actor' : 'director'
        ) ?? '';
      } catch {
        savedPerson = '';
      }
      if (
        savedPerson.localeCompare(expected.personName, undefined, {
          sensitivity: 'accent',
        }) !== 0
      )
        throw new Error(
          `Plex collection ${ratingKey} does not retain the expected person filter.`
        );
    }
  }

  public async delete(ratingKey: string, signal?: AbortSignal): Promise<void> {
    this.assertMutationTarget();
    await this.options.transport.delete(
      `/library/collections/${encodeURIComponent(ratingKey)}`,
      signal
    );
  }

  private assertMutationTarget(): void {
    if (!this.options.allowedMutationServerNames.has(this.options.verifiedServerName))
      throw new Error(
        `Plex collection mutation is blocked for server "${this.options.verifiedServerName}".`
      );
  }
}
