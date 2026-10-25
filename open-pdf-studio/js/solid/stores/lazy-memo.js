// A memo that exists only while something reactive reads it. A module-level
// createMemo is computed at import and re-runs on every change of what it
// reads, panel open or not: a count, schedule or spaces total walked every
// markup of the drawing on every edit. This one is created on the first
// tracked read, disposed when its last reader is cleaned up, and computed
// once (untracked) for a read outside any reactive scope.
import { createMemo, createRoot, getOwner, onCleanup, untrack } from 'solid-js';

export function lazyMemo(fn) {
  let memo = null;
  let dispose = null;
  let readers = 0;
  return () => {
    if (!getOwner()) return memo ? memo() : untrack(fn);
    if (!memo) createRoot((d) => { dispose = d; memo = createMemo(fn); });
    readers++;
    onCleanup(() => {
      readers--;
      // A reader that re-runs cleans up and reads again at once: give it a
      // tick before tearing the memo down.
      if (readers === 0) setTimeout(() => {
        if (readers === 0 && dispose) { dispose(); dispose = null; memo = null; }
      }, 0);
    });
    return memo();
  };
}
