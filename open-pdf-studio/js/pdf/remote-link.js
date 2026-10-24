// Links to another PDF (/GoToR, "go to remote"): the relative file paths Set
// Batch Link writes, and the rules for following one.
//
// A /GoToR file specification is a path with '/' separators, relative to the
// folder of the PDF that holds the link (PDF 32000-1 7.11.2). PDFs are
// untrusted input, so only a plain relative path to a .pdf is accepted: no
// scheme, no drive letter, no leading slash, no backslash, no control
// characters. '..' is allowed (a sheet in a sibling folder); whether the
// resolved file may be opened without asking is decided by isInsideDirectory()
// against the folders the user already works in.
//
// Pure: no app imports, no DOM.

const CONTROL = /[\u0000-\u001f\u007f]/u;

/** Is `path` a relative PDF path a /GoToR link may carry? */
export function isSafeRelativePdfPath(path) {
  if (typeof path !== 'string' || !path || path.length > 1024) return false;
  if (CONTROL.test(path) || path.includes('\\') || path.includes(':')) return false;
  if (path.startsWith('/') || !/\.pdf$/iu.test(path)) return false;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.')) return false;
  // The file itself is a name, not '..'.
  return parts[parts.length - 1] !== '..';
}

const toSlashes = (path) => String(path ?? '').replace(/\\/gu, '/');

/** Path segments of a '/'-path with '.' and '..' applied; null when '..' climbs above the start. */
function normalizeSegments(parts) {
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out;
}

/** The leading root of an absolute path ('/', 'C:/', '//server/share/') and the rest. */
function splitRoot(path) {
  const p = toSlashes(path);
  const unc = /^\/\/[^/]+\/[^/]+\/?/u.exec(p);
  if (unc) return { root: unc[0].endsWith('/') ? unc[0] : `${unc[0]}/`, rest: p.slice(unc[0].length) };
  const drive = /^[a-z]:\/?/iu.exec(p);
  if (drive) return { root: `${p.slice(0, 2)}/`, rest: p.slice(drive[0].length) };
  if (p.startsWith('/')) return { root: '/', rest: p.slice(1) };
  return { root: '', rest: p };
}

const sameKey = (a, b, caseless) => (caseless ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b);
const caselessRoot = (root) => /^[a-z]:\//iu.test(root) || root.startsWith('//');

/**
 * The deepest folder that holds every path (with '/' separators), or '' when
 * they share no folder (different drives, or relative names only).
 */
export function commonDirectory(paths) {
  const list = (paths || []).map(splitRoot);
  if (!list.length) return '';
  const { root } = list[0];
  const caseless = caselessRoot(root);
  if (list.some((p) => !sameKey(p.root, root, caseless))) return '';
  const dirs = list.map((p) => {
    const parts = normalizeSegments(p.rest.split('/')) || [];
    return parts.slice(0, -1);
  });
  const common = [];
  for (let i = 0; ; i++) {
    const part = dirs[0][i];
    if (part === undefined || dirs.some((d) => d[i] === undefined || !sameKey(d[i], part, caseless))) break;
    common.push(part);
  }
  if (!root && !common.length) return '';
  return root + common.join('/');
}

/**
 * `path` relative to the folder `dir` ('/'-separated), or null when it does
 * not lie inside it.
 */
export function pathInside(path, dir) {
  const a = splitRoot(path);
  const b = splitRoot(dir);
  const caseless = caselessRoot(a.root);
  if (!sameKey(a.root, b.root, caseless)) return null;
  const parts = normalizeSegments(a.rest.split('/'));
  const base = normalizeSegments(b.rest.split('/'));
  if (!parts || !base || parts.length <= base.length) return null;
  for (let i = 0; i < base.length; i++) if (!sameKey(parts[i], base[i], caseless)) return null;
  return parts.slice(base.length).join('/');
}

/** Is `path` inside the folder `dir` (any depth)? */
export function isInsideDirectory(path, dir) {
  return !!dir && pathInside(path, dir) !== null;
}

/**
 * The /GoToR file path from the file at `from` to the file at `to`, both
 * given relative to one set folder ('A/A-101.pdf', 'S/S-201.pdf' ->
 * '../S/S-201.pdf'). Null when either is not a safe relative path.
 */
export function relativePdfPath(from, to) {
  const a = normalizeSegments(toSlashes(from).split('/'));
  const b = normalizeSegments(toSlashes(to).split('/'));
  if (!a?.length || !b?.length) return null;
  const fromDir = a.slice(0, -1);
  let same = 0;
  while (same < fromDir.length && same < b.length - 1 && fromDir[same] === b[same]) same++;
  const rel = [...Array(fromDir.length - same).fill('..'), ...b.slice(same)].join('/');
  return isSafeRelativePdfPath(rel) ? rel : null;
}

/** The folder of a file path, in that path's own separator style. */
export function directoryOf(filePath) {
  const p = String(filePath ?? '');
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return cut >= 0 ? p.slice(0, cut) : '';
}

/**
 * Resolve a relative link path against the file holding the link. Returns
 * the absolute path in the base path's separator style, or null when the
 * link is unsafe or climbs above the drive root.
 */
export function resolveRelativePdfPath(baseFilePath, rel) {
  if (!isSafeRelativePdfPath(rel)) return null;
  const base = String(baseFilePath ?? '');
  const backslash = base.includes('\\') && !base.includes('/');
  const { root, rest } = splitRoot(base);
  const dirParts = (normalizeSegments(rest.split('/')) || []).slice(0, -1);
  const parts = normalizeSegments([...dirParts, ...rel.split('/')]);
  if (!parts) return null;
  const joined = root + parts.join('/');
  return backslash ? joined.replace(/\//gu, '\\') : joined;
}

/**
 * A PDF.js link annotation's raw /GoToR target ("S/S-201.pdf#[1,{"name":"Fit"}]",
 * "S.pdf#S-201", "S.pdf#page=2") -> { file, page } or { file, dest }, or
 * null when it is not a relative PDF link. PDF.js joins the file and the
 * remote destination with '#' (explicit destinations as JSON).
 */
export function parseRemotePdfLink(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const hash = raw.indexOf('#');
  const file = hash >= 0 ? raw.slice(0, hash) : raw;
  if (!isSafeRelativePdfPath(file)) return null;
  const tail = hash >= 0 ? raw.slice(hash + 1) : '';
  if (!tail) return { file, page: 1 };
  if (tail.startsWith('[')) {
    try {
      const dest = JSON.parse(tail);
      const index = Array.isArray(dest) ? dest[0] : null;
      if (Number.isInteger(index) && index >= 0) return { file, page: index + 1 };
    } catch { /* not an explicit destination */ }
    return { file, page: 1 };
  }
  const pageParam = /^page=(\d{1,6})$/u.exec(tail);
  if (pageParam) return { file, page: Math.max(1, Number(pageParam[1])) };
  return CONTROL.test(tail) ? { file, page: 1 } : { file, dest: tail };
}
