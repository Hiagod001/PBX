const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
async function createUpdateFeed(installer, version, output, blockmap = installer + '.blockmap') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const file = 'UAI-PBX-Ramal-Setup.exe', url = `${version}/${file}`;
  const bytes = await fs.readFile(installer);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const releaseDate = new Date().toISOString();
  const directory = path.join(output, version);
  await fs.mkdir(directory, { recursive: true });
  await fs.copyFile(installer, path.join(directory, file));
  await fs.copyFile(blockmap, path.join(directory, file + '.blockmap'));
  const yaml = `version: ${version}\nfiles:\n  - url: ${url}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${url}\nsha512: ${sha512}\nreleaseDate: '${releaseDate}'\n`;
  await fs.writeFile(path.join(output, 'latest.yml'), yaml);
  await fs.writeFile(path.join(output, 'latest.json'), JSON.stringify({ version, sha256, size: bytes.length, releasedAt: releaseDate }, null, 2));
  return [path.join(output, 'latest.yml'), path.join(directory, file), path.join(directory, file + '.blockmap')];
}
module.exports = { createUpdateFeed };
