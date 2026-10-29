// The client of the pdf-lib worker (pdf-lib-worker.js) for one document.
//
// open() sends the file and resolves with the catalog fields. colors(page)
// resolves with that page's markup data. The worker can be stopped while
// the document stays open (idle, below): the next colors() starts a new one
// from the same bytes, and the catalog is not read again.
//
// A file opened by range (file-range.js) has no bytes in the page: getBytes
// then returns its range source, and the file goes to the worker in chunks,
// each transferred, so the page never holds the whole file.
//
// A worker that cannot start or crashes rejects with WorkerUnavailable, and
// from then on workersUsable() is false: the loader then reads in place, as
// it does where there are no workers at all (node tests).

let broken = false;

export class WorkerUnavailable extends Error {}

/** Can the open-time pdf-lib reads run in a worker here? */
export function workersUsable() {
  return !broken && typeof Worker !== 'undefined';
}

// An idle worker is stopped after this long without a request, once
// `canIdle(idleMs)` says the document no longer needs it: all sheets read,
// or nothing asked for so long that the parse it holds (most of a gigabyte
// on a large drawing) is not worth keeping for the next sheet.
const IDLE_MS = 20000;

// A range source (file-range.js) rather than the bytes themselves.
function isRangeReader(v) {
  return !!v && !(v instanceof Uint8Array) && typeof v.read === 'function' && Number.isFinite(v.length);
}

// The chunks a range source sends to the worker.
const STREAM_CHUNK_BYTES = 8 * 1024 * 1024;

export class PdfLibSession {
  /**
   * @param {() => Uint8Array|{length:number, read:Function}|null} getBytes  the document's file bytes (not copied by the caller), or its range source
   * @param {{ canIdle?: (idleMs: number) => boolean, onIdle?: () => void }} [opts]
   */
  constructor(getBytes, { canIdle = () => false, onIdle = () => {} } = {}) {
    this.getBytes = getBytes;
    this.canIdle = canIdle;
    this.onIdle = onIdle;
    this.worker = null;
    this.opening = null;   // Promise of the open answer for the running worker
    this.sent = null;      // Promise: the file is with the running worker
    this.pending = new Map();
    this.nextId = 1;
    this.idleTimer = null;
    this.lastRequestAt = 0;
    this.closed = false;
    this.closeWhenDone = false;
  }

