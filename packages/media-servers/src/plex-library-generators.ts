import type {
  PlexContentRatingGroup,
  PlexLibraryGeneratorSubtype,
  PlexLibraryGeneratorValue,
} from '@vynode/contracts';
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

const normalizedResolution = (value: string) => {
  const trimmed = value.trim();
  if (/^\d{3,4}$/.test(trimmed)) return `${trimmed}p`;
  return trimmed.replace(/^sd$/i, 'SD').replace(/^4k$/i, '4K');
};

export const contentRatingGroup = (
  value: string
): PlexContentRatingGroup => {
  const rating = value.trim().toUpperCase();
  if (/^(AU[- ]?)?(G|PG|M|MA15\+|R18\+|X18\+|CTC)$/.test(rating))
    return 'australia';
  if (/^(TV[- ]?)(Y|Y7|G|PG|14|MA)$/.test(rating)) return 'television';
  if (/^(AGES?[- ]?)?\d{1,2}\+?$/.test(rating)) return 'numeric';
  return 'other';
};

const valuesForItem = (
  item: JsonRecord,
  subtype: PlexLibraryGeneratorSubtype
): readonly { value: string; group?: PlexContentRatingGroup }[] => {
  if (subtype === 'genres')
    return records(item.Genre)
      .map((entry) => text(entry.tag).trim())
      .filter(Boolean)
      .map((value) => ({ value }));
  if (subtype === 'decades') {
    const year = Number(item.year);
    if (!Number.isInteger(year) || year < 1800 || year > 2200) return [];
    return [{ value: `${Math.floor(year / 10) * 10}s` }];
  }
  if (subtype === 'content-ratings') {
    const value = text(item.contentRating).trim();
    return value ? [{ value, group: contentRatingGroup(value) }] : [];
  }
  const media = records(item.Media);
  const values = new Set(
    media
      .map((entry) => normalizedResolution(text(entry.videoResolution)))
      .filter(Boolean)
  );
  return [...values].map((value) => ({ value }));
};

export interface PlexLibraryGeneratorClientOptions {
  transport: Pick<PlexHttpTransport, 'delete' | 'postJson' | 'query'>;
  machineIdentifier: string;
  verifiedServerName: string;
  allowedMutationServerNames: ReadonlySet<string>;
}

export class PlexLibraryGeneratorClient {
  public constructor(
    private readonly options: PlexLibraryGeneratorClientOptions
  ) {
    if (!options.machineIdentifier.trim())
      throw new Error('The verified Plex machine identifier is required.');
  }

  public async values(
    libraryId: string,
    mediaType: 'movie' | 'show',
    subtype: PlexLibraryGeneratorSubtype,
    signal?: AbortSignal
  ): Promise<readonly PlexLibraryGeneratorValue[]> {
    if (!/^\d+$/.test(libraryId))
      throw new Error('A numeric Plex library section ID is required.');
    const response = await this.options.transport.query(
      `/library/sections/${encodeURIComponent(libraryId)}/all?type=${mediaType === 'movie' ? '1' : '2'}&label%21=trailer-placeholder`,
      signal
    );
    const counts = new Map<
      string,
      { label: string; count: number; group?: PlexContentRatingGroup }
    >();
    for (const item of records(container(response).Metadata)) {
      const seen = new Set<string>();
      for (const entry of valuesForItem(item, subtype)) {
        const normalized = entry.value.toLocaleLowerCase();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        const current = counts.get(normalized);
        counts.set(normalized, {
          label: current?.label ?? entry.value,
          count: (current?.count ?? 0) + 1,
          ...(entry.group ? { group: entry.group } : {}),
        });
      }
    }
    return [...counts.entries()]
      .map(([value, entry]) => ({
        value,
        label: entry.label,
        count: entry.count,
        ...(entry.group ? { group: entry.group } : {}),
      }))
      .sort((left, right) =>
        subtype === 'decades'
          ? right.label.localeCompare(left.label)
          : left.label.localeCompare(right.label)
      );
  }

  public async createSmart(
    input: {
      title: string;
      libraryId: string;
      mediaType: 'movie' | 'show';
      subtype: PlexLibraryGeneratorSubtype;
      value: string;
    },
    signal?: AbortSignal
  ): Promise<string> {
    this.assertMutationTarget();
    const type = input.mediaType === 'movie' ? '1' : '2';
    const filter = new URLSearchParams({
      type,
      'label!': 'trailer-placeholder',
    });
    if (input.subtype === 'genres') filter.set('genre', input.value);
    if (input.subtype === 'resolutions')
      filter.set('resolution', input.value.replace(/p$/i, ''));
    if (input.subtype === 'content-ratings')
      filter.set('contentRating', input.value);
    if (input.subtype === 'decades') {
      const start = Number.parseInt(input.value, 10);
      if (!Number.isInteger(start))
        throw new Error(`Invalid decade value "${input.value}".`);
      filter.set('year>', String(start));
      filter.set('year<', String(start + 9));
    }
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
    const ratingKey = text(records(container(response).Metadata)[0]?.ratingKey);
    if (!ratingKey)
      throw new Error(`Plex did not return an identity for "${input.title}".`);
    return ratingKey;
  }

  public async delete(ratingKey: string, signal?: AbortSignal): Promise<void> {
    this.assertMutationTarget();
    await this.options.transport.delete(
      `/library/collections/${encodeURIComponent(ratingKey)}`,
      signal
    );
  }

  private assertMutationTarget() {
    if (
      !this.options.allowedMutationServerNames.has(
        this.options.verifiedServerName
      )
    )
      throw new Error(
        `Plex collection mutation is blocked for server "${this.options.verifiedServerName}".`
      );
  }
}
