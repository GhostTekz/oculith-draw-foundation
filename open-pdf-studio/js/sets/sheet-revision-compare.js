import { fingerprintPdfBytes, inspectPdfPages } from './pdf-page-import.js';

/** Read the two registered sources before opening a prior-versus-current comparison. */
export async function verifySheetRevisionCompare(register, sheetId, historyIndex, readSource, { checkPages = true } = {}) {
  const sheet = register.sheets.find(item => item.id === sheetId);
  const prior = sheet?.history[historyIndex];
  if (!sheet || !Number.isSafeInteger(historyIndex) || !prior) {
    throw new Error('Earlier revision is no longer in this drawing set.');
  }
  if (!prior.sourceSha256 || !sheet.sourceSha256) {
    throw new Error('Both revisions need recorded PDF fingerprints before they can be compared.');
  }
  if (![prior.page, sheet.page].every(page => Number.isSafeInteger(page) && page > 0)) {
    throw new Error('Both revisions need valid recorded PDF page numbers before they can be compared.');
  }
  if (prior.filePath.trim().toLocaleLowerCase() === sheet.filePath.trim().toLocaleLowerCase()) {
    throw new Error('Earlier and current revisions use the same PDF path. Relink the earlier revision to a separate saved copy first.');
  }

  const read = async (source, description) => {
    let bytes;
    try { bytes = await readSource(source.filePath); }
    catch { throw new Error(`${description} PDF is unavailable at ${source.filePath}.`); }
    if (!bytes?.length) throw new Error(`${description} PDF is unavailable at ${source.filePath}.`);
    const fingerprint = await fingerprintPdfBytes(bytes);
    if (fingerprint !== source.sourceSha256) {
      throw new Error(`${description} PDF has changed since this revision was recorded. Relink it to the saved copy before comparing.`);
    }
    if (checkPages) {
      const { pageCount } = await inspectPdfPages(bytes);
      if (source.page > pageCount) {
        throw new Error(`${description} PDF no longer contains recorded page ${source.page}.`);
      }
      return { ...source, bytes, pageCount };
    }
    return { ...source, bytes };
  };

  const [old, current] = await Promise.all([
    read(prior, 'Earlier revision'), read(sheet, 'Current revision'),
  ]);
  return { sheetId: sheet.id, label: sheet.label, old, current };
}
