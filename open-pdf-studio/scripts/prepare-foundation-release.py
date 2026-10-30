#!/usr/bin/env python3
"""Validate Foundation installer receipts and prepare a portable source bundle.

This local, offline gate does not publish a release. Python 3.10+ and Git are
required. The source archive must be a tar.gz of the exact public Git tree.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile


HASH = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+ -]*$")
SOURCE_BASE = "https://github.com/GhostTekz/oculith-foundation"
MAX_SOURCE_BYTES = 2 * 1024**3
MAX_SOURCE_FILES = 100_000


def fail(message):
    raise ValueError(message)


def sha256(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular_file(file):
    if not file.is_file() or file.is_symlink():
        fail(f"Expected a regular file: {file.name}")


def git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    if result.returncode:
        fail(f"Cannot validate source tree: git {args[0]} failed")
    return result.stdout.strip()


def source_tree(archive, scratch):
    """Extract only regular GitHub archive members and calculate their Git tree."""
    checkout = scratch / "source-checkout"
    checkout.mkdir()
    git(checkout, "init", "--quiet")
    prefix = None
    seen = set()
    total = 0
    files = []
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            parts = PurePosixPath(member.name).parts
            if (not parts or member.name.startswith("/") or "\\" in member.name
                    or any(part in ("", ".", "..") for part in parts)):
                fail("Source archive contains an unsafe path")
            if prefix is None:
                prefix = parts[0]
            if parts[0] != prefix:
                fail("Source archive has multiple top-level directories")
            if len(parts) == 1:
                if not member.isdir():
                    fail("Source archive root is not a directory")
                continue
            relative = PurePosixPath(*parts[1:])
            if any(part.casefold() == ".git" for part in relative.parts):
                fail("Source archive contains Git metadata")
            if relative in seen:
                fail("Source archive contains a duplicate path")
            seen.add(relative)
            destination = checkout.joinpath(*relative.parts)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                fail("Source archive contains a link or unsupported file")
            total += member.size
            if total > MAX_SOURCE_BYTES or len(files) >= MAX_SOURCE_FILES:
                fail("Source archive exceeds the review limit")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as input_file, destination.open("xb") as output_file:
                shutil.copyfileobj(input_file, output_file, 1024 * 1024)
            # Git trees record the executable bit, not the full POSIX mode.
            mode = "100755" if member.mode & 0o111 else "100644"
            blob = git(checkout, "hash-object", "-w", "--no-filters", str(destination))
            git(checkout, "update-index", "--add", "--cacheinfo", f"{mode},{blob},{relative}")
            files.append(relative)
    if not files:
        fail("Source archive contains no files")
    package = checkout / "open-pdf-studio" / "package.json"
    try:
        version = json.loads(package.read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError) as error:
        fail(f"Source archive has no valid package version: {error}")
    return git(checkout, "write-tree"), version


def receipt_for(file, artifact):
    regular_file(file)
    regular_file(artifact)
    try:
        receipt = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        fail(f"Invalid receipt {file.name}: {error}")
    fields = {"product", "version", "sourceCommit", "sourceTree", "sourceArchiveUrl",
              "resources", "noticeFilesChecked", "artifactSha256"}
    if not isinstance(receipt, dict) or set(receipt) != fields:
        fail(f"Receipt {file.name} has missing or unexpected fields")
    if receipt["product"] != "Oculith Draw Foundation":
        fail(f"Receipt {file.name} identifies another product")
    if (not isinstance(receipt["sourceCommit"], str)
            or not isinstance(receipt["sourceTree"], str)
            or not HASH.fullmatch(receipt["sourceCommit"])
            or not HASH.fullmatch(receipt["sourceTree"])):
        fail(f"Receipt {file.name} has an invalid source revision")
    if (receipt["sourceArchiveUrl"] !=
            f"{SOURCE_BASE}/archive/{receipt['sourceCommit']}.tar.gz"):
        fail(f"Receipt {file.name} has an invalid source route")
    if not isinstance(receipt["version"], str) or not receipt["version"]:
        fail(f"Receipt {file.name} has no version")
    if (not isinstance(receipt["noticeFilesChecked"], int)
            or isinstance(receipt["noticeFilesChecked"], bool)
            or receipt["noticeFilesChecked"] <= 0):
        fail(f"Receipt {file.name} has no notice audit")
    resources = receipt["resources"]
    # NSIS installs the resource directory at the package root. Its relative
    # path is empty; other installer formats must name a resource directory.
    if (not isinstance(resources, str)
            or (not resources and not artifact.name.lower().endswith("-setup.exe"))
            or resources.startswith("/")
            or ".." in PurePosixPath(resources).parts):
        fail(f"Receipt {file.name} has an invalid resource path")
    if not isinstance(receipt["artifactSha256"], str) or not SHA256.fullmatch(receipt["artifactSha256"]):
        fail(f"Receipt {file.name} has no installer digest")
    if sha256(artifact) != receipt["artifactSha256"]:
        fail(f"Installer digest differs from receipt {file.name}")
    return receipt


def prepare(source, pairs, output):
    regular_file(source)
    if not pairs:
        fail("At least one installer and receipt pair is required")
    if output.exists() or output.is_symlink():
        fail("Output already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="foundation-release-", dir=output.parent) as temp:
        scratch = Path(temp)
        bundle = scratch / "bundle"
        (bundle / "source").mkdir(parents=True)
        (bundle / "installers").mkdir()
        (bundle / "receipts").mkdir()
        source_copy = bundle / "source" / "foundation-source.tar.gz"
        shutil.copyfile(source, source_copy)
        tree, version = source_tree(source_copy, scratch)
        receipts = []
        names = set()
        for artifact, receipt_file in pairs:
            for file in (artifact, receipt_file):
                if not SAFE_NAME.fullmatch(file.name) or file.name.casefold() in names:
                    fail("Installer and receipt names must be simple and distinct")
                names.add(file.name.casefold())
            regular_file(artifact)
            regular_file(receipt_file)
            artifact_copy = bundle / "installers" / artifact.name
            receipt_copy = bundle / "receipts" / receipt_file.name
            shutil.copyfile(artifact, artifact_copy)
            shutil.copyfile(receipt_file, receipt_copy)
            receipts.append((artifact_copy, receipt_copy, receipt_for(receipt_copy, artifact_copy)))
        commit = receipts[0][2]["sourceCommit"]
        if any(item["sourceCommit"] != commit or item["sourceTree"] != tree
               or item["version"] != version for _, _, item in receipts):
            fail("Installer receipts do not match the source archive and each other")
        source_name = f"foundation-{commit}.tar.gz"
        source_copy.rename(bundle / "source" / source_name)
        manifest = {
            "schemaVersion": 1,
            "product": "Oculith Draw Foundation",
            "version": version,
            "sourceCommit": commit,
            "sourceTree": tree,
            "sourceArchiveUrl": f"{SOURCE_BASE}/archive/{commit}.tar.gz",
            "source": {"path": f"source/{source_name}", "sha256": sha256(bundle / "source" / source_name)},
            "installers": [],
        }
        for artifact, receipt_file, item in receipts:
            manifest["installers"].append({
                "path": f"installers/{artifact.name}", "sha256": item["artifactSha256"],
                "receipt": f"receipts/{receipt_file.name}", "receiptSha256": sha256(receipt_file),
                "noticeFilesChecked": item["noticeFilesChecked"],
            })
        (bundle / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        # The target was checked before work began; do not replace a target
        # created concurrently by another process.
        if output.exists() or output.is_symlink():
            fail("Output appeared while preparing the bundle")
        bundle.rename(output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Matching public source tar.gz")
    parser.add_argument("--output", required=True, type=Path, help="New bundle directory")
    parser.add_argument("--pair", nargs=2, action="append", metavar=("INSTALLER", "RECEIPT"),
                        type=Path, required=True, help="Repeat for each installer")
    args = parser.parse_args()
    try:
        result = prepare(args.source, args.pair, args.output)
        print(f"Prepared {len(result['installers'])} Foundation installer(s) for {result['sourceCommit']}")
    except (ValueError, OSError, tarfile.TarError) as error:
        print(f"Release bundle rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
