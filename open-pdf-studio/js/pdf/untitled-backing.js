// A new PDF gets one exact native-reserved cache file. The renderer supplies
// bytes, never a path to authorize; Save As and tab close remove this file.
export async function writeUntitledBacking(bytes, tauri = window.__TAURI__) {
  const path = await tauri.core.invoke('create_untitled_pdf_backing');
  if (typeof path !== 'string' || !path) throw new Error('native untitled path unavailable');
  try {
    await tauri.fs.writeFile(path, bytes);
  } catch (error) {
    try { await tauri.fs.remove(path); } catch { /* preserve the write error */ }
    throw error;
  }
  return path;
}
