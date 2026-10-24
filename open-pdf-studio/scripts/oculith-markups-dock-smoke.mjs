// QW-13 browser smoke: the bottom Markups List shows page, subject/type,
// comment preview, status and author in aligned labeled columns, keeps the
// existing list actions (row click selects the markup, the bottom host's »
// toggle, the bottom access bar's Markups List tab), and stays usable at a
// 1280px window without covering the PDF. The list is the Markups List panel
// of the plan-review bottom panel host (section.ws-host-bottom.markups-dock).
//
// This script starts an isolated Vite server without shared HMR state,
// drives the real app in headless Chromium, and builds its fixture PDF
// with pdf-lib:
//   page 1: FreeText by "Alice" (has /Contents + AP, so a comment preview)
//           + Highlight by "Bob" with a Rejected review reply
//   page 2: Highlight by "Carol" + a status reply (Text annot with
//           /IRT -> Carol's highlight, /State Accepted, /StateModel
//           Review), so exactly one row has a review status.
//
// Run: node scripts/oculith-markups-dock-smoke.mjs   (from open-pdf-studio/)

import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// The bottom host's » toggle (components/panels/AccessBar.jsx).
const DOCK_TOGGLE = '.ws-access-bottom .ws-access-toggle';

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
// 1. Build the fixture PDF
// ---------------------------------------------------------------------------
async function buildFixturePdf() {
  const pdfDoc = await PDFDocument.create();
  const context = pdfDoc.context;
  const p1 = pdfDoc.addPage([595, 842]);
  const p2 = pdfDoc.addPage([595, 842]);

  const fontDict = context.obj({
    Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
  });

  // --- page 1: FreeText by Alice (comment preview source) -----------------
  const ftRect = [100, 700, 400, 740];
  const ftText = 'Rebar spacing looks off, verify schedule';
  const apContent =
    '1 1 0.6 rg\n' +
    `${ftRect[0]} ${ftRect[1]} 300 40 re f\n` +
    'BT\n' +
    '0 0 0 rg 0 Tc 0 Tw 100 Tz 0 Tr\n' +
    '/Helv 14 Tf\n' +
    `${ftRect[0] + 4} ${ftRect[3] - 18} Td\n(${ftText}) Tj\n` +
    'ET\n';
  const apStream = context.stream(apContent, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: ftRect,
    Matrix: [1, 0, 0, 1, -ftRect[0], -ftRect[1]],
    Resources: context.obj({ Font: context.obj({ Helv: fontDict }) }),
  });
  const apRef = context.register(apStream);

  const freeTextDict = context.obj({
    Type: 'Annot',
    Subtype: 'FreeText',
    Rect: ftRect,
    Contents: PDFString.of(ftText),
    DA: PDFString.of('0 0 0 rg /Helv 14 Tf'),
    C: [1, 1, 0.6],
    F: 4,
    T: PDFString.of('Alice'),
    M: PDFString.of('D:20261001083000Z'),
  });
  freeTextDict.set(PDFName.of('AP'), context.obj({ N: apRef }));
  const freeTextRef = context.register(freeTextDict);

  const bobHighlight = context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [100, 660, 350, 678],
    QuadPoints: [100, 678, 350, 678, 100, 660, 350, 660],
    Contents: PDFString.of('Check load calculation'),
    C: [1, 0.8, 0.2],
    F: 4,
    T: PDFString.of('Bob'),
    M: PDFString.of('D:20261001090000Z'),
  });
  const bobRef = context.register(bobHighlight);
  const bobStatus = context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [360, 660, 380, 678],
    Contents: PDFString.of('Rejected by reviewer'), T: PDFString.of('Reviewer'),
    M: PDFString.of('D:20261003100000Z'), F: 30,
    State: PDFString.of('Rejected'), StateModel: PDFString.of('Review'),
  });
  bobStatus.set(PDFName.of('IRT'), bobRef);
  const bobStatusRef = context.register(bobStatus);
  p1.node.set(PDFName.of('Annots'), context.obj([freeTextRef, bobRef, bobStatusRef]));

  // --- page 2: Highlight by Carol + Accepted status reply ------------------
  const carolHighlight = context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [80, 320, 320, 338],
    QuadPoints: [80, 338, 320, 338, 80, 320, 320, 320],
    Contents: PDFString.of('Update title block date'),
    C: [0.3, 0.8, 1],
    F: 4,
    T: PDFString.of('Carol'),
    M: PDFString.of('D:20261002090000Z'),
  });
  const carolRef = context.register(carolHighlight);

  const statusReply = context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [330, 320, 350, 338],
    Contents: PDFString.of('Accepted by Dave'),
    T: PDFString.of('Dave'),
    M: PDFString.of('D:20261003100000Z'),
    F: 30,
    State: PDFString.of('Accepted'),
    StateModel: PDFString.of('Review'),
  });
  statusReply.set(PDFName.of('IRT'), carolRef);
  const statusRef = context.register(statusReply);
  p2.node.set(PDFName.of('Annots'), context.obj([carolRef, statusRef]));

  return await pdfDoc.save();
}

