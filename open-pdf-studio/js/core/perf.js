// Per-operation timings for finding slow paths on real drawings: each named
// operation keeps a count, total, max and its last samples (for p50/p95),
// plus a count of main-thread stalls (a frame that came more than 100 ms
// late). Cheap enough to stay on: one performance.now() pair per operation.
// The summary goes to the app log on demand (perfFlush), every minute when
// the app is started with OPDS_PERF=1, and to the MCP perf snapshot. Only
// names and timings are recorded, never drawing content.
import { invoke, isTauri } from './platform.js';

const SAMPLES = 256;
const ops = new Map();
let stalls = { count: 0, longest: 0, over200: 0 };

function entry(name) {
  let e = ops.get(name);
  if (!e) { e = { count: 0, total: 0, max: 0, ring: new Float64Array(SAMPLES), next: 0 }; ops.set(name, e); }
  return e;
}

/** Record one sample of `name` lasting `ms`. */
export function perfRecord(name, ms) {
  if (!Number.isFinite(ms)) return;
  const e = entry(name);
  e.count++;
  e.total += ms;
  if (ms > e.max) e.max = ms;
  e.ring[e.next % SAMPLES] = ms;
  e.next++;
}

/** Time `fn` (sync or async) as `name`; returns what it returns. */
export function perfTime(name, fn) {
  const t0 = performance.now();
  let out;
  try { out = fn(); } catch (err) { perfRecord(name, performance.now() - t0); throw err; }
  if (out && typeof out.then === 'function') {
    return out.finally(() => perfRecord(name, performance.now() - t0));
  }
  perfRecord(name, performance.now() - t0);
  return out;
}

/** Start timing `name`; call the returned function when it ends. */
export function perfSpan(name) {
  const t0 = performance.now();
  return () => perfRecord(name, performance.now() - t0);
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** The timings so far: `{ ops: { name: { count, mean, p50, p95, max } }, stalls }`. */
export function perfSnapshot() {
  const out = {};
  for (const [name, e] of ops) {
    const n = Math.min(e.next, SAMPLES);
    const sorted = Array.from(e.ring.subarray(0, n)).sort((a, b) => a - b);
    const r = (v) => Math.round(v * 10) / 10;
    out[name] = { count: e.count, mean: r(e.total / e.count), p50: r(quantile(sorted, 0.5)), p95: r(quantile(sorted, 0.95)), max: r(e.max) };
  }
  // Hidden windows get their timers stretched to a second by the web view:
  // timings taken then are not the app's speed.
  return { ops: out, stalls: { ...stalls }, retained: perfRetained(), visible: typeof document === 'undefined' ? null : document.visibilityState, hiddenMs: Math.round(hiddenMs + (hiddenSince ? performance.now() - hiddenSince : 0)) };
}

/** Forget the timings (for a measured run that starts clean). */
export function perfReset() {
  ops.clear();
  stalls = { count: 0, longest: 0, over200: 0 };
  hiddenMs = 0;
  hiddenSince = typeof document !== 'undefined' && document.hidden ? performance.now() : 0;
}

// How long the window was out of view since the last reset.
let hiddenMs = 0;
let hiddenSince = 0;
if (typeof document !== 'undefined') {
  if (document.hidden) hiddenSince = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenSince = performance.now();
    else if (hiddenSince) { hiddenMs += performance.now() - hiddenSince; hiddenSince = 0; }
  });
}

/** Write the summary to the app log (one line per operation). */
export async function perfFlush(reason = 'on request') {
  const snap = perfSnapshot();
  const lines = [`timings (${reason}): stalls ${snap.stalls.count} (>200 ms ${snap.stalls.over200}, longest ${Math.round(snap.stalls.longest)} ms)`];
  for (const [name, s] of Object.entries(snap.ops).sort((a, b) => b[1].p95 * b[1].count - a[1].p95 * a[1].count)) {
    lines.push(`${name}: n=${s.count} mean=${s.mean} p50=${s.p50} p95=${s.p95} max=${s.max} ms`);
  }
  if (isTauri()) { try { await invoke('perf_log', { lines }); } catch { /* an older shell without the command */ } }
  return lines;
}

// Main-thread stalls: a frame later than 100 ms after the previous one,
// while the page is visible.
let last = 0;
function frame(now) {
  if (last && !document.hidden) {
    const gap = now - last;
    if (gap > 100) {
      stalls.count++;
      if (gap > 200) stalls.over200++;
      if (gap > stalls.longest) stalls.longest = gap;
    }
  }
  last = now;
  requestAnimationFrame(frame);
}

/** Start the stall counter and, with OPDS_PERF=1, the minute-by-minute log. */
export async function startPerf() {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);
  if (!isTauri()) return;
  let enabled = false;
  try { enabled = await invoke('perf_enabled'); } catch { enabled = false; }
  if (enabled) setInterval(() => { perfFlush('every minute'); }, 60_000);
}

// Retention watch: weak references to objects that should be gone (a
// closed document, its markups, its parses). perfSnapshot lists the ones a
// garbage collection has not freed, to find what keeps memory alive.
const watched = [];
export function perfWatch(label, obj) {
  if (!obj || typeof obj !== 'object' || typeof WeakRef === 'undefined') return;
  watched.push({ label, ref: new WeakRef(obj), at: Date.now() });
  if (watched.length > 200) watched.splice(0, watched.length - 200);
}
export function perfRetained() {
  return watched.filter((w) => w.ref.deref() !== undefined).map((w) => `${w.label} (${Math.round((Date.now() - w.at) / 1000)} s)`);
}
