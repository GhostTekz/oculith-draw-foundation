#!/usr/bin/env python3
"""Bundle locked Cargo dependency notices from the downloaded crate sources.

Run after `cargo fetch` (or with --offline when the graph is cached).  The
generated bundle contains source license files verbatim and standard SPDX text
for crates that ship without a root license file.  It covers the entire locked
graph, including optional platform packages, rather than guessing which crates
will be linked into a particular installer.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "Cargo.lock"
NOTICE_DIR = ROOT / "open-pdf-studio/src-tauri/package-notices"
OUTPUT = NOTICE_DIR / "rust-third-party-notices.txt"
MANIFEST = NOTICE_DIR / "rust-notice-manifest.json"
STANDARD = ROOT / "scripts/rust-spdx-texts"
UPSTREAM = ROOT / "scripts/rust-upstream-notices"
SOURCE_FILE = re.compile(r"^(?:LICEN[CS]E|COPYING|NOTICE|AUTHORS)(?:[.\-_]|$)", re.I)
EXPRESSION_TOKEN = re.compile(r"[A-Za-z0-9.]+(?:-[A-Za-z0-9.]+)*")
# This crate archive also includes vendored libjpeg-turbo source. Its nested
# notice belongs to that component and is not the crate's own root license.
NESTED_ARCHIVE_NOTICES = {("turbojpeg-sys", "1.1.1"): ("libjpeg-turbo/LICENSE.md",)}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def notice_text(data: str) -> str:
    """Normalize only source formatting that Git treats as trailing whitespace."""
    return "\n".join(line.rstrip() for line in data.replace("\r\n", "\n").split("\n"))


def canonical_id(token: str) -> str:
    return "LGPL-2.1+" if token == "LGPL-2.1-or-later" else token


def source_files(package: dict) -> list[Path]:
    root = Path(package["manifest_path"]).parent
    files = [item for item in root.iterdir() if item.is_file() and SOURCE_FILE.match(item.name)]
    declared = package.get("license_file")
    if declared:
        path = root / declared
        if not path.is_file():
            raise ValueError(f"Missing declared license file: {package['name']} {path}")
        files.append(path)
    for relative in NESTED_ARCHIVE_NOTICES.get((package["name"], package["version"]), ()):
        path = root / relative
        if not path.is_file():
            raise ValueError(f"Missing nested archive notice: {package['name']} {path}")
        files.append(path)
    return sorted(set(files), key=lambda file: str(file.relative_to(root)).lower())


def upstream_sources(packages: list[dict]) -> dict[tuple[str, str], dict]:
    """Load separately obtained repository notices, pinned to crate VCS metadata.

    Cargo's VCS metadata is useful context, not proof that the crate archive
    matches the repository. These texts must never be labeled archive files.
    """
    catalog = json.loads((UPSTREAM / "catalog.json").read_text(encoding="utf-8"))
    if catalog.get("schemaVersion") != 1:
        raise ValueError("Unsupported Rust upstream notice catalog")
    locked = {(p["name"], p["version"]): p for p in packages}
    result = {}
    for entry in catalog["entries"]:
        revision = entry["revision"]
        if not re.fullmatch(r"[0-9a-f]{40}", revision):
            raise ValueError(f"Invalid upstream revision: {revision}")
        files = []
        for file in entry["files"]:
            relative = Path(file["storedFile"])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"Unsafe upstream notice path: {relative}")
            data = (UPSTREAM / relative).read_bytes()
            if digest(data) != file["sha256"]:
                raise ValueError(f"Upstream notice hash differs: {relative}")
            files.append((file, data))
        for identity in entry["packages"]:
            key = identity["name"], identity["version"]
            if key in result or key not in locked:
                raise ValueError(f"Duplicate or unlocked upstream notice: {key}")
            package = locked[key]
            root = Path(package["manifest_path"]).parent
            vcs_file = root / ".cargo_vcs_info.json"
            if not vcs_file.is_file() or json.loads(vcs_file.read_text())["git"]["sha1"] != revision:
                raise ValueError(f"Upstream revision differs from crate metadata: {key}")
            repository = package.get("repository") or ""
            if repository not in {entry["repository"], entry["repository"] + ".git"} and not repository.startswith(entry["repository"] + "/"):
                raise ValueError(f"Upstream repository differs from crate metadata: {key}")
            result[key] = {"repository": entry["repository"], "revision": revision,
                           "files": files}
    return result


def generate(offline: bool) -> tuple[str, str, int]:
    command = ["cargo", "metadata", "--locked", "--format-version", "1"]
    if offline:
        command.append("--offline")
    metadata = json.loads(subprocess.check_output(command, cwd=ROOT))
    members = set(metadata["workspace_members"])
    packages = sorted((p for p in metadata["packages"] if p["id"] not in members),
                      key=lambda p: (p["name"], p["version"], p["source"] or ""))
    upstream = upstream_sources(packages)
    lines = [
        "OCULITH DRAW — RUST THIRD-PARTY NOTICE BUNDLE",
        "",
        "Generated from the Cargo.lock dependency graph. Each unique source license",
        "or notice text appears once and is referenced by SHA-256 from its package.",
        "Archive texts come from downloaded crate archives. Separately labeled",
        "upstream texts come from repository commits recorded in crate VCS metadata;",
        "that metadata does not prove archive-to-repository identity. Line endings and",
        "trailing whitespace are normalized. Where an archive lacks",
        "a root license file, the declared SPDX license text appears in the appendix.",
        "Standard templates may have copyright placeholders; package authors and source",
        "links below provide attribution context and do not replace a legal review.",
        "This graph includes development, build, and platform-specific dependencies.",
        "",
        f"Cargo.lock SHA-256: {digest(LOCK.read_bytes())}",
        f"External packages: {len(packages)}",
        "",
    ]
    entries = []
    fallback_ids: set[str] = set()
    emitted_texts: set[str] = set()
    for package in packages:
        root = Path(package["manifest_path"]).parent
        files = source_files(package)
        license_files = [file for file in files if (file.parent == root or
                         file == root / (package.get("license_file") or "")) and
                         not re.match(r"^(?:AUTHORS|NOTICE)(?:[.\-_]|$)", file.name, re.I)]
        fallback = []
        if not license_files:
            expression = package.get("license") or ""
            fallback = sorted({canonical_id(token) for token in EXPRESSION_TOKEN.findall(expression)
                               if token not in {"AND", "OR", "WITH"}})
            if not fallback:
                raise ValueError(f"No license text or license declaration: {package['name']}@{package['version']}")
            for identifier in fallback:
                if not (STANDARD / identifier).is_file():
                    raise ValueError(f"No standard text for {identifier} ({package['name']})")
            fallback_ids.update(fallback)
        label = f"{package['name']}@{package['version']}"
        lines += ["=" * 78, label, f"Declared license: {package.get('license') or '(license-file only)'}",
                  f"Source: {package.get('repository') or package['source'] or '(unspecified)'}",
                  f"Authors: {', '.join(package.get('authors') or []) or '(not declared)'}"]
        if fallback:
            lines.append(f"No root license file in crate archive; standard text in appendix: {', '.join(fallback)}")
        upstream_entry = upstream.get((package["name"], package["version"]))
        file_entries = []
        for file in files:
            data = file.read_bytes()
            relative = file.relative_to(root).as_posix()
            sha = digest(data)
            lines += ["", f"--- {label}: {relative} (SHA-256 {sha}) ---"]
            if sha in emitted_texts:
                lines.append("Identical source text is printed earlier in this bundle.")
            else:
                lines.append(notice_text(data.decode("utf-8")))
                emitted_texts.add(sha)
            file_entries.append({"path": relative, "sha256": sha})
        upstream_files = []
        if upstream_entry:
            lines += ["", f"Upstream repository revision: {upstream_entry['repository']} @ {upstream_entry['revision']}",
                      "These files are repository context; they were absent from this crate archive."]
            for file, data in upstream_entry["files"]:
                source_url = (f"{upstream_entry['repository']}/blob/"
                              f"{upstream_entry['revision']}/{file['path']}")
                sha = file["sha256"]
                lines += ["", f"--- Upstream: {source_url} (SHA-256 {sha}) ---"]
                if sha in emitted_texts:
                    lines.append("Identical source text is printed earlier in this bundle.")
                else:
                    lines.append(notice_text(data.decode("utf-8")))
                    emitted_texts.add(sha)
                upstream_files.append({"url": source_url, "sha256": sha})
        lines.append("")
        entries.append({"name": package["name"], "version": package["version"],
                        "source": package["source"], "license": package.get("license"),
                        "sourceFiles": file_entries, "upstreamFiles": upstream_files,
                        "standardTextIds": fallback})
    lines += ["=" * 78, "STANDARD SPDX LICENSE AND EXCEPTION TEXTS", ""]
    for identifier in sorted(fallback_ids):
        data = (STANDARD / identifier).read_text(encoding="utf-8")
        lines += [f"--- {identifier} ---", notice_text(data).rstrip("\n"), ""]
    manifest = {"schemaVersion": 1, "cargoLockSha256": digest(LOCK.read_bytes()),
                "externalPackageCount": len(entries), "standardTextIds": sorted(fallback_ids),
                "packages": entries}
    return "\n".join(lines).rstrip() + "\n", json.dumps(manifest, indent=2) + "\n", len(entries)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the committed bundle is stale")
    parser.add_argument("--offline", action="store_true", help="use cached Cargo metadata only")
    args = parser.parse_args()
    notices, manifest, count = generate(args.offline)
    if args.check:
        if (not OUTPUT.exists() or OUTPUT.read_bytes() != notices.encode("utf-8")
                or not MANIFEST.exists() or MANIFEST.read_bytes() != manifest.encode("utf-8")):
            print("Rust notice bundle is stale; run scripts/rust-notice-bundle.py", file=sys.stderr)
            return 1
    else:
        OUTPUT.write_text(notices)
        MANIFEST.write_text(manifest)
    print(f"Rust notice bundle: {count} external packages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
