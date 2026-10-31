// The quick-win surfaces of the editor (tours, scale review, PDF layers)
// against the design system: small radii only, the default cursor, type
// sizes from the --ox-fs tokens, and no focus outline removed without a
// visible replacement.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const file = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const rules = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }));
const ours = (prefixes) => (rule) => prefixes.some((p) => rule.selector.includes(p));

const editorSheets = [
  ['../../styles/tour.css', ['.tour-']],
  ['../../styles/dialogs.css', ['.scale-review']],
  ['../../styles/panels.css', ['.pdf-layers', '.layers-note', '.layer-list']],
];
const checked = editorSheets.map(([rel, prefixes]) => ({ rel, list: rules(file(rel)).filter(ours(prefixes)) }));

test('the quick-win surfaces use the small radii and the default cursor', () => {
  for (const { rel, list } of checked) {
    assert.ok(list.length, rel);
    for (const { selector, body } of list) {
      assert.doesNotMatch(body, /cursor:\s*(pointer|move|grab)/, `${rel} ${selector}`);
      for (const [, value] of body.matchAll(/border(?:-[a-z-]+)?-radius:\s*([^;]+)/g)) {
        const tokens = [...value.matchAll(/var\(--ox-r-([a-z]+)/g)].map((m) => m[1]);
        assert.ok(tokens.every((t) => ['xs', 'sm', 'md'].includes(t)), `${rel} ${selector}: ${value}`);
        const px = [...value.replace(/var\([^)]*\)/g, '').matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
        assert.ok(px.every((n) => n <= 7), `${rel} ${selector}: ${value}`);
      }
    }
  }
});

test('the quick-win surfaces take their type sizes from the tokens', () => {
  for (const { rel, list } of checked) {
    for (const { selector, body } of list) {
      for (const [, value] of body.matchAll(/(?:^|[;\s])font-size:\s*([^;]+)/g)) {
        assert.match(value.trim(), /^var\(--ox-fs-|^inherit$/, `${rel} ${selector}: font-size ${value}`);
      }
    }
  }
});

test('a removed focus outline always has a visible replacement', () => {
  for (const { rel, list } of checked) {
    for (const { selector, body } of list) {
      if (!/outline:\s*none/.test(body) || !/focus/.test(selector)) continue;
      assert.match(body, /box-shadow|border-color/, `${rel} ${selector}`);
    }
  }
});
