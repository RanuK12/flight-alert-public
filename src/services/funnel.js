'use strict';

/**
 * Funnel metrics with privacy-preserving HMAC-SHA256 user hashing (FUNNEL_HMAC_SALT).
 * One-time events ('trial_start', 'first_cheap_alert') and subscription-unique
 * 'pro_paid' ignore duplicate key E11000 errors safely and never fail user flows.
 */

const crypto = require('crypto');
const { col } = require('../database');
const clock = require('../utils/clock');
const logger = require('../utils/logger').child('funnel');

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGIN_RE = /^[a-z0-9_]{1,32}$/;

function salt() {
  return String(process.env.FUNNEL_HMAC_SALT || process.env.DEVICE_COOKIE_SECRET || 'fa-funnel-default-salt');
}

function hmacUser(userId) {
  return crypto.createHmac('sha256', salt()).update(String(userId)).digest('hex');
}

function validSessionId(v) {
  const s = String(v || '').trim();
  return UUID_V4_RE.test(s) ? s.toLowerCase() : null;
}

function sanitizeOrigin(v) {
  const s = String(v || '').trim().toLowerCase();
  return ORIGIN_RE.test(s) ? s : null;
}

async function record({
  event,
  userId,
  plan = null,
  outcome = null,
  sessionId = null,
  origin = null,
  method = null,
  interval = null,
  subscriptionId = null,
} = {}) {
  if (!event || userId === undefined || userId === null) return null;
  try {
    const doc = {
      event,
      userHash: hmacUser(userId),
      plan: plan || null,
      outcome: outcome || null,
      sessionId: validSessionId(sessionId),
      origin: sanitizeOrigin(origin),
      method: method || null,
      interval: interval || null,
      subscriptionId: subscriptionId ? String(subscriptionId) : null,
      at: clock.now().toISOString(),
    };
    return await col('FunnelEvent').create(doc);
  } catch (err) {
    if (err && err.code === 11000) return { duplicate: true };
    logger.warn('funnel record failed', { event, error: err && err.message });
    return null;
  }
}

/** Strict lookup for the user's most recent sent instant alert (status === 'sent'). */
async function lastCheapAlert(userId) {
  if (userId === undefined || userId === null) return null;
  const q = col('Notification').find({
    telegramUserId: String(userId),
    kind: 'instant',
    status: 'sent',
  });
  const rows = typeof q.sort === 'function'
    ? await q.sort({ sentAtIso: -1, sentAt: -1 }).limit(1).lean()
    : (await q.lean())
      .filter((r) => r.status === 'sent')
      .sort((a, b) => String(b.sentAtIso || b.sentAt || '').localeCompare(String(a.sentAtIso || a.sentAt || '')));
  return rows[0] || null;
}

module.exports = {
  UUID_V4_RE,
  ORIGIN_RE,
  hmacUser,
  validSessionId,
  sanitizeOrigin,
  record,
  lastCheapAlert,
};
