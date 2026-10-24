// Tools ▸ Visual Search: opens the Search panel on its Visual Search section
// and starts the symbol pick (drag a rectangle around a symbol). The search,
// results and count creation live in tools/visual-search/session.js.

import { registerCommand } from './registry.js';
import { lucide } from '../data/lucideIcons.js';
import { hasPdf } from './util.js';

registerCommand({
  id: 'tools.visualSearch', label: 'common:visualSearch.command', icon: lucide('scan-search'), category: 'tools',
  enabled: hasPdf, keywords: ['symbol', 'count', 'find', 'pattern', 'match'],
  run: async () => {
    const [{ activatePanel }, { pickSymbol }] = await Promise.all([
      import('../components/panels/panelActions.js'),
      import('../../tools/visual-search/session.js'),
    ]);
    activatePanel('search');
    return pickSymbol();
  },
});
