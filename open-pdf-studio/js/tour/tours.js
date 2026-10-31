// The tour host: registered tours and anchors, the running tour and its
// remembered progress. The coach mark (solid/components/TourCoach.jsx) shows
// the current step. Tours come from the editor (the basics tour), from the
// active edition or add-ons (`tours` in their descriptor), and from
// registerTour() at run time.
import { createSignal } from 'solid-js';
import { edition } from '../editions/active.js';
import { createTourProgress, startRun, transition, validateTour } from './tour-model.js';
import { basicsTour, BASICS_TOUR_ID } from './foundation-tour.js';

const tours = new Map();
const anchors = new Map();
const progress = createTourProgress();
const [run, setRun] = createSignal(null);
const [step, setStep] = createSignal(null);
let generation = 0;

/** Add a tour (validated). Returns a function that removes it. */
export function registerTour(tour) {
  const checked = validateTour(tour);
  if (tours.has(checked.id)) throw new Error(`Duplicate tour id: ${checked.id}`);
  tours.set(checked.id, checked);
  return () => { if (tours.get(checked.id) === checked) tours.delete(checked.id); };
}

export function getTour(id) { return tours.get(id) || null; }
export function listTours() { return [...tours.values()]; }

/**
 * The tour Help shows: the last tour the edition or an add-on brought, else
 * the basics tour.
 */
export function primaryTourId() {
  const own = (edition.tours || []).map((tour) => tour.id).filter((id) => tours.has(id));
  return own.at(-1) || BASICS_TOUR_ID;
}

/**
 * Name a UI element for tours: `resolve` returns an element, a selector or a
 * list of selectors (the first visible one wins).
 */
export function registerTourAnchor(id, resolve) {
  if (typeof id !== 'string' || !id || typeof resolve !== 'function') throw new Error('Invalid tour anchor.');
  anchors.set(id, resolve);
  return () => { if (anchors.get(id) === resolve) anchors.delete(id); };
}

function visible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function query(selector) {
  try { return document.querySelector(selector); } catch { return null; }
}

/** The element a step points at, or null (the card then shows centred). */
export function resolveAnchor(anchor) {
  if (!anchor) return null;
  let target = anchor;
  if (anchors.has(anchor)) {
    try { target = anchors.get(anchor)(); } catch { return null; }
  } else if (anchor.startsWith('panel:')) {
    const id = anchor.slice(6).replace(/["\\]/g, '');
    target = [`.ws-panel-slot[data-panel="${id}"]`, `.ws-access-tab[data-panel="${id}"]`];
  }
  if (target && typeof target === 'object' && !Array.isArray(target) && target.nodeType === 1) return visible(target) ? target : null;
  for (const selector of Array.isArray(target) ? target : [target]) {
    if (typeof selector !== 'string') continue;
    const el = query(selector);
    if (visible(el)) return el;
  }
  return null;
}

// The editor's named anchors.
registerTourAnchor('open', () => ['.draw-open-button:not([hidden])', '#menu-file']);
registerTourAnchor('thumbnails', () => ['.ws-panel-slot[data-panel="thumbnails"]', '.ws-access-tab[data-panel="thumbnails"]']);
registerTourAnchor('page-navigation', () => ['#navigation-bar']);
registerTourAnchor('markup', () => ['.tp-float', '#menu-tools']);
registerTourAnchor('scale', () => ['#status-scale', '#nav-scale', '#menu-tools']);
registerTourAnchor('save', () => ['#menu-file']);

registerTour(basicsTour);
for (const tour of edition.tours || []) {
  try { registerTour(tour); } catch (error) { console.warn('[tour] an edition tour was not added:', error); }
}

// ---------------------------------------------------------------------------

/** The running tour's state for the coach mark: { tour, index, total, step } or null. */
export const activeTour = () => {
  const current = run();
  const shown = step();
  if (!current || !shown) return null;
  const tour = tours.get(current.tourId);
  return tour ? { tour, index: current.index, total: current.total, step: shown } : null;
};

export function tourProgress(id) { return progress.get(id); }
export function tourCompleted(id) { return progress.completed(id); }

/** Wait until the launch screen is gone (a tour started from it shows after). */
function afterLaunchScreen() {
  if (typeof document === 'undefined' || !document.getElementById('launch-screen')) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (!document.getElementById('launch-screen') || Date.now() - started > 15000) resolve();
      else setTimeout(check, 150);
    };
    check();
  });
}

async function show(next) {
  const mine = ++generation;
  setStep(null);
  setRun(next);
  if (!next) return;
  const tour = tours.get(next.tourId);
  const shown = tour?.steps[next.index];
  if (!shown) return;
  try {
    if (shown.panel || shown.command) {
      const { getCommand, runCommand } = await import('../solid/commands/registry.js');
      // Open (never toggle closed) the step's panel.
      if (shown.panel && getCommand(`window.panel.${shown.panel}`)) await runCommand(`window.panel.${shown.panel}`, { reveal: true });
      if (shown.command) await runCommand(shown.command);
    }
    await shown.prepare?.();
  } catch (error) { console.warn('[tour] a step could not prepare its view:', error); }
  // A frame for the view the step opened to lay out.
  await new Promise((resolve) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : resolve()));
  if (mine === generation) setStep(shown);
}

/**
 * Show a tour: a paused one continues at its step, any other starts at the
 * top (`restart` always starts at the top). Resolves false for an unknown id.
 */
export async function startTour(id = primaryTourId(), { restart = false } = {}) {
  const tour = tours.get(id);
  if (!tour) return false;
  const current = run();
  if (current && current.tourId !== id) progress.record(current.tourId, transition(current, 'pause').ended);
  await afterLaunchScreen();
  await show(startRun(tour, restart ? 0 : progress.resumeAt(id, tour.steps.length)));
  return true;
}

function act(action) {
  const current = run();
  if (!current) return;
  const { run: next, ended } = transition(current, action);
  if (ended) progress.record(current.tourId, ended);
  void show(next);
}

export const tourNext = () => act('next');
export const tourBack = () => act('back');
export const tourSkip = () => act('skip');
/** Close for now; the tour continues at this step next time. */
export const tourPause = () => act('pause');
