import { randomBytes } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve } from 'node:path';

export interface ProductionConfiguration {
  dataDirectory: string;
  databasePath: string;
  host: string;
  port: number;
  publicUrl: string;
  trustProxy: boolean;
  secureCookies: boolean;
  masterKey: Buffer;
  mediaRoots: readonly string[];
}

const booleanValue = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Boolean environment values must be "true" or "false".');
};

export const loadProductionConfiguration = async (
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<ProductionConfiguration> => {
  if (environment.VYNODE_DEV_PLEX_TOKEN)
    throw new Error('VYNODE_DEV_PLEX_TOKEN is forbidden in production.');
  const configuredDirectory = environment.VYNODE_DATA_DIR?.trim();
  if (!configuredDirectory)
    throw new Error('VYNODE_DATA_DIR is required in production.');
  const dataDirectory = resolve(configuredDirectory);
  if (!isAbsolute(dataDirectory))
    throw new Error('VYNODE_DATA_DIR must resolve to an absolute path.');
  const rawPort = environment.VYNODE_PORT?.trim() ?? '7171';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('VYNODE_PORT must be a whole number from 1 through 65535.');
  const host = environment.VYNODE_HOST?.trim() || '127.0.0.1';
  if (/\s|\//.test(host)) throw new Error('VYNODE_HOST is invalid.');
  const publicUrl = environment.VYNODE_PUBLIC_URL?.trim();
  if (!publicUrl) throw new Error('VYNODE_PUBLIC_URL is required in production.');
  let parsed: URL;
  try { parsed = new URL(publicUrl); } catch { throw new Error('VYNODE_PUBLIC_URL must be a valid URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw new Error('VYNODE_PUBLIC_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopback)
    throw new Error('VYNODE_PUBLIC_URL must use HTTPS unless it is loopback-only.');
  const masterKeyValue = environment.VYNODE_MASTER_KEY?.trim();
  if (!masterKeyValue) throw new Error('VYNODE_MASTER_KEY is required in production.');
  const masterKey = Buffer.from(masterKeyValue, 'base64');
  if (masterKey.byteLength !== 32)
    throw new Error('VYNODE_MASTER_KEY must be base64 for exactly 32 bytes.');
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const probe = resolve(dataDirectory, `.write-probe-${randomBytes(8).toString('hex')}`);
  const handle = await open(probe, 'wx', 0o600).catch((error) => {
    throw new Error('VYNODE_DATA_DIR is not writable.', { cause: error });
  });
  await handle.close();
  await rm(probe, { force: true });
  const configuredMediaRoots = (environment.VYNODE_MEDIA_ROOTS?.split(delimiter) ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  if (configuredMediaRoots.some((value) => !isAbsolute(value)))
    throw new Error('Every VYNODE_MEDIA_ROOTS entry must be an absolute path.');
  const mediaRoots = configuredMediaRoots.map((value) => resolve(value));
  if (mediaRoots.length === 0) {
    mediaRoots.push(resolve(dataDirectory, 'media'));
  }
  await Promise.all(mediaRoots.map((root) => mkdir(root, { recursive: true, mode: 0o700 })));
  const trustProxy = booleanValue(environment.VYNODE_TRUST_PROXY, false);
  return {
    dataDirectory,
    databasePath: resolve(dataDirectory, 'database', 'vynode.sqlite'),
    host,
    port,
    publicUrl: parsed.origin,
    trustProxy,
    secureCookies: parsed.protocol === 'https:',
    masterKey,
    mediaRoots,
  };
};
