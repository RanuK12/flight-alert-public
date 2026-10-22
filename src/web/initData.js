'use strict';

const crypto = require('crypto');

const MAX_AGE_S = 3600;

/**
 * Valida initData de Telegram WebApp (spec v2): secret = HMAC_SHA256("WebAppData", token),
 * hash = HMAC_SHA256(secret, data_check_string). Rechaza auth_date de más de 1 h.
 * Devuelve { ok, user } o { ok:false, reason }.
 */
function validate(initData, token, { now = Date.now(), maxAgeS = MAX_AGE_S } = {}) {
  if (!token || !initData || typeof initData !== 'string' || initData.length > 4096) return { ok: false, reason: 'missing' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return { ok: false, reason: 'hash' };
  params.delete('hash');
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== calc.length || !crypto.timingSafeEqual(given, calc)) return { ok: false, reason: 'signature' };
  const auth = Number(params.get('auth_date'));
  if (!Number.isFinite(auth) || now / 1000 - auth > maxAgeS || auth - now / 1000 > 300) return { ok: false, reason: 'expired' };
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch (_) { user = null; }
  if (!user || !Number.isSafeInteger(user.id)) return { ok: false, reason: 'user' };
  return { ok: true, user, authDate: auth };
}

/** Firma initData (solo para tests). */
function sign(fields, token) {
  const params = new URLSearchParams(fields);
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

module.exports = { validate, sign, MAX_AGE_S };
