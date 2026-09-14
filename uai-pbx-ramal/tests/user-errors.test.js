const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { message } = require('../src/user-errors');

test('Electron call wrapper becomes a friendly route message', () => {
  const error = new Error("Error invoking remote method 'extension:call': Error: Numero sem rota de saida para este ramal");
  assert.equal(message(error), 'N\u00famero sem rota de sa\u00edda para este ramal.');
});
test('known errors are translated without returning technical details', () => {
  const cases = [
    ['Ramal ou senha invalidos', 'incorretos'],
    ['Ramal nao autenticado', 'Entre novamente'],
    ['Encerre a ligacao antes de colocar o ramal em pausa.', 'Encerre'],
    ['Nenhuma chamada ativa encontrada para transferir', 'transferir'],
    ['ECONNREFUSED 131.0.112.23:3090', 'conectar ao servidor'],
    ['TimeoutError: request timed out', 'demorou'],
    ['NotAllowedError: Permission denied', 'microfone'],
    ['NotFoundError: Requested device not found', 'microfone'],
    ['NotReadableError: Could not start audio', 'microfone'],
    ['Comando indisponivel no host Asterisk', 'indispon\u00edvel'],
    ['Informe o numero para ligar.', 'Informe o n\u00famero'],
    ['Error: HTTP 429 Too many requests', 'Aguarde']
  ];
  for (const [raw, expected] of cases) {
    const result = message(new Error(`Error invoking remote method 'extension:call': ${raw}`));
    assert.ok(result.includes(expected), result);
    assert.doesNotMatch(result, /Error|extension:|Asterisk|ECONN|131\.0|3090/);
  }
});
test('unknown errors never expose stack traces, paths, server payloads or codes', () => {
  for (const raw of [undefined, null, {}, 'TypeError: undefined at C:\\Users\\private\\app.js:20', 'SQL error SELECT password FROM users', '<html>Bad gateway nginx</html>', new Error('unexpected internal detail')]) {
    assert.equal(message(raw), message(null));
  }
  assert.equal(message(new Error('internal stack'), 'Tente novamente.'), 'Tente novamente.');
});
test('renderer uses the error presenter rather than showing raw exception messages', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  assert.doesNotMatch(source, /(?:setMessage|showLogin)\([^\n]*error\.message/);
  assert.match(source, /addEventListener\("unhandledrejection"/);
  assert.match(source, /addEventListener\("error"/);
});
