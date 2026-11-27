const express = require('express');
const path = require('node:path');
function desktopUpdateRouter(releaseDir) {
  const router = express.Router(), root = path.resolve(releaseDir, 'updates');
  const send = (res, file, immutable) => {
    res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-store');
    res.sendFile(file, error => {
      if (error && !res.headersSent) res.status(error.status === 416 ? 416 : 404).json({ error: 'Atualização indisponível. Tente novamente mais tarde.' });
    });
  };
  router.get('/latest.yml', (_req, res) => {
    res.type('application/yaml');
    send(res, path.join(root, 'latest.yml'), false);
  });
  router.get('/:version/:file', (req, res) => {
    if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(req.params.version) || !['UAI-PBX-Ramal-Setup.exe', 'UAI-PBX-Ramal-Setup.exe.blockmap'].includes(req.params.file)) {
      return res.status(404).json({ error: 'Atualização não encontrada.' });
    }
    res.type('application/octet-stream');
    send(res, path.join(root, req.params.version, req.params.file), true);
  });
  return router;
}
module.exports = { desktopUpdateRouter };
