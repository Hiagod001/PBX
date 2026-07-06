const { copyStableInstaller } = require("./icon-tools");

module.exports = async function afterAllArtifactBuild(context) {
  const exeArtifacts = (context.artifactPaths || []).filter((artifactPath) => artifactPath.toLowerCase().endsWith(".exe"));
  const stableArtifacts = [];

  for (const artifactPath of exeArtifacts) {
    stableArtifacts.push(await copyStableInstaller(artifactPath));
  }

  return [...(context.artifactPaths || []), ...stableArtifacts];
};
