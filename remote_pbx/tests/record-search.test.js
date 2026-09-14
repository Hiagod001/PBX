const test = require('node:test');
const assert = require('node:assert/strict');
const { matches } = require('../public/record-search');
test('record search ignores case and accents and accepts multiple terms', () => {
  assert.equal(matches('706 Brendaperes UAI', '706 brenda'), true);
  assert.equal(matches('85 COBRAN\u00c7A', 'cobranca'), true);
  assert.equal(matches('Recep\u00e7\u00e3o principal', ' PRINCIPAL recepcao '), true);
  assert.equal(matches('777 Hiago', '706'), false);
  assert.equal(matches('777 Hiago', ''), true);
});
