const {callVars} = require("./crm-dialer");
const fs = require("fs/promises");
const crypto = require("crypto");

function whatsappNumber(value) {
  const number = String(value || "").replace(/\D/g, "");
  if (/^\d{10,11}$/.test(number)) return `55${number}`;
  if (/^55\d{10,11}$/.test(number)) return number;
  throw new Error("Informe o número com DDD. Exemplo: 34 99999-9999.");
}
function whatsappCallFile(campaign, lead, address = "127.0.0.1:3099") {
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(address) || !/^[a-f0-9-]{36}$/.test(lead.waCallId) ||
      !/^[a-zA-Z0-9_.-]{1,80}$/.test(lead.attemptId) || !/^[a-zA-Z0-9_.-]{1,50}$/.test(campaign.id) ||
      !/^[a-zA-Z0-9_.-]{1,40}$/.test(campaign.destination) || !["queue", "extension"].includes(campaign.destinationType)) {
    throw new Error("Os dados do atendimento estão inválidos. Revise o destino da campanha.");
  }
  const phone = whatsappNumber(lead.number);
  return [
    `Channel: AudioSocket/${address}/${lead.waCallId}/c(slin)`,
    `CallerID: WhatsApp <${phone}>`, `Account: ${lead.attemptId}`,
    "MaxRetries: 0", "WaitTime: 15", "Context: dialer-whatsapp", "Extension: s", "Priority: 1",
    ...callVars(campaign,lead),
    `Setvar: __WA_ATTEMPT_ID=${lead.attemptId}`, `Setvar: __WA_TARGET=${phone}`,
    `Setvar: __WA_CAMPAIGN_ID=${campaign.id}`, `Setvar: WA_DEST_TYPE=${campaign.destinationType}`,
    `Setvar: WA_DESTINATION=${campaign.destination}`, "Archive: yes", ""
  ].join("\n");
}
function whatsappOutcome(record, accepted = false) {
  if (accepted) return { status: "accepted", label: "Atendeu e conversou com um atendente", retryable: false };
  if (record.answered_at) return { status: "answered", label: record.result === "bridge_failed" ?
    "Atendeu, mas não foi possível conectar ao atendimento" : "Atendeu, mas não houve conversa com um atendente", retryable: false };
  return {
    no_answer: { status: "no_answer", label: "Não atendeu no WhatsApp", retryable: true },
    not_registered: { status: "failed", label: "Este número não foi encontrado no WhatsApp", retryable: false },
    lookup_failed: { status: "failed", label: "Não foi possível consultar o número no WhatsApp", retryable: true },
    declined: { status: "canceled", label: "A pessoa recusou a ligação no WhatsApp", retryable: false },
    busy: { status: "busy", label: "O contato estava ocupado no WhatsApp", retryable: true },
    ended_before_answer: { status: "canceled", label: "A ligação foi encerrada antes de o cliente atender", retryable: false },
    canceled: { status: "canceled", label: "Ligação cancelada antes do atendimento", retryable: false },
    interrupted: { status: "failed", label: "A conexão foi interrompida. Confira o resultado antes de tentar novamente", retryable: false },
    media_failed: { status: "failed", label: "Não foi possível conectar o áudio da ligação", retryable: false },
    storage_unavailable: { status: "failed", label: "Não foi possível salvar a tentativa", retryable: false }
  }[record.result] || { status: "failed", label: "Não foi possível confirmar a ligação. Confira antes de tentar novamente", retryable: false };
}

