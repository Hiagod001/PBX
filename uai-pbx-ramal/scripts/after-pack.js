const path = require("node:path");
const { applyIcon } = require("./icon-tools");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  await applyIcon(path.join(context.appOutDir, exeName));
};
