const path = require('node:path');

async function ensurePanel(pm2, root, interpreter) {
  const list = await new Promise((resolve, reject) => pm2.list((error, rows) => error ? reject(error) : resolve(rows)));
  const existing = list.find((item) => item.name === 'pbx-UAI');
  // Respect deliberate stops; PM2 already restarts crashed running processes.
  if (existing) return 'present';
  await new Promise((resolve, reject) => pm2.start({
    name: 'pbx-UAI', script: path.join(root, 'server.js'), cwd: root,
    interpreter, autorestart: true, restart_delay: 3000, time: true
  }, (error) => error ? reject(error) : resolve()));
  return 'restored';
}

if (require.main === module) {
  const pm2 = require(process.env.PBX_PM2_MODULE || '/home/agenda/.nvm/versions/node/v24.13.0/lib/node_modules/pm2');
  pm2.connect(async (error) => {
    try {
      if (error) throw error;
      console.log(await ensurePanel(pm2, '/opt/pbx-sip-admin', process.execPath));
    } catch (failure) {
      console.error('PBX startup check failed:', failure.message);
      process.exitCode = 1;
    } finally {
      pm2.disconnect();
    }
  });
}

module.exports = { ensurePanel };
