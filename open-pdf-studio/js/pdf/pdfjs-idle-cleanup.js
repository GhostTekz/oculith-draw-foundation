// Let go of what PDF.js keeps of the pages it was asked about, once it has
// been quiet for a while.
//
// The editor asks PDF.js for a sheet's markups (getAnnotations) and text
// (getTextContent) and then keeps its own copy; it draws with PDFium. PDF.js
// meanwhile keeps every page it parsed: the page objects, the parsed
// annotations with their appearance streams, fonts and images, in the page
// and in its worker. On a large lighting set that was 1.3 GB, held until
// the tab closed. PDFDocumentProxy.cleanup() drops it (the PDF.js viewer
// does the same after a quiet spell); a page asked for later is parsed again.
//
// noteActivity(doc) after each PDF.js read; the cleanup runs QUIET_MS after
// the last one. A cleanup refused while PDF.js is rendering a page (the
// web build, a print) is tried again later.

const QUIET_MS = 10_000;

const timers = new WeakMap();

/** A PDF.js read of `doc` just happened: clean up after a quiet spell. */
export function noteActivity(doc, { quietMs = QUIET_MS } = {}) {
  const pdfDoc = doc?.pdfDoc;
  if (!pdfDoc?.cleanup) return;
  clearTimeout(timers.get(pdfDoc));
  timers.set(pdfDoc, setTimeout(() => {
    timers.delete(pdfDoc);
    // A reload or a close replaced or destroyed it meanwhile.
    if (doc.pdfDoc !== pdfDoc || pdfDoc.destroyed) return;
    Promise.resolve()
      .then(() => pdfDoc.cleanup())
      .catch(() => { if (doc.pdfDoc === pdfDoc) noteActivity(doc, { quietMs }); });
  }, quietMs));
}
