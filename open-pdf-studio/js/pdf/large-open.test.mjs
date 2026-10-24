import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  LARGE_FILE_BYTES,
  LARGE_PAGE_COUNT,
  isLargeOpen,
  openAnnotationWindow,
  pageTypeChunks,
} from './large-open.js';

test('a short file is not a large open', () => {
  assert.equal(isLargeOpen({ numPages: 7, byteLength: 24 * 1024 * 1024 }), false);
  assert.equal(isLargeOpen({ numPages: LARGE_PAGE_COUNT - 1, byteLength: LARGE_FILE_BYTES - 1 }), false);
});

test('a long set or a file past the byte line is a large open', () => {
  assert.equal(isLargeOpen({ numPages: LARGE_PAGE_COUNT, byteLength: 0 }), true);
  assert.equal(isLargeOpen({ numPages: 2, byteLength: LARGE_FILE_BYTES }), true);
  assert.equal(isLargeOpen({ numPages: 536, byteLength: 564 * 1024 * 1024 }), true);
  assert.equal(isLargeOpen({ numPages: 1, byteLength: 2.5 * 1024 * 1024 * 1024 }), true);
});

test('the open window is the sheet on screen and its two neighbours', () => {
  assert.deepEqual(openAnnotationWindow(10, 536), [10, 11, 9]);
  assert.deepEqual(openAnnotationWindow(1, 536), [1, 2]);
  assert.deepEqual(openAnnotationWindow(536, 536), [536, 535]);
  assert.deepEqual(openAnnotationWindow(0, 3), [1, 2]);
});

test('page types for a large set are classified a few sheets at a time', () => {
  assert.deepEqual(pageTypeChunks(3, false), [[0, 1, 2]]);
  const chunks = pageTypeChunks(20, true);
  assert.deepEqual(chunks, [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [8, 9, 10, 11, 12, 13, 14, 15],
    [16, 17, 18, 19],
  ]);
});

test('opening a large file does not warm every sheet up front', () => {
  const loader = readFileSync(new URL('./loader.js', import.meta.url), 'utf8');
  const load = loader.slice(loader.indexOf('export async function loadPDF'));
  assert.match(load, /doc\._largeOpen = largeOpen/);
  assert.match(load, /doc\.pdfDoc\.numPages > 0/);
  assert.match(load, /if \(largeOpen\) doc\._deferSharedPdfLib = true/);
  assert.match(load, /if \(filePath && isTauri\(\) && !doc\._largeOpen\)/);
  const existing = loader.slice(loader.indexOf('export async function loadExistingAnnotations'));
  assert.match(existing, /if \(doc\._largeOpen\)/);
  assert.match(existing, /openAnnotationWindow\(doc\.currentPage \|\| 1, doc\.pdfDoc\.numPages\)/);
  const panel = readFileSync(new URL('../ui/panels/left-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /doc\?._largeOpen === true/);
  assert.match(panel, /workerOnly: true/);
  assert.doesNotMatch(panel, /thumbnailBlockedOnType/);
});
