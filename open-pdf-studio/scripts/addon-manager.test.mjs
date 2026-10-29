import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installAddon, removeAddon, setAddonEnabled, verifyAddonPackage } from './addon-manager.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const editorVersion = JSON.parse(await readFile(path.join(here, '../package.json'), 'utf8')).version;
const hash = (text) => createHash('sha256').update(text).digest('hex');

async function fixture(root, id, source = 'export default function addon() {}') {
  const folder = path.join(root, `source-${id}`);
  await mkdir(folder);
  await writeFile(path.join(folder, 'plugin.js'), source);
  await writeFile(path.join(folder, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 2, hostApiVersion: 1, id, version: '1.0.0', editorVersion,
    files: { 'plugin.js': hash(source) },
  })}\n`);
  return folder;
}

async function enabled(root) {
  return JSON.parse(await readFile(path.join(root, 'addons/enabled.json'), 'utf8')).ids;
}

test('independent packages install, disable, enable, and remove without changing peers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'addon-manager-test-'));
  try {
    const appDataDir = path.join(root, 'data');
    const first = await fixture(root, 'first.addon');
    const second = await fixture(root, 'second.addon');
    await installAddon({ packageDir: first, appDataDir });
    await installAddon({ packageDir: second, appDataDir });
    assert.deepEqual(await enabled(appDataDir), ['first.addon', 'second.addon']);
    await setAddonEnabled({ id: 'first.addon', appDataDir, enabled: false });
    assert.deepEqual(await enabled(appDataDir), ['second.addon']);
    await setAddonEnabled({ id: 'first.addon', appDataDir, enabled: true });
    assert.deepEqual(await enabled(appDataDir), ['second.addon', 'first.addon']);
    assert.equal(await removeAddon({ id: 'second.addon', appDataDir }), true);
    assert.deepEqual(await enabled(appDataDir), ['first.addon']);
    assert.deepEqual((await readdir(path.join(appDataDir, 'addons/packages'))), ['first.addon']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('tampering, extra files, native payloads, and symlinks cannot replace an installed package', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'addon-manager-test-'));
  try {
    const appDataDir = path.join(root, 'data');
    const good = await fixture(root, 'safe.addon', 'const safe = true;');
    await installAddon({ packageDir: good, appDataDir });
    const installed = path.join(appDataDir, 'addons/packages/safe.addon/plugin.js');
    const bad = await fixture(root, 'safe.addon.next', 'const bad = true;');
    const manifestPath = path.join(bad, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.id = 'safe.addon';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(path.join(bad, 'plugin.js'), 'tampered');
    await assert.rejects(installAddon({ packageDir: bad, appDataDir }), /hash mismatch/);
    assert.equal(await readFile(installed, 'utf8'), 'const safe = true;');
    assert.deepEqual(await enabled(appDataDir), ['safe.addon']);
    await writeFile(path.join(bad, 'plugin.js'), 'const bad = true;');
    await writeFile(path.join(bad, 'helper'), 'native');
    await assert.rejects(verifyAddonPackage(bad), /unlisted files/);
    await rm(path.join(bad, 'helper'));
    await rm(path.join(bad, 'plugin.js'));
    await symlink(path.join(good, 'plugin.js'), path.join(bad, 'plugin.js'));
    await assert.rejects(verifyAddonPackage(bad), /Invalid add-on file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid IDs and incompatible editor versions never enter the index', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'addon-manager-test-'));
  try {
    const appDataDir = path.join(root, 'data');
    const bad = await fixture(root, 'versioned.addon');
    await assert.rejects(installAddon({ packageDir: bad, appDataDir, expectedEditorVersion: '0.0.0' }), /incompatible/);
    await assert.rejects(removeAddon({ id: '../escape', appDataDir }), /Invalid add-on ID/);
    await assert.rejects(setAddonEnabled({ id: '.hidden', appDataDir, enabled: true }), /Invalid add-on ID/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a stopped replacement restores the prior package before retrying', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'addon-manager-test-'));
  try {
    const appDataDir = path.join(root, 'data');
    const first = await fixture(root, 'recover.addon', 'const version = 1;');
    await installAddon({ packageDir: first, appDataDir });
    const packages = path.join(appDataDir, 'addons/packages');
    await rename(path.join(packages, 'recover.addon'), path.join(packages, '.previous-recover.addon'));
    const corrupt = await fixture(root, 'recover.addon.next', 'const version = 2;');
    const manifestPath = path.join(corrupt, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.id = 'recover.addon';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(path.join(corrupt, 'plugin.js'), 'tampered');
    await assert.rejects(installAddon({ packageDir: corrupt, appDataDir }), /hash mismatch/);
    // A valid retry recovers the prior package, then swaps in the new one.
    await writeFile(path.join(corrupt, 'plugin.js'), 'const version = 2;');
    await installAddon({ packageDir: corrupt, appDataDir });
    assert.equal(await readFile(path.join(packages, 'recover.addon/plugin.js'), 'utf8'), 'const version = 2;');
    assert.deepEqual(await readdir(packages), ['recover.addon']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
