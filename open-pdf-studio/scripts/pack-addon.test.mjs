import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installAddon, removeAddon, setAddonEnabled, verifyAddonPackage } from './addon-manager.mjs';
import { packAddon } from './pack-addon.mjs';

function syntheticNativeHeader() {
  const bytes = Buffer.alloc(256);
  if (process.platform === 'linux') {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    bytes.writeUInt16LE(process.arch === 'arm64' ? 183 : 62, 18);
  } else if (process.platform === 'win32') {
    bytes.write('MZ');
    bytes.writeUInt32LE(64, 60);
    bytes.write('PE\0\0', 64);
    bytes.writeUInt16LE(process.arch === 'arm64' ? 0xaa64 : 0x8664, 68);
  } else if (process.platform === 'darwin') {
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(process.arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  }
  return bytes;
}

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

test('native v3 package requires a matching executable and survives install', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-addon-native-test-'));
  try {
    const pluginDir = path.join(root, 'source');
    await mkdir(pluginDir);
    await writeFile(path.join(pluginDir, 'plugin.js'), 'export const createAddon = () => ({ apiVersion: 1, id: "native.test" });');
    const helper = path.join(root, 'synthetic-helper');
    await writeFile(helper, syntheticNativeHeader());
    if (process.platform !== 'win32') await chmod(helper, 0o755);
    const output = path.join(root, 'package');
    const manifest = await packAddon({ pluginDir, output, id: 'native.test', version: '1.0.0', helper });
    assert.equal(manifest.schemaVersion, 3);
    assert.equal(manifest.target.os, { linux: 'linux', win32: 'windows', darwin: 'macos' }[process.platform]);
    assert.equal(manifest.target.arch, process.arch);
    assert.equal(manifest.helper, process.platform === 'win32' ? 'helper.exe' : 'helper');
    await installAddon({ packageDir: output, appDataDir: path.join(root, 'data') });
    const installed = path.join(root, 'data/addons/packages/native.test');
    assert.deepEqual(await verifyAddonPackage(installed), manifest);
    await setAddonEnabled({ id: 'native.test', appDataDir: path.join(root, 'data'), enabled: false });
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'data/addons/enabled.json'))).ids, []);
    await setAddonEnabled({ id: 'native.test', appDataDir: path.join(root, 'data'), enabled: true });
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'data/addons/enabled.json'))).ids, ['native.test']);
    const bad = JSON.parse(await readFile(path.join(output, 'manifest.json')));
    bad.target.arch = process.arch === 'x64' ? 'arm64' : 'x64';
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify(bad));
    await assert.rejects(verifyAddonPackage(output), /target is incompatible/);
    assert.deepEqual(await verifyAddonPackage(installed), manifest);
    assert.equal(await removeAddon({ id: 'native.test', appDataDir: path.join(root, 'data') }), true);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'data/addons/enabled.json'))).ids, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native package rejects a fake header and leaves no output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-addon-native-test-'));
  try {
    const pluginDir = path.join(root, 'source');
    await mkdir(pluginDir);
    await writeFile(path.join(pluginDir, 'plugin.js'), 'export const createAddon = () => ({ apiVersion: 1, id: "native.test" });');
    const helper = path.join(root, 'bad-helper');
    await writeFile(helper, Buffer.alloc(256, 7));
    if (process.platform !== 'win32') await chmod(helper, 0o755);
    const output = path.join(root, 'package');
    await assert.rejects(packAddon({ pluginDir, output, id: 'native.test', version: '1.0.0', helper }), /helper target/);
    await assert.rejects(readFile(path.join(output, 'manifest.json')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
