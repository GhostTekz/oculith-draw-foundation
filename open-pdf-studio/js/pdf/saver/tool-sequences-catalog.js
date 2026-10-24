import { PDFName, PDFString, PDFHexString } from 'pdf-lib';
import { sequenceCountersFromList, sequenceCountersToList } from '../../tools/tool-sequences.js';

/**
 * Next values of Tool Chest sequences, stored in the PDF so a reopened
 * document continues numbering (js/tools/tool-sequences.js):
 *
 *   /Root (catalog) -> /OPS_ToolSequences (hex string, UTF-16 JSON)
 *   [{ "prefix": "D-", "suffix": "", "next": 3 }]
 *
 * Only the label affixes and the next number are stored: no tool name,
 * style, author or path.
 */
export const TOOL_SEQUENCES_CATALOG_KEY = 'OPS_ToolSequences';

export function saveToolSequencesToCatalog(pdfDocLib, counters) {
  const context = pdfDocLib.context;
  const catalog = context.lookup(context.trailerInfo.Root);
  if (!catalog) return;
  const list = sequenceCountersToList(counters);
  if (!list.length) {
    catalog.delete(PDFName.of(TOOL_SEQUENCES_CATALOG_KEY));
    return;
  }
  catalog.set(PDFName.of(TOOL_SEQUENCES_CATALOG_KEY), PDFHexString.fromText(JSON.stringify(list)));
}

/** Counters map from the catalog; {} when absent or malformed. */
export function readToolSequencesFromCatalog(pdfDocLib) {
  try {
    const context = pdfDocLib.context;
    const catalog = context.lookup(context.trailerInfo.Root);
    const raw = catalog?.lookup(PDFName.of(TOOL_SEQUENCES_CATALOG_KEY));
    const text = raw instanceof PDFHexString || raw instanceof PDFString ? raw.decodeText() : null;
    if (!text || text.length > 64 * 1024) return {};
    return sequenceCountersFromList(JSON.parse(text));
  } catch {
    return {};
  }
}
