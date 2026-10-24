// Bumps when a stored geometry answer changes, so an open quantities
// schedule reads the new area. The signal lives outside the stores so the
// annotation path can notify them without importing either store.

import { createSignal } from 'solid-js';

const [geometryRev, setGeometryRev] = createSignal(0);

export function readGeometryRevision() {
  return geometryRev();
}

export function noteGeometry() {
  setGeometryRev((n) => n + 1);
}
