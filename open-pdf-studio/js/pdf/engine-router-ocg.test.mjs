import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { renderPdfPage } = await import('./engine-router.js');

test('experimental vector OCG rejection retries with selected-aware PDFium', async () => {
  const calls = [];
  const previous = state.renderEngineOverride;
  state.renderEngineOverride = 'rust-skia';
  window.__TAURI__ = { core: { invoke: async (command, args) => {
    calls.push({ command, args });
    if (command === 'render_pdf_page_skia') throw 'OCG content requires PDFium renderer';
    return new Uint8Array([1, 2, 3]);
  } } };
  try {
    const ocgVisibility = [{ object_number: 6, generation: 0, visible: true }];
    const result = await renderPdfPage({ path: 'layers.pdf', pageIndex: 0, scale: 1, ocgVisibility });
    assert.deepEqual([...result], [1, 2, 3]);
    assert.deepEqual(calls.map(call => call.command), ['render_pdf_page_skia', 'render_pdf_page']);
    assert.deepEqual(calls[1].args.ocgVisibility, ocgVisibility);
  } finally {
    state.renderEngineOverride = previous;
    delete window.__TAURI__;
  }
});

test('experimental vector errors other than OCG are not hidden', async () => {
  const previous = state.renderEngineOverride;
  state.renderEngineOverride = 'rust-skia';
  const calls = [];
  window.__TAURI__ = { core: { invoke: async command => {
    calls.push(command);
    throw new Error('broken PDF');
  } } };
  try {
    await assert.rejects(renderPdfPage({ path: 'bad.pdf', pageIndex: 0, scale: 1 }), /broken PDF/);
    assert.deepEqual(calls, ['render_pdf_page_skia']);
  } finally {
    state.renderEngineOverride = previous;
    delete window.__TAURI__;
  }
});
