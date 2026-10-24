try {
  const p = JSON.parse(localStorage.getItem('pdfEditorPreferences') || '{}');
  if (p.theme) {
    let t = p.theme;
    if (['dark', 'blue', 'amber-navy'].includes(t)) t = 'default';
    if (t === 'system') {
      // Oculith dark ('default') or Oculith light, matching js/core/preferences.js.
      try { t = window.__TAURI__?.window?.getCurrentWindow()?.theme() === 'dark' ? 'default' : 'light'; }
      catch(e2) { t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'default' : 'light'; }
    }
    document.documentElement.setAttribute('data-theme', t);
  }
} catch(e) {}
