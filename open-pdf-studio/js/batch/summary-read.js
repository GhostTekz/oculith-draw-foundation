// Batch Summary, read side: the markups of one PDF as Markups List summary
// rows, without opening a tab. It uses the same converters the loader uses
// (annotation-converter, status and comment replies, correction groups,
// custom column definitions from the catalog), but builds no document in
// `state` and renders nothing. Pure enough for node: the caller passes the
// PDF.js module.

import { PDFDocument } from 'pdf-lib';
import { convertPdfAnnotation } from '../pdf/loader/annotation-converter.js';
import { extractAnnotationColors } from '../pdf/loader/color-extraction.js';
import { statusReplyFromPdfAnnotation, applyStatusReplies } from '../pdf/loader/status-replies.js';
import { commentReplyFromPdfAnnotation, applyCommentReplies } from '../pdf/loader/comment-replies.js';
import { resolveGroupLinks } from '../pdf/loader/correction-load.js';
import { readMarkupTextColumn, readMarkupSecondTextColumn } from '../pdf/markup-text-column.js';
import { readMarkupChoiceColumn } from '../pdf/markup-choice-column.js';
import { readMarkupSecondChoiceColumn } from '../pdf/markup-second-choice-column.js';
import { readMarkupNumberColumn } from '../pdf/markup-number-column.js';
import { readMarkupSecondNumberColumn } from '../pdf/markup-second-number-column.js';
import { readMarkupCheckmarkColumn } from '../pdf/markup-checkmark-column.js';
import { readMarkupFormulaColumn } from '../pdf/markup-formula-column.js';
import { readMarkupStatusSet } from '../pdf/markup-status-set.js';
import { markupSummaryRows } from '../annotations/markup-csv.js';
import { withoutFoldedChildren } from '../annotations/corrections/model.js';
import { customTextColumnName } from '../annotations/custom-text-column.js';
import { choiceColumn } from '../annotations/custom-choice-column.js';
import { numberColumn } from '../annotations/custom-number-column.js';
import { checkmarkColumn, checkmarkText } from '../annotations/custom-checkmark-column.js';
import { formulaColumn } from '../annotations/custom-formula-column.js';
import { statusLabel } from '../annotations/markup-status.js';
import { summaryValue } from '../annotations/measure-extras.js';
import { formatMeasurement } from '../annotations/measurement.js';
import { throwIfCancelled } from './runner.js';

const MEASUREMENT_TYPES = new Set(['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle']);
const UNCALIBRATED = /^\s*Scale not set/iu;

function storedText(annot) {
  return String((annot?.contentsObj && annot.contentsObj.str) || annot?.contents || '').trim();
}

function shoelace(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function pathLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return sum;
}

/**
 * A measurement with no stored text, no stored value and no scale of its own
 * would otherwise take the scale of whatever document is active in the app
 * (the converter's fallback). The summary has no such document: report it
 * in page units, uncalibrated.
 */
function honestMeasurement(model, annot) {
  if (!model || !MEASUREMENT_TYPES.has(model.type) || model.type === 'measureAngle') return;
  if (storedText(annot) || model.measureScale || Number.isFinite(model.measureValue)) return;
  let value = null;
  let unit = 'pt';
  if (model.type === 'measureDistance' && [model.startX, model.startY, model.endX, model.endY].every(Number.isFinite)) {
    value = Math.hypot(model.endX - model.startX, model.endY - model.startY);
  } else if (Array.isArray(model.points) && model.points.length > 1) {
    value = model.type === 'measureArea' ? shoelace(model.points) : pathLength(model.points);
    if (model.type === 'measureArea') unit = 'pt²';
  }
  model.measureCalibrated = false;
  model.measureValue = undefined;
  model.measureUnit = unit;
  model.measureText = value == null ? 'Scale not set' : formatMeasurement({ value, unit, calibrated: false });
}

