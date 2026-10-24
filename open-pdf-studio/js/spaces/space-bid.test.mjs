// Bid by space: parent rows use markupsInSpace (no second add of children),
// the document total counts each markup once, uncalibrated physical numbers
// stay out, and prices are formula columns only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const {
  spaceBid, spaceBidCsv, bidQuantityText, BID_MIXED_UNITS,
  SPACE_BID_COLUMNS, SPACE_BID_SCALE_COLUMN, SPACE_BID_DOCUMENT,
} = await import('./space-bid.js');

const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

const space = (id, name, page, x0, y0, x1, y1) => ({
  id, name, page, parentId: null, color: '#27ae60', points: rect(x0, y0, x1, y1),
});

const length = (id, page, x, y, value, unit, extra = {}) => ({
  id, type: 'measureDistance', page, startX: x, startY: y, endX: x + 10, endY: y,
  measureValue: value, measureUnit: unit, measureCalibrated: true, ...extra,
});

function row(bid, path) {
  const found = bid.rows.find((item) => item.path === path);
  assert.ok(found, path);
  return found;
}

test('a parent includes sub-spaces once; the document total does not add the rows', () => {
  const doc = {
    spaces: [
      space('office', 'Office', 1, 0, 0, 200, 200),
      space('closet', 'Closet', 1, 0, 0, 80, 80),
      space('hall', 'Hall', 2, 0, 0, 100, 100),
    ],
    annotations: [
      length('closet-len', 1, 10, 50, 10, 'm'),
      length('office-len', 1, 140, 150, 5, 'm'),
      length('hall-len', 2, 10, 10, 3, 'm'),
      length('outside', 1, 400, 400, 7, 'm'),
      length('raw', 1, 20, 60, 9, 'm', { measureCalibrated: false }),
      {
        id: 'slab', type: 'measureArea', page: 1, points: rect(10, 10, 30, 30),
        measureValue: 4, measureUnit: 'm²', measureVolumeValue: 2, measureWallAreaValue: 8,
        measureCalibrated: false,
      },
      { id: 'dots', type: 'count', page: 1, x: 150, y: 160, width: 10, height: 10 },
      { id: 'skip', type: 'count', page: 1, x: 20, y: 20, width: 10, height: 10, engineOutsideSpace: true },
      { id: 'scale', type: 'scaleRegion', page: 1, x: 10, y: 10, width: 20, height: 20, measureValue: 99, measureUnit: 'm' },
    ],
    formulaCaptions: {
      v: 1,
      columns: [{ name: 'Cost', expression: 'Length * 4', unit: '$', decimals: 2, lengthUnit: 'm' }],
    },
  };
  const bid = spaceBid(doc);
  const office = row(bid, 'Office');
  const closet = row(bid, 'Office ▸ Closet');
  const hall = row(bid, 'Hall');

  assert.equal(closet.length, 10);
  assert.equal(closet.lengthUnit, 'm');
  assert.equal(office.length, 15, 'parent is the rollup, not the rollup plus the child');
  assert.equal(hall.length, 3);
  assert.equal(bid.total.length, 25, 'each markup once, including one outside every space');
  assert.notEqual(bid.total.length, office.length + closet.length + hall.length);

  assert.equal(closet.area, null);
  assert.equal(closet.volume, null);
  assert.equal(closet.wallArea, null);
  assert.equal(closet.scaleNotSet, 4, 'one uncalibrated length plus area, volume and wall area');
  assert.equal(office.scaleNotSet, 4);
  assert.equal(hall.scaleNotSet, 0);
  assert.equal(bid.total.scaleNotSet, 4);

  assert.equal(closet.count, 0);
  assert.equal(office.count, 1, 'a count flagged outside the space stays out of the space');
  assert.equal(bid.total.count, 2);

  assert.deepEqual(bid.formulaNames, ['Cost']);
  assert.equal(closet.formulas[0].text, '40.00 $');
  assert.equal(office.formulas[0].text, '60.00 $');
  assert.equal(hall.formulas[0].text, '12.00 $');
  assert.equal(bid.total.formulas[0].text, '100.00 $');
  assert.equal(bid.total.formulas[0].total, 100);
  assert.notEqual(bid.total.formulas[0].total, 60 + 40 + 12);
});

