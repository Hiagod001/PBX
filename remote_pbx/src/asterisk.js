const fs = require("fs-extra");
const path = require("path");
const { generatedDir } = require("./store");

const WEB_SIP_REGISTER_EXPIRES_SECONDS = 8 * 60 * 60;

function clean(value) {
  return String(value || "").replace(/[;\r\n]/g, "").trim();
}

function section(name, body) {
  return [`[${name}]`, ...body.filter(Boolean), ""].join("\n");
}

function destinationDialplan(type, destination) {
  if (type === "extension" && clean(destination) === "700") return "Goto(internal,700,1)";
  if (type === "queue") return `Gosub(queue-${clean(destination)},s,1)`;
  if (type === "ringGroup") return `Gosub(ringgroup-${clean(destination)},s,1)`;
  if (type === "voicemail") return `VoiceMail(${clean(destination)}@default,u)`;
  if (type === "ivr") return `Goto(ivr-${clean(destination)},s,1)`;
  if (type === "trunk") return `Goto(inbound-route-trunk-${clean(destination)},s,1)`;
  if (type === "timeCondition") return `Goto(time-condition-${clean(destination)},s,1)`;
  return `Goto(internal,${clean(destination)},1)`;
}

function ivrDestinationDialplan(type, destination) {
  if (type === "extension" && clean(destination) === "700") return "Goto(internal,700,1)";
  if (type === "extension") return `Dial(${extensionContactExpression(destination)},60,tT)`;
  return destinationDialplan(type, destination);
}

function permissionsByExtension(config) {
  return config.extensions.reduce((acc, ext) => {
    acc[ext.number] = ext.permissions || [];
    return acc;
  }, {});
}

function selectedOutboundTrunk(config) {
  const trunks = configuredTrunks(config);
  const selected = trunks.find((trunk) => clean(trunk.id) === clean(config.outbound?.defaultTrunk));
  return clean(selected?.id || trunks[0]?.id || "trunk-operadora");
}

function trunkId(trunk, index = 0) {
  return clean(trunk.id || (index === 0 ? "trunk-operadora" : `trunk-${index + 1}`)) || "trunk-operadora";
}

function configuredTrunks(config) {
  const trunks = Array.isArray(config.trunks) && config.trunks.length ? config.trunks : [{ ...(config.trunk || {}), id: "trunk-operadora", name: "Operadora principal" }];
  return trunks.map((trunk, index) => ({
    ...(config.trunk || {}),
    ...trunk,
    id: trunkId(trunk, index),
    port: Number(trunk.port) || Number(config.trunk?.port) || 5060,
    transport: ["udp", "tcp", "tls"].includes(trunk.transport) ? trunk.transport : (["udp", "tcp", "tls"].includes(config.trunk?.transport) ? config.trunk.transport : "udp"),
    codecs: Array.isArray(trunk.codecs) && trunk.codecs.length ? trunk.codecs : config.trunk?.codecs || ["alaw", "ulaw"],
    simultaneousCalls: Number(trunk.simultaneousCalls) || Number(config.trunk?.simultaneousCalls) || 4,
    active: trunk.active !== false
  }));
}

function localAreaCode(config) {
  const configured = clean(config.outbound?.areaCode || "");
  if (configured) return configured;
  const mainNumber = clean(config.trunk?.mainNumber || "");
  const match = mainNumber.match(/^(\d{2})/);
  return match ? match[1] : "";
}

function browserEndpoint(number) {
  return `web-${clean(number)}`;
}

function monitorEndpoint() {
  return clean(process.env.PBX_MONITOR_SIP_USER || "monitor-admin");
}

function monitorPassword() {
  return clean(process.env.PBX_MONITOR_SIP_PASSWORD || "Monitor@12345");
}

function extensionContactExpression(number) {
  const target = clean(number);
  return `\${PJSIP_DIAL_CONTACTS(${target})}&\${PJSIP_DIAL_CONTACTS(${browserEndpoint(target)})}`;
}

function queueDialNumber(queue, index = 0) {
  return clean(queue.number || queue.extension || (600 + index));
}

