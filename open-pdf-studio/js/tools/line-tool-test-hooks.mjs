// A committed line queues the app's tool-manager import. Its real startup
// side effects are outside this pointer-gesture test and keep Node alive.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '../../tools/manager.js'
      && context.parentURL?.endsWith('/js/tools/tools/line-tool.js')) {
    return {
      url: 'data:text/javascript,export function maybeRevertToSelect() {}',
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
