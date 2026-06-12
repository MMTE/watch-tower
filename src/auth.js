// Shared API-key auth. Accepts x-api-key header, ?key= query, or Bearer token.

function getApiKey(req) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return req.headers['x-api-key'] || req.query.key || bearer?.[1];
}

function requireApiKey(req, res, next) {
  const apiKey = getApiKey(req);
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ ok: false, message: 'Unauthorized: invalid or missing API key' });
  }
  next();
}

module.exports = { getApiKey, requireApiKey };
