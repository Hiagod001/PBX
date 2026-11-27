# Launcher 1.0.11 — validação de 26/11/2026

O atendimento não espera mais a emissão do protocolo pelo painel. A indicação
da chamada e o toque começam antes dessa consulta. O protocolo continua sendo
solicitado em segundo plano, com chave idempotente e proteção contra respostas
atrasadas de outra chamada. Cliques simultâneos em atender compartilham a mesma
operação. O desligamento usa SIP diretamente e reserva o comando do servidor
para a recuperação de falhas.

O motor WebRTC é preparado antes do registro Online, sem abrir o microfone.
Isso evita transferir a inicialização mais cara do Electron para o primeiro
atendimento. O motor foi atualizado de Electron 31.7.7 para 45.5.0; o empacotador
é electron-builder 26.18.0. As funções e a reprodução nativa do toque foram
preservadas. As medições não indicaram necessidade de reescrever em Rust.

## Medições

Comparação com cinco chamadas internas por versão, na mesma estação e PBX,
usando dispositivos de áudio simulados. O executável empacotado foi validado
contra a configuração publicada, sem substituir as opções de mídia no teste.

| Medição | Anterior | 1.0.11 |
| --- | ---: | ---: |
| Aceitar chamada, mediana | 793,5 ms | 248,8 ms |
| Aceitar chamada, maior amostra/P95 | 1393,1 ms | 276,0 ms |
| Processar convite até atualizar o atendimento, mediana | 50,2 ms | 1,1 ms |
| Atualizar estado local ao desligar, mediana | 3,0 ms | 1,2 ms |

Uma rodada adicional de três chamadas registrou reprodução do áudio no elemento
do navegador entre 266 e 361 ms após o clique. Os testes também confirmaram
pacotes RTP nos dois sentidos e estado ICE conectado. A checagem de estatísticas
RTP ocorre por amostragem; seu horário não representa o primeiro pacote nem a
latência física até o ouvido de uma pessoa. Não foi um ensaio de capacidade com
todos os atendentes simultâneos.

No servidor, 40 leituras sequenciais de configuração passaram de média 4,66 ms
para 0,59 ms. Um lote de 32 leituras passou de 108,39 ms para 14,83 ms. O cache
reduz consultas repetidas das telas e do telefone; o histórico só é solicitado
pelo launcher quando o usuário abre essa parte.

O banco permanece PostgreSQL 16.15, com aproximadamente 116 MB. Na amostra de
uso não havia consultas esperando travas, nem pressão de memória que justificasse
trocar o banco ou aumentar arbitrariamente os buffers. A alteração na
inicialização elimina a repetição de DDL pelo painel e pelos importadores.

## Verificação

- Servidor: 164 testes aprovados, zero falhas e duas integrações condicionais
  ignoradas por falta do ambiente próprio do teste.
- Launcher: 15 testes aprovados, zero falhas.
- PostgreSQL real em banco descartável separado: 20 inicializações simultâneas,
  gravação e leitura dos cadastros, marcador de esquema e ausência de DDL na
  inicialização seguinte. O banco descartável foi removido.
- Aplicativo Windows empacotado: pausa, rejeição durante pausa, retomada,
  cancelamento enquanto chama, atendimento e RTP bidirecional, microfone,
  transferência assistida com retorno e conclusão, desligamento, reconexão e
  saída durante pausa. Os 12 cenários passaram.
- API publicada: opções de mídia, histórico opcional, seis solicitações
  concorrentes do mesmo protocolo e rejeição de chave reutilizada para outra
  chamada passaram.

As três expectativas antigas de testes de supervisão foram atualizadas para
exigir o escopo e a permissão de intervenção que já estavam implementados.
As regras de autorização do servidor foram preservadas.

## Uso e reprodução

Instalar o arquivo publicado em
`https://uaipbx.uaitelecom.com.br/downloads/UAI-PBX-Ramal-Setup.exe` em cada estação.
A versão aparece nas configurações do aplicativo. Esta publicação não força
instalação nem reinicia aplicativos abertos dos atendentes.

`npm test`, `npm run check` e `npm run dist` verificam e empacotam o launcher.
`scripts/benchmark-live.cjs --packaged` e `scripts/verify-live.cjs --packaged`
usam Playwright externo indicado por `PBX_PLAYWRIGHT_MODULE` e recebem um JSON
de credenciais em base64 pelo stdin. Aceitam somente os ramais internos de QA
9971–9973, com perfis temporários separados. `PBX_QA_EXECUTABLE` indica o executável
no benchmark e `PBX_BENCHMARK_OUTPUT` recebe a medição detalhada. Nunca publicar
credenciais, perfis temporários ou SDP de diagnóstico no Git.

