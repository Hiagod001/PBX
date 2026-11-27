const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const fileName = 'UAI-PBX-Ramal-Setup.exe';
const newer = (left, right) => {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};
async function publishDesktopRelease(staging, releaseDir) {
  staging = path.resolve(staging); releaseDir = path.resolve(releaseDir);
  const metadata = JSON.parse(await fs.readFile(path.join(staging, 'latest.json'), 'utf8'));
  if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(metadata.version) || !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw Error('Metadados de atualização inválidos.');
  if (typeof metadata.releasedAt !== 'string' || !Number.isFinite(Date.parse(metadata.releasedAt)) || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) throw Error('Metadados de atualização inválidos.');
  const from = path.join(staging, metadata.version), target = path.join(releaseDir, 'updates', metadata.version);
  const bytes = await fs.readFile(path.join(from, fileName));
  const blockmap = await fs.readFile(path.join(from, fileName + '.blockmap'));
  const sha256 = createHash('sha256').update(bytes).digest('hex'), sha512 = createHash('sha512').update(bytes).digest('base64');
  if (bytes.length !== metadata.size || sha256 !== metadata.sha256 || bytes.subarray(0, 2).toString() !== 'MZ' || !blockmap.length) throw Error('O instalador não corresponde à atualização.');
  const current = await fs.readFile(path.join(releaseDir, 'latest.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (current && metadata.version !== current.version && !newer(metadata.version, current.version)) throw Error('A publicação não pode voltar para uma versão anterior.');
  if (current?.version === metadata.version && current.sha256 !== metadata.sha256) throw Error('Uma versão publicada não pode ser substituída por outro instalador.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const exists = await fs.access(target).then(() => true).catch(() => false);
  if (exists) {
    const old = await fs.readFile(path.join(target, fileName));
    const oldMap = await fs.readFile(path.join(target, fileName + '.blockmap'));
    if (createHash('sha256').update(old).digest('hex') !== sha256 || !oldMap.equals(blockmap)) throw Error('Os arquivos dessa versão já existem com outro conteúdo.');
  } else {
    const temporary = target + '.staging-' + randomUUID();
    await fs.mkdir(temporary);
    try {
      await fs.writeFile(path.join(temporary, fileName), bytes, { mode: 0o644 });
      await fs.writeFile(path.join(temporary, fileName + '.blockmap'), blockmap, { mode: 0o644 });
      await fs.rename(temporary, target);
    } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
  }
  const atomic = async (name, content) => {
    const destination = path.join(releaseDir, name), temp = destination + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temp, content, { mode: 0o644 }); await fs.rename(temp, destination);
  };
  await atomic(fileName, bytes);
  await atomic('latest.json', JSON.stringify(metadata, null, 2));
  const url = `${metadata.version}/${fileName}`;
  await atomic('updates/latest.yml', `version: ${metadata.version}\nfiles:\n  - url: ${url}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${url}\nsha512: ${sha512}\nreleaseDate: '${new Date(metadata.releasedAt).toISOString()}'\n`);
  return { version: metadata.version, sha256, size: bytes.length };
}
if (require.main === module) publishDesktopRelease(process.argv[2], process.argv[3] || path.join(__dirname, '../data/desktop-releases'))
  .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { publishDesktopRelease };
