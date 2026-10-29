import { hasRegisteredTool, registerTool } from './tool-registry.js';
import { shapeTool } from './tools/shape-tool.js';

/** Register composed box aliases after the editor's own tools. */
export function registerAddonBoxTools(boxTools) {
  for (const tool of boxTools || []) {
    if (!hasRegisteredTool(tool.id)) registerTool(tool.id, shapeTool);
  }
}