test('mixed units suppress the physical total; a formula may still convert', () => {
  const doc = {
    spaces: [space('room', 'Room', 1, 0, 0, 100, 100)],
    annotations: [
      length('metres', 1, 10, 10, 2, 'm'),
      length('millis', 1, 40, 40, 500, 'mm'),
    ],
    formulaCaptions: {
      v: 1,
      columns: [
        { name: 'Len m', expression: 'Length', decimals: 3, lengthUnit: 'm' },
        { name: 'Cost', expression: 'Length * 10', unit: '$', decimals: 2, lengthUnit: 'm' },
      ],
    },
  };
  const bid = spaceBid(doc);
  const room = row(bid, 'Room');
  assert.equal(room.length, null);
  assert.equal(room.lengthMixed, true);
  assert.equal(bidQuantityText(room.length, room.lengthUnit, room.lengthMixed), BID_MIXED_UNITS);
  assert.equal(bid.total.lengthMixed, true);
  assert.equal(room.formulas[0].total, 2.5);
  assert.equal(room.formulas[1].text, '25.00 $');
  assert.equal(room.scaleNotSet, 0);
});

test('page points are not a physical total', () => {
  const doc = {
    spaces: [space('s', 'S', 1, 0, 0, 40, 40)],
    annotations: [length('pts', 1, 5, 5, 70, 'pt', { measureCalibrated: true })],
  };
  const bid = spaceBid(doc);
  assert.equal(row(bid, 'S').length, null);
  assert.equal(row(bid, 'S').scaleNotSet, 1);
  assert.equal(bid.total.length, null);
});

test('a blank measurement does not count as scale not set', () => {
  const doc = {
    spaces: [space('s', 'S', 1, 0, 0, 20, 20)],
    annotations: [{
      id: 'blank', type: 'measureDistance', page: 1, startX: 1, startY: 1, endX: 4, endY: 1,
      measureCalibrated: false,
    }],
  };
  const got = row(spaceBid(doc), 'S');
  assert.equal(got.length, 0);
  assert.equal(got.scaleNotSet, 0);
});

test('prices are formula results only, not a number column', () => {
  const base = {
    spaces: [space('room', 'Room', 1, 0, 0, 50, 50)],
    annotations: [{ id: 'note', type: 'textbox', page: 1, x: 1, y: 1, width: 4, height: 4, markupNumberValue: 9 }],
    markupNumberColumn: { version: 1, name: 'Rate' },
  };
  assert.deepEqual(spaceBid(base).formulaNames, []);
  assert.equal(row(spaceBid(base), 'Room').formulas.length, 0);

  const priced = spaceBid({
    ...base,
    formulaCaptions: { v: 1, columns: [{ name: 'Price', expression: 'Rate * 2', unit: '$', decimals: 2 }] },
  });
  assert.deepEqual(priced.formulaNames, ['Price']);
  assert.equal(row(priced, 'Room').formulas[0].text, '18.00 $');
  assert.equal(priced.total.formulas[0].total, 18);
});

test('CSV lists the space rows and one document total', () => {
  const doc = {
    spaces: [space('a', 'A, B', 1, 0, 0, 30, 30)],
    annotations: [length('len', 1, 5, 5, 2, 'm')],
    formulaCaptions: { v: 1, columns: [{ name: 'Cost', expression: 'Length * 3', unit: '$', decimals: 2, lengthUnit: 'm' }] },
  };
  const csv = spaceBidCsv(doc);
  assert.equal(csv.charCodeAt(0), 80, 'no BOM; the download adds it');
  const lines = csv.split('\n');
  assert.equal(lines[0], [...SPACE_BID_COLUMNS, 'Cost', SPACE_BID_SCALE_COLUMN].join(','));
  assert.equal(lines[1], '"A, B",1,0,2 m,0,0,0,6.00 $,0');
  assert.equal(lines[2], `${SPACE_BID_DOCUMENT},,0,2 m,0,0,0,6.00 $,0`);
  assert.equal(lines.length, 3);
});
