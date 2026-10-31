// The editor's own tour: the basics of a drawing review, in six short steps.
// Anchors are registered ids (tours.js) or selectors of the workspace.

export const BASICS_TOUR_ID = 'foundation.basics';

export const basicsTour = Object.freeze({
  id: BASICS_TOUR_ID,
  title: 'Basics',
  // Translations: common basicsTour.* (locales/<lng>/common.json).
  textKey: 'basicsTour',
  steps: [
    {
      anchor: 'open',
      title: 'Open a drawing',
      body: ['Open a PDF drawing set with File > Open or Ctrl+O.', 'Recent files are in the File menu too.'],
    },
    {
      anchor: 'thumbnails',
      panel: 'thumbnails',
      title: 'Move through the sheets',
      body: ['Thumbnails show every sheet. Click one to go to it.'],
    },
    {
      anchor: 'page-navigation',
      title: 'Pages and zoom',
      body: ['Type a page number or step with the arrows.', 'Zoom with Ctrl and the mouse wheel; Ctrl+0 fits the page.'],
    },
    {
      anchor: 'markup',
      title: 'Mark up',
      body: ['Pick a markup tool from the tool palette or the Tools menu, then draw on the sheet.', 'Esc returns to Select.'],
    },
    {
      anchor: 'scale',
      title: 'Measure with a scale',
      body: ['Set the sheet scale first: Tools > Measure > Set Scale, for example 1/8" = 1\'-0".', 'Lengths and areas then read in real units.'],
    },
    {
      anchor: 'save',
      title: 'Save',
      body: ['Ctrl+S saves your markups into the PDF.', 'Show this tour again from Help.'],
    },
  ],
});
