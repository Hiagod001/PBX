const fs = require('node:fs');

// This deployment's astdatadir is /usr/share/asterisk. The custom sound volume
// is shared with Asterisk and survives web recreation; the language copy does not.
const sharedDirectory = '/usr/share/asterisk/sounds/custom';
const legacyDirectories = [
  '/var/lib/asterisk/sounds/custom',
  sharedDirectory,
  '/usr/share/asterisk/sounds/en/custom'
];

function prepareContainerApplyHelper(source) {
  const block = source.match(/^ASTERISK_SOUND_DIRS=\(\r?\n[\s\S]*?^\)/m);
  if (!block) throw new Error('Sound directory configuration not found; review the base image helper.');
  const entries = block[0].split(/\r?\n/).slice(1, -1).map(line => line.trim());
  const current = entries.map(line => /^"([^"\r\n]+)"$/.exec(line)?.[1]);
  if (current.length === 1 && current[0] === sharedDirectory) return source;
  if (JSON.stringify(current) !== JSON.stringify(legacyDirectories)) {
    throw new Error('Unexpected sound directories; review them before optimizing the container.');
  }
  return source.replace(block[0], `ASTERISK_SOUND_DIRS=(\n  "${sharedDirectory}"\n)`);
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) throw new Error('Specify the existing container apply helper.');
  fs.writeFileSync(file, prepareContainerApplyHelper(fs.readFileSync(file, 'utf8')));
}

module.exports = { prepareContainerApplyHelper };
