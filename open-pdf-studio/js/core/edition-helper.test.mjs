import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addonHelperAvailable, addonHelperCall, helperCall, onAddonHelperEvent, shareAddonFile,
} from './edition-helper.js';

test('package calls carry their ID and do not change the full-edition route', async () => {
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => {
    calls.push({ command, args });
    return command === 'addon_helper_available' ? true : { ok: true };
  } } } };
  try {
    assert.equal(await addonHelperAvailable('first.tools'), true);
    assert.deepEqual(await addonHelperCall('second.tools', 'ping', { value: 7 }), { ok: true });
    assert.deepEqual(await helperCall('ping'), { ok: true });
    assert.deepEqual(calls, [
      { command: 'addon_helper_available', args: { packageId: 'first.tools' } },
      { command: 'addon_helper_call', args: { packageId: 'second.tools', method: 'ping', params: { value: 7 } } },
      { command: 'edition_helper_call', args: { method: 'ping', params: null } },
    ]);
  } finally { delete globalThis.window; }
});

test('file sharing targets only the requested package helper command', async () => {
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => {
    calls.push({ command, args });
    return true;
  } } } };
  try {
    assert.equal(await shareAddonFile('sample.tools', '/drawings/sample.pdf'), true);
    assert.deepEqual(calls, [{ command: 'addon_helper_share_file', args: {
      packageId: 'sample.tools', path: '/drawings/sample.pdf',
    } }]);
  } finally { delete globalThis.window; }
});

test('failed package event subscriptions clean up and can retry', async () => {
  const { onAddonHelperEvent: subscribe } = await import('./edition-helper.js?retry-listener');
  let attempts = 0;
  let callback;
  const seen = [];
  globalThis.window = { __TAURI__: { event: { listen: async (_name, fn) => {
    attempts += 1;
    if (attempts === 1) throw new Error('listener unavailable');
    callback = fn;
    return () => {};
  } } } };
  try {
    await assert.rejects(subscribe('retry.tools', 'ready', () => seen.push('stale')), /listener unavailable/);
    const stop = await subscribe('retry.tools', 'ready', (payload) => seen.push(payload));
    assert.equal(attempts, 2);
    callback({ payload: { packageId: 'retry.tools', event: 'ready', payload: 'current' } });
    assert.deepEqual(seen, ['current']);
    stop();
  } finally { delete globalThis.window; }
});

test('package events are delivered only to their package and event name', async () => {
  let callback;
  const seen = [];
  globalThis.window = { __TAURI__: { event: { listen: async (name, fn) => {
    assert.equal(name, 'addon-helper');
    callback = fn;
    return () => {};
  } } } };
  try {
    const stop = await onAddonHelperEvent('first.tools', 'ready', (payload) => seen.push(payload));
    callback({ payload: { packageId: 'second.tools', event: 'ready', payload: 1 } });
    callback({ payload: { packageId: 'first.tools', event: 'other', payload: 2 } });
    callback({ payload: { packageId: 'first.tools', event: 'ready', payload: 3 } });
    assert.deepEqual(seen, [3]);
    stop();
  } finally { delete globalThis.window; }
});
