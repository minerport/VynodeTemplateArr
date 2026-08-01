import { hostname } from 'node:os';
import type { DurableJob } from '@vynode/jobs';
import { FileDurableJobRepository } from '@vynode/jobs';
import type { ProductionCollectionSyncResult, ProductionCollectionSurface } from './production-collections.js';

interface CollectionJobInput { collectionId:string }
const inputFor=(job:DurableJob):CollectionJobInput|undefined=>{const value=job.input;if(!value||typeof value!=='object')return undefined;const collectionId=(value as Record<string,unknown>).collectionId;return typeof collectionId==='string'&&collectionId?{collectionId}:undefined;};

export class ProductionCollectionJobRunner {
  readonly #workerId=`control-plane-${hostname()}-${process.pid}`;
  #pumping:Promise<void>|undefined;
  readonly #controllers=new Map<string,AbortController>();
  public constructor(
    readonly repository: FileDurableJobRepository,
    private readonly collections: ProductionCollectionSurface,
    private readonly now: () => Date = () => new Date(),
    private readonly reportFailure: (collectionId: string, message: string) => void = () => undefined
  ) {}
  public async resume():Promise<void>{await this.repository.recoverExpired(this.now());await this.#startPump();}
  public async execute(collectionId:string,signal?:AbortSignal):Promise<ProductionCollectionSyncResult>{
    const job=await this.repository.enqueue({kind:'collection.sync',input:{collectionId},idempotencyKey:`collection.sync:${collectionId}`,maxAttempts:3},this.now());this.#startPump();
    const cancel=()=>{void this.repository.requestCancellation(job.id,this.now());this.#controllers.get(job.id)?.abort();};signal?.addEventListener('abort',cancel,{once:true});
    try{for(;;){if(signal?.aborted)throw new DOMException('Aborted','AbortError');const current=await this.repository.get(job.id);if(!current)throw new Error('The durable collection job disappeared.');if(current.status==='succeeded')return current.result as ProductionCollectionSyncResult;if(current.status==='failed'||current.status==='cancelled')throw new Error(current.error??`Collection synchronization ${current.status}.`);await new Promise((resolve)=>setTimeout(resolve,25));}}
    finally{signal?.removeEventListener('abort',cancel);}
  }
  #startPump():Promise<void>{if(this.#pumping)return this.#pumping;this.#pumping=this.#pump().finally(()=>{this.#pumping=undefined;});return this.#pumping;}
  async #pump():Promise<void>{for(;;){const job=await this.repository.claim(this.#workerId,10*60_000,this.now());if(!job)return;if(job.kind!=='collection.sync'){await this.repository.fail(job.id,this.#workerId,`Unsupported production job kind "${job.kind}".`,this.now());continue;}const input=inputFor(job);if(!input){await this.repository.fail(job.id,this.#workerId,'The collection job payload is invalid.',this.now());continue;}const controller=new AbortController();this.#controllers.set(job.id,controller);try{if(job.cancellationRequested){await this.repository.requestCancellation(job.id,this.now());controller.abort();throw new DOMException('Aborted','AbortError');}const result=await this.collections.synchronize(input.collectionId,controller.signal);if(!result)throw new Error('Collection was not found.');await this.repository.complete(job.id,this.#workerId,result,this.now());}catch(error){const message=error instanceof Error?error.message:'Collection synchronization failed.';if(!(error instanceof DOMException&&error.name==='AbortError'))this.reportFailure(input.collectionId,message);await this.repository.fail(job.id,this.#workerId,message,this.now());}finally{this.#controllers.delete(job.id);}}
  }
}
