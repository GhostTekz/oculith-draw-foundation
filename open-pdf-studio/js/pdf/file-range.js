// A large PDF read by byte range instead of whole at open.
//
// FileRangeSource holds one native handle on the file (file_range_open), so
// every range belongs to the version that was opened. PDF.js reads through
// it (rangeTransport), and the readers that need the whole file read it in
// chunks (readAll), never in one call that holds the page.
//
// The file written in place on disk fails the next read with
// file-changed-on-disk instead of mixing two versions. The editor's own save
// replaces the file: it hands the source the bytes it saved from (adopt),
// which then serves the opened version from memory and lets the handle go.
//
// Timings (perf.js): file.rangeRead per read, file.rangeReadMB with the
// megabytes of each read as its value (count x mean = total), and
// file.readAll per whole-file read.

import { invoke } from '../core/platform.js';
import { perfRecord } from '../core/perf.js';

export const CHANGED_ON_DISK = 'file-changed-on-disk';
// PDF.js asks in these units; one IPC call per run of missing chunks.
export const RANGE_CHUNK_BYTES = 512 * 1024;
// One whole-file read goes in calls of this size.
export const READ_ALL_CHUNK_BYTES = 8 * 1024 * 1024;
// The longest single read call (the native side refuses more than 64 MB).
const MAX_CALL_BYTES = 32 * 1024 * 1024;

const failureListeners = new Set();

/** `fn(source, error)` when a source first fails because the file changed. */
export function onRangeSourceFailed(fn) {
  failureListeners.add(fn);
  return () => failureListeners.delete(fn);
}

export class FileRangeSource {
  /** Open `path` for range reads (inside the filesystem scope). */
  static async open(path) {
    const { id, length } = await invoke('file_range_open', { path });
    return new FileRangeSource(path, id, length);
  }

  constructor(path, id, length) {
    this.path = path;
    this.id = id;
    this.length = length;
    this.memory = null;  // the opened version, after adopt()
    this.failed = null;  // the error once the file changed on disk
  }

  /** Bytes [begin, end) of the opened version: a Uint8Array the caller owns. */
  async read(begin, end) {
    if (this.memory) return this.memory.slice(begin, end);
    // PDF.js joins neighbouring missing chunks into one request: a long one
    // (a large image) goes in calls the native side accepts.
    if (end - begin > MAX_CALL_BYTES) {
      const out = new Uint8Array(end - begin);
      for (let at = begin; at < end; at += MAX_CALL_BYTES) {
        const stop = Math.min(end, at + MAX_CALL_BYTES);
        out.set(await this.read(at, stop), at - begin);
      }
      return out;
    }
    if (this.failed) throw this.failed;
    if (this.id == null) throw new Error('The file range source is closed');
    const t0 = performance.now();
    let data;
    try {
      data = await invoke('file_range_read', { id: this.id, begin, end });
    } catch (e) {
      // adopt() during the read: memory has the same version.
      if (this.memory) return this.memory.slice(begin, end);
      const message = String(e?.message ?? e);
      if (message.includes(CHANGED_ON_DISK)) this.fail();
      throw this.failed || new Error(message);
    }
    perfRecord('file.rangeRead', performance.now() - t0);
    perfRecord('file.rangeReadMB', (end - begin) / (1024 * 1024));
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  /** The whole opened version, read in chunks so no single call holds the page. */
  async readAll() {
    if (this.memory) return this.memory.slice();
    const t0 = performance.now();
    const out = new Uint8Array(this.length);
    for (const [begin, end] of chunkRanges(this.length, READ_ALL_CHUNK_BYTES)) {
      out.set(await this.read(begin, end), begin);
    }
    perfRecord('file.readAll', performance.now() - t0);
    return out;
  }

  /**
   * `bytes` is this version (the saver read it through readAll): serve it
   * from memory and release the handle, so the file can be replaced.
   */
  async adopt(bytes) {
    if (!bytes || bytes.length !== this.length) return false;
    this.memory = bytes;
    await this.close();
    return true;
  }

  fail() {
    if (this.failed) return;
    this.failed = new Error(`${CHANGED_ON_DISK}: ${this.path}`);
    this.failed.code = CHANGED_ON_DISK;
    for (const fn of failureListeners) {
      try { fn(this, this.failed); } catch { /* a listener's own error */ }
    }
  }

  /** Release the native handle. A source with adopted bytes still reads. */
  async close() {
    const id = this.id;
    this.id = null;
    if (id == null) return;
    try { await invoke('file_range_close', { id }); } catch { /* already gone */ }
  }
}

/** [begin, end) pairs covering `length` bytes in steps of `size`. */
export function chunkRanges(length, size) {
  const out = [];
  for (let begin = 0; begin < length; begin += size) out.push([begin, Math.min(length, begin + size)]);
  return out;
}

/** A PDFDataRangeTransport (of `pdfjsLib`) that reads from `source`. */
export function createRangeTransport(pdfjsLib, source, initialData = null) {
  class SourceTransport extends pdfjsLib.PDFDataRangeTransport {
    requestDataRange(begin, end) {
      source.read(begin, end).then((chunk) => {
        if (this.aborted) return;
        try { this.onDataRange(begin, chunk); } catch { /* the reader was cancelled meanwhile */ }
      }, (e) => {
        if (!this.aborted) console.error(`[file-range] read ${begin}-${end} failed:`, e?.message ?? e);
      });
    }
    abort() { this.aborted = true; }
  }
  return new SourceTransport(source.length, initialData);
}
