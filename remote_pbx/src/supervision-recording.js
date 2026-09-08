const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const pending = new Map();
const slots = [];
let activeMixes = 0;

async function withMixSlot(task) {
  if (activeMixes >= 2) await new Promise((resolve) => slots.push(resolve));
  else activeMixes++;
  try { return await task(); } finally {
    const next = slots.shift();
    if (next) next();
    else activeMixes--;
  }
}

function isSupervisionCall(call, endpoint = process.env.PBX_MONITOR_SIP_USER || "monitor-admin") {
  if (/^(ChanSpy|ExtenSpy)$/i.test(call.lastapp || call.lastApp || "")) return true;
  if ((call.dcontext || call.context) === "pbx-supervision") return true;
  if (/^pbx-supervision(?:;|$)/.test(call.userfield || call.userField || "")) return true;
  // Only the owning channel identifies a supervisor; never discard its target call.
  const channel = String(call.channel || "");
  return [endpoint, "monitor-admin"].some((name) => channel.startsWith(`PJSIP/${name}-`));
}

async function completedTrack(file) {
  const ended = Number((await fs.readFile(`${file}.end`, "utf8")).trim());
  if (!Number.isFinite(ended) || ended < 1e12) throw new Error("Invalid recording completion time");
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", file], { timeout: 15000 });
  const duration = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid recording duration");
  return { file, duration, started: ended - duration * 1000 };
}

function mixArguments(base, tracks, output) {
  const args = ["-nostdin", "-v", "error", "-y", "-filter_complex_threads", "1", "-i", base.file];
  const filters = [];
  tracks.forEach((track, index) => {
    args.push("-i", track.file);
    const delta = Math.round(track.started - base.started);
    const align = delta < 0 ? `atrim=start=${-delta / 1000},asetpts=PTS-STARTPTS` : `adelay=${delta}:all=1`;
    filters.push(`[${index + 1}:a]${align}[s${index}]`);
  });
  filters.push(`[0:a]${tracks.map((_, index) => `[s${index}]`).join("")}amix=inputs=${tracks.length + 1}:duration=first:normalize=0[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", "-threads", "1", output);
  return args;
}

async function unifiedRecording(file, cacheDir) {
  const name = path.basename(file);
  const directory = path.join(path.dirname(file), ".supervision");
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const suffix = /^spy-[0-9]+\.wav$/;
  const files = entries.filter((entry) => entry.isFile() && entry.name.startsWith(`${name}.`) && suffix.test(entry.name.slice(name.length + 1)))
    .map((entry) => path.join(directory, entry.name)).sort();
  if (!files.length) return file;
  // Never cache a partial mix or silently serve audio missing a supervisor track.
  const stamps = await Promise.all([file, ...files].map(async (item) => {
    const stat = await fs.stat(item);
    return [item, stat.size, stat.mtimeMs, await fs.readFile(`${item}.end`, "utf8")];
  }));
  const key = crypto.createHash("sha256").update(JSON.stringify(stamps)).digest("hex");
  const output = path.join(cacheDir, `${key}.wav`);
  if (await fs.stat(output).catch(() => null)) return output;
  if (pending.has(key)) return pending.get(key);
  const task = withMixSlot(async () => {
    await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const base = await completedTrack(file);
    const tracks = [];
    for (const track of files) tracks.push(await completedTrack(track));
    const temporary = path.join(cacheDir, `${key}-${crypto.randomUUID()}.wav`);
    try {
      await run("ffmpeg", mixArguments(base, tracks, temporary), { timeout: 180000, maxBuffer: 1024 * 1024 });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, output);
      return output;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

module.exports = { isSupervisionCall, unifiedRecording, mixArguments };
