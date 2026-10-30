import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = path.join(appDir, 'src-tauri');

async function json(file) {
  return JSON.parse(await readFile(path.join(appDir, file), 'utf8'));
}

function normalizedNotice(bytes) {
  return bytes.toString('utf8').replaceAll('\r\n', '\n').split('\n')
    .map((line) => line.trimEnd()).join('\n').trimEnd();
}

test('desktop bundles retain the LGPL and audited third-party notice sources', async () => {
  const base = await json('src-tauri/tauri.conf.json');
  const noticeResources = Object.entries(base.bundle.resources)
    .filter(([, destination]) => destination.startsWith('notices/'));
  const expected = [
    'notices/Oculith-Draw-LICENSE.md',
    'notices/third-party',
    'notices/pdfium/LICENSE',
    'notices/pdfium/licenses',
    'notices/pdfium/linux-x64/LICENSE',
    'notices/pdfium/win-x64/LICENSE',
    'notices/pdfium/win-arm64/LICENSE',
    'notices/pdfjs/LICENSE',
    'notices/pdfjs/cmaps/LICENSE',
    'notices/pdfjs/standard_fonts/LICENSE_FOXIT',
    'notices/pdfjs/standard_fonts/LICENSE_LIBERATION',
    'notices/fonts/OFL-Geist.txt',
    'notices/fonts/OFL-InstrumentSerif.txt',
  ];
  assert.deepEqual(noticeResources.map(([, destination]) => destination).sort(), expected.sort());
  for (const [source, destination] of noticeResources) {
    const sourceStat = await stat(path.join(tauriDir, source));
    assert.ok(sourceStat.isDirectory() || sourceStat.size > 0, source);
    assert.ok(!path.isAbsolute(destination) && !destination.includes('..'), destination);
  }
  for (const platform of ['linux', 'windows', 'macos']) {
    const override = await json(`src-tauri/tauri.${platform}.conf.json`);
    const merged = { ...base.bundle.resources, ...override.bundle.resources };
    for (const [source, destination] of noticeResources) {
      assert.equal(merged[source], destination, `${platform} retains ${source}`);
    }
  }
});

