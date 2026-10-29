// PDF metadata contributions for independent add-ons. A v2 add-on receives
// strings and document models, never a mutable pdf-lib document or dictionary.
// Full-edition v1 hooks remain the base and run exactly as before.
import { PDFHexString, PDFName, PDFString } from 'pdf-lib';

const BASE = Symbol('base PDF hooks');
const ADDONS = Symbol('PDF add-ons');
const FIELDS = new Set(['catalogKeys', 'legacyCatalogKeys', 'annotationKeys', 'applyCatalog', 'catalogForSave',
  'decorateAnnotation', 'annotationForSave']);
const MAX_CATALOG_TEXT = 256 * 1024;
const MAX_LEGACY_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_ANNOTATION_TEXT = 16 * 1024;
// These entries belong to the editor, even though they use a vendor-style
// name. Independent packages may claim only other, exact legacy names.
const EDITOR_CATALOG_KEYS = new Set(`OPS_AnnotLayers OPS_AssembliesV1 OPS_CaptionTemplateV1
  OPS_FormulaCaptionsV1 OPS_MarkupCheckmarkColumnV1 OPS_MarkupChoiceColumn2V1
  OPS_MarkupChoiceColumn2V2 OPS_MarkupChoiceColumnV1 OPS_MarkupChoiceColumnV2
  OPS_MarkupFormulaColumnV1 OPS_MarkupFormulaColumnV2 OPS_MarkupFormulaColumnV3
  OPS_MarkupNumberColumn2V1 OPS_MarkupNumberColumnV1 OPS_MarkupStatusSetV1
  OPS_MarkupTextColumn OPS_MarkupTextColumn2V1 OPS_Preview OPS_Spaces
  OPS_ToolSequences`.split(/\s+/));
const encoder = new TextEncoder();
const LEGACY_CATALOG_NAME = /^[A-Z][A-Z0-9]{1,15}_[A-Za-z][A-Za-z0-9_]*V[1-9][0-9]*$/;

/** Unknown versioned vendor catalog fields may contain page-specific state. */
export function unclaimedLegacyCatalogKeys(pdfDoc, claimed = []) {
  const known = new Set([...EDITOR_CATALOG_KEYS, ...claimed]);
  return pdfDoc.catalog.keys().map((key) => key.decodeText())
    .filter((key) => LEGACY_CATALOG_NAME.test(key) && !known.has(key));
}

/** Reversible ASCII encoding prevents packages with punctuation in their IDs sharing a prefix. */
export function pdfKeyPrefix(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error('PDF add-on id must be an ASCII package id');
  }
  return `ODX_${[...id].map((character) => /[A-Za-z0-9]/.test(character)
    ? character : `_${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')}_`;
}

function declaredKeys(id, field, values) {
  if (values == null) return [];
  if (!Array.isArray(values)) throw new Error(`PDF ${field} must be an array`);
  const prefix = pdfKeyPrefix(id);
  const keys = new Set();
  for (const key of values) {
    if (typeof key !== 'string' || key.length > 127 || !key.startsWith(prefix)
        || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key.slice(prefix.length)) || keys.has(key)) {
      throw new Error(`Invalid or duplicate PDF ${field} key: ${String(key)}`);
    }
    keys.add(key);
  }
  return [...keys];
}

function legacyCatalogKeys(values) {
  if (values == null) return [];
  if (!Array.isArray(values)) throw new Error('PDF legacyCatalogKeys must be an array');
  const seen = new Set();
  for (const key of values) {
    // Require an explicit vendor namespace and a versioned field. This rules
    // out PDF structural names and the editor's own catalog entries.
    if (typeof key !== 'string' || key.length > 127
        || !LEGACY_CATALOG_NAME.test(key)
        || EDITOR_CATALOG_KEYS.has(key) || seen.has(key)) {
      throw new Error(`Invalid or duplicate PDF legacy catalog key: ${String(key)}`);
    }
    seen.add(key);
  }
  return [...seen];
}

