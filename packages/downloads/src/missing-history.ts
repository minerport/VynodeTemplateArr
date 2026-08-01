import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export type MissingRequestStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'available'
  | 'processing'
  | 'failed'
  | 'partially-available';

export interface MissingRequestRecord {
  id: string;
  operationKey: string;
  candidateKey: string;
  tmdbId: number;
  tvdbId?: number;
  mediaType: 'movie' | 'show';
  title: string;
  year?: number;
  posterPath?: string;
  collectionName: string;
  collectionSource: string;
  requestService: string;
  requestMethod: 'auto' | 'manual';
  requestStatus: MissingRequestStatus;
  createdAt: string;
  updatedAt: string;
  requestedAt?: string;
  serviceId?: number;
  serverId?: string;
  notes?: string;
}

interface MissingRequestState {
  version: 1;
  records: MissingRequestRecord[];
}

const redact = (value?: string): string | undefined => {
  if (!value) return undefined;
  const safe = value
    .replace(
      /\b(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/gi,
      '$1[credentials-redacted]@'
    )
    .replace(
      /\b(api[_ -]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    )
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted]');
  return safe.slice(0, 1000);
};

const validRecord = (value: unknown): value is MissingRequestRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<MissingRequestRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.operationKey === 'string' &&
    typeof record.candidateKey === 'string' &&
    typeof record.tmdbId === 'number' &&
    ['movie', 'show'].includes(record.mediaType ?? '') &&
    typeof record.title === 'string' &&
    typeof record.collectionName === 'string' &&
    typeof record.collectionSource === 'string' &&
    typeof record.requestService === 'string' &&
    ['auto', 'manual'].includes(record.requestMethod ?? '') &&
    [
      'pending',
      'approved',
      'declined',
      'available',
      'processing',
      'failed',
      'partially-available',
    ].includes(record.requestStatus ?? '') &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  );
};

const parse = (value: string): MissingRequestState => {
  const parsed = JSON.parse(value) as Partial<MissingRequestState>;
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.records) ||
    !parsed.records.every(validRecord)
  ) {
    throw new Error('The missing-request history file is corrupt.');
  }
  return { version: 1, records: parsed.records };
};

export class FileMissingRequestRepository {
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(
    private readonly path: string,
    private readonly maxRecords = 1000
  ) {}

  private async read(): Promise<MissingRequestState> {
    try {
      return parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { version: 1, records: [] };
      }
      throw error;
    }
  }

  private async write(state: MissingRequestState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private mutate(
    operation: (state: MissingRequestState) => void
  ): Promise<void> {
    const next = this.writeChain.then(async () => {
      const state = await this.read();
      operation(state);
      state.records = state.records
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, this.maxRecords);
      await this.write(state);
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  public begin(
    records: readonly Omit<
      MissingRequestRecord,
      'id' | 'requestStatus' | 'createdAt' | 'updatedAt'
    >[],
    now: Date
  ): Promise<void> {
    const timestamp = now.toISOString();
    return this.mutate((state) => {
      for (const input of records) {
        const existing = state.records.find(
          (record) => record.operationKey === input.operationKey
        );
        if (existing) {
          Object.assign(existing, input, {
            requestStatus: 'processing',
            updatedAt: timestamp,
            notes: undefined,
          });
        } else {
          state.records.push({
            ...input,
            id: randomUUID(),
            requestStatus: 'processing',
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
    });
  }

  public complete(
    operationKey: string,
    update: {
      requestStatus: MissingRequestStatus;
      serviceId?: number;
      serverId?: string;
      notes?: string;
    },
    now: Date
  ): Promise<void> {
    return this.mutate((state) => {
      const record = state.records.find(
        (candidate) => candidate.operationKey === operationKey
      );
      if (!record) return;
      record.requestStatus = update.requestStatus;
      record.updatedAt = now.toISOString();
      record.requestedAt = now.toISOString();
      if (update.serviceId !== undefined) record.serviceId = update.serviceId;
      if (update.serverId !== undefined) record.serverId = update.serverId;
      const notes = redact(update.notes);
      if (notes) record.notes = notes;
      else delete record.notes;
    });
  }

  public async list(
    mediaType: 'movie' | 'show',
    limit: number,
    offset: number
  ): Promise<{ results: readonly MissingRequestRecord[]; total: number }> {
    return this.query({ mediaType }, limit, offset);
  }

  public async query(
    filters: {
      mediaType?: 'movie' | 'show';
      requestStatus?: MissingRequestStatus;
      collectionSource?: string;
      requestService?: string;
    },
    limit: number,
    offset: number
  ): Promise<{ results: readonly MissingRequestRecord[]; total: number }> {
    await this.writeChain;
    const records = (await this.read()).records
      .filter(
        (record) =>
          (!filters.mediaType || record.mediaType === filters.mediaType) &&
          (!filters.requestStatus ||
            record.requestStatus === filters.requestStatus) &&
          (!filters.collectionSource ||
            record.collectionSource.toLowerCase() ===
              filters.collectionSource.toLowerCase()) &&
          (!filters.requestService ||
            record.requestService.toLowerCase() ===
              filters.requestService.toLowerCase())
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      results: records.slice(offset, offset + limit),
      total: records.length,
    };
  }
}
