// Oculith Draw construction tool icons that have no Lucide equivalent.
//
// Original drawings for this project (LGPL-3.0-or-later with the app), made to
// sit beside the vendored Lucide set in lucideIcons.js: 24px viewBox,
// currentColor, 1.75 stroke, round caps and joins, no text glyphs. Small
// filled dots mark picked points. Keep new icons in this file so the ribbon,
// tool palette and panels share one drawing of each tool.

const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const dot = (cx, cy, r = 1.35) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
const icon = (body) => `${OPEN}${body}</svg>`;

// A closed revision cloud: scallops around a 15 x 11 box.
const CLOUD_PATH = 'M5 8a2.5 2.5 0 0 1 4.5-1.5a2.5 2.5 0 0 1 5 0a2.5 2.5 0 0 1 4.5 1.5a2.5 2.5 0 0 1 0 4a2.5 2.5 0 0 1 0 4a2.5 2.5 0 0 1-4.5 1.5a2.5 2.5 0 0 1-5 0a2.5 2.5 0 0 1-4.5-1.5a2.5 2.5 0 0 1 0-4a2.5 2.5 0 0 1 0-4Z';
const SMALL_CLOUD_PATH = 'M3.5 6.5a2 2 0 0 1 3.5-1.2a2 2 0 0 1 4 0a2 2 0 0 1 3.5 1.2a2 2 0 0 1 0 3.3a2 2 0 0 1-3.5 1.9a2 2 0 0 1-4 0a2 2 0 0 1-3.5-1.9a2 2 0 0 1 0-3.3Z';

