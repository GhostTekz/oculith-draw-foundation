// Raceway drawing session: the run settings the next run gets (conduit type
// and size, tray style and dimensions, corner snapping) and the run being
// drawn. Read by the canvas tool (tools/raceway-tool.js) and the options bar
// (RacewayBar.jsx). Settings are remembered in preferences.

import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';
import {
  normalizeRaceway, DEFAULT_CONDUIT, DEFAULT_TRAY, BEND_ANGLES, MAX_TAG_LENGTH,
} from '../../annotations/raceway.js';

const prefs = () => state.preferences || {};

function initial() {
  const p = prefs();
  return {
    kind: p.racewayKind === 'tray' ? 'tray' : 'conduit',
    conduit: normalizeRaceway({ ...DEFAULT_CONDUIT, ...(p.racewayConduit || {}), kind: 'conduit' }),
    tray: normalizeRaceway({ ...DEFAULT_TRAY, ...(p.racewayTray || {}), kind: 'tray' }),
    // Corner snapping to standard elbows, relative to the previous leg.
    snapBends: p.racewaySnapBends !== false,
    angles: Array.isArray(p.racewayAngles) && p.racewayAngles.every((a) => BEND_ANGLES.includes(a)) && p.racewayAngles.length
      ? [...p.racewayAngles] : [...BEND_ANGLES],
    // Run ID for the next runs (circuit, feeder); not remembered.
    tag: '',
  };
}

const [settings, setSettingsSignal] = createSignal(initial());
// The run being drawn: point count and its live label, for the bar.
const [drawing, setDrawing] = createSignal({ points: 0, text: '', marks: {} });
export { settings, drawing, setDrawing };

/** The raceway object the next run gets. */
export function activeRaceway() {
  const s = settings();
  return s.kind === 'tray' ? s.tray : s.conduit;
}

/**
 * Change settings: `kind`, `conduit` / `tray` patches, `snapBends`, `angles`.
 * Values are normalised (raceway.js) and remembered.
 */
export function setSettings(patch) {
  const cur = settings();
  const next = { ...cur };
  if (patch.kind === 'tray' || patch.kind === 'conduit') next.kind = patch.kind;
  if (patch.conduit) next.conduit = normalizeRaceway({ ...cur.conduit, ...patch.conduit, kind: 'conduit' });
  if (patch.tray) next.tray = normalizeRaceway({ ...cur.tray, ...patch.tray, kind: 'tray' });
  if (typeof patch.snapBends === 'boolean') next.snapBends = patch.snapBends;
  if (typeof patch.tag === 'string') next.tag = patch.tag.slice(0, MAX_TAG_LENGTH);
  if (Array.isArray(patch.angles)) {
    const a = BEND_ANGLES.filter((x) => patch.angles.includes(x));
    next.angles = a.length ? a : cur.angles;
  }
  setSettingsSignal(next);
  const p = prefs();
  p.racewayKind = next.kind;
  p.racewayConduit = { ...next.conduit };
  p.racewayTray = { ...next.tray };
  p.racewaySnapBends = next.snapBends;
  p.racewayAngles = [...next.angles];
  import('../../core/preferences.js').then((m) => m.savePreferences?.()).catch(() => {});
}
