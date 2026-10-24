// Native code resolves and grants only the app-owned template collections.
// Do not grant a path supplied by a PDF or by the renderer here.
export async function getTemplateDirs(kind) {
  const dirs = await window.__TAURI__?.core?.invoke('allow_template_scope', { kind });
  if (!dirs?.userDir || !dirs?.bundledDir) {
    throw new Error(`template collection unavailable: ${kind}`);
  }
  return dirs;
}
