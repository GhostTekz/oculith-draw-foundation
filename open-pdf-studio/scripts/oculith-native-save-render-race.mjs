// Run through run-native-markup-smoke.mjs against a debug desktop binary.
// Holds one real PDFium IPC response across an in-place save in each view.
import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdtemp, readFile, readdir, readlink, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';

const port = Number(process.argv[2] || 9323);
const endpoint = `http://127.0.0.1:${port}/mcp`;
const invalidationFailure = process.env.OCUDRAW_RACE_INVALIDATION_FAILURE === '1';
const realWorkerFailure = process.env.OCUDRAW_RACE_REAL_WORKER_FAILURE === '1';
const expectFailure = invalidationFailure || realWorkerFailure;
const metadataIdentical = process.env.OCUDRAW_RACE_METADATA_IDENTICAL === '1' || expectFailure;
const selectedMode = process.env.OCUDRAW_RACE_MODE || (realWorkerFailure ? 'single' : null);
const fixedMtimeSeconds = 1_700_000_000;
let requestId = 0;

async function call(name, args = {}) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call',
      params: { name, arguments: args } }),
  });
  assert.equal(response.status, 200, `${name}: HTTP status`);
  const body = await response.json();
  assert.equal(body.error, undefined, `${name}: ${JSON.stringify(body.error)}`);
  const result = JSON.parse(body.result.content.find(item => item.type === 'text').text);
  assert.notEqual(result.ok, false, `${name}: ${JSON.stringify(result)}`);
  return result;
}

async function renderedPage(path, width) {
  const result = await call('screenshot_page', { path, page_index: 0, width });
  const { data, info } = await sharp(Buffer.from(result.png_base64, 'base64'))
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.channels, 3);
  return { data, width: info.width, height: info.height };
}

