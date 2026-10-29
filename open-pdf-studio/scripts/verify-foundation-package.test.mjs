import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyFoundationPackage } from './verify-foundation-package.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauri = path.join(project, 'src-tauri');

test('extracted Foundation package carries exact notices and no private add-on files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'foundation-package-audit-'));
  const resources = path.join(root, 'usr', 'lib', 'ocudraw-community');
  try {
    const config = (await import('../src-tauri/tauri.conf.json', { with: { type: 'json' } })).default;
    for (const [source, destination] of Object.entries(config.bundle.resources)) {
      if (!destination.startsWith('notices/')) continue;
      const target = path.join(resources, destination);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.resolve(tauri, source), target, { recursive: true });
    }
    const bin = path.join(root, 'usr', 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, 'ocudraw-community'), 'editor');
    await writeFile(path.join(bin, 'ocudraw-community-pdfium-worker'), 'worker');
    const icons = path.join(root, 'usr', 'share', 'icons', 'hicolor', '32x32', 'apps');
    await mkdir(icons, { recursive: true });
    await writeFile(path.join(icons, 'ocudraw-community.png'), 'public icon');

    const artifact = path.join(root, 'foundation-installer.bin');
    await writeFile(artifact, 'package bytes');
    const result = await verifyFoundationPackage(root, { artifact });
    assert.equal(result.product, 'Oculith Draw Foundation');
    assert.match(result.sourceCommit, /^[0-9a-f]{40}$/);
    assert.equal(result.sourceTree,
      execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: path.resolve(project, '..'), encoding: 'utf8' }).trim());
    assert.equal(result.sourceArchiveUrl,
      `https://github.com/GhostTekz/oculith-foundation/archive/${result.sourceCommit}.tar.gz`);
    assert.ok(result.noticeFilesChecked > 50);
    assert.equal(result.artifactSha256, createHash('sha256').update('package bytes').digest('hex'));
    const receipt = path.join(root, 'package-audit.json');
    execFileSync(process.execPath, [path.join(project, 'scripts/verify-foundation-package.mjs'),
      '--root', root, '--artifact', artifact, '--output', receipt]);
    assert.deepEqual(JSON.parse(await readFile(receipt, 'utf8')), result);

    const license = path.join(resources, 'notices', 'Oculith-Draw-LICENSE.md');
    await writeFile(license, 'incomplete license');
    await assert.rejects(verifyFoundationPackage(root), /Packaged notice differs from source/);
    await cp(path.resolve(tauri, '../../LICENSE.md'), license);

    await writeFile(path.join(bin, 'ocudraw-unlisted-helper'), 'private executable');
    await assert.rejects(verifyFoundationPackage(root), /Private add-on file/);
    await rm(path.join(bin, 'ocudraw-unlisted-helper'));

    const product = ['ap', 'ex'].join('');
    for (const name of [
      `oculith-${product}-helper`,
      `oculith-${['vp', 'lan'].join('')}-engine`,
      `oculith-${['recognition', 'engine'].join('-')}`,
    ]) {
      const candidate = path.join(bin, name);
      await writeFile(candidate, 'private executable');
      await assert.rejects(verifyFoundationPackage(root), /Private add-on file/);
      await rm(candidate);
    }
    const privateDirectory = path.join(root, product);
    await mkdir(privateDirectory);
    await writeFile(path.join(privateDirectory, 'manifest.json'), '{}');
    await assert.rejects(verifyFoundationPackage(root), /Private add-on file/);
    await rm(privateDirectory, { recursive: true });
    for (const directory of ['edition', 'addons']) {
      const candidate = path.join(root, directory, 'packages', 'vendor.optional', 'plugin.js');
      await mkdir(path.dirname(candidate), { recursive: true });
      await writeFile(candidate, 'private package');
      await assert.rejects(verifyFoundationPackage(root), /Private add-on file/);
      await rm(path.join(root, directory), { recursive: true });
    }

    const libraryDirectory = path.join(root, 'usr', 'lib');
    await writeFile(path.join(libraryDirectory, 'libcompat.so.1'), 'ordinary runtime library');
    await symlink('libcompat.so.1', path.join(libraryDirectory, 'libcompat.so'));
    await verifyFoundationPackage(root);

    const privateLink = path.join(bin, `oculith-${product}-helper`);
    await symlink('ocudraw-community', privateLink);
    await assert.rejects(verifyFoundationPackage(root), /Private add-on file/);
    await rm(privateLink);

    const disguisedLink = path.join(libraryDirectory, 'plugin.js');
    await symlink('libcompat.so.1', disguisedLink);
    await assert.rejects(verifyFoundationPackage(root), /Suspicious symlink/);
    await rm(disguisedLink);
    const targetAlias = path.join(libraryDirectory, 'libalias.so');
    await symlink(`../${product}/plugin.js`, targetAlias);
    await assert.rejects(verifyFoundationPackage(root), /Suspicious symlink/);
    await rm(targetAlias);

    const fonts = path.join(resources, 'notices', 'fonts');
    const movedFonts = path.join(libraryDirectory, 'notice-fonts');
    await rename(fonts, movedFonts);
    await symlink(movedFonts, fonts, 'dir');
    await assert.rejects(verifyFoundationPackage(root), /Suspicious symlink|Symlink in packaged notice path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
