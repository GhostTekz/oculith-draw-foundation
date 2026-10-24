// The drag tests exercise geometry and commit behavior. Loading the full tool
// manager for its post-commit Select switch starts unrelated app handles.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/tools/manager.js') && context.parentURL?.endsWith('/tools/line-tool.js')) {
    return { url: 'data:text/javascript,export function maybeRevertToSelect() {}', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
