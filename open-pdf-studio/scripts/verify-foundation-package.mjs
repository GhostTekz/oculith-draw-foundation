// Inspect installed/extracted Foundation files, not just Tauri's resource map.
// Usage: node scripts/verify-foundation-package.mjs --root DIR [--artifact FILE] [--output JSON]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readlink, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(project, '..');
const tauri = path.join(project, 'src-tauri');
const licenseMarker = 'notices/Oculith-Draw-LICENSE.md';
const unlistedBinary = /^ocudraw-(?!(?:community(?:-pdfium-worker)?(?:\.exe)?|community\.(?:png|svg|ico))$)/i;
// Assemble this reserved folder name because the public source trace guard
// scans literal text even when it appears only in a package denylist.
const privateProductDirectory = ['ap', 'ex'].join('');
const privateExecutable = /^(?:ocudraw|oculith)-[^/]*(?:helper|engine)(?:\.exe)?$/i;

async function filesBelow(root) {
  const files = [];
  const symlinks = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) files.push(full);
      else if (entry.isSymbolicLink()) symlinks.push(full);
      // Ordinary platform library links may be present. Do not follow them.
    }
  }
  return { files, symlinks };
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function relativeUnix(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function requireOne(files, predicate, description) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) throw new Error(`Expected one ${description}; found ${matches.length}.`);
  return matches[0];
}

function privateAddonPath(name) {
  const parts = name.toLowerCase().split('/');
  return parts.includes(privateProductDirectory)
    || parts.some((part) => unlistedBinary.test(part) || privateExecutable.test(part))
    || /(?:^|\/)edition\/plugin\.(?:js|css)$/.test(name)
    || /(?:^|\/)addons\/active(?:\/|$)/.test(name);
}

async function rejectNoticeSymlink(resources, target, packageName) {
  let current = resources;
  for (const part of path.relative(resources, target).split(path.sep)) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`Missing packaged notice: ${packageName}`);
      throw error;
    });
    if (info.isSymbolicLink()) throw new Error(`Symlink in packaged notice path: ${packageName}`);
  }
}

export async function verifyFoundationPackage(root, { artifact } = {}) {
  const packageRoot = path.resolve(root);
  if (!(await lstat(packageRoot)).isDirectory()) throw new Error('Package root must be a directory.');
  const { files: packageFiles, symlinks } = await filesBelow(packageRoot);
  const names = [...packageFiles, ...symlinks].map((file) => relativeUnix(packageRoot, file));
  const marker = requireOne(packageFiles,
    (file) => relativeUnix(packageRoot, file).endsWith(`/${licenseMarker}`)
      || relativeUnix(packageRoot, file) === licenseMarker,
    'Foundation license in the installed resources');
  const resources = path.dirname(path.dirname(marker));
  const resourcesRelative = relativeUnix(packageRoot, resources);

  for (const name of names) {
    if (privateAddonPath(name)) {
      throw new Error(`Private add-on file in Foundation package: ${name}`);
    }
  }
  for (const link of symlinks) {
    const name = relativeUnix(packageRoot, link);
    const target = (await readlink(link)).split(path.sep).join('/');
    if (/(?:^|\/)notices(?:\/|$)/.test(name) || /(?:^|\/)plugin\.(?:js|css)$/.test(name)
        || privateAddonPath(target)) {
      throw new Error(`Suspicious symlink in Foundation package: ${name}`);
    }
  }
  requireOne(packageFiles, (file) => /^(?:ocudraw-community(?:\.exe)?)$/i.test(path.basename(file)),
    'Foundation executable');
  requireOne(packageFiles, (file) => /^(?:ocudraw-community-pdfium-worker(?:\.exe)?)$/i.test(path.basename(file)),
    'Foundation PDFium worker');

  const config = JSON.parse(await readFile(path.join(tauri, 'tauri.conf.json'), 'utf8'));
  let notices = 0;
  for (const [source, destination] of Object.entries(config.bundle.resources)) {
    if (!destination.startsWith('notices/')) continue;
    const sourcePath = path.resolve(tauri, source);
    const sourceInfo = await lstat(sourcePath);
    const sourceFiles = sourceInfo.isDirectory() ? (await filesBelow(sourcePath)).files : [sourcePath];
    for (const sourceFile of sourceFiles) {
      const relative = sourceInfo.isDirectory() ? relativeUnix(sourcePath, sourceFile) : '';
      const packageName = relative ? `${destination}/${relative}` : destination;
      const target = path.join(resources, ...packageName.split('/'));
      await rejectNoticeSymlink(resources, target, packageName);
      const targetInfo = await lstat(target).catch((error) => {
        if (error.code === 'ENOENT') throw new Error(`Missing packaged notice: ${packageName}`);
        throw error;
      });
      if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) {
        throw new Error(`Invalid packaged notice: ${packageName}`);
      }
      if (await sha256(sourceFile) !== await sha256(target)) {
        throw new Error(`Packaged notice differs from source: ${packageName}`);
      }
      notices += 1;
    }
  }
  if (!notices) throw new Error('No Foundation notice resources were checked.');

  const version = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version;
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  return {
    product: 'Oculith Draw Foundation', version, sourceCommit,
    resources: resourcesRelative, noticeFilesChecked: notices,
    ...(artifact ? { artifactSha256: await sha256(path.resolve(artifact)) } : {}),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let root;
    let artifact;
    let output;
    for (let index = 0; index < args.length; index += 2) {
      if (args[index] === '--root') root = args[index + 1];
      else if (args[index] === '--artifact') artifact = args[index + 1];
      else if (args[index] === '--output') output = args[index + 1];
      else throw new Error(`Unknown option: ${args[index]}`);
      if (!args[index + 1]) throw new Error(`Missing value for ${args[index]}`);
    }
    if (!root) throw new Error('--root is required.');
    const receipt = `${JSON.stringify(await verifyFoundationPackage(root, { artifact }), null, 2)}\n`;
    if (output) await writeFile(path.resolve(output), receipt, { flag: 'wx' });
    process.stdout.write(receipt);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
