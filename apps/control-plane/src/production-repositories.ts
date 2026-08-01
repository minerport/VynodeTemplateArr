import type { PlexServerConfiguration, PlexServerRepository } from '@vynode/media-servers';
import type { IntegrationId, IntegrationRepository, StoredIntegration } from '@vynode/integrations';
import type { ArrConfiguration, ArrKind, ArrRepository, SeerrConfiguration, SeerrRepository } from '@vynode/downloads';
import { createOnboardingState, type OnboardingRepository, type OnboardingState } from '@vynode/onboarding';
import { SqliteJsonRepository, type VynodeSqliteStorage } from '@vynode/storage';

export class SqliteOnboardingRepository implements OnboardingRepository {
  readonly #values: SqliteJsonRepository<OnboardingState>;
  public constructor(storage: VynodeSqliteStorage, installationId: string) {
    this.#values=new SqliteJsonRepository(storage,'onboarding');
    if(!this.#values.get('state')) this.#values.put('state',createOnboardingState(installationId));
  }
  public async get():Promise<OnboardingState>{ return structuredClone(this.#values.get('state')!.value); }
  public async compareAndSet(expectedRevision:number,next:OnboardingState):Promise<boolean>{
    try { this.#values.put('state',next,expectedRevision+1); return true; } catch(error) { if(error instanceof Error && /changed/.test(error.message)) return false; throw error; }
  }
}

export class SqlitePlexServerRepository implements PlexServerRepository {
  readonly #values: SqliteJsonRepository<PlexServerConfiguration>;
  public constructor(storage:VynodeSqliteStorage){ this.#values=new SqliteJsonRepository(storage,'plex-server'); }
  public async get():Promise<PlexServerConfiguration|undefined>{ return this.#values.get('configuration')?.value; }
  public peek():PlexServerConfiguration|undefined{return this.#values.get('configuration')?.value;}
  public async compareAndSet(expectedRevision:number,next:PlexServerConfiguration):Promise<boolean>{
    try { this.#values.put('configuration',next,expectedRevision); return true; } catch(error) { if(error instanceof Error && /changed/.test(error.message)) return false; throw error; }
  }
}

export class SqliteIntegrationRepository implements IntegrationRepository {
  readonly #values:SqliteJsonRepository<StoredIntegration>;
  public constructor(storage:VynodeSqliteStorage){this.#values=new SqliteJsonRepository(storage,'integrations');}
  public async get(id:IntegrationId){return this.#values.get(id)?.value;}
  public async compareAndSet(id:IntegrationId,expectedRevision:number,next:StoredIntegration){try{this.#values.put(id,next,expectedRevision);return true;}catch(error){if(error instanceof Error&&/changed/.test(error.message))return false;throw error;}}
  public async delete(id:IntegrationId,expectedRevision:number){const current=this.#values.get(id);if(!current||current.value.revision!==expectedRevision)return false;return this.#values.delete(id);}
}

interface StoredArrConfigurations { values:ArrConfiguration[] }
export class SqliteArrRepository implements ArrRepository {
  readonly #values:SqliteJsonRepository<StoredArrConfigurations>;
  public constructor(private readonly storage:VynodeSqliteStorage){this.#values=new SqliteJsonRepository(storage,'download-servers');if(!this.#values.get('arr'))this.#values.put('arr',{values:[]});}
  public async list(kind:ArrKind){return structuredClone(this.#values.get('arr')!.value.values.filter((item)=>item.endpoint.kind===kind));}
  public async get(id:string){return structuredClone(this.#values.get('arr')!.value.values.find((item)=>item.id===id));}
  public async compareAndSet(id:string,expectedRevision:number,next:ArrConfiguration,defaultsToClear:readonly string[]){return this.storage.transaction(async()=>{const current=this.#values.get('arr')!;const index=current.value.values.findIndex((item)=>item.id===id);if((index<0?0:current.value.values[index]!.revision)!==expectedRevision)return false;const cleared=new Set(defaultsToClear);const values=current.value.values.map((item)=>cleared.has(item.id)?{...item,selection:{...item.selection,isDefault:false}}:item);if(index<0)values.push(next);else values[index]=next;this.#values.put('arr',{values},current.revision);return true;});}
  public async delete(id:string,expectedRevision:number){return this.storage.transaction(async()=>{const current=this.#values.get('arr')!;const found=current.value.values.find((item)=>item.id===id);if(!found||found.revision!==expectedRevision)return false;this.#values.put('arr',{values:current.value.values.filter((item)=>item.id!==id)},current.revision);return true;});}
}

export class SqliteSeerrRepository implements SeerrRepository {
  readonly #values:SqliteJsonRepository<SeerrConfiguration>;
  public constructor(storage:VynodeSqliteStorage){this.#values=new SqliteJsonRepository(storage,'seerr');}
  public async get(){return structuredClone(this.#values.get('configuration')?.value);}
  public async compareAndSet(expectedRevision:number,next:SeerrConfiguration){try{this.#values.put('configuration',next,expectedRevision);return true;}catch(error){if(error instanceof Error&&/changed/.test(error.message))return false;throw error;}}
  public async delete(expectedRevision:number){const current=this.#values.get('configuration');if(!current||current.value.revision!==expectedRevision)return false;return this.#values.delete('configuration');}
}
