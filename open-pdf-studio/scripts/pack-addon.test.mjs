import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installAddon, verifyAddonPackage } from './addon-manager.mjs';
import { packAddon } from './pack-addon.mjs';

test('built package installs with only its listed script and style', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-addon-test-'));
  try {
    const pluginDir = path.join(root, 'source');
    await mkdir(pluginDir);
    await writeFile(path.join(pluginDir, 'plugin.js'), 'export const createAddon = () => ({ apiVersion: 1 });');
    await writeFile(path.join(pluginDir, 'plugin.css'), '.addon { color: red; }');
    await writeFile(path.join(pluginDir, 'notes.txt'), 'source-only material');
    const output = path.join(root, 'package');
    const manifest = await packAddon({ pluginDir, output, id: 'sample.addon', version: '1.0.0' });
    assert.deepEqual(Object.keys(manifest.files), ['plugin.js', 'plugin.css']);
    assert.deepEqual(await verifyAddonPackage(output), manifest);
    await installAddon({ packageDir: output, appDataDir: path.join(root, 'data') });
    assert.equal(JSON.parse(await readFile(path.join(root, 'data/addons/enabled.json'))).ids[0], 'sample.addon');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid source and incompatible version leave no output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-addon-test-'));
  try {
    const pluginDir = path.join(root, 'source');
    await mkdir(pluginDir);
    await writeFile(path.join(pluginDir, 'plugin.js'), 'export default 1;');
    const output = path.join(root, 'package');
    await assert.rejects(packAddon({ pluginDir, output, id: '../bad', version: '1.0.0' }), /Invalid add-on ID/);
    await assert.rejects(packAddon({ pluginDir, output, id: 'sample.addon', version: 'bad version' }), /Invalid add-on ID or version/);
    await rm(path.join(pluginDir, 'plugin.js'));
    await symlink(path.join(root, 'missing.js'), path.join(pluginDir, 'plugin.js'));
    await assert.rejects(packAddon({ pluginDir, output, id: 'sample.addon', version: '1.0.0' }), /Invalid source file/);
    await assert.rejects(readFile(path.join(output, 'manifest.json')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
