"""Offline checks for the Foundation release preparation gate."""

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


MODULE = Path(__file__).with_name("prepare-foundation-release.py")
SPEC = importlib.util.spec_from_file_location("foundation_release", MODULE)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


class ReleaseBundleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR"))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "public"
        self.repo.mkdir()
        git(self.repo, "init", "--quiet")
        git(self.repo, "config", "user.name", "Test")
        git(self.repo, "config", "user.email", "test@example.invalid")
        package = self.repo / "open-pdf-studio" / "package.json"
        package.parent.mkdir()
        package.write_text('{"version":"2026.68.0"}\n', encoding="utf-8")
        (self.repo / "LICENSE.md").write_text("LGPL source fixture\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "--quiet", "-m", "Fixture")
        self.commit = git(self.repo, "rev-parse", "HEAD")
        self.tree = git(self.repo, "rev-parse", "HEAD^{tree}")
        self.source = self.root / "source.tar.gz"
        with self.source.open("wb") as stream:
            subprocess.run(["git", "-C", str(self.repo), "archive", "--format=tar.gz",
                            f"--prefix=oculith-foundation-{self.commit}/", "HEAD"],
                           stdout=stream, check=True)
        self.artifact = self.root / "foundation.deb"
        self.artifact.write_bytes(b"installer bytes")
        self.receipt = self.root / "audit.json"
        self.data = {
            "product": "Oculith Draw Foundation", "version": "2026.68.0",
            "sourceCommit": self.commit, "sourceTree": self.tree,
            "sourceArchiveUrl": f"{release.SOURCE_BASE}/archive/{self.commit}.tar.gz",
            "resources": "usr/lib/oculith", "noticeFilesChecked": 61,
            "artifactSha256": hashlib.sha256(self.artifact.read_bytes()).hexdigest(),
        }
        self.write_receipt()
        self.output = self.root / "release"

    def write_receipt(self):
        self.receipt.write_text(json.dumps(self.data) + "\n", encoding="utf-8")

    def prepare(self):
        return release.prepare(self.source, [(self.artifact, self.receipt)], self.output)

    def test_valid_archive_and_installer_are_copied_with_manifest(self):
        manifest = self.prepare()
        self.assertEqual(manifest["sourceTree"], self.tree)
        self.assertEqual(manifest["sourceCommit"], self.commit)
        self.assertEqual((self.output / "installers" / "foundation.deb").read_bytes(), b"installer bytes")
        self.assertEqual(json.loads((self.output / "receipts" / "audit.json").read_text()), self.data)
        self.assertEqual(json.loads((self.output / "release-manifest.json").read_text()), manifest)

    def test_macos_zip_with_spaces_is_accepted_with_matching_receipt(self):
        mac_zip = self.root / "Oculith Draw Foundation.zip"
        mac_zip.write_bytes(b"mac app zip bytes")
        mac_receipt = self.root / "foundation-package-audit-app.json"
        mac_data = dict(self.data)
        mac_data["resources"] = "Contents/Resources"
        mac_data["artifactSha256"] = hashlib.sha256(mac_zip.read_bytes()).hexdigest()
        mac_receipt.write_text(json.dumps(mac_data) + "\n", encoding="utf-8")
        manifest = release.prepare(self.source, [(self.artifact, self.receipt),
                                                 (mac_zip, mac_receipt)], self.output)
        self.assertEqual(len(manifest["installers"]), 2)
        self.assertEqual(manifest["installers"][1]["path"],
                         "installers/Oculith Draw Foundation.zip")
        self.assertEqual((self.output / "installers" / mac_zip.name).read_bytes(),
                         mac_zip.read_bytes())

    def test_changed_installer_is_rejected_without_output(self):
        self.artifact.write_bytes(b"tampered installer")
        with self.assertRaisesRegex(ValueError, "digest differs"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_different_source_tree_is_rejected_without_output(self):
        (self.repo / "LICENSE.md").write_text("different source\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "--quiet", "-m", "Different")
        with self.source.open("wb") as stream:
            subprocess.run(["git", "-C", str(self.repo), "archive", "--format=tar.gz",
                            f"--prefix=oculith-foundation-{self.commit}/", "HEAD"],
                           stdout=stream, check=True)
        with self.assertRaisesRegex(ValueError, "do not match the source archive"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_missing_artifact_digest_is_rejected(self):
        del self.data["artifactSha256"]
        self.write_receipt()
        with self.assertRaisesRegex(ValueError, "missing or unexpected fields"):
            self.prepare()

    def test_second_receipt_from_different_revision_is_rejected(self):
        second_artifact = self.root / "foundation.AppImage"
        second_artifact.write_bytes(b"second installer")
        second_receipt = self.root / "audit-appimage.json"
        second = dict(self.data)
        second["sourceCommit"] = "f" * 40
        second["sourceArchiveUrl"] = f"{release.SOURCE_BASE}/archive/{second['sourceCommit']}.tar.gz"
        second["artifactSha256"] = hashlib.sha256(second_artifact.read_bytes()).hexdigest()
        second_receipt.write_text(json.dumps(second) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "do not match the source archive"):
            release.prepare(self.source, [(self.artifact, self.receipt),
                                          (second_artifact, second_receipt)], self.output)
        self.assertFalse(self.output.exists())

    def test_archive_link_is_rejected(self):
        with tarfile.open(self.source, "w:gz") as archive:
            member = tarfile.TarInfo("oculith-foundation/source-link")
            member.type = tarfile.SYMTYPE
            member.linkname = "../../elsewhere"
            archive.addfile(member)
        with self.assertRaisesRegex(ValueError, "link or unsupported file"):
            self.prepare()


if __name__ == "__main__":
    unittest.main()
