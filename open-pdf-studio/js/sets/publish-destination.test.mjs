import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertSafeSetDestination } from './publish-destination.js';

function register(filePath) {
  return { sheets: [{ filePath, history: [{ filePath: '/plans/old.pdf' }], sourceAliases: [] }] };
}

test('dot segments and Windows path spelling cannot overwrite a recorded source', async () => {
  await assert.rejects(assertSafeSetDestination('/plans/detail/../old.pdf', register('/plans/current.pdf')),
    /source drawing/u);
  await assert.rejects(assertSafeSetDestination('C:\\Plans\\.\\current.pdf', register('c:/plans/current.pdf')),
    /source drawing/u);
});

test('an existing symlink alias is rejected and its source bytes remain untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocudraw-set-destination-'));
  try {
    const source = join(dir, 'current.pdf');
    const alias = join(dir, 'publish.pdf');
    const original = Buffer.from('source PDF bytes');
    await writeFile(source, original);
    await symlink(source, alias);
    const fileExists = path => stat(path).then(() => true, () => false);
    await assert.rejects(assertSafeSetDestination(alias, register(source), { fileExists }),
      /cannot overwrite an existing file/u);
    assert.deepEqual(await readFile(source), original);
    assert.deepEqual(await readFile(alias), original);
    await assert.doesNotReject(assertSafeSetDestination(join(dir, 'new.pdf'), register(source), { fileExists }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
