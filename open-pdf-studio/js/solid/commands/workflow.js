// Workflow toolbar commands: View ▸ Workflow ▸ <tab> (one per workflow tab,
// also in the command palette), and the commands an edition or add-on brings
// (edition.commands), which its workflow tabs and the Tools menu run.

import { registerCommand } from './registry.js';
import { WORKFLOWS } from './workflows.js';
import { edition } from '../../editions/active.js';
import { activeWorkflow, setActiveWorkflow } from '../stores/workflowStore.js';
import { isToolbarVisible, setToolbarVisible } from '../stores/workspaceLayout.js';

for (const command of edition.commands || []) {
  // A bad or clashing command of an add-on is left out; the editor starts.
  try { registerCommand({ category: 'tools', ...command }); } catch (error) { console.warn('[workflow] command not registered:', error); }
}

for (const wf of WORKFLOWS) {
  if (wf.contextual) continue;
  registerCommand({
    id: `view.workflow.${wf.id}`, label: wf.label, icon: wf.icon, category: 'view',
    keywords: ['workflow', 'tab', 'toolbar'],
    checked: () => activeWorkflow() === wf.id,
    run: () => {
      if (!isToolbarVisible('standard')) setToolbarVisible('standard', true);
      setActiveWorkflow(wf.id);
    },
  });
}
