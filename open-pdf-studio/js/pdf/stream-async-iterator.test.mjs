import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const iterator = Symbol.asyncIterator;
const original = Object.getOwnPropertyDescriptor(ReadableStream.prototype, iterator);
delete ReadableStream.prototype[iterator];

try {
  await import('../../public/js/stream-async-iterator.js');
  assert.equal(typeof ReadableStream.prototype[iterator], 'function');

  const values = [];
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue('first');
    controller.enqueue('second');
    controller.close();
  } });
  for await (const value of stream) values.push(value);
  assert.deepEqual(values, ['first', 'second']);
  assert.equal(stream.locked, false, 'a completed stream releases its reader');

  let cancelled = false;
  const early = new ReadableStream({
    start(controller) { controller.enqueue('first'); },
    cancel() { cancelled = true; },
  });
  for await (const value of early) {
    assert.equal(value, 'first');
    break;
  }
  assert.equal(cancelled, true, 'early exit cancels the stream');
  assert.equal(early.locked, false, 'early exit releases its reader');

  const failed = new ReadableStream({ start(controller) {
    controller.error(new Error('broken stream'));
  } });
  await assert.rejects(async () => {
    for await (const _ of failed) { /* read the error */ }
  }, /broken stream/);
  assert.equal(failed.locked, false, 'a failed read releases its reader');

  const bytes = new Uint8Array(await readFile(new URL('./fixtures/cad-import-tekst.pdf', import.meta.url)));
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  try {
    const text = await (await pdf.getPage(1)).getTextContent();
    assert.ok(text.items.some(item => item.str?.trim()), 'PDF.js extracts real page text');
  } finally {
    await loadingTask.destroy();
  }
} finally {
  if (original) Object.defineProperty(ReadableStream.prototype, iterator, original);
  else delete ReadableStream.prototype[iterator];
}

const available = ReadableStream.prototype[iterator];
await import('../../public/js/stream-async-iterator.js?already-available');
assert.equal(ReadableStream.prototype[iterator], available, 'native iterator is preserved');
