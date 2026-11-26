const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareContainerApplyHelper } = require('../deploy/dokploy/prepare-apply-helper.cjs');

test('container apply keeps only the persistent sound volume and preserves all other operations', () => {
  const source = fs.readFileSync(path.join(__dirname,'../scripts/apply-root.sh'),'utf8');
  const updated = prepareContainerApplyHelper(source);
  const pattern = /^ASTERISK_SOUND_DIRS=\(\r?\n[\s\S]*?^\)/m;
  assert.equal(updated.replace(pattern,'SOUND_DIRECTORIES'),source.replace(pattern,'SOUND_DIRECTORIES'));
  assert.equal(updated.match(pattern)[0],'ASTERISK_SOUND_DIRS=(\n  "/usr/share/asterisk/sounds/custom"\n)');
  assert.equal(prepareContainerApplyHelper(updated),updated);
});

test('unexpected container audio layouts require review rather than dropping a directory', () => {
  assert.throws(()=>prepareContainerApplyHelper('#!/bin/bash\necho ok\n'),/not found/);
  assert.throws(()=>prepareContainerApplyHelper('ASTERISK_SOUND_DIRS=(\n  "/another/pbx/sounds"\n)\n'),/Unexpected/);
});
