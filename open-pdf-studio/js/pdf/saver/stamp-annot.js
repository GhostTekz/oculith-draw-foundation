// The /Stamp annotation dictionary (as a pdf-lib context.obj() object) of a
// stamp markup: the saver writes every stamp with it, and Batch ▸ Apply Stamp
// (js/batch/stamp-place.js) writes its new stamps with it, so a batch stamp
// carries the same keys as one placed and saved in the app.
import { PDFString, PDFHexString, PDFName } from 'pdf-lib';
import { computeAnnotFlags } from './utils.js';
import { pdfTextString, asciiPdfName } from './pdf-text.js';

// Map app stamp names to PDF spec standard names (ISO 32000-1 Table 181)
const STD_STAMP_NAMES = {
  'Approved': 'Approved', 'Rejected': 'NotApproved', 'Not Approved': 'NotApproved',
  'Draft': 'Draft', 'Confidential': 'Confidential', 'Final': 'Final',
  'For Review': 'ForComment', 'Void': 'Expired', 'As Is': 'AsIs', 'Revised': 'Experimental'
};

/**
 * @param {object} ann  the stamp markup model
 * @param {{ rect: number[], colorArr: number[], opacity: number, now?: Date, nm?: string }} options
 *   now/nm: the /M date and /NM name (default: now and a random name)
 */
export function stampAnnotObject(ann, { rect, colorArr, opacity, now = new Date(), nm = null }) {
  const pdfStampName = STD_STAMP_NAMES[ann.stampName] || ann.stampName || 'Draft';
  const stampDictObj = {
    Type: 'Annot',
    Subtype: 'Stamp',
    Rect: rect,
    // /Name is een PDFName: alleen ASCII (de echte naam staat in /Subj en OPS_StampName).
    Name: asciiPdfName(pdfStampName, 'Draft'),
    Subj: pdfTextString(ann.stampName || pdfStampName),
    C: colorArr,
    CA: opacity,
    T: pdfTextString(ann.author || 'User'),
    M: PDFString.of(now.toISOString()),
    NM: PDFString.of(nm || ('stamp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6))),
    F: computeAnnotFlags(ann)
  };
  stampDictObj.IT = PDFName.of('Stamp');

  if (ann.rotation) stampDictObj.OPS_Rotation = ann.rotation;
  if (ann.stampName) stampDictObj.OPS_StampName = pdfTextString(ann.stampName);
  // Palette-symbool-id + IFC-classificatie (NEN 1414-stempels e.d.)
  // — roundtrip zodat het eigenschappenpaneel en het IFC-report de
  // categorie na heropenen behouden.
  if (ann.symbolId) stampDictObj.OPS_SymbolId = pdfTextString(ann.symbolId);
  if (ann.ifcCategory) stampDictObj.OPS_IfcCategory = pdfTextString(ann.ifcCategory);
  if (ann.ifcPredefinedType) stampDictObj.OPS_IfcPredefined = pdfTextString(ann.ifcPredefinedType);
  // Linked image (an image that round-tripped as a stamp keeps
  // its source path across saves). Hex string: literal PDFString
  // would corrupt Windows backslashes (\r, \n... are escapes).
  if (ann.linkedPath) stampDictObj.OPS_LinkedPath = PDFHexString.fromText(ann.linkedPath);
  return stampDictObj;
}
