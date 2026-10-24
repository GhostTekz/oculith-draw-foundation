import assert from 'node:assert/strict';
import test from 'node:test';
import { tileCacheClearAll, tileCacheClearForFile, tileCacheGet, tileCacheSet } from './tile-cache.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function installDeferredBitmaps() {
  const original = globalThis.createImageBitmap;
  const requests = [];
  globalThis.createImageBitmap = () => {
    const gate = deferred();
    requests.push(gate);
    return gate.promise;
  };
  return {
    requests,
    restore() { globalThis.createImageBitmap = original; tileCacheClearAll(); },
  };
}

function bitmap() {
  return { width: 8, height: 8, closed: false, close() { this.closed = true; } };
}

const put = (path, page = 1) => tileCacheSet(path, page, 1, 0, '0,0', { width: 8, height: 8 }, {});
const get = (path, page = 1) => tileCacheGet(path, page, 1, 0, '0,0');

test('concurrent completions obey the eight-entry limit', async () => {
  const stub = installDeferredBitmaps();
  try {
    const work = Array.from({ length: 9 }, (_, i) => put('many.pdf', i + 1));
    const images = stub.requests.map(() => bitmap());
    stub.requests.forEach((request, i) => request.resolve(images[i]));
    await Promise.all(work);
    assert.equal(get('many.pdf', 1), null);
    assert.equal(images[0].closed, true);
    for (let page = 2; page <= 9; page++) assert.ok(get('many.pdf', page));
  } finally { stub.restore(); }
});

test('newer insert owns a shared key even if the older bitmap resolves last', async () => {
  const stub = installDeferredBitmaps();
  try {
    const first = put('same.pdf');
    const second = put('same.pdf');
    const newer = bitmap();
    const older = bitmap();
    stub.requests[1].resolve(newer);
    await second;
    stub.requests[0].resolve(older);
    await first;
    assert.equal(get('same.pdf').bitmap, newer);
    assert.equal(older.closed, true);
    assert.equal(newer.closed, false);
  } finally { stub.restore(); }
});

test('clear all invalidates an insert for a path never previously cached', async () => {
  const stub = installDeferredBitmaps();
  try {
    const pending = put('new.pdf');
    tileCacheClearAll();
    const image = bitmap();
    stub.requests[0].resolve(image);
    await pending;
    assert.equal(get('new.pdf'), null);
    assert.equal(image.closed, true);
  } finally { stub.restore(); }
});

test('closing a file rejects its pending bitmap without touching another file', async () => {
  const stub = installDeferredBitmaps();
  try {
    const first = put('closed.pdf');
    const second = put('open.pdf');
    tileCacheClearForFile('closed.pdf');
    const closed = bitmap(), open = bitmap();
    stub.requests[0].resolve(closed);
    stub.requests[1].resolve(open);
    await Promise.all([first, second]);
    assert.equal(get('closed.pdf'), null);
    assert.equal(closed.closed, true);
    assert.equal(get('open.pdf').bitmap, open);
  } finally { stub.restore(); }
});

test('byte budget evicts an old tile before eight entries are reached', async () => {
  const stub = installDeferredBitmaps();
  try {
    const large = { width: 5000, height: 5000 };
    const first = tileCacheSet('large.pdf', 1, 1, 0, '0,0', large, {});
    const second = tileCacheSet('large.pdf', 2, 1, 0, '0,0', large, {});
    const old = bitmap(), newer = bitmap();
    stub.requests[0].resolve(old);
    stub.requests[1].resolve(newer);
    await Promise.all([first, second]);
    assert.equal(get('large.pdf', 1), null);
    assert.equal(old.closed, true);
    assert.equal(get('large.pdf', 2).bitmap, newer);
  } finally { stub.restore(); }
});
