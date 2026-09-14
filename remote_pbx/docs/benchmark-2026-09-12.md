# Benchmark UAI PBX - 12/09/2026

## Resultado

Teste sintetico controlado na VM de producao, autorizado pelo responsavel.
Rodada final: `benchmark-1789225343181`, aproximadamente 12:02-12:04 BRT.
VM: 16 vCPUs, 15.6 GiB de RAM. Outros servicos permaneceram em funcionamento.

| Canais simultaneos | Chamadas concluidas | Falhas SIPp | Pico de CPU total da VM | p95 API durante chamadas |
| --- | --- | --- | --- | --- |
| 1 | 1/1 | 0 | 22.4% | 215 ms |
| 5 | 5/5 | 0 | 18.4% | 304 ms |
| 19 | 19/19 | 0 | 19.7% | 628 ms |

Cada chamada reproduziu 25 segundos de audio G.711 mu-law a 8 kHz. SIPp 3.7.2
atendeu automaticamente em loopback e devolveu RTP. Na etapa de 19 canais:
23.750 pacotes RTP ecoados, 19 INVITEs/ACKs/BYEs, nenhuma retransmissao ou timeout
nessas mensagens e nenhum erro UDP reportado pelo gerador. Isso nao e uma
medicao de MOS, jitter ou perda em redes externas.

API medida: GET autenticado `/api/pbx-status`, pelo backend local na porta 3090.
Duas rodadas por nivel: 2, 10 e 38 requisicoes. Durante as chamadas repetiu-se
o respectivo nivel de concorrencia. As 100 requisicoes da rodada final retornaram
HTTP 200. Sem chamadas, p95: 237, 290 e 666 ms respectivamente.

O primeiro baseline de 19 consultas teve p95 de 762 ms; outra rodada anterior
teve 667 ms. Nao atribuir a variacao ao cache estatico: a API dinamica nao passou
a usar cache de navegador. Amostra pequena, sem ensaio estatistico de causalidade.

## Limites

- Foram usados os 19 endpoints configurados para originar canais PJSIP para o
  atendente SIPp local, por URI explicita. Os aparelhos reais nao foram registrados
  pelo teste; havia apenas um ramal registrado na inspecao inicial.
- Cada chamada teve uma perna de canal com Playback, nao duas pernas em bridge.
- Nao foram exercitados tronco externo, NAT remoto, SRTP/WebRTC, filas/URA,
  transferencias ou gravacao MixMonitor simultanea neste benchmark.
- Nao foi teste de saturacao nem teste prolongado de vazamento de memoria.
  Nao extrapolar o resultado para centenas de chamadas ou disponibilidade continua.
- CPU amostrada a cada aproximadamente dois segundos, incluindo outros servicos.
  Nao representa pico instantaneo nem uso exclusivo do Asterisk.
- A primeira preparacao falhou por parametro incompativel do SIPp e foi descartada.
  Uma rodada intermediaria foi encerrada antes da pausa final de contabilizacao
  do gerador. Somente a rodada final acima fundamenta os totais de sucesso.

Conclusao: nao houve travamento no cenario sintetico de 19 canais durante 25 s.
Para homologar o atendimento real, ainda e necessario um teste prolongado com
ramais registrados, chamadas em bridge, filas, gravacao e codecs usados no dia a dia.

## Melhorias publicadas

- Arquivos publicos versionados JS/CSS/imagens: cache de 24 horas com `immutable`.
  Alteracoes futuras nesses arquivos devem incrementar sua versao na URL.
- HTML e arquivos sem versao continuam exigindo revalidacao.
- Arquivos publicos sao servidos antes do middleware de sessao, evitando consulta
  ao PostgreSQL e renovacao de cookie desnecessarias para cada arquivo estatico.
- APIs: `Cache-Control: private, no-store`; sem cache compartilhado de dados pessoais.
- Preferencias de visualizacao por usuario no navegador: tamanho de pagina,
  filtros expandidos e secoes de relatorio abertas. Sem senhas, configuracao SIP,
  conteudo de formularios ou gravacoes. Troca de navegador nao sincroniza preferencias.
- Cookie de sessao existente foi preservado: HttpOnly, Secure em producao,
  SameSite=Lax, validade deslizante de oito horas e persistencia PostgreSQL.
- O cache de estado PBX existente (750 ms por padrao, com consultas concorrentes
  compartilhadas) foi mantido; nao houve aumento que atrasasse o estado operacional.

77 testes locais e 6 testes focados na VM passaram. Cabecalhos conferidos por HTTPS.
Sessao preservada apos reinicio apenas do painel `pbx-UAI`; Asterisk nao reiniciado.
Preferencia de filtro validada ao abrir novamente o relatorio no navegador.

## Evidencias e encerramento

Backup e evidencias na VM:
`/home/agenda/Area de trabalho/PBX/backups/cache-benchmark-20260912`
(o nome real do diretorio da VM usa A com acento em Area).

Relatorio bruto: subdiretorio `benchmark-1789225343181/report.json`.
Estatisticas SIPp: subdiretorios `1`, `5` e `19` do mesmo diretorio.
O gerador esta preservado junto das evidencias como `benchmark-pbx.cjs`.
Nao executa automaticamente; requer ambiente Linux, privilegios, sessao
administrativa ativa e nova janela autorizada. O SIPp instalado ficou disponivel.

Ao final: zero canais ativos, zero processos SIPp. Nenhuma chamada externa foi
originada. Arquivos de chamadas de teste tem prefixo benchmark e conta identificada;
logs e eventuais registros de auditoria nao foram apagados.
