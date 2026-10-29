import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBoxTools } from './box-tools.js';
import { composeAddons } from './compose-addons.js';
import { edition as foundation } from './community.js';

const id = 'sample.tools';
const toolId = `addon:${id}:review-box`;
const alias = (style = {}) => ({ id: toolId, style });

test('a v2 package adds only a scoped styled core box tool', () => {
  const style = { color: '#123456', fillColor: null, lineWidth: 2, opacity: 0.5,
    subject: 'Review' };
  const result = composeAddons(foundation, [{ id, addon: { apiVersion: 2, id, boxTools: [alias(style)] } }]);
  assert.deepEqual(result.accepted, [id]);
  assert.equal(result.edition.boxTools[0].id, toolId);
  assert.equal(result.edition.boxTools[0].style.strokeColor, '#123456');
  assert.equal(foundation.boxTools, undefined);
  style.color = '#ffffff';
  assert.equal(result.edition.boxTools[0].style.color, '#123456', 'composition owns a style copy');
});

test('invalid, unscoped, and colliding tools reject only their package', () => {
  const invalid = [
    { apiVersion: 1, id, boxTools: [alias()] },
    { apiVersion: 2, id, boxTools: [{ id: 'box', style: {} }] },
    { apiVersion: 2, id, boxTools: [alias(), alias()] },
    { apiVersion: 2, id, boxTools: [alias({ type: 'custom' })] },
    { apiVersion: 2, id, boxTools: [alias({ color: 'url(x)' })] },
    { apiVersion: 2, id, boxTools: [alias({ opacity: 2 })] },
    { apiVersion: 2, id, boxTools: [alias({ lineWidth: Infinity })] },
    { apiVersion: 2, id, boxTools: [alias({ subject: '' })] },
  ];
  for (const addon of invalid) {
    const result = composeAddons(foundation, [{ id, addon }]);
    assert.deepEqual(result.accepted, []);
    assert.equal(result.edition, foundation);
  }
  const fullEdition = { ...foundation, tools: { shapeToolIds: [toolId], allowClick: [],
    createAnnotation: () => null } };
  const conflict = composeAddons(fullEdition, [{ id, addon: { apiVersion: 2, id, boxTools: [alias()] } }]);
  assert.deepEqual(conflict.accepted, []);
  assert.equal(conflict.edition, fullEdition);
  assert.match(conflict.rejected[0].error.message, /Duplicate tool id/);
  assert.deepEqual(validateBoxTools(id, [alias({ strokeColor: '#abcdef' })])[0].style,
    { strokeColor: '#abcdef', color: '#abcdef' });
});
