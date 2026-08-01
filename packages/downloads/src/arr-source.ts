import type { ArrKind } from './index.js';

export interface ArrTag {
  id: number;
  label: string;
}

export interface ArrTagSourceItem {
  serviceId: number;
  title: string;
  year?: number;
  tmdbId?: number;
  tvdbId?: number;
  tagIds: readonly number[];
  monitored?: boolean;
  releaseAt?: string;
}

export interface ArrSourceTransport {
  request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<{ status: number; body: unknown }>;
}

class FetchArrSourceTransport implements ArrSourceTransport {
  public async request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<{ status: number; body: unknown }> {
    const response = await fetch(input.url, {
      headers: input.headers,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // The status-specific error below remains credential-safe.
    }
    return { status: response.status, body };
  }
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
const records = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
const positiveInteger = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export interface ArrTagSourceClientOptions {
  kind: ArrKind;
  hostname: string;
  port: number;
  useSsl: boolean;
  urlBase: string;
  apiKey: string;
  transport?: ArrSourceTransport;
}

export class ArrTagSourceClient {
  private readonly baseUrl: string;
  private readonly transport: ArrSourceTransport;

  public constructor(private readonly options: ArrTagSourceClientOptions) {
    if (
      !options.hostname.trim() ||
      options.hostname.includes('://') ||
      options.hostname.includes('/') ||
      !Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535 ||
      !options.apiKey.trim()
    )
      throw new Error(
        `${options.kind === 'radarr' ? 'Radarr' : 'Sonarr'} endpoint and API key are required.`
      );
    const base = options.urlBase.trim()
      ? `/${options.urlBase.trim().replace(/^\/+|\/+$/g, '')}`
      : '';
    this.baseUrl = `${options.useSsl ? 'https' : 'http'}://${options.hostname}:${options.port}${base}/api/v3`;
    this.transport = options.transport ?? new FetchArrSourceTransport();
  }

  public async tags(signal?: AbortSignal): Promise<readonly ArrTag[]> {
    const body = await this.get('/tag', signal);
    if (!Array.isArray(body))
      throw new Error(`${this.serviceName()} returned an invalid tag response.`);
    return records(body)
      .map((item): ArrTag | undefined => {
        const id = positiveInteger(item.id);
        const label = String(item.label ?? '').trim();
        return id && label ? { id, label } : undefined;
      })
      .filter((item): item is ArrTag => Boolean(item))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  public async itemsForTag(
    tagId: number,
    signal?: AbortSignal
  ): Promise<readonly ArrTagSourceItem[]> {
    if (!Number.isInteger(tagId) || tagId < 1)
      throw new Error(`${this.serviceName()} tag ID must be a positive integer.`);
    return (await this.items(signal)).filter((item) => item.tagIds.includes(tagId));
  }

  public async items(signal?: AbortSignal): Promise<readonly ArrTagSourceItem[]> {
    const body = await this.get(
      this.options.kind === 'radarr' ? '/movie' : '/series',
      signal
    );
    if (!Array.isArray(body))
      throw new Error(
        `${this.serviceName()} returned an invalid media response.`
      );
    return records(body)
      .map((item): ArrTagSourceItem | undefined => {
        const serviceId = positiveInteger(item.id);
        const title = String(item.title ?? '').trim();
        if (!serviceId || !title) return undefined;
        const year = positiveInteger(item.year);
        const tmdbId = positiveInteger(item.tmdbId);
        const tvdbId = positiveInteger(item.tvdbId);
        return {
          serviceId,
          title,
          ...(year ? { year } : {}),
          ...(tmdbId ? { tmdbId } : {}),
          ...(tvdbId ? { tvdbId } : {}),
          ...(typeof item.monitored === 'boolean' ? { monitored: item.monitored } : {}),
          tagIds: (item.tags as unknown[])
            .map(positiveInteger)
            .filter((id): id is number => id !== undefined),
        };
      })
      .filter((item): item is ArrTagSourceItem => Boolean(item));
  }

  public async monitoredUpcoming(signal?:AbortSignal):Promise<readonly ArrTagSourceItem[]>{
    const body=await this.get(this.options.kind==='radarr'?'/movie':'/series',signal);if(!Array.isArray(body))throw new Error(`${this.serviceName()} returned an invalid media response.`);const now=Date.now();return records(body).flatMap((item)=>{if(item.monitored!==true)return[];const dates=this.options.kind==='radarr'?[item.digitalRelease,item.physicalRelease,item.inCinemas]:[item.nextAiring];const releaseAt=dates.flatMap((value)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?[value]:[]).sort((a,b)=>Date.parse(a)-Date.parse(b)).find((value)=>Date.parse(value)>=now);if(!releaseAt)return[];const serviceId=positiveInteger(item.id);const title=String(item.title??'').trim();if(!serviceId||!title)return[];const year=positiveInteger(item.year),tmdbId=positiveInteger(item.tmdbId),tvdbId=positiveInteger(item.tvdbId);return[{serviceId,title,...(year?{year}:{}),...(tmdbId?{tmdbId}:{}),...(tvdbId?{tvdbId}:{}),tagIds:Array.isArray(item.tags)?item.tags.map(positiveInteger).filter((id):id is number=>id!==undefined):[],monitored:true,releaseAt}];}).sort((a,b)=>Date.parse(a.releaseAt!)-Date.parse(b.releaseAt!));
  }

  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.transport.request({
      url: `${this.baseUrl}${path}`,
      headers: {
        Accept: 'application/json',
        'X-Api-Key': this.options.apiKey,
      },
      ...(signal ? { signal } : {}),
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        [401, 403].includes(response.status)
          ? `${this.serviceName()} rejected the API key.`
          : `${this.serviceName()} request failed with status ${response.status}.`
      );
    return response.body;
  }

  private serviceName(): 'Radarr' | 'Sonarr' {
    return this.options.kind === 'radarr' ? 'Radarr' : 'Sonarr';
  }
}
