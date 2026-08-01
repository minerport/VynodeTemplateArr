export type SourceCombineMode='interleaved'|'list-order'|'randomized'|'cycle-lists';
export interface ComposableSourceItem { key:string }
export interface SourceInput<T extends ComposableSourceItem>{id:string;priority:number;load(signal?:AbortSignal):Promise<readonly T[]>}
export interface SourceFailure {sourceId:string;message:string}
export interface SourceComposition<T>{items:readonly T[];failures:readonly SourceFailure[];successfulSourceIds:readonly string[]}
export interface SourceCompositionOptions {mode:SourceCombineMode;limit:number;cycleIndex?:number;random?:()=>number}

const deduplicate=<T extends ComposableSourceItem>(items:readonly T[],limit:number)=>{const seen=new Set<string>();const output:T[]=[];for(const item of items){const key=item.key.trim();if(!key||seen.has(key))continue;seen.add(key);output.push(item);if(output.length>=limit)break;}return output;};
export const composeSources=async<T extends ComposableSourceItem>(sources:readonly SourceInput<T>[],options:SourceCompositionOptions,signal?:AbortSignal):Promise<SourceComposition<T>>=>{
  const ordered=[...sources].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));if(!ordered.length)throw new Error('Add at least one source before composing a collection.');const settled=await Promise.all(ordered.map(async(source)=>{try{signal?.throwIfAborted();return{source,items:await source.load(signal)} as const;}catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;return{source,error:error instanceof Error?error.message:String(error)} as const;}}));const successes=settled.filter((result):result is Extract<typeof result,{items:readonly T[]}>=>'items'in result);const failures=settled.flatMap((result)=>'error'in result?[{sourceId:result.source.id,message:result.error}]:[]);if(!successes.length)throw new AggregateError(failures.map((failure)=>new Error(`${failure.sourceId}: ${failure.message}`)),'Every multi-source dependency failed.');const limit=Math.max(1,Math.min(10000,Math.trunc(options.limit)));let combined:T[]=[];
  if(options.mode==='cycle-lists'){const selected=successes[Math.abs(Math.trunc(options.cycleIndex??0))%successes.length]!;combined=[...selected.items];}
  else if(options.mode==='interleaved'){const maximum=Math.max(...successes.map((result)=>result.items.length));for(let index=0;index<maximum;index++)for(const result of successes)if(result.items[index])combined.push(result.items[index]!);}
  else combined=successes.flatMap((result)=>result.items as T[]);
  if(options.mode==='randomized'){const random=options.random??Math.random;for(let index=combined.length-1;index>0;index--){const target=Math.max(0,Math.min(index,Math.floor(random()*(index+1))));[combined[index],combined[target]]=[combined[target]!,combined[index]!];}}
  return{items:deduplicate(combined,limit),failures,successfulSourceIds:successes.map((result)=>result.source.id)};
};
