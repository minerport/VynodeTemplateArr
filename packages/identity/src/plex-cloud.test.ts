import assert from 'node:assert/strict';
import test from 'node:test';
import { PlexCloudAuthProvider } from './plex-cloud.js';

test('creates and completes a Plex PIN with a stable production client identifier',async()=>{
  const calls:{url:string;init:RequestInit|undefined}[]=[];
  const provider=new PlexCloudAuthProvider({clientIdentifier:'installation-1',now:()=>new Date('2026-01-01T00:00:00.000Z'),fetch:async(input,init)=>{ const url=String(input); calls.push({url,init}); if(url.endsWith('/pins')) return Response.json({id:7,code:'ABCD',expiresIn:120}); if(url.endsWith('/pins/7')) return Response.json({authToken:'secret-token'}); return Response.json({id:9,email:'OWNER@EXAMPLE.COM',username:'owner',subscription:{active:true}}); }});
  const pin=await provider.createPin(); assert.equal(pin.expiresAt,'2026-01-01T00:02:00.000Z'); assert.match(pin.authorizationUrl,/clientID=installation-1/);
  const authorized=await provider.pollPin('7'); assert.equal(authorized?.account.id,'9'); assert.equal(authorized?.token,'secret-token');
  assert.equal((calls[0]?.init?.headers as Record<string,string>)['X-Plex-Client-Identifier'],'installation-1');
});

test('does not expose rejected tokens and treats rate limiting as pending',async()=>{
  const pending=new PlexCloudAuthProvider({clientIdentifier:'installation-2',fetch:async()=>new Response(null,{status:429})}); assert.equal(await pending.pollPin('8'),undefined);
  const rejected=new PlexCloudAuthProvider({clientIdentifier:'installation-2',fetch:async()=>new Response(null,{status:401})}); await assert.rejects(()=>rejected.accountForToken('do-not-leak'),(error:unknown)=>error instanceof Error && /rejected/.test(error.message) && !error.message.includes('do-not-leak'));
});
