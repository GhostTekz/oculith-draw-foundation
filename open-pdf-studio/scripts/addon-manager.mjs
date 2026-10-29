// Manage independent, script-only add-ons in the editor's per-user data directory.
// Packages are inert until their ID is added to addons/enabled.json.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const editorVersion = JSON.parse(await readFile(path.join(here, '../package.json'), 'utf8')).version;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH = /^[0-9a-fA-F]{64}$/;
const MAX_INDEX = 64 * 1024;
const MAX_MANIFEST = 1024 * 1024;
const MAX_ADDONS = 64;

async function entry(name) {
  try { return await lstat(name); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function directory(name) {
  const info = await lstat(name);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected a real directory: ${name}`);
}

async function sha256(name) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(name)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyAddonPackage(packageDir, expectedEditorVersion = editorVersion) {
  const root = path.resolve(packageDir);
  await directory(root);
  const manifestFile = path.join(root, 'manifest.json');
  const info = await lstat(manifestFile);
  if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > MAX_MANIFEST) {
    throw new Error('Invalid add-on manifest file.');
  }
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.schemaVersion !== 2 || manifest.hostApiVersion !== 1 ||
      typeof manifest.id !== 'string' || !ID.test(manifest.id) ||
      typeof manifest.version !== 'string' || !/^[A-Za-z0-9._+-]{1,64}$/.test(manifest.version) ||
      manifest.editorVersion !== expectedEditorVersion ||
      !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) ||
      manifest.helper !== undefined) {
    throw new Error(`Add-on manifest is incompatible with editor ${expectedEditorVersion}.`);
  }
  const names = Object.keys(manifest.files);
  if (!names.includes('plugin.js') || names.length > 2 ||
      names.some((name) => name !== 'plugin.js' && name !== 'plugin.css')) {
    throw new Error('Add-on files must be plugin.js and optional plugin.css.');
  }
  if (manifest.target !== undefined) {
    const hostOs = { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform];
    const target = manifest.target;
    if (!target || typeof target !== 'object' || Array.isArray(target) ||
        Object.keys(target).sort().join(',') !== 'arch,os' || target.os !== hostOs ||
        (target.arch !== process.arch && !(hostOs === 'macos' && target.arch === 'universal'))) {
      throw new Error('Add-on target is incompatible with this host.');
    }
  }
  const found = (await readdir(root, { withFileTypes: true })).map((file) => file.name).sort();
  if (found.join('\0') !== ['manifest.json', ...names].sort().join('\0')) {
    throw new Error('Add-on package has unlisted files.');
  }
  for (const name of names) {
    if (!HASH.test(manifest.files[name])) throw new Error(`Invalid hash for ${name}.`);
    const file = path.join(root, name);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size ||
        stat.size > (name === 'plugin.js' ? 64 : 16) * 1024 * 1024) {
      throw new Error(`Invalid add-on file: ${name}.`);
    }
    if (await sha256(file) !== manifest.files[name].toLowerCase()) throw new Error(`Add-on hash mismatch: ${name}.`);
    new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file));
  }
  return manifest;
}

async function readIndex(addons) {
  const file = path.join(addons, 'enabled.json');
  const info = await entry(file);
  if (!info) return [];
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_INDEX) throw new Error('Invalid add-on index.');
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'ids,schemaVersion' ||
      value.schemaVersion !== 1 || !Array.isArray(value.ids) || value.ids.length > MAX_ADDONS ||
      value.ids.some((id) => typeof id !== 'string' || !ID.test(id)) ||
      new Set(value.ids).size !== value.ids.length) throw new Error('Invalid add-on index.');
  return value.ids;
}

async function writeIndex(addons, ids) {
  if (ids.length > MAX_ADDONS) throw new Error('Too many enabled add-ons.');
  const stage = path.join(addons, `.enabled-${process.pid}-${Date.now()}.json`);
  try {
    await writeFile(stage, `${JSON.stringify({ schemaVersion: 1, ids }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(stage, path.join(addons, 'enabled.json'));
  } finally { await rm(stage, { force: true }); }
}

async function withLock(appDataDir, callback) {
  if (typeof appDataDir !== 'string' || !appDataDir) throw new Error('--app-data-dir is required.');
  const appData = path.resolve(appDataDir);
  const prior = await entry(appData);
  if (prior) await directory(appData);
  else await mkdir(appData, { recursive: true });
  const addons = path.join(appData, 'addons');
  if (await entry(addons)) await directory(addons);
  else await mkdir(addons);
  const packages = path.join(addons, 'packages');
  if (await entry(packages)) await directory(packages);
  else await mkdir(packages);
  const lockFile = path.join(addons, '.install.lock');
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another add-on operation is running.');
    throw error;
  }
  try {
    await lock.writeFile(`${process.pid}\n`);
    return await callback({ addons, packages });
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}

export async function installAddon({ packageDir, appDataDir, expectedEditorVersion = editorVersion }) {
  if (typeof packageDir !== 'string' || !packageDir) throw new Error('--package is required.');
  const source = path.resolve(packageDir);
  const manifest = await verifyAddonPackage(source, expectedEditorVersion);
  return withLock(appDataDir, async ({ addons, packages }) => {
    if (source === addons || source.startsWith(`${addons}${path.sep}`)) {
      throw new Error('Source package must be outside the add-ons directory.');
    }
    const ids = await readIndex(addons);
    if (!ids.includes(manifest.id) && ids.length >= MAX_ADDONS) throw new Error('Too many enabled add-ons.');
    const destination = path.join(packages, manifest.id);
    const backup = path.join(packages, `.previous-${manifest.id}`);
    if (await entry(backup)) {
      await directory(backup);
      if (await entry(destination)) {
        await directory(destination);
        await rm(backup, { recursive: true });
      } else await rename(backup, destination);
    }
    const stage = await mkdtemp(path.join(packages, '.install-stage-'));
    let movedOld = false;
    let movedNew = false;
    try {
      for (const name of ['manifest.json', ...Object.keys(manifest.files)]) {
        await copyFile(path.join(source, name), path.join(stage, name));
      }
      await verifyAddonPackage(stage, expectedEditorVersion);
      if (await entry(destination)) { await directory(destination); await rename(destination, backup); movedOld = true; }
      await rename(stage, destination);
      movedNew = true;
      try { await writeIndex(addons, ids.includes(manifest.id) ? ids : [...ids, manifest.id]); }
      catch (error) {
        await rm(destination, { recursive: true });
        movedNew = false;
        if (movedOld) { await rename(backup, destination); movedOld = false; }
        throw error;
      }
      if (movedOld) await rm(backup, { recursive: true });
      return manifest;
    } catch (error) {
      if (movedOld && !movedNew && !(await entry(destination))) {
        try { await rename(backup, destination); }
        catch (rollback) { throw new AggregateError([error, rollback], 'Add-on rollback requires recovery.'); }
      }
      throw error;
    } finally { await rm(stage, { recursive: true, force: true }); }
  });
}

export async function setAddonEnabled({ id, appDataDir, enabled }) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid add-on ID.');
  return withLock(appDataDir, async ({ addons, packages }) => {
    const ids = await readIndex(addons);
    if (enabled) {
      const manifest = await verifyAddonPackage(path.join(packages, id));
      if (manifest.id !== id) throw new Error('Installed add-on ID does not match its directory.');
      if (!ids.includes(id)) await writeIndex(addons, [...ids, id]);
    } else if (ids.includes(id)) await writeIndex(addons, ids.filter((item) => item !== id));
    return enabled;
  });
}

export async function removeAddon({ id, appDataDir }) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid add-on ID.');
  return withLock(appDataDir, async ({ addons, packages }) => {
    const destination = path.join(packages, id);
    const info = await entry(destination);
    if (info) await directory(destination);
    const ids = await readIndex(addons);
    if (ids.includes(id)) await writeIndex(addons, ids.filter((item) => item !== id));
    if (info) await rm(destination, { recursive: true });
    return !!info;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      if (!args[i + 1]) throw new Error(`Missing value for ${key}`);
      if (key === '--app-data-dir') options.appDataDir = args[i + 1];
      else if (key === '--package') options.packageDir = args[i + 1];
      else if (key === '--id') options.id = args[i + 1];
      else throw new Error(`Unknown option: ${key}`);
    }
    if (command === 'install') console.log(`Installed ${(await installAddon(options)).id}; restart the editor to load it.`);
    else if (command === 'remove') console.log((await removeAddon(options)) ? 'Removed add-on; restart the editor.' : 'No add-on with that ID.');
    else if (command === 'enable' || command === 'disable') {
      await setAddonEnabled({ ...options, enabled: command === 'enable' });
      console.log(`${command === 'enable' ? 'Enabled' : 'Disabled'} ${options.id}; restart the editor.`);
    } else throw new Error('Expected install, remove, enable or disable command.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
