import assert from 'node:assert/strict';
import test from 'node:test';
import { installHost } from './host.js';

test('host shares only explicitly published, versioned plug-in functions', () => {
  installHost();
  const host = globalThis.__ocudrawHost;
  assert.equal(host.capability('example.fixture/1'), null);
  const provider = () => ({ count: 2 });
  host.publishCapability('example.fixture/1', provider);
  assert.equal(host.capability('example.fixture/1'), provider);
  assert.throws(() => host.publishCapability('example.fixture/1', provider), /duplicate/);
  assert.throws(() => host.publishCapability('example.fixture', provider), /Invalid/);
  assert.throws(() => host.publishCapability('example.other/1', {}), /Invalid/);
});
