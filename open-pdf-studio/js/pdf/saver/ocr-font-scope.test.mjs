import assert from 'node:assert/strict';
import { test } from 'node:test';

test('OCR font load requests only the fixed native file grant', async () => {
  const calls = [];
  const expected = new Uint8Array([0, 1, 0, 0]);
  globalThis.window = { __TAURI__: {
    core: { invoke: async (command, args) => {
      calls.push(['invoke', command, args]);
      assert.equal(command, 'allow_ocr_font_scope');
      assert.equal(args, undefined);
      return '/app-resources/fonts/NotoSansTC-Regular.ttf';
    } },
    fs: { readFile: async path => {
      calls.push(['readFile', path]);
      assert.equal(path, '/app-resources/fonts/NotoSansTC-Regular.ttf');
      return expected;
    } },
  } };

  const { loadDefaultOcrFontBytes } = await import('./ocr-text-layer.js?font-scope-test');
  assert.equal(await loadDefaultOcrFontBytes(), expected);
  assert.equal(await loadDefaultOcrFontBytes(), expected);
  assert.deepEqual(calls, [
    ['invoke', 'allow_ocr_font_scope', undefined],
    ['readFile', '/app-resources/fonts/NotoSansTC-Regular.ttf'],
  ]);
});
