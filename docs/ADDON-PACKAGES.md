# Independent add-on packages

Foundation can load several small, independent add-ons after the editor starts. Each package contributes to the interface without replacing the editor. An optional full edition package, when present, loads first; independent packages then add their contributions in the order listed in `addons/enabled.json`. An invalid package is skipped so other packages can still load.

The contribution interface supports dialogs, panels, file commands and menu items, toolbar items, symbol categories and templates, Markups List groups, and styled box tools. Version 2 contributions may own namespaced PDF text fields; a schema version 3 package may also supply one native helper. Schema version 4 adds up to four native companions beside that helper. The editor provides no built-in network service, and packages cannot replace its product identity. The host checks IDs, shortcuts, and PDF keys for collisions with built-in entries and earlier packages.

## Package format

Each package has a `manifest.json`, `plugin.js`, and optionally `plugin.css` and `NOTICES.txt`. Schema versions 3 and 4 also require a native helper:

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

`editorVersion` must exactly match the editor being used. The package builder fills it from the current source tree. `files` contains the digest of every package file. The package may also declare a `target` with `os` and `arch` when it is intended for only one platform. Schema version 2 rejects native executables. Unlisted files are always rejected. The digests detect changed files; they do not establish the publisher's identity. Add-on code runs with the editor's privileges, so install only packages from a source you trust.

To include a native helper, pass `--helper /path/to/built-helper` to the package builder. It creates schema version 3 with a required `target` matching the build host, a `helper` field (`helper.exe` on Windows, `helper` elsewhere), and a SHA-256 entry for that executable in `files`. Repeat `--sidecar /path/to/native-file` up to four times to create schema version 4; these files are stored as `companion-1` through `companion-4` (with `.exe` on Windows), listed in `sidecars`, and hashed in `files`. Schema version 4 requires `--notices /path/to/NOTICES.txt`; the notices file is UTF-8 and at most 4 MiB. Earlier schemas can include notices too. The installer and loader check native target, file type, size (at most 128 MiB per native file), executable permission on Unix, executable header, and digest. The loader checks companions again before starting the helper. Build separately on each supported operating system and architecture; this package builder does not cross compile. The editor starts only the helper and passes JSON lines over standard input and output. A package helper may use its own companions from the installed package directory. The helper is selected by the enabled package ID, and its events include that ID. The existing full-edition helper route is unchanged. A native package takes effect after an editor restart, including disable, update, and removal.

The published `js/core/edition-helper.js` module exposes `addonHelperAvailable(packageId)`, `addonHelperCall(packageId, method, params)`, and `onAddonHelperEvent(packageId, event, handler)`. Helper methods are defined by the package, not the editor. The editor reserves methods beginning with `host.`. Packages in the same web view can call the published interface; package IDs route calls and events but are not an isolation boundary. Each helper receives the editor data directory path and runs with the user's operating-system privileges. `shareAddonFile(packageId, path)` routes the editor's `host.shareFile` method to only that enabled, verified package helper for an editor-authorized regular PDF up to 250 MiB and returns the canonical path the helper received. The file scope does not prove which tab is active; the package must confirm that its user action applies to the intended document.

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

`createAddon()` builds its descriptor before the editor loads the modules named in the script's `requires` export. It may use only the early host modules at that point: `solid-js`, `solid-js/web`, `solid-js/store`, `pdf-lib`, and `js/solid/data/lucideIcons.js`. Required modules load after accepted contributions are composed and before editor startup; use them in panel components, callbacks, or later actions.

The host passes `createAddon(context)` a frozen object with `pdfKeys`, a frozen array of PDF key names already claimed by the selected edition and earlier accepted add-ons. A package may omit its optional `pdf` contribution when a key is occupied and still provide its panel. The host checks ownership again during composition, so two packages cannot claim the same key even if they ignore this context.

## Namespaced PDF fields

