const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('pause guard rejects active calls before running Asterisk or changing history', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const code = source.slice(source.indexOf('function updateExtensionPause('), source.indexOf('async function setExtensionPause('));
  let active = true;
  const commands = [];
  const context = vm.createContext({
    pauseMutation: Promise.resolve(), pbxStatusCache: {},
    getConfig: async () => ({}), readPbxStatus: async () => ({}),
    channelsOwnedByExtension: () => active ? [{}] : [],
    runAsteriskControl: async action => { commands.push(action); return 'OK'; },
    setExtensionPause: async () => ({})
  });
  vm.runInContext(code, context);
  await assert.rejects(context.updateExtensionPause('777', true, 'Almoco'), error => error.status === 409);
  assert.deepEqual(commands, []);
  await context.updateExtensionPause('777', false);
  active = false;
  await context.updateExtensionPause('777', true, 'Almoco');
  assert.deepEqual(commands, ['queue-unpause', 'queue-pause']);
});

test('dialer audio upload selects the new audio and preserves the rest of the form', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf('  if (event.target.id === "dialerAudioFile")');
  const end = source.indexOf('  const userMenuInput', start);
  assert.ok(start > 0 && end > start);
  const handlerSource = '(async (event) => {' + source.slice(start, end) + '})';
  const button = { disabled: false };
  const select = { value: 'old', innerHTML: '' };
  const form = { name: 'Draft retained', querySelector: selector => selector.includes('select') ? select : button };
  const input = { id: 'dialerAudioFile', files: [new Blob(['test'])], value: 'selected', closest: () => form };
  const messages = [];
  let success = true;
  const context = vm.createContext({ FormData, state: {},
    fetch: async () => ({ ok: success, json: async () => success ? { audio: { playback: 'custom/new' }, audios: [] } : { error: 'Upload failed' } }),
    audioChoices: value => value, setMessage: value => messages.push(value)
  });
  const handler = vm.runInContext(handlerSource, context);
  await handler({ target: input });
  assert.equal(select.value, 'custom/new');
  assert.equal(form.name, 'Draft retained');
  assert.equal(button.disabled, false);
  assert.equal(input.value, '');
  success = false;
  await handler({ target: input });
  assert.equal(messages.at(-1), 'Upload failed');
  assert.equal(select.value, 'custom/new');
  assert.equal(button.disabled, false);
});

test('browser extension keeps the installed phone controls and input guards', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(source, /id="softphoneClearBtn"/);
  assert.match(source, /id="softphoneSpeakerBtn"/);
  assert.match(source, /id="softphoneVolume"/);
  assert.match(source, /id="softphoneCallDevice"/);
  assert.match(source, /id="softphoneMicDevice"/);
  assert.match(source, /id="assistedTransferCompleteBtn"/);
  assert.match(source, /replace\(\/\[\^0-9\*#\]\//);
  assert.match(source, /Encerre a ligação antes de colocar o ramal em pausa/);
});