function colorAt(image, x, y) {
  const offset = (y * image.width + x) * 3;
  return [...image.data.subarray(offset, offset + 3)];
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function uniformAt(image, x, y, center) {
  for (const dy of [-2, 0, 2]) for (const dx of [-2, 0, 2]) {
    if (colorDistance(center, colorAt(image, x + dx, y + dy)) > 25) return false;
  }
  return true;
}

function contentMarkers(oldImage, newImage, mode, viewportState) {
  assert.equal(oldImage.width, newImage.width);
  assert.equal(oldImage.height, newImage.height);
  const viewport = viewportState.viewport;
  const canvas = viewportState.canvas;
  const visible = (x, y) => {
    if (mode === 'continuous') return true; // Sample the page's own canvas.
    const sx = viewport.offsetX + x * viewport.zoom;
    const sy = viewport.offsetY + y * viewport.zoom;
    return sx > 12 && sy > 12 && sx < canvas.cssWidth - 12 && sy < canvas.cssHeight - 12;
  };
  const points = [];
  for (let y = 3; y < oldImage.height - 3; y += 3) {
    for (let x = 3; x < oldImage.width - 3; x += 3) {
      if (!visible(x, y) || points.some(point => Math.abs(point.x - x) < 9 && Math.abs(point.y - y) < 9)) continue;
      const oldColor = colorAt(oldImage, x, y);
      const newColor = colorAt(newImage, x, y);
      // At least one reference must be solid black text. A red-to-white
      // cover rectangle alone would prove only that the page was repainted.
      const glyphStroke = color => color.every(channel => channel < 90);
      if (colorDistance(oldColor, newColor) < 140
          || (!glyphStroke(oldColor) && !glyphStroke(newColor))
          || !uniformAt(oldImage, x, y, oldColor)
          || !uniformAt(newImage, x, y, newColor)) continue;
      points.push({ x, y, oldColor, newColor });
      if (points.length === 24) return points;
    }
  }
  return points;
}

async function contentMatch(markers) {
  const result = await call('app_render_race_diagnostic', {
    action: 'page-pixels', points: markers.map(({ x, y }) => ({ x, y })),
  });
  assert.equal(result.samples.length, markers.length);
  let fresh = 0;
  let stale = 0;
  for (let i = 0; i < markers.length; i++) {
    const pixel = result.samples[i];
    if (!pixel) continue;
    const oldDistance = colorDistance(pixel, markers[i].oldColor);
    const newDistance = colorDistance(pixel, markers[i].newColor);
    if (newDistance < 75 && newDistance + 50 < oldDistance) fresh++;
    if (oldDistance < 75 && oldDistance + 50 < newDistance) stale++;
  }
  return { fresh, stale, total: markers.length };
}

function assertFreshContent(match, mode, phase) {
  assert.ok(match.fresh >= Math.ceil(match.total * 0.7),
    `${mode}: ${phase} canvas did not show saved glyph pixels: ${JSON.stringify(match)}`);
  assert.ok(match.stale <= Math.floor(match.total * 0.15),
    `${mode}: ${phase} canvas showed old glyph pixels: ${JSON.stringify(match)}`);
}

async function waitFor(label, read, accept, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

async function waitForStableDigest(label, args, excluded) {
  let last = null;
  let same = 0;
  return waitFor(label, async () => {
    const result = await call('app_render_race_diagnostic', { action: 'pixel', ...args });
    same = result.redFraction > 0.1 && result.digest !== excluded && result.digest === last ? same + 1 : 0;
    last = result.digest;
    return { ...result, stable: same >= 4 };
  }, result => result.stable, 20_000);
}

// Scope the fault to the four PDFium children of this smoke's desktop app.
// The host can have other OcuDraw worktrees running native tests in parallel.
async function desktopWorkerPids() {
  assert.equal(process.platform, 'linux', 'real worker fault requires Linux /proc');
  const root = Number(process.env.OCUDRAW_NATIVE_APP_PID);
  assert.ok(Number.isInteger(root) && root > 0, 'native smoke did not pass its app PID');
  const seen = new Set();
  const pending = [root];
  const workers = [];
  while (pending.length) {
    const pid = pending.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const exe = await readlink(`/proc/${pid}/exe`).catch(() => null);
    if (exe && basename(exe) === 'pdfium-worker') workers.push(pid);
    // Workers are spawned by a Tokio runtime thread. Linux records children
    // under that thread's task entry, not necessarily the process leader's.
    const tasks = await readdir(`/proc/${pid}/task`).catch(() => []);
    for (const task of tasks) {
      const children = await readFile(`/proc/${pid}/task/${task}/children`, 'utf8').catch(() => '');
      pending.push(...children.trim().split(/\s+/).filter(Boolean).map(Number));
    }
  }
  return workers.sort((a, b) => a - b);
}

async function killDesktopWorkers() {
  const workers = await waitFor('four live desktop PDFium workers',
    desktopWorkerPids, pids => pids.length === 4, 10_000);
  for (const pid of workers) {
    const exe = await readlink(`/proc/${pid}/exe`);
    assert.equal(basename(exe), 'pdfium-worker', `PID ${pid} changed before worker fault`);
    process.kill(pid, 'SIGKILL');
  }
  await waitFor('killed PDFium workers to exit', async () => Promise.all(workers.map(async pid =>
    !await readlink(`/proc/${pid}/exe`).catch(() => null))), exited => exited.every(Boolean), 5_000);
  return workers;
}

async function waitForWorkerRespawn(killed) {
  return waitFor('PDFium worker pool to respawn', desktopWorkerPids,
    pids => pids.length === 4 && pids.every(pid => !killed.includes(pid)), 15_000);
}

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-native-save-render-'));
try {
  for (const { mode, command, zoom, sampleY } of [
    { mode: 'single', command: 'render_pdf_page', zoom: 1.25, sampleY: 0.5 },
    { mode: 'continuous', command: 'render_pdf_page', zoom: 1.25, sampleY: 0.16 },
    { mode: 'zoom-tile', command: 'render_pdf_page_region', zoom: 7, sampleY: 0.5 },
  ].filter(entry => !selectedMode || entry.mode === selectedMode)) {
    const path = join(directory, `${mode}.pdf`);
    const pageWidth = mode === 'zoom-tile' ? 1200 : 400;
    const pageHeight = mode === 'zoom-tile' ? 900 : 300;
    const red = await sharp({ create: { width: pageWidth, height: pageHeight, channels: 4,
      background: { r: 220, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(red);
    for (let i = 0; i < 3; i++) {
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      if (i === 0) page.drawText(metadataIdentical ? 'NEW' : 'OLD', {
        x: pageWidth * (metadataIdentical ? 0.05 : 0.25),
        y: pageHeight * (metadataIdentical ? 0.05 : 0.35),
        size: pageHeight * 0.26, color: rgb(0, 0, 0) });
    }
    const sourceBytes = Buffer.from(await pdf.save());
    // Extra trailing PDF whitespace lets the real Save action produce a
    // shorter file. While native invalidation is paused below, restore the
    // original length without changing any rendered content.
    await writeFile(path, metadataIdentical
      ? Buffer.concat([sourceBytes, Buffer.alloc(512 * 1024, 0x20)]) : sourceBytes);
    if (metadataIdentical) await utimes(path, fixedMtimeSeconds, fixedMtimeSeconds);
    const beforeStat = await stat(path, { bigint: true });
    // Start the draw counter before the initial page paint. Continuous view
    // can finish its first render before the later pixel sample otherwise.
    await call('app_render_race_diagnostic', { action: 'status', path });
    await call('app_open_pdf', { path });
    await call('app_set_view_mode', { mode: mode === 'continuous' ? 'continuous' : 'single' });
    await call('app_set_zoom', { scale: mode === 'zoom-tile' ? 6 : 1 });

    // A flattened vector snippet changes page content while preserving the
    // current source path. The raw PDF canvas excludes annotation overlays.
    if (metadataIdentical) {
      await call('app_snippet_cut', { x: pageWidth * 0.03, y: pageHeight * 0.62,
        width: pageWidth * 0.43, height: pageHeight * 0.34, page: 1 });
      const pasted = await call('app_snippet_paste', {
        x: pageWidth * 0.37, y: pageHeight * 0.32, page: 1 });
      await call('app_snippet_flatten', { id: pasted.annotationId });
    } else {
      const spans = await call('app_get_page_text', { page: 1 });
      const span = spans.spans?.find(item => item.text?.includes('OLD'));
      assert.ok(span, `${mode}: source text span missing: ${JSON.stringify(spans)}`);
      await call('app_replace_text', { spanId: span.id, expectedText: span.text, newText: 'NEW' });
    }
    const oldImage = await renderedPage(path, pageWidth);
    const before = await call('app_render_race_diagnostic', { action: 'pixel', x: 0.5, y: sampleY });
    await call('app_clear_caches');
    await call('app_render_race_diagnostic', { action: 'arm', path, command,
      holdInvalidation: metadataIdentical, failInvalidation: invalidationFailure });
    const requested = call('app_set_zoom', { scale: zoom });
    requested.catch(() => {}); // Keep the concurrent request observed until we await it below.
    let saving = null;
    let killedWorkers = [];
    try {
      await waitFor(`${mode} native response`,
        () => call('app_render_race_diagnostic', { action: 'status', path }),
        status => status.held);
      saving = call('app_save_pdf');
      saving.catch(() => {});
      if (metadataIdentical) {
        await waitFor(`${mode} native invalidation barrier`,
          () => call('app_render_race_diagnostic', { action: 'status', path }),
          status => status.invalidationHeld);
        const written = await stat(path, { bigint: true });
        assert.ok(written.size < beforeStat.size,
          `${mode}: saved PDF exceeded padded fixture size: ${written.size} >= ${beforeStat.size}`);
        await appendFile(path, Buffer.alloc(Number(beforeStat.size - written.size), 0x20));
        await utimes(path, fixedMtimeSeconds, fixedMtimeSeconds);
        const staged = await stat(path, { bigint: true });
        assert.equal(staged.size, beforeStat.size, `${mode}: size changed before invalidation`);
        assert.equal(staged.mtimeNs, beforeStat.mtimeNs,
          `${mode}: mtime changed before invalidation`);
        if (realWorkerFailure) killedWorkers = await killDesktopWorkers();
        await call('app_render_race_diagnostic', { action: 'release-invalidation' });
      }
      const saveResult = await saving;
      if (metadataIdentical) assert.equal(saveResult.path, path,
        `${mode}: Save moved the live document away from the source path`);
      const savedStat = await stat(path, { bigint: true });
      if (metadataIdentical) {
        assert.equal(savedStat.size, beforeStat.size, `${mode}: save changed source size`);
        assert.equal(savedStat.mtimeNs, beforeStat.mtimeNs, `${mode}: save changed source mtime`);
      } else {
        assert.notEqual(savedStat.size, beforeStat.size, `${mode}: in-place save did not rewrite content`);
      }
      const during = await call('app_render_race_diagnostic', { action: 'status', path });
      assert.ok(during.sourceRevision >= 2, `${mode}: save did not advance source revision`);
      assert.equal(during.sourceWriteActive, false);
      if (expectFailure) {
        assert.equal(during.invalidationFailed, invalidationFailure,
          `${mode}: unexpected synthetic invalidation fault state`);
        if (realWorkerFailure) {
          assert.equal(killedWorkers.length, 4, `${mode}: no real workers were terminated`);
          assert.match(during.nativeInvalidationError || '', /PDFium worker cache invalidation/i,
            `${mode}: killed workers did not cause a native invalidation error`);
        }
        const warning = await waitFor(`${mode} saved-view warning`,
          () => call('app_ui_state', { selector: '.message-dialog-body', searchTabs: false }),
          state => state.found && state.visible && /could not refresh/i.test(state.text));
        const warningFocus = await call('app_render_race_diagnostic', { action: 'status', path });
        assert.equal(warningFocus.messageDialogFocused, true,
          `${mode}: save-refresh warning opened without keyboard focus inside the dialog`);
        // The failed worker invalidation can leave its path-keyed document
        // stale. Render an exact byte copy through an unseen path for the NEW
        // reference, so the assertion cannot inherit that stale cache.
        const newReferencePath = join(directory, `${mode}-saved-reference.pdf`);
        await copyFile(path, newReferencePath);
        const newImage = await renderedPage(newReferencePath, pageWidth);
        const viewState = await call('app_get_viewport_state');
        assert.equal(viewState.doc.filePath, path,
          `${mode}: failed refresh moved the live document from its source path`);
        const markers = contentMarkers(oldImage, newImage, mode, viewState);
        assert.ok(markers.length >= 8,
          `${mode}: fewer than eight visible OLD/NEW PDFium glyph markers: ${markers.length}`);
        const prior = await contentMatch(markers);
        const priorCanvas = await call('app_render_race_diagnostic', { action: 'pixel', x: 0.5, y: sampleY });
        assert.ok(Number.isInteger(priorCanvas.canvasId) && Number.isInteger(priorCanvas.drawCount),
          `${mode}: PDF canvas draw probe was unavailable`);
        assert.ok(priorCanvas.drawCount > 0,
          `${mode}: draw probe never observed a live PDF bitmap publication`);
        await call('app_render_race_diagnostic', { action: 'release' });
        for (let i = 0; i < 8; i++) {
          const current = await contentMatch(markers);
          const canvas = await call('app_render_race_diagnostic', { action: 'pixel', x: 0.5, y: sampleY });
          // OLD pixels can already be present before release (especially in
          // continuous view), so an identical late draw would evade the
          // content and digest checks. Count actual bitmap draws as well.
          assert.equal(canvas.canvasId, priorCanvas.canvasId,
            `${mode}: PDF canvas was replaced after failed invalidation`);
          assert.equal(canvas.drawCount, priorCanvas.drawCount,
            `${mode}: held stale response drew onto the PDF canvas`);
          if (current.fresh >= Math.ceil(markers.length * 0.7)) {
            assertFreshContent(current, mode, 'after failed invalidation');
          } else {
            assert.ok(current.stale <= prior.stale,
              `${mode}: held stale bitmap appeared after failed invalidation: ${JSON.stringify({ prior, current })}`);
            assert.equal(canvas.digest, priorCanvas.digest,
              `${mode}: held stale response repainted after failed invalidation`);
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        await requested;
        await new Promise(resolve => setTimeout(resolve, 200));
        const settled = await contentMatch(markers);
        const settledCanvas = await call('app_render_race_diagnostic', { action: 'pixel', x: 0.5, y: sampleY });
        assert.equal(settledCanvas.canvasId, priorCanvas.canvasId,
          `${mode}: PDF canvas was replaced during response settling`);
        assert.equal(settledCanvas.drawCount, priorCanvas.drawCount,
          `${mode}: held stale response drew after polling ended`);
        if (settled.fresh >= Math.ceil(markers.length * 0.7)) assertFreshContent(settled, mode, 'settled');
        else assert.ok(settled.stale <= prior.stale,
          `${mode}: old glyph pixels increased after release: ${JSON.stringify({ prior, settled })}`);
        const stillWarned = await call('app_ui_state', {
          selector: '.message-dialog-body', searchTabs: false });
        assert.equal(stillWarned.visible, true, `${mode}: save-refresh warning disappeared`);
        await call('app_click_element', {
          selector: '.message-dialog-footer button', searchTabs: false });
        const dismissed = await call('app_ui_state', {
          selector: '.message-dialog-body', searchTabs: false });
        assert.equal(dismissed.found, false, `${mode}: refresh warning did not close`);
        if (realWorkerFailure) {
          const respawned = await waitForWorkerRespawn(killedWorkers);
          const tabs = await call('app_list_tabs');
          assert.equal(tabs.tabs[tabs.activeIndex]?.filePath, path,
            `${mode}: source document was not the active tab before reopen`);
          await call('app_close_tab', { index: tabs.activeIndex, force: true });
          const reopened = await call('app_open_pdf', { path });
          assert.equal(reopened.file_path, path, `${mode}: reopen used another source path`);
          await call('app_set_view_mode', { mode: mode === 'continuous' ? 'continuous' : 'single' });
          await call('app_set_zoom', { scale: zoom });
          const reopenedView = await call('app_get_viewport_state');
          assert.equal(reopenedView.doc.filePath, path,
            `${mode}: reopened view did not use the rewritten source`);
          const reopenedMarkers = contentMarkers(oldImage, newImage, mode, reopenedView);
          assert.ok(reopenedMarkers.length >= 8,
            `${mode}: reopened view lacks visible OLD/NEW glyph markers`);
          const recovered = await waitFor(`${mode} fresh glyph pixels after reopen`,
            () => contentMatch(reopenedMarkers),
            match => match.fresh >= Math.ceil(match.total * 0.7)
              && match.stale <= Math.floor(match.total * 0.15), 20_000);
          assertFreshContent(recovered, mode, 'reopened');
          for (let i = 0; i < 8; i++) {
            assertFreshContent(await contentMatch(reopenedMarkers), mode, 'reopened settling');
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (mode === 'zoom-tile') {
            await waitFor('reopened zoom tile',
              () => call('app_render_race_diagnostic', { action: 'pixel', x: 0.5, y: sampleY }),
              canvas => canvas.hasTile, 20_000);
          }
          console.log(`${mode}: real worker invalidation failure, ${killedWorkers.length} killed and ${respawned.length} respawned; focused warning and no held response draw ${priorCanvas.drawCount}->${settledCanvas.drawCount}; reopened NEW glyphs ${recovered.fresh}/${reopenedMarkers.length}`);
        } else {
          console.log(`${mode}: failed native invalidation after same-path Save; visible warning, ${markers.length} glyph markers; before release NEW/OLD ${prior.fresh}/${prior.stale}, settled NEW/OLD ${settled.fresh}/${settled.stale}, canvas draws ${priorCanvas.drawCount}->${settledCanvas.drawCount}`);
        }
        continue;
      }
      if (mode === 'zoom-tile') {
        // Text replacement reloads a working copy and resets zoom. The
        // same-path snippet save needs a changed zoom to request a fresh tile.
        if (metadataIdentical) await call('app_set_zoom', { scale: zoom - 0.5 });
        await call('app_set_zoom', { scale: zoom });
        await waitFor('fresh zoom tile while old response held',
          () => call('app_render_race_diagnostic', { action: 'pixel', x: 0.5, y: sampleY }),
          result => result.hasTile, 20_000).catch(async error => {
            const state = await call('app_get_viewport_state');
            throw new Error(`${error.message}; viewport: ${JSON.stringify(state)}`);
          });
      }
      const newImage = await renderedPage(path, pageWidth);
      const viewState = await call('app_get_viewport_state');
      if (metadataIdentical) assert.equal(viewState.doc.filePath, path,
        `${mode}: refreshed live document moved away from the rewritten source path`);
      const markers = contentMarkers(oldImage, newImage, mode, viewState);
      assert.ok(markers.length >= 8,
        `${mode}: fewer than eight visible OLD/NEW PDFium glyph markers: ${markers.length}`);
      const freshWhileHeld = await waitFor(`${mode} saved glyph pixels while old response held`,
        () => contentMatch(markers),
        match => match.fresh >= Math.ceil(match.total * 0.7) && match.stale <= Math.floor(match.total * 0.15),
        20_000).catch(async error => {
          const state = await call('app_get_viewport_state');
          const samples = await call('app_render_race_diagnostic', {
            action: 'page-pixels', points: markers.slice(0, 4).map(({ x, y }) => ({ x, y })),
          });
          throw new Error(`${error.message}; state: ${JSON.stringify(state)}; markers: ${JSON.stringify(markers.slice(0, 4))}; samples: ${JSON.stringify(samples)}`);
        });
      assertFreshContent(freshWhileHeld, mode, 'held');
      const after = await waitForStableDigest(`${mode} fresh PDF canvas while old response held`,
        { x: 0.5, y: sampleY }, before.digest);
      assert.ok(after.redFraction > 0.1,
        `${mode}: refreshed PDF canvas is blank: ${JSON.stringify(after)}`);
      if (!metadataIdentical) {
        const text = await call('app_get_page_text', { page: 1 });
        assert.ok(text.spans.some(item => item.text.includes('NEW')),
          `${mode}: saved text did not reach the live document`);
      }
      await call('app_render_race_diagnostic', { action: 'release' });
      for (let i = 0; i < 8; i++) {
        assertFreshContent(await contentMatch(markers), mode, 'after release');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await requested;
      await new Promise(resolve => setTimeout(resolve, 250));
      const settled = await call('app_render_race_diagnostic', { action: 'pixel', x: 0.5, y: sampleY });
      assert.equal(settled.digest, after.digest, `${mode}: held old response repainted the canvas`);
      const settledMatch = await contentMatch(markers);
      assertFreshContent(settledMatch, mode, 'settled');
      if (mode === 'zoom-tile') assert.equal(settled.hasTile, true,
        'held old response removed the fresh zoom tile');
      console.log(`${mode}: held ${command} across ${metadataIdentical ? 'equal-size/equal-mtime ' : ''}in-place save, revision ${during.sourceRevision}; NEW glyph pixels ${freshWhileHeld.fresh}/${markers.length} held, ${settledMatch.fresh}/${markers.length} settled`);
    } finally {
      await call('app_render_race_diagnostic', { action: 'cancel' }).catch(() => {});
      await saving?.catch(() => {});
      await requested.catch(() => {});
    }
  }
} finally {
  if (!process.env.OCUDRAW_KEEP_ACCEPTANCE_ARTIFACTS) {
    await rm(directory, { recursive: true, force: true });
  } else {
    console.log(`Native save/render artifacts: ${directory}`);
  }
}
