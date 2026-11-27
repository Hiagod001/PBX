const { copyStableInstaller } = require("./icon-tools");
const { createUpdateFeed } = require("./update-feed");
const path = require("node:path");

module.exports = async function afterAllArtifactBuild(context) {
  const exeArtifacts = (context.artifactPaths || []).filter((artifactPath) => artifactPath.toLowerCase().endsWith(".exe"));
  const stableArtifacts = [];

  for (const artifactPath of exeArtifacts) {
    stableArtifacts.push(await copyStableInstaller(artifactPath));
    const version = /(?:Setup |Setup-)(\d+\.\d+\.\d+)\.exe$/.exec(artifactPath)?.[1];
    if (version) stableArtifacts.push(...await createUpdateFeed(artifactPath, version, path.join(path.dirname(artifactPath), "updates")));
  }

  return [...(context.artifactPaths || []), ...stableArtifacts];
};
