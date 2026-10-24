import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { edition } from '../editions/active.js';
import { fingerprintPdfBytes } from './pdf-page-import.js';
import { parseSheetRegister, sortSheetsByLabel } from './sheet-register.js';

function hasSignature(pdf) {
  if (pdf.catalog.lookup(PDFName.of('Perms'))) return true;
  const form = pdf.catalog.lookup(PDFName.of('AcroForm'));
  if (!(form instanceof PDFDict)) return false;
  const fields = form.lookup(PDFName.of('Fields'));
  if (!(fields instanceof PDFArray)) return false;
  const pending = fields.asArray();
  const seen = new Set();
  while (pending.length) {
    const field = pdf.context.lookup(pending.pop());
    if (!(field instanceof PDFDict) || seen.has(field)) continue;
    seen.add(field);
    if (seen.size > 4096) throw new Error('The current PDF has too many form fields to verify signatures.');
    if (field.lookup(PDFName.of('FT'))?.toString() === '/Sig' && field.lookup(PDFName.of('V'))) return true;
    const kids = field.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) pending.push(...kids.asArray());
  }
  return false;
}

function hasFormFields(pdf) {
  const form = pdf.catalog.lookup(PDFName.of('AcroForm'));
  if (!(form instanceof PDFDict)) return false;
  const fields = form.lookup(PDFName.of('Fields'));
  return fields instanceof PDFArray && fields.size() > 0;
}

/**
 * Build one PDF from the current source page of each registered sheet.
 * Historical revisions and source aliases are intentionally never read.
 * Every source must have a recorded digest, so a replaced file at the same
 * path cannot quietly publish an older or unrelated drawing.
 */
export async function buildCurrentSetPdf(register, readSource) {
  const checked = parseSheetRegister(register);
  if (!checked.sheets.length) throw new Error('Add sheets before publishing the drawing set.');
  if (typeof readSource !== 'function') throw new Error('A PDF source reader is required.');

  const combined = await PDFDocument.create();
  combined.setTitle(`${checked.name} - current revisions`);
  combined.setCreator(edition.productName);
  const sources = new Map();
  for (const sheet of sortSheetsByLabel(checked.sheets)) {
    if (!sheet.sourceSha256) {
      throw new Error(`${sheet.label}: current PDF has no recorded fingerprint. Re-add or relink its source before publishing.`);
    }
    let source = sources.get(sheet.filePath);
    if (!source) {
      let bytes;
      try { bytes = await readSource(sheet.filePath); }
      catch { throw new Error(`${sheet.label}: current PDF is unavailable at ${sheet.filePath}. Relink the sheet before publishing.`); }
      if (!bytes?.length) {
        throw new Error(`${sheet.label}: current PDF is unavailable at ${sheet.filePath}. Relink the sheet before publishing.`);
      }
      const fingerprint = await fingerprintPdfBytes(bytes);
      if (fingerprint !== sheet.sourceSha256) {
        throw new Error(`${sheet.label}: current PDF changed at ${sheet.filePath}. Record a revision or relink the correct PDF before publishing.`);
      }
      let pdf;
      try { pdf = await PDFDocument.load(bytes); }
      catch { throw new Error(`${sheet.label}: current PDF at ${sheet.filePath} could not be read.`); }
      if (hasSignature(pdf)) {
        throw new Error(`${sheet.label}: signed or certified PDFs cannot be combined. Publish an unsigned source.`);
      }
      if (hasFormFields(pdf)) {
        throw new Error(`${sheet.label}: PDFs with interactive form fields cannot be combined without losing form data.`);
      }
      source = { pdf, fingerprint };
      sources.set(sheet.filePath, source);
    }
    if (source.fingerprint !== sheet.sourceSha256) {
      throw new Error(`${sheet.label}: current PDF fingerprint conflicts with another sheet at ${sheet.filePath}.`);
    }
    if (sheet.page > source.pdf.getPageCount()) {
      throw new Error(`${sheet.label}: page ${sheet.page} is not in the current PDF at ${sheet.filePath}.`);
    }
    const [page] = await combined.copyPages(source.pdf, [sheet.page - 1]);
    combined.addPage(page);
  }
  return combined.save();
}
