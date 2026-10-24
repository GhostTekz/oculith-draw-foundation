import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const methodPermission = new Map([
  ['readFile', 'fs:allow-read-file'],
  ['writeFile', 'fs:allow-write-file'],
  ['writeTextFile', 'fs:allow-write-text-file'],
  ['readDir', 'fs:allow-read-dir'],
  ['mkdir', 'fs:allow-mkdir'],
  ['remove', 'fs:allow-remove'],
  ['exists', 'fs:allow-exists'],
  ['stat', 'fs:allow-stat'],
]);

async function runtimeSources(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await runtimeSources(target));
    else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(target);
  }
  return files;
}

test('desktop and mobile fs permissions cover runtime calls without broad command bundles', async () => {
  const used = new Set();
  for (const file of await runtimeSources(path.join(appRoot, 'js'))) {
    const source = (await readFile(file, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1');
    for (const match of source.matchAll(/\bfs(?:\?\.|\.)\s*([A-Za-z]\w*)(?:\?\.)?\s*\(/g)) {
      const permission = methodPermission.get(match[1]);
      assert.ok(permission, `${path.relative(appRoot, file)} calls unreviewed fs.${match[1]}`);
      used.add(permission);
    }
  }
  assert.ok(used.size > 0, 'filesystem usage scan must find runtime calls');

  for (const platform of ['default', 'mobile']) {
    const capability = JSON.parse(await readFile(path.join(appRoot, 'src-tauri', 'capabilities', `${platform}.json`), 'utf8'));
    const actual = capability.permissions.filter(permission => permission.startsWith('fs:')).sort();
    assert.deepEqual(actual, [...used].sort(), `${platform} grants only filesystem commands used by the runtime`);
  }
});
