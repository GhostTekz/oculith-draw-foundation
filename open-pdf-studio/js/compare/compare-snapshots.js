import { validateComparePlan } from './compare-plan.js';

// Keep the existing storage key so version 1 entries can be read as legacy
// history. Version 2 adds hashes; a legacy entry can never be restored.
export const COMPARE_SNAPSHOTS_KEY = 'ocudraw.compare-snapshots.v1';
export const MAX_COMPARE_SNAPSHOTS = 8;
const MAX_STORED_CHARACTERS = 256 * 1024;
const HASH = /^[0-9a-f]{64}$/u;

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}

function browserStorage() {
  try { return globalThis.localStorage; }
  catch { return null; }
}

function validIdentity(value) {
  return value?.algorithm === 'SHA-256' && HASH.test(value.old) && HASH.test(value.new)
    && Object.keys(value).length === 3;
}

export async function comparePdfContentIdentity(oldBytes, newBytes, cryptoProvider = globalThis.crypto) {
  if (!(oldBytes instanceof Uint8Array) || !oldBytes.byteLength
      || !(newBytes instanceof Uint8Array) || !newBytes.byteLength) {
    throw new Error('Both selected PDFs must have loaded bytes before saving or restoring a session.');
  }
  if (!cryptoProvider?.subtle?.digest) throw new Error('Secure PDF fingerprinting is unavailable in this browser. Use a plan JSON file instead.');
  const digest = async bytes => Array.from(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const [old, newer] = await Promise.all([digest(oldBytes), digest(newBytes)]);
  return { algorithm: 'SHA-256', old, new: newer };
}

export function compareSnapshotIdentityMatches(saved, current) {
  return validIdentity(saved) && validIdentity(current)
    && saved.old === current.old && saved.new === current.new;
}

function storedEntries(storage) {
  try {
    const raw = storage?.getItem(COMPARE_SNAPSHOTS_KEY);
    if (!raw || raw.length > MAX_STORED_CHARACTERS) return [];
    const saved = JSON.parse(raw);
    if (saved?.format !== 'ocudraw.compare-snapshots' || ![1, 2].includes(saved.version) || !Array.isArray(saved.entries)) return [];
    return saved.entries.slice(0, MAX_COMPARE_SNAPSHOTS).flatMap(entry => {
      if (!entry || typeof entry.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/u.test(entry.id) || !validTime(entry.savedAt)) return [];
      if (saved.version === 2 && entry.identity !== null && !validIdentity(entry.identity)) return [];
      try { return [{ id: entry.id, savedAt: entry.savedAt, plan: validateComparePlan(entry.plan),
        identity: saved.version === 1 ? null : entry.identity }]; }
      catch { return []; }
    });
  } catch { return []; }
}

export function readCompareSnapshots(storage = browserStorage()) {
  return storedEntries(storage);
}

export function compareSnapshotMatches(plan, selected) {
  return plan?.documents?.old?.path === selected?.oldPath
    && plan?.documents?.new?.path === selected?.newPath
    && plan?.documents?.old?.pageCount === selected?.oldPageCount
    && plan?.documents?.new?.pageCount === selected?.newPageCount;
}

function writeEntries(storage, entries) {
  if (!storage?.setItem) throw new Error('Local comparison history is unavailable.');
  let kept = entries;
  let json = JSON.stringify({ format: 'ocudraw.compare-snapshots', version: 2, entries: kept });
  while (json.length > MAX_STORED_CHARACTERS && kept.length > 1) {
    kept = kept.slice(0, -1);
    json = JSON.stringify({ format: 'ocudraw.compare-snapshots', version: 2, entries: kept });
  }
  if (json.length > MAX_STORED_CHARACTERS) throw new Error('This comparison is too large for local history. Save a plan JSON file instead.');
  try { storage.setItem(COMPARE_SNAPSHOTS_KEY, json); }
  catch { throw new Error('Could not save local comparison history. Save a plan JSON file instead.'); }
  return kept;
}

export function saveCompareSnapshot(plan, identity, storage = browserStorage(), savedAt = new Date().toISOString()) {
  const verified = validateComparePlan(plan);
  if (!validIdentity(identity)) throw new Error('A SHA-256 fingerprint for both PDFs is required to save a local session.');
  if (!validTime(savedAt)) throw new Error('A valid save time is required.');
  const current = storedEntries(storage);
  const samePlan = current.find(entry => JSON.stringify(entry.plan) === JSON.stringify(verified)
    && compareSnapshotIdentityMatches(entry.identity, identity));
  const id = samePlan?.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const next = [{ id, savedAt, plan: verified, identity: { ...identity } }, ...current.filter(entry => entry.id !== id)].slice(0, MAX_COMPARE_SNAPSHOTS);
  return writeEntries(storage, next);
}

export function removeCompareSnapshot(id, storage = browserStorage()) {
  return writeEntries(storage, storedEntries(storage).filter(entry => entry.id !== id));
}
