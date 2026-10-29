// A committed shape queues a tool-manager import for its Select reset. The
// complete manager starts unrelated UI modules outside this gesture test.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '../../tools/manager.js'
      && context.parentURL?.endsWith('/js/tools/tools/shape-tool.js')) {
    return { url: 'data:text/javascript,export function maybeRevertToSelect() {}', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
