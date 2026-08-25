#!/usr/bin/env node

require("dotenv").config();

const { getConfig } = require("../src/store");
const { generateAsteriskConfigs } = require("../src/asterisk");

async function main() {
  const config = await getConfig();
  const files = await generateAsteriskConfigs(config);
  console.log("Arquivos Asterisk gerados:");
  files.forEach((file) => console.log(`- ${file}`));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
