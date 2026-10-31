// Guided tours: the data model, the step state machine and the remembered
// progress per tour. Pure: no DOM and no editor imports, so it is tested in
// Node and shared by the tour host (tours.js) and add-on validation.
//
// A tour is data: { id, title, textKey?, steps: [{ anchor, title, body,
// placement?, panel?, command?, prepare? }] }. `textKey` names the tour's
// translations in the common strings (`<textKey>.title`,
// `<textKey>.steps.<n>.title`, `<textKey>.steps.<n>.body.<line>`); its own
// English text is the fallback. `anchor` is a CSS selector, a registered
// anchor id or `panel:<id>`; `body` is one to three short lines; `panel` is a
// workspace panel opened before the step shows, `command` an editor command
// run before it and `prepare` an optional function for the same purpose.

export const TOUR_STORAGE_KEY = 'ocudraw.tours.v1';
export const MAX_STEPS = 24;
export const MAX_BODY_LINES = 3;
const ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/;
const PLACEMENTS = new Set(['auto', 'top', 'bottom', 'left', 'right', 'center']);
const TEXT_KEY = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

function text(value, what, max) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Tour ${what} must be text.`);
  const out = value.trim();
  if (out.length > max) throw new Error(`Tour ${what} is too long (${max} characters at most).`);
  return out;
}

/** A tour checked and frozen; throws on a malformed one. */
export function validateTour(tour) {
  if (!tour || typeof tour !== 'object' || Array.isArray(tour)) throw new Error('A tour must be an object.');
  if (typeof tour.id !== 'string' || !ID.test(tour.id)) throw new Error(`Invalid tour id: ${String(tour?.id)}`);
  const title = text(tour.title, 'title', 80);
  if (tour.textKey != null && (typeof tour.textKey !== 'string' || !TEXT_KEY.test(tour.textKey))) {
    throw new Error(`Tour ${tour.id} textKey must be a plain key.`);
  }
  if (!Array.isArray(tour.steps) || !tour.steps.length || tour.steps.length > MAX_STEPS) {
    throw new Error(`Tour ${tour.id} needs 1 to ${MAX_STEPS} steps.`);
  }
  const steps = tour.steps.map((step, index) => {
    if (!step || typeof step !== 'object') throw new Error(`Tour ${tour.id} step ${index + 1} must be an object.`);
    const lines = (Array.isArray(step.body) ? step.body : [step.body]).map((line) => text(line, 'step text', 160));
    if (lines.length > MAX_BODY_LINES) throw new Error(`Tour ${tour.id} step ${index + 1} has more than ${MAX_BODY_LINES} lines.`);
    if (step.anchor != null && (typeof step.anchor !== 'string' || !step.anchor.trim())) {
      throw new Error(`Tour ${tour.id} step ${index + 1} anchor must be a selector or anchor id.`);
    }
    const placement = step.placement ?? 'auto';
    if (!PLACEMENTS.has(placement)) throw new Error(`Tour ${tour.id} step ${index + 1} placement is invalid.`);
    if (step.command != null && (typeof step.command !== 'string' || !step.command)) {
      throw new Error(`Tour ${tour.id} step ${index + 1} command must be a command id.`);
    }
    if (step.panel != null && (typeof step.panel !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(step.panel))) {
      throw new Error(`Tour ${tour.id} step ${index + 1} panel must be a panel id.`);
    }
    if (step.prepare != null && typeof step.prepare !== 'function') {
      throw new Error(`Tour ${tour.id} step ${index + 1} prepare must be a function.`);
    }
    return Object.freeze({
      title: text(step.title, 'step title', 80),
      body: Object.freeze(lines),
      anchor: step.anchor ? step.anchor.trim() : null,
      placement,
      panel: step.panel || null,
      command: step.command || null,
      prepare: step.prepare || null,
    });
  });
  return Object.freeze({ id: tour.id, title, ...(tour.textKey ? { textKey: tour.textKey } : {}), steps: Object.freeze(steps) });
}

/**
 * The text of step `index` of `tour` in the interface language: `t` (an
 * i18next-style lookup with `defaultValue`) reads the tour's translations
 * under its `textKey`; without one, or for a missing line, the tour's own
 * text. Returns { tourTitle, title, body }.
 */
export function tourText(tour, index, t) {
  const step = tour.steps[index];
  const key = tour.textKey;
  const tr = (path, own) => {
    if (!key || typeof t !== 'function') return own;
    const out = t(`${key}.${path}`, { defaultValue: own });
    return typeof out === 'string' && out.trim() ? out : own;
  };
  return {
    tourTitle: tr('title', tour.title),
    title: tr(`steps.${index}.title`, step.title),
    body: step.body.map((line, j) => tr(`steps.${index}.body.${j}`, line)),
  };
}

/** A checked list of tours with unique ids. */
export function validateTours(tours, what = 'tours') {
  if (!Array.isArray(tours)) throw new Error(`${what} must be an array.`);
  const ids = new Set();
  return tours.map((tour) => {
    const checked = validateTour(tour);
    if (ids.has(checked.id)) throw new Error(`Duplicate tour id: ${checked.id}`);
    ids.add(checked.id);
    return checked;
  });
}

// ---------------------------------------------------------------------------
// The state machine. A run is { tourId, index, total } or null (no tour
// showing). Each transition returns { run, ended }: `ended` is null while the
// tour goes on, else how it ended ('done', 'skipped' or 'paused') with the
// step to resume at.

export function startRun(tour, at = 0) {
  const total = tour.steps.length;
  const index = Number.isInteger(at) && at >= 0 && at < total ? at : 0;
  return { tourId: tour.id, index, total };
}

export function transition(run, action) {
  if (!run) return { run: null, ended: null };
  switch (action) {
    case 'next':
      if (run.index + 1 >= run.total) return { run: null, ended: { status: 'done', step: 0 } };
      return { run: { ...run, index: run.index + 1 }, ended: null };
    case 'back':
      return { run: { ...run, index: Math.max(0, run.index - 1) }, ended: null };
    case 'skip':
      return { run: null, ended: { status: 'skipped', step: 0 } };
    case 'pause':
      return { run: null, ended: { status: 'paused', step: run.index } };
    case 'finish':
      return { run: null, ended: { status: 'done', step: 0 } };
    default:
      throw new Error(`Unknown tour action: ${String(action)}`);
  }
}

// ---------------------------------------------------------------------------
// Remembered progress: { [tourId]: { status, step } } in one storage entry.

const STATUSES = new Set(['done', 'skipped', 'paused']);

export function createTourProgress(storage = globalThis.localStorage) {
  const read = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(TOUR_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  };
  const write = (all) => {
    try { storage?.setItem(TOUR_STORAGE_KEY, JSON.stringify(all)); } catch { /* remembered for this session only */ }
  };
  return {
    /** { status, step } or null for a tour never shown or ended. */
    get(id) {
      const entry = read()[id];
      if (!entry || !STATUSES.has(entry.status)) return null;
      return { status: entry.status, step: Number.isInteger(entry.step) && entry.step >= 0 ? entry.step : 0 };
    },
    record(id, ended) {
      if (!ended || !STATUSES.has(ended.status)) return;
      const all = read();
      all[id] = { status: ended.status, step: ended.status === 'paused' ? ended.step : 0 };
      write(all);
    },
    forget(id) {
      const all = read();
      delete all[id];
      write(all);
    },
    /** Finished or skipped: not offered again on its own. */
    completed(id) {
      const entry = this.get(id);
      return entry?.status === 'done' || entry?.status === 'skipped';
    },
    /** Where a start continues: a paused tour at its step, any other from the top. */
    resumeAt(id, total) {
      const entry = this.get(id);
      return entry?.status === 'paused' && entry.step < total ? entry.step : 0;
    },
  };
}
