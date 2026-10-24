// XML summary of the Markups List (the external editor offers CSV, PDF and XML summaries).
// The same normalized rows as CSV and PDF (markupSummaryRows): one <Markup>
// per row with its fields as attributes, text, custom columns, status
// history and replies as child elements. Measurements stay UNVERIFIED.

import { customTextColumnName } from './custom-text-column.js';
import { choiceColumn, choiceValue } from './custom-choice-column.js';
import { numberColumn, numberText } from './custom-number-column.js';
import { formulaColumn } from './custom-formula-column.js';
import { checkmarkColumn, checkmarkText } from './custom-checkmark-column.js';
import { edition } from '../editions/active.js';

// Characters XML 1.0 cannot carry are dropped (a PDF string can hold them).
function xmlText(value) {
  return String(value ?? '')
    .replace(/[^\u0009\u000a\u000d -퟿-�\u{10000}-\u{10ffff}]/gu, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function attr(name, value) {
  if (value === null || value === undefined || value === '') return '';
  return ` ${name}="${xmlText(value).replaceAll('"', '&quot;').replace(/\r?\n|\r/gu, '&#10;')}"`;
}

/**
 * @param {{ sourcePath?: string, rows: object[], customTextColumn?, customSecondTextColumn?,
 *   customChoiceColumn?, customSecondChoiceColumn?, customNumberColumn?, customSecondNumberColumn?,
 *   customCheckmarkColumn?, customFormulaColumn?, latestStatusOnly?: boolean, generatedAt?: Date }} summary
 */
export function markupSummaryXml({ sourcePath = '', rows, customTextColumn = '', customSecondTextColumn = '',
  customChoiceColumn = null, customSecondChoiceColumn = null, customNumberColumn = null,
  customSecondNumberColumn = null, customCheckmarkColumn = null, customFormulaColumn = null,
  latestStatusOnly = false, generatedAt = new Date() }) {
  if (!Array.isArray(rows)) throw new Error('Markup summary rows are required.');
  const textName = customTextColumnName(customTextColumn);
  const secondTextName = customTextColumnName(customSecondTextColumn);
  const choice = choiceColumn(customChoiceColumn, textName);
  const secondChoice = choiceColumn(customSecondChoiceColumn);
  const number = numberColumn(customNumberColumn, textName, choice?.name);
  const secondNumber = numberColumn(customSecondNumberColumn);
  const checkmark = checkmarkColumn(customCheckmarkColumn, textName, choice?.name, number?.name);
  const formula = formulaColumn(customFormulaColumn, number, textName, choice?.name, checkmark?.name,
    choice, secondNumber);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>',
    `<MarkupSummary${attr('generator', edition.productName)}${attr('source', sourcePath)}`
      + `${attr('generated', new Date(generatedAt).toISOString())}${attr('count', rows.length)}`
      + `${attr('statusHistory', latestStatusOnly ? 'latest' : 'all')}>`];
  rows.forEach((row, index) => {
    out.push(`  <Markup${attr('index', index + 1)}${attr('page', row.page)}${attr('pageLabel', row.pageLabel)}`
      + `${attr('type', row.type)}${attr('subject', row.subject)}${attr('status', row.status || 'none')}`
      + `${attr('author', row.author)}${attr('layer', row.layer)}${attr('space', row.space)}${attr('created', row.createdAt)}`
      + `${attr('modified', row.modifiedAt)}>`);
    out.push(`    <Text>${xmlText(row.text)}</Text>`);
    if (row.measurementText !== null && row.measurementText !== undefined) {
      out.push(`    <Measurement status="UNVERIFIED">${xmlText(row.measurementText)}</Measurement>`);
    }
    const custom = [
      textName && [textName, 'text', row.customTextValue],
      secondTextName && [secondTextName, 'text', row.customTextValue2],
      choice && [choice.name, 'choice', choiceValue(row.customChoiceValue, choice.options)],
      secondChoice && [secondChoice.name, 'choice', choiceValue(row.customChoiceValue2, secondChoice.options)],
      number && [number.name, 'number', numberText(row.customNumberValue)],
      secondNumber && [secondNumber.name, 'number', numberText(row.customNumberValue2)],
      checkmark && [checkmark.name, 'checkmark', checkmarkText(row.customCheckmarkValue)],
      formula && [formula.name, 'formula', row.customFormulaValue || ''],
    ].filter(Boolean);
    for (const [name, kind, value] of custom) {
      out.push(`    <Column${attr('name', name)}${attr('kind', kind)}>${xmlText(value)}</Column>`);
    }
    if (row.statusHistory?.length) {
      out.push('    <StatusHistory>');
      for (const entry of row.statusHistory) {
        out.push(`      <Status${attr('state', entry.label || entry.state)}${attr('author', entry.author)}${attr('date', entry.date)}/>`);
      }
      out.push('    </StatusHistory>');
    }
    if (row.replyRows?.length) {
      out.push('    <Replies>');
      for (const reply of row.replyRows) {
        out.push(`      <Reply${attr('author', reply.author)}${attr('date', reply.createdAt)}>${xmlText(reply.text)}</Reply>`);
      }
      out.push('    </Replies>');
    }
    out.push('  </Markup>');
  });
  out.push('</MarkupSummary>');
  return out.join('\n') + '\n';
}
