// A save can rewrite a path while an older native render is still crossing
// IPC. Keep a path revision at the paint boundary as well as Rust's cache
// generation: a response accepted before native invalidation may arrive late.
const revisions = new Map();
const writes = new Set();

export function sourceRenderRevision(path) {
  return revisions.get(path) || 0;
}

export function sourceWriteActive(path) {
  return writes.has(path);
}

export function sourceRenderCurrent(path, revision) {
  return !writes.has(path) && sourceRenderRevision(path) === revision;
}

export function beginSourceWrite(path) {
  if (!path || writes.has(path)) throw new Error('Source write already active');
  revisions.set(path, sourceRenderRevision(path) + 1);
  writes.add(path);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    writes.delete(path);
    // Renders started while the write was active may have read either version.
    revisions.set(path, sourceRenderRevision(path) + 1);
  };
}
