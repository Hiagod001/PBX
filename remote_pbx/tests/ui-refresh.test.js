const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('background render restores icons before exposing the refreshed surface', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const fn = source.match(/function renderSurfaceInBackground\(root, render\) \{[\s\S]*?\n\}/)[0];
  const events = [];
  const root = {};
  const context = {
    surfaceHasActiveEditor: () => false,
    captureSurfaceDraft: () => ({ value: 'unsaved' }),
    restoreSurfaceDraft: (_root, draft) => { assert.equal(draft.value, 'unsaved'); events.push('draft'); },
    iconRefresh: () => events.push('icons')
  };
  vm.createContext(context);
  vm.runInContext(fn, context);
  assert.equal(context.renderSurfaceInBackground(root, () => events.push('render')), true);
  assert.deepEqual(events, ['render', 'draft', 'icons']);
  context.surfaceHasActiveEditor = () => true;
  events.length = 0;
  assert.equal(context.renderSurfaceInBackground(root, () => events.push('render')), false);
  assert.deepEqual(events, []);
});

test('dialplan changes refresh queue subscriptions even when the member list is unchanged', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/apply-root.sh'), 'utf8');
  assert.match(source, /if \[\[ "\$changed" == \*" queues\.conf "\* \|\| "\$changed" == \*" extensions\.conf "\* \|\| "\$changed" == \*" pjsip\.conf "\* \]\]; then\s*#[^\n]*\n\s*touch \/etc\/asterisk\/queues\.conf\s*\/usr\/sbin\/asterisk -rx "module reload app_queue\.so"/);
});
