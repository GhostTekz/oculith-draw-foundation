// Values that leave the pdf-lib worker must survive structured clone with
// the meaning they had: plain objects, arrays, Maps, Sets, typed arrays and
// primitives. A function would make postMessage throw; a class instance (a
// pdf-lib object, say) arrives as a bare object without its methods. Both
// are converted here, and reported once, so a reader that starts returning
// one shows up in the log instead of as a silently different markup.

const reported = new Set();

function report(where, path, kind) {
  const key = `${where}|${kind}|${path.replace(/\[[^\]]*\]/g, '[]')}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(`[pdf-lib worker] ${where}: ${path || 'value'} is ${kind}; sent as plain data`);
}

const isPlainProto = (proto) => proto === Object.prototype || proto === null;

function isBinary(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

// Does `value` need converting? Stops at the first value that does.
function needsConversion(value, seen) {
  if (value === null) return false;
  const type = typeof value;
  if (type === 'function' || type === 'symbol') return true;
  if (type !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (isBinary(value) || value instanceof Date || value instanceof RegExp) return false;
  if (Array.isArray(value)) return value.some((v) => needsConversion(v, seen));
  if (value instanceof Map) {
    for (const [k, v] of value) if (needsConversion(k, seen) || needsConversion(v, seen)) return true;
    return false;
  }
  if (value instanceof Set) {
    for (const v of value) if (needsConversion(v, seen)) return true;
    return false;
  }
  if (!isPlainProto(Object.getPrototypeOf(value))) return true;
  for (const key of Object.keys(value)) if (needsConversion(value[key], seen)) return true;
  return false;
}

function convert(value, where, path, done) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'function' || type === 'symbol') { report(where, path, `a ${type}`); return undefined; }
  if (type !== 'object') return value;
  if (done.has(value)) return done.get(value);
  if (isBinary(value) || value instanceof Date || value instanceof RegExp) return value;
  if (Array.isArray(value)) {
    const out = [];
    done.set(value, out);
    value.forEach((v, i) => { out.push(convert(v, where, `${path}[${i}]`, done)); });
    return out;
  }
  if (value instanceof Map) {
    const out = new Map();
    done.set(value, out);
    for (const [k, v] of value) out.set(convert(k, where, `${path}<key>`, done), convert(v, where, `${path}[${k}]`, done));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    done.set(value, out);
    for (const v of value) out.add(convert(v, where, `${path}<item>`, done));
    return out;
  }
  if (!isPlainProto(Object.getPrototypeOf(value))) {
    report(where, path, `a ${value.constructor?.name || 'class'} instance`);
  }
  const out = {};
  done.set(value, out);
  for (const key of Object.keys(value)) {
    const v = convert(value[key], where, path ? `${path}.${key}` : key, done);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/**
 * `value` itself when it clones as it is, else a plain-data copy (functions
 * and symbols dropped, class instances as their own fields).
 * @param {*} value
 * @param {string} where  for the report: what the value is
 */
export function toCloneable(value, where = 'value') {
  if (!needsConversion(value, new Set())) return value;
  return convert(value, where, '', new Map());
}
