import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { communityBuildCommand } from './build-community.mjs';

test('Community Tauri build selects the public config and disables private Cargo feature', () => {
  const build = communityBuildCommand(['--no-bundle']);
  assert.equal(build.args[0].endsWith('/@tauri-apps/cli/tauri.js') || build.args[0].endsWith('\\@tauri-apps\\cli\\tauri.js'), true);
  assert.deepEqual(build.args.slice(1), [
    'build', '--config', 'src-tauri/tauri.community.conf.json', '--no-bundle', '--', '--no-default-features',
  ]);
  assert.equal(build.env.OCUDRAW_EDITION, 'community');
  assert.match(build.env.CARGO_TARGET_DIR, /[\\/]community$/);
  assert.throws(() => communityBuildCommand(['--config', 'src-tauri/tauri.conf.json']));
  assert.throws(() => communityBuildCommand(['--runner', 'other']));
  assert.deepEqual(communityBuildCommand(['--bundles', 'appimage']).args.slice(1, 5),
    ['build', '--config', 'src-tauri/tauri.community.conf.json', '--bundles']);
});

test('Community frontend build selects the existing prepared build path', () => {
  const build = communityBuildCommand(['--frontend-only']);
  assert.deepEqual(build.args, ['run', 'build']);
  assert.equal(build.env.OCUDRAW_EDITION, 'community');
});

test('Community package uses distinct executable and worker names', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.community.conf.json', import.meta.url)));
  assert.equal(config.mainBinaryName, 'ocudraw-community');
  assert.deepEqual(config.bundle.externalBin, ['binaries/ocudraw-community-pdfium-worker']);
});