function renderIvrContext(lines, config, menu, contextId, { answer = false } = {}) {
  const ivrResponseTimeout = Math.min(Math.max(Number(config.ivr.timeoutSeconds) || 20, 5), 60);
  const ivrMaxAttempts = Math.min(Math.max(Number(config.ivr.menuRepeat) || 3, 1), 10);
  const contextName = `ivr-${clean(contextId || "main")}`;

  lines.push("", `[${contextName}]`);
  lines.push(`exten => s,1,NoOp(URA ${clean(menu.name || contextId || "main")})`);
  if (menu.active === false) {
    lines.push(" same => n,NoOp(URA inativa)");
    lines.push(" same => n,Hangup()");
    return;
  }
  if (answer) lines.push(" same => n,Answer()");
  lines.push(" same => n,Set(IVR_ATTEMPT=0)");
  lines.push(` same => n,Set(IVR_MAX_ATTEMPTS=${ivrMaxAttempts})`);
  lines.push(` same => n,Set(TIMEOUT(response)=${ivrResponseTimeout})`);
  lines.push(" same => n,Set(TIMEOUT(digit)=5)");
  lines.push(" same => n(prompt),Set(IVR_ATTEMPT=$[${IVR_ATTEMPT}+1])");
  lines.push(" same => n,NoOp(URA tentativa ${IVR_ATTEMPT}/${IVR_MAX_ATTEMPTS})");
  lines.push(" same => n,GotoIf($[${IVR_ATTEMPT}>${IVR_MAX_ATTEMPTS}]?maxattempts,1)");
  lines.push(" same => n,Wait(1)");
  if (clean(menu.greeting)) {
    lines.push(` same => n,NoOp(Reproduzindo audio interativo da URA: ${clean(menu.greeting)})`);
    lines.push(` same => n,Background(${clean(menu.greeting)})`);
    lines.push(" same => n,NoOp(Status do audio da URA: ${BACKGROUNDSTATUS})");
    lines.push(' same => n,GotoIf($["${BACKGROUNDSTATUS}"!="SUCCESS"]?audio-failed,1)');
  }
  lines.push(` same => n,WaitExten(${ivrResponseTimeout})`);
  lines.push(" same => n,Goto(t,1)");
  lines.push("exten => audio-failed,1,NoOp(Audio da URA nao foi reproduzido)");
  lines.push(` same => n,WaitExten(${ivrResponseTimeout})`);
  lines.push(" same => n,Goto(t,1)");
  if (config.ivr.allowDirectDial) {
    lines.push("include => internal");
  }
  (menu.options || []).filter((option) => clean(option.digit) && clean(option.destination)).forEach((option) => {
    lines.push(`exten => ${clean(option.digit)},1,NoOp(URA ${clean(option.label)})`);
    if (clean(option.announcement)) {
      lines.push(` same => n,Playback(${clean(option.announcement)})`);
    }
    lines.push(` same => n,${ivrDestinationDialplan(option.destinationType, option.destination)}`);
    lines.push(" same => n,NoOp(Status do destino da URA: ${DIALSTATUS})");
    lines.push(" same => n,Hangup()");
  });
  lines.push("exten => t,1,NoOp(URA timeout)");
  if (clean(config.ivr.timeoutAudio)) {
    lines.push(` same => n,Playback(${clean(config.ivr.timeoutAudio)})`);
  }
  lines.push(` same => n,Goto(${contextName},s,prompt)`);
  lines.push("exten => i,1,NoOp(URA invalida)");
  if (clean(config.ivr.invalidAudio)) {
    lines.push(` same => n,Playback(${clean(config.ivr.invalidAudio)})`);
  }
  lines.push(` same => n,Goto(${contextName},s,prompt)`);
  lines.push("exten => maxattempts,1,NoOp(URA encerrada apos tentativas sem opcao valida)");
  lines.push(" same => n,Hangup()");
}

function renderTimeConditionContext(lines, condition) {
  const id = clean(condition.id);
  if (!id) return;
  const windows = Array.isArray(condition.windows) && condition.windows.length
    ? condition.windows
    : [{ start: condition.start || "08:00", end: condition.end || "18:00", weekdays: condition.weekdays || "mon-fri" }];
  const inType = clean(condition.inDestinationType || "extension");
  const inDestination = clean(condition.inDestination || "");
  const outType = clean(condition.outDestinationType || "extension");
  const outDestination = clean(condition.outDestination || "");

  lines.push("", `[time-condition-${id}]`);
  lines.push(`exten => s,1,NoOp(Condicao de horario ${clean(condition.name || id)})`);
  windows.forEach((window) => {
    const start = clean(window.start || "08:00");
    const end = clean(window.end || "18:00");
    const weekdays = clean(window.weekdays || "mon-fri") || "mon-fri";
    lines.push(` same => n,GotoIfTime(${start}-${end},${weekdays},*,*?s,open)`);
  });
  lines.push(" same => n,Goto(s,closed)");
  lines.push(" same => n(open),NoOp(Dentro do horario configurado)");
  lines.push(` same => n,${destinationDialplan(inType, inDestination)}`);
  lines.push(" same => n,Hangup()");
  lines.push(" same => n(closed),NoOp(Fora do horario configurado)");
  lines.push(` same => n,${destinationDialplan(outType, outDestination)}`);
  lines.push(" same => n,Hangup()");
}

function inboundDestinationForTrunk(config, trunk, index = 0) {
  const primaryRoute = Array.isArray(config.inboundRoutes) ? config.inboundRoutes[0] : null;
  const destinationType = clean(trunk.inboundDestinationType || (index === 0 ? primaryRoute?.destinationType : "") || "ivr");
  const destination = clean(trunk.inboundDestination || (index === 0 ? primaryRoute?.destination : "") || "main");
  const did = clean(trunk.inboundDid || trunk.mainNumber || (index === 0 ? primaryRoute?.did : "") || "s");
  return { destinationType, destination, did };
}

function renderInboundDestinationContext(lines, config, contextId, routeName, trunkName, did, destinationType, destination) {
  const safeContextId = clean(contextId || "main");
  lines.push("", `[inbound-route-${safeContextId}]`);
  lines.push(`exten => s,1,NoOp(${clean(routeName || `Entrada ${safeContextId}`)})`);
  lines.push(" same => n,Set(CDR(direction)=inbound)");
  lines.push(` same => n,Set(CDR(did)=${clean(did || "s")})`);
  lines.push(` same => n,Set(CDR(trunk)=${clean(trunkName || "trunk-operadora")})`);
  lines.push(" same => n,Gosub(record-call,s,1(${CALLERID(num)},${CDR(did)}))");
  if (config.businessHours.enabled) {
    lines.push(` same => n,GotoIfTime(${config.businessHours.start}-${config.businessHours.end},${config.businessHours.weekdays.join("&")},*,*?in-hours)`);
    lines.push(` same => n,${destinationDialplan(config.businessHours.afterHoursDestinationType, config.businessHours.afterHoursDestination)}`);
    lines.push(" same => n,Hangup()");
    lines.push(` same => n(in-hours),${destinationDialplan(destinationType, destination)}`);
  } else {
    lines.push(` same => n,${destinationDialplan(destinationType, destination)}`);
  }
  lines.push(" same => n,Hangup()");
}

