// Export the current comparison as a reviewable, local CSV record. Visual
// bounds are detection-raster pixels; annotation bounds are page-view units.

const HEADERS = [
  'Generated at (UTC)', 'Old document', 'Old page', 'New document', 'New page',
  'Page pairing status', 'Pair confirmed at (UTC)',
  'Alignment dx (display px)', 'Alignment dy (display px)', 'Alignment rotation (deg)',
  'Change number', 'Change type', 'Source', 'Review state', 'Description',
  'X', 'Y', 'Width', 'Height', 'Coordinate unit', 'Detection scale', 'Changed pixels',
  'Page-view X', 'Page-view Y', 'Page-view width', 'Page-view height', 'Page-view frame',
];

function safeText(value) {
  const text = String(value ?? '');
  // CSV files are often opened in a spreadsheet. Paths and labels come from
  // untrusted PDFs or the local filesystem and must stay plain text there.
  return /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function number(value) {
  return Number.isFinite(value) ? value : '';
}

// Detection boxes are in pixels of PDF.js's rotated, cropped viewport at
// detectScale. Dividing by that scale maps them to the NEW page's viewport at
// scale 1. It does not undo compare alignment or convert to PDF user space.
function pageViewBounds(change, source) {
  const scale = source === 'visual' ? change.detectScale : 1;
  const frame = source === 'visual' ? 'aligned new page' : change.type === 'removed' ? 'old page' : 'new page';
  if (!Number.isFinite(scale) || scale <= 0) return { x: '', y: '', width: '', height: '', frame: '' };
  const convert = value => Number.isFinite(value) ? Math.round((value / scale) * 1000) / 1000 : '';
  return {
    x: convert(change.x), y: convert(change.y),
    width: convert(change.width), height: convert(change.height), frame,
  };
}

function encodeRows(rows) {
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function suggestedCompareReportName(oldPath, newPath, oldPage, newPage) {
  const base = (path) => String(path || 'document')
    .split(/[\\/]/u).pop().replace(/\.pdf$/iu, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 48) || 'document';
  return `${base(oldPath)}-p${oldPage}_vs_${base(newPath)}-p${newPage}-changes.csv`;
}

export function suggestedComparePdfReportName(oldPath, newPath, oldPage, newPage) {
  return suggestedCompareReportName(oldPath, newPath, oldPage, newPage).replace(/\.csv$/u, '.pdf');
}

export function createCompareChangeReportModel({
  oldPath, newPath, oldPage, newPage, offset, pairing, changes, generatedAt,
}) {
  if (!oldPath || !newPath || !Number.isInteger(oldPage) || !Number.isInteger(newPage)) {
    throw new Error('A document and page are required for each side of the comparison.');
  }
  const stamp = generatedAt instanceof Date ? generatedAt.toISOString() : new Date().toISOString();
  const alignment = offset || {};
  const pairingStatus = pairing?.source === 'manual' && pairing.oldPage === oldPage && pairing.newPage === newPage ? 'confirmed manually' : 'unconfirmed';
  const confirmedAt = pairingStatus === 'confirmed manually' ? pairing.confirmedAt : '';
  return {
    generatedAt: stamp, oldPath, newPath, oldPage, newPage,
    pairingStatus, confirmedAt,
    alignment: {
      dx: number(alignment.dx), dy: number(alignment.dy), rotation: number(alignment.rotation),
    },
    changes: (changes || []).flatMap((change, index) => {
      if (!change || !['added', 'removed', 'modified'].includes(change.type)) return [];
      const source = change.source === 'annotation' ? 'annotation' : 'visual';
      const pageView = pageViewBounds(change, source);
      return [{
        number: index + 1, type: change.type, source, reviewState: 'unreviewed',
        description: source === 'annotation' ? (change.label || change.annType || '') : '',
        x: number(change.x), y: number(change.y), width: number(change.width), height: number(change.height),
        coordinateUnit: source === 'annotation' ? 'page-view units' : 'detection pixels',
        detectScale: source === 'visual' ? number(change.detectScale) : '',
        pixelCount: source === 'visual' ? number(change.pixelCount) : '',
        pageView,
      }];
    }),
  };
}

function compareChangeRows(options) {
  const report = createCompareChangeReportModel(options);
  const rows = [HEADERS];
  for (const change of report.changes) {
    rows.push([
      report.generatedAt, safeText(report.oldPath), report.oldPage, safeText(report.newPath), report.newPage,
      report.pairingStatus, report.confirmedAt,
      report.alignment.dx, report.alignment.dy, report.alignment.rotation,
      change.number, change.type, change.source, change.reviewState,
      safeText(change.description),
      change.x, change.y, change.width, change.height,
      change.coordinateUnit, change.detectScale, change.pixelCount,
      change.pageView.x, change.pageView.y, change.pageView.width, change.pageView.height, change.pageView.frame,
    ]);
  }
  // Keep the document pair in the report even when no differences are found.
  if (rows.length === 1) {
    rows.push([report.generatedAt, safeText(report.oldPath), report.oldPage, safeText(report.newPath), report.newPage, report.pairingStatus, report.confirmedAt,
      report.alignment.dx, report.alignment.dy, report.alignment.rotation,
      '', 'none', '', 'unreviewed', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  }
  return rows;
}

export function buildCompareChangeReport(options) {
  return encodeRows(compareChangeRows(options));
}

export function suggestedBatchCompareReportName(oldPath, newPath) {
  return suggestedCompareReportName(oldPath, newPath, 'all', 'all').replace('-changes.csv', '-batch-changes.csv');
}

export function suggestedBatchComparePdfReportName(oldPath, newPath) {
  return suggestedBatchCompareReportName(oldPath, newPath).replace(/\.csv$/u, '.pdf');
}

// Keep status separate from detected changes: a failed or unprocessed pair
// has no zero-change conclusion, even though it has no change rows.
export function createBatchCompareReportModel(batch, generatedAt = new Date(batch?.completedAt || Date.now())) {
  if (!batch?.oldPath || !batch?.newPath || !Array.isArray(batch.results)
      || !Array.isArray(batch.failures) || !Array.isArray(batch.pairs)) {
    throw new Error('A batch result is required.');
  }
  const key = pair => `${pair.oldPage}:${pair.newPage}`;
  const results = new Map(batch.results.map(item => [key(item.pair), item]));
  const failures = new Map(batch.failures.map(item => [key(item.pair), item]));
  return {
    generatedAt: generatedAt.toISOString(),
    oldPath: batch.oldPath, newPath: batch.newPath,
    canceled: !!batch.canceled,
    pairs: batch.pairs.map(pair => {
      const result = results.get(key(pair));
      const failure = failures.get(key(pair));
      const status = failure ? 'failed' : result ? 'completed' : 'unprocessed';
      return {
        status, error: status === 'failed' ? String(failure.error ?? '') : '',
        report: createCompareChangeReportModel({
          oldPath: batch.oldPath, newPath: batch.newPath,
          oldPage: pair.oldPage, newPage: pair.newPage,
          offset: batch.offset, pairing: pair,
          changes: status === 'completed' ? result.changes : [], generatedAt,
        }),
      };
    }),
  };
}

// A separate batch status keeps failed and unprocessed pairs visible in exported
// evidence. Neither status represents a zero-change detection result.
export function buildBatchCompareChangeReport(batch, generatedAt = new Date(batch?.completedAt || Date.now())) {
  if (!batch?.oldPath || !batch?.newPath || !Array.isArray(batch.results) || !Array.isArray(batch.failures)) {
    throw new Error('A batch result is required.');
  }
  const rows = [[...HEADERS, 'Batch result', 'Error']];
  for (const pair of batch.pairs || []) {
    const result = batch.results.find(entry => entry.pair.oldPage === pair.oldPage && entry.pair.newPage === pair.newPage);
    const failure = batch.failures.find(entry => entry.pair.oldPage === pair.oldPage && entry.pair.newPage === pair.newPage);
    const pairRows = compareChangeRows({
      oldPath: batch.oldPath, newPath: batch.newPath,
      oldPage: pair.oldPage, newPage: pair.newPage,
      offset: batch.offset, pairing: pair, changes: result?.changes || [], generatedAt,
    });
    if (result) rows.push(...pairRows.slice(1).map(row => [...row, 'completed', '']));
    else {
      const row = pairRows[1];
      row[11] = '';
      row[13] = '';
      rows.push([...row, failure ? 'failed' : 'unprocessed', failure ? safeText(failure.error) : '']);
    }
  }
  return encodeRows(rows);
}
