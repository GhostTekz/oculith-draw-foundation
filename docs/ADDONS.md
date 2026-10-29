# Add-ons

Oculith Draw Foundation works on its own. It also exposes versioned interfaces for optional, locally installed add-ons. The host selects at most one full edition package per user, then loads zero or more [independent add-on packages](ADDON-PACKAGES.md) in a defined order when the app starts.

## Host contract

A full edition package supplies `plugin.js` and a `manifest.json`; it may also supply `plugin.css` and a native helper. The script exports the edition composition and uses the published host modules in `open-pdf-studio/js/plugin/host.js`. The editor provides empty defaults when no full edition package is selected. A sample add-on and browser smoke test are in `open-pdf-studio/scripts/fixtures/recombination-addon/` and `open-pdf-studio/scripts/addon-recombination-smoke.mjs`.

The full edition manifest uses schema version 1. Its `editorVersion` must **exactly** match the installed editor version, and `hostApiVersion` must match the host API version (currently 1). Its `files` map lists each package file with its SHA-256 digest; the loader verifies those digests before loading the script. A `target` names an operating system (`linux`, `windows`, or `macos`) and architecture (`x64`, `arm64`, or `universal` on macOS). If a target is present, it must match the running app. A package with a native helper or other `bin/` files must specify a target. A script-only package may omit it.

These checks catch mismatched or changed files. They do not establish who created a package. Add-on code runs with the editor's privileges and the interface is not a security sandbox. Install add-ons only from a source you trust.

## Install, update, and remove

The full edition package belongs under `addons/active/` in the app's effective per-user data directory, with `manifest.json` and all files named by its `files` map inside that directory. An add-on distributor can provide an installer that stages and verifies these files. To remove it, close Foundation and remove `addons/active/`; the editor then starts with its built-in defaults and any enabled independent packages. To update it, replace the whole active package while the app is closed. Installation, replacement, and removal take effect after restarting the app because selection is fixed for each process. See [Independent add-on packages](ADDON-PACKAGES.md) for their separate builder and installer.

The native helper, when supplied, is part of the same selected package and is hash checked before use. Foundation itself ships no add-on implementation or helper.

## Documents and licence

Foundation keeps extension data in a PDF when a full edition package is unavailable, so opening and saving the document does not require that package. If the editor cannot safely preserve unknown annotation data, it refuses the save instead of silently discarding it. Features supplied by the package are available again when a compatible package is installed.

Foundation remains licensed under the LGPL-3.0 when an add-on is installed. You may obtain, modify, rebuild, and redistribute the Foundation source under that licence. An add-on may have its own licence; installing or removing one does not change your rights in Foundation. See [Building from source](BUILDING.md) and the repository's `LICENSE.md` for the editor's source and licence.
