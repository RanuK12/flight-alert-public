'use strict';

const crypto = require('crypto');

/**
 * Cómo recibe updates el bot.
 * - webhook: TELEGRAM_WEBHOOK_SECRET + PUBLIC_BASE_URL presentes. Una sola URL recibe los
 *   updates, así dos instancias durante un deploy no se pisan (409).
 * - polling: solo fuera de producción (local). TELEGRAM_POLLING=false lo apaga.
 * - En producción sin secreto o sin PUBLIC_BASE_URL: error al arrancar, nunca polling.
 */
const WEBHOOK_PATH = '/webhooks/telegram';
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

function isProd(env) {
  return env.NODE_ENV === 'production';
}

function mode(env = process.env) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && env.PUBLIC_BASE_URL) return 'webhook';
  if (isProd(env)) return 'misconfigured';
  return String(env.TELEGRAM_POLLING || 'true').toLowerCase() === 'false' ? 'off' : 'polling';
}

/** Producción: falla fuerte si falta config del webhook. Nunca cae a polling. */
function assertConfig(env = process.env) {
  if (!isProd(env)) return;
  const missing = [];
  if (!env.PUBLIC_BASE_URL) missing.push('PUBLIC_BASE_URL');
  if (!env.TELEGRAM_WEBHOOK_SECRET) missing.push('TELEGRAM_WEBHOOK_SECRET');
  else if (!validSecret(env.TELEGRAM_WEBHOOK_SECRET)) missing.push('TELEGRAM_WEBHOOK_SECRET (formato)');
  if (missing.length) throw new Error(`Telegram en producción necesita webhook; falta: ${missing.join(', ')}. Polling es solo para desarrollo.`);
  if (!/^https:\/\//.test(env.PUBLIC_BASE_URL)) throw new Error('PUBLIC_BASE_URL debe ser https en producción');
}

/** Saca el token de cualquier texto (URLs /bot<token>/, el token suelto o con formato de token). */
function redactToken(text, token = process.env.TELEGRAM_BOT_TOKEN) {
  let out = String(text == null ? '' : text);
  if (token) out = out.split(token).join('[token]');
  return out.replace(/\d{6,}:[A-Za-z0-9_-]{25,}/g, '[token]').replace(/\/bot[^/\s"]+\//g, '/bot[token]/');
}

function safeError(err, token) {
  if (!err) return { message: 'error' };
  const out = { message: redactToken(err.message || String(err), token) };
  if (err.code) out.code = String(err.code);
  const desc = err.response && err.response.body && err.response.body.description;
  if (desc) out.description = redactToken(desc, token);
  return out;
}

// Idempotencia por update_id: Mongo (índice único + TTL 24 h) o memoria en local/tests.
const memSeen = new Map();
async function firstTime(updateId, { now = Date.now() } = {}) {
  if (process.env.MONGODB_URI) {
    const Model = require('../database/models/TelegramUpdate');
    try {
      await Model.create({ updateId, createdAt: new Date(now) });
      return true;
    } catch (err) {
      if (err && err.code === 11000) return false;
      throw err;
    }
  }
  for (const [id, at] of memSeen) if (now - at > DEDUPE_TTL_MS) memSeen.delete(id);
  if (memSeen.has(updateId)) return false;
  memSeen.set(updateId, now);
  return true;
}
function resetDedupe() { memSeen.clear(); }

function webhookUrl(env = process.env) {
  return `${String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')}${WEBHOOK_PATH}`;
}

// Telegram acepta A-Z a-z 0-9 _ - y hasta 256 caracteres.
function validSecret(secret) {
  return typeof secret === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(secret);
}

function secretMatches(header, secret) {
  if (typeof header !== 'string' || !validSecret(secret)) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function registerWebhook(bot, env = process.env, { attempts = 5, baseMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!validSecret(secret)) throw new Error('TELEGRAM_WEBHOOK_SECRET inválido (16-256, A-Z a-z 0-9 _ -)');
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await bot.setWebHook(webhookUrl(env), {
        secret_token: secret,
        allowed_updates: JSON.stringify(['message', 'callback_query', 'pre_checkout_query']),
      });
    } catch (err) {
      last = err;
      if (i < attempts - 1) await sleep(baseMs * 2 ** i);
    }
  }
  const e = new Error(safeError(last, env.TELEGRAM_BOT_TOKEN).message);
  e.attempts = attempts;
  throw e;
}

// Estado del webhook para /health: url sin query y último error; nunca el token ni el secreto.
let info = { checkedAt: null, url: null, pending: null, lastError: null, lastErrorAt: null, error: null };
async function refreshInfo(bot, { now = Date.now() } = {}) {
  try {
    const w = await bot.getWebHookInfo();
    info = {
      checkedAt: new Date(now).toISOString(),
      url: w && w.url ? redactToken(String(w.url).split('?')[0]) : null,
      pending: w ? w.pending_update_count || 0 : null,
      lastError: w && w.last_error_message ? redactToken(w.last_error_message) : null,
      lastErrorAt: w && w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null,
      error: null,
    };
  } catch (err) {
    info = { ...info, checkedAt: new Date(now).toISOString(), error: safeError(err).message };
  }
  return info;
}
function webhookInfo() { return { ...info }; }

/** Handler Express: valida el header y entrega el update al bot. Nunca loguea el secreto. */
function webhookHandler(getBot, env = process.env) {
  return async (req, res) => {
    if (mode(env) !== 'webhook') return res.status(404).end();
    if (!secretMatches(req.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) {
      return res.status(401).end();
    }
    const bot = getBot();
    if (!bot || !req.body || typeof req.body.update_id !== 'number') return res.status(400).end();
    let fresh = true;
    try { fresh = await firstTime(req.body.update_id); } catch { fresh = true; /* sin dedupe antes que perder el update */ }
    if (!fresh) return res.status(200).json({ ok: true, duplicate: true });
    try { bot.processUpdate(req.body); } catch { /* el handler loguea */ }
    return res.status(200).json({ ok: true });
  };
}

module.exports = {
  WEBHOOK_PATH, mode, assertConfig, webhookUrl, validSecret, secretMatches, registerWebhook, webhookHandler,
  firstTime, resetDedupe, redactToken, safeError, refreshInfo, webhookInfo, DEDUPE_TTL_MS,
};
