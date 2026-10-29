// Build a verified add-on package from script, style, and optional native files.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAddonPackage } from './addon-manager.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const editorVersion = JSON.parse(await readFile(path.join(here, '../package.json'), 'utf8')).version;

async function hashFile(name) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(name)) hash.update(chunk);
  return hash.digest('hex');
}

export async function packAddon({ pluginDir, output, id, version, helper, sidecars = [], notices, expectedEditorVersion = editorVersion }) {
  if (typeof pluginDir !== 'string' || !pluginDir || typeof output !== 'string' || !output) {
    throw new Error('A source directory and output directory are required.');
  }
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ||
      typeof version !== 'string' || !/^[A-Za-z0-9._+-]{1,64}$/.test(version)) {
    throw new Error('Invalid add-on ID or version.');
  }
  if (!Array.isArray(sidecars) || sidecars.length > 4 || (sidecars.length && !helper) ||
      sidecars.some((file) => typeof file !== 'string' || !file)) {
    throw new Error('Companions require one to four source files and a helper.');
  }
  const source = path.resolve(pluginDir);
  const destination = path.resolve(output);
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('Source must be a real directory.');
  if (destination === source || destination.startsWith(`${source}${path.sep}`)) {
    throw new Error('Output must be outside the source directory.');
  }
  if (await lstat(destination).then(() => true, (error) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) throw new Error('Output already exists.');
  await mkdir(path.dirname(destination), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(destination), '.addon-package-'));
  try {
    const files = {};
    for (const name of ['plugin.js', 'plugin.css']) {
      const input = path.join(source, name);
      const info = await lstat(input).catch((error) => {
        if (error.code === 'ENOENT' && name === 'plugin.css') return null;
        throw error;
      });
      if (!info) continue;
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Invalid source file: ${name}.`);
      await copyFile(input, path.join(stage, name));
      files[name] = await hashFile(path.join(stage, name));
    }
    let helperName;
    if (helper) {
      const input = path.resolve(helper);
      const info = await lstat(input);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Helper must be a regular file.');
      helperName = process.platform === 'win32' ? 'helper.exe' : 'helper';
      const destination = path.join(stage, helperName);
      await copyFile(input, destination);
      if (process.platform !== 'win32') await chmod(destination, info.mode & 0o777);
      files[helperName] = await hashFile(destination);
    }
    const sidecarNames = [];
    for (const [index, sidecar] of sidecars.entries()) {
      const input = path.resolve(sidecar);
      const info = await lstat(input);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Companion must be a regular file.');
      const name = `companion-${index + 1}${process.platform === 'win32' ? '.exe' : ''}`;
      const packed = path.join(stage, name);
      await copyFile(input, packed);
      if (process.platform !== 'win32') await chmod(packed, info.mode & 0o777);
      files[name] = await hashFile(packed);
      sidecarNames.push(name);
    }
    if (notices) {
      const input = path.resolve(notices);
      const info = await lstat(input);
      if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > 4 * 1024 * 1024) {
        throw new Error('Notices must be a regular UTF-8 file of at most 4 MiB.');
      }
      const destination = path.join(stage, 'NOTICES.txt');
      new TextDecoder('utf-8', { fatal: true }).decode(await readFile(input));
      await copyFile(input, destination);
      files['NOTICES.txt'] = await hashFile(destination);
    }
    const os = { linux: 'linux', win32: 'windows', darwin: 'macos' }[process.platform];
    const manifest = { schemaVersion: sidecarNames.length ? 4 : helper ? 3 : 2, id, version, hostApiVersion: 1, editorVersion: expectedEditorVersion,
      ...(helper ? { target: { os, arch: process.arch }, helper: helperName } : {}),
      ...(sidecarNames.length ? { sidecars: sidecarNames } : {}), files };
    await writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await verifyAddonPackage(stage, expectedEditorVersion);
    await rename(stage, destination);
    return manifest;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      if (!args[i + 1]) throw new Error(`Missing value for ${flag}`);
      if (flag === '--source') options.pluginDir = args[i + 1];
      else if (flag === '--output') options.output = args[i + 1];
      else if (flag === '--id') options.id = args[i + 1];
      else if (flag === '--version') options.version = args[i + 1];
      else if (flag === '--helper') options.helper = args[i + 1];
      else if (flag === '--notices') options.notices = args[i + 1];
      else if (flag === '--sidecar') (options.sidecars ??= []).push(args[i + 1]);
      else throw new Error(`Unknown option: ${flag}`);
    }
    if (!options.pluginDir || !options.output || !options.id || !options.version) throw new Error('Usage: node scripts/pack-addon.mjs --source DIR --output DIR --id ID --version VERSION [--helper FILE] [--sidecar FILE ...] [--notices FILE]');
    const manifest = await packAddon(options);
    console.log(`Built ${manifest.id} ${manifest.version} at ${options.output}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
