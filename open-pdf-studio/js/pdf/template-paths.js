// Tauri filesystem paths come from the host OS. Keep the separator of the
// parent path when scanning user and bundled PDF template directories.
export function joinTemplatePath(parent, child) {
  if (parent.endsWith('/') || parent.endsWith('\\')) return parent + child;
  return `${parent}${parent.includes('\\') ? '\\' : '/'}${child}`;
}