/** One page's PDF.js annotations → app markup models (loader rules, no state). */
async function convertPage(annots, pageNum, viewport, colors) {
  const byPdfId = new Map();
  const statuses = [];
  const replies = [];
  const groups = [];
  const models = [];
  const keep = (model, annot) => {
    honestMeasurement(model, annot);
    models.push(model);
  };
  for (const annot of annots) {
    const status = statusReplyFromPdfAnnotation(annot);
    if (status) { statuses.push(status); continue; }
    const reply = commentReplyFromPdfAnnotation(annot);
    if (reply) { replies.push({ ...reply, annot }); continue; }
    const model = await convertPdfAnnotation(annot, pageNum, viewport, new Map(), colors);
    if (!model || model.__textboxLeader) continue;
    if (model.type === 'textbox') delete model._pdfRectKey;
    if (annot.id) byPdfId.set(annot.id, model);
    if (annot.replyType === 'Group' && annot.inReplyTo) {
      groups.push({ converted: model, inReplyTo: annot.inReplyTo, replyType: annot.replyType });
    }
    keep(model, annot);
    if (Array.isArray(model.__extraAnnotations)) {
      for (const extra of model.__extraAnnotations) keep(extra, null);
      delete model.__extraAnnotations;
    }
  }
  for (const orphan of applyCommentReplies(replies, byPdfId)) {
    const model = await convertPdfAnnotation(orphan.annot, pageNum, viewport, new Map(), colors);
    if (model && !model.__textboxLeader) keep(model, orphan.annot);
  }
  applyStatusReplies(statuses, byPdfId);
  resolveGroupLinks(groups, byPdfId);
  return models;
}

/** The custom column definitions stored in a PDF's catalog. */
export function readSummaryColumns(pdfLib) {
  return {
    text: readMarkupTextColumn(pdfLib),
    text2: readMarkupSecondTextColumn(pdfLib),
    choice: readMarkupChoiceColumn(pdfLib),
    choice2: readMarkupSecondChoiceColumn(pdfLib),
    number: readMarkupNumberColumn(pdfLib),
    number2: readMarkupSecondNumberColumn(pdfLib),
    checkmark: readMarkupCheckmarkColumn(pdfLib),
    formula: readMarkupFormulaColumn(pdfLib),
    statusSet: readMarkupStatusSet(pdfLib),
  };
}

/**
 * Read every markup of a PDF. `bytes` is not modified (PDF.js gets a copy).
 * Throws for a PDF that PDF.js or pdf-lib cannot open (corrupt, encrypted).
 * @returns {Promise<{ pageCount, pageLabels, columns, annotations }>}
 */
export async function readPdfMarkups(bytes, { pdfjs, signal } = {}) {
  if (!pdfjs?.getDocument) throw new Error('readPdfMarkups needs the PDF.js module.');
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const task = pdfjs.getDocument({ data: source.slice(), isEvalSupported: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    throwIfCancelled(signal);
    const pdfLib = await PDFDocument.load(source.slice(), { ignoreEncryption: true, updateMetadata: false });
    throwIfCancelled(signal);
    let pageLabels = null;
    try {
      const labels = await pdf.getPageLabels();
      if (Array.isArray(labels) && labels.some((label) => typeof label === 'string' && label.trim())) pageLabels = labels;
    } catch { /* no labels */ }
    const annotations = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      throwIfCancelled(signal);
      const page = await pdf.getPage(pageNum);
      const annots = await page.getAnnotations();
      if (!annots.length) continue;
      let colors = null;
      try { colors = await extractAnnotationColors(pageNum, pdfLib); } catch { colors = null; }
      annotations.push(...await convertPage(annots, pageNum, page.getViewport({ scale: 1 }), colors));
    }
    throwIfCancelled(signal);
    return { pageCount: pdf.numPages, pageLabels, columns: readSummaryColumns(pdfLib), annotations };
  } finally {
    await task.destroy().catch(() => {});
  }
}

