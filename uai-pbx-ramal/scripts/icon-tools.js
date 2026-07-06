const fs = require("node:fs/promises");
const path = require("node:path");
const rcedit = require("rcedit");

const projectRoot = path.resolve(__dirname, "..");
const iconPath = path.join(projectRoot, "assets", "icon.ico");

async function applyIcon(exePath) {
  await fs.access(iconPath);
  await fs.access(exePath);
  await rcedit(exePath, {
    icon: iconPath,
    "version-string": {
      CompanyName: "UAI Telecom",
      FileDescription: "UAI PBX Ramal",
      ProductName: "UAI PBX Ramal"
    }
  });
  console.log(`icon applied: ${exePath}`);
}

async function copyStableInstaller(artifactPath) {
  const parsed = path.parse(artifactPath);
  const stablePath = path.join(parsed.dir, "UAI-PBX-Ramal-Setup.exe");
  await fs.copyFile(artifactPath, stablePath);
  console.log(`stable installer copied: ${stablePath}`);
  return stablePath;
}

module.exports = {
  applyIcon,
  copyStableInstaller,
  iconPath
};
