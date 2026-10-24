import assert from 'node:assert/strict';
import { test } from 'node:test';
import { joinTemplatePath } from './template-paths.js';
import { getFrameDirs, getUserFramesDir, scanFrames } from './frames.js';
import { addTitleBlockFile, getTitleBlockDirs, getUserTitleBlockDir, scanTitleBlocks } from './titleblocks.js';

test('template paths retain Linux, macOS, and Windows separators', () => {
  assert.equal(joinTemplatePath('/home/reviewer/.local/share/ocudraw', 'kaders'), '/home/reviewer/.local/share/ocudraw/kaders');
  assert.equal(joinTemplatePath('/Applications/Oculith Draw/', 'onderhoeken'), '/Applications/Oculith Draw/onderhoeken');
  assert.equal(joinTemplatePath('C:\\Users\\reviewer\\AppData', 'kaders'), 'C:\\Users\\reviewer\\AppData\\kaders');
  assert.equal(joinTemplatePath('C:\\Users\\reviewer\\AppData\\', 'kaders'), 'C:\\Users\\reviewer\\AppData\\kaders');
});

test('frame and title-block scans use app data and bundled roots with portable child paths', async () => {
  const user = '/home/reviewer/.local/share/ocudraw';
  const bundle = '/opt/Oculith Draw/resources';
  const dirs = new Set([
    `${user}/kaders`, `${user}/onderhoeken`, `${bundle}/kaders`, `${bundle}/onderhoeken`,
  ]);
  const grants = [];
  const writes = [];
  const priorWindow = globalThis.window;
  globalThis.window = { __TAURI__: {
    core: { invoke: async (command, args) => {
      assert.equal(command, 'allow_template_scope', 'template flows must not call the generic path grant');
      grants.push(args.kind);
      return { userDir: `${user}/${args.kind}`, bundledDir: `${bundle}/${args.kind}` };
    } },
    fs: {
      exists: async path => dirs.has(path),
      readDir: async path => {
        if (path === `${user}/kaders`) return [{ name: 'nested', isDirectory: true }];
        if (path === `${user}/kaders/nested`) return [{ name: 'review_a1_liggend.pdf', isDirectory: false }];
        if (path === `${bundle}/kaders`) return [{ name: 'review_a1_liggend.pdf', isDirectory: false }, { name: 'issued_a3_staand.pdf', isDirectory: false }];
        if (path === `${user}/onderhoeken`) return [{ name: 'client.pdf', isDirectory: false }];
        if (path === `${bundle}/onderhoeken`) return [{ name: 'client.pdf', isDirectory: false }, { name: 'standard.pdf', isDirectory: false }];
        return [];
      },
      readFile: async () => new Uint8Array([1, 2, 3]),
      writeFile: async (path, bytes) => writes.push({ path, bytes: [...bytes] }),
    },
  } };
  try {
    assert.deepEqual(await getFrameDirs(), [`${user}/kaders`, `${bundle}/kaders`]);
    assert.deepEqual(await getTitleBlockDirs(), [`${user}/onderhoeken`, `${bundle}/onderhoeken`]);
    assert.equal(await getUserFramesDir(), `${user}/kaders`);
    assert.equal(await getUserTitleBlockDir(), `${user}/onderhoeken`);
    const frames = (await scanFrames()).frames;
    assert.deepEqual(frames.map(item => item.path), [
      `${user}/kaders/nested/review_a1_liggend.pdf`, `${bundle}/kaders/issued_a3_staand.pdf`,
    ]);
    assert.deepEqual((await scanTitleBlocks()).map(item => item.path), [
      `${user}/onderhoeken/client.pdf`, `${bundle}/onderhoeken/standard.pdf`,
    ]);
    const added = await addTitleBlockFile('/chosen/company.pdf');
    assert.equal(added.path, `${user}/onderhoeken/company.pdf`);
    assert.deepEqual(writes, [{ path: added.path, bytes: [1, 2, 3] }]);
    assert.ok(grants.length > 0);
    assert.ok(grants.every(kind => kind === 'kaders' || kind === 'onderhoeken'));
  } finally {
    globalThis.window = priorWindow;
  }
});
