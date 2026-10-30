// Manage independent add-ons in the editor's per-user data directory.
// Packages are inert until their ID is added to addons/enabled.json.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const editorVersion = JSON.parse(await readFile(path.join(here, '../package.json'), 'utf8')).version;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH = /^[0-9a-fA-F]{64}$/;
const MAX_INDEX = 64 * 1024;
const MAX_MANIFEST = 1024 * 1024;
const MAX_ADDONS = 64;
const REMOVAL_PREFIX = '.remove-';
const MAX_HELPER = 128 * 1024 * 1024;
const MAX_NOTICES = 4 * 1024 * 1024;
const HELPER_NAME = process.platform === 'win32' ? 'helper.exe' : 'helper';
const companionName = (index) => `companion-${index}${process.platform === 'win32' ? '.exe' : ''}`;

function nativeHeaderMatches(bytes) {
  if (process.platform === 'linux') {
    const machine = process.arch === 'x64' ? 62 : process.arch === 'arm64' ? 183 : -1;
    return bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
      bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === machine;
  }
  if (process.platform === 'win32') {
    if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') return false;
    const pe = bytes.readUInt32LE(60);
    const machine = process.arch === 'x64' ? 0x8664 : process.arch === 'arm64' ? 0xaa64 : -1;
    return pe <= bytes.length - 6 && bytes.toString('ascii', pe, pe + 4) === 'PE\0\0' && bytes.readUInt16LE(pe + 4) === machine;
  }
  if (process.platform === 'darwin') {
    const machine = process.arch === 'x64' ? 0x01000007 : process.arch === 'arm64' ? 0x0100000c : -1;
    return bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === machine;
  }
  return false;
}

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
      ![2, 3, 4].includes(manifest.schemaVersion) || manifest.hostApiVersion !== 1 ||
      typeof manifest.id !== 'string' || !ID.test(manifest.id) ||
      typeof manifest.version !== 'string' || !/^[A-Za-z0-9._+-]{1,64}$/.test(manifest.version) ||
      manifest.editorVersion !== expectedEditorVersion ||
      !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) ||
      (manifest.schemaVersion === 2 && manifest.helper !== undefined) ||
      (manifest.schemaVersion >= 3 && manifest.helper !== HELPER_NAME) ||
      (manifest.schemaVersion < 4 && manifest.sidecars !== undefined) ||
      (manifest.schemaVersion === 4 && (!Array.isArray(manifest.sidecars) ||
        manifest.sidecars.length < 1 || manifest.sidecars.length > 4 ||
        manifest.sidecars.some((name, index) => name !== companionName(index + 1))))) {
    throw new Error(`Add-on manifest is incompatible with editor ${expectedEditorVersion}.`);
  }
  const names = Object.keys(manifest.files);
  const sidecars = manifest.sidecars || [];
  if (!names.includes('plugin.js') || names.length > (manifest.schemaVersion === 2 ? 3 : 4 + sidecars.length) ||
      names.some((name) => name !== 'plugin.js' && name !== 'plugin.css' && name !== manifest.helper &&
        name !== 'NOTICES.txt' && !sidecars.includes(name)) ||
      (manifest.schemaVersion >= 3 && !names.includes(manifest.helper)) ||
      sidecars.some((name) => !names.includes(name)) ||
      (manifest.schemaVersion === 4 && !names.includes('NOTICES.txt'))) {
    throw new Error('Add-on files do not match the package schema.');
  }
  if (manifest.schemaVersion >= 3 && manifest.target === undefined) throw new Error('Native add-on needs a target.');
  if (manifest.target !== undefined) {
    const hostOs = { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform];
    const target = manifest.target;
    if (!target || typeof target !== 'object' || Array.isArray(target) ||
        Object.keys(target).sort().join(',') !== 'arch,os' || target.os !== hostOs ||
        (target.arch !== process.arch && !(hostOs === 'macos' && target.arch === 'universal')) ||
        (manifest.schemaVersion >= 3 && target.arch === 'universal')) {
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
        stat.size > (name === 'plugin.js' ? 64 * 1024 * 1024 : name === manifest.helper || sidecars.includes(name) ? MAX_HELPER
          : name === 'NOTICES.txt' ? MAX_NOTICES : 16 * 1024 * 1024)) {
      throw new Error(`Invalid add-on file: ${name}.`);
    }
    if (await sha256(file) !== manifest.files[name].toLowerCase()) throw new Error(`Add-on hash mismatch: ${name}.`);
    if (name === manifest.helper || sidecars.includes(name)) {
      if (process.platform !== 'win32' && !(stat.mode & 0o111)) throw new Error(`Add-on native file is not executable: ${name}.`);
      const handle = await open(file, 'r');
      try {
        const bytes = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (!nativeHeaderMatches(bytes.subarray(0, bytesRead))) throw new Error(`Add-on ${name === manifest.helper ? 'helper' : 'companion'} target does not match this host: ${name}.`);
      } finally { await handle.close(); }
    } else new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file));
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

