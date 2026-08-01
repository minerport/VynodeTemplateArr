import staticFiles from '@fastify/static';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createControlPlane } from './app.js';
import { createProductionRuntime } from './production-runtime.js';

export const buildProductionControlPlane = async (
  environment: Readonly<Record<string,string|undefined>> = process.env
) => {
  const runtime=await createProductionRuntime(environment);
  try {
    const version = environment.VYNODE_VERSION?.trim() || '0.0.0';
    const latestVersion = environment.VYNODE_LATEST_VERSION?.trim() || version;
    const platformNames: Partial<Record<NodeJS.Platform, string>> = {
      win32: 'Windows',
      darwin: 'macOS',
      linux: 'Linux',
      freebsd: 'FreeBSD',
      openbsd: 'OpenBSD',
      aix: 'AIX',
      sunos: 'SunOS',
    };
    const app=await createControlPlane({
      onboarding:runtime.onboarding,
      plexLogin:runtime.plexLogin,
      plexServer:runtime.plexServer,
      plexServerDirectory:runtime.plexServerDirectory,
      integrations:runtime.integrations,
      traktOAuth:runtime.traktOAuth,
      collectionSourceValidator:async({type,subtype,customUrl})=>{
        if(type!=='mdblist'||subtype!=='custom')return undefined;
        const configured=await runtime.integrations.get('mdblist');
        const stored=await new (await import('./production-repositories.js')).SqliteIntegrationRepository(runtime.storage).get('mdblist');
        const apiKey=stored?.secretReference?runtime.secrets.get(stored.secretReference):undefined;
        if(!configured?.configured||!apiKey)throw new Error('Configure and test MDBList in Settings before validating a list.');
        const inspection=await new (await import('@vynode/integrations')).MDBListClient({apiKey}).inspect(customUrl??'');
        const details=[inspection.itemCount!==undefined?`${inspection.itemCount} item${inspection.itemCount===1?'':'s'}`:undefined,inspection.private?'private list':'public list',inspection.dynamic?'dynamic':undefined].filter((value):value is string=>Boolean(value));
        return{valid:true as const,title:inspection.title,contentType:inspection.contentType,message:details.length?`MDBList verified: ${details.join(' · ')}.`:'MDBList verified.'};
      },
      collectionSurface:runtime.collections,
      posterOverlays:runtime.posterOverlays,
      collectionPosters:runtime.collectionPosters,
      placeholders:runtime.placeholderServices.settings,
      placeholderInventory:runtime.placeholderServices.inventory,
      directoryBrowser:runtime.placeholderServices.directoryBrowser,
      youtubeCookieStatus:()=>runtime.placeholderServices.youtubeCookieStatus(),
      watchlists:runtime.watchlists.service,
      plexWebhook:runtime.plexWebhook,
      generalSettings:runtime.generalSettings,
      apiKeyAuthentication:runtime.generalSettings,
      dashboardJobs:runtime.dashboardJobs,
      jobsAndCache:runtime.jobsAndCache,
      downloads:runtime.downloads,
      seerr:runtime.seerr,
      dashboardInsights:runtime.dashboardInsights,
      fetchingPolicy:runtime.fetchingPolicy,
      arrCollectionSources:{async servers(kind){return(await runtime.downloads.list(kind)).map((item)=>({id:item.id,name:item.endpoint.name,kind:item.endpoint.kind}));},async tags(serverId){const configured=await runtime.arrRepository.get(serverId);if(!configured)throw new Error('Download server was not found.');const apiKey=runtime.secrets.get(configured.secretReference);if(!apiKey)throw new Error('Download server credential is unavailable.');return new (await import('@vynode/downloads')).ArrTagSourceClient({...configured.endpoint,apiKey}).tags();}},
      applicationLogs: {
        async list() {
          return runtime.audit.recent(1000).map((event) => ({
            id: String(event.sequence),
            timestamp: String(event.occurredAt),
            level: event.outcome === 'failure' ? ('error' as const) : ('info' as const),
            label: String(event.action),
            message: `${String(event.action)} ${String(event.outcome)} for ${String(event.target)}`,
            data: {
              target: String(event.target),
              outcome: String(event.outcome),
              ...(event.actorId ? { actorId: String(event.actorId) } : {}),
              ...(event.details && typeof event.details === 'object' ? { details: event.details } : {}),
            },
          }));
        },
        async appDataPath() { return runtime.configuration.dataDirectory; },
        async record(entry) {
          runtime.audit.append({
            occurredAt: entry.timestamp,
            action: entry.label || 'application.error',
            target: typeof entry.data?.path === 'string' ? entry.data.path : 'control-plane',
            outcome: entry.level === 'error' ? 'failure' : 'success',
            details: {
              message: entry.message,
              ...(entry.data ? { data: entry.data } : {}),
            },
          });
        },
      },
      async aboutInformation() {
        return {
          version,
          build: environment.VYNODE_BUILD?.trim() || 'production',
          commit: environment.VYNODE_COMMIT?.trim() || 'unknown',
          updateAvailable: latestVersion !== version,
          updateCheckAvailable: Boolean(environment.VYNODE_LATEST_VERSION?.trim()),
          latestVersion,
          restartRequired: environment.VYNODE_RESTART_REQUIRED === 'true',
          nodeVersion: process.version,
          platform: platformNames[process.platform] ?? process.platform,
          architecture: process.arch,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          appDataPath: runtime.configuration.dataDirectory,
          uptimeSeconds: Math.floor(process.uptime()),
          ...(environment.VYNODE_DOCUMENTATION_URL?.trim() ? { documentationUrl: environment.VYNODE_DOCUMENTATION_URL.trim() } : {}),
          ...(environment.VYNODE_ISSUE_URL?.trim() ? { issueUrl: environment.VYNODE_ISSUE_URL.trim() } : {}),
          ...(environment.VYNODE_SOURCE_URL?.trim() ? { sourceUrl: environment.VYNODE_SOURCE_URL.trim() } : {}),
          license: 'GPL-3.0-only',
        };
      },
      ownerPlexTokenReference:()=>runtime.ownerPlexTokenReference(),
      sessions:runtime.sessions,
      async healthCheck() {
        runtime.storage.database.prepare('SELECT 1').get();
        await access(
          runtime.configuration.dataDirectory,
          constants.R_OK | constants.W_OK
        );
      },
      allowedOrigin:runtime.configuration.publicUrl,
      trustProxy:runtime.configuration.trustProxy,
      production:runtime.configuration.secureCookies,
      now:()=>new Date(),
    });
    const webRoot=resolve(environment.VYNODE_WEB_ROOT?.trim()||fileURLToPath(new URL('../../web/dist',import.meta.url)));
    try {
      await access(resolve(webRoot,'index.html'));
      await app.register(staticFiles,{root:webRoot,prefix:'/'});
      app.setNotFoundHandler((request,reply)=>request.method==='GET'&&!request.url.startsWith('/api/')&&request.headers.accept?.includes('text/html')?reply.sendFile('index.html'):reply.code(404).send({message:'Not found.'}));
    } catch { /* API-only deployments remain supported. */ }
    const close=async()=>{ await app.close(); runtime.close(); };
    return {app,runtime,close};
  } catch(error){ runtime.close(); throw error; }
};

export const startProductionControlPlane = async (
  environment: Readonly<Record<string,string|undefined>> = process.env
) => {
  const built=await buildProductionControlPlane(environment);
  try {
    const {app,runtime}=built;
    await app.listen({host:runtime.configuration.host,port:runtime.configuration.port});
    return built;
  } catch(error){ await built.close(); throw error; }
};

if(process.argv[1] && resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  startProductionControlPlane().then(({close})=>{
    let closing=false; const shutdown=()=>{ if(closing)return; closing=true; void close().finally(()=>process.exit()); };
    process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown);
  }).catch((error)=>{ console.error(error instanceof Error?error.message:String(error)); process.exitCode=1; });
}
