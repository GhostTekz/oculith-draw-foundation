// The document-level fields the loader reads with pdf-lib when a PDF opens:
// annotation layers, line-style presets, tool sequence counters, the
// Markups List columns, spaces and scale viewports. One pass over a parsed
// pdf-lib document, returned as plain data, so the pdf-lib worker
// (pdf-lib-worker.js) can send it back and the loader applies it the same
// way whether the parse ran there or on the main thread.
//
// Each field is read on its own: a malformed entry leaves that field at its
// "not read" value (null, or [] / {} where the reader itself returns those)
// and the others still arrive. No DOM and no app state here.

import { PDFArray, PDFDict, PDFName, PDFRef } from 'pdf-lib';
import { leesAnnotatieLagen } from './saver/annotatie-lagen.js';
import { readStylePresetsFromCatalog } from './saver/style-presets-read.js';
import { readToolSequencesFromCatalog } from './saver/tool-sequences-catalog.js';
import { readMarkupTextColumn, readMarkupSecondTextColumn } from './markup-text-column.js';
import { readMarkupChoiceColumn } from './markup-choice-column.js';
import { readMarkupSecondChoiceColumn } from './markup-second-choice-column.js';
import { readMarkupNumberColumn } from './markup-number-column.js';
import { readMarkupSecondNumberColumn } from './markup-second-number-column.js';
import { readMarkupCheckmarkColumn } from './markup-checkmark-column.js';
import { readMarkupStatusSet } from './markup-status-set.js';
import { readMarkupFormulaColumn } from './markup-formula-column.js';
import { readFormulaCaptions } from './formula-captions-pdf.js';
import { readAssemblies } from './assemblies-pdf.js';
import { readSpaces } from '../spaces/pdf-spaces.js';
import { leesPdfViewports } from './pdf-viewports.js';
import { leesEigenViewports } from './viewports-vp.js';

function field(read, fallback = null) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** The names of the catalog's own entries (without the slash). */
function catalogKeys(pdfLibDoc) {
  const context = pdfLibDoc.context;
  const catalog = context.lookup(context.trailerInfo.Root);
  if (!catalog || typeof catalog.keys !== 'function') return [];
  return catalog.keys().map((key) => (key instanceof PDFName ? key.asString() : String(key)).replace(/^\//, ''));
}

// A form of more fields than this is not walked to the end: the answer is
// then "maybe" (null), and the caller asks PDF.js.
const MAX_FORM_FIELDS = 20000;

/**
 * Does the form (/AcroForm /Fields, with their /Kids) hold a signature
 * field, signed or empty? false without a form; null when it could not be
 * walked to the end. The field type is inherited from a parent.
 */
function hasSignatureFields(pdfLibDoc) {
  const context = pdfLibDoc.context;
  const lookup = (v) => (v instanceof PDFRef ? context.lookup(v) : v);
  const catalog = lookup(context.trailerInfo.Root);
  const form = catalog instanceof PDFDict ? lookup(catalog.get(PDFName.of('AcroForm'))) : null;
  const fields = form instanceof PDFDict ? lookup(form.get(PDFName.of('Fields'))) : null;
  if (!(fields instanceof PDFArray)) return false;
  const seen = new Set();
  const stack = fields.asArray().map((node) => [node, null]);
  while (stack.length) {
    const [node, inherited] = stack.pop();
    if (node instanceof PDFRef) {
      if (seen.has(node.tag)) continue;
      seen.add(node.tag);
    }
    if (seen.size > MAX_FORM_FIELDS) return null;
    const dict = lookup(node);
    if (!(dict instanceof PDFDict)) continue;
    const own = dict.get(PDFName.of('FT'));
    const type = own instanceof PDFName ? own.asString() : inherited;
    if (type === '/Sig') return true;
    const kids = lookup(dict.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) for (const kid of kids.asArray()) stack.push([kid, type]);
  }
  return false;
}

/**
 * Every catalog field the loader applies after opening a PDF.
 * @param {import('pdf-lib').PDFDocument} pdfLibDoc
 */
export function readCatalogFields(pdfLibDoc) {
  return {
    pageCount: field(() => pdfLibDoc.getPageCount(), 0),
    catalogKeys: field(() => catalogKeys(pdfLibDoc), []),
    // null = not known (handtekeningen/verificatie.js asks PDF.js then).
    signatureFields: field(() => hasSignatureFields(pdfLibDoc)),
    layers: field(() => leesAnnotatieLagen(pdfLibDoc)),
    stylePresets: field(() => readStylePresetsFromCatalog(pdfLibDoc), []),
    toolSequences: field(() => readToolSequencesFromCatalog(pdfLibDoc), {}),
    textColumnName: field(() => readMarkupTextColumn(pdfLibDoc), ''),
    textColumn2Name: field(() => readMarkupSecondTextColumn(pdfLibDoc), ''),
    choiceColumn: field(() => readMarkupChoiceColumn(pdfLibDoc)),
    choiceColumn2: field(() => readMarkupSecondChoiceColumn(pdfLibDoc)),
    numberColumn: field(() => readMarkupNumberColumn(pdfLibDoc)),
    numberColumn2: field(() => readMarkupSecondNumberColumn(pdfLibDoc)),
    checkmarkColumn: field(() => readMarkupCheckmarkColumn(pdfLibDoc)),
    statusSet: field(() => readMarkupStatusSet(pdfLibDoc)),
    formulaColumn: field(() => readMarkupFormulaColumn(pdfLibDoc)),
    formulaCaptions: field(() => readFormulaCaptions(pdfLibDoc)),
    assemblies: field(() => readAssemblies(pdfLibDoc)),
    spaces: field(() => readSpaces(pdfLibDoc), []),
    // null = the read failed (pdf-viewports.js rondViewportLezingAf).
    viewports: field(() => leesPdfViewports(pdfLibDoc)),
    ownViewports: field(() => leesEigenViewports(pdfLibDoc)),
  };
}
