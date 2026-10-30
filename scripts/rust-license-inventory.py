#!/usr/bin/env python3
"""Snapshot the locked Cargo graph's declared license metadata.

This is a metadata inventory, not a collection of license texts or a legal
assessment. Run from anywhere with `python scripts/rust-license-inventory.py`;
use `--check` in validation and `--offline` when dependencies are cached.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "Cargo.lock"
OUTPUT = ROOT / "open-pdf-studio/src-tauri/package-notices/rust-inventory.json"


def inventory(offline: bool) -> dict:
    command = ["cargo", "metadata", "--locked", "--format-version", "1"]
    if offline:
        command.append("--offline")
    metadata = json.loads(subprocess.check_output(command, cwd=ROOT))
    members = set(metadata["workspace_members"])
    packages = []
    for package in metadata["packages"]:
        license_file = package.get("license_file")
        if license_file and Path(license_file).is_absolute():
            raise ValueError(f"absolute license_file in {package['name']}: {license_file}")
        item = {
            "name": package["name"],
            "version": package["version"],
            "source": package["source"],
            "workspace": package["id"] in members,
            "licenseField": package.get("license"),
            "licenseFileField": license_file,
        }
        packages.append(item)
    packages.sort(key=lambda item: (item["name"], item["version"], item["source"] or ""))
    missing = [f"{item['name']}@{item['version']}" for item in packages
               if not item["licenseField"] and not item["licenseFileField"]]
    return {
        "schemaVersion": 1,
        "cargoLockSha256": hashlib.sha256(LOCK.read_bytes()).hexdigest(),
        "metadataCommand": "cargo metadata --locked --format-version 1",
        "packageCount": len(packages),
        "missingLicenseMetadata": missing,
        "packages": packages,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the committed snapshot is stale")
    parser.add_argument("--offline", action="store_true", help="use cached Cargo metadata only")
    args = parser.parse_args()
    data = inventory(args.offline)
    rendered = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered:
            print(f"Rust license metadata inventory is stale: {OUTPUT}", file=sys.stderr)
            return 1
    else:
        OUTPUT.write_text(rendered)
    print(f"Rust license metadata: {data['packageCount']} packages; "
          f"missing declarations: {', '.join(data['missingLicenseMetadata']) or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
