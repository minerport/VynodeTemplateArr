import { hostname } from 'node:os';
import { resolve } from 'node:path';

import { FileDurableJobRepository } from '@vynode/jobs';

import { DurableWorker } from './index.js';

const dataDirectory = resolve(process.env.VYNODE_DATA_DIR ?? '.vynode');
const controller = new AbortController();
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, () => controller.abort(event));

const worker = new DurableWorker({
  repository: new FileDurableJobRepository(
    resolve(dataDirectory, 'jobs', 'queue.json')
  ),
  workerId: `${hostname()}-${process.pid}`,
  handlers: {},
});

await worker.run(controller.signal);
