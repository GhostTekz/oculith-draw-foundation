// The edition helper (src-tauri/src/edition_helper.rs): a published, generic
// part of the editor. An edition plug-in calls the helper program its edition
// ships beside the editor; the editor only passes the calls and events on.
// Foundation has no helper: helperAvailable() is false and calls fail.
import { invoke, isTauri } from './platform.js';

/** Whether this edition ships a helper. */
export async function helperAvailable() {
  if (!isTauri()) return false;
  try { return await invoke('edition_helper_available'); } catch { return false; }
}

/**
 * One call to the helper; resolves with its result, rejects with its error.
 * `timeoutMs` rejects (error code 'timeout') when no answer comes in time,
 * instead of waiting forever on a helper that hangs.
 */
export function helperCall(method, params = null, { timeoutMs = 0 } = {}) {
  if (!isTauri()) return Promise.reject(new Error('The edition helper needs the desktop app.'));
  const call = invoke('edition_helper_call', { method, params });
  if (!(timeoutMs > 0)) return call;
  let timer = 0;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`The edition helper did not answer ${method} within ${Math.round(timeoutMs / 1000)} s.`), { code: 'timeout' })), timeoutMs);
  });
  return Promise.race([call, late]).finally(() => clearTimeout(timer));
}

/** Whether an enabled, verified package has its own native helper. */
export async function addonHelperAvailable(packageId) {
  if (!isTauri()) return false;
  try { return await invoke('addon_helper_available', { packageId }); } catch { return false; }
}

/** Route a call to one enabled package's helper. */
export function addonHelperCall(packageId, method, params = null, { timeoutMs = 0 } = {}) {
  if (!isTauri()) return Promise.reject(new Error('A native add-on helper needs the desktop app.'));
  const call = invoke('addon_helper_call', { packageId, method, params });
  if (!(timeoutMs > 0)) return call;
  let timer = 0;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`The add-on helper did not answer ${method} within ${Math.round(timeoutMs / 1000)} s.`), { code: 'timeout' })), timeoutMs);
  });
  return Promise.race([call, late]).finally(() => clearTimeout(timer));
}

let addonListening = null;
const addonHandlers = new Map();

/** Receive events from one package helper, including helper-exit. */
export async function onAddonHelperEvent(packageId, name, handler) {
  const key = `${packageId}\0${name}`;
  if (!addonHandlers.has(key)) addonHandlers.set(key, new Set());
  const subscribers = addonHandlers.get(key);
  subscribers.add(handler);
  if (!addonListening) {
    const events = globalThis.window?.__TAURI__?.event;
    addonListening = Promise.resolve().then(() => {
      if (!events) throw new Error('A native add-on helper needs the desktop app.');
      return events.listen('addon-helper', ({ payload }) => {
        for (const fn of addonHandlers.get(`${payload?.packageId}\0${payload?.event}`) || []) fn(payload.payload);
      });
    }).catch((error) => {
      addonListening = null;
      throw error;
    });
  }
  try { await addonListening; }
  catch (error) {
    subscribers.delete(handler);
    if (!subscribers.size) addonHandlers.delete(key);
    throw error;
  }
  return () => {
    subscribers.delete(handler);
    if (!subscribers.size) addonHandlers.delete(key);
  };
}

let listening = null;
const handlers = new Map();

/** Receive the helper's events named `name`. Returns a function that stops. */
export async function onHelperEvent(name, handler) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(handler);
  if (!listening) {
    const events = globalThis.window?.__TAURI__?.event;
    listening = events
      ? events.listen('edition-helper', ({ payload }) => {
        for (const fn of handlers.get(payload?.event) || []) fn(payload.payload);
      })
      : Promise.reject(new Error('The edition helper needs the desktop app.'));
  }
  await listening;
  return () => handlers.get(name)?.delete(handler);
}

/** Let the page open a drawing the helper downloaded to the app's drawings folder. */
export function allowDrawing(path) {
  return invoke('edition_allow_drawing', { path });
}

/** Bytes to base64 and back, for the helper's byte fields. */
export function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
  return btoa(text);
}
export function fromBase64(text) {
  const raw = atob(text || '');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Let the helper read a file the editor has open (for an upload). */
export function shareFile(path) {
  return invoke('edition_helper_share_file', { path });
}
