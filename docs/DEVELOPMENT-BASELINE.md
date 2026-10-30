# Foundation development baseline

Snapshot: 30 October 2026. The merged public code baseline before this
documentation update is commit `390955c` (Git tree `6287555`). This is a
development baseline, not a published release.

Foundation is a local PDF drawing editor. It starts with no add-on. The public
source includes a neutral interface for optional packages and local controls
to install, enable, disable, and remove them. No optional package or companion
executable is included in the Foundation source or installer. See
[Add-ons](ADDONS.md) for the host contract and [Architecture](ARCHITECTURE.md)
for the editor structure.

## Source and package checks

From `open-pdf-studio/` in a clean checkout, run
`node scripts/community-export-verify.mjs --published` to check the source
boundary and dependency inventory. The always-running Foundation CI checks
the editor and offline PDF save/reopen path; it compiles native code for
relevant changes and on `main`. The [build guide](BUILDING.md) has the exact
commands and platform dependencies.

The separate installer workflow runs on a schedule, manual dispatch, or a
review label. It builds Linux DEB and AppImage, Windows NSIS, and macOS app
artifacts and audits packaged notices, source route, and Foundation-only
contents. The last three-platform installer proof was on an earlier #83
source head. Later source edits mean a release of this baseline needs a new
installer run on its exact commit.

Each reviewed installer receipt records the public source commit and Git
tree, the source archive URL, version, notice count, and artifact digest. The
offline release-preparation command in [Building from source](BUILDING.md)
checks those bytes and prepares a local source/installers/receipts bundle.
It does not publish a release or deliver source to recipients.
