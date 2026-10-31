// Dutch for the quick-win surfaces: the tour coach and the Basics tour, the
// PDF layer controls and the layer output refusal carry every English key,
// and a tour's text comes from its translations with its own English as the
// fallback.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { tourText, validateTour } from './tour-model.js';
import { basicsTour } from './foundation-tour.js';

const read = (locale, ns) => JSON.parse(readFileSync(new URL(`../i18n/locales/${locale}/${ns}.json`, import.meta.url), 'utf8'));
function flat(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
}
const pick = (obj, test) => Object.fromEntries(flat(obj).filter(([k]) => test(k)));

/** A lookup like i18next's for one bundle: nested keys, `{{x}}` values, defaultValue. */
const lookup = (bundle) => (key, options = {}) => {
  const value = key.split('.').reduce((at, part) => (at == null ? undefined : at[part]), bundle);
  if (typeof value !== 'string') return options.defaultValue ?? key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ''));
};

test('the quick-win keys are all in Dutch, none empty or left in English', () => {
  const blocks = [
    ['common', (k) => k.startsWith('leftPanel.pdfLayer') || k.startsWith('tour.')],
    ['dialogs', (k) => k.startsWith('layerSelection.') || k.startsWith('scaleReview.')],
  ];
  for (const [ns, wanted] of blocks) {
    const en = pick(read('en', ns), wanted);
    const nl = pick(read('nl', ns), wanted);
    assert.ok(Object.keys(en).length > 5, ns);
    assert.deepEqual(Object.keys(nl).sort(), Object.keys(en).sort(), `${ns}: same keys`);
    for (const [key, text] of Object.entries(nl)) {
      assert.ok(typeof text === 'string' && text.trim(), `nl ${ns}.${key}`);
      const vars = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort();
      assert.deepEqual(vars(text), vars(en[key]), `nl ${ns}.${key} keeps its placeholders`);
    }
  }
  const nl = read('nl', 'common');
  assert.notEqual(nl.tour.next, read('en', 'common').tour.next);
});

test('the Basics tour reads in Dutch, step for step, line for line', () => {
  const tour = validateTour(basicsTour);
  assert.equal(tour.textKey, 'basicsTour');
  const nl = read('nl', 'common').basicsTour;
  assert.equal(nl.steps.length, tour.steps.length);
  tour.steps.forEach((step, i) => assert.equal(nl.steps[i].body.length, step.body.length, `step ${i + 1}`));
  const t = lookup(read('nl', 'common'));
  const first = tourText(tour, 0, t);
  assert.equal(first.tourTitle, 'Basis');
  assert.equal(first.title, 'Een tekening openen');
  assert.match(first.body[0], /Bestand > Openen/);
  assert.equal(t('tour.stepOf', { index: 2, total: 6 }), 'Stap 2 van 6');
  // English: no translation bundle needed; the tour's own text.
  const en = tourText(tour, 0, lookup(read('en', 'common')));
  assert.deepEqual([en.tourTitle, en.title, en.body], [tour.title, tour.steps[0].title, [...tour.steps[0].body]]);
});

test('a tour without translations, or with a bad text key, behaves as before', () => {
  const plain = validateTour({ id: 'x.plain', title: 'Plain', steps: [{ title: 'One', body: 'Line' }] });
  assert.equal(plain.textKey, undefined);
  assert.deepEqual(tourText(plain, 0, () => 'never used'), { tourTitle: 'Plain', title: 'One', body: ['Line'] });
  assert.throws(() => validateTour({ id: 'x.bad', title: 'B', textKey: 'a.b', steps: [{ title: 'S', body: 'L' }] }), /textKey/);
  // An empty translation falls back to the tour's own line.
  const keyed = validateTour({ id: 'x.keyed', title: 'K', textKey: 'k', steps: [{ title: 'S', body: ['L1', 'L2'] }] });
  assert.deepEqual(tourText(keyed, 0, lookup({ k: { steps: [{ title: 'T', body: ['', 'R2'] }] } })).body, ['L1', 'R2']);
});
