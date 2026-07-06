# PBX UAI

![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Asterisk](https://img.shields.io/badge/Asterisk-PBX-EA5B0C?style=for-the-badge)
![Electron](https://img.shields.io/badge/Electron-Ramal-47848F?style=for-the-badge&logo=electron&logoColor=white)
![Status](https://img.shields.io/badge/status-produ%C3%A7%C3%A3o-2ea44f?style=for-the-badge)

Repositório principal do ecossistema PBX UAI, reunindo o painel web de administração do Asterisk e o aplicativo Electron usado como ramal desktop.

## Visão Geral

O projeto centraliza a operação de telefonia da UAI Telecom em duas frentes:

| Módulo | Descrição |
| --- | --- |
| `remote_pbx/` | Painel web para gestão de ramais, filas, troncos SIP, URAs, relatórios, segurança, monitoramento e geração de configuração Asterisk. |
| `uai-pbx-ramal/` | Aplicativo Electron para operação de ramal no Windows, com interface de login, registro SIP e controle de chamadas. |

## Recursos Principais

- Gestão de ramais, filas, troncos SIP e rotas de entrada.
- Editor visual de URA com menus, opções, horários e destinos.
- Monitoramento de filas e ramais em tempo quase real.
- Relatórios operacionais e leitura de CDR.
- Geração de arquivos para Asterisk.
- App Electron para atendimento pelo computador.
- Estrutura pronta para versionamento limpo, sem builds e segredos.

<details>
<summary>Fluxo operacional sugerido</summary>

1. Configure troncos, ramais e filas no painel PBX.
2. Monte URAs e rotas de entrada conforme o fluxo de atendimento.
3. Aplique a configuração no Asterisk.
4. Use o monitor para acompanhar agentes, chamadas, pausas e filas.
5. Distribua o app Electron para os operadores que usam ramal no PC.

</details>

## Como Rodar o Painel PBX

```bash
cd remote_pbx
npm install
npm start
```

Por padrão, a configuração de produção fica em arquivo `.env` fora do Git. Use `remote_pbx/.env.example` como base.

## Como Rodar o Ramal Electron

```powershell
cd uai-pbx-ramal
npm install
npm start
```

Para gerar o instalador Windows:

```powershell
npm run dist
```

## Estrutura do Repositório

```text
.
|-- remote_pbx/
|   |-- public/
|   |-- scripts/
|   |-- src/
|   |-- server.js
|   `-- package.json
|-- uai-pbx-ramal/
|   |-- assets/
|   |-- installer/
|   |-- scripts/
|   |-- src/
|   `-- package.json
|-- .gitignore
`-- README.md
```

## Arquivos Fora do Git

| Item | Motivo |
| --- | --- |
| `.env` | Variáveis e segredos de produção. |
| `node_modules/` | Dependências instaladas localmente. |
| `dist/` e `dist-installer/` | Builds gerados do Electron. |
| `generated/`, logs e bases locais | Artefatos de execução. |

## Boas Práticas

- Nunca versionar senhas SIP, tokens ou arquivos `.env` reais.
- Registrar toda alteração relevante em commit.
- Validar scripts Node.js antes de publicar alterações.
- Manter o GitHub atualizado após cada ajuste feito em produção.

<details>
<summary>Checklist rápido antes de subir mudança</summary>

- `git status` revisado.
- Segredos e arquivos gerados fora do commit.
- Alteração testada localmente ou em produção controlada.
- Commit criado com mensagem clara.
- Push enviado para `origin/main`.

</details>