export const OCULITH_TOOL_ICONS = Object.freeze({
  // markup
  cloud: icon(`<path d="${CLOUD_PATH}"/>`),
  'cloud-plus': icon(`<path d="${SMALL_CLOUD_PATH}"/><path d="M9 11.8 L5 20"/>${dot(5, 20)}<path d="M15.5 17.5h6M18.5 14.5v6"/>`),
  'cloud-polyline': icon('<path d="M3 18a2.2 2.2 0 0 1 3.6-1.6a2.2 2.2 0 0 1 2.6-3a2.2 2.2 0 0 1 2.6-3a2.2 2.2 0 0 1 3.6-1.4a2.2 2.2 0 0 1 3.4-2.2a2.2 2.2 0 0 1 2.2 2.6"/>'),
  callout: icon(`<rect x="10" y="3.5" width="11" height="8" rx="1"/><path d="M13 6.5h5M13 9h3"/><path d="M10 9 6.5 9 3.5 19.5"/>${dot(3.5, 19.5)}`),
  sketch: icon('<path d="M3 16c2-4 3.5-4 4.5-1.5S10 17 11.5 13s3-4.5 4.5-2"/><path d="m15.5 19.5 5-5a1.4 1.4 0 0 0-2-2l-5 5-.7 2.7z"/><path d="M3 21h8" stroke-dasharray="1.5 2.5"/>'),
  line: icon(`<path d="M5 19 19 5"/>${dot(5, 19)}${dot(19, 5)}`),
  polyline: icon(`<path d="M3 18 9 8l6 7 6-9"/>`),
  ellipse: icon('<ellipse cx="12" cy="12" rx="9.5" ry="6.5"/>'),
  arc: icon('<path d="M4 18a8 8 0 0 1 16 0"/>'),
  hatch: icon('<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M3.5 10 10 3.5M3.5 16.5 16.5 3.5M7.5 20.5l13-13M14 20.5l6.5-6.5"/>'),
  'l-shape': icon('<path d="M5 3v16h15"/>'),
  trim: icon('<path d="M12 3.5v17M3 12h9"/><path d="M12 12h9" stroke-dasharray="2 2.5"/>'),
  'north-arrow': icon('<circle cx="12" cy="12" r="9"/><path d="M12 4.5 15.5 17 12 14.5 8.5 17Z"/>'),
  straighten: icon('<path d="M6.3 3.6 17.8 2.4l1.9 18-11.5 1.2Z"/><path d="M2.5 12h19" stroke-dasharray="2 2"/>'),
  'thin-lines': icon('<path d="M4 6h16M4 18h16" stroke-width="0.9"/><path d="M4 12h16"/>'),

  // raceways: a conduit run with an elbow, and a ladder tray
  conduit: icon('<path d="M3 18h7a6 6 0 0 0 6-6V4"/><path d="M3 15h7a3 3 0 0 0 3-3V4" stroke-width="1.2"/>'),
  'cable-tray': icon('<path d="M2.5 8h19M2.5 16h19"/><path d="M5.5 8v8M9.5 8v8M13.5 8v8M17.5 8v8" stroke-width="1.2"/>'),

  // measurement
  polylength: icon(`<path d="M3 17 9 9l5 5 7-8"/>${dot(3, 17)}${dot(9, 9)}${dot(14, 14)}${dot(21, 6)}`),
  perimeter: icon(`<path d="M5 6.5 18 4l2.5 13L7 20Z"/>${dot(5, 6.5)}${dot(18, 4)}${dot(20.5, 17)}${dot(7, 20)}`),
  area: icon('<path d="M5 6.5 18 4l2.5 13L7 20Z" fill="currentColor" fill-opacity="0.16"/><path d="M8.5 12.5 12 9M10 16l5.5-4.5"/>'),
  // Dynamic Fill: a paint bucket pouring into a region.
  'dynamic-fill': icon('<path d="m10 3.5 8 8-6.5 6.5-8-8Z"/><path d="M3.5 10h14.5"/><path d="M6.5 6.5 4 4"/><path d="M19 13.5c1.6 2.3 2.3 3.7 2.3 4.6a2.3 2.3 0 0 1-4.6 0c0-.9.7-2.3 2.3-4.6Z" fill="currentColor" fill-opacity="0.16"/>'),
  volume: icon('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  'arc-length': icon(`<path d="M4 18a8 8 0 0 1 16 0"/>${dot(4, 18)}${dot(12, 10)}${dot(20, 18)}`),
  'radius-3pt': icon(`<circle cx="12" cy="12" r="8" stroke-dasharray="2.5 2.5"/><path d="M12 12l5.66-5.66"/>${dot(12, 12, 1.1)}${dot(4, 12)}${dot(12, 20)}${dot(17.66, 6.34)}`),
  radius: icon(`<circle cx="11" cy="13" r="8"/><path d="m11 13 7-4"/>${dot(11, 13, 1.1)}`),
  angle: icon('<path d="M20.5 19H4l10.5-13.5"/><path d="M10 19a6 6 0 0 0-2.3-4.7"/>'),
  calibrate: icon('<path d="M4 18h16M4 15v6M20 15v6"/><path d="m8 8.5 3 3 5-6"/>'),
  'set-scale': icon('<rect x="3" y="12" width="9" height="9" rx="1"/><path d="M12 12 20 4M15 4h5v5"/><path d="M3 8V4h4" stroke-dasharray="1.5 2"/>'),
  viewport: icon('<rect x="3" y="4" width="18" height="16" rx="1" stroke-dasharray="3 2.5"/><rect x="11" y="11" width="7" height="6" rx="0.5"/><path d="M6.5 7.5h4"/>'),
  count: icon(`<circle cx="7" cy="7" r="2.75"/><circle cx="17" cy="7" r="2.75"/><circle cx="7" cy="17" r="2.75"/><path d="M14 17h6M17 14v6"/>`),
  dimension: icon('<path d="M4 8v11M20 8v11M4 14h16M2.5 15.5l3-3M18.5 15.5l3-3"/>'),
  'scale-bar': icon('<rect x="3" y="11" width="18" height="5"/><path d="M3 11h6v5H3ZM15 11h6v5h-6Z" fill="currentColor" stroke="none"/><path d="M3 8v3M12 8v3M21 8v3"/>'),
  takeoff: icon('<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 9h17M9 9v11.5M15 9v11.5M3.5 14.5h17"/>'),
});

/** SVG markup for an Oculith tool icon; throws for an unknown name. */
export function toolIcon(name) {
  const svg = OCULITH_TOOL_ICONS[name];
  if (!svg) throw new Error(`Oculith tool icon not defined: ${name}`);
  return svg;
}