async function recoverRemoved(addons, packages) {
  const ids = await readIndex(addons);
  for (const item of await readdir(packages, { withFileTypes: true })) {
    if (!item.name.startsWith(REMOVAL_PREFIX)) continue;
    const id = item.name.slice(REMOVAL_PREFIX.length);
    if (!ID.test(id) || !item.isDirectory() || item.isSymbolicLink()) {
      throw new Error(`Invalid staged add-on removal: ${item.name}`);
    }
    const staged = path.join(packages, item.name);
    const destination = path.join(packages, id);
    if (ids.includes(id) && !(await entry(destination))) {
      // Interrupted before the index changed: the enabled package is restored.
      await rename(staged, destination);
    } else {
      // Interrupted after the index changed, or a newer package was installed.
      // Windows may keep an executable open until the editor exits.
      try { await rm(staged, { recursive: true }); }
      catch (error) { if (!['EACCES', 'EPERM', 'EBUSY'].includes(error.code)) throw error; }
    }
  }
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
    await recoverRemoved(addons, packages);
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
        if ((name === manifest.helper || manifest.sidecars?.includes(name)) && process.platform !== 'win32') {
          await chmod(path.join(stage, name), (await lstat(path.join(source, name))).mode & 0o777);
        }
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

export async function removeAddon({ id, appDataDir, renameFile = rename, removeFile = rm, writeIndexFile = writeIndex }) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid add-on ID.');
  return withLock(appDataDir, async ({ addons, packages }) => {
    const destination = path.join(packages, id);
    const staged = path.join(packages, `${REMOVAL_PREFIX}${id}`);
    if (await entry(staged)) throw new Error('A previous add-on removal is waiting for the editor to close.');
    const info = await entry(destination);
    if (info) await directory(destination);
    const ids = await readIndex(addons);
    if (info) await renameFile(destination, staged);
    try {
      if (ids.includes(id)) await writeIndexFile(addons, ids.filter((item) => item !== id));
    } catch (error) {
      if (info) {
        try { await renameFile(staged, destination); }
        catch (rollback) { throw new AggregateError([error, rollback], 'Add-on removal failed and rollback needs recovery.'); }
      }
      throw error;
    }
    if (info) {
      try { await removeFile(staged, { recursive: true }); }
      catch (error) {
        if (!['EACCES', 'EPERM', 'EBUSY'].includes(error.code)) throw error;
        // The index no longer names this package. Its files are retried on
        // the next add-on operation, after the editor releases the helper.
      }
    }
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
    else if (command === 'remove') {
      const removed = await removeAddon(options);
      const pending = removed && await entry(path.join(path.resolve(options.appDataDir), 'addons/packages', `${REMOVAL_PREFIX}${options.id}`));
      console.log(!removed ? 'No add-on with that ID.' : pending
        ? 'Add-on disabled; close the editor to release its helper. Locked files are cleaned on the next add-on operation.'
        : 'Removed add-on; restart the editor.');
    }
    else if (command === 'enable' || command === 'disable') {
      await setAddonEnabled({ ...options, enabled: command === 'enable' });
      console.log(`${command === 'enable' ? 'Enabled' : 'Disabled'} ${options.id}; restart the editor.`);
    } else throw new Error('Expected install, remove, enable or disable command.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
