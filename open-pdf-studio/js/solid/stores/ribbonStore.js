import { createSignal, createEffect, createRoot } from 'solid-js';

const [activeTab, setActiveTab] = createSignal('home');
const [contextualTabsVisible, setContextualTabsVisible] = createSignal(false);
const [colorPickerValue, setColorPickerValue] = createSignal('#ffff00');
const [lineWidthValue, setLineWidthValue] = createSignal(3);
const [currentTheme, setCurrentTheme] = createSignal('dark');
const [isFullscreen, setIsFullscreen] = createSignal(false);

// Safety net: if the contextual tabs hide (selection cleared) while a
// contextual tab is still active, fall back to 'home'. The primary
// tab-restoration on selection change lives in updateContextualTabs()
// (js/annotations/rendering/ui-state.js), which restores the *previous*
// non-contextual tab; this effect only catches paths that clear the selection
// without going through that code (so the user never stays on a vanished tab).
createRoot(() => {
  createEffect(() => {
    if (!contextualTabsVisible()) {
      const current = activeTab();
      if (current === 'format' || current === 'arrange' || current === 'image') {
        setActiveTab('home');
      }
    }
  });
});

export function switchToTab(name) {
  setActiveTab(name);
}

export function getColorPickerValue() {
  return colorPickerValue();
}

export function getLineWidthValue() {
  return lineWidthValue();
}

export {
  activeTab, setActiveTab,
  contextualTabsVisible, setContextualTabsVisible,
  colorPickerValue, setColorPickerValue,
  lineWidthValue, setLineWidthValue,
  currentTheme, setCurrentTheme,
  isFullscreen, setIsFullscreen
};
