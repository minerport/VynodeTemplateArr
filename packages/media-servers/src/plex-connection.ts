import type { PlexConnectionCandidate, PlexConnectionInput, PlexServerDirectory, PlexServerObservation, PlexServerProbe } from './index.js';
import { PlexHttpTransport } from './plex-http.js';

type JsonTransport = { query(path:string,signal?:AbortSignal):Promise<unknown> };
type SecretResolver = (reference:string)=>Promise<string|undefined>;
const record=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const records=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.map(record).filter((item):item is Record<string,unknown>=>Boolean(item)):[];
const text=(value:unknown):string=>typeof value==='string'||typeof value==='number'?String(value):'';

export interface ProductionPlexConnectionOptions {
  clientIdentifier:string;
  secret:SecretResolver;
  fetch?:typeof globalThis.fetch;
  transportFactory?:(connection:PlexConnectionInput,token:()=>Promise<string>)=>JsonTransport;
}

const tokenFor = async (resolveSecret:SecretResolver,reference:string) => {
  const token=(await resolveSecret(reference))?.trim(); if(!token) throw new Error('The Plex owner credential is unavailable.'); return token;
};

export class ProductionPlexServerProbe implements PlexServerProbe {
  public constructor(private readonly options:ProductionPlexConnectionOptions){}
  public async observe(input:PlexConnectionInput,plexTokenReference:string,signal?:AbortSignal):Promise<PlexServerObservation>{
    const token=()=>tokenFor(this.options.secret,plexTokenReference);
    const transport=this.options.transportFactory?.(input,token)??new PlexHttpTransport({connection:input,token,clientIdentifier:this.options.clientIdentifier});
    const [identityResponse,libraryResponse]=await Promise.all([transport.query('/',signal),transport.query('/library/sections',signal)]);
    const identity=record(record(identityResponse)?.MediaContainer); const machineIdentifier=text(identity?.machineIdentifier); const name=text(identity?.friendlyName);
    if(!machineIdentifier||!name) throw new Error('Plex returned an incomplete server identity.');
    const libraries=records(record(record(libraryResponse)?.MediaContainer)?.Directory).flatMap((library)=>{
      const key=text(library.key),title=text(library.title),type=text(library.type); if(!key||!title||!['movie','show','artist','photo'].includes(type)) return [];
      return [{key,title,type:type as 'movie'|'show'|'artist'|'photo',locations:records(library.Location).map((location)=>text(location.path)).filter(Boolean),...(text(library.language)?{language:text(library.language)}:{}),...(text(library.agent)?{agent:text(library.agent)}:{}),...(text(library.scanner)?{scanner:text(library.scanner)}:{})}];
    });
    return {machineIdentifier,name,libraries};
  }
}

export class PlexCloudServerDirectory implements PlexServerDirectory {
  readonly #fetch:typeof globalThis.fetch; readonly #probe:ProductionPlexServerProbe;
  public constructor(private readonly options:ProductionPlexConnectionOptions){ this.#fetch=options.fetch??globalThis.fetch; this.#probe=new ProductionPlexServerProbe(options); }
  public async discover(plexTokenReference:string,signal?:AbortSignal):Promise<readonly PlexConnectionCandidate[]>{
    const token=await tokenFor(this.options.secret,plexTokenReference);
    const response=await this.#fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1',{headers:{Accept:'application/json','X-Plex-Token':token,'X-Plex-Product':'Vynode','X-Plex-Client-Identifier':this.options.clientIdentifier},...(signal?{signal}:{})});
    if(!response.ok) throw new Error(response.status===401||response.status===403?'Plex rejected the account authorization.':`Plex server discovery failed (status ${response.status}).`);
    const resources=await response.json() as unknown; const candidates:PlexConnectionCandidate[]=[];
    for(const resource of records(resources)){
      if(!text(resource.provides).split(',').includes('server')) continue;
      for(const [index,connection] of records(resource.connections).entries()){
        const uri=text(connection.uri); let url:URL; try{url=new URL(uri);}catch{continue;} if(!['http:','https:'].includes(url.protocol)||!url.hostname) continue;
        const input:PlexConnectionInput={host:url.hostname,port:Number(url.port)||(url.protocol==='https:'?443:80),transport:url.protocol==='http:'?'http':'https-verify',webAppUrl:'https://app.plex.tv/desktop',autoEmptyTrash:true}; const started=Date.now();
        try { const observed=await this.#probe.observe(input,plexTokenReference,signal); candidates.push({id:`${text(resource.clientIdentifier)||observed.machineIdentifier}-${index}`,serverName:observed.name,machineIdentifier:observed.machineIdentifier,input,local:connection.local===true,reachable:true,latencyMs:Date.now()-started}); }
        catch(error){ candidates.push({id:`${text(resource.clientIdentifier)||'plex'}-${index}`,serverName:text(resource.name)||'Plex Server',machineIdentifier:text(resource.clientIdentifier),input,local:connection.local===true,reachable:false,diagnostic:error instanceof Error?error.message:'Plex connection failed.'}); }
      }
    }
    return candidates.sort((a,b)=>Number(b.reachable)-Number(a.reachable)||Number(b.local)-Number(a.local)||(a.latencyMs??Infinity)-(b.latencyMs??Infinity));
  }
}
