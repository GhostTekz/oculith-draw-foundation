// The Links panel (the external editor "Links"): the document's named destinations above its
// link annotations, both existing panel bodies unchanged.
import DestinationsPanel from '../left-panel/panels/DestinationsPanel.jsx';
import LinksPanel from '../left-panel/panels/LinksPanel.jsx';

export default function LinksPanels() {
  return (
    <div class="ws-links-panels">
      <DestinationsPanel />
      <LinksPanel />
    </div>
  );
}
