// Node-test voor de pure "Plakken op plaats"-logica (GitHub issue #269).
// Draaien: node test-paste-in-place.mjs
import { cloneAnnotationsInPlace, defaultIdGenerator } from './js/annotations/paste-in-place.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS  ${msg}`); }
  else { console.error(`  FAIL  ${msg}`); failures++; }
}
function assertEq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`        verwacht ${JSON.stringify(expected)}, kreeg ${JSON.stringify(actual)}`);
  assert(ok, msg);
}

console.log('Test 1: enkele annotatie — positie/afmetingen/rotatie exact behouden');
{
  const source = {
    id: 'orig-1', type: 'box', page: 1,
    x: 123.5, y: 456.25, width: 80, height: 40, rotation: 15,
    color: '#ff0000', opacity: 0.8,
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
  };
  const [clone] = cloneAnnotationsInPlace([source], 2, {
    makeId: () => 'nieuw-1',
    now: () => '2026-07-13T12:00:00.000Z',
  });
  assertEq(clone.x, 123.5, 'x ongewijzigd');
  assertEq(clone.y, 456.25, 'y ongewijzigd');
  assertEq(clone.width, 80, 'width ongewijzigd');
  assertEq(clone.height, 40, 'height ongewijzigd');
  assertEq(clone.rotation, 15, 'rotation ongewijzigd');
  assertEq(clone.page, 2, 'page = doelpagina');
  assertEq(clone.id, 'nieuw-1', 'nieuw id');
  assert(clone.id !== source.id, 'id verschilt van origineel');
  assertEq(clone.createdAt, '2026-07-13T12:00:00.000Z', 'createdAt vernieuwd');
  assertEq(clone.color, '#ff0000', 'stijl mee-gekloond');
  // Origineel onaangetast
  assertEq(source.page, 1, 'bron niet gemuteerd (page)');
  assertEq(source.id, 'orig-1', 'bron niet gemuteerd (id)');
}

console.log('Test 2: lijn-/pad-/center-gebaseerde coördinaten exact behouden');
{
  const line = { id: 'l1', type: 'line', page: 3, startX: 10, startY: 20, endX: 110, endY: 220 };
  const circle = { id: 'c1', type: 'circle', page: 3, centerX: 55.5, centerY: 66.6, radius: 12 };
  const ink = { id: 'i1', type: 'draw', page: 3, path: [{ x: 1, y: 2 }, { x: 3.25, y: 4.75 }] };
  const clones = cloneAnnotationsInPlace([line, circle, ink], 7, { makeId: (() => { let n = 0; return () => `id-${++n}`; })() });
  assertEq(clones[0].startX, 10, 'startX behouden');
  assertEq(clones[0].endY, 220, 'endY behouden');
  assertEq(clones[1].centerX, 55.5, 'centerX behouden');
  assertEq(clones[1].centerY, 66.6, 'centerY behouden');
  assertEq(clones[2].path, [{ x: 1, y: 2 }, { x: 3.25, y: 4.75 }], 'path-punten behouden');
  assert(clones[2].path !== ink.path, 'path is een diepe kopie (geen gedeelde referentie)');
  assertEq(clones.map(c => c.page), [7, 7, 7], 'alle klonen op doelpagina');
}

console.log('Test 3: multi-selectie — onderlinge posities behouden');
{
  const a = { id: 'a', type: 'box', page: 1, x: 100, y: 100, width: 50, height: 20 };
  const b = { id: 'b', type: 'box', page: 1, x: 250, y: 340, width: 30, height: 30 };
  const [ca, cb] = cloneAnnotationsInPlace([a, b], 4);
  assertEq(cb.x - ca.x, 150, 'onderlinge dx behouden');
  assertEq(cb.y - ca.y, 240, 'onderlinge dy behouden');
  assert(ca.id !== cb.id, 'klonen hebben verschillende id\'s');
  assert(ca.id !== 'a' && cb.id !== 'b', 'klonen hebben nieuwe id\'s');
}

console.log('Test 4: herhaald plakken — elke aanroep verse klonen, positie blijft exact');
{
  const src = [{ id: 's', type: 'stamp', page: 1, x: 42, y: 84, width: 10, height: 10, rotation: 90 }];
  const eerste = cloneAnnotationsInPlace(src, 2);
  const tweede = cloneAnnotationsInPlace(src, 3);
  assertEq(eerste[0].x, 42, 'eerste plak: x exact');
  assertEq(tweede[0].x, 42, 'tweede plak: x nog steeds exact (geen cascade)');
  assertEq(tweede[0].rotation, 90, 'rotatie behouden bij herhaald plakken');
  assert(eerste[0] !== tweede[0], 'aparte objecten per plak-actie');
  assertEq([eerste[0].page, tweede[0].page], [2, 3], 'elke plak op eigen doelpagina');
}

console.log('Test 5: randgevallen');
{
  assertEq(cloneAnnotationsInPlace([], 1), [], 'lege lijst → lege lijst');
  assertEq(cloneAnnotationsInPlace(null, 1), [], 'null → lege lijst');
  const single = cloneAnnotationsInPlace({ id: 'x', type: 'note', page: 9, x: 1, y: 2 }, 5);
  assertEq(single.length, 1, 'los object wordt als 1-element-lijst behandeld');
  assertEq(single[0].x, 1, 'positie van los object behouden');
  const id = defaultIdGenerator();
  assert(typeof id === 'string' && id.length > 8, 'defaultIdGenerator levert bruikbaar id');
}

console.log('');
if (failures > 0) {
  console.error(`${failures} test(s) GEFAALD`);
  process.exit(1);
}
console.log('Alle tests geslaagd.');
