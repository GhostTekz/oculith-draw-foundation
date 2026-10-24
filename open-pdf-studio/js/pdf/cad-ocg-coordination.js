// CAD extraction reads the source PDF without the selected OCG state. Keep a
// visibility change from overtaking a native scan/export that is still using
// the old state. The native exporter honors cancellation before its final
// file rename; waiting for its response closes the handoff.
const active = new WeakMap();
const changing = new WeakSet();

export function beginCadOperation(doc, cancel) {
  if (changing.has(doc)) throw new Error('The native PDF layer selection is changing. Start CAD export again.');
  let operations = active.get(doc);
  if (!operations) {
    operations = new Set();
    active.set(doc, operations);
  }
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const operation = { cancel, done };
  operations.add(operation);
  return () => {
    operations.delete(operation);
    if (!operations.size) active.delete(doc);
    resolveDone();
  };
}

export async function settleCadOperationsBeforeLayerChange(doc) {
  changing.add(doc);
  const operations = [...(active.get(doc) || [])];
  for (const operation of operations) {
    Promise.resolve().then(operation.cancel).catch(() => {});
  }
  await Promise.all(operations.map(operation => operation.done));
  return () => changing.delete(doc);
}
