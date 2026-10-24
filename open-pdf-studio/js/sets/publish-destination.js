function normalizePath(path) {
  const value = String(path).replaceAll('\\', '/').toLocaleLowerCase();
  const drive = /^[a-z]:/u.exec(value)?.[0] || '';
  const rest = value.slice(drive.length);
  const absolute = rest.startsWith('/');
  const prefix = drive + (absolute ? '/' : '');
  const parts = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop();
      else if (!absolute) parts.push(part);
    } else parts.push(part);
  }
  return prefix + parts.join('/');
}

function recordedSources(register) {
  return register.sheets.flatMap(sheet => [sheet, ...sheet.history, ...(sheet.sourceAliases || [])]);
}

/** Reject a destination that could replace a current or historical source. */
export async function assertSafeSetDestination(path, register, { fileExists } = {}) {
  const sources = recordedSources(register);
  const destination = normalizePath(path);
  if (sources.some(source => normalizePath(source.filePath) === destination)) {
    throw new Error('Choose a new PDF path. A source drawing in this set cannot be overwritten.');
  }
  // Native save dialogs can return aliases such as symlinks or paths through
  // symlinked directories. Refusing every existing destination avoids writing
  // through an alias to a registered drawing and preserves previous exports.
  if (fileExists && await fileExists(path)) {
    throw new Error('Choose a new PDF path. Publishing cannot overwrite an existing file.');
  }
}
