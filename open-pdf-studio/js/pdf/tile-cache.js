// LRU cache for region-tile ImageBitmaps used at high zoom.
// Keys: `${filePath}|p${pageNum}|z${zoomBucket}|r${rotation}|reg${regionBucket}`
// regionBucket = "x,y" in PDF points snapped to 25%-viewport buffer grid.
// Smaller than bitmap-cache because tiles are bigger; LRU max 8.

import { findBestCoveringTile } from './tile-coverage.js';
import { sourceRenderRevision, sourceRenderCurrent, sourceWriteActive } from './source-render-revision.js';
import { closeBitmap } from './bitmap-lifetime.js';
import { registerBitmapCache, enforceBitmapBudget } from './bitmap-budget.js';

const CACHE = new Map();
const EPOCHS = new Map();
const epoch = path => EPOCHS.get(path) || 0;
const MAX = 8;
const PENDING = new Map();
let globalEpoch = 0;

function cacheBytes() {
  let bytes = 0;
  for (const entry of CACHE.values()) bytes += entry.w * entry.h * 4;
  return bytes;
}

// Drop the least recently used tile; the newest one always stays. Bytes are
// bounded by the shared bitmap budget (bitmap-budget.js).
function evictOldest() {
  if (CACHE.size <= 1) return 0;
  const oldest = CACHE.keys().next().value;
  const old = CACHE.get(oldest);
  CACHE.delete(oldest);
  closeBitmap(old?.bitmap);
  return old ? old.w * old.h * 4 : 0;
}

registerBitmapCache('tiles', { bytes: cacheBytes, evictOldest });

function makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket) {
  return `${filePath}|p${pageNum}|z${Math.round(zoomBucket * 10000)}|r${rotation || 0}|reg${regionBucket}`;
}

export function tileCacheGet(filePath, pageNum, zoomBucket, rotation, regionBucket) {
  if (sourceWriteActive(filePath)) return null;
  const key = makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket);
  const entry = CACHE.get(key);
  if (entry) {
    CACHE.delete(key);
    CACHE.set(key, entry);
  }
  return entry || null;
}

export function tileCacheFindCovering(filePath, pageNum, rotation, request) {
  if (sourceWriteActive(filePath)) return null;
  const pagePrefix = `${filePath}|p${pageNum}|`;
  const rotationPart = `|r${rotation || 0}|`;
  const candidates = [];

  for (const [key, entry] of CACHE) {
    if (key.startsWith(pagePrefix) && key.includes(rotationPart)) {
      candidates.push({ key, entry, regionMeta: entry.regionMeta });
    }
  }

  const hit = findBestCoveringTile(candidates, request);
  if (!hit) return null;

  CACHE.delete(hit.key);
  CACHE.set(hit.key, hit.entry);
  return hit.entry;
}

export async function tileCacheSet(filePath, pageNum, zoomBucket, rotation, regionBucket, imageData, regionMeta, sourceRevision = sourceRenderRevision(filePath)) {
  if (!sourceRenderCurrent(filePath, sourceRevision)) return;
  const startEpoch = epoch(filePath);
  const startGlobalEpoch = globalEpoch;
  const key = makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket);
  const token = Symbol(key);
  PENDING.set(key, token);
  try {
    const bitmap = await createImageBitmap(imageData);
    if (globalEpoch !== startGlobalEpoch || epoch(filePath) !== startEpoch
        || PENDING.get(key) !== token || !sourceRenderCurrent(filePath, sourceRevision)) {
      closeBitmap(bitmap);
      return;
    }
    const replaced = CACHE.get(key);
    closeBitmap(replaced?.bitmap);
    CACHE.delete(key);
    CACHE.set(key, { bitmap, w: imageData.width, h: imageData.height, regionMeta });
    while (CACHE.size > MAX && evictOldest() > 0) { /* drop the oldest */ }
    enforceBitmapBudget();
  } catch (e) {
    console.warn('[tile-cache] createImageBitmap failed:', e);
  } finally {
    if (PENDING.get(key) === token) PENDING.delete(key);
  }
}

export function tileCacheClearForFile(filePath) {
  EPOCHS.set(filePath, epoch(filePath) + 1);
  for (const key of PENDING.keys()) {
    if (key.startsWith(filePath + '|')) PENDING.delete(key);
  }
  for (const k of Array.from(CACHE.keys())) {
    if (k.startsWith(filePath + '|')) {
      const e = CACHE.get(k);
      closeBitmap(e?.bitmap);
      CACHE.delete(k);
    }
  }
}

export function tileCacheClearAll() {
  globalEpoch++;
  PENDING.clear();
  EPOCHS.clear();
  for (const e of CACHE.values()) {
    closeBitmap(e?.bitmap);
  }
  CACHE.clear();
}
