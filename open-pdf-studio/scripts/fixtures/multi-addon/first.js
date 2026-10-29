export function createAddon() {
  return {
    apiVersion: 1,
    id: 'sample.first',
    panels: [{ id: 'sample-first-panel', title: 'First panel', icon: '', shortcut: 'Alt+5',
      component: () => document.createElement('div') }],
    dialogs: { 'sample-first-dialog': () => document.createElement('div') },
  };
}
