# Building from source

This page explains how to build Oculith Draw Foundation on Linux, Windows and macOS. For how the parts fit together, see [Architecture](ARCHITECTURE.md).

## What you need

- **Node.js 26.** pdfjs-dist 6.3 needs Node 25 or later.
- **Rust**, the stable toolchain, with Cargo.
- **The Tauri 2 platform libraries** for your system (see below).
- **Git**, to clone the repository.

The build downloads a few runtime files and checks each one by SHA-256: Tesseract trained data for English and Traditional Chinese, a CJK font for the OCR text layer, and, on macOS, the universal PDFium library. The PDFium libraries for Linux and Windows are in the repository under `open-pdf-studio/src-tauri/binaries/`.

### Linux (Debian or Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
  patchelf libtesseract-dev libleptonica-dev cmake nasm pkg-config
```

- `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev` and `patchelf` are the Tauri 2 libraries.
- `libtesseract-dev` and `libleptonica-dev` are linked for OCR. On Linux the build uses the system Tesseract instead of compiling it.
- `cmake` and `nasm` build libjpeg-turbo for the Rust renderer.

On other distributions, install the same libraries under their local names.

### Windows

- The Microsoft C++ build tools (MSVC) and the WebView2 runtime, as for any Tauri 2 app.
- CMake and NASM on the path. Tesseract and Leptonica are compiled from source during the build.

### macOS

- The Xcode command line tools.
- CMake and NASM, for example from Homebrew.
- Tesseract and Leptonica are compiled from source during the build.
- For a universal build, build each architecture as its own `cargo build` and clear the `tesseract-rs` build cache in `~/Library/Application Support/tesseract-rs` between them. Its cache is not separated by target, so the second architecture can pick up the first one's libraries.

## Build

All commands run in `open-pdf-studio/`.

```bash
git clone https://github.com/GhostTekz/oculith-foundation.git
cd oculith-foundation/open-pdf-studio
npm ci
npm run tauri:community -- --no-bundle   # native build, no installer
npm run build                            # frontend only
```

- `npm ci` installs the locked npm dependencies.
- `npm run tauri:community` builds the native app with the Tauri configuration in `src-tauri/tauri.community.conf.json`. Without `--no-bundle` it also builds installers.
- `npm run build` builds the frontend only. Before it runs, it prepares the native and OCR runtime files and builds the `pdfium-worker` sidecar in release mode.

`tauri:community` accepts these options after `--`: `--no-bundle`, `--debug`, `--ci`, `--no-sign`, `--skip-stapling`, `--verbose`, `--target <triple>` and `--bundles <list>`, where the list is any of `deb`, `rpm`, `appimage`, `nsis`, `app` and `dmg`. For example:

```bash
npm run tauri:community -- --bundles deb,appimage
```

### Development session

```bash
npm run tauri:dev    # desktop app with hot reload
npm run dev          # browser preview on http://localhost:3041
```

The browser preview runs the interface without the desktop shell. It has no native file access, OCR, printing or GEOS, and renders pages with PDFium as WebAssembly or with PDF.js.

## Checks

Run these before you send a change:

```bash
npm run typecheck                 # TypeScript check, no output files
npm run test:unit                 # unit tests (node)
npx vite build --logLevel error   # production frontend build
```

The unit tests run on real PDF bytes from the real saver and loader where it matters, so a change to saving or loading is checked end to end.

The `Foundation CI` workflow runs on every pull request update. It checks the source boundary, editor, and offline browser save/reopen without building installers. It also compiles Rust when the PR changes a native or build input, and on every push to `main`. For a PR that changes only documented frontend paths, it skips Rust setup, Linux native dependencies, and Cargo. Run the source boundary check locally with `node scripts/community-export-verify.mjs --published` from `open-pdf-studio/` in a clean Foundation clone. This check scans tracked source files for private product traces and validates the dependency inventory against the lockfiles.

The native compile decision uses the PR merge commit and its first parent, so it checks the full proposed diff against the current base. Renames are evaluated as both a removal and an addition. It fails closed and compiles if the merge parent or diff cannot be read. The path policy is:

| PR changes | Native compile |
| --- | --- |
| Only `docs/`, root README/licence/contributor files, `open-pdf-studio/js/`, `styles/`, `public/`, or frontend HTML/config | Skipped; source, editor, and browser checks still run |
| Cargo files, Rust crates, `src-tauri/` resources/config/icons, package manifests, runtime/build scripts, workflows, or any unknown path | Required |
| Push to `main` | Required |

The separate `Foundation installers` workflow builds Linux DEB and AppImage, Windows NSIS, and macOS app packages. It also starts the AppImage on Debian and Fedora and installs and removes the Windows package. It runs weekly on `main`, on manual dispatch, or once when a maintainer adds the `ci:installers` label to a pull request. If the label is already present, marking a draft ready for review runs it again. New commits do **not** rerun the installer matrix. After a candidate changes, remove and reapply the label to test the new head; check that all three installer jobs succeeded for the final candidate before merging or shipping. Manual dispatch becomes available after the workflow exists on the default branch; select the candidate branch and verify its commit in the run. A release also runs its release build workflow as required by the release process.

If branch protection is configured, require the always-running `Foundation CI / source-and-editor` check. The installer matrix is a review and release gate, so do not make its conditional jobs required on every pull request. A skipped installer workflow is not evidence that a package passed.

The Rust crates have their own tests:

```bash
cargo test -p open-pdf-cad
cargo test -p open-pdf-render
```

## Optional: GEOS geometry

GEOS gives exact polygon unions, holes and offsets for stored areas, quantity totals, trims, splits and Dynamic Fill. It is off by default. Without it, the app uses its JavaScript geometry and works the same, except in those stored results. See [Architecture](ARCHITECTURE.md#open-pdf-geos) for what uses it.

You need GEOS 3.14.1 as a shared library (`libgeos_c`). Point the build at it with `GEOS_PREFIX`, the directory that contains `lib/libgeos_c.so`. A system install is found through `pkg-config` instead.

```bash
# test the bridge crate
GEOS_PREFIX=~/.local/opt/geos-3.14.1/usr cargo test -p open-pdf-geos
```

To build the Linux app with GEOS, from `open-pdf-studio/`:

```bash
export GEOS_PREFIX=~/.local/opt/geos-3.14.1/usr
export TURBOJPEG_SOURCE=explicit
export TURBOJPEG_DYNAMIC=1
export TURBOJPEG_LIB_DIR=/usr/lib
export TURBOJPEG_INCLUDE_DIR=/usr/include
export RUSTFLAGS='-C link-arg=-Wl,-rpath,$ORIGIN -C link-arg=-Wl,--disable-new-dtags'
npx tauri build --features geos --no-bundle
```

- The program is `target/release/open-pdf-studio` at the repository root.
- `libgeos_c.so.1` and `libgeos.so.3.14.1` must sit beside the program, or on the loader path. The rpath above makes the program look beside itself.
- Do not link GEOS statically. GEOS is LGPL-2.1-only. A package that ships it must include the GEOS notice and offer the source of the same GEOS build. The notice files are in `src-tauri/package-notices/` (`GEOS-NOTICE.txt` and `LGPL-2.1.txt`).
- `npm run tauri:community` does not take `--features`; use the command above for a GEOS build.

## Where the outputs go

| Output | Location |
|---|---|
| Frontend build | `open-pdf-studio/dist/` |
| Native build (`tauri:community`) | `target/community/` at the repository root: the program in `release/` (or `debug/`), installers in `release/bundle/` |
| Native build with `npx tauri build` | `target/release/` at the repository root |
| PDFium worker sidecar | built into the same target directory, then copied to `open-pdf-studio/src-tauri/binaries/` as `ocudraw-community-pdfium-worker` with the target suffix |
| OCR runtime files | `open-pdf-studio/src-tauri/resources/tessdata/` and `resources/fonts/` |

With `CARGO_TARGET_DIR` set, `tauri:community` uses it as the base and builds into its `community/` subfolder. `OCUDRAW_TARGET_BASE` sets the same base explicitly.

## Notices and bill of materials

- The third-party notices are in `open-pdf-studio/src-tauri/package-notices/`. The app ships them under `notices/`.
- `SBOM.cdx.json` lists every locked Cargo and npm dependency, including platform alternatives. The private source export is verified against a SHA-256 manifest before it is synchronized to the public repository; the public repository omits that manifest because it identifies the private source commit.
- Branded drawing templates are not part of the source; add your own title blocks.

See [Credits](CREDITS.md) for the projects the app is built on.
