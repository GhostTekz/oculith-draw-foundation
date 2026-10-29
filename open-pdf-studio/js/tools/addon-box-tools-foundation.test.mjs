import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { registerAddonBoxTools } = await import('./addon-box-tools.js');
const { shapeTool } = await import('./tools/shape-tool.js');
const { getTool, registerTool } = await import('./tool-registry.js');
const { createAnnotationFromTool } = await import('./annotation-creators.js');

test('Foundation without an add-on keeps its ordinary box tool', () => {
  state.documents = [{ id: 'foundation-box', currentPage: 1, viewMode: 'single', filePath: null,
    pdfDoc: { numPages: 1 }, annotations: [], pageRotations: {}, textEdits: [] }];
  state.activeDocumentIndex = 0;
  state.toolOverrides = {};
  registerTool('box', shapeTool);
  registerAddonBoxTools([]);
  assert.equal(getTool('box')?.name, 'shape');
  assert.equal(getTool('addon:sample.tools:review-box'), null);
  const box = createAnnotationFromTool('box', 10, 20, 50, 70, null);
  assert.equal(box.type, 'box');
  assert.deepEqual([box.x, box.y, box.width, box.height], [10, 20, 40, 50]);
});
