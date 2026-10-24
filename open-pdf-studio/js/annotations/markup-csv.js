import { withoutFoldedChildren, listPreview } from './corrections/model.js';
import { customTextColumnName, customTextValue } from './custom-text-column.js';
import { choiceColumn, choiceValue } from './custom-choice-column.js';
import { numberColumn, numberText } from './custom-number-column.js';
import { formulaColumn, formulaNumberSourceValue, formulaText } from './custom-formula-column.js';
import { checkmarkColumn, checkmarkText, checkmarkValue } from './custom-checkmark-column.js';
import { measureKindType } from './measure-extras.js';
import { markupReplies } from './markup-replies.js';
import { statusHistory, statusLabel } from './markup-status.js';
import { attachmentNames } from './capture.js';
import { normalizeRaceway, racewayLabel, fittingsText } from './raceway.js';

const COLUMNS = ['Page', 'Type', 'Subject', 'Status', 'Author', 'Text', 'Replies', 'Created', 'Modified',
  'Layer', 'Measurement shown', 'Measurement status'];
const MEASUREMENT_TYPES = new Set(['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle']);
// Added after all other columns when the export holds a raceway run.
const RACEWAY_COLUMNS = ['Tag', 'Raceway', 'Fittings', 'Bends'];

/** Tag, size label, fittings and bends of a raceway run; null for other markups. */
function racewayFields(annotation) {
  if (measureKindType(annotation) !== 'measureRaceway') return null;
  const rw = normalizeRaceway(annotation.raceway);
  const sections = Array.isArray(annotation.measureBendSections) && annotation.measureBendSections.length
    ? annotation.measureBendSections
    : (Number.isFinite(annotation.measureBendTotal) ? [annotation.measureBendTotal] : []);
  return {
    tag: rw.tag || '',
    size: racewayLabel(rw),
    fittings: fittingsText(annotation.measureFittings),
    bends: sections.filter(Number.isFinite).map(v => `${Math.round(v)}°`).join(' | '),
  };
}