function renderDialerContext(lines) {
  lines.push("", "[dialer-interactive]");
  lines.push("exten => s,1,NoOp(Discador campanha ${DIALER_CAMPAIGN_ID} para ${DIALER_TARGET})");
  lines.push(" same => n,Answer()");
  lines.push(" same => n,Set(CDR(direction)=dialer)");
  lines.push(" same => n,Set(CDR(campaign)=${DIALER_CAMPAIGN_ID})");
  lines.push(" same => n,Set(CDR(trunk)=${TRUNK_ENDPOINT})");
  lines.push(" same => n,Set(TIMEOUT(response)=${DIALER_TIMEOUT})");
  lines.push(" same => n,Background(${DIALER_AUDIO})");
  lines.push(" same => n,WaitExten(${DIALER_TIMEOUT})");
  lines.push(" same => n,Hangup()");
  lines.push("exten => _X,1,NoOp(Discador recebeu tecla ${EXTEN})");
  lines.push(" same => n,GotoIf($[\"${EXTEN}\"=\"${DIALER_DIGIT}\"]?accepted,1)");
  lines.push(" same => n,Hangup()");
  lines.push("exten => accepted,1,NoOp(Discador aceito ${DIALER_CAMPAIGN_ID} ${DIALER_TARGET})");
  lines.push(" same => n,Set(CDR(userfield)=dialer:${DIALER_CAMPAIGN_ID}:accepted:${DIALER_TARGET})");
  lines.push(" same => n,UserEvent(DialerAccept,Campaign:${DIALER_CAMPAIGN_ID},Number:${DIALER_TARGET},Digit:${DIALER_DIGIT})");
  lines.push(" same => n,GotoIf($[\"${DIALER_DEST_TYPE}\"=\"queue\"]?queue)");
  lines.push(" same => n,GotoIf($[\"${DIALER_DEST_TYPE}\"=\"extension\"]?extension)");
  lines.push(" same => n,Hangup()");
  lines.push(" same => n(queue),Set(CDR(queue)=${DIALER_DESTINATION})");
  lines.push(" same => n,Queue(${DIALER_DESTINATION},tT)");
  lines.push(" same => n,Hangup()");
  lines.push(" same => n(extension),Dial(${PJSIP_DIAL_CONTACTS(${DIALER_DESTINATION})}&${PJSIP_DIAL_CONTACTS(web-${DIALER_DESTINATION})},60,tT)");
  lines.push(" same => n,Hangup()");
  lines.push("exten => i,1,Hangup()");
  lines.push("exten => t,1,Hangup()");
}

function localOutboundPrefix(config) {
  const nationalPrefix = clean(config.outbound?.nationalPrefix || "");
  const areaCode = localAreaCode(config);
  return `${nationalPrefix}${areaCode}`;
}

function nationalPrefix(config) {
  return clean(config.outbound?.nationalPrefix || "");
}

function outboundDialTarget(config) {
  const prefix = clean(config.outbound?.dialPrefix || "");
  const stripDigits = Number(config.outbound?.stripDigits) || 0;
  if (stripDigits > 0) return `${prefix}\${EXTEN:${stripDigits}}`;
  return `${prefix}\${EXTEN}`;
}

function outboundDialTargetForRule(config, rule, pattern) {
  if (clean(config.outbound?.dialPrefix || "") || Number(config.outbound?.stripDigits)) {
    return outboundDialTarget(config);
  }

  const areaCode = localAreaCode(config);
  if (rule === "local" && areaCode && config.outbound?.prependAreaCodeToLocal !== false) {
    return `${localOutboundPrefix(config)}\${EXTEN}`;
  }

  if (rule === "mobile") {
    if (pattern === "_9XXXXXXXX" && areaCode && config.outbound?.prependAreaCodeToLocal !== false) {
      return `${localOutboundPrefix(config)}\${EXTEN}`;
    }
    if (pattern === "_09XXXXXXXX" && areaCode && config.outbound?.prependAreaCodeToLocal !== false) {
      return `${localOutboundPrefix(config)}\${EXTEN:1}`;
    }
  }

  if (rule === "ddd" && pattern.startsWith("_0")) {
    if (pattern.startsWith("_055")) return `\${EXTEN:3}`;
    return "\${EXTEN}";
  }

  if (rule === "ddd" && pattern.startsWith("_55")) {
    return `\${EXTEN:2}`;
  }

  if (rule === "ddd" && nationalPrefix(config)) {
    return `${nationalPrefix(config)}\${EXTEN}`;
  }

  return "\${EXTEN}";
}

function outboundCallerIdStep(config) {
  const callerId = clean(config.trunk?.mainNumber || "");
  if (!callerId) return "";
  return ` same => n,Set(CALLERID(num)=${callerId})`;
}

