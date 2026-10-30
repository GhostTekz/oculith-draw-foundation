import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createSheetRegister, addSheet, replaceSheet } from './sheet-register.js';
import { fingerprintPdfBytes } from './pdf-page-import.js';
import { verifySheetRevisionCompare } from './sheet-revision-compare.js';

async function pdf(pages) {
  const document = await PDFDocument.create();
  for (const text of pages) document.addPage([612, 792]).drawText(text);
  return new Uint8Array(await document.save());
}

test('registered comparison uses the stable sheet identity and exact prior/current pages', async () => {
  const oldBytes = await pdf(['Old cover', 'Old A-101']);
  const newBytes = await pdf(['New cover', 'Other sheet', 'New A-101']);
  const oldHash = await fingerprintPdfBytes(oldBytes);
  const newHash = await fingerprintPdfBytes(newBytes);
  const added = addSheet(createSheetRegister(), {
    filePath: '/plans/old.pdf', label: 'A-101', page: 2, revision: 'A', sourceSha256: oldHash,
  });
  const register = replaceSheet(added.register, added.sheet.id,
    '/plans/new.pdf', 'B', '2026-10-30T00:00:00Z', 3, newHash);
  const files = new Map([['/plans/old.pdf', oldBytes], ['/plans/new.pdf', newBytes]]);
  const read = async path => files.get(path);

  const verified = await verifySheetRevisionCompare(register, added.sheet.id, 0, read);
  assert.equal(verified.sheetId, added.sheet.id);
  assert.equal(verified.label, 'A-101');
  assert.deepEqual([verified.old.page, verified.old.pageCount, verified.old.revision], [2, 2, 'A']);
  assert.deepEqual([verified.current.page, verified.current.pageCount, verified.current.revision], [3, 3, 'B']);
  assert.equal(verified.old.bytes, oldBytes);
  assert.equal(verified.current.bytes, newBytes);
  assert.deepEqual(register.sheets[0].history.map(source => source.filePath), ['/plans/old.pdf']);

  files.set('/plans/old.pdf', await pdf(['Changed old cover', 'Changed old sheet']));
  await assert.rejects(verifySheetRevisionCompare(register, added.sheet.id, 0, read, { checkPages: false }),
    /Earlier revision PDF has changed/);
  files.set('/plans/old.pdf', oldBytes);
  files.set('/plans/new.pdf', await pdf(['Changed current cover', 'Changed sheet', 'Changed A-101']));
  await assert.rejects(verifySheetRevisionCompare(register, added.sheet.id, 0, read),
    /Current revision PDF has changed/);
  files.delete('/plans/new.pdf');
  await assert.rejects(verifySheetRevisionCompare(register, added.sheet.id, 0, read),
    /Current revision PDF is unavailable/);

  const legacy = { ...register, sheets: [{ ...register.sheets[0], sourceSha256: undefined }] };
  await assert.rejects(verifySheetRevisionCompare(legacy, added.sheet.id, 0, read),
    /Both revisions need recorded PDF fingerprints/);
  const samePath = { ...register, sheets: [{ ...register.sheets[0], filePath: '/plans/old.pdf' }] };
  await assert.rejects(verifySheetRevisionCompare(samePath, added.sheet.id, 0, read),
    /same PDF path/);
  const badPage = { ...register, sheets: [{ ...register.sheets[0], page: 4 }] };
  files.set('/plans/new.pdf', newBytes);
  await assert.rejects(verifySheetRevisionCompare(badPage, added.sheet.id, 0, read),
    /no longer contains recorded page 4/);
  const invalidPage = { ...register, sheets: [{ ...register.sheets[0], page: 0 }] };
  await assert.rejects(verifySheetRevisionCompare(invalidPage, added.sheet.id, 0, read),
    /valid recorded PDF page numbers/);
  await assert.rejects(verifySheetRevisionCompare(register, added.sheet.id, 4, read),
    /no longer in this drawing set/);
});
