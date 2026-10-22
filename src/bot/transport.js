'use strict';

const crypto = require('crypto');

/**
 * Cómo recibe updates el bot.
 * - webhook: TELEGRAM_WEBHOOK_SECRET + PUBLIC_BASE_URL presentes (producción). Una sola
 *   URL recibe los updates, así dos instancias durante un deploy no se pisan (409).
 * - polling: sin secreto (local). TELEGRAM_POLLING=false lo apaga.
 */
const WEBHOOK_PATH = '/webhooks/telegram';

function mode(env = process.env) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && env.PUBLIC_BASE_URL) return 'webhook';
  return String(env.TELEGRAM_POLLING || 'true').toLowerCase() === 'false' ? 'off' : 'polling';
}

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

async function registerWebhook(bot, env = process.env) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!validSecret(secret)) throw new Error('TELEGRAM_WEBHOOK_SECRET inválido (16-256, A-Z a-z 0-9 _ -)');
  return bot.setWebHook(webhookUrl(env), {
    secret_token: secret,
    allowed_updates: JSON.stringify(['message', 'callback_query', 'pre_checkout_query']),
  });
}

/** Handler Express: valida el header y entrega el update al bot. Nunca loguea el secreto. */
function webhookHandler(getBot, env = process.env) {
  return (req, res) => {
    if (mode(env) !== 'webhook') return res.status(404).end();
    if (!secretMatches(req.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) {
      return res.status(401).end();
    }
    const bot = getBot();
    if (!bot || !req.body || typeof req.body.update_id !== 'number') return res.status(400).end();
    try { bot.processUpdate(req.body); } catch { /* el handler loguea */ }
    return res.status(200).json({ ok: true });
  };
}

module.exports = { WEBHOOK_PATH, mode, webhookUrl, validSecret, secretMatches, registerWebhook, webhookHandler };
