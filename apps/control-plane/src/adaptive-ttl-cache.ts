import { createHash } from 'node:crypto';

export interface AdaptiveTtlCacheOptions {
  minimumTtlMs: number;
  initialTtlMs: number;
  maximumTtlMs: number;
  negativeTtlMs?: number;
  now?: () => number;
}

interface CacheEntry<T> {
  value: T;
  fingerprint: string;
  ttlMs: number;
  expiresAt: number;
}

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class AdaptiveTtlCache<T> {
  readonly #entries = new Map<string, CacheEntry<T>>();
  readonly #inFlight = new Map<string, Promise<T>>();
  readonly #now: () => number;

  public constructor(private readonly options: AdaptiveTtlCacheOptions) {
    if (
      options.minimumTtlMs <= 0 ||
      options.initialTtlMs < options.minimumTtlMs ||
      options.maximumTtlMs < options.initialTtlMs
    ) throw new Error('Adaptive cache TTL bounds are invalid.');
    this.#now = options.now ?? Date.now;
  }

  public async get(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.#entries.get(key);
    if (cached && cached.expiresAt > this.#now()) return cached.value;
    const active = this.#inFlight.get(key);
    if (active) return active;
    const request = load().then((value) => {
      const nextFingerprint = fingerprint(value);
      const empty = value === undefined || value === null;
      const ttlMs = empty
        ? Math.min(this.options.maximumTtlMs, this.options.negativeTtlMs ?? this.options.minimumTtlMs)
        : cached?.fingerprint === nextFingerprint
          ? Math.min(this.options.maximumTtlMs, cached.ttlMs * 2)
          : cached
            ? Math.max(this.options.minimumTtlMs, Math.floor(cached.ttlMs / 2))
            : this.options.initialTtlMs;
      this.#entries.set(key, { value, fingerprint: nextFingerprint, ttlMs, expiresAt: this.#now() + ttlMs });
      return value;
    }).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, request);
    return request;
  }

  public invalidate(key?: string) {
    if (key === undefined) this.#entries.clear();
    else this.#entries.delete(key);
  }

  public inspect(key: string) {
    const entry = this.#entries.get(key);
    return entry ? { ttlMs: entry.ttlMs, expiresAt: entry.expiresAt } : undefined;
  }
}
