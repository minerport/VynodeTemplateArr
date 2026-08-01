import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const exists = async (path) =>
  access(resolve(root, path)).then(() => true, () => false);
const text = async (path) => readFile(resolve(root, path), 'utf8');

const checks = [];
const add = (area, requirement, ready, evidence) =>
  checks.push({ area, requirement, ready, evidence });

const nonrelease = await text('NONRELEASE.md');
const openReleaseGates = nonrelease
  .split(/\r?\n/)
  .filter((line) => /^- \[ \]/.test(line));
add(
  'Release hygiene',
  'Every NONRELEASE item is closed or explicitly approved',
  openReleaseGates.length === 0,
  `${openReleaseGates.length} open release gate(s)`
);

const rootPackage = JSON.parse(await text('package.json'));
add(
  'Release hygiene',
  'Application has a non-development release version',
  typeof rootPackage.version === 'string' &&
    rootPackage.version !== '0.0.0' &&
    !/development/i.test(rootPackage.version),
  String(rootPackage.version ?? 'missing')
);

const requiredArtifacts = [
  ['Production control-plane entry point', 'apps/control-plane/src/server.ts'],
  ['Durable worker application', 'apps/worker/package.json'],
  ['Database migrations', 'packages/storage/src/migrations'],
  ['Production Docker image', 'Dockerfile'],
  ['Example container deployment', 'compose.yaml'],
  ['Unraid installation template', 'unraid/vynode.xml'],
  ['Distribution license notice', 'LICENSE'],
  ['Backup and restore command', 'apps/cli/src/backup.ts'],
];
for (const [requirement, path] of requiredArtifacts)
  add('Production platform', requirement, await exists(path), path);

const unraidTemplate = await text('unraid/vynode.xml');
add(
  'Production platform',
  'Unraid template contains no placeholder project URLs',
  !/https:\/\/github\.com\/<\//.test(unraidTemplate),
  'unraid/vynode.xml'
);

add(
  'Durable jobs',
  'Lease/retry/cancellation repository exists',
  await exists('packages/jobs/src/index.ts'),
  'packages/jobs/src/index.ts'
);

const parity = await text('docs/parity-registry.md');
const unresolvedParity = parity
  .split(/\r?\n/)
  .filter((line) => /^\| [A-Z]+-\d+ /.test(line))
  .filter((line) => /\| (discovered|specified) \|\s*$/.test(line));
add(
  'Original-app parity',
  'No capability remains merely discovered or specified',
  unresolvedParity.length === 0,
  `${unresolvedParity.length} unresolved parity row(s)`
);

const integrations = await text('docs/integration-parity.md');
const incompleteIntegrationRows = integrations
  .split(/\r?\n/)
  .filter((line) => /^\| [A-Za-z]/.test(line))
  .filter((line) =>
    /incomplete|UI only|Not yet audited|Finish |Implement |remaining|remain before|remain\./i.test(
      line
    )
  );
add(
  'Integrations',
  'Every exposed integration has production execution and validation',
  incompleteIntegrationRows.length === 0,
  `${incompleteIntegrationRows.length} integration row(s) still describe gaps`
);

const grouped = Map.groupBy(checks, (check) => check.area);
console.log('Vynode release readiness');
console.log('========================');
for (const [area, areaChecks] of grouped) {
  console.log(`\n${area}`);
  for (const check of areaChecks)
    console.log(
      `${check.ready ? '[PASS]' : '[BLOCK]'} ${check.requirement} (${check.evidence})`
    );
}
const blockers = checks.filter((check) => !check.ready);
console.log(`\n${checks.length - blockers.length}/${checks.length} release checks pass; ${blockers.length} blocker(s) remain.`);
if (!process.argv.includes('--report') && blockers.length) process.exitCode = 1;
