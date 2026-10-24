# Oculith Draw Foundation · guidelines for contributors and coding agents

Read this before changing anything.

- **This repository is published from Oculith's source tree.** Each release
  arrives here as a reviewed pull request. Do not rewrite history or push to
  `main`; open a pull request, and a maintainer carries an accepted change
  into the source.
- **It is the drawing tool alone.** It works offline, with no accounts, no
  user identities and no telemetry. Do not add them.
- **Keep the LGPL and the credits.** The editor derives from Open PDF Studio
  by the OpenAEC Foundation. Keep copyright, licence and third-party notices
  (`LICENSE.md`, `open-pdf-studio/src-tauri/package-notices/`,
  [docs/CREDITS.md](docs/CREDITS.md)).
- **Design.** Colours, type, spacing, radii and motion come from the Oculith
  tokens in `open-pdf-studio/styles/ox-tokens.css`. Small radii only (3-7px),
  Lucide icons, the default cursor everywhere except over the drawing, movable
  modal dialogs that stay open on an outside click. The PDF sheet stays white.
- **Geometry.** Annotation geometry lives in PDF page coordinates; use the
  viewport helpers for CropBox, rotation and zoom. Check save, reopen and a
  second save.
- **Commits.** Write the message from the actual diff. Do not mention
  non-open-source PDF products in comments.
- **No internal machine names or paths** in anything committed.

Start with [README.md](README.md) and the documents in [docs/](docs/README.md).