// ---------------------------------------------------------------------------
// 2. Drive the real app in headless Chromium (1280px, like the acceptance)
// ---------------------------------------------------------------------------
const fixtureBytes = await buildFixturePdf();
console.log(`Fixture PDF: ${fixtureBytes.length} bytes (p1: Alice FreeText + Bob Highlight/Rejected, p2: Carol Highlight/Accepted)`);

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('  [browser]', msg.text());
  });
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 2a. Open the fixture through the real tab/loader/state stack
  const loaded = await page.evaluate(async (bytesArr) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { index } = createTab('markups-fixture.pdf');
    await loadPDF('markups-fixture.pdf', index, new Uint8Array(bytesArr));
    const doc = state.documents[index];
    for (let i = 0; i < 300; i++) {
      if (doc.annotations.length >= 3 && doc._pagesNeedingColorUpdate.size === 0) break;
      await new Promise(r => setTimeout(r, 100));
    }
    return {
      index,
      annotations: doc.annotations.map(a => ({
        id: a.id, page: a.page, type: a.type,
        author: a.author, text: a.text || '', status: a.status || null,
      })),
    };
  }, Array.from(fixtureBytes));
  console.log('  app-model:', JSON.stringify(loaded.annotations));
  assert(loaded.annotations.length === 3, `3 annotations in app-model, status reply not a row (was ${loaded.annotations.length})`);
  assert(loaded.annotations.every(a => a.author), 'every annotation has an author');
  assert(loaded.annotations.some(a => a.status === 'accepted'), "status reply applied: Carol's highlight is 'accepted'");
  const alice = loaded.annotations.find(a => a.author === 'Alice');
  assert(!!alice && alice.text.length > 0, 'Alice (FreeText) has comment text in the model');

  // 2b. The bottom host starts open in the Oculith profile; its » toggle
  // collapses and expands it.
  assert((await page.getAttribute(DOCK_TOGGLE, 'aria-expanded')) === 'true', 'bottom host starts open (aria-expanded=true)');
  await page.click(DOCK_TOGGLE);
  await page.waitForSelector('.markups-dock.collapsed', { timeout: 5000 });
  assert((await page.getAttribute(DOCK_TOGGLE, 'aria-expanded')) === 'false', 'toggle collapses (aria-expanded=false)');
  await page.click(DOCK_TOGGLE);
  await page.waitForSelector('.markups-dock.open', { timeout: 5000 });
  await page.waitForSelector('.markups-dock .annotation-list-item', { timeout: 10000 });
  assert((await page.getAttribute(DOCK_TOGGLE, 'aria-expanded')) === 'true', 'toggle expands (aria-expanded=true)');

  // 2c. Labeled header columns
  const headers = await page.$$eval('.markups-dock .annotation-list-header .annotation-cell',
    cells => cells.map(c => (c.textContent || '').trim()));
  assert(JSON.stringify(headers) === JSON.stringify(['Page', 'Type', 'Comment', 'Status', 'Author']),
    `header row shows the 5 labeled columns (was ${JSON.stringify(headers)})`);
  const sortControls = await page.evaluate(() => {
    const header = document.querySelector('.markups-dock .annotation-list-header');
    return {
      invalidTableSemantics: header.hasAttribute('role') || !!header.querySelector('[role], [aria-sort]'),
      buttons: [...header.querySelectorAll('button')].map(button => ({
        tag: button.tagName, pressed: button.getAttribute('aria-pressed'), label: button.getAttribute('aria-label'),
      })),
    };
  });
  assert(!sortControls.invalidTableSemantics && sortControls.buttons.length === 5 &&
    sortControls.buttons.every(button => button.tag === 'BUTTON' && button.pressed === 'false' && button.label?.includes('groups')),
  'five native sort buttons expose scope and pressed state without incomplete table roles');

  // 2d. Nonempty rows aligned under the header columns
  const rowCount = await page.$$eval('.markups-dock .annotation-list-item', rows => rows.length);
  assert(rowCount === 3, `3 visible rows for the 3 markups (was ${rowCount})`);

  const alignment = await page.evaluate(() => {
    const header = document.querySelector('.markups-dock .annotation-list-header');
    const rows = [...document.querySelectorAll('.markups-dock .annotation-list-item')];
    const cells = element => [...element.querySelectorAll(':scope > .annotation-cell')]
      .map(cell => ({ x: cell.getBoundingClientRect().x, width: cell.getBoundingClientRect().width }));
    return { header: cells(header), rows: rows.map(cells) };
  });
  assert(alignment.header.length === 5 && alignment.rows.every(row => row.length === 5), 'header and rows each have five cells');
  assert(alignment.rows.every(row => row.every((cell, index) =>
    Math.abs(cell.x - alignment.header[index].x) <= 1 && Math.abs(cell.width - alignment.header[index].width) <= 1)),
  'all row cells align with their header columns');

  const aliceRow = page.locator('.markups-dock .annotation-list-item').filter({ has: page.locator('.annotation-cell-author', { hasText: 'Alice' }) });
  assert((await aliceRow.locator('.annotation-cell-comment').innerText()).includes('Rebar spacing'), 'comment preview appears in its column');
  const carolRow = page.locator('.markups-dock .annotation-list-item').filter({ has: page.locator('.annotation-cell-author', { hasText: 'Carol' }) });
  assert((await carolRow.locator('.annotation-cell-status').innerText()).includes('Accepted'), 'review status appears in its column');
  await aliceRow.click();
  await page.waitForFunction(() => document.querySelector('.markups-dock .annotation-list-item.selected'));
  const selectedId = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    return getActiveDocument()?.selectedAnnotation?.id;
  });
  assert(selectedId === alice.id, 'clicking a row selects the same markup in the document');

  // Sorting only reorders rows. Grouping, filters, and selection stay active.
  const visibleAuthors = () => page.$$eval('.markups-dock .annotation-list-item .annotation-cell-author',
    cells => cells.map(cell => cell.textContent.trim()));
  const waitForAuthors = expected => page.waitForFunction(authors =>
    [...document.querySelectorAll('.markups-dock .annotation-list-item .annotation-cell-author')]
      .map(cell => cell.textContent.trim()).join('|') === authors.join('|'), expected);
  const headerAction = (label, direction) => page.getByRole('button', { name: new RegExp(`^Sort ${label} ${direction} .*groups$`, 'u') });
  const sortHeader = label => headerAction(label, 'ascending');
  await sortHeader('Page').click();
  await headerAction('Page', 'descending').click();
  await waitForAuthors(['Carol', 'Alice', 'Bob']);
  assert(JSON.stringify(await visibleAuthors()) === JSON.stringify(['Carol', 'Alice', 'Bob']),
    'Page descending reverses page groups and keeps rows in each page');
  assert((await headerAction('Page', 'ascending').getAttribute('aria-pressed')) === 'true' &&
    (await page.locator('.markups-dock .annotations-sort-summary').innerText()).includes('Page ↓ across page groups'),
  'Page sort exposes its direction and scope through a pressed button and visible summary');
  await sortHeader('Author').click();
  await headerAction('Author', 'descending').click();
  await waitForAuthors(['Bob', 'Alice', 'Carol']);
  assert(JSON.stringify(await visibleAuthors()) === JSON.stringify(['Bob', 'Alice', 'Carol']),
    'Author descending reorders rows inside the current page groups');
  assert((await page.locator('.markups-dock .annotations-sort-summary').innerText()).includes('Author ↓ within groups'),
    'the visible summary makes within-group sorting explicit');
  await sortHeader('Comment').click();
  await waitForAuthors(['Bob', 'Alice', 'Carol']);
  assert(JSON.stringify(await visibleAuthors()) === JSON.stringify(['Bob', 'Alice', 'Carol']),
    'Comment ascending sorts the displayed preview inside each group');
  await headerAction('Comment', 'descending').click();
  await waitForAuthors(['Alice', 'Bob', 'Carol']);
  assert(JSON.stringify(await visibleAuthors()) === JSON.stringify(['Alice', 'Bob', 'Carol']),
    'Comment descending reverses the displayed preview order');
  await sortHeader('Status').click();
  await waitForAuthors(['Alice', 'Bob', 'Carol']);
  assert(JSON.stringify(await visibleAuthors()) === JSON.stringify(['Alice', 'Bob', 'Carol']),
    'Status ascending orders empty and reviewed statuses inside each group');
  await headerAction('Status', 'descending').click();
  await waitForAuthors(['Bob', 'Alice', 'Carol']);
  assert(JSON.stringify(await visibleAuthors()) === JSON.stringify(['Bob', 'Alice', 'Carol']),
    'Status descending puts reviewed markups first within each page');
  await sortHeader('Type').click();
  await waitForAuthors(['Alice', 'Bob', 'Carol']);
  assert(JSON.stringify(await visibleAuthors()) === JSON.stringify(['Alice', 'Bob', 'Carol']),
    'Type ascending follows the displayed markup names');
  await headerAction('Type', 'descending').click();
  await waitForAuthors(['Bob', 'Alice', 'Carol']);
  assert(JSON.stringify(await visibleAuthors()) === JSON.stringify(['Bob', 'Alice', 'Carol']),
    'Type descending uses displayed markup type inside page groups');
  await page.getByRole('button', { name: 'Columns' }).click();
  const subjectMenu = page.getByRole('group', { name: 'Visible Markups List columns' });
  assert(!(await subjectMenu.getByRole('checkbox', { name: 'Subject' }).isChecked()),
    'Subject is available without crowding the default five-column layout');
  await subjectMenu.getByRole('checkbox', { name: 'Subject' }).check();
  await page.getByRole('button', { name: 'Columns' }).click();
  const subjectCells = await page.locator('.markups-dock .annotation-list-item .annotation-cell-subject').allInnerTexts();
  assert(JSON.stringify(subjectCells) === JSON.stringify(['Check load calculation', '', 'Update title block date']),
    'Subject displays markup metadata independently of the comment preview');
  await sortHeader('Subject').click();
  await waitForAuthors(['Alice', 'Bob', 'Carol']);
  await headerAction('Subject', 'descending').click();
  await waitForAuthors(['Bob', 'Alice', 'Carol']);
  assert(JSON.stringify(await visibleAuthors()) === JSON.stringify(['Bob', 'Alice', 'Carol']),
    'Subject sorts rows within their page groups');
  await page.getByRole('button', { name: 'Columns' }).click();
  await subjectMenu.getByRole('checkbox', { name: 'Subject' }).uncheck();
  await page.getByRole('button', { name: 'Columns' }).click();
  const selectionAfterSorting = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    return getActiveDocument()?.selectedAnnotation?.id;
  });
  assert(selectionAfterSorting === alice.id, 'column sorting leaves canvas selection intact');
  await headerAction('Page', 'ascending').focus();
  await page.keyboard.press('Enter');
  await waitForAuthors(['Alice', 'Bob', 'Carol']);
  assert((await headerAction('Page', 'descending').getAttribute('aria-pressed')) === 'true' &&
    (await page.locator('.markups-dock .annotations-sort-summary').innerText()).includes('Page ↑ across page groups'),
  'keyboard Enter sorts Page and updates the pressed state and visible direction');

  await page.evaluate(async () => {
    const store = await import('/js/solid/stores/panels/annotationsStore.js');
    const list = await import('/js/ui/panels/annotations-list.js');
    store.setSortMode('author');
    store.setFilterMode('current');
    list.updateAnnotationsList();
  });
  await waitForAuthors(['Alice', 'Bob']);
  assert((await page.locator('.markups-dock .annotations-list-page-header').allInnerTexts()).join('|').includes('Alice'),
    'Author grouping remains visible under the current-page filter');
  await headerAction('Status', 'ascending').click();
  await waitForAuthors(['Alice', 'Bob']);
  assert((await page.locator('.markups-dock .annotations-list-count').first().innerText()).includes('2 annotations'),
    'sorting preserves the current-page filter and its count');
  await page.evaluate(async () => {
    const store = await import('/js/solid/stores/panels/annotationsStore.js');
    const list = await import('/js/ui/panels/annotations-list.js');
    store.setSortMode('page');
    store.setFilterMode('all');
    list.updateAnnotationsList();
  });
  await waitForAuthors(['Alice', 'Bob', 'Carol']);

  const search = page.locator('.markups-dock .annotations-search');
  await search.fill('Carol Accepted');
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 1);
  assert((await page.locator('.markups-dock .annotation-cell-author').last().innerText()) === 'Carol',
    'search combines author and review status without changing the document selection');
  await search.fill('rebar');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('.markups-dock .annotation-list-item');
    return rows.length === 1 && rows[0].querySelector('.annotation-cell-author')?.textContent === 'Alice';
  });
  assert((await page.locator('.markups-dock .annotation-cell-author').last().innerText()) === 'Alice',
    'search finds comment text');
  await search.fill('no matching markup');
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 0);
  assert((await page.locator('.markups-dock .annotations-list-count').first().innerText()).includes('0 annotations'),
    'search shows an accurate zero-result count');
  await search.fill('');
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 3);
  assert((await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    return getActiveDocument()?.selectedAnnotation?.id;
  })) === alice.id, 'search does not clear the canvas selection');

  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('#pdf-container')?.getBoundingClientRect();
    const dock = document.querySelector('.markups-dock')?.getBoundingClientRect();
    return { canvasHeight: canvas?.height || 0, canvasBottom: canvas?.bottom || 0, dockTop: dock?.top || 0 };
  });
  assert(layout.canvasHeight > 200 && layout.dockTop >= layout.canvasBottom - 2, 'dock leaves a usable PDF viewport at 1280px width');
  await page.setViewportSize({ width: 1920, height: 1080 });
  const wideLayout = await page.evaluate(() => {
    const header = document.querySelector('.markups-dock .annotation-list-header');
    const row = document.querySelector('.markups-dock .annotation-list-item');
    const headerCells = [...header.querySelectorAll(':scope > .annotation-cell')];
    const rowCells = [...row.querySelectorAll(':scope > .annotation-cell')];
    return {
      aligned: headerCells.every((cell, index) => Math.abs(cell.getBoundingClientRect().x - rowCells[index].getBoundingClientRect().x) <= 1),
      canvasHeight: document.querySelector('#pdf-container')?.getBoundingClientRect().height || 0,
    };
  });
  assert(wideLayout.aligned && wideLayout.canvasHeight > 300, 'columns and PDF viewport remain usable at 1920px width');
  await page.getByRole('button', { name: 'Columns' }).click();
  const columnsMenu = page.getByRole('group', { name: 'Visible Markups List columns' });
  assert((await columnsMenu.getByRole('checkbox', { name: 'Type' }).isDisabled()),
    'Type remains visible so rows can always be identified');
  await columnsMenu.getByRole('checkbox', { name: 'Comment' }).uncheck();
  await columnsMenu.getByRole('checkbox', { name: 'Author' }).uncheck();
  const compactColumns = await page.evaluate(() => {
    const header = document.querySelector('.markups-dock .annotation-list-header');
    const row = document.querySelector('.markups-dock .annotation-list-item');
    const heads = [...header.querySelectorAll(':scope > .annotation-cell')];
    const cells = [...row.querySelectorAll(':scope > .annotation-cell')];
    return {
      names: heads.map(cell => cell.textContent.trim()),
      aligned: heads.length === cells.length && heads.every((cell, index) =>
        Math.abs(cell.getBoundingClientRect().x - cells[index].getBoundingClientRect().x) <= 1),
      rows: document.querySelectorAll('.markups-dock .annotation-list-item').length,
      stored: JSON.parse(localStorage.getItem('ocudraw.markups.visibleColumns.v1')),
    };
  });
  const normalizedColumns = names => names.map(name => name.replace(/[▲▼]/gu, '').trim().toLowerCase());
  assert(JSON.stringify(normalizedColumns(compactColumns.names)) === JSON.stringify(['page', 'type', 'status'])
    && compactColumns.aligned && compactColumns.rows === 3,
  'hidden columns leave three aligned headers and all markup rows');
  await columnsMenu.getByRole('checkbox', { name: 'Status' }).uncheck();
  assert((await page.locator('.markups-dock .annotations-sort-summary').count()) === 0,
    'hiding the active sort column clears its now invisible sort');
  await columnsMenu.getByRole('checkbox', { name: 'Status' }).check();
  assert(JSON.stringify(compactColumns.stored) === JSON.stringify(['page', 'type', 'status']),
    'visible column choices persist locally');
  const movePage = columnsMenu.getByRole('button', { name: 'Move Page right' });
  await movePage.focus();
  await page.keyboard.press('Enter');
  const reordered = await page.evaluate(() => {
    const header = document.querySelector('.markups-dock .annotation-list-header');
    const row = document.querySelector('.markups-dock .annotation-list-item');
    const heads = [...header.querySelectorAll(':scope > .annotation-cell')];
    const cells = [...row.querySelectorAll(':scope > .annotation-cell')];
    return {
      names: heads.map(cell => cell.textContent.trim().toLowerCase()),
      classes: cells.map(cell => [...cell.classList].find(name => name.startsWith('annotation-cell-'))),
      aligned: heads.every((cell, index) => Math.abs(cell.getBoundingClientRect().x - cells[index].getBoundingClientRect().x) <= 1),
      stored: JSON.parse(localStorage.getItem('ocudraw.markups.visibleColumns.v1')),
    };
  });
  assert(JSON.stringify(reordered.names) === JSON.stringify(['type', 'page', 'status'])
    && JSON.stringify(reordered.classes) === JSON.stringify(['annotation-cell-type', 'annotation-cell-page', 'annotation-cell-status'])
    && reordered.aligned && JSON.stringify(reordered.stored) === JSON.stringify(['type', 'page', 'status']),
  'keyboard column move reorders aligned headers and cells and persists the order');
  await page.getByRole('button', { name: 'Columns' }).click();
  await search.fill('Carol Accepted');
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 1);
  assert((await page.locator('.markups-dock .annotation-list-item').count()) === 1,
    'search still uses hidden author data');
  await search.fill('rebar');
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 1);
  assert((await page.locator('.markups-dock .annotation-list-item').count()) === 1,
    'search still uses hidden comment data');
  await search.fill('Check load calculation');
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 1);
  assert((await page.locator('.markups-dock .annotation-list-item .annotation-cell-type').count()) === 1,
    'search still uses hidden subject data');
  await search.fill('');
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(async bytesArr => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('markups-reopened.pdf');
    await loadPDF('markups-reopened.pdf', index, new Uint8Array(bytesArr));
  }, Array.from(fixtureBytes));
  if ((await page.getAttribute(DOCK_TOGGLE, 'aria-expanded')) === 'false') await page.click(DOCK_TOGGLE);
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 3);
  const reopenedColumns = await page.locator('.markups-dock .annotation-list-header > .annotation-cell').allInnerTexts();
  assert(JSON.stringify(normalizedColumns(reopenedColumns)) === JSON.stringify(['type', 'page', 'status']),
    'column choices and order restore after reopening the app');
  const firstRow = page.locator('.markups-dock .annotation-list-item').first();
  const secondRow = page.locator('.markups-dock .annotation-list-item').nth(1);
  await firstRow.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.markups-dock .annotation-list-item')?.getAttribute('aria-pressed') === 'true');
  assert((await firstRow.getAttribute('role')) === 'button' && (await firstRow.getAttribute('aria-pressed')) === 'true',
    'keyboard Enter selects a focusable markup row');
  await secondRow.focus();
  await page.keyboard.press('Control+Enter');
  const keyboardSelection = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    return getActiveDocument()?.selectedAnnotations?.length;
  });
  assert(keyboardSelection === 2, 'Ctrl+Enter adds a second markup to the selection');
  const firstGroup = page.locator('.markups-dock .annotations-list-page-header').first();
  await firstGroup.focus();
  await page.keyboard.press('Enter');
  assert((await firstGroup.getAttribute('aria-expanded')) === 'false' && (await page.locator('.markups-dock .annotation-list-item').count()) === 1,
    'keyboard Enter collapses a group');
  await page.keyboard.press('Space');
  assert((await firstGroup.getAttribute('aria-expanded')) === 'true' && (await page.locator('.markups-dock .annotation-list-item').count()) === 3,
    'keyboard Space expands a group');

  // Arrow keys follow only rendered rows and use the same PDF navigation as
  // a click. The lower page-2 fixture makes canvas centering measurable.
  await page.setViewportSize({ width: 1040, height: 800 });
  await page.evaluate(async () => (await import('/js/pdf/renderer.js')).setZoom(2));
  const currentIds = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    window.__keyboardGetDoc = getActiveDocument;
    return getActiveDocument().annotations.map(annotation => ({ id: annotation.id, author: annotation.author }));
  });
  const idFor = author => currentIds.find(annotation => annotation.author === author).id;
  const focusedMarkup = async (expectedId, expectedPage) => {
    await page.waitForFunction(({ id, pageNum }) => {
      const doc = window.__keyboardGetDoc();
      return doc?.selectedAnnotation?.id === id && doc.currentPage === pageNum &&
        document.activeElement?.dataset.annotationId === id;
    }, { id: expectedId, pageNum: expectedPage }, { timeout: 5000 });
  };
  await page.locator('.markups-dock .annotation-list-item').first().focus();
  await page.keyboard.press('ArrowDown');
  await focusedMarkup(idFor('Bob'), 1);
  await page.keyboard.press('ArrowDown');
  await focusedMarkup(idFor('Carol'), 2);
  await page.waitForFunction(() => {
    const doc = window.__keyboardGetDoc();
    const markup = doc?.selectedAnnotation;
    if (!markup) return false;
    const container = document.querySelector('#pdf-container').getBoundingClientRect();
    const canvas = document.querySelector('#pdf-canvas').getBoundingClientRect();
    return Math.abs(canvas.top + (markup.y + markup.height / 2) * doc.scale - (container.top + container.height / 2)) < 30;
  }, null, { timeout: 5000 });
  const centered = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const doc = getActiveDocument();
    const markup = doc.selectedAnnotation;
    const container = document.querySelector('#pdf-container').getBoundingClientRect();
    const canvas = document.querySelector('#pdf-canvas').getBoundingClientRect();
    return { selectedId: markup?.id || null, pageNum: doc.currentPage, scale: doc.scale,
      scrollTop: document.querySelector('#pdf-container').scrollTop,
      delta: markup ? Math.abs(canvas.top + (markup.y + markup.height / 2) * doc.scale - (container.top + container.height / 2)) : null,
      viewportHeight: container.height };
  });
  assert(centered.selectedId === idFor('Carol') &&
    centered.delta < 30 && centered.viewportHeight > 160,
    `ArrowDown selects page 2 and centers the markup in a usable 1040px viewport (${JSON.stringify(centered)})`);
  await page.keyboard.press('ArrowUp');
  await focusedMarkup(idFor('Bob'), 1);
  await page.locator('.markups-dock .annotation-list-item').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await focusedMarkup(idFor('Carol'), 2);
  await page.keyboard.press('ArrowDown');
  assert((await page.evaluate(() => window.__keyboardGetDoc().selectedAnnotation?.id)) === idFor('Carol'),
    'rapid arrows keep the last visible row selected and stop at the list boundary');
  await page.evaluate(async () => {
    const store = await import('/js/solid/stores/panels/annotationsStore.js');
    store.setSortMode('author');
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  });
  await page.locator('.markups-dock .annotations-list-page-header').filter({ hasText: 'Bob' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 2);
  await page.locator('.markups-dock .annotation-list-item').first().focus();
  await page.keyboard.press('ArrowDown');
  await focusedMarkup(idFor('Carol'), 2);
  assert((await page.locator('.markups-dock .annotation-list-item').count()) === 2,
    'ArrowDown skips a collapsed group and follows the visible sorted rows');
  await page.evaluate(async () => {
    const store = await import('/js/solid/stores/panels/annotationsStore.js');
    store.expandAllGroups();
    store.setSortMode('page');
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
    const renderer = await import('/js/pdf/renderer.js');
    await renderer.goToPage(1);
    await renderer.setZoom(1);
  });
  await page.setViewportSize({ width: 1920, height: 1080 });

  const filtersButton = page.getByRole('button', { name: 'Filters' });
  await page.evaluate(async () => {
    const store = await import('/js/solid/stores/panels/annotationsStore.js');
    store.setFilterMode('current');
    store.toggleHiddenStatus('accepted');
  });
  await search.fill('Bob');
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 1);
  await filtersButton.click();
  const filtersMenu = page.getByRole('group', { name: 'Saved Markups List filters' });
  await filtersMenu.getByRole('textbox', { name: 'Save current filter' }).fill('Open Bob reviews');
  await filtersMenu.getByRole('button', { name: 'Save', exact: true }).click();
  assert((await filtersMenu.getByRole('button', { name: 'Open Bob reviews', exact: true }).count()) === 1,
    'named filter is saved from the live Markups List');
  await filtersButton.click();
  await search.fill('');
  await page.evaluate(async () => {
    const store = await import('/js/solid/stores/panels/annotationsStore.js');
    store.setFilterMode('all');
    store.toggleHiddenStatus('accepted');
    (await import('/js/ui/panels/annotations-list.js')).updateAnnotationsList();
  });
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 3);
  await filtersButton.click();
  await filtersMenu.getByRole('button', { name: 'Open Bob reviews', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 1);
  const applied = await page.evaluate(async () => {
    const store = await import('/js/solid/stores/panels/annotationsStore.js');
    return { query: store.searchQuery(), pageScope: store.filterMode(), hidden: [...store.hiddenStatuses()],
      rows: document.querySelectorAll('.markups-dock .annotation-list-item').length };
  });
  assert(applied.query === 'Bob' && applied.pageScope === 'current' && applied.hidden.includes('accepted') && applied.rows === 1,
    'applying a named filter restores search, page scope, and status visibility');
  assert(JSON.parse(await page.evaluate(() => localStorage.getItem('ocudraw.markups.savedFilters.v1'))).length === 1,
    'named filter persists in local storage');
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(async bytesArr => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('markups-filter-reopened.pdf');
    await loadPDF('markups-filter-reopened.pdf', index, new Uint8Array(bytesArr));
  }, Array.from(fixtureBytes));
  if ((await page.getAttribute(DOCK_TOGGLE, 'aria-expanded')) === 'false') await page.click(DOCK_TOGGLE);
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 3);
  await filtersButton.click();
  assert((await filtersMenu.getByRole('button', { name: 'Open Bob reviews', exact: true }).count()) === 1,
    'saved filter is available after restarting the app');
  await filtersMenu.getByRole('button', { name: 'Open Bob reviews', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.markups-dock .annotation-list-item').length === 1);
  assert((await page.locator('.markups-dock .annotations-search').inputValue()) === 'Bob',
    'keyboard Enter reapplies a saved filter after restart');
  await filtersButton.click();
  await filtersMenu.getByRole('button', { name: 'Delete Open Bob reviews' }).click();
  assert((await filtersMenu.getByRole('button', { name: 'Open Bob reviews', exact: true }).count()) === 0 &&
    JSON.parse(await page.evaluate(() => localStorage.getItem('ocudraw.markups.savedFilters.v1'))).length === 0,
  'delete removes the named filter from the UI and local storage');
  if (process.env.OCULITH_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.OCULITH_SMOKE_SCREENSHOT });

  await page.click(DOCK_TOGGLE);
  assert((await page.getAttribute(DOCK_TOGGLE, 'aria-expanded')) === 'false', 'the » toggle collapses the list');
  await page.locator('.ws-access-bottom .ws-access-tab[data-panel="markupsList"]').click();
  assert((await page.getAttribute(DOCK_TOGGLE, 'aria-expanded')) === 'true', 'the access-bar tab reopens the same Markups List');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Alt+L');
  assert((await page.getAttribute(DOCK_TOGGLE, 'aria-expanded')) === 'false', 'Alt+L toggles the Markups List (collapse)');
  await page.keyboard.press('Alt+L');
  assert((await page.getAttribute(DOCK_TOGGLE, 'aria-expanded')) === 'true', 'Alt+L toggles the Markups List (expand)');
  if (failures) throw new Error(`${failures} Markups List smoke assertions failed`);
  console.log('Markups List dock smoke passed: columns, selection, status, viewport, toggle, access-bar tab and Alt+L');
} finally {
  await browser.close();
  await server.close();
}
