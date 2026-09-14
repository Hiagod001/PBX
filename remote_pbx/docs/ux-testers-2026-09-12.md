# Revisao de interface e correcoes dos testers

## Publicacao

- Painel: https://uaipbx.uaitelecom.com.br
- Backup na VM: /opt/pbx-sip-admin/backups/ux-testers-20260912
- Reiniciado somente o processo Node pbx-UAI, com zero chamadas ativas.
- Nenhuma configuracao de ramal, fila, tronco ou campanha foi salva durante a revisao visual em producao.
- Instalador Windows: uai-pbx-ramal/dist-installer/UAI PBX Ramal Setup 1.0.5.exe.
- SHA256 do instalador: 2b44992c8a7b4c8399e733285f8b185574f64a2819d864f1e02c6b148aebcba4.

## Alteracoes

- DISCADOR no menu, titulo e permissoes.
- Envio de audio pelo botao + sem reconstruir ou apagar o formulario da campanha.
- O audio continua seguindo o fluxo existente: salvar a campanha e aplicar em URAs antes de iniciar.
- Estrategias das filas com nomes em portugues, mantendo os valores internos do Asterisk.
- Novo ramal recebe foco no numero e fica visivel no editor.
- Ramais pausados destacados em amarelo nos temas claro e escuro.
- Filtros com ajuda sem comprimir os campos; cartoes com acoes alinhadas.
- Ajustes nos indicadores de Sistema/Auditoria, campos de Seguranca e rolagem ao trocar de menu.
- Ramal instalavel: ramal limitado a 8 digitos, discagem/transferencia a 20 digitos e senha a 160 caracteres.
- Letras removidas dos campos numericos e mensagem de numero vazio acentuada.
- Pausa bloqueada durante chamada no aplicativo e no servidor, inclusive durante preparacao da chamada.

## Evidencias

- 79 testes do painel aprovados; 5 testes do ramal aprovados.
- Checagem de sintaxe dos dois projetos aprovada.
- Instalador gerado; main.js, renderer.js, renderer.html e phone-state.js conferidos dentro de app.asar contra as fontes.
- Navegacao e capturas dos 14 menus administrativos em producao.
- Previa de notebook em 1366 pixels: filtros, cartoes, editor de ramais e editor de filas.
- Foco do novo ramal confirmado no campo number; sem transbordamento horizontal nesses editores.
- Cores de pausa verificadas com dados sinteticos nos dois temas, sem pausar ramais reais.
- Renderer real do ramal servido em ambiente local com APIs e telefonia simuladas: letras removidas, limite de 20 digitos, aviso de numero vazio e pausa bloqueada com zero comandos enviados.
- Testes isolados de upload cobrem sucesso, erro, selecao do novo audio e preservacao do formulario.

## Limites

- A versao instalada nas estacoes nao e substituida automaticamente: distribuir o instalador 1.0.5.
- Nao foi executada uma nova chamada real com o executavel 1.0.5; audio, hardware e instalacao em cada estacao exigem homologacao local.
- Nao foi enviado um audio real pelo seletor de arquivos do navegador nesta rodada.
- Revisao priorizou desktop; nao representa certificacao completa de todos os tamanhos de tela ou de todos os estados possiveis.