/** Custom column [name, value-of-row] pairs this file defines, in list order. */
function customColumns(columns) {
  const text = customTextColumnName(columns.text);
  const text2 = customTextColumnName(columns.text2);
  const choice = choiceColumn(columns.choice, text);
  const choice2 = choiceColumn(columns.choice2);
  const number = numberColumn(columns.number, text, choice?.name);
  const number2 = numberColumn(columns.number2);
  const checkmark = checkmarkColumn(columns.checkmark, text, choice?.name, number?.name);
  const formula = formulaColumn(columns.formula, number, text, choice?.name, checkmark?.name, choice, number2);
  const pairs = [
    [text, (row) => row.customTextValue],
    [text2, (row) => row.customTextValue2],
    [choice?.name, (row) => row.customChoiceValue],
    [choice2?.name, (row) => row.customChoiceValue2],
    [number?.name, (row) => row.customNumberValue],
    [number2?.name, (row) => row.customNumberValue2],
    [checkmark?.name, (row) => checkmarkText(row.customCheckmarkValue)],
    [formula?.name, (row) => row.customFormulaValue],
  ].filter(([name]) => name);
  return { pairs, defs: { choice, choice2, number, number2, checkmark, formula } };
}

/** The measurement a row shows and, when calibrated, the value totals add up. */
function measurementOf(annotation, text) {
  if (text === null || text === undefined) return { measurement: '', value: null, unit: '', calibrated: null };
  const shown = String(text || '');
  if (annotation.type === 'measureAngle') {
    const value = Number.isFinite(annotation.measureValue) ? annotation.measureValue : null;
    return { measurement: shown, value, unit: value == null ? '' : '°', calibrated: true };
  }
  const { measureValue, measureUnit } = summaryValue(annotation);
  const unit = String(measureUnit || '');
  const calibrated = !UNCALIBRATED.test(shown) && annotation.measureCalibrated !== false
    && !!unit && !/^pt/u.test(unit);
  if (!calibrated) {
    return { measurement: shown && UNCALIBRATED.test(shown) ? shown : `Scale not set${shown ? ` · ${shown}` : ''}`,
      value: null, unit: '', calibrated: false };
  }
  // A dimension-style text drops "mm" ("3000"); the summary always names the unit.
  return { measurement: /^[\d\s.,]+$/u.test(shown) ? `${shown.trim()} ${unit}` : shown,
    value: Number.isFinite(measureValue) ? measureValue : null, unit, calibrated: true };
}

/**
 * One file's summary rows (Markups List projection, every markup, document
 * order; replies and correction children folded into their markup).
 * Row: { file, page, pageLabel, type, subject, status, author, date, comments,
 *        replies, custom: { [column]: text }, measurement, value, unit, calibrated }
 */
export function fileSummaryRows(read, { file = '' } = {}) {
  const annotations = (read.annotations || []).filter((annotation) => annotation && annotation.type !== 'scaleRegion');
  const { pairs, defs } = customColumns(read.columns || {});
  const labels = read.pageLabels;
  const pageLabel = (annotation) => {
    const label = labels?.[Number(annotation.page) - 1];
    return typeof label === 'string' && label.trim() ? label : String(annotation.page ?? '');
  };
  const rows = markupSummaryRows(annotations, null, defs.choice, defs.number, defs.checkmark, defs.formula,
    defs.choice2, defs.number2, { pageLabel, latestStatusOnly: true, statusSet: read.columns?.statusSet });
  // Same filter and order as markupSummaryRows, to pair rows with markups.
  const visible = withoutFoldedChildren(annotations, new Map(annotations.map((a) => [a.id, a])));
  return rows.map((row, index) => {
    const annotation = visible[index] || {};
    return {
      file,
      page: row.page,
      pageLabel: row.pageLabel,
      type: row.type || '',
      subject: row.subject || '',
      status: statusLabel(row.status, read.columns?.statusSet),
      author: row.author || '',
      date: row.modifiedAt || row.createdAt || '',
      comments: row.text || '',
      replies: row.replyRows?.length || 0,
      custom: Object.fromEntries(pairs.map(([name, value]) => [name, String(value(row) ?? '')])),
      ...measurementOf(annotation, row.measurementText),
    };
  });
}
