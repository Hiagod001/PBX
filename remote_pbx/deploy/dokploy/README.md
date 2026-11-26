# PBX no Dokploy

Produção: `https://uaipbx.uaitelecom.com.br`, servidor `131.0.112.27`.
Projeto Dokploy: **PBX Uai - Producao**, app `pbx-validation-jlmjrm`.

`compose.yaml` reproduz a configuração publicada em 26/11/2026. O projeto usa
PostgreSQL 16, Asterisk 20, painel Node.js e proxy Nginx. O serviço WhatsApp roda
separadamente no mesmo servidor, no app `whatsapp-lab-8t46fo`; mantenha seus dados
de sessão e segredos próprios.

## Dados persistentes

- `/etc/dokploy/pbx-validation/data/app`: protocolos, política do histórico e estado do painel.
- `/etc/dokploy/pbx-validation/data/asterisk-config`: configuração de telefonia.
- `/etc/dokploy/pbx-validation/data/spool`: arquivos de chamada.
- `/etc/dokploy/pbx-validation/data/generated`: arquivos gerados pelo painel.
- Volume `pbx-validation-db`: banco, configurações, usuários, sessões e campanhas.
- Volumes `pbx-validation-sounds`, `pbx-validation-ast-data` e `pbx-validation-logs`: áudios e dados do Asterisk.
- Volume **local** `pbx-recordings-local-20261126`: todas as gravações, compartilhado pelo Asterisk e pelo painel.

As gravações não usam mais NFS nem dependem da VM `131.0.112.23`. A cópia antiga
continua preservada. O servidor antigo também atende outros sistemas: esta
migração não autoriza desligá-lo nem remover seus serviços.

Os caminhos `/etc/dokploy` e `/home/dokploy` apontam para os mesmos dados neste host.
Os arquivos `private/web.env` e `private/postgres.env` permanecem somente no
servidor; não os inclua no Git. Preserve os segredos existentes para manter as
sessões, autenticação e integração WhatsApp.

## Publicação e recuperação

O Compose bruto está salvo no banco do Dokploy e em
`/etc/dokploy/compose/pbx-validation-jlmjrm/code/docker-compose.yml`.
A cópia operacional fica em `/home/dokploy/pbx-validation/compose.yaml`.
Atualize essas definições juntas para uma publicação posterior não restaurar
volumes antigos. Valide com `docker compose config --quiet`; a saída completa de
`docker compose config` pode conter segredos expandidos dos arquivos de ambiente.

As imagens `uai-pbx-web:20261126-config-save2` e
`uai-pbx-asterisk:20261113-fixes2` estão no Docker deste servidor, com
`pull_policy: never`. Preserve/exporte essas imagens ao recuperar em outro host.
O código utilizado na publicação está em `/home/dokploy/pbx-validation/source`.
As redes e volumes externos devem existir antes de subir o Compose.

O Asterisk usa a rede do host. Não mantenha duas instâncias ativas no mesmo host.
O discador tem um único processo; não escale o serviço `web` com réplicas.
Antes de recriar o Asterisk, pare o painel e confirme que não há chamadas ativas.
Os serviços têm `restart: unless-stopped`, health checks e dependências de início.
O proxy preserva HTTPS, WebSocket SIP e a restrição de rede do escritório.

Backup da migração: `/home/dokploy/pbx-validation/backups/migration-local-20261126`.
Inclui dump PostgreSQL validado, configurações, Compose anterior e lista dos
734 arquivos copiados. A comparação de conteúdo da origem com o destino não
encontrou diferenças antes da troca. Os 365.827.956 bytes permaneceram no novo
volume; as permissões permitem gravação pelo Asterisk e leitura pelo painel.
O dump do banco sozinho não contém os arquivos de áudio.

## Histórico e protocolos

O início de produção foi fixado em `2026-11-26T03:00:00Z` (meia-noite de São Paulo)
em `data/app/call-history-policy.json`. Essa política impede que arquivos CSV
antigos repovoem o histórico após uma reimportação. Foram removidas 70.751 linhas
anteriores ao corte, mantendo os registros do dia, gravações e a sequência dos
protocolos. O backup anterior está em
`/home/dokploy/pbx-validation/backups/protocol-history-20261126`.

O importador interpreta os horários locais do Asterisk com `ASTERISK_CDR_TIMEZONE`
ou `TZ` (padrão `America/Sao_Paulo`) antes de gravar instantes no PostgreSQL.
O vínculo de protocolos considera o horário original do identificador Asterisk
para distinguir chamadas repetidas mesmo quando o CDR final tem horários iguais.

## Desempenho e aplicativo dos ramais

O painel mantém um cache de configuração por processo de até 1 segundo
(`PBX_CONFIG_CACHE_MS`), com cópia independente para cada leitor e invalidação
imediata ao salvar pela aplicação. Alterações diretas no banco aparecem após
esse intervalo. Usuários e sessões continuam com sua validação própria.
A inicialização do PostgreSQL é compartilhada e o esquema só recebe DDL quando
o hash de `src/postgres-schema.sql` muda. O marcador `pbx_schema_version` é
atualizado dentro de uma transação com trava de migração.

