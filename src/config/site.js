'use strict';

// Dominio canónico del producto. PUBLIC_BASE_URL manda; si falta o apunta al
// host viejo de Render, se usa el dominio propio.
const CANONICAL = 'https://flightalert.ranuk.dev';
const LEGACY_HOSTS = ['flight-alert-public.onrender.com'];

function baseUrl(env = process.env) {
  const raw = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return CANONICAL;
  try {
    if (LEGACY_HOSTS.includes(new URL(raw).hostname)) return CANONICAL;
  } catch (_) {
    return CANONICAL;
  }
  return raw;
}

// 301 del host viejo al canónico. /health, /webhooks/* y todo lo que no sea
// GET/HEAD siguen respondiendo en el host viejo.
function legacyRedirect(req, res, next) {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (!LEGACY_HOSTS.includes(host)) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path === '/health' || req.path.startsWith('/webhooks/')) return next();
  return res.redirect(301, `${CANONICAL}${req.originalUrl}`);
}

module.exports = { CANONICAL, LEGACY_HOSTS, baseUrl, legacyRedirect };
