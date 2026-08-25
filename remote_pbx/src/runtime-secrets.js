const crypto = require("crypto");

const formerMonitorPasswords = new Set(["Monitor@12345", "monitor@12345"]);
let developmentMonitorPassword = "";

function monitorSipPassword() {
  const configured = String(process.env.PBX_MONITOR_SIP_PASSWORD || "").trim();
  if (configured && configured.length >= 24 && !formerMonitorPasswords.has(configured)) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Defina PBX_MONITOR_SIP_PASSWORD com pelo menos 24 caracteres e remova a senha padrao anterior.");
  }
  if (!developmentMonitorPassword) developmentMonitorPassword = crypto.randomBytes(24).toString("base64url");
  return developmentMonitorPassword;
}

module.exports = { monitorSipPassword };
