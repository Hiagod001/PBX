const fs = require('node:fs/promises');
const path = require('node:path');
const { gt, valid } = require('semver');
function updateSession(userData, version, clock = Date.now) {
  const file = path.join(userData, 'pending-update-session.json');
  return {
    async mark(loggedIn) {
      await fs.writeFile(file, JSON.stringify({ version, loggedIn: Boolean(loggedIn), at: clock() }), { mode: 0o600 });
    },
    async consume() {
      let marker;
      try { marker = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return false; }
      await fs.unlink(file).catch(() => {});
      return Boolean(marker.loggedIn && valid(marker.version) && valid(version) && gt(version, marker.version) && clock() >= marker.at && clock() - marker.at < 15 * 60 * 1000);
    },
    async clear() { await fs.unlink(file).catch(() => {}); }
  };
}
module.exports = { updateSession };
