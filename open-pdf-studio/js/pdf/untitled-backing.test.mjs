import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeUntitledBacking } from './untitled-backing.js';

test('untitled PDF writes only the exact native-reserved path', async () => {
  const calls = [];
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const tauri = {
    core: { invoke: async command => {
      calls.push(['invoke', command]);
      assert.equal(command, 'create_untitled_pdf_backing');
      return '/app-cache/untitled/opds-untitled-1.pdf';
    } },
    fs: { writeFile: async (path, data) => calls.push(['write', path, data]) },
  };
  assert.equal(await writeUntitledBacking(bytes, tauri), '/app-cache/untitled/opds-untitled-1.pdf');
  assert.deepEqual(calls, [
    ['invoke', 'create_untitled_pdf_backing'],
    ['write', '/app-cache/untitled/opds-untitled-1.pdf', bytes],
  ]);
});

test('failed PDF write removes the reserved empty file', async () => {
  const removed = [];
  const tauri = {
    core: { invoke: async () => '/app-cache/untitled/opds-untitled-2.pdf' },
    fs: {
      writeFile: async () => { throw new Error('disk full'); },
      remove: async path => removed.push(path),
    },
  };
  await assert.rejects(writeUntitledBacking(new Uint8Array([1]), tauri), /disk full/);
  assert.deepEqual(removed, ['/app-cache/untitled/opds-untitled-2.pdf']);
});
