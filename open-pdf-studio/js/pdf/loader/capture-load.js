// Reads capture photos (/OPS_Capture, see saver/capture-files.js) and File
// Attachment markups (/FileAttachment) back into the model. The PDF is
// untrusted: counts and sizes are capped, and a broken entry is skipped.

import { PDFName, PDFArray, PDFDict, PDFRef, PDFHexString, PDFString, decodePDFRawStream } from 'pdf-lib';
import { CAPTURE_KEY, CAPTURE_FILE_MARK } from '../saver/capture-files.js';
import {
  CAPTURE_MAX_PHOTOS, CAPTURE_MAX_INPUT_BYTES, FILE_ATTACHMENT_ICON, FILE_ATTACHMENT_SIZE,
  bytesToDataUrl, safeFileName, safeMimeType, mimeTypeForName,
} from '../../annotations/capture.js';

function lookupDict(context, raw) {
  const v = raw instanceof PDFRef ? context.lookup(raw) : raw;
  return v instanceof PDFDict ? v : null;
}

function textOf(context, raw) {
  const v = raw instanceof PDFRef ? context.lookup(raw) : raw;
  if (v instanceof PDFHexString || v instanceof PDFString) return v.decodeText();
  return '';
}

/** 'D:YYYYMMDDHHmmSS[Z]' → stored photo date ('YYYY-MM-DDTHH:MM:SS' or ISO), or ''. */
export function photoDateFromPdf(text) {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z)?/u.exec(String(text || ''));
  if (!m) return '';
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return m[7] ? `${local}.000Z` : local;
}

function streamBytes(context, raw) {
  const stream = raw instanceof PDFRef ? context.lookup(raw) : raw;
  if (!stream || !stream.dict) return null;
  const declared = Number(stream.dict.lookup?.(PDFName.of('Length'))?.asNumber?.() ?? 0);
  if (declared > CAPTURE_MAX_INPUT_BYTES) return null;
  const bytes = stream.dict.has(PDFName.of('Filter')) ? decodePDFRawStream(stream).decode() : stream.contents;
  return bytes && bytes.length && bytes.length <= CAPTURE_MAX_INPUT_BYTES ? new Uint8Array(bytes) : null;
}

/** One capture filespec → photo entry, or null. */
function photoFromSpec(context, spec) {
  if (!spec?.get(PDFName.of(CAPTURE_FILE_MARK))) return null;
  let meta = {};
  try { meta = JSON.parse(textOf(context, spec.get(PDFName.of(CAPTURE_FILE_MARK)))) || {}; } catch { meta = {}; }
  const ef = lookupDict(context, spec.get(PDFName.of('EF')));
  const raw = ef?.get(PDFName.of('F'));
  if (!raw) return null;
  const bytes = streamBytes(context, raw);
  if (!bytes) return null;
  const stream = raw instanceof PDFRef ? context.lookup(raw) : raw;
  const subtype = stream.dict.get(PDFName.of('Subtype'))?.decodeText?.() || '';
  const mimeType = safeMimeType(subtype) === 'image/png' ? 'image/png' : 'image/jpeg';
  const params = lookupDict(context, stream.dict.get(PDFName.of('Params')));
  const name = safeFileName(textOf(context, spec.get(PDFName.of('UF')) || spec.get(PDFName.of('F'))),
    mimeType === 'image/png' ? 'photo.png' : 'photo.jpg');
  const date = (typeof meta.date === 'string' && meta.date.length <= 40 ? meta.date : '')
    || photoDateFromPdf(textOf(context, params?.get(PDFName.of('CreationDate'))));
  return {
    id: typeof meta.id === 'string' && /^[\w-]{1,64}$/u.test(meta.id) ? meta.id : '',
    name,
    mimeType,
    date,
    width: Math.max(0, Math.round(Number(meta.width) || 0)),
    height: Math.max(0, Math.round(Number(meta.height) || 0)),
    size: bytes.length,
    dataUrl: bytesToDataUrl(bytes, mimeType),
  };
}

/** { capturePhotos } from an annotation dictionary (for color-extraction.js). */
export function leesCapture(annotDict, context) {
  try {
    const list = annotDict?.lookup?.(PDFName.of(CAPTURE_KEY));
    if (!(list instanceof PDFArray)) return {};
    const photos = [];
    for (let i = 0; i < list.size() && photos.length < CAPTURE_MAX_PHOTOS; i++) {
      try {
        const photo = photoFromSpec(context, lookupDict(context, list.get(i)));
        if (photo) {
          if (!photo.id) photo.id = `ph_pdf_${i}`;
          photos.push(photo);
        }
      } catch { /* a broken photo is skipped */ }
    }
    return photos.length ? { capturePhotos: photos } : {};
  } catch {
    return {};
  }
}

/** The model with its photos restored (unchanged when there are none). */
export function metCapture(model, photos) {
  if (!model || !Array.isArray(photos) || !photos.length) return model;
  model.capturePhotos = photos.map(p => ({ ...p }));
  return model;
}

/**
 * pdf.js FileAttachment data → File Attachment markup props, or null when
 * the annotation has no embedded content (then the saver keeps it as is).
 */
export function fileAttachmentProps(annot) {
  const file = annot?.file;
  const content = file?.content;
  if (!(content instanceof Uint8Array) || !content.length) return null;
  const name = safeFileName(file.filename || file.rawFilename, 'attachment');
  const mimeType = mimeTypeForName(name);
  return {
    type: 'comment',
    icon: FILE_ATTACHMENT_ICON,
    width: FILE_ATTACHMENT_SIZE,
    height: FILE_ATTACHMENT_SIZE,
    popupOpen: false,
    attachedFile: {
      name,
      mimeType,
      size: content.length,
      date: '',
      dataUrl: bytesToDataUrl(content, mimeType),
    },
  };
}

/**
 * PDF.js 6 leaves a FileAttachment's bytes out of getAnnotations() (only a
 * `fileId`); fetch them so fileAttachmentProps() sees `file.content`.
 * Mutates the pdf.js annotation records; a failed fetch leaves one as is.
 */
export async function loadFileAttachmentContents(annots, pdfjsDoc) {
  if (!Array.isArray(annots) || typeof pdfjsDoc?.getAttachmentContent !== 'function') return;
  for (const annot of annots) {
    if (annot?.subtype !== 'FileAttachment' || !annot.file || annot.file.content?.length) continue;
    if (annot.fileId == null) continue;
    try {
      const content = await pdfjsDoc.getAttachmentContent(annot.fileId);
      if (content?.length) annot.file.content = content instanceof Uint8Array ? content : new Uint8Array(content);
    } catch { /* unreadable attachment: not modelled, the saver keeps it */ }
  }
}
