// AutoCAD .PAT hatch pattern import (public format: a `*NAME, description`
// header followed by one line per line family:
//     angle, x-origin, y-origin, delta-x, delta-y [, dash-1, dash-2, ...]
// with a positive dash drawn, a negative dash a space and 0 a dot; `;`
// starts a comment). A .PAT file is untrusted local input: size, counts and
// every number are bounded, and anything malformed is skipped with a warning.
//
// The result uses the line-family format of rendering/hatch-patterns.js in
// page points and canvas orientation (y down): the .PAT y axis points up, so
// angles and y offsets flip sign; the family's line set is unchanged.

import { cleanHatchPatternDef, CUSTOM_HATCH_PREFIX, MAX_PATTERN_FAMILIES, MAX_FAMILY_DASHES,
  MAX_CUSTOM_HATCH_PATTERNS } from './hatch-registry.js';

export const MAX_PAT_FILE_BYTES = 1024 * 1024;

/** Points per .PAT drawing unit. `mm` matches acadiso.pat, `inch` acad.pat. */
export const PAT_UNITS = { mm: 72 / 25.4, inch: 72, pt: 1 };

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

function safeId(name) {
  return `${CUSTOM_HATCH_PREFIX}${name.toUpperCase().replace(/[^A-Z0-9_.-]+/gu, '_').slice(0, 48)}`;
}

/** One .PAT family line in drawing units → a family in page points (y down). */
export function patLineToFamily(values, factor) {
  const [angle, x, y, dx, dy, ...dashes] = values;
  let deltaX = -dx * factor;
  let deltaY = dy * factor;
  // Line i of the family and line -i coincide as a set: a negative spacing is
  // the same family walked the other way.
  if (deltaY < 0) { deltaY = -deltaY; deltaX = -deltaX; }
  const fam = { angle: -angle, originX: x * factor, originY: -y * factor, deltaX, deltaY, pat: true };
  if (dashes.length) fam.dashPattern = dashes.map(v => v * factor);
  return fam;
}

/**
 * Parse .PAT text.
 * @param {string} text
 * @param {{ unit?: 'mm'|'inch'|'pt' }} [opts]
 * @returns {{ patterns: {id, name, description, families}[], warnings: string[] }}
 */
export function parsePatText(text, opts = {}) {
  const factor = PAT_UNITS[opts.unit] || PAT_UNITS.mm;
  const patterns = [];
  const warnings = [];
  let current = null;
  const finish = () => {
    if (!current) return;
    const def = cleanHatchPatternDef(current);
    if (def && def.families.length === current.families.length) patterns.push(def);
    else if (def) { patterns.push(def); warnings.push(`${current.name}: some line families were skipped.`); }
    else warnings.push(`${current.name}: no usable line families.`);
    current = null;
  };
  const lines = String(text ?? '').replace(/^﻿/u, '').split(/\r\n|\r|\n/u);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].replace(/;.*$/u, '').trim();
    if (!line) continue;
    if (line.startsWith('*')) {
      finish();
      if (patterns.length >= MAX_CUSTOM_HATCH_PATTERNS) {
        warnings.push(`Only the first ${MAX_CUSTOM_HATCH_PATTERNS} patterns were read.`);
        break;
      }
      const comma = line.indexOf(',');
      const name = (comma >= 0 ? line.slice(1, comma) : line.slice(1)).trim();
      if (!name) { warnings.push(`Line ${ln + 1}: pattern without a name.`); continue; }
      current = { id: safeId(name), name: name.slice(0, 48),
        description: comma >= 0 ? line.slice(comma + 1).trim() : '', families: [] };
      continue;
    }
    if (!current) { warnings.push(`Line ${ln + 1}: data before the first pattern header.`); continue; }
    const parts = line.split(',').map(s => s.trim()).filter(s => s !== '');
    if (parts.length < 5 || !parts.every(s => NUMBER.test(s))) {
      warnings.push(`Line ${ln + 1}: not a line family.`);
      continue;
    }
    if (current.families.length >= MAX_PATTERN_FAMILIES) {
      warnings.push(`${current.name}: more than ${MAX_PATTERN_FAMILIES} line families.`);
      continue;
    }
    const values = parts.map(Number);
    if (values.length - 5 > MAX_FAMILY_DASHES) {
      warnings.push(`Line ${ln + 1}: more than ${MAX_FAMILY_DASHES} dashes.`);
      continue;
    }
    if (!values.every(Number.isFinite) || Math.abs(values[4]) * factor < 0.05) {
      warnings.push(`Line ${ln + 1}: the line spacing is zero or too small.`);
      continue;
    }
    current.families.push(patLineToFamily(values, factor));
  }
  finish();
  // Unique ids within one file: a repeated name gets a suffix.
  const seen = new Set();
  for (const p of patterns) {
    let id = p.id, n = 2;
    while (seen.has(id)) id = `${p.id.slice(0, CUSTOM_HATCH_PREFIX.length + 44)}_${n++}`;
    p.id = id;
    seen.add(id);
  }
  return { patterns, warnings };
}

/** Parse .PAT bytes (Latin-1/ASCII or UTF-8). */
export function parsePatBytes(bytes, opts = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error('The .PAT file is empty.');
  if (bytes.byteLength > MAX_PAT_FILE_BYTES) throw new Error(`A .PAT file must be at most ${MAX_PAT_FILE_BYTES} bytes.`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder('latin1').decode(bytes); }
  return parsePatText(text, opts);
}
