// An approved add-on write is one step in the real undo history, and a write
// that fails half way leaves nothing behind (addon-tools.js, default undo
// group on js/core/undo-manager.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const undo = await import('../core/undo-manager.js');
const { undoStackOf } = await import('../core/undo-stacks.js');
const at = await import('./addon-tools.js');

at._setDeps({ invoke: async () => null });

function openDoc() {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

const box = (id, x) => ({ id, type: 'box', page: 1, x, y: 0, width: 5, height: 5 });

async function approveNext() {
  for (let i = 0; i < 50 && !at.pendingApprovals().length; i++) await new Promise((r) => setTimeout(r, 0));
  at.answerApproval(at.pendingApprovals()[0].id, 'approve');
}

test('three added markups are one undo step', async () => {
  at._resetForTest();
  const doc = openDoc();
  at.registerAddonTools('acme', [{
    name: 'add_three', title: 'Add three', description: 'Adds three boxes.', writes: true,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      for (const [i, x] of [10, 20, 30].entries()) {
        const a = box(`b${i}`, x);
        doc.annotations.push(a);
        undo.recordAdd(a);
        await Promise.resolve();
      }
      return { added: 3 };
    },
  }]);
  const call = at.callAddonTool('addon_acme_add_three', {});
  await approveNext();
  assert.equal((await call).ok, true);
  assert.equal(doc.annotations.length, 3);
  assert.equal(undoStackOf(doc).length, 1, 'one undo step');
  await undo.undo();
  assert.equal(doc.annotations.length, 0, 'one Ctrl+Z takes all three back');
});

test('a write that fails half way is rolled back', async () => {
  at._resetForTest();
  const doc = openDoc();
  at.registerAddonTools('acme', [{
    name: 'add_then_fail', title: 'Add then fail', description: 'Adds a box and fails.', writes: true,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const a = box('half', 1);
      doc.annotations.push(a);
      undo.recordAdd(a);
      throw new Error('stopped half way');
    },
  }]);
  const call = at.callAddonTool('addon_acme_add_then_fail', {});
  await approveNext();
  const r = await call;
  assert.equal(r.ok, false);
  assert.equal(doc.annotations.length, 0, 'the partial change is undone');
});
