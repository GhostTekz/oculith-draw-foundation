import { fingerprintPdfBytes, inspectPdfPages } from './pdf-page-import.js';
import { sortSheetsByLabel } from './sheet-register.js';

/** Inspect only saved PDF sources. A summary never repairs the register or reads open tabs. */
export async function buildSetRevisionSummary(register, readSource) {
  const sources = new Map();
  const inspect = path => {
    if (!sources.has(path)) sources.set(path, (async () => {
      let bytes;
      try { bytes = await readSource(path); }
      catch { return { state: 'missing' }; }
      if (!bytes?.length) return { state: 'missing' };
      try {
        const [sha256, { pageCount }] = await Promise.all([
          fingerprintPdfBytes(bytes), inspectPdfPages(bytes),
        ]);
        return { sha256, pageCount };
      } catch { return { state: 'unreadable' }; }
    })());
    return sources.get(path);
  };
  const sourceState = async source => {
    const observed = await inspect(source.filePath);
    if (observed.state) return { ...source, state: observed.state };
    const validPage = Number.isSafeInteger(source.page) && source.page > 0 && source.page <= observed.pageCount;
    const state = !source.sourceSha256 ? 'unrecorded'
      : observed.sha256 !== source.sourceSha256 ? 'changed'
        : !validPage ? 'invalid-page' : 'exact';
    return { ...source, observedSha256: observed.sha256, pageCount: observed.pageCount, state };
  };

  const sheets = await Promise.all(sortSheetsByLabel(register.sheets).map(async sheet => {
    const historyIndex = sheet.history.length - 1;
    const priorSource = historyIndex >= 0 ? sheet.history[historyIndex] : null;
    const [current, prior] = await Promise.all([
      sourceState(sheet), priorSource ? sourceState(priorSource) : null,
    ]);
    const samePath = prior && prior.filePath.trim().toLocaleLowerCase() === current.filePath.trim().toLocaleLowerCase();
    const status = !prior ? 'no-prior' : samePath ? 'same-path'
      : prior.state === 'exact' && current.state === 'exact' ? 'ready' : 'blocked';
    return { sheetId: sheet.id, label: sheet.label, title: sheet.title,
      historyIndex, current, prior, status };
  }));
  return { register, sheets };
}
