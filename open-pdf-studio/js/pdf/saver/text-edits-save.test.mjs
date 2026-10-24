import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument } from 'pdf-lib';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { saveTextEditsToPages } = await import('./text-edits.js');

test('an unlocatable moved text edit rejects the save before bytes are written', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  const edit = {
    id: 'moved', page: 1, moved: true, originalText: 'source text is absent',
    newText: 'relocated text', pdfX: 20, pdfY: 30, fontSize: 12,
  };
  await assert.rejects(
    saveTextEditsToPages(pdf, [page], { textEdits: [edit] }),
    /moved.*cannot safely move/u,
  );
  assert.equal(edit.baked, undefined);
  assert.equal(edit._pendingBakeInfo, undefined);
});