function cell(value, trustedNumber = false) {
  let text = String(value ?? '');
  // Spreadsheet programs can execute formulas in cells opened from CSV.
  if (!trustedNumber && /^[\s\x00-\x1f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** One line per status change: "Accepted by Bo 2026-10-01T…; Rejected by …". */
export function statusHistoryText(entries) {
  return (entries || []).map(entry => `${entry.label} by ${entry.author || 'Unknown'}${entry.date ? ` ${entry.date}` : ''}`)
    .join('; ');
}

/** Shared Markups List projection for CSV, PDF and XML; no annotation is changed. */
export function markupSummaryRows(annotations, selected = null, choiceDefinition = null, numberDefinition = null,
  checkmarkDefinition = null, formulaDefinition = null, secondChoiceDefinition = null,
  secondNumberDefinition = null, options = {}) {
  const choice = choiceColumn(choiceDefinition);
  const secondChoice = choiceColumn(secondChoiceDefinition);
  const number = numberColumn(numberDefinition);
  const secondNumber = numberColumn(secondNumberDefinition);
  const checkmark = checkmarkColumn(checkmarkDefinition);
  const formula = formulaColumn(formulaDefinition, number, '', '', '', choice, secondNumber);
  const all = (annotations || []).filter(Boolean);
  const byId = new Map(all.map(annotation => [annotation.id, annotation]));
  const picked = selected == null ? null : new Set(selected);
  // `inListOrder`: the order of `selected` (the Markups List's rows), not the document's.
  const inDocument = new Set(all);
  const chosen = picked == null ? all : options.inListOrder
    ? [...picked].filter(annotation => inDocument.has(annotation))
    : all.filter(annotation => picked.has(annotation));
  const visible = withoutFoldedChildren(chosen, byId);
  return visible.map(annotation => ({
    // Raceway runs only: { tag, size, fittings, bends } (racewayFields).
    ...(measureKindType(annotation) === 'measureRaceway' ? { raceway: racewayFields(annotation) } : {}),
    page: annotation.page,
    // The PDF's page label when the caller knows it (else the number).
    pageLabel: typeof options.pageLabel === 'function' ? options.pageLabel(annotation) : String(annotation.page ?? ''),
    // Polylength, Volume, Arc and Radius by their own name (measure-extras.js).
    type: measureKindType(annotation),
    subject: annotation.subject,
    status: annotation.status || 'none',
    author: annotation.author,
    text: listPreview(annotation, byId) || annotation.text || '',
    replies: (annotation.replies || []).map(reply => `${reply.author || ''}: ${reply.text || ''}`).join(' | '),
    // The thread in order, for summaries that list replies as indented rows.
    replyRows: markupReplies(annotation).map(({ author, text, createdAt }) => ({ author, text, createdAt })),
    // Who set which status when; `latestStatusOnly` keeps the last change.
    statusHistory: (options.latestStatusOnly ? statusHistory(annotation).slice(-1) : statusHistory(annotation))
      .map(entry => ({ ...entry, label: statusLabel(entry.state, options.statusSet) })),
    createdAt: annotation.createdAt,
    modifiedAt: annotation.modifiedAt,
    // The layer's name when the caller knows the document's layers.
    layer: typeof options.layerName === 'function' ? options.layerName(annotation) : annotation.layer,
    // Space path (Spaces panel) when the caller resolves spaces.
    space: typeof options.spaceOf === 'function' ? options.spaceOf(annotation) || '' : '',
    customTextValue: customTextValue(annotation.markupTextValue),
    customTextValue2: customTextValue(annotation.markupTextValue2),
    customChoiceValue: choiceValue(annotation.markupChoiceValue, choice?.options),
    customChoiceValue2: choiceValue(annotation.markupChoiceValue2, secondChoice?.options),
    customNumberValue: number ? numberText(annotation.markupNumberValue) : '',
    customNumberValue2: secondNumber ? numberText(annotation.markupNumberValue2) : '',
    customFormulaValue: formulaText(formulaNumberSourceValue(annotation, formula), formula,
      annotation.markupChoiceValue, choice),
    customCheckmarkValue: checkmark ? checkmarkValue(annotation.markupCheckmarkValue) : null,
    // Capture photos and the File Attachment's file (capture.js).
    attachments: attachmentNames(annotation),
    measurementText: MEASUREMENT_TYPES.has(annotation.type)
      ? (annotation.measureText || (Number.isFinite(annotation.measureValue)
        ? `${annotation.measureValue} ${annotation.measureUnit || ''}`.trim() : ''))
      : null,
  }));
}

/**
 * Export the same correction grouping as the Markups List, with full text.
 * `options.replyRows` adds each reply as its own row (Type "Reply") right
 * under its markup, like the list's thread; `options.statusHistory` adds a
 * Status history column (`latestStatusOnly`: the last change only).
 */
export function markupCsv(annotations, selected = null, columnName = '', choiceDefinition = null,
  numberDefinition = null, checkmarkDefinition = null, formulaDefinition = null, secondTextColumnName = '',
  secondChoiceDefinition = null, secondNumberDefinition = null, options = {}) {
  const name = customTextColumnName(columnName);
  const secondName = customTextColumnName(secondTextColumnName);
  const usedNames = [name, choiceDefinition?.name, secondChoiceDefinition?.name,
    numberDefinition?.name, secondNumberDefinition?.name,
    checkmarkDefinition?.name, formulaDefinition?.name];
  if (secondName && usedNames.some(other => secondName.toLocaleLowerCase() === other?.toLocaleLowerCase())) {
    throw new Error('Text columns and other custom columns need different names.');
  }
  const choice = choiceColumn(choiceDefinition, name);
  const secondChoice = choiceColumn(secondChoiceDefinition);
  const number = numberColumn(numberDefinition, name, choice?.name);
  const secondNumber = numberColumn(secondNumberDefinition);
  const checkmark = checkmarkColumn(checkmarkDefinition, name, choice?.name, number?.name);
  const formula = formulaColumn(formulaDefinition, number, name, choice?.name, checkmark?.name,
    choice, secondNumber);
  if (secondChoice && [name, secondName, choice?.name, number?.name, secondNumber?.name,
    checkmark?.name, formula?.name]
    .some(other => secondChoice.name.toLocaleLowerCase() === other?.toLocaleLowerCase())) {
    throw new Error('Custom columns need different names.');
  }
  if (secondNumber && [name, secondName, choice?.name, secondChoice?.name, number?.name,
    checkmark?.name, formula?.name].some(other =>
    secondNumber.name.toLocaleLowerCase() === other?.toLocaleLowerCase())) {
    throw new Error('Custom columns need different names.');
  }
  const summaryRows = markupSummaryRows(annotations, selected, choice, number, checkmark, formula,
    secondChoice, secondNumber, options);
  const customCount = [name, secondName, choice, secondChoice, number, secondNumber, checkmark, formula]
    .filter(Boolean).length;
  // Attachments column (capture.js): when asked, or when any markup has one.
  const withAttachments = options.attachments ?? summaryRows.some(row => row.attachments.length);
  // Raceway columns only when a raceway run is exported: other exports keep their columns.
  const withRaceway = summaryRows.some(row => row.raceway);
  const racewayCells = (row) => (withRaceway
    ? (row.raceway ? [row.raceway.tag, row.raceway.size, row.raceway.fittings, row.raceway.bends] : ['', '', '', ''])
    : []);
  // Optional column groups, in header order: Attachments, Space, Raceway.
  const replyLine = (row, reply) => [row.page, 'Reply', '', '', reply.author, reply.text, '',
    reply.createdAt || '', '', '', '', '', ...Array(customCount).fill(''),
    ...(options.statusHistory ? [''] : []), ...(options.pageLabel ? [row.pageLabel] : []),
    ...(withAttachments ? [''] : []),
    ...(options.spaceOf ? [row.space] : []),
    ...racewayCells({})];
  const rows = summaryRows.flatMap(row => [[
    row.page, row.type, row.subject, row.status, row.author, row.text,
    row.replies, row.createdAt, row.modifiedAt, row.layer,
    row.measurementText ?? '', row.measurementText === null ? '' : 'UNVERIFIED',
    ...(name ? [row.customTextValue] : []),
    ...(secondName ? [row.customTextValue2] : []),
    ...(choice ? [row.customChoiceValue] : []),
    ...(secondChoice ? [row.customChoiceValue2] : []),
    ...(number ? [row.customNumberValue] : []),
    ...(secondNumber ? [row.customNumberValue2] : []),
    ...(checkmark ? [checkmarkText(row.customCheckmarkValue)] : []),
    ...(formula ? [row.customFormulaValue] : []),
    ...(options.statusHistory ? [statusHistoryText(row.statusHistory)] : []),
    ...(options.pageLabel ? [row.pageLabel] : []),
    ...(withAttachments ? [row.attachments.join('; ')] : []),
    ...(options.spaceOf ? [row.space] : []),
    ...racewayCells(row),
  ], ...(options.replyRows ? row.replyRows.map(reply => replyLine(row, reply)) : [])]);
  const header = [...COLUMNS, ...(name ? [name] : []), ...(secondName ? [secondName] : []),
    ...(choice ? [choice.name] : []),
    ...(secondChoice ? [secondChoice.name] : []),
    ...(number ? [number.name] : []), ...(secondNumber ? [secondNumber.name] : []),
    ...(checkmark ? [checkmark.name] : []),
    ...(formula ? [formula.name] : []),
    ...(options.statusHistory ? [options.latestStatusOnly ? 'Latest status' : 'Status history'] : []),
    ...(options.pageLabel ? ['Page label'] : []),
    ...(withAttachments ? ['Attachments'] : []),
    ...(options.spaceOf ? ['Space'] : []),
    ...(withRaceway ? RACEWAY_COLUMNS : [])];
  const numberIndex = COLUMNS.length + (name ? 1 : 0) + (secondName ? 1 : 0)
    + (choice ? 1 : 0) + (secondChoice ? 1 : 0);
  const secondNumberIndex = numberIndex + (number ? 1 : 0);
  const formulaIndex = secondNumberIndex + (secondNumber ? 1 : 0) + (checkmark ? 1 : 0);
  return '\uFEFF' + [header.map(value => cell(value)).join(','),
    ...rows.map(row => row.map((value, index) => cell(value,
      (!!number && index === numberIndex) || (!!secondNumber && index === secondNumberIndex)
      || (!!formula && index === formulaIndex))).join(','))]
    .join('\r\n') + '\r\n';
}
