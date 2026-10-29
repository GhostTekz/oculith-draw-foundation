export function createAddon() {
  return {
    apiVersion: 1,
    id: 'sample.collision',
    panels: [{ id: 'sample-first-panel', title: 'Conflicting panel', icon: '',
      component: () => document.createElement('div') }],
  };
}
