(function (root) {
  const api = {
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
