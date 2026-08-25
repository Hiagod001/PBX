# PBX SIP Admin

Painel administrativo Node.js para um PBX SIP empresarial com Asterisk como motor SIP/RTP.

## Acesso inicial

- URL local: `http://localhost:3090`
- Usuario: `admin`
- Senha: definida exclusivamente por `PBX_INITIAL_ADMIN_PASSWORD` na primeira inicializacao

Nao existe senha inicial padrao. A conta criada exige troca imediata e, ate isso acontecer, somente logout, consulta da sessao e troca de senha ficam liberados.

## Rodar no Linux

```bash
npm install
npm start
```

Ou:

```bash
./scripts/start.sh
```

Em producao, o servidor web escuta em `127.0.0.1` por padrao e deve ser publicado somente pelo proxy HTTPS existente. Mantenha a porta Node atual bloqueada para acesso externo e configure `PBX_TRUST_PROXY=loopback` quando o nginx estiver na mesma VM.

Para parar um processo iniciado em segundo plano:

```bash
./scripts/stop.sh
```

## O que o projeto entrega

- Painel web responsivo com tema vermelho.
- Login administrativo com sessao.
- Troca de senha administrativa.
- Cadastro de tronco SIP da operadora.
- Ramais 201 a 205 pre-configurados.
- Rotas de entrada.
- URA principal com 1 Comercial, 2 Financeiro, 3 Suporte e 0 Recepcao.
- Grupo de toque da recepcao.
- Fila de suporte.
- Permissoes de saida por ramal.
- Gravação, voicemail e horario comercial.
- Tela de historico lendo CDR CSV do Asterisk quando existir.
- Geracao de `pjsip.conf`, `extensions.conf`, `queues.conf`, `voicemail.conf`, `rtp.conf`, UFW e Fail2Ban.

## Arquivos gerados

Ao iniciar, salvar ou aplicar, o sistema gera configs em:

```text
generated/asterisk/
```

Arquivos principais:

- `pjsip.conf`
- `extensions.conf`
- `queues.conf`
- `voicemail.conf`
- `rtp.conf`
- `ufw-pbx.sh`
- `fail2ban-asterisk.local`

## Aplicar em um Asterisk instalado no host

Por seguranca, o painel gera os arquivos localmente por padrao. Para copiar direto para o Asterisk e executar reload, configure `.env`:

```bash
cp .env.example .env
```

Edite:

```dotenv
ASTERISK_CONFIG_DIR=/etc/asterisk
ASTERISK_RELOAD_CMD=asterisk -rx "module reload res_pjsip.so"
```

Depois use o botao **Gerar/Aplicar** no painel.

## Dependencias de telefonia

Node.js e usado apenas como painel administrativo. Para chamadas reais, instale e configure Asterisk no Linux:

```bash
./scripts/install-asterisk-debian.sh
```

Depois aplique os arquivos gerados para `/etc/asterisk`, revise certificados TLS se habilitar TLS/SRTP e carregue o dialplan:

```bash
./scripts/apply-asterisk.sh
```

Para registrar ramais externos, use no telefone/IP phone:

- Servidor SIP: `131.0.112.23`
- Porta: `5060`
- Transporte: `UDP`
- Usuario/Auth ID: numero do ramal, por exemplo `201`
- Senha: a senha SIP cadastrada no painel para o ramal

O acesso pelo navegador fica no icone de telefone da tela de login. Para chamadas reais no browser, marque o ramal como `Softphone`, aplique as configuracoes e exponha o WebSocket do Asterisk, normalmente `wss://seu-pbx:8089/ws`, em `BROWSER_SIP_WS`.

Sem Asterisk instalado e ativo, nenhum ramal SIP registra, mesmo com o painel web funcionando.

## Observacoes de seguranca

- Internacional fica bloqueado por padrao para ramais sem permissao.
- Senhas SIP iniciais sao fortes, mas devem ser trocadas conforme sua politica.
- Use TLS/SRTP apenas com certificados instalados em `/etc/asterisk/keys`.
- Revise `generated/asterisk/ufw-pbx.sh` antes de executar em producao.
- Instale `generated/asterisk/fail2ban-asterisk.local` em `/etc/fail2ban/jail.d/`.

## CDR e relatorios PBX

O painel agora tem suporte a PostgreSQL para configuracoes e relatorios. Quando `DATABASE_URL` ou `PGHOST`/`PGDATABASE` estiver configurado, o sistema cria as tabelas automaticamente e migra o conteudo atual de `data/config.json` e `data/users.json` para o banco.

Exemplo:

```dotenv
DATABASE_URL=postgres://pbx:senha-forte@127.0.0.1:5432/pbx
PBX_DATABASE_REQUIRED=false
PBX_CDR_DB_LIMIT=50000
```

Para criar o schema e validar a migracao:

```bash
npm run db:migrate
```

Para importar o CDR CSV atual para a tabela `pbx_cdr`:

```bash
npm run cdr:import
# ou informe outro arquivo
npm run cdr:import -- /caminho/para/Master.csv
```

As tabelas principais criadas ficam em `src/postgres-schema.sql` e incluem:

- `pbx_extensions`, `pbx_trunks`, `pbx_inbound_routes`, `pbx_ring_groups`, `pbx_queues`
- `pbx_ivr_menus` e `pbx_ivr_options`
- `pbx_outbound_rules` e `pbx_outbound_rule_patterns`
- `pbx_users`, `pbx_presence_events`, `pbx_recording_audit`
- `pbx_cdr` para relatorios de chamadas, TAM/TME, filas, troncos, DIDs e gravacoes

Se `pbx_cdr` tiver registros, os relatorios usam o PostgreSQL. Se estiver vazia, o painel tenta ler:

```text
/var/log/asterisk/cdr-csv/Master.csv
```

Para outro caminho, ajuste:

```dotenv
ASTERISK_CDR_CSV=/caminho/para/Master.csv
```

O modulo de relatorios inclui dashboard, filtros avancados, graficos, paginacao, exportacao CSV/Excel/PDF e player seguro de gravacoes. As gravacoes sao procuradas em:

```dotenv
ASTERISK_RECORDING_PATH=/var/spool/asterisk/monitor
```

Em producao, configure o Asterisk para gravar CDR no PostgreSQL apontando para a tabela `pbx_cdr` ou importe os CDRs para ela periodicamente.
