// pdf-lib pauses with setTimeout(0) every 100 objects when it parses a file
// and every 50 when it saves one. Each pause is a trip through the event
// loop, and WebKit stretches timers to a second when the window is not in
// view: on the device a 20k-markup file took 46 s to parse in the app and
// half a second outside it. Parsing and saving run straight through
// instead (about 0.5 s each for 20k markups). A caller that passes its own
// value keeps it.
import { PDFDocument, ParseSpeeds } from 'pdf-lib';

export const PARSE_OBJECTS_PER_TICK = ParseSpeeds.Fastest;
export const SAVE_OBJECTS_PER_TICK = Infinity;

const load = PDFDocument.load;
if (!load.__tempo) {
  const faster = function (pdf, options = {}) {
    return load.call(this, pdf, { parseSpeed: PARSE_OBJECTS_PER_TICK, ...options });
  };
  faster.__tempo = true;
  PDFDocument.load = faster;

  const save = PDFDocument.prototype.save;
  PDFDocument.prototype.save = function (options = {}) {
    return save.call(this, { objectsPerTick: SAVE_OBJECTS_PER_TICK, ...options });
  };
  const saveAsBase64 = PDFDocument.prototype.saveAsBase64;
  PDFDocument.prototype.saveAsBase64 = function (options = {}) {
    return saveAsBase64.call(this, { objectsPerTick: SAVE_OBJECTS_PER_TICK, ...options });
  };
}