  start() {
    if (this.worker) return this.worker;
    const bytes = this.getBytes();
    if (!bytes) throw new Error('No file bytes');
    let worker;
    try {
      worker = new Worker(new URL('./pdf-lib-worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      broken = true;
      throw new WorkerUnavailable(String(err?.message || err));
    }
    worker.onmessage = (e) => this.answer(e.data);
    worker.onerror = (e) => {
      e?.preventDefault?.();
      broken = true;
      this.fail(worker, new WorkerUnavailable(String(e?.message || 'pdf-lib worker failed')));
    };
    this.worker = worker;
    if (isRangeReader(bytes)) {
      this.sent = this.stream(worker, bytes);
      this.opening = this.sent.then(() => this.request('open', {}));
      this.sent.catch((err) => { if (this.worker === worker) this.fail(worker, err); });
    } else {
      // Its own copy: the cache keeps the original for the saver.
      const copy = bytes.slice();
      this.sent = Promise.resolve();
      this.opening = this.request('open', { bytes: copy.buffer }, [copy.buffer]);
    }
    // A failed open (a file pdf-lib cannot read) is the caller's to handle.
    this.opening.catch(() => {});
    return worker;
  }

  // The file from its range source to `worker`, chunk by chunk.
  async stream(worker, reader) {
    worker.postMessage({ op: 'begin', length: reader.length });
    for (let begin = 0; begin < reader.length; begin += STREAM_CHUNK_BYTES) {
      const end = Math.min(reader.length, begin + STREAM_CHUNK_BYTES);
      const chunk = await reader.read(begin, end);
      if (this.worker !== worker) throw new Error('pdf-lib worker stopped');
      const own = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength ? chunk : chunk.slice();
      worker.postMessage({ op: 'chunk', begin, bytes: own.buffer }, [own.buffer]);
    }
  }

  request(op, msg = {}, transfer = []) {
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, worker });
      worker.postMessage({ ...msg, id, op }, transfer);
    });
  }

  answer(data) {
    const p = this.pending.get(data?.id);
    if (!p) return;
    this.pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error)); else p.resolve(data.result);
    this.afterRequest();
  }

  fail(worker, err) {
    for (const [id, p] of this.pending) {
      if (p.worker !== worker) continue;
      this.pending.delete(id);
      p.reject(err);
    }
    if (this.worker === worker) this.stopWorker();
  }

  stopWorker() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const worker = this.worker;
    this.worker = null;
    this.opening = null;
    this.sent = null;
    if (worker) {
      worker.terminate();
      for (const [id, p] of this.pending) {
        if (p.worker !== worker) continue;
        this.pending.delete(id);
        p.reject(new Error('pdf-lib worker stopped'));
      }
    }
  }

  // After an answer: a close that waited for running requests, or the idle
  // check for a worker the document may no longer need.
  afterRequest() {
    if (this.pending.size) return;
    if (this.closeWhenDone) { this.close({ now: true }); return; }
    this.lastRequestAt = Date.now();
    this.armIdle();
  }

  armIdle() {
    clearTimeout(this.idleTimer);
    if (!this.worker || this.closed) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.worker || this.pending.size) return;
      if (!this.canIdle(Date.now() - this.lastRequestAt)) { this.armIdle(); return; }
      this.stopWorker();
      this.onIdle();
    }, IDLE_MS);
  }

  /** Parse the file in the worker; resolves with { catalog, parseMs, catalogMs }. */
  async open() {
    if (this.closed) throw new Error('pdf-lib session closed');
    this.start();
    return this.opening;
  }

  /**
   * One page's markup data: { colors: Map, snippets, imageSources, ms }, with
   * `withList` also { list, listMs } (pdf-lib-worker.js).
   */
  async colors(page, { withList = false, annotationKeys = [] } = {}) {
    if (this.closed) throw new Error('pdf-lib session closed');
    clearTimeout(this.idleTimer);
    this.start();
    // A file still on its way in chunks goes first.
    await this.sent;
    // The worker waits for its own parse (a failed one fails this too).
    return this.request('colors', { page, withList, annotationKeys });
  }

  /** The stamp sheet of `ids` on `page` (loader/stamp-sheet.js): { bytes, stamps } or null. */
  async stampSheet(page, ids) {
    if (this.closed) throw new Error('pdf-lib session closed');
    clearTimeout(this.idleTimer);
    this.start();
    await this.sent;
    return this.request('stampSheet', { page, ids });
  }

  /**
   * Stop the worker. By default requests already sent still get their answer
   * (a page load that started before a reset finishes as it would have);
   * `now` stops at once.
   */
  close({ now = false } = {}) {
    if (!now && this.pending.size) {
      this.closed = true;
      this.closeWhenDone = true;
      clearTimeout(this.idleTimer);
      return;
    }
    this.closed = true;
    this.closeWhenDone = false;
    this.stopWorker();
  }
}

/**
 * Forget a document's open-time pdf-lib reads (a reset, new bytes, a close):
 * its worker, its catalog fields and a parse kept on the main thread. The
 * next read starts over from the cached bytes. `now` also stops requests
 * already sent; otherwise they still get their answer.
 */
export function forgetPdfLibReads(doc, { now = false } = {}) {
  if (!doc) return;
  const source = doc._pdfLibSource;
  doc._pdfLibSource = null;
  source?.session?.close({ now });
  doc._sharedPdfLibDoc = null;
  doc._sharedPdfLibDocPromise = null;
}
