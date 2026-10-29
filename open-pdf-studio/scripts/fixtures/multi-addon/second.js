export function createAddon() {
  return {
    apiVersion: 1,
    id: 'sample.second',
    fileCommands: [{ id: 'sample.second.command', label: 'Second command', category: 'file',
      run: () => { globalThis.__secondCommandRan = true; } }],
    fileMenuItems: ['sample.second.command'],
    toolbarItems: [{ id: 'sample-second-button', title: 'Second', icon: '', run: () => {} }],
  };
}
