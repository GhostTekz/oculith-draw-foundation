import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const verifier = fileURLToPath(new URL('./verify-linux-pdfium.sh', import.meta.url));
const archive = process.env.PDFIUM_TEST_ARCHIVE;

test('the pinned Linux PDFium archive passes verification and altered bytes fail', {
  skip: archive ? false : 'Set PDFIUM_TEST_ARCHIVE to the downloaded release archive',
}, () => {
  const valid = spawnSync('bash', [verifier, archive], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr || `Could not verify ${archive}`);

  const directory = mkdtempSync(join(tmpdir(), 'ocudraw-pdfium-checksum-'));
  try {
    const changed = join(directory, 'pdfium-linux-x64.tgz');
    copyFileSync(archive, changed);
    const bytes = readFileSync(changed);
    bytes[0] ^= 0xff;
    writeFileSync(changed, bytes);
    const invalid = spawnSync('bash', [verifier, changed], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /checksum mismatch/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const workflow of ['ci.yml', 'nightly.yml', 'release.yml']) {
  test(`${workflow} verifies the pinned archive before extraction`, () => {
    const source = readFileSync(new URL(`../../.github/workflows/${workflow}`, import.meta.url), 'utf8');
    const step = source.match(/- name: Fetch libpdfium\.so \(Linux\)\n(?<body>[\s\S]*?)(?=\n      - name:|$)/)?.groups?.body;
    assert.ok(step, 'Linux PDFium fetch step must exist');
    const download = step.indexOf('pdfium-binaries/releases/download/chromium%2F8076/pdfium-linux-x64.tgz');
    const verify = step.indexOf('bash scripts/verify-linux-pdfium.sh /tmp/pdfium-linux.tgz');
    const extract = step.indexOf('tar xzf /tmp/pdfium-linux.tgz');
    assert.ok(download >= 0 && download < verify && verify < extract,
      'pinned download must be verified before extraction');
    assert.match(step, /set -euo pipefail/);
    assert.match(step, /curl -fL/);
  });
}
