import assert from 'node:assert/strict';
import test from 'node:test';
import { FlixPatrolClient } from './flixpatrol.js';

test('FlixPatrol source validates routes and parses the requested chart',async()=>{let requested='';const html='<table><tr><td>1.</td><td>-</td><td><a href="/title/show-one/">Show One</a></td><td>10</td></tr></table><table><tr><td>1.</td><td>-</td><td><a href="/title/movie-one/">Movie &amp; One</a></td><td>20</td></tr></table>';const client=new FlixPatrolClient({fetch:async(input)=>{requested=String(input);return new Response(html,{status:200});}});const result=await client.source({platform:'netflix_top_10',country:'US',mediaType:'movie',limit:10});assert.match(requested,/\/top10\/netflix\/united-states\/$/);assert.deepEqual(result,[{title:'Movie & One',rank:1,mediaType:'movie'}]);});

test('FlixPatrol source rejects unsafe platform slugs and provider failures',async()=>{const client=new FlixPatrolClient({fetch:async()=>new Response('',{status:503}),browserFetch:async()=>''});await assert.rejects(()=>client.source({platform:'../admin',mediaType:'show',limit:10}),/valid FlixPatrol platform/);await assert.rejects(()=>client.source({platform:'hulu_top_10',mediaType:'show',limit:10}),/status 503/);});

test('FlixPatrol uses browser fallback only for protected responses',async()=>{let browserCalls=0;const client=new FlixPatrolClient({fetch:async()=>new Response('<title>Just a moment</title>',{status:403}),browserFetch:async()=>{browserCalls+=1;return'<table><tr><td>1.</td><td><a href="/title/show/">Protected Show</a></td><td>2</td></tr></table>';}});const result=await client.source({platform:'hulu_top_10',country:'US',mediaType:'show',limit:10});assert.equal(browserCalls,1);assert.equal(result[0]?.title,'Protected Show');});