function renderPjsip(config) {
  const transportProtocol = ["udp", "tcp", "tls"].includes(config.trunk.transport) ? config.trunk.transport : "udp";
  const transport = section(`transport-${transportProtocol}`, [
    "type=transport",
    `protocol=${transportProtocol}`,
    `bind=0.0.0.0:${Number(config.trunk.port) || 5060}`,
    config.security.publicAddress ? `external_media_address=${clean(config.security.publicAddress)}` : "",
    config.security.publicAddress ? `external_signaling_address=${clean(config.security.publicAddress)}` : "",
    ...(config.security.localNetworks || []).map((network) => `local_net=${clean(network)}`),
    transportProtocol === "tls" ? "cert_file=/etc/asterisk/keys/asterisk.pem" : "",
    transportProtocol === "tls" ? "priv_key_file=/etc/asterisk/keys/asterisk.key" : ""
  ]);
  const browserTransports = [
    section("transport-ws", [
      "type=transport",
      "protocol=ws",
      "bind=0.0.0.0:8088"
    ]),
    section("transport-wss", [
      "type=transport",
      "protocol=wss",
      "bind=0.0.0.0:8089",
      "cert_file=/etc/asterisk/keys/asterisk.pem",
      "priv_key_file=/etc/asterisk/keys/asterisk.key"
    ])
  ].join("\n");

  const extensions = config.extensions
    .map((ext) => {
      const codecs = "ulaw,alaw,g722,gsm";
      const webEndpoint = browserEndpoint(ext.number);
      return [
        section(ext.number, [
          "type=endpoint",
          `context=from-${clean(ext.number)}`,
          "disallow=all",
          `allow=${codecs}`,
          `auth=auth-${clean(ext.number)}`,
          `aors=${clean(ext.number)}`,
          "identify_by=auth_username,username",
          "direct_media=no",
          "force_rport=yes",
          "rewrite_contact=yes",
          "rtp_symmetric=yes",
          "media_use_received_transport=yes",
          "rtp_keepalive=30",
          "dtmf_mode=rfc4733",
          "100rel=no",
          "timers=no",
          config.security.srtpEnabled ? "media_encryption=sdes" : ""
        ]),
        section(`auth-${ext.number}`, [
          "type=auth",
          "auth_type=userpass",
          `username=${clean(ext.number)}`,
          `password=${clean(ext.secret)}`
        ]),
        section(ext.number, [
          "type=aor",
          "max_contacts=1",
          "remove_existing=yes",
          "remove_unavailable=yes",
          "qualify_frequency=25",
          "qualify_timeout=3.0",
          "support_path=yes"
        ]),
        section(webEndpoint, [
          "type=endpoint",
          `context=from-${clean(ext.number)}`,
          `callerid=${clean(ext.name || ext.number)} <${clean(ext.number)}>`,
          "disallow=all",
          "allow=ulaw,alaw",
          `auth=auth-${webEndpoint}`,
          `aors=${webEndpoint}`,
          "identify_by=username",
          "direct_media=no",
          "force_rport=yes",
          "rewrite_contact=yes",
          "rtp_symmetric=yes",
          "media_use_received_transport=yes",
          "rtp_keepalive=30",
          "dtmf_mode=rfc4733",
          "100rel=no",
          "timers=no",
          "webrtc=yes",
          "ice_support=yes",
          "use_avpf=yes",
          "dtls_auto_generate_cert=yes",
          "media_encryption=dtls"
        ]),
        section(`auth-${webEndpoint}`, [
          "type=auth",
          "auth_type=userpass",
          `username=${webEndpoint}`,
          `password=${clean(ext.secret)}`
        ]),
        section(webEndpoint, [
          "type=aor",
          "max_contacts=1",
          "remove_existing=yes",
          "remove_unavailable=no",
          `default_expiration=${WEB_SIP_REGISTER_EXPIRES_SECONDS}`,
          `maximum_expiration=${WEB_SIP_REGISTER_EXPIRES_SECONDS}`,
          "qualify_frequency=0",
          "support_path=yes"
        ])
      ].join("\n");
    })
    .join("\n");

  const monitor = section(monitorEndpoint(), [
    "type=endpoint",
    "context=internal",
    `callerid=Monitor PBX <${monitorEndpoint()}>`,
    "disallow=all",
    "allow=ulaw,alaw",
    `auth=auth-${monitorEndpoint()}`,
    `aors=${monitorEndpoint()}`,
    "identify_by=username",
    "direct_media=no",
    "force_rport=yes",
    "rewrite_contact=yes",
    "rtp_symmetric=yes",
    "media_use_received_transport=yes",
    "rtp_keepalive=30",
    "dtmf_mode=rfc4733",
    "100rel=no",
    "timers=no",
    "webrtc=yes",
    "ice_support=yes",
    "use_avpf=yes",
    "dtls_auto_generate_cert=yes",
    "media_encryption=dtls"
  ]) + section(`auth-${monitorEndpoint()}`, [
    "type=auth",
    "auth_type=userpass",
    `username=${monitorEndpoint()}`,
    `password=${monitorPassword()}`
  ]) + section(monitorEndpoint(), [
    "type=aor",
    "max_contacts=8",
    "remove_existing=no",
    "remove_unavailable=yes",
    `default_expiration=${WEB_SIP_REGISTER_EXPIRES_SECONDS}`,
    `maximum_expiration=${WEB_SIP_REGISTER_EXPIRES_SECONDS}`,
    "qualify_frequency=0",
    "support_path=yes"
  ]);

  const trunk = configuredTrunks(config)
    .filter((item) => item.active !== false && item.sipServer)
    .map((item, index) => {
      const id = trunkId(item, index);
      return [
        section(id, [
          "type=endpoint",
          `context=inbound-trunk-${id}`,
          "disallow=all",
          `allow=${(item.codecs || ["alaw", "ulaw"]).join(",")}`,
          `outbound_auth=${id}-auth`,
          `aors=${id}-aor`,
          "from_user=" + clean(item.sipUser),
          "from_domain=" + clean(item.sipServer),
          "direct_media=no",
          "force_rport=yes",
          "rewrite_contact=yes",
          "rtp_symmetric=yes",
          "media_use_received_transport=yes",
          "rtp_keepalive=30",
          "dtmf_mode=rfc4733",
          "timers=no",
          config.security.srtpEnabled ? "media_encryption=sdes" : ""
        ]),
        section(`${id}-auth`, [
          "type=auth",
          "auth_type=userpass",
          `username=${clean(item.sipUser)}`,
          `password=${clean(item.sipPassword)}`
        ]),
        section(`${id}-aor`, [
          "type=aor",
          `contact=sip:${clean(item.sipServer)}:${Number(item.port) || 5060}`,
          `max_contacts=${Number(item.simultaneousCalls) || 4}`
        ]),
        section(`${id}-identify`, [
          "type=identify",
          `endpoint=${id}`,
          `match=${clean(item.sipServer)}`
        ]),
        section(`${id}-registration`, [
          "type=registration",
          `transport=transport-${transportProtocol}`,
          `outbound_auth=${id}-auth`,
          `server_uri=sip:${clean(item.sipServer)}:${Number(item.port) || 5060}`,
          `client_uri=sip:${clean(item.sipUser)}@${clean(item.sipServer)}`,
          "retry_interval=60",
          "expiration=3600"
        ])
      ].join("\n");
    })
    .join("\n") || "; Configure o tronco no painel para habilitar registro SIP.\n";

  return [
    "; Gerado pelo PBX SIP Admin. Edite pelo painel para preservar consistencia.",
    "[global]",
    "type=global",
    "user_agent=PBX-SIP-Admin",
    "",
    transport,
    browserTransports,
    extensions,
    monitor,
    trunk
  ].join("\n");
}

