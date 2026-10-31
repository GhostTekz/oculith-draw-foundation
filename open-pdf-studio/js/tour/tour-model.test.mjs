import test from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_STORAGE_KEY, createTourProgress, startRun, transition, validateTour, validateTours } from './tour-model.js';
import { basicsTour } from './foundation-tour.js';
import { composeAddons } from '../editions/compose-addons.js';
import { assertEditionContract } from '../editions/contract.js';
import { edition as foundation } from '../editions/community.js';

const tour = (id = 'demo.tour', steps = 3) => ({
  id, title: 'Demo',
  steps: Array.from({ length: steps }, (_, i) => ({ anchor: `#a${i}`, title: `Step ${i + 1}`, body: `Line ${i + 1}` })),
});

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

test('validateTour normalises steps and rejects malformed tours', () => {
  const checked = validateTour(tour());
  assert.equal(checked.steps.length, 3);
  assert.deepEqual(checked.steps[0].body, ['Line 1']);
  assert.equal(checked.steps[0].placement, 'auto');
  assert.ok(Object.isFrozen(checked.steps[0]));
  assert.throws(() => validateTour({ ...tour(), id: 'Bad Id' }), /Invalid tour id/);
  assert.throws(() => validateTour({ ...tour(), steps: [] }), /needs 1 to/);
  assert.throws(() => validateTour({ ...tour(), steps: [{ title: 'x', body: ['1', '2', '3', '4'] }] }), /more than 3 lines/);
  assert.throws(() => validateTour({ ...tour(), steps: [{ title: 'x', body: 'y', placement: 'diagonal' }] }), /placement/);
  assert.throws(() => validateTour({ ...tour(), steps: [{ title: 'x', body: 'y', prepare: 'no' }] }), /prepare/);
  assert.throws(() => validateTour({ ...tour(), steps: [{ title: 'x', body: 'y', panel: 'a b' }] }), /panel id/);
  assert.equal(validateTour({ ...tour(), steps: [{ title: 'x', body: 'y', panel: 'thumbnails' }] }).steps[0].panel, 'thumbnails');
  assert.throws(() => validateTours([tour('a'), tour('a')]), /Duplicate tour id/);
});

test('the basics tour is valid and short', () => {
  const checked = validateTour(basicsTour);
  assert.ok(checked.steps.length >= 5 && checked.steps.length <= 8);
  for (const step of checked.steps) assert.ok(step.body.length <= 3);
});

test('next, back, skip, pause and finish move the run as expected', () => {
  const checked = validateTour(tour());
  let run = startRun(checked);
  assert.deepEqual(run, { tourId: 'demo.tour', index: 0, total: 3 });
  ({ run } = transition(run, 'back'));
  assert.equal(run.index, 0, 'back stops at the first step');
  ({ run } = transition(run, 'next'));
  ({ run } = transition(run, 'next'));
  assert.equal(run.index, 2);
  let ended;
  ({ run, ended } = transition(run, 'back'));
  assert.equal(run.index, 1);
  assert.equal(ended, null);
  ({ run, ended } = transition(run, 'pause'));
  assert.equal(run, null);
  assert.deepEqual(ended, { status: 'paused', step: 1 });
  ({ run, ended } = transition(startRun(checked, 2), 'next'));
  assert.equal(run, null);
  assert.equal(ended.status, 'done');
  assert.equal(transition(startRun(checked), 'skip').ended.status, 'skipped');
  assert.equal(transition(startRun(checked), 'finish').ended.status, 'done');
  assert.deepEqual(transition(null, 'next'), { run: null, ended: null });
  assert.throws(() => transition(startRun(checked), 'jump'), /Unknown tour action/);
  assert.equal(startRun(checked, 9).index, 0, 'an out-of-range start begins at the top');
});

test('progress remembers completion per tour id and resumes a paused tour', () => {
  const storage = memoryStorage();
  const progress = createTourProgress(storage);
  assert.equal(progress.get('demo.tour'), null);
  assert.equal(progress.completed('demo.tour'), false);
  progress.record('demo.tour', { status: 'paused', step: 2 });
  assert.equal(progress.resumeAt('demo.tour', 3), 2);
  assert.equal(progress.resumeAt('demo.tour', 2), 0, 'a step past a shortened tour starts at the top');
  assert.equal(progress.completed('demo.tour'), false);
  progress.record('demo.tour', { status: 'done', step: 0 });
  progress.record('other.tour', { status: 'skipped', step: 4 });
  assert.equal(progress.completed('demo.tour'), true);
  assert.equal(progress.completed('other.tour'), true);
  assert.equal(progress.resumeAt('demo.tour', 3), 0);
  // A new reader of the same storage sees the same progress.
  const again = createTourProgress(storage);
  assert.deepEqual(again.get('other.tour'), { status: 'skipped', step: 0 });
  assert.deepEqual(JSON.parse(storage.getItem(TOUR_STORAGE_KEY)), {
    'demo.tour': { status: 'done', step: 0 }, 'other.tour': { status: 'skipped', step: 0 },
  });
  again.forget('demo.tour');
  assert.equal(progress.get('demo.tour'), null);
});

test('progress survives broken or missing storage', () => {
  const broken = createTourProgress(memoryStorage({ [TOUR_STORAGE_KEY]: '{not json' }));
  assert.equal(broken.get('demo.tour'), null);
  const throwing = createTourProgress({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  assert.doesNotThrow(() => throwing.record('demo.tour', { status: 'done', step: 0 }));
  assert.equal(throwing.completed('demo.tour'), false);
  const odd = createTourProgress(memoryStorage({ [TOUR_STORAGE_KEY]: JSON.stringify({ x: { status: 'weird' } }) }));
  assert.equal(odd.get('x'), null);
});

test('an add-on and a full edition can bring tours', () => {
  const result = composeAddons(foundation, [
    { id: 'one', addon: { apiVersion: 2, id: 'one', tours: [tour('one.tour')] } },
    { id: 'dup', addon: { apiVersion: 2, id: 'dup', tours: [tour('one.tour')] } },
    { id: 'old', addon: { apiVersion: 1, id: 'old', tours: [tour('old.tour')] } },
    { id: 'bad', addon: { apiVersion: 2, id: 'bad', tours: [{ id: 'bad.tour', title: 'x', steps: [] }] } },
  ]);
  assert.deepEqual(result.accepted, ['one']);
  assert.deepEqual(result.rejected.map((item) => item.id), ['dup', 'old', 'bad']);
  assert.deepEqual(result.edition.tours.map((item) => item.id), ['one.tour']);
  assert.doesNotThrow(() => assertEditionContract({ ...foundation, tours: [tour('full.tour')] }));
  assert.throws(() => assertEditionContract({ ...foundation, tours: [{ id: 'x' }] }), /title/);
});
