'use strict';

/**
 * Cloudflare Web Analytics (gratis, sin cookies). flightalert.ranuk.dev es DNS-only (no pasa por el
 * proxy de Cloudflare), así que el beacon va como JS snippet. El token es público por diseño.
 * Se inyecta antes de </body> solo en HTML público (no /admin ni /app, que tiene su propia CSP).
 * CF_BEACON_TOKEN vacío ("off") lo apaga.
 */

const DEFAULT_TOKEN = '7ab60ca7655747c397573e033583aa12';

function token() {
  const raw = process.env.CF_BEACON_TOKEN;
  if (raw === undefined) return DEFAULT_TOKEN;
  const t = String(raw).trim();
  return /^[a-f0-9]{32}$/.test(t) ? t : '';
}

function snippet(tok) {
  return `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${tok}"}'></script>`;
}

function inject(html, tok) {
  if (!tok || typeof html !== 'string' || !html.includes('</body>') || html.includes('cloudflareinsights')) return html;
  const i = html.lastIndexOf('</body>');
  return html.slice(0, i) + snippet(tok) + html.slice(i);
}

function middleware(req, res, next) {
  if (req.method !== 'GET' || req.path.startsWith('/admin') || req.path === '/app' || req.path.startsWith('/app/')) return next();
  const send = res.send;
  res.send = function sendWithBeacon(body) {
    try {
      const type = String(res.get('Content-Type') || '');
      if (typeof body === 'string' && (type.includes('text/html') || (!type && /^\s*<!doctype html/i.test(body)))) {
        body = inject(body, token());
      }
    } catch (_err) { /* nunca romper la respuesta */ }
    return send.call(this, body);
  };
  return next();
}

module.exports = { middleware, inject, snippet, token, DEFAULT_TOKEN };
