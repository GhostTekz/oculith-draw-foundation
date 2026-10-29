// The public contract between the LGPL editor and an edition composition.
// Bump this version together with both compositions when a required hook changes.
export const EDITION_API_VERSION = 1;

export function assertEditionContract(edition) {
  if (!edition || edition.apiVersion !== EDITION_API_VERSION) {
    throw new Error(`Unsupported OcuDraw edition API; expected ${EDITION_API_VERSION}.`);
  }
  for (const name of ['panels', 'panelIds', 'fileCommands', 'fileMenuItems', 'symbolCategories',
    'symbolTemplates']) {
    if (!Array.isArray(edition[name])) throw new Error(`Edition ${name} must be an array.`);
  }
  if (!edition.dialogs || typeof edition.dialogs !== 'object') throw new Error('Edition dialogs must be an object.');
  if (edition.tools != null) {
    if (!Array.isArray(edition.tools.shapeToolIds) || !Array.isArray(edition.tools.allowClick)
        || typeof edition.tools.createAnnotation !== 'function') throw new Error('Edition tools are invalid.');
    if (edition.tools.shapeToolIds.some((id) => typeof id !== 'string' || !id)
        || edition.tools.allowClick.some((id) => !edition.tools.shapeToolIds.includes(id))) {
      throw new Error('Edition tool IDs are invalid.');
    }
  }
  if (edition.rendering != null) {
    for (const name of ['isUnderlay', 'drawCaption', 'boxShape', 'drawPolygon']) {
      if (typeof edition.rendering[name] !== 'function') throw new Error(`Edition rendering ${name} must be a function.`);
    }
  }
  if (edition.pointer != null) {
    for (const name of ['priorityHit', 'event', 'cursor', 'filterMarquee']) {
      if (typeof edition.pointer[name] !== 'function') throw new Error(`Edition pointer ${name} must be a function.`);
    }
  }
  if (edition.listGroupings != null && (!Array.isArray(edition.listGroupings)
      || edition.listGroupings.some((grouping) => typeof grouping?.id !== 'string'
        || typeof grouping.paths !== 'function' || typeof grouping.select !== 'function'))) {
    throw new Error('Edition listGroupings must contain package IDs and paths/select callbacks.');
  }
  if (edition.undo != null && typeof edition.undo.restoreExtensionState !== 'function') {
    throw new Error('Edition undo restoreExtensionState must be a function.');
  }
  if (edition.documentTitle != null && typeof edition.documentTitle !== 'function') {
    throw new Error('Edition documentTitle must be a function.');
  }
  if (edition.home != null) {
    if (typeof edition.home.title !== 'function' || typeof edition.home.description !== 'function'
        || !Array.isArray(edition.home.actions) || edition.home.actions.some((action) =>
          typeof action.label !== 'function' || typeof action.run !== 'function')) {
      throw new Error('Edition home slot is invalid.');
    }
  }
  if (edition.pdf != null) {
    for (const name of ['readWorkspace', 'workspaceForSave', 'saveWorkspace']) {
      if (typeof edition.pdf[name] !== 'function') throw new Error(`Edition PDF ${name} must be a function.`);
    }
    // Optional: the catalog entries readWorkspace reads. Without it the
    // editor hands readWorkspace a pdf-lib document for every file.
    if (edition.pdf.catalogKeys != null && (!Array.isArray(edition.pdf.catalogKeys)
        || edition.pdf.catalogKeys.some((key) => typeof key !== 'string' || !key))) {
      throw new Error('Edition PDF catalogKeys must be an array of names.');
    }
    if (edition.pdf.annotationKeys != null && (!Array.isArray(edition.pdf.annotationKeys)
        || edition.pdf.annotationKeys.some((key) => typeof key !== 'string' || !key))) {
      throw new Error('Edition PDF annotationKeys must be an array of names.');
    }
    if (edition.pdf.annotationKeysToSkipCarry != null && (!Array.isArray(edition.pdf.annotationKeysToSkipCarry)
        || edition.pdf.annotationKeysToSkipCarry.some((key) => typeof key !== 'string' || !key))) {
      throw new Error('Edition PDF annotationKeysToSkipCarry must be an array of names.');
    }
    // Optional: carry the edition's catalog data to pages copied into a new
    // PDF (Extract Pages, Split): (source, extract, pageNumbers).
    // Optional: what a polygon markup's appearance adds, in page space:
    // (ann, { X, Y, pageRot, doc }) → { content, needsFont?, rect? } | null.
    for (const name of ['applyWorkspace', 'carryToExtract', 'polygonAppearance', 'decorateLoadedAnnotation',
      'writeAnnotation', 'shapeForAnnotation']) {
      if (edition.pdf[name] != null && typeof edition.pdf[name] !== 'function') {
        throw new Error(`Edition PDF ${name} must be a function.`);
      }
    }
  }
  const ids = edition.panels.map((panel) => panel?.id);
  if (ids.some((id) => typeof id !== 'string' || !id)) throw new Error('Edition panels need string ids.');
  if (new Set(ids).size !== ids.length ||
      ids.length !== edition.panelIds.length ||
      ids.some((id, index) => id !== edition.panelIds[index])) {
    throw new Error('Edition panelIds must match unique panels in order.');
  }
  return edition;
}
