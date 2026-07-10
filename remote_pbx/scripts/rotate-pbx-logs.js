require("dotenv").config();

const fs = require("fs-extra");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");

const rootDir = path.join(__dirname, "..");
const pm2Home = process.env.PM2_HOME || path.join(process.env.HOME || process.env.USERPROFILE || "", ".pm2");
const logDir = path.join(pm2Home, "logs");
const archiveDir = path.resolve(process.env.PBX_LOG_ARCHIVE_DIR || path.join(rootDir, "backups", "logs"));
const prefix = String(process.env.PBX_PM2_APP_NAME || "pbx-UAI").replace(/[^a-zA-Z0-9_.-]/g, "");
const maximumBytes = Math.max(1, Number(process.env.PBX_LOG_MAX_MB || 25)) * 1024 * 1024;
const retention = Math.max(2, Number(process.env.PBX_LOG_RETENTION || 14));

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function rotateFile(filePath) {
  if (!(await fs.pathExists(filePath))) return "";
  const stats = await fs.stat(filePath);
  if (stats.size < maximumBytes) return "";
  await fs.ensureDir(archiveDir);
  const archivePath = path.join(archiveDir, `${path.basename(filePath)}-${timestamp()}.gz`);
  await pipeline(fs.createReadStream(filePath), zlib.createGzip({ level: 6 }), fs.createWriteStream(archivePath, { mode: 0o600 }));
  await fs.truncate(filePath, 0);
  return archivePath;
}

async function main() {
  if (!prefix || !(await fs.pathExists(logDir))) return;
  const rotated = [];
  for (const suffix of ["out", "error"]) {
    const archive = await rotateFile(path.join(logDir, `${prefix}-${suffix}.log`));
    if (archive) rotated.push(path.basename(archive));
  }

  await fs.ensureDir(archiveDir);
  const archives = await Promise.all((await fs.readdir(archiveDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${prefix}-`) && entry.name.endsWith(".gz"))
    .map(async (entry) => ({ name: entry.name, path: path.join(archiveDir, entry.name), stats: await fs.stat(path.join(archiveDir, entry.name)) })));
  archives.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
  await Promise.all(archives.slice(retention).map((archive) => fs.remove(archive.path)));
  if (rotated.length) console.log(`Logs arquivados: ${rotated.join(", ")}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { rotateFile, timestamp };
