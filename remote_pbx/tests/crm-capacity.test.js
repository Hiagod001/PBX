const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("fixed and adaptive dialing use only free agents in their destination", async () => {
  const code = fs.readFileSync(path.join(__dirname,"../server.js"),"utf8");
  const busy = new Set(["777"]);
  const crmDialer = {availabilityFresh: () => true, busyExtensions: () => busy};
  const members = ["777","778"];
  const readPbxStatus = async () => ({
    extensions: members.map(number => ({number, captureReady:true})),
    queues: [{id:"support", agents:members.map(number => ({number, registered:true, status:"available"}))}]
  });
  const capacity = vm.runInNewContext("(" + code.slice(code.indexOf("async function dialerCapacity("),
    code.indexOf("async function tickDialerCampaigns(")).trim() + ")", {readPbxStatus,crmDialer});
  const config = {queues:[{id:"support",members}]};
  const campaign = {destinationType:"extension",destination:"777",maxConcurrent:5,numbers:[]};
  assert.equal(await capacity(config,campaign,[]),0);
  campaign.destinationType="queue";
  campaign.destination="support";
  assert.equal(await capacity(config,campaign,[]),1);
  campaign.perAgent=2;
  assert.equal(await capacity(config,campaign,[]),2);
  assert.equal(await capacity(config,campaign,[{...campaign,numbers:[{status:"queued"}]}]),1);
  busy.add("778");
  assert.equal(await capacity(config,campaign,[]),0);
  busy.clear();
  assert.equal(await capacity(config,campaign,[]),4);
  crmDialer.availabilityFresh=()=>false;
  assert.equal(await capacity(config,campaign,[]),0);
});
