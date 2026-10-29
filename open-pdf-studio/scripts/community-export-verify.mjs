// Verify the published Community source inventory and private-code boundary.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoots = ['.cargo/', '.github/', 'open-pdf-studio/', 'open-pdf-render/', 'pdfium-worker/',
  'open-pdf-cad/', 'ocg-render-copy/', 'open-pdf-geos/', 'mcp-stdio/', 'mcpb/', 'docs/'];
const rootFiles = new Set(['Cargo.toml', 'Cargo.lock', 'LICENSE.md', '.gitignore', '.gitattributes',
  'README.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'SOURCE-STATE.json', 'SBOM.cdx.json']);
const generatedFiles = new Set(['README.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'SOURCE-STATE.json', 'SBOM.cdx.json']);
const unapprovedPath = /(?:^|\/)(?:enterprise|apex|ocudraw|branding|recognition-notices|nsis)(?:\/|\.|$)|vplan/i;
const productTrace = /enterprise|(?<![a-z])apex|oculith-engines|vplan|(?<![a-z])oauth|(?<![a-z])oidc|openid|(?<![a-z])sign[- ]?in\b|(?<![a-z])signed in\b|(?<![a-z])log ?in\b|impertio|crewtracker|oculith account|load study|panel schedule|takeoff engine|recognition engine|ghostlab/i;
const traceExempt = /(?:^|\/)(?:LICENSE[^/]*|LGPL[^/]*|[^/]*notices?[^/]*\.txt)$/i;
const forbidden = [
  'open-pdf-studio/js/enterprise',
  'open-pdf-studio/js/ocudraw',
  'open-pdf-studio/branding',
  'open-pdf-studio/js/solid/components/dialogs/AccountDialog.jsx',
  'open-pdf-studio/js/solid/components/panels/VplanPanel.jsx',
  'open-pdf-studio/src-tauri/src/account_http.rs',
  'open-pdf-studio/src-tauri/src/account_loopback.rs',
  'open-pdf-studio/src-tauri/src/recognition_geometry.rs',
  'open-pdf-studio/src-tauri/src/recognition_process.rs',
  'open-pdf-studio/src-tauri/src/vplan_engine.rs',
  'open-pdf-studio/scripts/build-enterprise-recognition.mjs',
  'open-pdf-studio/src-tauri/tauri.recognition.conf.json',
  'open-pdf-studio/src-tauri/recognition-notices',
  'open-pdf-studio/src-tauri/icons',
  'open-pdf-studio/src-tauri/nsis',
  'open-pdf-studio/src-tauri/resources/onderhoeken',
  'open-pdf-studio/src-tauri/resources/kaders/detailblad_a3_liggend.pdf',
  'open-pdf-studio/src-tauri/resources/kaders/detailblad_a4_liggend.pdf',
  'open-pdf-studio/src-tauri/resources/kaders/voorblad_a3_liggend.pdf',
  'open-pdf-studio/scripts/generate-oculith-titleblock.mjs',
  'open-pdf-studio/scripts/oculith-vplan-editor-smoke.mjs',
  'open-pdf-studio/scripts/oculith-recognition-native-smoke.mjs',
  'open-pdf-studio/scripts/oculith-raster-recognition-native-smoke.mjs',
  'open-pdf-studio/scripts/oculith-vplan-takeoff-native-smoke.mjs',
  'open-pdf-studio/js/symbols/data/vbi-vloeren.js',
  'open-pdf-studio/js/symbols/templates/vloer-dxf.js',
  'open-pdf-studio/js/symbols/templates/paal-aanzicht.js',
  'open-pdf-studio/scripts/dxf-vloeren-convert.mjs',
  'open-pdf-studio/public/icon.png',
  'open-pdf-studio/public/icon.svg',
  'open-pdf-studio/public/favicon.ico',
];
const privateBundleMarkers = [
  '/api/v1/vplans', '/api/o/token', 'saveAccountVplan', 'loadLiveVPlan',
  'oculithSymbolLibrary', 'oculith-logo',
];
const generatedDirs = new Set([
  'open-pdf-studio/node_modules',
  'open-pdf-studio/dist',
  'open-pdf-studio/src-tauri/gen',
  'open-pdf-studio/src-tauri/target',
  'open-pdf-studio/src-tauri/resources/tessdata',
  'open-pdf-studio/src-tauri/resources/fonts',
  'target',
]);

async function exists(name) {
  return access(path.isAbsolute(name) ? name : path.join(root, name)).then(() => true, () => false);
}

async function scanBundle(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, item.name);
    if (item.isDirectory()) { await scanBundle(name); continue; }
    if (!item.isFile() || !/\.(?:js|css|html)$/i.test(item.name)) continue;
    const body = await readFile(name, 'utf8');
    const marker = privateBundleMarkers.find((candidate) => body.includes(candidate));
    if (marker) throw new Error(`Private marker ${marker} found in ${path.relative(root, name)}`);
  }
}

async function verifyPublicTree(expected) {
  const hits = [];
  for (const relative of expected) {
    // The verifier contains the forbidden terms as detection patterns.
    if (relative === 'open-pdf-studio/scripts/community-export-verify.mjs' || traceExempt.test(relative)) continue;
    if (productTrace.test(relative)) hits.push(`${relative}: file name`);
    const bytes = await readFile(path.join(root, relative));
    if (bytes.includes(0)) continue;
    for (const [index, line] of bytes.toString('utf8').split('\n').entries()) {
      if (productTrace.test(line)) hits.push(`${relative}:${index + 1}`);
    }
  }
  if (hits.length) throw new Error(`Private product traces in public source:\n${hits.slice(0, 100).join('\n')}`);
}

async function verifyPublicSbom(state, pkg) {
  const sbom = JSON.parse(await readFile(path.join(root, 'SBOM.cdx.json'), 'utf8'));
  if (sbom.bomFormat !== 'CycloneDX' || sbom.metadata?.component?.name !== 'Oculith Draw Foundation'
    || sbom.metadata.component.version !== pkg.version || !Array.isArray(sbom.components)) {
    throw new Error('Invalid Foundation SBOM.');
  }
  const properties = Object.fromEntries((sbom.metadata.properties || []).map((item) => [item.name, item.value]));
  const hash = async (relative) => createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex');
  if ((state && properties['ocudraw:sourceCommit'] !== state.commit)
    || (!state && properties['ocudraw:sourceCommit'])
    || properties['ocudraw:cargoLockSha256'] !== await hash('Cargo.lock')
    || properties['ocudraw:npmLockSha256'] !== await hash('open-pdf-studio/package-lock.json')) {
    throw new Error('Foundation SBOM does not match its source and lockfiles.');
  }
  const app = path.join(root, 'open-pdf-studio');
  const notices = path.join(app, 'src-tauri', 'package-notices');
  const [lock, npmInventory, rustInventory, rustNotices] = await Promise.all([
    readFile(path.join(app, 'package-lock.json'), 'utf8'),
    readFile(path.join(notices, 'npm-inventory.json'), 'utf8'),
    readFile(path.join(notices, 'rust-inventory.json'), 'utf8'),
    readFile(path.join(notices, 'rust-notice-manifest.json'), 'utf8'),
  ]).then((items) => items.map((item) => JSON.parse(item)));
  const npmLocked = Object.entries(lock.packages)
    .filter(([name, item]) => name && !item.dev)
    .map(([name, item]) => [name.slice('node_modules/'.length), item.version, item.license ?? null]);
  if (JSON.stringify(npmInventory.packages.map((item) =>
    [item.name, item.version, item.licenseFromLockfile])) !== JSON.stringify(npmLocked)) {
    throw new Error('Foundation npm inventory differs from the lockfile.');
  }
  const rustExternal = rustInventory.packages.filter((item) => !item.workspace);
  if (rustInventory.cargoLockSha256 !== properties['ocudraw:cargoLockSha256']
    || rustNotices.cargoLockSha256 !== properties['ocudraw:cargoLockSha256']
    || rustNotices.externalPackageCount !== rustExternal.length
    || JSON.stringify(rustNotices.packages.map((item) => [item.name, item.version, item.source]))
      !== JSON.stringify(rustExternal.map((item) => [item.name, item.version, item.source]))) {
    throw new Error('Foundation Rust inventory differs from the lockfile or notices.');
  }
  if (sbom.components.length !== npmInventory.packages.length + rustExternal.length) {
    throw new Error('Foundation SBOM component count differs from the inventories.');
  }
  const refs = sbom.components.map((item) => item['bom-ref']);
  if (new Set(refs).size !== refs.length) throw new Error('Duplicate Foundation SBOM component.');
}

async function checkSourceTree(dir, expected) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, item.name);
    const relative = path.relative(root, name).replaceAll(path.sep, '/');
    if (generatedDirs.has(relative)) continue;
    if (item.isDirectory()) { await checkSourceTree(name, expected); continue; }
    if (relative === 'SOURCE-MANIFEST.json') continue;
    if (/^open-pdf-studio\/src-tauri\/binaries\/(?:pdfium-worker|ocudraw-community-pdfium-worker)-[a-zA-Z0-9_-]+$/.test(relative)) continue;
    if (!item.isFile() || !expected.has(relative)) {
      throw new Error(`Unlisted or non-regular source entry: ${relative}`);
    }
  }
}