An independent add-on that saves PDF metadata returns `apiVersion: 2` from `createAddon()`. This is the script contract version; its manifest can use schema version 2 or 3 and `hostApiVersion: 1`. Each declared PDF key begins with `ODX_`, then the package ID with punctuation encoded as its two-digit ASCII hex value, then `_` and a letter-led field name. For `example.tools`, the prefix is `ODX_example_2etools_`. The editor rejects duplicate or unowned keys before loading a package.

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

`annotationKeys` declares text fields on markup dictionaries. `decorateAnnotation(model, values)` receives only that package's decoded fields when a markup loads. `annotationForSave(model)` returns a map of owned text fields to write. All PDF callbacks are synchronous. Catalog values are limited to 256 KiB each, annotation values to 16 KiB each. Omitted values leave existing source fields intact when the editor can verify the annotation's identity; an invalid return value stops the save. The callbacks receive document and annotation models, not mutable PDF objects. Arbitrary PDF writes and appearance changes are outside this interface. Extract Pages and Split still refuse a PDF with a present namespaced v2 catalog field until a package interface can safely remap it.

For an existing text catalog field, `legacyCatalogKeys` may declare its exact, versioned vendor name instead of an `ODX_` name. A legacy claim has a 2 MiB decoded UTF-8 limit. It cannot claim a PDF structural key or an editor-owned field, and two packages cannot claim the same key. `catalogForSave(doc, source)` receives a frozen snapshot with `fields` (decoded strings owned by this package) and `presentKeys` (owned keys present even if unreadable). It can return a replacement string, or `null` to explicitly delete a declared catalog key. Omit a key to preserve its source value. Deletion of a present key fails if its source value cannot be decoded within the limit; deletion of an absent key has no effect. The host also refuses to replace an unreadable existing legacy value. These rules apply to declared namespaced catalog keys as well as legacy keys. This contract handles PDF strings only; compressed streams need a separate migration path. Extract Pages and Split refuse unknown versioned vendor catalog data when no package claims it, because copying pages alone cannot preserve its meaning.

`legacyAnnotationKeys` claims exact, versioned vendor **text** fields on ordinary PDF annotations for the same `decorateAnnotation` and `annotationForSave` callbacks as namespaced fields. The host transports at most 16 KiB of decoded UTF-8 per field and rejects editor-owned keys or competing claims. Omit a loaded field from `annotationForSave` to retain its original PDF value, including unreadable raw values, through the editor's existing source-aware carry. Before replacing a loaded legacy field, the host checks the annotation's reference, name, subtype, and page against its source; a stale or forged source stops that replacement. A callback cannot replace an unreadable source field. Newly drawn annotations may write declared fields. The host does not expose PDF dictionaries to add-ons or change annotation appearances through this contract.

For page extraction of a claimed legacy text field, `catalogForExtract(source)` must synchronously return a replacement string for every present owned field. `source` has frozen `fields`, `presentKeys`, and `pages`. Each page entry gives `sourcePage`, `targetPage`, and arrays of decoded strings from the exact versioned annotation tags in `extractAnnotationKeys`. This claim permits extraction reads only; it does not grant annotation load or save callbacks. Each tag is limited to 16 KiB, with a 2 MiB and 50,000-tag transport ceiling. The host checks that the copied pages still carry those tags. Missing callbacks, unreadable values, changed tags, and partial results stop extraction without writing the target catalog. Unknown versioned vendor fields without an owner also stop extraction.

The full edition package continues to use its existing PDF hooks. Foundation preserves unknown catalog and annotation data when its corresponding add-on is absent.

## Markups List groups

A version 2 add-on may return `listGrouping: { paths, select }`. `paths(doc, annotations)` runs when the visible Markups List builds and returns a `Map` from current annotation objects to one group row description each, or `null` for no groups. It must be synchronous. Group IDs begin with `addon:<package-id>:` and have a nonempty suffix; the same ID describes the same row. A description has a nonempty `name` (at most 160 characters) and may include a CSS hex `color`, an annotation ID as `dominant`, and `hideDominant: true`. IDs are limited to 160 characters. Invalid output from one package is ignored for that list build.

