import type { PlexAccount, PlexAuthProvider, PlexPin } from './index.js';

export interface PlexCloudAuthProviderOptions {
  clientIdentifier: string;
  product?: string;
  version?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

type PlexAccountPayload = { id?: number; email?: string; username?: string; title?: string; thumb?: string; subscription?: { active?: boolean } };

export class PlexCloudAuthProvider implements PlexAuthProvider {
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;
  readonly #headers: Readonly<Record<string,string>>;

  public constructor(options: PlexCloudAuthProviderOptions) {
    const clientIdentifier=options.clientIdentifier.trim();
    if(!clientIdentifier || clientIdentifier.length>200) throw new Error('A stable Plex client identifier is required.');
    this.#fetch=options.fetch ?? globalThis.fetch;
    this.#now=options.now ?? (()=>new Date());
    this.#headers={Accept:'application/json','X-Plex-Product':options.product?.trim()||'Vynode','X-Plex-Version':options.version?.trim()||'0.1.0','X-Plex-Client-Identifier':clientIdentifier};
  }

  public async createPin(signal?: AbortSignal): Promise<PlexPin> {
    const response=await this.#request('https://plex.tv/api/v2/pins',{method:'POST',headers:{...this.#headers,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({strong:'true','X-Plex-Product':this.#headers['X-Plex-Product']!,'X-Plex-Client-Identifier':this.#headers['X-Plex-Client-Identifier']!}),...(signal?{signal}:{})},'Plex authorization could not start');
    const payload=await response.json() as {id?:number;code?:string;expiresIn?:number};
    if(!payload.id || !payload.code) throw new Error('Plex returned an incomplete authorization response.');
    const parameters=new URLSearchParams({clientID:this.#headers['X-Plex-Client-Identifier']!,code:payload.code,'context[device][product]':this.#headers['X-Plex-Product']!});
    return {providerPinId:String(payload.id),code:payload.code,authorizationUrl:`https://app.plex.tv/auth#?${parameters.toString()}`,expiresAt:new Date(this.#now().getTime()+Math.max(60,payload.expiresIn??1800)*1000).toISOString()};
  }

  public async pollPin(providerPinId: string, signal?: AbortSignal) {
    const normalized=providerPinId.trim(); if(!/^\d+$/.test(normalized)) throw new Error('The Plex authorization identifier is invalid.');
    const response=await this.#fetch(`https://plex.tv/api/v2/pins/${encodeURIComponent(normalized)}`,{headers:this.#headers,...(signal?{signal}:{})});
    if(response.status===429) return undefined;
    if(!response.ok) throw new Error(`Plex authorization check failed (status ${response.status}).`);
    const payload=await response.json() as {authToken?:string|null}; if(!payload.authToken) return undefined;
    return {token:payload.authToken,account:await this.accountForToken(payload.authToken,signal)};
  }

  public async accountForToken(token: string, signal?: AbortSignal): Promise<PlexAccount> {
    const normalized=token.trim(); if(!normalized) throw new Error('A Plex account token is required.');
    const response=await this.#request('https://plex.tv/api/v2/user',{headers:{...this.#headers,'X-Plex-Token':normalized},...(signal?{signal}:{})},'Plex account verification failed');
    const account=await response.json() as PlexAccountPayload;
    if(!account.id || !account.email || !account.username) throw new Error('Plex returned an incomplete account profile.');
    return {id:String(account.id),email:account.email,username:account.username,hasPlexPass:account.subscription?.active===true,...(account.title?{title:account.title}:{}),...(account.thumb?{avatarUrl:account.thumb}:{})};
  }

  async #request(url:string,init:RequestInit,context:string):Promise<Response>{
    let response:Response; try { response=await this.#fetch(url,init); } catch(error) { if(error instanceof Error && error.name==='AbortError') throw error; throw new Error(`${context}: Plex is unavailable.`,{cause:error}); }
    if(!response.ok) throw new Error(response.status===401||response.status===403?'Plex rejected the account authorization.':`${context} (status ${response.status}).`);
    return response;
  }
}
