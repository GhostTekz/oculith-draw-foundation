import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { addSheet, createSheetRegister, parseSheetRegister, relinkSheet, replaceSheet } from './sheet-register.js';
import { addPdfPages, fingerprintPdfBytes, inspectPdfPages, matchingCurrentPdfSource, relinkMatchingPdfSource } from './pdf-page-import.js';

test('reads every page and embedded sheet labels from a real PDF', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  pdf.catalog.set(PDFName.of('PageLabels'), pdf.context.obj({
    Nums: [0, { P: PDFHexString.fromText('A-'), S: PDFName.of('D'), St: 101 }],
  }));
  const bytes = await pdf.save();
  const result = await inspectPdfPages(bytes);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.pageLabels, ['A-101', 'A-102']);
  assert.equal(bytes.length > 0, true);
});

test('imports all PDF pages and preserves IDs and revisions on repeated import', () => {
  const initial = addPdfPages(createSheetRegister(), '/plans/Level 1.pdf', 3, ['A-101', 'A-102', 'A-103']);
  assert.deepEqual(initial.register.sheets.map(sheet => [sheet.label, sheet.page]),
    [['A-101', 1], ['A-102', 2], ['A-103', 3]]);
  const revision = replaceSheet(initial.register, initial.added[0].id, '/plans/Level 1 revised.pdf', 'B');
  const again = addPdfPages(revision, '/plans/Level 1.pdf', 3, ['A-101', 'A-102', 'A-103']);
  assert.equal(again.alreadyPresent, 3);
  assert.equal(again.added.length, 0);
  assert.equal(again.register, revision);
  assert.equal(again.register.sheets.find(sheet => sheet.id === initial.added[0].id).revision, 'B');
  assert.equal(again.register.sheets.find(sheet => sheet.id === initial.added[0].id).history.length, 1);
  assert.deepEqual(parseSheetRegister(JSON.stringify(again.register)), again.register);
});

test('reimporting a page retired by a revision cannot duplicate its stable sheet', () => {
  const initial = addPdfPages(createSheetRegister(), '/plans/first.pdf', 2, ['A-101', 'A-102']);
  const revised = replaceSheet(initial.register, initial.added[0].id, '/plans/revised.pdf', 'B', 'now', 2);
  const later = replaceSheet(revised, initial.added[0].id, '/plans/final.pdf', 'C', 'later', 1);
  const old = addPdfPages(later, '/plans/first.pdf', 2);
  const middle = addPdfPages(old.register, '/plans/revised.pdf', 2);
  assert.equal(old.alreadyPresent, 2);
  assert.equal(old.added.length, 0);
  assert.equal(middle.alreadyPresent, 1);
  assert.equal(middle.added.length, 1);
  assert.equal(middle.register.sheets.find(sheet => sheet.id === initial.added[0].id).history.length, 2);
});

test('reimporting a relinked source cannot duplicate its sheet or add a revision', () => {
  const initial = addPdfPages(createSheetRegister(), '/old/location.pdf', 2);
  const sheet = initial.added[0];
  const moved = relinkSheet(initial.register, sheet.id, '/new/location.pdf', 1);
  const repeated = addPdfPages(moved, '/old/location.pdf', 2);
  assert.equal(repeated.added.length, 0);
  assert.equal(repeated.alreadyPresent, 2);
  assert.equal(repeated.register, moved);
  assert.deepEqual(moved.sheets[0].history, []);
  assert.deepEqual(parseSheetRegister(JSON.stringify(moved)), moved);
});

test('duplicate or numeric page labels get distinct, predictable sheet IDs', () => {
  const existing = addSheet(createSheetRegister(), { filePath: '/old.pdf', label: 'A-101' }).register;
  const first = addPdfPages(existing, '/new.pdf', 3, ['A-101', 'A-101', '3']);
  assert.deepEqual(first.added.map(sheet => sheet.label), ['A-101-2', 'A-101-3', 'new-3']);
  const second = addPdfPages(first.register, '/other.pdf', 2);
  assert.deepEqual(second.added.map(sheet => sheet.label), ['other-1', 'other-2']);
  const repeated = addPdfPages(second.register, '/new.pdf', 3, ['changed', 'labels', 'ignored']);
  assert.equal(repeated.added.length, 0);
  assert.equal(repeated.alreadyPresent, 3);
  assert.equal(repeated.register, second.register);
  assert.throws(() => addPdfPages(createSheetRegister(), '/empty.pdf', 0), /no pages/);
});

