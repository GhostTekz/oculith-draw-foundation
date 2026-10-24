// A batch operation (ops.js) as a runner job (runner.js): each file is read,
// changed in memory and written as a whole, before the next file starts.
//
// Output:
//  - 'folder' (the default): `<name><suffix>.pdf` in the chosen folder (the
//    browser downloads it). A name that is a source or an existing file gets
//    " (2)", " (3)", … (writeBatchOutputs), so a source is never overwritten.
//  - 'inPlace': the source itself, written atomically. Only after an explicit
//    confirm in the dialog, only on the desktop, and never for a file that is
//    open in a tab (its unsaved state would be lost or overwrite the result).
//
// Cancel: the signal is checked after the op and right before the write; a
// file whose write did not start has no output. Files finished before the
// cancel keep theirs, and the log says which they are.

import { BATCH_OPS, NO_OUTPUT_OPS, MULTI_OUTPUT_OPS, BatchOpError, suffixedName } from './ops.js';
import { writeBatchOutputs, throwIfCancelled } from './runner.js';

export const OUTPUT_MODES = Object.freeze(['folder', 'inPlace']);

const pathKey = (path) => String(path ?? '').replace(/\\/g, '/').toLocaleLowerCase();

/**
 * @param {object} options
 * @param {string} options.op  one of BATCH_OP_IDS
 * @param {object} [options.options]  the op's options
 * @param {object} [options.context]  pdfjs, pdfjsOptions, now, user, ocrPage, ocrFontBytes, spool, toJpeg
 * @param {{ mode?: 'folder'|'inPlace', dir?: string, suffix?: string }} [options.output]
 * @param {(path:string, bytes:Uint8Array) => Promise<void>} [options.write]
 * @param {(path:string) => Promise<boolean>} [options.exists]
 * @param {string[]} [options.sources]  every source path of the run
 * @param {string[]} [options.openPaths]  files open in a tab (refused for in-place)
 * @param {(file:object, path:string) => void} [options.onWritten]  after each completed write
 *   (a file written while a cancel arrives still shows as written)
 */
export function batchOpJob({ op, options = {}, context = {}, output = {}, write, exists = async () => false, sources = [], openPaths = [], onWritten = () => {} } = {}) {
  const apply = BATCH_OPS[op];
  if (typeof apply !== 'function') throw new Error(`Unknown batch operation: ${op}`);
  const writes = !NO_OUTPUT_OPS.has(op);
  const mode = output.mode === 'inPlace' ? 'inPlace' : 'folder';
  if (writes && typeof write !== 'function') throw new Error('batchOpJob needs write.');
  const open = new Set((openPaths || []).map(pathKey));
  return {
    id: op,
    async processFile(file, { signal }) {
      if (writes && mode === 'inPlace' && open.has(pathKey(file.path))) throw new BatchOpError('openInTab');
      if (mode === 'inPlace' && MULTI_OUTPUT_OPS.has(op)) throw new BatchOpError('noInPlace');
      const result = await apply(file, { ...context, options, signal });
      throwIfCancelled(signal);
      if (result.outputs?.length) {
        // Several files per source: all are built before the first is
        // written, and once writing starts the file's parts are all written.
        const stem = suffixedName(file.name, output.suffix).replace(/\.pdf$/iu, '');
        throwIfCancelled(signal);
        const paths = await writeBatchOutputs(result.outputs.map((o) => ({ name: `${stem}${o.part}.pdf`, bytes: o.bytes })), {
          dir: output.dir || '', sources, exists,
          write: async (path, bytes) => { await write(path, bytes); onWritten(file, path); },
        });
        return { ...result, outputs: null, written: paths[0], writtenAll: paths };
      }
      if (!writes || !result.bytes) return { ...result, written: null };
      let written;
      if (mode === 'inPlace') {
        throwIfCancelled(signal);
        await write(file.path, result.bytes);
        written = file.path;
        onWritten(file, written);
      } else {
        [written] = await writeBatchOutputs([{ name: suffixedName(file.name, output.suffix), bytes: result.bytes }], {
          dir: output.dir || '', sources, exists,
          write: async (path, bytes) => { throwIfCancelled(signal); await write(path, bytes); onWritten(file, path); },
        });
      }
      return { ...result, bytes: null, written };
    },
    describe: (result) => ({ ...result.detail, written: result.written, writtenAll: result.writtenAll || (result.written ? [result.written] : []) }),
    async finish(successes) {
      return { written: successes.flatMap((s) => s.result.writtenAll || (s.result.written ? [s.result.written] : [])) };
    },
  };
}
