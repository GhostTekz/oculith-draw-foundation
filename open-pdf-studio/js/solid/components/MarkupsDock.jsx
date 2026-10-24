// The bottom panel host (the external editor): Markups List and Quantities by default, with
// its own access bar (» toggle) on the left. The Markups List body is the
// existing AnnotationsPanel, now a host panel (panels/panelRegistry.js).
import PanelHost from './panels/PanelHost.jsx';

export default function MarkupsDock() {
  return <PanelHost host="bottom" />;
}