function renderExtensions(config) {
  const perms = permissionsByExtension(config);
  const lines = [
    "; Gerado pelo PBX SIP Admin.",
    "[globals]",
    `TRUNK_ENDPOINT=${selectedOutboundTrunk(config)}`,
    `TRUNK=PJSIP/${selectedOutboundTrunk(config)}`,
    `LOCAL_AREA_CODE=${localAreaCode(config)}`,
    `OUTBOUND_PREFIX=${clean(config.outbound?.dialPrefix || "")}`,
    `OUTBOUND_STRIP=${Number(config.outbound?.stripDigits) || 0}`,
    `RECORDING_PATH=${clean(config.recording.path)}`,
    "",
    "[internal]",
    "exten => 700,1,NoOp(Teste da URA principal)",
    " same => n,Set(CDR(direction)=internal)",
    " same => n,Gosub(record-call,s,1(${CALLERID(num)},700))",
    " same => n,Goto(ivr-main,s,1)",
    "",
    "exten => _20X,1,NoOp(Chamada interna para ${EXTEN})",
    " same => n,Set(CDR(direction)=internal)",
    " same => n,Gosub(record-call,s,1(${CALLERID(num)},${EXTEN}))",
    " same => n,Dial(${PJSIP_DIAL_CONTACTS(${EXTEN})}&${PJSIP_DIAL_CONTACTS(web-${EXTEN})},60,tT)",
    " same => n,VoiceMail(${EXTEN}@default,u)",
    " same => n,Hangup()"
  ];

  config.extensions.forEach((ext) => {
    lines.push(`exten => ${clean(ext.number)},1,NoOp(Chamada direta para ${clean(ext.number)})`);
    lines.push(" same => n,Set(CDR(direction)=internal)");
    lines.push(` same => n,Gosub(record-call,s,1(\${CALLERID(num)},${clean(ext.number)}))`);
    lines.push(` same => n,Dial(${extensionContactExpression(ext.number)},60,tT)`);
    lines.push(` same => n,VoiceMail(${clean(ext.number)}@default,u)`);
    lines.push(" same => n,Hangup()");
  });

  config.queues.forEach((queue, index) => {
    const number = queueDialNumber(queue, index);
    if (!number || config.extensions.some((ext) => clean(ext.number) === number)) return;
    lines.push(`exten => ${number},1,NoOp(Chamada para fila ${clean(queue.name || queue.id)})`);
    lines.push(" same => n,Set(CDR(direction)=internal)");
    lines.push(` same => n,Gosub(record-call,s,1(\${CALLERID(num)},${number}))`);
    lines.push(` same => n,Gosub(queue-${clean(queue.id)},s,1)`);
    lines.push(" same => n,Hangup()");
  });

  lines.push("");

  config.extensions.forEach((ext) => {
    lines.push(`[from-${clean(ext.number)}]`);
    lines.push("include => internal");
    lines.push(`include => outbound-${clean(ext.number)}`);
    lines.push("");
    lines.push(`exten => ${ext.number},hint,PJSIP/${ext.number}`);
    lines.push("");
  });

  config.extensions.forEach((ext) => {
    const extPerms = perms[ext.number] || [];
    lines.push(`[outbound-${clean(ext.number)}]`);
    Object.entries(config.outboundRules).forEach(([rule, data]) => {
      if (!extPerms.includes(rule)) return;
      data.patterns.forEach((pattern) => {
        lines.push(`exten => ${pattern},1,NoOp(Saida ${rule} de ${ext.number} para \${EXTEN})`);
        lines.push(" same => n,Set(CDR(direction)=outbound)");
        lines.push(" same => n,Gosub(record-call,s,1(${CALLERID(num)},${EXTEN}))");
        lines.push(" same => n,Set(CDR(trunk)=${TRUNK_ENDPOINT})");
        const callerIdStep = outboundCallerIdStep(config);
        if (callerIdStep) lines.push(callerIdStep);
        lines.push(` same => n,Dial(PJSIP/${outboundDialTargetForRule(config, rule, pattern)}@\${TRUNK_ENDPOINT},60,tT)`);
        lines.push(" same => n,Set(CDR(dialstatus)=${DIALSTATUS})");
        lines.push(" same => n,Set(CDR(hangupcause)=${HANGUPCAUSE})");
        lines.push(" same => n,NoOp(Saida ${EXTEN} via ${TRUNK_ENDPOINT}: DIALSTATUS=${DIALSTATUS} HANGUPCAUSE=${HANGUPCAUSE})");
        lines.push(" same => n,Hangup()");
      });
    });
    if (config.outbound?.emergencyEnabled) {
      (config.outbound.emergencyNumbers || []).forEach((number) => {
        lines.push(`exten => ${clean(number)},1,NoOp(Emergencia ${clean(number)} de ${ext.number})`);
        lines.push(" same => n,Set(CDR(direction)=outbound)");
        lines.push(" same => n,Gosub(record-call,s,1(${CALLERID(num)},${EXTEN}))");
        lines.push(" same => n,Set(CDR(trunk)=${TRUNK_ENDPOINT})");
        const callerIdStep = outboundCallerIdStep(config);
        if (callerIdStep) lines.push(callerIdStep);
        lines.push(` same => n,Dial(PJSIP/${outboundDialTarget(config)}@\${TRUNK_ENDPOINT},60,tT)`);
        lines.push(" same => n,Set(CDR(dialstatus)=${DIALSTATUS})");
        lines.push(" same => n,Set(CDR(hangupcause)=${HANGUPCAUSE})");
        lines.push(" same => n,NoOp(Emergencia ${EXTEN} via ${TRUNK_ENDPOINT}: DIALSTATUS=${DIALSTATUS} HANGUPCAUSE=${HANGUPCAUSE})");
        lines.push(" same => n,Hangup()");
      });
    }
    lines.push("");
  });

  lines.push("", "[inbound-trunk]");
  lines.push("exten => s,1,Goto(inbound-route-main,s,1)");
  config.inboundRoutes.forEach((route) => {
    if (!route.did) return;
    lines.push(`exten => ${clean(route.did)},1,Goto(inbound-route-${clean(route.id)},s,1)`);
  });
  lines.push("exten => _X.,1,Goto(inbound-route-main,s,1)");

  config.inboundRoutes.forEach((route) => {
    renderInboundDestinationContext(
      lines,
      config,
      route.id,
      route.name,
      route.trunkId || "trunk-operadora",
      route.did || config.trunk.mainNumber || "s",
      route.destinationType,
      route.destination
    );
  });

  configuredTrunks(config)
    .filter((trunk) => trunk.active !== false)
    .forEach((trunk, index) => {
      const id = trunkId(trunk, index);
      const inbound = inboundDestinationForTrunk(config, trunk, index);
      const contextId = `trunk-${id}`;
      if (trunk.sipServer) {
        lines.push("", `[inbound-trunk-${id}]`);
        lines.push(`exten => s,1,Goto(inbound-route-${contextId},s,1)`);
        if (clean(inbound.did) && clean(inbound.did) !== "s") {
          lines.push(`exten => ${clean(inbound.did)},1,Goto(inbound-route-${contextId},s,1)`);
        }
        lines.push(`exten => _X.,1,Goto(inbound-route-${contextId},s,1)`);
      }
      renderInboundDestinationContext(
        lines,
        config,
        contextId,
        `Entrada ${trunk.name || id}`,
        id,
        inbound.did,
        inbound.destinationType,
        inbound.destination
      );
    });

  if (!config.inboundRoutes.some((route) => route.id === "main")) {
    lines.push("", "[inbound-route-main]");
    lines.push("exten => s,1,Goto(ivr-main,s,1)");
    lines.push(" same => n,Hangup()");
  }

  const ivrMenus = [{ ...config.ivr, id: "main", options: config.ivr.options || [] }, ...(config.ivr.menus || [])];
  renderIvrContext(lines, config, ivrMenus[0], "main", { answer: true });
  ivrMenus.slice(1).forEach((menu) => {
    renderIvrContext(lines, config, menu, menu.id);
  });
  ivrMenus.forEach((menu) => {
    (menu.timeConditions || []).forEach((condition) => {
      renderTimeConditionContext(lines, condition);
    });
  });
  renderDialerContext(lines);

  lines.push("", "[queue-member]");
  lines.push("exten => _X!,1,NoOp(Membro de fila ${EXTEN} chamado por ${CALLERID(num)})");
  lines.push(' same => n,GotoIf($["${CALLERID(num)}"="${EXTEN}"]?self)');
  lines.push(" same => n,Dial(${PJSIP_DIAL_CONTACTS(${EXTEN})}&${PJSIP_DIAL_CONTACTS(web-${EXTEN})},30,tT)");
  lines.push(" same => n,Hangup()");
  lines.push(" same => n(self),NoOp(Ignorando chamada da fila para o proprio ramal ${EXTEN})");
  lines.push(" same => n,Hangup(21)");

  config.ringGroups.forEach((group) => {
    const members = group.members.map((member) => extensionContactExpression(member)).join("&");
    lines.push("", `[ringgroup-${clean(group.id)}]`);
    lines.push("exten => s,1,NoOp(" + clean(group.name) + ")");
    lines.push(` same => n,Dial(${members},${Math.max(Number(group.timeout) || 25, 60)},tT)`);
    lines.push(` same => n,${destinationDialplan("extension", group.fallback)}`);
    lines.push(" same => n,Return()");
  });

  config.queues.forEach((queue) => {
    lines.push("", `[queue-${clean(queue.id)}]`);
    lines.push(`exten => s,1,NoOp(Fila ${clean(queue.name || queue.id)})`);
    lines.push(` same => n,Set(CDR(queue)=${clean(queue.id)})`);
    lines.push(` same => n,Queue(${clean(queue.id)},tT)`);
    lines.push(` same => n,${destinationDialplan("extension", queue.fallback)}`);
    lines.push(" same => n,Return()");
  });

  lines.push("", "[record-call]");
  lines.push("exten => s,1,NoOp(Gravacao condicional)");
  if (config.recording.enabled) {
    lines.push(' same => n,GotoIf($["${RECORDING_FILE}"!=""]?done)');
    lines.push(` same => n,Set(RECORDING_FILE=\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}-\${ARG1}-\${ARG2}.${clean(config.recording.format)})`);
    lines.push(" same => n,Set(CDR(recordingfile)=${RECORDING_FILE})");
    lines.push(` same => n,MixMonitor(${clean(config.recording.path)}/\${RECORDING_FILE},b)`);
  }
  lines.push(" same => n(done),NoOp(Gravacao pronta: ${RECORDING_FILE})");
  lines.push(" same => n,Return()");

  lines.push("", "; Permissoes de saida aplicadas por contexto de ramal.");
  config.extensions.forEach((ext) => {
    (ext.permissions || []).forEach((permission) => {
      lines.push(`; ${ext.number}: ${permission}`);
    });
  });

  return lines.join("\n") + "\n";
}

