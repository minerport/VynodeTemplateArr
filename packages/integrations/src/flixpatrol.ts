export interface FlixPatrolItem { title:string; rank:number; mediaType:'movie'|'show' }
import { BrowserImdbTransport } from './imdb.js';

export interface FlixPatrolClientOptions { fetch?:typeof globalThis.fetch; baseUrl?:string; browserFetch?:(url:string,signal?:AbortSignal)=>Promise<string> }

const unescapeHtml=(value:string)=>value.replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const countrySlugs:Record<string,string>={US:'united-states',GB:'united-kingdom',CA:'canada',AU:'australia',JP:'japan',KR:'south-korea'};
export class FlixPatrolClient {
  readonly #fetch:typeof globalThis.fetch;readonly #baseUrl:string;readonly #browserFetch:(url:string,signal?:AbortSignal)=>Promise<string>;
  constructor(options:FlixPatrolClientOptions={}){this.#fetch=options.fetch??globalThis.fetch;this.#baseUrl=options.baseUrl??'https://flixpatrol.com';this.#browserFetch=options.browserFetch??(async(url,signal)=>(await new BrowserImdbTransport().get(url,signal)).body);}
  async source(input:{platform:string;country?:string;mediaType:'movie'|'show';limit:number},signal?:AbortSignal):Promise<readonly FlixPatrolItem[]>{
    const platform=input.platform.trim().replace(/_top_10$/,'').replace(/_/g,'-');if(!/^[a-z0-9-]+$/.test(platform))throw new Error('Choose a valid FlixPatrol platform.');
    const country=(input.country??'US').toUpperCase();const region=countrySlugs[country]??country.toLowerCase();const url=`${this.#baseUrl}/top10/${platform}/${region}/`;
    let response:Response;try{response=await this.#fetch(url,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Mozilla/5.0 Vynode/1.0'},redirect:'follow',...(signal?{signal}:{})});}catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw new Error('FlixPatrol is unavailable.',{cause:error});}
    let html=await response.text();if(response.status===403||response.status===429||/cf-chl-|Just a moment|Cloudflare/i.test(html))html=await this.#browserFetch(url,signal);else if(!response.ok)throw new Error(`FlixPatrol request failed (status ${response.status}).`);const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((match)=>match[1]??'');
    const wanted=input.mediaType==='show'?0:tables.length>1?1:0;const table=tables[wanted];if(!table)return[];const output:FlixPatrolItem[]=[];for(const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...(row[1]??'').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match)=>match[1]??'');if(cells.length<2)continue;const rank=Number(unescapeHtml(cells[0]??'').match(/\d+/)?.[0]);const titleCell=cells.length>=4?cells[2]:cells[1];const anchor=titleCell?.match(/<a\b[^>]*href=["'][^"']*\/title\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);const title=unescapeHtml(anchor?.[1]??titleCell??'');if(Number.isInteger(rank)&&rank>0&&title&&!output.some((item)=>item.title.toLowerCase()===title.toLowerCase()))output.push({title,rank,mediaType:input.mediaType});if(output.length>=Math.max(1,Math.min(100,input.limit)))break;}return output;
  }
}
