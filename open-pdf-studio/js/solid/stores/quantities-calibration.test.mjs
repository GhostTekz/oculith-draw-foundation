import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const quantities = await import('./quantitiesStore.js');
const { buildResultForSchedule } = await import('./schedulesStore.js');
const { scheduleResultToCsv } = await import('../../quantities/schedule-csv.js');
const { scheduleResultToTable } = await import('../../quantities/schedule-templates.js');
const { sumMeasurements } = await import('../../quantities/measurement-summary.js');

test('measurement summary never combines physical distance and page points', () => {
  assert.deepEqual(sumMeasurements([
    { measureValue: 5, measureUnit: 'm' },
    { measureValue: 7, measureUnit: 'm' },
  ]), { value: 12, unit: 'm' });
  assert.deepEqual(sumMeasurements([
    { measureValue: 5, measureUnit: 'pt' },
    { measureValue: 7, measureUnit: 'pt' },
  ]), { value: 12, unit: 'pt' });
  assert.equal(sumMeasurements([
    { measureValue: 5, measureUnit: 'm' },
    { measureValue: 7, measureUnit: 'pt' },
  ]), null);
  assert.equal(sumMeasurements([{ measureValue: 5 }]), null);
});

test('quantity panel and exports preserve page units across a local scale region', () => {
  const previousDocuments = state.documents;
  const previousIndex = state.activeDocumentIndex;
  const previousScale = state.preferences.measureScale;
  const previousFields = quantities.scheduledFields();
  const previousSort = quantities.sortLevels();
  const previousCategories = quantities.selectedCategories();
  const doc = {
    id: 'quantity-calibration-test', currentPage: 1, measureScale: null,
    pdfViewports: {}, annotations: [
      { id: 'scaled', type: 'box', page: 1, x: 10, y: 10, width: 10, height: 10 },
      { id: 'page', type: 'box', page: 1, x: 110, y: 10, width: 10, height: 10 },
      { id: 'region', type: 'scaleRegion', page: 1, x: 0, y: 0, width: 50, height: 50,
        scaleString: '1:100', units: 'mm' },
    ],
  };
  try {
    state.preferences.measureScale = null;
    state.documents = [doc];
    state.activeDocumentIndex = 0;
    quantities.setSelectedCategories(['area']);
    quantities.setScheduledFields(['type', 'area']);
    quantities.setSortLevels([]);

    const mixed = quantities.scheduleResult();
    const boxes = mixed.groups.flatMap(g => g.rows).filter(r => r.el.type === 'box');
    assert.deepEqual(boxes.map(r => r.units.area), ['m²', 'pt²']);
    assert.equal(mixed.columns.find(c => c.key === 'area').unit, '');
    assert.equal(mixed.grandTotals.area, null, 'meters and page points cannot be summed');
    const csv = scheduleResultToCsv(mixed);
    const table = scheduleResultToTable(mixed, 'Takeoff');
    assert.match(csv, /100\.00 pt²/);
    assert.match(csv, /m²/);
    assert.match(table.rows.flatMap(r => r.cells).join(' '), /100\.00 pt²/);
    assert.match(csv, /Grand total,Mixed or unknown units/);
    const saved = buildResultForSchedule({ config: {
      categories: ['area'], fields: ['type', 'area'], itemize: true,
    } });
    assert.deepEqual(saved.groups.flatMap(g => g.rows).filter(r => r.el.type === 'box')
      .map(r => r.units.area), ['m²', 'pt²'], 'saved schedule uses the same local calibration');
    assert.equal(saved.grandTotals.area, null);

    state.documents[0].annotations.splice(2, 1);
    const unscaled = quantities.scheduleResult();
    assert.equal(unscaled.columns.find(c => c.key === 'area').unit, 'pt²');
    assert.equal(unscaled.grandTotals.area, 200);
    assert.match(scheduleResultToCsv(unscaled), /Area \(pt²\)/);
  } finally {
    state.documents = previousDocuments;
    state.activeDocumentIndex = previousIndex;
    state.preferences.measureScale = previousScale;
    quantities.setSelectedCategories(previousCategories);
    quantities.setScheduledFields(previousFields);
    quantities.setSortLevels(previousSort);
  }
});
