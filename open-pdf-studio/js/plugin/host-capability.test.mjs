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

test('the drawing revision modules (Compare, slip sheet alignment and carry) are part of the interface', async () => {
  const { provides, loadHostModules, hostModule } = await import('./host.js');
  for (const id of ['js/compare/compare-store.js', 'js/compare/page-label-matches.js', 'js/sets/slip-sheet-carry.js', 'js/sets/slip-sheet-transform.js']) {
    assert.equal(provides(id), true, id);
  }
  await loadHostModules(['js/sets/slip-sheet-transform.js', 'js/compare/page-label-matches.js'], { parallel: true });
  const transform = hostModule('js/sets/slip-sheet-transform.js');
  assert.deepEqual(transform.applyPoint([2, 0, 0, 2, 1, 1], 3, 4), { x: 7, y: 9 });
  assert.equal(typeof hostModule('js/compare/page-label-matches.js').suggestPagePairsByLabel, 'function');
  assert.equal(provides('js/compare/compare-viewport.js'), false);
});
