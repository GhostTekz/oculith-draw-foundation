import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const app = fileURLToPath(new URL('..', import.meta.url));
const manualOnly = new Set([
  'js/text/mcp-live.test.mjs',
  'js/text/mcp-real-pdf.test.mjs',
]);

async function testsUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await testsUnder(full));
    else if (entry.name.endsWith('.test.mjs')) found.push(path.relative(app, full).split(path.sep).join('/'));
  }
  return found;
}

test('every self-contained JS workflow test runs in the unit suite', async () => {
  const manifest = await readFile(path.join(app, 'scripts/unit-testlijst.txt'), 'utf8');
  const listed = new Set(manifest.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith('#')));
  const missing = (await testsUnder(path.join(app, 'js'))).filter(file => !manualOnly.has(file) && !listed.has(file));
  assert.deepEqual(missing, [], 'add new JS tests to scripts/unit-testlijst.txt or document a manual-only exception');
});
