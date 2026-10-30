import { state } from './state.js';
import { edition } from '../editions/active.js';

let resolution = 0;

/** Resolve the author for future edits, without changing saved PDF authors. */
export async function refreshDefaultAuthor() {
  const current = ++resolution;
  const fallback = state.preferences.authorName || 'User';
  let provided = '';
  try { provided = await edition.authorName?.(); } catch { /* Keep the local preference. */ }
  if (current !== resolution) return;
  state.defaultAuthor = typeof provided === 'string' && provided.trim() ? provided.trim() : fallback;
}
