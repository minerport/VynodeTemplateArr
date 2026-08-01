import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const exists = async (path) =>
  access(resolve(root, path)).then(() => true, () => false);
const text = async (path) => readFile(resolve(root, path), 'utf8');

const checks = [];
const add = (area, requirement, ready, evidence) =>
  checks.push({ area, requirement, ready, evidence });

const releaseMarker = ['NON', 'RELEASE'].join('');
const scanRoots = ['apps', 'packages', 'scripts', 'docs'];
const scanExtensions = ['.js', '.mjs', '.ts', '.tsx', '.md'];
const filesUnder = async (directory) => {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const relative = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(relative) : [relative];
  }));
  return paths.flat();
};
const markerFiles = [];
for (const directory of scanRoots) {
  for (const path of await filesUnder(directory)) {
    if (!scanExtensions.some((extension) => path.endsWith(extension))) continue;
    if ((await text(path)).includes(releaseMarker)) markerFiles.push(path);
  }
}
add(
  'Release hygiene',
  'No temporary release markers remain in shipped source or documentation',
  markerFiles.length === 0 && !(await exists(`${releaseMarker}.md`)),
  markerFiles.length ? markerFiles.join(', ') : '0 temporary release marker(s)'
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

const posterParity = await text('docs/posters-parity-registry.md');
const uncheckedPosterRequirements = posterParity
  .split(/\r?\n/)
  .filter((line) => /^- \[ \]/.test(line));
add(
  'Original-app parity',
  'Every poster and overlay requirement is verified',
  uncheckedPosterRequirements.length === 0,
  `${uncheckedPosterRequirements.length} unchecked poster/overlay requirement(s)`
);

const pageRegistry = await text('docs/main-page-registry.md');
const incompletePageRows = pageRegistry
  .split(/\r?\n/)
  .filter((line) => /^\| `\//.test(line))
  .filter((line) => /\b(pending|incomplete|not implemented|stub)\b/i.test(line));
add(
  'Application routes',
  'Every exposed route has its production adapters',
  incompletePageRows.length === 0,
  `${incompletePageRows.length} route(s) still describe production gaps`
);

const integrations = await text('docs/integration-parity.md');
const incompleteIntegrationRows = integrations
  .split(/\r?\n/)
  .filter((line) => /^\| [A-Za-z]/.test(line) && !/^\| Integration or source/.test(line))
  .filter((line) => {
    const currentState = line.split('|')[3]?.trim() ?? '';
    return !/^(Complete|Documented exception)\b/i.test(currentState);
  });
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