Neste host, `private/web.env` define `PBX_WEBRTC_ICE_SERVERS=[]` e
`PBX_WEBRTC_ICE_PERMIT=131.0.112.27/32`. Isso usa o caminho de mídia direto
validado na rede dos atendentes e remove candidatos de interfaces Docker sem
rota. Preserve essas definições ao regenerar `rtp.conf`. Outros ambientes devem
validar STUN/TURN e suas próprias redes antes de reutilizar os valores.
Não altera as portas RTP nem a restrição de acesso ao WebSocket.

O instalador 1.0.11 fica em `data/app/desktop-releases/UAI-PBX-Ramal-Setup.exe`.
O manifesto `latest.json` contém versão, SHA-256, tamanho e data de publicação.
A aplicação serve `/downloads/UAI-PBX-Ramal-Setup.exe` e `/api/desktop-release`
sem uma sessão administrativa; os arquivos distribuídos não incluem credenciais.
A publicação é manual e não instala atualizações automaticamente nas estações.

Backup desta manutenção: `/home/dokploy/pbx-validation/backups/launcher-performance-20261126`.
Inclui os arquivos de ambiente, Compose, RTP, dump e dados anteriores aos testes.
Para recuperar somente o painel, use a imagem e o Compose anteriores desse
backup; para desfazer a configuração de mídia, restaure também o ambiente e
`rtp.conf`, recarregando apenas `res_rtp_asterisk.so` quando não houver chamadas.
Não restaure o banco inteiro para desfazer uma atualização de interface.

## Aplicação de filas e preparação de áudios

O helper do contêiner sincroniza os áudios somente em
`/usr/share/asterisk/sounds/custom`, volume persistente compartilhado com o
Asterisk. O `astdatadir` deste ambiente é `/usr/share/asterisk`. As cópias antigas
em diretórios alternativos não são necessárias para os áudios `custom/...` e
uma delas era refeita dentro do contêiner a cada recriação do painel, causando
conversões de MP3 durante o primeiro salvamento de uma fila.

`Dockerfile.queue-apply` deriva da imagem anterior e executa
`prepare-apply-helper.cjs` sobre o helper específico do contêiner. O ajuste
preserva suas regras de permissões, trava, backup, rollback e recarga seletiva.
O build falha se encontrar uma lista de diretórios diferente da esperada.
O helper para instalações Linux fora do Dokploy permanece independente.

Validação em 26/11/2026: o aplicador em contêiner recém-criado passou de
11,035 s para 0,176 s. A recarga efetiva de `queues.conf` em produção levou
0,243 s, mantendo os cadastros e parâmetros da fila de Suporte. Um áudio novo
foi convertido nos quatro formatos de telefonia, e os arquivos temporários do
teste foram removidos. Esses tempos medem o aplicador, não o clique completo
no navegador. Backup: `data/backups/queue-apply-20261126`.

## Salvamento por módulo e permissões de áudio

O servidor passa a configuração anterior, lida sob a trava de alterações, ao
salvamento do banco. Apenas as tabelas dos módulos modificados são regravadas.
Filhos são removidos antes de seus pais e tudo permanece na mesma transação,
incluindo o snapshot. A gravação completa continua disponível para migrações e
rollback. As leituras usam uma transação somente de leitura com snapshot
consistente, sem misturar módulos de duas versões durante uma gravação.

Na comparação de três alterações reais por módulo em banco descartável no
mesmo PostgreSQL, a mediana da gravação passou de 845 para 21 ms em Ramais, de
795 para 11 ms em Troncos e de 1070 para 33 ms em Filas. URAs, Rotas, Sistema,
Segurança e Usuários também foram conferidos. Esses números não incluem o tempo
de rede e da interface. As recargas do Asterisk medidas separadamente ficaram
em 441 ms para Ramais, 407 ms para Troncos e 266 ms para URAs/Rotas.

`permissions.menus.audios` mantém o acesso às gravações de chamadas.
`permissions.menus.ivrAudios` controla a biblioteca de áudios da URA, em
`/audios-ura`. A nova permissão não é concedida automaticamente a usuários
antigos. Administradores continuam com acesso total. O acesso a Relatórios
não libera a reprodução ou o download de gravações sem a permissão Gravações.
O Discador pode selecionar os áudios existentes para campanhas, mas seu botão
de envio e as operações da biblioteca exigem a permissão Áudios da URA.

Os títulos Telefonia e Administração somem quando todos os seus itens estão
ocultos. O painel de usuários apresenta as duas permissões separadamente.
Recarregue a página após publicar para carregar o novo menu.
Backups e medições: `data/backups/menu-save-20261126`.
