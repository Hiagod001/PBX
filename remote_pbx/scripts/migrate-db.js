require("dotenv").config();

const { ensureStore, getConfig, getUsers } = require("../src/store");

async function main() {
  if (!process.env.DATABASE_URL && !process.env.PBX_DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    throw new Error("Configure DATABASE_URL ou PGHOST/PGDATABASE antes de executar a migracao.");
  }

  await ensureStore();
  const [config, users] = await Promise.all([getConfig(), getUsers()]);
  console.log(`PostgreSQL pronto. Configuracao: ${config.extensions.length} ramais, ${config.queues.length} filas, ${config.ivr.options.length} opcoes na URA principal.`);
  console.log(`Usuarios migrados: ${users.users.length}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
}).then(() => process.exit(0));