```js
listGrouping: {
  paths(doc, annotations) {
    return new Map(annotations.filter((ann) => ann.subject === 'Review')
      .map((ann) => [ann, { id: 'addon:example.tools:review', name: 'Review' }]));
  },
  select(groupId, ctrlKey) {
    // Select this package's group in the editor using published host modules.
  },
},
```

The editor calls `select(groupId, ctrlKey)` when a user clicks that package's group row. Drops onto package groups are disabled. A full edition's groups keep priority when they claim the same annotation; among independent packages, enabled order decides priority. The editor routes selection only for group IDs present in the current list. Packages should compute paths without mutating the document or annotations.

## Styled box tools

A version 2 add-on may contribute up to 16 aliases of the editor's ordinary box tool. Each `boxTools` entry has an ID beginning with `addon:<package-id>:` and a letter-led suffix of up to 64 letters, digits, periods, underscores, or hyphens. The editor uses its own box creator, preview, undo, rendering, and PDF saver. The package may set only `color`, `strokeColor`, `fillColor`, `lineWidth`, `opacity`, and `subject`. Colors are six-digit hex values; `fillColor: null` means no fill, line width must be greater than 0 and at most 50, opacity is 0–1, and subject is at most 120 characters. An omitted stroke or base color inherits the other. Invalid entries reject that package without affecting earlier packages.

```js
boxTools: [{
  id: 'addon:example.tools:review-box',
  style: { strokeColor: '#176087', fillColor: null, lineWidth: 2, subject: 'Review' },
}],
```

The add-on can expose its tool with a toolbar item or file command whose `run` calls `setTool('addon:example.tools:review-box')` from the published `js/tools/manager.js` host module. Put that module in the package's `requires` list and call it after startup. Box aliases use drag creation; they do not add a keyboard shortcut. Removing the package and restarting leaves the editor's built-in box tool available.

## Build and manage a package

In the desktop editor, open **Extensions → Local add-ons** and choose **Install package folder…**. Select the folder containing `manifest.json` and the files named in it. The editor verifies the package, copies it into its per-user data directory, and enables it. The same panel lists installed packages and lets you enable, disable, or remove them. It shows when a package is invalid or incompatible with this editor version. Changes take effect after restarting the editor. A package receives the editor's access to local files, so install only packages from a source you trust.

The command line manager is also available for development or scripted installation. Close the editor before using it to change packages. From `open-pdf-studio/`, make a directory containing `plugin.js` and optional `plugin.css`, then run:

```sh
node scripts/pack-addon.mjs --source ./my-addon --output ./my-addon-package --id example.tools --version 1.0.0
node scripts/addon-manager.mjs install --package ./my-addon-package --app-data-dir /path/to/editor-data
```

The installer verifies the manifest, hashes, version, platform, and file types before it changes the installed set. It places the package at `addons/packages/<id>/` beneath the editor's effective per-user data directory and adds its ID to `addons/enabled.json`. It preserves any other installed packages. The location of the editor data directory depends on the operating system and the app build; use the actual data directory for the build you are running.

To temporarily stop loading a package, use `disable --id example.tools --app-data-dir /path/to/editor-data`; use `enable` to load it again. To uninstall it, use `remove` with the same ID and data directory. Restart after changing packages. Package selection is fixed for the life of each editor process.

Removal first moves the package out of its active directory, then removes its ID from the enabled index. If Windows holds the helper executable open and prevents that move, removal fails with the original package and index intact. If the move succeeds but file deletion is still blocked, the inactive `.remove-<id>` directory is cleaned on the next add-on operation after the editor exits. An interrupted removal restores an enabled package before another operation. Disabling or removing a package stops new helper calls once the editor observes the changed index; a helper already doing work may continue until the editor exits. Close the editor first for a complete stop.

Foundation remains usable with no add-ons. Its LGPL-3.0 rights to obtain, modify, rebuild, and redistribute the editor source continue when add-ons are installed. An add-on may have its own licence. See the repository `LICENSE.md` and [Building from source](BUILDING.md) for the editor source and build instructions.