export function validatePdfContribution(id, pdf) {
  if (!pdf || typeof pdf !== 'object' || Array.isArray(pdf)) throw new Error('PDF contribution must be an object');
  for (const field of Object.keys(pdf)) if (!FIELDS.has(field)) throw new Error(`Unsupported PDF operation: ${field}`);
  const catalogKeys = declaredKeys(id, 'catalogKeys', pdf.catalogKeys);
  const legacyKeys = legacyCatalogKeys(pdf.legacyCatalogKeys);
  if (legacyKeys.some((key) => catalogKeys.includes(key))) throw new Error('Duplicate PDF catalog key');
  const annotationKeys = declaredKeys(id, 'annotationKeys', pdf.annotationKeys);
  if (!catalogKeys.length && !legacyKeys.length && !annotationKeys.length) {
    throw new Error('PDF contribution must declare owned keys');
  }
  for (const name of ['applyCatalog', 'catalogForSave']) {
    if (pdf[name] != null && (!catalogKeys.length && !legacyKeys.length || typeof pdf[name] !== 'function')) {
      throw new Error(`PDF ${name} requires declared catalog keys and a function`);
    }
  }
  for (const name of ['decorateAnnotation', 'annotationForSave']) {
    if (pdf[name] != null && (!annotationKeys.length || typeof pdf[name] !== 'function')) {
      throw new Error(`PDF ${name} requires declared annotation keys and a function`);
    }
  }
  return { id, catalogKeys: [...catalogKeys, ...legacyKeys], legacyCatalogKeys: legacyKeys,
    annotationKeys, ...Object.fromEntries(
    [...FIELDS].filter((name) => typeof pdf[name] === 'function').map((name) => [name, pdf[name]])) };
}

function textFields(values, keys, limit, id, legacyKeys = []) {
  if (values == null) return {};
  if (typeof values !== 'object' || Array.isArray(values) || typeof values.then === 'function') {
    throw new Error(`PDF ${id} fields must be a synchronous object`);
  }
  const allowed = new Set(keys);
  const legacy = new Set(legacyKeys);
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key) || typeof value !== 'string'
        || (legacy.has(key) ? encoder.encode(value).length > MAX_LEGACY_CATALOG_BYTES : value.length > limit)) {
      throw new Error(`PDF ${id} returned an unowned or oversized field: ${key}`);
    }
    result[key] = value;
  }
  return result;
}

function readCatalog(pdfDoc, keys, legacyKeys = []) {
  const fields = {};
  const legacy = new Set(legacyKeys);
  for (const key of keys) {
    let value;
    try {
      const raw = pdfDoc.catalog.get(PDFName.of(key));
      value = raw === undefined ? null : pdfDoc.context.lookup(raw);
    } catch { continue; }
    // Hex UTF-16 and escaped literal strings can need four source characters
    // per decoded character. Bound the raw representation before decodeText.
    const max = legacy.has(key) ? MAX_LEGACY_CATALOG_BYTES : MAX_CATALOG_TEXT;
    if ((value instanceof PDFString || value instanceof PDFHexString)
        && value.value.length <= (max + 1) * 4) {
      let decoded;
      try {
        if (legacy.has(key)) {
          const bytes = value.asBytes();
          // pdf-lib's UTF-16 decoder spreads all code points into one call and
          // overflows for large workspaces. Keep its behavior for small strings;
          // reject malformed large UTF-16 rather than normalize source bytes.
          if (bytes.length <= 64 * 1024) {
            decoded = value.decodeText();
          } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
            decoded = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
          } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
            decoded = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
          }
        } else decoded = value.decodeText();
      } catch { continue; /* Unreadable source stays in the PDF. */ }
      if (decoded !== undefined
          && (legacy.has(key) ? encoder.encode(decoded).length <= max : decoded.length <= max)) {
        fields[key] = decoded;
      }
    }
  }
  return fields;
}

function annotationFields(extra, keys) {
  const fields = {};
  for (const key of keys) {
    const value = extra?.extensionFields?.[key];
    if (typeof value === 'string' && value.length <= MAX_ANNOTATION_TEXT) fields[key] = value;
  }
  return fields;
}

