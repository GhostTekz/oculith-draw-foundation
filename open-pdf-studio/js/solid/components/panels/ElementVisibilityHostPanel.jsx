// The Element Visibility panel as a host panel. Its open/closed signal
// (elementVisibilityStore.panelVisible) and the host stay in step through
// PanelHost's HostServices: the ribbon toggle shows or hides the panel, and
// Hide / the panel's own × hide it.
import ElementVisibilityPanel from '../left-panel/ElementVisibilityPanel.jsx';

export default function ElementVisibilityHostPanel() {
  return <ElementVisibilityPanel />;
}