test('a staged resource tree contains the exact source license and notice files', async () => {
  const base = await json('src-tauri/tauri.conf.json');
  const stage = await mkdtemp(path.join(tmpdir(), 'ocudraw-notices-'));
  try {
    for (const [source, destination] of Object.entries(base.bundle.resources)) {
      if (destination.startsWith('notices/')) {
        await cp(path.join(tauriDir, source), path.join(stage, destination), { recursive: true });
      }
    }
    const rootLicense = await readFile(path.resolve(appDir, '..', 'LICENSE.md'));
    assert.deepEqual(await readFile(path.join(stage, 'notices/Oculith-Draw-LICENSE.md')), rootLicense);
    assert.match(rootLicense.toString(), /GNU LESSER GENERAL PUBLIC LICENSE/);
    const rustInventory = await readFile(path.join(tauriDir, 'package-notices/rust-inventory.json'));
    assert.deepEqual(await readFile(path.join(stage, 'notices/third-party/rust-inventory.json')), rustInventory);
    const rustMetadata = JSON.parse(rustInventory.toString());
    const cargoLock = await readFile(path.resolve(appDir, '..', 'Cargo.lock'));
    assert.equal(rustMetadata.cargoLockSha256, createHash('sha256').update(cargoLock).digest('hex'));
    assert.equal(rustMetadata.packageCount, rustMetadata.packages.length);
    assert.deepEqual(rustMetadata.missingLicenseMetadata,
      rustMetadata.packages.filter(entry => !entry.licenseField && !entry.licenseFileField)
        .map(entry => `${entry.name}@${entry.version}`));
    const rustNotices = await readFile(path.join(stage, 'notices/third-party/rust-third-party-notices.txt'));
    const rustManifest = JSON.parse(await readFile(path.join(stage, 'notices/third-party/rust-notice-manifest.json')));
    assert.equal(rustManifest.cargoLockSha256, rustMetadata.cargoLockSha256);
    const external = rustMetadata.packages.filter(entry => !entry.workspace);
    assert.equal(rustManifest.externalPackageCount, external.length);
    assert.deepEqual(rustManifest.packages.map(entry => [entry.name, entry.version, entry.source]),
      external.map(entry => [entry.name, entry.version, entry.source]));
    const noticeText = rustNotices.toString('utf8');
    assert.match(noticeText, /STANDARD SPDX LICENSE AND EXCEPTION TEXTS/);
    for (const entry of rustManifest.packages) {
      assert.ok(entry.sourceFiles.length || entry.standardTextIds.length,
        `${entry.name}@${entry.version} has source or standard text`);
      assert.ok(noticeText.includes(`\n${entry.name}@${entry.version}\n`),
        `${entry.name}@${entry.version} section is bundled`);
      for (const source of entry.sourceFiles) {
        assert.ok(noticeText.includes(`${entry.name}@${entry.version}: ${source.path} (SHA-256 ${source.sha256})`),
          `${entry.name}@${entry.version} source ${source.path} is indexed`);
      }
      for (const identifier of entry.standardTextIds) {
        assert.ok(rustManifest.standardTextIds.includes(identifier), identifier);
        assert.ok(noticeText.includes(`--- ${identifier} ---`), identifier);
      }
    }
    for (const relative of [
      'notices/third-party/README.md',
      'notices/third-party/noto-cjk-Sans-LICENSE',
      'notices/third-party/tessdata_fast-LICENSE',
      'notices/pdfium/LICENSE',
      'notices/pdfium/licenses/pdfium.txt',
      'notices/pdfjs/LICENSE',
      'notices/pdfjs/cmaps/LICENSE',
      'notices/pdfjs/standard_fonts/LICENSE_FOXIT',
      'notices/pdfjs/standard_fonts/LICENSE_LIBERATION',
      'notices/fonts/OFL-Geist.txt',
      'notices/fonts/OFL-InstrumentSerif.txt',
      'notices/third-party/lucide-LICENSE',
    ]) {
      assert.ok((await readFile(path.join(stage, relative))).length > 100, relative);
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test('npm notice inventory tracks every production lockfile entry', async () => {
  const lock = await json('package-lock.json');
  const inventory = await json('src-tauri/package-notices/npm-inventory.json');
  const expected = Object.entries(lock.packages)
    .filter(([name, value]) => name && !value.dev)
    .map(([name, value]) => [name.slice('node_modules/'.length), value.version, value.license ?? null]);
  assert.deepEqual(inventory.packages.map(({ name, version, licenseFromLockfile }) =>
    [name, version, licenseFromLockfile]), expected);
  for (const entry of inventory.packages) {
    if (entry.noticeFile === null) continue;
    assert.ok(entry.noticeFile.startsWith(`npm/${entry.name}/`), entry.name);
    const bundled = await readFile(path.join(tauriDir, 'package-notices', entry.noticeFile));
    assert.ok(bundled.length > 20, entry.name);
    const installedPath = path.join(appDir, 'node_modules', entry.noticeFile.slice('npm/'.length));
    try {
      assert.equal(normalizedNotice(bundled), normalizedNotice(await readFile(installedPath)),
        `${entry.name} notice matches installed package`);
    } catch (error) {
      if (error.code !== 'ENOENT' || !lock.packages[`node_modules/${entry.name}`]?.optional) throw error;
    }
  }
});

test('drag binding retains pinned upstream notice provenance', async () => {
  const name = '@crabnebula/tauri-plugin-drag';
  const lock = await json('package-lock.json');
  const locked = lock.packages[`node_modules/${name}`];
  assert.equal(locked.version, '2.1.0');
  assert.equal(locked.integrity,
    'sha512-LnUXAZwQt1cdMoGDLJ6ogW9wFCYServCZXlGadS7CA+CZ9eXS7L+Q7QyQW6g/zGw9YI2MwKFqf1aSNBGyWw+OA==');
  const inventory = await json('src-tauri/package-notices/npm-inventory.json');
  const entry = inventory.packages.find((item) => item.name === name);
  assert.deepEqual([entry.version, entry.licenseFromLockfile, entry.noticeFile],
    ['2.1.0', null, null]);

  const upstreamSource = await readFile(path.join(appDir, 'node_modules', name, 'guest-js/index.ts'));
  assert.equal(createHash('sha256').update(upstreamSource).digest('hex'),
    'bc2521c0c7b19cd503c69efc108102c58aab02349f1b8409a306c070b5c0dc0a');
  for (const [file, expected] of Object.entries({
    'LICENSE.spdx': '6326d64033572a9b5f627ec7a39fd468dcbc6e01ee12fa71a600c66e12e0e411',
    LICENSE_MIT: '9e17784d32fbb3ac50c6c543c307d0fbcb16969585cb4cee8839b50e774708f9',
    'LICENSE_APACHE-2.0': '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594',
  })) {
    const notice = await readFile(path.join(tauriDir, 'package-notices/npm', name, file));
    assert.equal(createHash('sha256').update(notice).digest('hex'), expected, file);
  }
});
