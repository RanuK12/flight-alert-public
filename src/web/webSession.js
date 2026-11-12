'use strict';

/**
 * Token de sesión corto y firmado para el botón "Pagar en la web" del bot.
 * payload = base64url({ u: telegramUserId, exp: ms, n: nonce }), firma = HMAC-SHA256 (clave separada por dominio).
 * Sin datos personales: solo el id de Telegram. Dura 15 min (WEB_SESSION_TTL_MIN).
 */

const crypto = require('crypto');
const clock = require('../utils/clock');
const { secret } = require('./device');
const funnel = require('../services/funnel');

const COOKIE = 'fa_s';
const ttlMs = () => {
  const n = Number(process.env.WEB_SESSION_TTL_MIN);
  return (Number.isFinite(n) && n > 0 && n <= 60 ? n : 15) * 60 * 1000;
};
const mac = (v) => crypto.createHmac('sha256', `web-session:${secret()}`).update(v).digest('base64url');

function sign(telegramUserId, opts = {}) {
  const origin = funnel.sanitizeOrigin(opts && opts.origin);
  const body = Buffer.from(JSON.stringify({
    u: String(telegramUserId),
    ...(origin ? { o: origin } : {}),
    exp: clock.now().getTime() + ttlMs(),
    n: crypto.randomBytes(6).toString('hex'),
  })).toString('base64url');
  return `${body}.${mac(body)}`;
}

/** Parses and validates session token, returning { userId, origin } or null. */
function verifySession(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || !/^\d{1,20}$/.test(String(p.u)) || !(Number(p.exp) > clock.now().getTime())) return null;
  return { userId: String(p.u), origin: funnel.sanitizeOrigin(p.o) };
}

/** Devuelve el id de Telegram si el token es válido y no venció; si no, null. */
function verify(token) {
  const s = verifySession(token);
  return s ? s.userId : null;
}

function readCookie(req) {
  const hit = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : '';
}

function setCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/pro; Max-Age=${Math.floor(ttlMs() / 1000)}${secure}`);
}

/** Id de Telegram de la sesión web (cookie), o null. */
function fromRequest(req) {
  return verify(readCookie(req));
}

function sessionFromRequest(req) {
  return verifySession(readCookie(req));
}

module.exports = { sign, verify, verifySession, fromRequest, sessionFromRequest, setCookie, COOKIE };