O teste exige preparar previamente ramais temporários sem fila ou permissão
externa. Eles devem ser removidos após a validação, arquivando apenas os
registros e áudios comprovadamente gerados pelo ensaio e preservando a sequência
dos protocolos. Use a configuração de mídia real do ambiente; não desative
STUN/TURN em outras redes sem testar o áudio.

## Atualização 1.0.12: reconexão

A recuperação agora reutiliza o agente SIP, inclusive durante chamadas, em vez
de adiar a tentativa até o fim da conversa ou parar o agente. O controlador
confirma respostas novas de registro, verifica conexões sem resposta a cada
45 segundos e repete falhas com espera crescente de aproximadamente 1 a 30
segundos, sem limite de tentativas. O retorno da rede, o desbloqueio e a retomada
do computador antecipam a verificação. Logout cancela as tentativas; credenciais
revogadas e sessões expiradas continuam exigindo novo login.

Os 24 testes locais passaram. O executável 1.0.12 empacotado passou pelos 13
cenários internos de `scripts/verify-live.cjs --packaged`, incluindo recuperação
do transporte durante uma chamada estabelecida sem substituir o agente ou a
sessão e com RTP nos dois sentidos. Também passaram pausa, cancelamento,
atendimento, microfone, transferência assistida com retorno e conclusão,
desligamento e logout. Foram usados apenas os ramais temporários 9971–9973.

Os logs do Asterisk registravam fechamento abrupto de WebSocket; o servidor
estava saudável, sem reinício ou falta de memória registrada nos contêineres.
Isso confirma a interrupção da conexão, mas não identifica por si só sua origem
na rede ou na estação. A correção trata as falhas encontradas na recuperação e
acrescenta o motivo da desconexão ao `sip.log` local para diagnóstico futuro.

## Atualização 1.0.13, em 27/11/2026

O launcher passa a baixar as próximas versões automaticamente por HTTPS.
Depois de um minuto livre, confirma a ausência de chamadas no cliente e no
servidor, instala em silêncio e abre novamente. Uma chamada em andamento ou
transferência assistida impede a instalação. Um ramal ocioso que está tentando
se reconectar também pode receber uma correção. Há uma opção de verificação
manual nas configurações e mensagens simples de progresso.

É necessária uma instalação inicial da 1.0.13; versões anteriores não têm
o código do atualizador. A publicação seguinte usa `npm run dist` e o script
`remote_pbx/scripts/publish-desktop-release.js`, conforme o README do Dokploy.
O build produz feed, instalador por versão e blockmap. O cliente valida
SHA-512, e o publicador valida SHA-256 e impede substituir uma versão publicada.

O reinício da atualização pode retomar o ramal com a sessão já autenticada,
sem gravar senhas. O cookie continua sujeito à expiração e à validação das
credenciais no servidor. O fechamento normal do aplicativo mantém a política
anterior de solicitar login na próxima abertura.

Validação: 37 testes do launcher passaram, além dos testes das rotas públicas
e do publicador no Windows e na imagem Linux. O ensaio em uma instalação NSIS
isolada confirmou rejeição de checksum inválido, bloqueio automático e manual
durante sinalização de chamada simulada, instalação automática após o período
livre, reabertura de 0.0.1 como 0.0.2 e retomada da sessão com cookie persistente.
Nenhuma chamada foi feita pelo PBX nesse ensaio.

Para repetir, execute `scripts/verify-auto-update.cjs` no Windows com
`PBX_PLAYWRIGHT_MODULE` apontando para Playwright. O script cria um aplicativo,
registro de instalação, perfil e servidor local próprios de QA. Remove os
recursos ao passar; preserva os artefatos se o teste falhar. Não utiliza
credenciais do PBX. As versões 0.0.1 e 0.0.2 pertencem somente ao laboratório.

## Atualização de teste 1.0.14

A versão 1.0.14 acrescenta somente um selo verde `Teste 1.0.14` no cabeçalho,
visível antes e depois do login, para conferir o recebimento da atualização
automática em outra estação. O selo é condicionado à versão 1.0.14 e fica
oculto em versões seguintes. O funcionamento das chamadas permanece igual.