class WhatsAppDialer {
  constructor({ configPath, readCampaigns, updateCampaigns, enqueue, finish, reports, reportForAttempt, acceptedAttempt, capacity }) {
    Object.assign(this, { configPath, readCampaigns, updateCampaigns, enqueue, finish, reports, reportForAttempt, acceptedAttempt, capacity });
    this.lock = Promise.resolve();
    this.cachedStatus = { configured: false, connected: false, account: "", busy: false, maxConcurrent: 1, checkedAt: 0 };
    this.nextStatusAt = 0;
  }
  serialize(task) { this.lock = this.lock.catch(() => {}).then(task); return this.lock; }
  async settings() {
    const config = JSON.parse(await fs.readFile(this.configPath, "utf8"));
    const url = new URL(config.url);
    if (url.protocol !== "http:" || !["whatsapp-gateway", "127.0.0.1"].includes(url.hostname) ||
        typeof config.token !== "string" || config.token.length < 32) throw new Error("Integração do WhatsApp não configurada.");
    return config;
  }
  async request(route, { method = "GET", body } = {}) {
    const config = await this.settings();
    const response = await fetch(new URL(route, config.url), {
      method, headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(3500), redirect: "error"
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(response.status === 409 ? "Já existe uma ligação pelo WhatsApp." : "Não foi possível acessar o WhatsApp. Confira a conexão.");
      error.status = response.status; throw error;
    }
    return data;
  }
  async status(force = false) {
    if (!force && this.nextStatusAt > Date.now()) return this.cachedStatus;
    try { this.cachedStatus = { configured: true, ...await this.request("/internal/status") }; }
    catch { this.cachedStatus = { ...this.cachedStatus, connected: false, message: "WhatsApp indisponível. Confira a conexão do aparelho." }; }
    this.cachedStatus.checkedAt = Date.now();
    this.nextStatusAt = Date.now() + 5000;
    return this.cachedStatus;
  }
  async authenticate(headers) {
    try {
      const expected = Buffer.from(`Bearer ${(await this.settings()).token}`);
      const received = Buffer.from(String(headers.authorization || ""));
      return expected.length === received.length && crypto.timingSafeEqual(expected, received);
    } catch { return false; }
  }
  async event(record, config) {
    return this.serialize(() => this.reconcileRecord(record, config));
  }
  async reconcileRecord(record, config) {
    if (!/^[0-9a-f-]{36}$/.test(String(record.id || ""))) return;
    const campaigns = await this.readCampaigns();
    const campaign = campaigns.find((c) => c.transport === "whatsapp" && c.numbers.some((lead) => lead.status === "queued" && lead.waCallId === record.id));
    if (!campaign) return;
    const lead = campaign.numbers.find((l) => l.waCallId === record.id && l.status === "queued");
    if (whatsappNumber(lead.number) !== record.number) throw new Error("O resultado recebido pertence a outro número.");
    if (record.phase === "answered" && !lead.waBridgeSubmitted) {
      // The helper also has a permanent one-use delivery marker. A callback retry or
      // process restart must never originate a second agent leg for the same call.
      const settings = await this.settings();
      try {
        await this.enqueue(config, campaign, lead, settings.audioSocketAddress || "127.0.0.1:3099");
        await this.updateLead(record.id, (target) => {
          target.waBridgeSubmitted = true; target.lastResult = "Cliente atendeu. Chamando o atendimento…";
        });
      } catch (error) {
        console.error("Falha ao conectar WhatsApp ao PBX:", error.message);
        await this.request(`/internal/calls/${record.id}/hangup`, { method: "POST" }).catch(() => {});
      }
    } else if (record.phase === "bridged") {
      if (lead.lastResult !== "Cliente conectado ao PBX. Atendimento em andamento.") {
        await this.updateLead(record.id, (target) => { target.lastResult = "Cliente conectado ao PBX. Atendimento em andamento."; });
      }
    } else if (record.phase === "ended") {
      // CDRs are flushed after the bridge closes. Give the accepted agent leg time
      // to arrive instead of classifying every answered WhatsApp call as a sale.
      const completedAgo = Date.now() - Number(record.ended_at || 0) * 1000;
      if (record.answered_at && completedAgo < 5000) return;
      let accepted = false;
      if (record.answered_at) {
        accepted = await this.wasAccepted(lead, config);
      }
      await this.updateLead(record.id, (target, owner) => { this.finish(owner, target, whatsappOutcome(record, accepted)); });
    }
  }
  async updateLead(id, mutate) {
    await this.updateCampaigns((campaigns) => {
      for (const campaign of campaigns) for (const lead of campaign.numbers || []) {
        if (campaign.transport === "whatsapp" && lead.waCallId === id && lead.status === "queued") mutate(lead, campaign);
      }
      return campaigns;
    });
  }
  async wasAccepted(lead, config) {
    if (this.acceptedAttempt) return this.acceptedAttempt(lead, config);
    const report = this.reportForAttempt(await this.reports(config), lead.attemptId);
    return String(report?.userField || report?.userfield || "").includes(":accepted:");
  }
  async tick(config) { return this.serialize(() => this.tickUnlocked(config)); }
  async tickUnlocked(config) {
    let campaigns = (await this.readCampaigns()).filter((c) => c.transport === "whatsapp");
    if (!this.nextResultsAt || this.nextResultsAt <= Date.now()) {
      this.nextResultsAt = Date.now() + 15000;
      for (const campaign of campaigns) for (const lead of campaign.numbers) {
        if (lead.status !== "answered" || !lead.attemptId || Date.now() - Date.parse(lead.completedAt || "") > 10 * 60 * 1000) continue;
        if (!(await this.wasAccepted(lead, config))) continue;
        await this.updateCampaigns((all) => {
          const target = all.find((c) => c.id === campaign.id)?.numbers.find((l) => l.attemptId === lead.attemptId && l.status === "answered");
          if (target) { target.status = "accepted"; target.lastResult = "Atendeu e conversou com um atendente"; }
          return all;
        });
      }
    }
    const active = campaigns.flatMap((c) => c.numbers.filter((l) => l.status === "queued").map((lead) => ({ campaign: c, lead })));
    for (const { campaign, lead } of active) {
      try {
        const record = await this.request(`/internal/calls/${lead.waCallId}`);
        await this.reconcileRecord(record, config);
      } catch (error) {
        if (error.status !== 404) continue; // Unknown network outcome must not be redialed.
        if (lead.waDispatchState === "claimed" && Date.now() - Date.parse(lead.lastAttemptAt) < 10 * 60 * 1000) await this.dispatch(campaign, lead);
        else await this.updateLead(lead.waCallId, (target, owner) => this.finish(owner, target, whatsappOutcome({ result: "interrupted" })));
      }
    }
    campaigns = (await this.readCampaigns()).filter((c) => c.transport === "whatsapp");
    if (campaigns.some((c) => c.numbers.some((l) => l.status === "queued"))) return;
    let candidate;
    for (const campaign of campaigns) {
      if (campaign.status !== "running" || Date.parse(campaign.nextDialAt) > Date.now()) continue;
      if (!campaign.numbers.some(l => l.status === "pending") || !this.capacity ||
          await this.capacity(config, campaign, campaigns)) { candidate = campaign; break; }
    }
    if (!candidate) return;
    const lead = candidate.numbers.find((l) => l.status === "pending" && l.attempts < candidate.retryAttempts && (!l.nextAttemptAt || Date.parse(l.nextAttemptAt) <= Date.now()));
    if (!lead) {
      if (!candidate.numbers.some((l) => ["pending", "queued"].includes(l.status))) await this.updateCampaigns((all) => {
        const current = all.find((c) => c.id === candidate.id); if (current?.status === "running") current.status = "done"; return all;
      });
      return;
    }
    const status = await this.status();
    if (!status.connected || status.busy) return;
    if (!((candidate.destinationType === "queue" ? config.queues : config.extensions) || []).some((d) => String(d.id || d.number) === candidate.destination)) return;
    let claimed;
    await this.updateCampaigns(async (all) => {
      const current = all.find((c) => c.id === candidate.id);
      if (current?.status !== "running" || all.some((c) => c.transport === "whatsapp" && c.numbers.some((l) => l.status === "queued"))) return all;
      if (this.capacity ? !(await this.capacity(config, current, all)) : current.perAgent) return all;
      const target = current.numbers.find((l) => l.number === lead.number && l.status === "pending");
      if (!target) return all;
      const id = crypto.randomUUID();
      Object.assign(target, { status: "queued", attempts: target.attempts + 1, waCallId: id, waDispatchState: "claimed", waBridgeSubmitted: false,
        attemptId: `wa-${id}`, callFile: `wa-${id}.call`, trunkId: "WhatsApp", lastAttemptAt: new Date().toISOString(), lastResult: "Preparando ligação pelo WhatsApp…", nextAttemptAt: "" });
      current.nextDialAt = new Date(Date.now() + current.intervalSeconds * 1000).toISOString();
      claimed = { campaign: structuredClone(current), lead: structuredClone(target) }; return all;
    });
    if (claimed) await this.dispatch(claimed.campaign, claimed.lead);
  }
  async dispatch(campaign, lead) {
    // Persisted intent precedes the network operation. The remote idempotency key
    // makes retrying an HTTP timeout safe without repeating the WhatsApp call.
    try {
      await this.request("/internal/calls", { method: "POST", body: { id: lead.waCallId, number: whatsappNumber(lead.number) } });
      await this.updateLead(lead.waCallId, (target) => { target.waDispatchState = "sent"; target.lastResult = "Chamando pelo WhatsApp…"; });
    } catch (error) {
      if ([400, 409, 503].includes(error.status)) {
        await this.updateLead(lead.waCallId, (target) => {
          target.status = "pending"; target.attempts = Math.max(0, target.attempts - 1); target.waCallId = "";
          target.attemptId = ""; target.callFile = ""; target.waDispatchState = "";
          target.nextAttemptAt = new Date(Date.now() + 10000).toISOString();
          target.lastResult = "Aguardando o WhatsApp ficar disponível. Nenhuma ligação enviada.";
        });
        this.nextStatusAt = 0;
      }
      // All other outcomes remain queued for GET reconciliation with the same id.
    }
  }
}
module.exports = { WhatsAppDialer, whatsappNumber, whatsappCallFile, whatsappOutcome };