function renderQueues(config) {
  return config.queues
    .map((queue) =>
      section(queue.id, [
        `musicclass=default`,
        `strategy=${clean(queue.strategy)}`,
        `ringinuse=no`,
        `timeout=${Number(queue.timeout) || 20}`,
        `retry=3`,
        `maxlen=0`,
        `wrapuptime=5`,
        `memberdelay=0`,
        ...(queue.members || []).map((member) => `member => Local/${clean(member)}@queue-member/n,1,${clean(member)}`)
      ])
    )
    .join("\n");
}

function renderVoicemail(config) {
  const lines = ["[general]", "format=wav49|gsm|wav", "serveremail=asterisk", "attach=yes", "", "[default]"];
  config.extensions.forEach((ext) => {
    if (ext.voicemail) {
      lines.push(`${clean(ext.number)} => ${clean(config.voicemail.defaultPin)},${clean(ext.name)},${clean(ext.number)}@${clean(config.voicemail.emailDomain)}`);
    }
  });
  return lines.join("\n") + "\n";
}

function cdrField(name) {
  return `\${CSV_QUOTE(\${CDR(${name})})}`;
}

function renderCdr() {
  return [
    "[general]",
    "enable=yes",
    "unanswered=yes",
    "congestion=yes",
    "batch=no",
    "",
    "[csv]",
    "usegmtime=no",
    "loguniqueid=yes",
    "loguserfield=yes",
    ""
  ].join("\n");
}

