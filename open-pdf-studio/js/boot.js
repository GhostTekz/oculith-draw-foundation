// Start-up. The launch screen (the Oculith monolith, the edition, what is
// loading) shows at once, then the editor starts.
import { finish, setEdition, setStatus, startLaunchScreen } from './launch-screen.js';
import { edition as foundation } from './editions/community.js';

// The edition's word under the monolith: the last word of its product name.
const editionWord = (edition) => edition.launchWord || String(edition.productName || '').split(' ').pop();
const secondaryWindow = new URLSearchParams(location.search).get('view') === 'printqueue';

(async () => {
  if (secondaryWindow) document.getElementById('launch-screen')?.remove();
  else startLaunchScreen();
  const ready = new Promise((resolve) => {
    window.addEventListener('ocudraw:ready', resolve, { once: true });
    setTimeout(resolve, 30000); // never kept behind the screen
  });
  setStatus('Loading');
  setEdition(editionWord(foundation));
  setStatus('Starting');
  await import('./main.js');
  if (secondaryWindow) return;
  await ready;
  await finish();
})();