test('renamed PDF contents relink current sheets without changing their stable IDs', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('A-101');
  pdf.addPage().drawText('A-102');
  const bytes = await pdf.save();
  const fingerprint = await fingerprintPdfBytes(bytes);
  const { pageCount } = await inspectPdfPages(bytes);
  const initial = addPdfPages(createSheetRegister(), '/issued/plans.pdf', pageCount, ['A-101', 'A-102'], fingerprint);
  const ids = initial.added.map(sheet => sheet.id);
  const matching = matchingCurrentPdfSource(initial.register, fingerprint, pageCount);
  assert.deepEqual(matching.map(sheet => sheet.id), ids);
  const renamed = relinkMatchingPdfSource(initial.register, matching, '/moved/renamed.pdf', fingerprint);
  assert.deepEqual(renamed.sheets.map(sheet => sheet.id), ids);
  assert.deepEqual(renamed.sheets.map(sheet => sheet.filePath), ['/moved/renamed.pdf', '/moved/renamed.pdf']);
  assert.ok(renamed.sheets.every(sheet => sheet.sourceAliases[0].filePath === '/issued/plans.pdf'));
  assert.ok(renamed.sheets.every(sheet => sheet.history.length === 0));
  for (const path of ['/issued/plans.pdf', '/moved/renamed.pdf']) {
    const repeated = addPdfPages(renamed, path, pageCount, null, fingerprint);
    assert.equal(repeated.alreadyPresent, 2);
    assert.equal(repeated.added.length, 0);
    assert.equal(repeated.register, renamed);
  }
  assert.deepEqual(parseSheetRegister(JSON.stringify(renamed)), renamed);
});

test('renamed historical PDF matches its old sheet but cannot roll back the current revision', async () => {
  const old = await PDFDocument.create();
  old.addPage().drawText('A-101 old');
  const oldFingerprint = await fingerprintPdfBytes(await old.save());
  const current = await PDFDocument.create();
  current.addPage().drawText('A-101 revised');
  const currentFingerprint = await fingerprintPdfBytes(await current.save());
  const initial = addPdfPages(createSheetRegister(), '/issued/old.pdf', 1, ['A-101'], oldFingerprint);
  const revised = replaceSheet(initial.register, initial.added[0].id, '/issued/current.pdf', 'B', 'now', 1, currentFingerprint);
  assert.equal(matchingCurrentPdfSource(revised, oldFingerprint, 1), null);
  const repeated = addPdfPages(revised, '/renamed/old.pdf', 1, ['A-101'], oldFingerprint);
  assert.equal(repeated.contentMatches, 1);
  assert.equal(repeated.added.length, 0);
  assert.equal(repeated.register, revised);
  assert.equal(revised.sheets[0].filePath, '/issued/current.pdf');
  assert.equal(revised.sheets[0].history[0].sourceSha256, oldFingerprint);
  assert.deepEqual(parseSheetRegister(JSON.stringify(revised)), revised);
});

test('reimport at the recorded path fingerprints an older manifest for a later rename', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('A-101');
  const fingerprint = await fingerprintPdfBytes(await pdf.save());
  const legacy = addPdfPages(createSheetRegister(), '/plans/original.pdf', 1);
  const backfilled = addPdfPages(legacy.register, '/plans/original.pdf', 1, null, fingerprint);
  assert.equal(backfilled.added.length, 0);
  assert.equal(backfilled.register.sheets[0].id, legacy.added[0].id);
  assert.equal(backfilled.register.sheets[0].sourceSha256, fingerprint);
  assert.equal(matchingCurrentPdfSource(backfilled.register, fingerprint, 1)?.[0].id, legacy.added[0].id);
  assert.deepEqual(parseSheetRegister(JSON.stringify(backfilled.register)), backfilled.register);
});

test('changed bytes at a known PDF path require an explicit revision before a new fingerprint is trusted', async () => {
  const firstPdf = await PDFDocument.create();
  firstPdf.addPage().drawText('A-101 revision A');
  const firstFingerprint = await fingerprintPdfBytes(await firstPdf.save());
  const changedPdf = await PDFDocument.create();
  changedPdf.addPage().drawText('A-101 revision B');
  const changedFingerprint = await fingerprintPdfBytes(await changedPdf.save());
  const first = addPdfPages(createSheetRegister(), '/plans/A-101.pdf', 1, ['A-101'], firstFingerprint);

  assert.throws(() => addPdfPages(first.register, '/plans/A-101.pdf', 1, ['A-101'], changedFingerprint),
    /changed at a registered path.*Choose revised PDF/);
  assert.equal(first.register.sheets[0].sourceSha256, firstFingerprint);
  assert.equal(matchingCurrentPdfSource(first.register, changedFingerprint, 1), null);

  const revised = replaceSheet(first.register, first.added[0].id, '/plans/A-101.pdf', 'B', 'now', 1, changedFingerprint);
  assert.equal(revised.sheets[0].sourceSha256, changedFingerprint);
  assert.equal(revised.sheets[0].history[0].sourceSha256, firstFingerprint);
  assert.equal(addPdfPages(revised, '/plans/A-101.pdf', 1, null, changedFingerprint).register, revised);
});