/** Append one package without changing the existing full-edition hook object. */
export function composePdfHooks(current, id, contribution) {
  const next = validatePdfContribution(id, contribution);
  const base = current && Object.hasOwn(current, BASE) ? current[BASE] : current;
  const addons = [...(current?.[ADDONS] || []), next];
  const catalogKeys = [...(base?.catalogKeys || [])];
  const annotationKeys = [...(base?.annotationKeys || [])];
  const owned = new Set([...catalogKeys, ...annotationKeys]);
  for (const addon of addons) {
    for (const key of [...addon.catalogKeys, ...addon.annotationKeys]) {
      if (owned.has(key)) throw new Error(`PDF key ownership collision: ${key}`);
      owned.add(key);
    }
    catalogKeys.push(...addon.catalogKeys);
    annotationKeys.push(...addon.annotationKeys);
  }
  return {
    ...base,
    [BASE]: base,
    [ADDONS]: addons,
    catalogKeys,
    annotationKeys,
    // The saver carries original values of declared v2 keys when a callback
    // does not replace them. v1 hooks retain their original ownership rule.
    annotationKeysToSkipCarry: base?.annotationKeys || [],
    readWorkspace(pdfDoc) {
      return { base: base?.readWorkspace?.(pdfDoc),
        addons: Object.fromEntries(addons.map((addon) => [addon.id,
          readCatalog(pdfDoc, addon.catalogKeys, addon.legacyCatalogKeys)])) };
    },
    applyWorkspace(doc, data) {
      base?.applyWorkspace?.(doc, data ? data.base : null);
      for (const addon of addons) {
        const fields = data?.addons?.[addon.id] || {};
        if (!Object.keys(fields).length) continue;
        const result = addon.applyCatalog?.(doc, fields);
        if (result && typeof result.then === 'function') throw new Error(`PDF ${addon.id} applyCatalog must be synchronous`);
      }
    },
    workspaceForSave(doc, pdfDoc) {
      return { base: base?.workspaceForSave?.(doc, pdfDoc),
        addons: Object.fromEntries(addons.map((addon) => {
          const fields = Object.freeze(readCatalog(pdfDoc, addon.catalogKeys, addon.legacyCatalogKeys));
          const presentKeys = Object.freeze(addon.catalogKeys.filter((key) =>
            pdfDoc.catalog.get(PDFName.of(key)) !== undefined));
          const source = Object.freeze({ fields, presentKeys });
          return [addon.id, textFields(addon.catalogForSave?.(doc, source), addon.catalogKeys,
            MAX_CATALOG_TEXT, addon.id, addon.legacyCatalogKeys)];
        })) };
    },
    saveWorkspace(pdfDoc, data) {
      base?.saveWorkspace?.(pdfDoc, data?.base);
      for (const addon of addons) {
        const fields = textFields(data?.addons?.[addon.id], addon.catalogKeys, MAX_CATALOG_TEXT,
          addon.id, addon.legacyCatalogKeys);
        for (const [key, value] of Object.entries(fields)) {
          if (addon.legacyCatalogKeys.includes(key) && pdfDoc.catalog.get(PDFName.of(key)) !== undefined
              && !Object.hasOwn(readCatalog(pdfDoc, [key], [key]), key)) {
            throw new Error(`Cannot replace unreadable PDF legacy catalog key: ${key}`);
          }
          pdfDoc.catalog.set(PDFName.of(key), PDFHexString.fromText(value));
        }
      }
    },
    decorateLoadedAnnotation(model, extra) {
      let result = base?.decorateLoadedAnnotation?.(model, extra) || model;
      for (const addon of addons) {
        result = addon.decorateAnnotation?.(result, annotationFields(extra, addon.annotationKeys)) || result;
        if (result && typeof result.then === 'function') {
          throw new Error(`PDF ${addon.id} decorateAnnotation must be synchronous`);
        }
      }
      return result;
    },
    writeAnnotation(model, dict, tools) {
      base?.writeAnnotation?.(model, dict, tools);
      for (const addon of addons) {
        const fields = textFields(addon.annotationForSave?.(model), addon.annotationKeys, MAX_ANNOTATION_TEXT, addon.id);
        for (const [key, value] of Object.entries(fields)) {
          dict.set(tools.PDFName.of(key), tools.pdfTextString(value));
        }
      }
    },
    carryToExtract(source, target, pages) {
      for (const addon of addons) {
        if (addon.catalogKeys.some((key) => source.catalog.get(PDFName.of(key)) !== undefined)) {
          throw new Error(`Cannot extract pages with ${addon.id} PDF data; use the add-on that can remap its catalog.`);
        }
      }
      return base?.carryToExtract?.(source, target, pages);
    },
  };
}
