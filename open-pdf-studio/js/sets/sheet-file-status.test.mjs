import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectSheetFile, inspectHistoricalFiles } from './sheet-file-status.js';

test('grants filesystem scope before checking a restored PDF path', async () => {
  const calls = [];
  const status = await inspectSheetFile('/plans/A.pdf',
    async path => { calls.push(`scope:${path}`); },
    async path => { calls.push(`exists:${path}`); return true; });
  assert.equal(status, 'Present');
  assert.deepEqual(calls, ['scope:/plans/A.pdf', 'exists:/plans/A.pdf']);
});

test('scope failure is not reported as a missing PDF', async () => {
  let checked = false;
  const status = await inspectSheetFile('/plans/A.pdf',
    async () => { throw new Error('Scope denied'); },
    async () => { checked = true; return false; });
  assert.equal(status, 'Unavailable');
  assert.equal(checked, false);
});

test('historical file checks are separate from current sources and deduplicate shared PDFs', async () => {
  const register = { sheets: [
    { filePath: '/plans/current-a.pdf', history: [{ filePath: '/plans/old.pdf' }, { filePath: '/plans/shared.pdf' }] },
    { filePath: '/plans/current-b.pdf', history: [{ filePath: '/plans/shared.pdf' }] },
  ] };
  const checked = [];
  const statuses = await inspectHistoricalFiles(register, async path => {
    checked.push(path);
    return path.endsWith('old.pdf') ? 'Missing' : 'Present';
  });
  assert.deepEqual(checked, ['/plans/old.pdf', '/plans/shared.pdf']);
  assert.deepEqual(statuses, { '/plans/old.pdf': 'Missing', '/plans/shared.pdf': 'Present' });
  assert.deepEqual(register.sheets.map(sheet => sheet.filePath), ['/plans/current-a.pdf', '/plans/current-b.pdf']);
});
