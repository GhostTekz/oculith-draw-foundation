# Independent add-on packages

Foundation can load several small, independent add-ons after the editor starts. Each package contributes to the interface without replacing the editor. An optional full edition package, when present, loads first; independent packages then add their contributions in the order listed in `addons/enabled.json`. An invalid package is skipped so other packages can still load.

The package interface supports dialogs, panels, file commands and menu items, toolbar items, and symbol categories and templates. Version 2 contributions may also own namespaced PDF text fields. Independent packages cannot add native helpers, account services, or replace the editor's product identity. The host checks IDs, shortcuts, and PDF keys for collisions with built-in entries and earlier packages.

## Package format

Each package has a `manifest.json`, `plugin.js`, and optionally `plugin.css`:

```json
{
  "schemaVersion": 2,
  "id": "example.tools",
  "version": "1.0.0",
  "hostApiVersion": 1,
  "editorVersion": "2026.68.0",
  "files": {
    "plugin.js": "<64 hexadecimal SHA-256 characters>"
  }
}
```

`editorVersion` must exactly match the editor being used. The package builder fills it from the current source tree. `files` contains the digest of every package script or style file. The package may also declare a `target` with `os` and `arch` when it is intended for only one platform. Native executables and unlisted files are rejected. The digests detect changed files; they do not establish the publisher's identity. Add-on code runs with the editor's privileges, so install only packages from a source you trust.

The script exports `createAddon()`, which returns a plain object. For example:

```js
export function createAddon() {
  return {
    apiVersion: 1,
    id: 'example.tools',
    fileCommands: [{
      id: 'example.tools.hello', label: 'Hello', category: 'file',
      run: () => console.log('Hello from the add-on'),
    }],
    fileMenuItems: ['example.tools.hello'],
  };
}
```

Use the edition contract and the sample add-on in the source tree for the exact shapes of contributed entries. Keep IDs stable across releases. The script's ID must match the manifest ID. Packages that request unsupported fields are skipped.

## Namespaced PDF fields

An independent add-on that saves PDF metadata returns `apiVersion: 2` from `createAddon()`. This is the script contract version; the package manifest still uses `schemaVersion: 2` and `hostApiVersion: 1`. Each declared PDF key begins with `ODX_`, then the package ID with punctuation encoded as its two-digit ASCII hex value, then `_` and a letter-led field name. For `example.tools`, the prefix is `ODX_example_2etools_`. The editor rejects duplicate or unowned keys before loading a package.

```js
export function createAddon() {
  const field = 'ODX_example_2etools_State';
  return {
    apiVersion: 2,
    id: 'example.tools',
    pdf: {
      catalogKeys: [field],
      applyCatalog(doc, values) { doc.exampleState = values[field] || ''; },
      catalogForSave(doc) { return doc.exampleState ? { [field]: doc.exampleState } : {}; },
    },
  };
}
```

`annotationKeys` declares text fields on markup dictionaries. `decorateAnnotation(model, values)` receives only that package's decoded fields when a markup loads. `annotationForSave(model)` returns a map of owned text fields to write. All PDF callbacks are synchronous. Catalog values are limited to 256 KiB each, annotation values to 16 KiB each. Omitted values leave existing source fields intact when the editor can verify the annotation's identity; an invalid return value stops the save. The callbacks receive document and annotation models, not mutable PDF objects. Arbitrary PDF writes, appearance changes, and page-specific catalog remapping are outside this interface. Extract Pages and Split refuse a PDF with a present v2 catalog field until a package interface can safely remap it.

The full edition package continues to use its existing PDF hooks. Foundation preserves unknown catalog and annotation data when its corresponding add-on is absent.

## Build and manage a package

From `open-pdf-studio/`, make a directory containing `plugin.js` and optional `plugin.css`, then run:

```sh
node scripts/pack-addon.mjs --source ./my-addon --output ./my-addon-package --id example.tools --version 1.0.0
node scripts/addon-manager.mjs install --package ./my-addon-package --app-data-dir /path/to/editor-data
```

The installer verifies the manifest, hashes, version, platform, and file types before it changes the installed set. It places the package at `addons/packages/<id>/` beneath the editor's effective per-user data directory and adds its ID to `addons/enabled.json`. It preserves any other installed packages. The location of the editor data directory depends on the operating system and the app build; use the actual data directory for the build you are running.

To temporarily stop loading a package, use `disable --id example.tools --app-data-dir /path/to/editor-data`; use `enable` to load it again. To uninstall it, use `remove` with the same ID and data directory. Close the editor before changing packages, then restart it. Package selection is fixed for the life of each editor process.

Foundation remains usable with no add-ons. Its LGPL-3.0 rights to obtain, modify, rebuild, and redistribute the editor source continue when add-ons are installed. An add-on may have its own licence. See the repository `LICENSE.md` and [Building from source](BUILDING.md) for the editor source and build instructions.
