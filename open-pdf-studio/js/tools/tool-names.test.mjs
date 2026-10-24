import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every literal setTool('<name>') in js/ must name a tool that is registered
// in js/tools/tools/index.js. An unregistered name makes the button or menu
// item a dead control: setTool() switches state.currentTool, but no tool
// handles the pointer events.

const hier = path.dirname(fileURLToPath(import.meta.url));
const jsRoot = path.resolve(hier, '..');

// Names that are valid without a registerTool() entry in index.js. Plugins
// can provide tools at runtime (annotation-type-registry fallback in
// tool-dispatcher.js), but no built-in UI should rely on that, so keep this
// list empty unless a plugin-provided name is called from core UI on purpose.
const PLUGIN_PROVIDED = new Set([]);

function registeredToolNames() {
  const src = fs.readFileSync(path.join(hier, 'tools', 'index.js'), 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/registerTool\(\s*['"]([^'"]+)['"]/g)) names.add(m[1]);
  return names;
}

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      sourceFiles(p, out);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

function literalSetToolCalls() {
  const calls = [];
  for (const file of sourceFiles(jsRoot)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bsetTool\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      calls.push({ name: m[1], where: `${path.relative(jsRoot, file)}:${line}` });
    }
  }
  return calls;
}

test('registry parse finds the core tools', () => {
  const names = registeredToolNames();
  for (const name of ['select', 'hand', 'comment', 'line', 'box']) {
    assert.ok(names.has(name), `expected '${name}' in tools/index.js`);
  }
});

test('every literal setTool() name is a registered tool', () => {
  const registered = registeredToolNames();
  const calls = literalSetToolCalls();
  assert.ok(calls.length > 20, `expected many setTool() calls, found ${calls.length}`);
  const dead = calls
    .filter(({ name }) => !registered.has(name) && !PLUGIN_PROVIDED.has(name))
    .map(({ name, where }) => `${name} (${where})`);
  assert.deepEqual(dead, [], `setTool() with unregistered tool names:\n${dead.join('\n')}`);
});
