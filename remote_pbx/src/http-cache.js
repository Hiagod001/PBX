const path = require('node:path');

function staticCacheHeaders(res, file) {
  const type = path.extname(file).toLowerCase();
  const versioned = Boolean(res.req.query?.v);
  const asset = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2'].includes(type);
  res.setHeader('Cache-Control', asset && versioned
    ? 'public, max-age=86400, immutable'
    : 'public, max-age=0, must-revalidate');
}

function privateApiHeaders(_req, res, next) {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}

module.exports = { staticCacheHeaders, privateApiHeaders };
