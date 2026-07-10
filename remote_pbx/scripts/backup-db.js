require("dotenv").config();

const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.join(__dirname, "..");
const backupDir = path.resolve(process.env.PBX_BACKUP_DIR || path.join(rootDir, "backups", "database"));

function connectionSettings() {
  const connectionString = process.env.PBX_DATABASE_URL || process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING;
  if (connectionString) {
    const parsed = new URL(connectionString);
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "pbx",
      user: decodeURIComponent(parsed.username || "pbx"),
      password: decodeURIComponent(parsed.password || "")
    };
  }
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: process.env.PGPORT || "5432",
    database: process.env.PGDATABASE || "pbx",
    user: process.env.PGUSER || "pbx",
    password: process.env.PGPASSWORD || ""
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function existingBackups() {
  await fs.ensureDir(backupDir);
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^pbx-.*\.dump$/.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(backupDir, entry.name);
      return { path: filePath, name: entry.name, stats: await fs.stat(filePath) };
    }));
  return files.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
}

async function runPgDump(targetPath) {
  const settings = connectionSettings();
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    `--host=${settings.host}`,
    `--port=${settings.port}`,
    `--username=${settings.user}`,
    `--dbname=${settings.database}`,
    `--file=${targetPath}`
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.PG_DUMP_BIN || "pg_dump", args, {
      cwd: rootDir,
      env: { ...process.env, PGPASSWORD: settings.password },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
      if (errorOutput.length > 8192) errorOutput = errorOutput.slice(-8192);
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(errorOutput.trim() || `pg_dump encerrou com codigo ${code}`))));
  });
}

async function main() {
  const intervalMs = Math.max(1, Number(process.env.PBX_BACKUP_INTERVAL_HOURS || 24)) * 60 * 60 * 1000;
  const retention = Math.max(2, Number(process.env.PBX_BACKUP_RETENTION || 14));
  const force = process.argv.includes("--force");
  const backups = await existingBackups();
  if (!force && backups[0] && Date.now() - backups[0].stats.mtimeMs < intervalMs) {
    console.log("Backup recente ja existe; nenhuma acao necessaria.");
    return;
  }

  const finalPath = path.join(backupDir, `pbx-${timestamp()}.dump`);
  const temporaryPath = `${finalPath}.partial`;
  await fs.remove(temporaryPath);
  try {
    await runPgDump(temporaryPath);
    const stats = await fs.stat(temporaryPath);
    if (!stats.size) throw new Error("pg_dump gerou um arquivo vazio");
    await fs.chmod(temporaryPath, 0o600);
    await fs.move(temporaryPath, finalPath, { overwrite: false });
  } catch (error) {
    await fs.remove(temporaryPath);
    throw error;
  }

  const updated = await existingBackups();
  await Promise.all(updated.slice(retention).map((backup) => fs.remove(backup.path)));
  console.log(`Backup criado: ${path.basename(finalPath)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { connectionSettings, existingBackups, timestamp };