function renderCdrCustom() {
  const fields = [
    "clid",
    "src",
    "dst",
    "dcontext",
    "channel",
    "dstchannel",
    "lastapp",
    "lastdata",
    "start",
    "answer",
    "end",
    "duration",
    "billsec",
    "disposition",
    "amaflags",
    "accountcode",
    "uniqueid",
    "linkedid",
    "peeraccount",
    "recordingfile",
    "trunk",
    "did",
    "queue",
    "userfield",
    "sequence",
    "direction",
    "dialstatus",
    "hangupcause"
  ];
  return ["[mappings]", `Master.csv => ${fields.map(cdrField).join(",")}`, ""].join("\n");
}

function renderRtp(config) {
  return [`[general]`, `rtpstart=${Number(config.security.rtpPortStart) || 10000}`, `rtpend=${Number(config.security.rtpPortEnd) || 20000}`, ""].join("\n");
}

function renderHttp() {
  return [
    "[general]",
    "enabled=yes",
    "bindaddr=0.0.0.0",
    "bindport=8088",
    "tlsenable=yes",
    "tlsbindaddr=0.0.0.0:8089",
    "tlscertfile=/etc/asterisk/keys/asterisk.pem",
    "tlsprivatekey=/etc/asterisk/keys/asterisk.key",
    ""
  ].join("\n");
}