export async function verifyCommunityExport({ bundle = false, published = false } = {}) {
  if (published) {
    if (await exists('SOURCE-STATE.json') || await exists('SOURCE-MANIFEST.json')) {
      throw new Error('Published Foundation source retains private source provenance.');
    }
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root })
      .toString('utf8').split('\0').filter(Boolean);
    const expected = new Set(files);
    for (const relative of expected) {
      if ((!rootFiles.has(relative) && !sourceRoots.some((dir) => relative.startsWith(dir)))
        || unapprovedPath.test(relative)) throw new Error(`Unapproved public source path: ${relative}`);
    }
    const pkg = JSON.parse(await readFile(path.join(root, 'open-pdf-studio/package.json'), 'utf8'));
    await verifyPublicSbom(null, pkg);
    await verifyPublicTree(expected);
    for (const name of forbidden) if (await exists(name)) throw new Error(`Private source present: ${name}`);
    if (bundle) await scanBundle(path.join(root, 'open-pdf-studio/dist'));
    return expected.size;
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'SOURCE-MANIFEST.json'), 'utf8'));
  if (manifest.edition !== 'community' || !Array.isArray(manifest.files)) {
    throw new Error('Invalid Community source manifest.');
  }
  const state = JSON.parse(await readFile(path.join(root, 'SOURCE-STATE.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(root, 'open-pdf-studio/package.json'), 'utf8'));
  const tauri = JSON.parse(await readFile(path.join(root, 'open-pdf-studio/src-tauri/tauri.conf.json'), 'utf8'));
  const linux = JSON.parse(await readFile(path.join(root, 'open-pdf-studio/src-tauri/tauri.linux.conf.json'), 'utf8'));
  const cargo = await readFile(path.join(root, 'open-pdf-studio/src-tauri/Cargo.toml'), 'utf8');
  if (state.edition !== 'community' || state.commit !== manifest.commit
    || state.version !== pkg.version || manifest.version !== pkg.version
    || state.files !== manifest.files.filter((item) =>
      !item.path.startsWith('docs/') && item.path !== '.github/workflows/ci.yml'
      && !generatedFiles.has(item.path)).length) {
    throw new Error('Invalid Community source identity.');
  }
  if (!cargo.includes('description = "Oculith Draw Foundation, an open source PDF workspace"')
    || cargo.includes('description = "Oculith Draw,')) {
    throw new Error('Community native package description is not neutral.');
  }
  if (tauri.mainBinaryName !== 'ocudraw-community'
    || tauri.bundle?.externalBin?.[0] !== 'binaries/ocudraw-community-pdfium-worker'
    || linux.bundle?.externalBin?.[0] !== 'binaries/ocudraw-community-pdfium-worker') {
    throw new Error('Community native package binary names collide with Apex.');
  }
  let previous = '';
  const expected = new Set();
  for (const item of manifest.files) {
    if (item.path <= previous) throw new Error(`Unsorted or duplicate source path: ${item.path}`);
    previous = item.path;
    expected.add(item.path);
    if (path.isAbsolute(item.path) || item.path.split('/').includes('..')) {
      throw new Error(`Unsafe source path: ${item.path}`);
    }
    if ((!rootFiles.has(item.path) && !sourceRoots.some((dir) => item.path.startsWith(dir)))
      || unapprovedPath.test(item.path)) {
      throw new Error(`Unapproved source path: ${item.path}`);
    }
    const digest = createHash('sha256').update(await readFile(path.join(root, item.path))).digest('hex');
    if (digest !== item.sha256) throw new Error(`Source hash mismatch: ${item.path}`);
  }
  await checkSourceTree(root, expected);
  if (!expected.has('SBOM.cdx.json')) throw new Error('Community SBOM is missing.');
  await verifyPublicSbom(state, pkg);
  await verifyPublicTree(expected);
  for (const name of forbidden) if (await exists(name)) throw new Error(`Private source present: ${name}`);
  if (bundle) {
    const dist = path.join(root, 'open-pdf-studio', 'dist');
    if (!await exists(path.join(dist, 'index.html'))) throw new Error('Community bundle is missing.');
    await scanBundle(dist);
  }
  return manifest.files.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--bundle', '--published'].includes(arg))) throw new Error('Usage: node scripts/community-export-verify.mjs [--bundle] [--published]');
  const count = await verifyCommunityExport({ bundle: args.includes('--bundle'), published: args.includes('--published') });
  process.stdout.write(`Verified ${count} Foundation source files${args.includes('--bundle') ? ' and bundle' : ''}.\n`);
}
