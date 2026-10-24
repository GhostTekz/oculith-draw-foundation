// Visual Search state (Search panel ▸ Visual Search, Tools ▸ Visual Search):
// the picked symbol, the search options, the running search and the results.
// The search itself lives in tools/visual-search/session.js.

import { createSignal, createMemo } from 'solid-js';
import { DEFAULT_THRESHOLD } from '../../tools/visual-search/matcher.js';

/**
 * @typedef {{ docId:any, page:number, rect:{x:number,y:number,width:number,height:number},
 *   scale:number, width:number, height:number, data:Float32Array,
 *   thumb:{width:number,height:number,data:Uint8ClampedArray} }} VisualSearchTemplate
 * @typedef {{ id:number, page:number, x:number, y:number, width:number, height:number, score:number,
 *   rotation:number, scale:number, included:boolean,
 *   thumb?:{width:number,height:number,data:Uint8ClampedArray} }} VisualSearchResult
 */

/** @type {[() => VisualSearchTemplate|null, (v: VisualSearchTemplate|null) => void]} */
const [template, setTemplate] = createSignal(null);
/** 'idle' | 'picking' | 'searching' | 'done' | 'cancelled' | 'error' */
const [status, setStatus] = createSignal('idle');
const [scope, setScope] = createSignal('page'); // 'page' | 'all'
const [rotations, setRotations] = createSignal(true);
const [scaleStep, setScaleStep] = createSignal(false);
const [threshold, setThreshold] = createSignal(DEFAULT_THRESHOLD);
/** @type {[() => VisualSearchResult[], (v: VisualSearchResult[]) => void]} */
const [results, setResults] = createSignal([]);
const [progress, setProgress] = createSignal({ done: 0, total: 0 });
const [lastMessage, setLastMessage] = createSignal(null); // { key, count? }
const [elapsedMs, setElapsedMs] = createSignal(0);
/** Document (id) the results belong to. */
const [resultsDocId, setResultsDocId] = createSignal(null);

export {
  template, setTemplate, status, setStatus, scope, setScope, rotations, setRotations,
  scaleStep, setScaleStep, threshold, setThreshold, results, setResults, progress, setProgress,
  lastMessage, setLastMessage, elapsedMs, setElapsedMs, resultsDocId, setResultsDocId,
};

/** The key Visual Search uses for a document (templates and results belong to one). */
export const docKey = (doc) => doc?.id ?? doc?.filePath ?? null;

/** Results at or above the similarity threshold (included or not), best first. */
export const visibleResults = createMemo(() => results().filter((r) => r.score >= threshold()));
/** The results that Create count markups / Highlight would turn into markups. */
export const chosenResults = createMemo(() => visibleResults().filter((r) => r.included !== false));

/** Include or exclude one result. */
export function setResultIncluded(id, included) {
  setResults(results().map((r) => (r.id === id ? { ...r, included } : r)));
}

/** Include or exclude every visible result. */
export function setAllIncluded(included) {
  const t = threshold();
  setResults(results().map((r) => (r.score >= t ? { ...r, included } : r)));
}
