// Paint-bucket cursor for the Dynamic Fill tool (PDF area only, like every
// tool cursor). Hotspot: the tip of the pouring paint, bottom left.
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
  '<g fill="none" stroke-linejoin="round" stroke-linecap="round">' +
  '<path d="M10 3.5 18.5 12 12 18.5 3.5 10Z" fill="white" stroke="white" stroke-width="3.5"/>' +
  '<path d="M10 3.5 18.5 12 12 18.5 3.5 10Z" fill="white" stroke="black" stroke-width="1.4"/>' +
  '<path d="M3.5 10h15" stroke="black" stroke-width="1.2"/>' +
  '<path d="M18.5 12c1.8 2.6 2.6 4.2 2.6 5.3a2.6 2.6 0 0 1-5.2 0c0-1.1.8-2.7 2.6-5.3Z" fill="#1c7ed6" stroke="white" stroke-width="1"/>' +
  '<path d="M6.5 6.5 4 4" stroke="black" stroke-width="1.4"/>' +
  '</g></svg>';

export const DYNAMIC_FILL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 18 21, crosshair`;
