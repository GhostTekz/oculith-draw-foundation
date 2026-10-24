// Test voor issue #308: review-status gezet door een extern PDF-programma
// moet bij het laden aan de doel-annotatie gekoppeld worden, en NIET als
// losse sticky note in het app-model verschijnen.
//
// Stappen:
//  1. Bouw met pdf-lib een PDF met een Highlight + een status-reply
//     (Text-annotatie met /IRT -> highlight, /State (Completed),
//     /StateModel (Review)).
//  2. Laad de PDF met PDF.js (zelfde parser als de app) en draai de
//     loader-classificatie (statusReplyFromPdfAnnotation +
//     applyStatusReplies) uit js/pdf/loader/status-replies.js.
//  3. Assert: status komt op de highlight terecht; geen extra comment.
//
// Draaien: node scripts/test-status-reply.mjs   (vanuit open-pdf-studio/)

import { PDFDocument, PDFName, PDFString, PDFArray, PDFRef } from 'pdf-lib';
import { statusReplyFromPdfAnnotation, applyStatusReplies } from '../js/pdf/loader/status-replies.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// 1. PDF bouwen: highlight + status-reply (zoals een extern PDF-programma doet)
// ---------------------------------------------------------------------------
const pdfDoc = await PDFDocument.create();
const page = pdfDoc.addPage([595, 842]);
const context = pdfDoc.context;

const highlightDict = context.obj({
  Type: 'Annot',
  Subtype: 'Highlight',
  Rect: [100, 700, 300, 720],
  QuadPoints: [100, 720, 300, 720, 100, 700, 300, 700],
  C: [1, 1, 0],
  T: PDFString.of('Original Author'),
  Contents: PDFString.of('Belangrijke passage'),
  M: PDFString.of('D:20260101120000Z'),
  F: 4,
});
const highlightRef = context.register(highlightDict);

const statusDict = context.obj({
  Type: 'Annot',
  Subtype: 'Text',
  Rect: [100, 700, 120, 720],
  Contents: PDFString.of('Completed set by Reviewer X'),
  T: PDFString.of('Reviewer X'),
  M: PDFString.of('D:20260315093000Z'),
  F: 30,
  State: PDFString.of('Completed'),
  StateModel: PDFString.of('Review'),
});
statusDict.set(PDFName.of('IRT'), highlightRef);
const statusRef = context.register(statusDict);

page.node.set(PDFName.of('Annots'), context.obj([highlightRef, statusRef]));
const pdfBytes = await pdfDoc.save();
console.log(`PDF gebouwd (${pdfBytes.length} bytes): highlight + status-reply (State=Completed, StateModel=Review, IRT)`);

// ---------------------------------------------------------------------------
// 2. Laden met PDF.js en de loader-classificatie draaien
// ---------------------------------------------------------------------------
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(), isEvalSupported: false, verbosity: 0 });
const pdf = await loadingTask.promise;
const pdfPage = await pdf.getPage(1);
const annots = await pdfPage.getAnnotations();
console.log(`PDF.js zag ${annots.length} annotaties: ${annots.map(a => a.subtype).join(', ')}`);

// Zelfde flow als loader.js _convertAndPushAnnotations: status-replies worden
// afgevangen vóór conversie; overige annotaties belanden in het app-model.
const appModel = [];
const byPdfId = new Map();
const pendingStatuses = [];
for (const annot of annots) {
  const statusReply = statusReplyFromPdfAnnotation(annot);
  if (statusReply) {
    pendingStatuses.push(statusReply);
    continue; // GEEN sticky note voor status-replies
  }
  // Minimale stand-in voor convertPdfAnnotation (converter zelf heeft
  // app/DOM-afhankelijkheden; de classificatie hierboven is wat we testen).
  const converted = {
    type: annot.subtype === 'Text' ? 'comment' : 'textHighlight',
    page: 1,
    author: (annot.titleObj && annot.titleObj.str) || '',
  };
  if (annot.id) byPdfId.set(annot.id, converted);
  appModel.push(converted);
}
const applied = applyStatusReplies(pendingStatuses, byPdfId);

// ---------------------------------------------------------------------------
// 3. Asserties
// ---------------------------------------------------------------------------
console.log('\nResultaat app-model:', JSON.stringify(appModel, null, 2));

assert(appModel.length === 1, `app-model bevat exact 1 annotatie (was ${appModel.length})`);
assert(!appModel.some(a => a.type === 'comment'), 'geen losse sticky note (comment) voor de status-reply');
const hl = appModel[0];
assert(hl && hl.type === 'textHighlight', 'overgebleven annotatie is de highlight');
assert(applied === 1, `precies 1 status toegepast (was ${applied})`);
assert(hl.status === 'completed', `status 'completed' staat op de highlight (was '${hl?.status}')`);
assert(hl.statusBy === 'Reviewer X', `statusBy = 'Reviewer X' (was '${hl?.statusBy}')`);
assert(typeof hl.statusAt === 'string' && hl.statusAt.startsWith('2026-03-15'), `statusAt uit /M van de reply (was '${hl?.statusAt}')`);

// Extra: Marked-model reply zet het 'marked'-veld
const markedPending = [{ __statusReply: true, targetId: 'x1', state: 'Marked', stateModel: 'Marked', author: 'A', date: null }];
const markedTarget = { type: 'textHighlight' };
applyStatusReplies(markedPending, new Map([['x1', markedTarget]]));
assert(markedTarget.marked === true, "StateModel 'Marked' + State 'Marked' zet marked=true");

// Extra: meerdere statussen -> laatste (op datum) wint
const multi = [
  { __statusReply: true, targetId: 'y1', state: 'Rejected', stateModel: 'Review', author: 'B', date: '2026-05-01T10:00:00Z' },
  { __statusReply: true, targetId: 'y1', state: 'Accepted', stateModel: 'Review', author: 'C', date: '2026-06-01T10:00:00Z' },
];
const multiTarget = { type: 'box' };
applyStatusReplies([multi[1], multi[0]], new Map([['y1', multiTarget]])); // bewust in omgekeerde volgorde
assert(multiTarget.status === 'accepted', `laatste status (op datum) wint (was '${multiTarget.status}')`);

await pdf.destroy();

if (failures > 0) {
  console.error(`\n${failures} assertie(s) gefaald`);
  process.exit(1);
}
console.log('\nAlle asserties geslaagd.');
