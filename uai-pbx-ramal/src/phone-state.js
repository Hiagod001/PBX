(function (root) {
  const api = {
    displayStatus(state = {}, paused = false) {
      if (state.session) return state.incoming ? { label: 'Recebendo', tone: 'ringing' } : { label: 'Ocupado', tone: 'busy' };
      if (state.callPending || state.dialStarting) return { label: 'Chamando', tone: 'ringing' };
      if (state.registrationStatus === 'connecting') return { label: 'Conectando', tone: 'connecting' };
      if (state.registrationStatus !== 'online') return { label: 'Offline', tone: 'offline' };
      return paused ? { label: 'Em pausa', tone: 'paused' } : { label: 'Online', tone: 'online' };
    },
    sanitizeNumber(value, limit = 20) {
      return String(value || "").replace(/\D/g, "").slice(0, limit);
    },
    validateNumber(value) {
      const number = String(value || "").trim();
      if (!number) throw new Error("Informe o n\u00famero para ligar.");
      if (!/^\d{1,20}$/.test(number)) throw new Error("Use somente n\u00fameros, com no m\u00e1ximo 20 d\u00edgitos.");
      return number;
    },
    callInProgress(state = {}) {
      return Boolean(state.session || state.callPending || state.dialStarting);
    },
    terminationAction(session, states) {
      if (!session || session.state === states.Terminated || session.state === states.Terminating) return null;
      if (session.state === states.Established) return "bye";
      return typeof session.reject === "function" ? "reject" : "cancel";
    },
    pauseFromStatus(status) {
      const extension = status.extension || {};
      const agent = (status.queues || []).map((queue) => queue.agent).find((item) => item && (item.paused || item.statusTone === "paused" || item.status === "paused"));
      const paused = typeof extension.paused === "boolean" ? extension.paused : Boolean(agent);
      return { paused, reason: extension.pauseReason || agent?.pauseReason || "Pausa", startedAt: Date.parse(extension.pauseStartedAt || agent?.pauseStartedAt || "") || null };
    },
    rejectInvitation({ paused, busy, stopping, callback }) {
      return Boolean(stopping || busy || (paused && !callback));
    }
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.PhoneState = api;
})(typeof window !== "undefined" ? window : globalThis);