function renderFirewall(config) {
  const port = Number(config.trunk.port) || 5060;
  const panelPort = Number(process.env.PORT) || 3090;
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "# Revise as redes permitidas antes de rodar em producao.",
    "sudo ufw allow OpenSSH",
    `sudo ufw allow ${panelPort}/tcp`
  ];
  (config.security.allowedSipNetworks || []).forEach((network) => {
    lines.push(`sudo ufw allow from ${clean(network)} to any port ${port} proto ${config.trunk.transport === "tls" ? "tcp" : "udp"}`);
    lines.push(`sudo ufw allow from ${clean(network)} to any port 8088 proto tcp`);
    lines.push(`sudo ufw allow from ${clean(network)} to any port 8089 proto tcp`);
  });
  lines.push(`sudo ufw allow ${config.security.rtpPortStart}:${config.security.rtpPortEnd}/udp`);
  lines.push("sudo ufw enable");
  return lines.join("\n") + "\n";
}

function renderFail2ban() {
  return [
    "[asterisk]",
    "enabled = true",
    "filter = asterisk",
    "backend = polling",
    "action = iptables-allports[name=ASTERISK, protocol=all]",
    "logpath = /var/log/asterisk/messages.log",
    "maxretry = 5",
    "bantime = 3600",
    "findtime = 600",
    ""
  ].join("\n");
}

function renderModules() {
  return [
    "[modules]",
    "autoload=no",
    "; Modulos minimos para PBX PJSIP: reduz ruido e evita drivers legados.",
    "load = app_dial.so",
    "load = app_playback.so",
    "load = app_stack.so",
    "load = app_verbose.so",
    "load = app_voicemail.so",
    "load = app_queue.so",
    "load = app_mixmonitor.so",
    "load = app_readexten.so",
    "load = app_originate.so",
    "load = bridge_builtin_features.so",
    "load = bridge_builtin_interval_features.so",
    "load = bridge_holding.so",
    "load = bridge_native_rtp.so",
    "load = bridge_simple.so",
    "load = bridge_softmix.so",
    "load = cdr_custom.so",
    "load = chan_bridge_media.so",
    "load = chan_pjsip.so",
    "load = codec_alaw.so",
    "load = codec_ulaw.so",
    "load = codec_g722.so",
    "load = codec_gsm.so",
    "load = codec_resample.so",
    "load = format_gsm.so",
    "load = format_pcm.so",
    "load = format_sln.so",
    "load = format_wav_gsm.so",
    "load = format_wav.so",
    "load = func_callerid.so",
    "load = func_cdr.so",
    "load = func_db.so",
    "load = func_devstate.so",
    "load = func_pjsip_endpoint.so",
    "load = func_pjsip_contact.so",
    "load = func_pjsip_aor.so",
    "load = func_sorcery.so",
    "load = func_strings.so",
    "load = func_timeout.so",
    "load = pbx_config.so",
    "load = res_musiconhold.so",
    "load = res_pjproject.so",
    "load = res_pjsip.so",
    "load = res_pjsip_acl.so",
    "load = res_pjsip_authenticator_digest.so",
    "load = res_pjsip_caller_id.so",
    "load = res_pjsip_diversion.so",
    "load = res_pjsip_dtmf_info.so",
    "load = res_pjsip_endpoint_identifier_ip.so",
    "load = res_pjsip_endpoint_identifier_user.so",
    "load = res_pjsip_header_funcs.so",
    "load = res_pjsip_logger.so",
    "load = res_pjsip_messaging.so",
    "load = res_pjsip_mwi.so",
    "load = res_pjsip_nat.so",
    "load = res_pjsip_notify.so",
    "load = res_pjsip_outbound_authenticator_digest.so",
    "load = res_pjsip_outbound_registration.so",
    "load = res_pjsip_path.so",
    "load = res_pjsip_pubsub.so",
    "load = res_pjsip_refer.so",
    "load = res_pjsip_registrar.so",
    "load = res_pjsip_sdp_rtp.so",
    "load = res_pjsip_session.so",
    "load = res_pjsip_t38.so",
    "load = res_pjsip_transport_websocket.so",
    "load = res_crypto.so",
    "load = res_http_websocket.so",
    "load = res_clioriginate.so",
    "load = res_rtp_asterisk.so",
    "load = res_srtp.so",
    "load = res_sorcery_astdb.so",
    "load = res_sorcery_config.so",
    "load = res_sorcery_memory.so",
    "load = res_sorcery_realtime.so",
    "load = res_timing_timerfd.so",
    ""
  ].join("\n");
}

async function generateAsteriskConfigs(config, targetDir = generatedDir) {
  await fs.ensureDir(targetDir);
  const files = {
    "pjsip.conf": renderPjsip(config),
    "extensions.conf": renderExtensions(config),
    "queues.conf": renderQueues(config),
    "voicemail.conf": renderVoicemail(config),
    "cdr.conf": renderCdr(),
    "cdr_custom.conf": renderCdrCustom(),
    "rtp.conf": renderRtp(config),
    "http.conf": renderHttp(),
    "modules.conf": renderModules(),
    "ufw-pbx.sh": renderFirewall(config),
    "fail2ban-asterisk.local": renderFail2ban()
  };

  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      await fs.writeFile(path.join(targetDir, file), content, "utf8");
    })
  );
  await fs.chmod(path.join(targetDir, "ufw-pbx.sh"), 0o755);
  return Object.keys(files).map((file) => path.join(targetDir, file));
}

module.exports = {
  generateAsteriskConfigs
};
