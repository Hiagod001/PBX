# PBX UAI

Repositorio do sistema PBX UAI e do aplicativo Electron do ramal.

## Estrutura

- `remote_pbx/`: painel web, monitoramento, configuracao de Asterisk, URAs, filas, troncos e ramais.
- `uai-pbx-ramal/`: aplicativo Electron do ramal PBX.

## Ramal Electron

```powershell
cd uai-pbx-ramal
npm install
npm start
```

Para gerar o instalador Windows:

```powershell
npm run dist
```

Os builds gerados (`dist/`, `dist-installer/`, `node_modules/`) ficam fora do Git.
