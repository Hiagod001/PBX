const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('campaign list distinguishes loading, empty and failed responses', () => {
  const code = source.slice(source.indexOf('function renderDialerCampaignRows'), source.indexOf('function renderDialerCampaignLiveData'));
  const context = { state: { dialerCampaigns: [] } };
  vm.runInNewContext(code, context);
  assert.match(context.renderDialerCampaignRows(), /Carregando campanhas/);
  assert.doesNotMatch(context.renderDialerCampaignRows(), /Nenhuma campanha/);
  context.state.dialerCampaignsLoaded = true;
  assert.match(context.renderDialerCampaignRows(), /Nenhuma campanha/);
  context.state.dialerCampaignsError = true;
  assert.match(context.renderDialerCampaignRows(), /Nao foi possivel/);
});

test('failed or malformed campaign response never clears previously loaded campaigns', async () => {
  const code = source.slice(source.indexOf('async function loadDialerCampaigns'), source.indexOf('async function saveDialerCampaign'));
  for (const api of [async () => { throw new Error('offline'); }, async () => ({})]) {
    const campaigns = [{ id: 'existing' }];
    const context = { state: { dialerCampaigns: campaigns, activeTab: 'dialer' }, api, renderDialerCampaignLiveData() {} };
    vm.runInNewContext('let dialerCampaignsRequest = null;\n' + code, context);
    await assert.rejects(context.loadDialerCampaigns());
    assert.equal(context.state.dialerCampaigns, campaigns);
    assert.equal(context.state.dialerCampaignsError, true);
  }
});

test('campaign endpoint does not await trunk registration before returning the list', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const endpoint = server.slice(server.indexOf('app.get("/api/dialer/campaigns",'), server.indexOf('app.get("/api/dialer/campaigns/:id/report",'));
  assert.match(endpoint, /Promise\.all/);
  assert.doesNotMatch(endpoint, /await dialerTrunkHealth/);
});
