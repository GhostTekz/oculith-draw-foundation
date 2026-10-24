// Toon een bestand in de bestandsbeheerder van het OS (Verkenner / Finder /
// Linux-bestandsbeheer). Dun laagje boven het Rust-command
// `reveal_in_file_manager`; werkt alleen in de Tauri-shell (desktop).

import { invoke, isTauri } from './platform.js';

// Gecachet OS-type ('windows' | 'macos' | 'linux' | ...) — sync uitleesbaar
// via de globale os-plugin API, met userAgent-fallback voor web/dev.
let _osType = null;
function desktopOsType() {
  if (_osType !== null) return _osType;
  try {
    if (isTauri() && window.__TAURI__?.os) {
      _osType = window.__TAURI__.os.type();
      return _osType;
    }
  } catch { /* val terug op userAgent */ }
  const ua = navigator.userAgent || '';
  if (/Mac OS X|Macintosh/i.test(ua)) _osType = 'macos';
  else if (/Linux/i.test(ua)) _osType = 'linux';
  else _osType = 'windows';
  return _osType;
}

// i18n-key (namespace 'context') voor het platform-specifieke menulabel:
// Windows "Tonen in Verkenner", macOS "Tonen in Finder", Linux "Map met
// bestand openen".
export function revealInFileManagerLabelKey() {
  const t = desktopOsType();
  if (t === 'macos') return 'revealInFileManager.mac';
  if (t === 'linux') return 'revealInFileManager.linux';
  return 'revealInFileManager.windows';
}

// True als deze actie zin heeft voor het document: desktop-app én een echt
// bestandspad (naamloze/nieuwe documenten leven in een temp-bestand;
// '__memory__'-paden zijn in-memory documenten zonder bestand op schijf).
export function canRevealInFileManager(doc) {
  return !!(
    isTauri()
    && doc
    && doc.filePath
    && !doc.isUntitled
    && !doc.filePath.startsWith('__memory__')
  );
}

export async function revealInFileManager(path) {
  if (!isTauri() || !path) return false;
  try {
    return await invoke('reveal_in_file_manager', { path });
  } catch (e) {
    console.error('reveal_in_file_manager failed:', e);
    return false;
  }
}
