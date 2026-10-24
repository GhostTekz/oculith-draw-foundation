# Oculith Draw desktop app

This directory contains the Oculith Draw Tauri and SolidJS application. Start with the [product README](../README.md) for the current workflow and project status. The directory and npm package names are inherited build paths; the desktop product is Oculith Draw.

## Run locally

Use Node.js 22, Rust, and the platform dependencies required by Tauri 2.

```bash
npm ci
npm run tauri:dev
```

The desktop command starts Vite and prepares the PDFium and OCR runtimes. `npm run dev` starts a browser preview for interface work; native file and rendering behavior still needs a desktop check.

## Verify a change

```bash
npm run typecheck
npm run test:unit
npx vite build --logLevel error
```

Use a focused test or smoke check for the behavior being changed. PDF work should include save/reopen or rendered-pixel evidence when relevant. A plain `npm run build` also prepares release runtimes and builds the native worker; use it for packaging changes.

## Code map

- `js/solid/`: workspace, ribbon, panels, and reactive stores.
- `js/pdf/`: PDF load, text, viewport conversion, and save paths.
- `js/annotations/` and `js/tools/`: markup and measurement models and interactions.
- `js/compare/`: drawing revision comparison.
- `js/sets/`: local drawing set manifests, sheet history, and PDF page import.
- `src-tauri/`: desktop shell and native PDF rendering integration.
- `scripts/`: focused verification and runtime preparation.

The active stack is Tauri 2, SolidJS, PDFium, PDF.js, and pdf-lib. See the [architecture](../docs/ARCHITECTURE.md), the [user guide](../docs/GUIDE.md) and [building from source](../docs/BUILDING.md).

## License

Oculith Draw is derived from Open PDF Studio and retains its source history and attribution. The application license is [LGPL-3.0-or-later](../LICENSE.md); third-party assets retain their notices.
