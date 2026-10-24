# Contributing to Oculith Draw Foundation

Oculith Draw Foundation is the free, open-source desktop drawing tool from
[Oculith](https://oculith.io), licensed under [LGPL-3.0-or-later](LICENSE.md).
Thank you for helping make it better.

## How this repository is maintained

This repository is the published source of Oculith Draw Foundation. Oculith
maintains the application in its own source tree and publishes each release
here as a reviewed pull request, so `main` always matches a release.

- **Issues** are welcome: bugs, PDFs that open or save wrongly, and workflow
  proposals.
- **Pull requests** are welcome too. A maintainer reviews yours, applies the
  accepted change in the source tree, and it arrives here with the next
  release, credited to you in the release notes.

## Report a problem or propose a workflow

Open an issue with the steps to reproduce, expected and observed results, the
app version and operating system, and the PDF features involved (for example
CropBox, rotation, layers or forms). A small synthetic PDF and a screenshot
help. Share real project drawings only when you have permission to.

For a suspected security issue, contact the maintainers privately instead of
posting details or sensitive files in an issue.

## Send a change

Create a branch and open a focused pull request against `main`. Explain the
user-visible result, the PDF paths exercised, and the checks you ran.

- Keep the PDF page neutral; style the interface with the Oculith design
  tokens (`open-pdf-studio/styles/ox-tokens.css`): small radii, a dark and a
  light theme, Lucide icons.
- Keep annotation geometry in PDF page coordinates and use the existing
  viewport helpers for CropBox, rotation and zoom.
- Save, reopen and save again to check that markups and measurements do not
  drift or duplicate.
- The application works offline. It has no accounts, no user identities and no
  telemetry; changes that add them are out of scope.

## Build and check

See [docs/BUILDING.md](docs/BUILDING.md). In short, from `open-pdf-studio/`:

```bash
npm ci
npm run typecheck
npm run test:unit
npx vite build --logLevel error
npm run tauri:community -- --no-bundle
```

## Licence

Oculith Draw Foundation derives from
[Open PDF Studio](https://github.com/OpenAEC-Foundation/open-pdf-studio) by the
[OpenAEC Foundation](https://github.com/OpenAEC-Foundation). Keep copyright,
licence and third-party notices when changing inherited code or assets, and
give new artwork or bundled content a clear licence. See
[docs/CREDITS.md](docs/CREDITS.md) for the open-source projects it builds on.
