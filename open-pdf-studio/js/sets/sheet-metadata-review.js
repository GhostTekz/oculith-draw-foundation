function clean(value) { return String(value ?? '').trim(); }
function key(value) { return clean(value).toLocaleLowerCase(); }

/** Explain final-set conflicts before Apply, including conflicts with untouched rows. */
export function sheetMetadataReviewIssues(register, rows) {
  const selected = new Map(rows.filter(row => row.selected).map(row => [row.sheetId, row]));
  const byLabel = new Map();
  const issues = new Map();
  for (const sheet of register.sheets) {
    const row = selected.get(sheet.id);
    const label = row ? clean(row.label) : sheet.label;
    if (row && !label) issues.set(sheet.id, 'Sheet ID is required.');
    if (!label) continue;
    if (!byLabel.has(key(label))) byLabel.set(key(label), []);
    byLabel.get(key(label)).push(sheet.id);
  }
  for (const ids of byLabel.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) if (selected.has(id)) {
      issues.set(id, `Sheet ID “${clean(selected.get(id).label)}” is already in this set.`);
    }
  }
  return issues;
}

/** Validate every selected edit against the final set before writing anything. */
export function applySheetMetadataReview(register, rows) {
  if (!Array.isArray(rows)) throw new Error('The sheet review is unavailable.');
  const selected = new Map();
  for (const row of rows) {
    if (!row.selected) continue;
    if (row.error || !row.sourceSha256) throw new Error('A selected source could not be verified. Review the PDF again.');
    if (selected.has(row.sheetId)) throw new Error('A sheet appears twice in the review.');
    const sheet = register.sheets.find(item => item.id === row.sheetId);
    if (!sheet || sheet.filePath !== row.filePath || sheet.page !== row.page
      || sheet.sourceSha256 !== row.sourceSha256) {
      throw new Error('A reviewed sheet changed. Review the set again.');
    }
    const label = clean(row.label);
    if (!label) throw new Error('Sheet ID is required.');
    selected.set(row.sheetId, { label, title: clean(row.title) });
  }
  if (!selected.size) throw new Error('Select at least one sheet to apply.');
  const issues = sheetMetadataReviewIssues(register, rows);
  if (issues.size) throw new Error(issues.values().next().value);
  const labels = new Set();
  for (const sheet of register.sheets) {
    const label = selected.get(sheet.id)?.label ?? sheet.label;
    if (labels.has(key(label))) throw new Error(`Sheet ID “${label}” is already in this set.`);
    labels.add(key(label));
  }
  return { ...register, sheets: register.sheets.map(sheet => {
    const edit = selected.get(sheet.id);
    return edit ? { ...sheet, ...edit } : sheet;
  }) };
}
