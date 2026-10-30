import { drawingLogCsv, filterSheets, sortSheetsByLabel } from './sheet-register.js';

/** Snapshot the displayed current sheets without carrying prior revision rows into an export. */
export function createCurrentDrawingLog(register, query = '', revision = '') {
  if (!register || !Array.isArray(register.sheets)) throw new Error('A drawing set is required.');
  const sheets = sortSheetsByLabel(filterSheets(register, query, revision));
  if (!sheets.length) throw new Error('No current sheets match this view. Change the search or revision filter.');
  return {
    sourceRegister: register,
    sourceJson: JSON.stringify(register),
    query, revision, total: register.sheets.length,
    register: { ...register, sheets: sheets.map(sheet => ({ ...sheet, history: [] })) },
  };
}

export function assertCurrentDrawingLog(view, register, query, revision) {
  if (!view || view.sourceRegister !== register || view.sourceJson !== JSON.stringify(register)
      || view.query !== query || view.revision !== revision) {
    throw new Error('The drawing set or current view changed during export. Review it and try again.');
  }
}

export function currentDrawingLogCsv(view, availability = {}) {
  return drawingLogCsv(view.register, availability);
}
