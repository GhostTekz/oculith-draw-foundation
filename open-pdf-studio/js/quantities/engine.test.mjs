import { buildSchedule } from './engine.js';

const els = [
  { type: 'measureArea', page: 1, measureValue: 1.0, measureUnit: 'm²' },
  { type: 'measureArea', page: 1, measureValue: 2.0, measureUnit: 'm²' },
  { type: 'measureArea', page: 2, measureValue: 3.0, measureUnit: 'm²' },
  { type: 'measureDistance', page: 1, measureValue: 5.0, measureUnit: 'm' },
  { type: 'measureDistance', page: 1, measureValue: 7.0, measureUnit: 'm' },
];

// Categorie-filter op 'area', velden type+Oppervlakte, group op categorie.
const res = buildSchedule(els, {
  categories: ['area'],
  fields: ['type', 'area'],
  sort: [{ field: 'category', dir: 'asc', group: true }],
});

let ok = true;
function check(cond, msg) { if (!cond) { ok = false; console.error('FAIL:', msg); } }

check(res.count === 3, `count should be 3, got ${res.count}`);
check(res.groups.length === 1, `1 group expected, got ${res.groups.length}`);
check(Math.abs(res.groups[0].subtotals.area - 6.0) < 1e-9, `area subtotal 6, got ${res.groups[0].subtotals.area}`);
check(res.columns.length === 2, `2 columns, got ${res.columns.length}`);

// Filter > 1 m² → 2 rijen (2.0 en 3.0).
const filtered = buildSchedule(els, {
  categories: ['area'], fields: ['area'],
  filters: [{ field: 'area', op: '>', value: 1 }],
});
check(filtered.count === 2, `filter >1 → 2 rows, got ${filtered.count}`);

// Dak-correctie: 10 m² @ 30° → 10/cos30 ≈ 11.547.
const dak = buildSchedule(
  [{ type: 'measureArea', page: 1, measureValue: 10, measureUnit: 'm²', dakhoek: 30 }],
  { categories: ['area'], fields: ['realArea'] }
);
check(Math.abs(dak.grandTotals.realArea - 11.547) < 0.01, `realArea ~11.547, got ${dak.grandTotals.realArea}`);

console.log(ok ? 'OK — all checks passed' : 'FAILED');
process.exit(ok ? 0 : 1);
