// Structurele annotatie-vergelijking voor de compare-modus.
//
// Vergelijkt de annotatie-lijsten van het OUD- en NIEUW-document (voor het
// huidige pagina-paar) en levert change-records op die compatibel zijn met de
// bestaande verschillenlijst: { type:'added'|'removed'|'modified', ... }.
//
// Dit is los van de pixel-diff van de PDF-inhoud: de app-annotaties zitten in
// een aparte overlay (doc.annotations), niet in het gerenderde PDF-raster, dus
// de pixel-diff ziet ze niet. Deze module vult dat gat.

import { state } from '../core/state.js';
import { getAnnotationBounds } from '../core/stores/selection-helpers.js';
import i18next from '../i18n/config.js';

// Twee annotaties "matchen" als ze hetzelfde type hebben én hun middelpunt
// binnen deze tolerantie ligt (in pagina-eenheden/punten). Ruim genoeg voor
// kleine herpositionering, krap genoeg om verschillende annotaties te scheiden.
const CENTER_TOL = 16;

function _annsForDoc(filePath, pageNum) {
  if (!filePath) return [];
  const doc = (state.documents || []).find(d => d && d.filePath === filePath);
  if (!doc || !Array.isArray(doc.annotations)) return [];
  // Annotaties zonder page-veld (page == null/undefined) tellen als pagina 1.
  return doc.annotations.filter(a => a && (a.page || 1) === (pageNum || 1) && a.type !== '__tool-defaults__');
}

function _centerAndBounds(ann) {
  const b = getAnnotationBounds(ann);
  if (!b) return null;
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, b };
}

// Vergelijkings-signatuur voor "gewijzigd": inhoud/kleur/lijndikte + globale maat.
function _sig(ann, b) {
  return [
    ann.text || ann.content || '',
    ann.color || ann.strokeColor || ann.fillColor || '',
    ann.lineWidth ?? ann.strokeWidth ?? ann.borderWidth ?? '',
    Math.round(b.width), Math.round(b.height),
    ann.rotation || 0,
    // Two counts at the same point can still represent different takeoff
    // quantities. Their category and number belong in a revision report.
    ann.type === 'count' ? (ann.categoryId || '') : '',
    ann.type === 'count' ? (ann.number ?? '') : '',
    ann.type === 'count' ? (ann.markerStyle || '') : '',
    ann.type === 'count' ? (ann.symbolId || '') : '',
  ].join('|');
}

function _countIdentity(ann) {
  return `${ann.categoryId || 'uncategorized'} #${ann.number ?? 'un-numbered'}`;
}

function _label(ann, before = null) {
  const t = ann.type || 'annotation';
  const base = i18next.t(`compareAnnType.${t}`, { ns: 'ribbon', defaultValue: t });
  if (t === 'count') {
    const after = _countIdentity(ann);
    return before ? `${base}: ${_countIdentity(before)} → ${after}` : `${base}: ${after}`;
  }
  const txt = (ann.text || ann.content || '').trim();
  return txt ? `${base}: ${txt.slice(0, 30)}` : base;
}

function _rec(type, ann, b, before = null) {
  return {
    type,
    source: 'annotation',
    annType: ann.type,
    label: _label(ann, before),
    // Pagina-coördinaten (zelfde ruimte als de PDF-pagina op schaal 1). De UI
    // schaalt met visualScale, net als de inhouds-changes.
    x: b.x, y: b.y, width: b.width, height: b.height,
  };
}

/**
 * Vergelijk twee annotatie-lijsten (van hetzelfde pagina-paar).
 * @returns Array<change-record> met type added/removed/modified en source:'annotation'.
 */
export function diffAnnotationLists(oldAnns, newAnns) {
  const changes = [];
  const oldUsed = new Set();
  const old = (oldAnns || []).map(ann => ({ ann, bounds: _centerAndBounds(ann) }));
  const next = (newAnns || []).map(ann => ({ ann, bounds: _centerAndBounds(ann), match: -1 }));

  // Match unchanged signatures first. Co-located counts can have identical
  // marker bounds, so list order must not turn a harmless reorder into edits.
  for (const exactOnly of [true, false]) {
    for (const entry of next) {
      if (!entry.bounds || entry.match >= 0) continue;
      let match = -1;
      let best = Infinity;
      for (let i = 0; i < old.length; i++) {
        const candidate = old[i];
        if (oldUsed.has(i) || !candidate.bounds || candidate.ann.type !== entry.ann.type) continue;
        if (exactOnly && _sig(candidate.ann, candidate.bounds.b) !== _sig(entry.ann, entry.bounds.b)) continue;
        const distance = Math.hypot(entry.bounds.cx - candidate.bounds.cx, entry.bounds.cy - candidate.bounds.cy);
        if (distance <= CENTER_TOL && distance < best) { best = distance; match = i; }
      }
      if (match >= 0) { entry.match = match; oldUsed.add(match); }
    }
  }

  for (const entry of next) {
    if (!entry.bounds) continue;
    if (entry.match < 0) {
      changes.push(_rec('added', entry.ann, entry.bounds.b));
      continue;
    }
    const before = old[entry.match];
    if (_sig(before.ann, before.bounds.b) !== _sig(entry.ann, entry.bounds.b)) {
      changes.push(_rec('modified', entry.ann, entry.bounds.b, before.ann));
    }
  }
  for (let i = 0; i < old.length; i++) {
    if (oldUsed.has(i)) continue;
    const oc = old[i].bounds;
    if (!oc) continue;
    changes.push(_rec('removed', old[i].ann, oc.b));
  }
  return changes;
}

/**
 * Bouw de annotatie-changes voor het huidige compare-pagina-paar.
 */
export function diffAnnotationsForPair(oldPath, oldPage, newPath, newPage) {
  const oldAnns = _annsForDoc(oldPath, oldPage);
  const newAnns = _annsForDoc(newPath, newPage);
  return diffAnnotationLists(oldAnns, newAnns);
}
