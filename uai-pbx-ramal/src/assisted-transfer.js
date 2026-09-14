(function (root) {
  "use strict";
  function create({ SIP, getSession, getAgent, getDomain, constraints, getMuted, audio, changed, report }) {
    let original = null, consult = null, phase = "idle", target = "", busy = false;
    const emit = () => changed?.({ phase, target, busy });
    const established = session => session?.state === SIP.SessionState.Established;
    async function end(session) {
      if (!session) return;
      if (established(session)) await session.bye();
      else if ([SIP.SessionState.Initial, SIP.SessionState.Establishing].includes(session.state)) await session.cancel();
    }
    function hold(session, held) {
      if (!established(session)) return Promise.reject(new Error("A chamada foi encerrada."));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("O telefone não confirmou a espera. Tente novamente.")), 12000);
        const done = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
        session.invite({
          sessionDescriptionHandlerOptions: { hold: held },
          requestDelegate: {
            onAccept: () => done(),
            onReject: () => done(new Error("Não foi possível colocar a chamada em espera."))
          }
        }).catch(done);
      });
    }
    async function restore() {
      const previous = original;
      consult = null;
      phase = "returning";
      emit();
      if (established(previous)) {
        try {
          await hold(previous, false);
          previous.sessionDescriptionHandler?.peerConnection?.getSenders().forEach(sender => { if (sender.track?.kind === "audio") sender.track.enabled = !getMuted?.(); });
          audio(previous);
        }
        catch (error) { phase = "held"; emit(); throw error; }
      }
      original = null; target = ""; phase = "idle"; emit();
    }
    async function start(number) {
      if (busy || phase !== "idle") throw new Error("Já existe uma transferência em andamento.");
      const session = getSession();
      const uri = /^[0-9]{2,20}$/.test(number) && SIP.UserAgent.makeURI(`sip:${number}@${getDomain()}`);
      if (!uri) throw new Error("Informe um ramal ou fila de destino válido.");
      if (!established(session) || !getAgent()) throw new Error("Atenda a chamada antes de transferir.");
      busy = true; original = session; target = number; phase = "holding"; emit();
      try {
        await hold(session, true);
        session.sessionDescriptionHandler?.peerConnection?.getSenders().forEach(sender => { if (sender.track?.kind === "audio") sender.track.enabled = false; });
        if (original !== session || !established(session)) throw new Error("A chamada foi encerrada.");
        const next = new SIP.Inviter(getAgent(), uri, { sessionDescriptionHandlerOptions: { constraints: constraints?.() || { audio: true, video: false } } });
        consult = next; phase = "calling";
        next.stateChange.addListener(status => {
          if (consult !== next || phase === "completing") return;
          if (status === SIP.SessionState.Established) { phase = "consulting"; audio(next); emit(); }
          if (status === SIP.SessionState.Terminated) {
            busy = true;
            restore().catch(report).finally(() => { busy = false; emit(); });
          }
        });
        emit();
        await next.invite();
      } catch (error) {
        await restore();
        throw error;
      } finally { busy = false; emit(); }
    }
    async function cancel() {
      if (busy || phase === "completing") return;
      busy = true; const next = consult; consult = null; emit();
      try { await end(next); await restore(); }
      finally { busy = false; emit(); }
    }
    async function complete() {
      if (busy || phase !== "consulting" || !established(original) || !established(consult)) throw new Error("Aguarde o destino atender para concluir.");
      busy = true; phase = "completing"; emit();
      const first = original, second = consult;
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Não foi possível confirmar a transferência. Verifique a chamada antes de tentar novamente.")), 30000);
          const done = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
          first.refer(second, {
            requestDelegate: { onReject: () => done(new Error("O destino não aceitou a transferência.")) },
            onNotify: notification => {
              notification.accept().catch(report);
              const code = Number(String(notification.request.body || "").match(/^SIP\/2\.0\s+(\d{3})/m)?.[1]);
              if (code >= 200 && code < 300) done();
              else if (code >= 300) done(new Error("Não foi possível concluir a transferência. Você pode voltar ao cliente."));
            }
          }).catch(done);
        });
        original = null; consult = null; target = ""; phase = "idle";
        await Promise.allSettled([end(first), end(second)]);
      } catch (error) {
        phase = established(consult) ? "consulting" : "held";
        throw error;
      } finally { busy = false; emit(); }
    }
    async function dispose() {
      if (phase === "completing") return;
      const next = consult; consult = null; original = null; target = ""; phase = "idle";
      await end(next); emit();
    }
    return { start, complete, cancel, dispose, get phase() { return phase; }, get consult() { return consult; } };
  }
  if (typeof module === "object" && module.exports) module.exports = { create };
  else root.AssistedTransfer = { create };
})(typeof window === "object" ? window : globalThis);
