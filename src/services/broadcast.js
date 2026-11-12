'use strict';

/**
 * Safe idempotent broadcast campaign sender (Phase 3):
 * - At-most-once delivery per (campaignKey, telegramUserId) backed by BroadcastSend unique index
 * - dryRun=true default (never sends or inserts blocking records unless dryRun=false)
 * - Rate-limited <= 25 msg/s
 * - Handles Telegram 429 retry_after (retries once) and 403 (marks User.blocked=true + status='blocked')
 */

const { col } = require('../database');
const clock = require('../utils/clock');
const miniapp = require('../bot/miniapp');
const logger = require('../utils/logger').child('broadcast');

const MAX_RATE_PER_SEC = 25;
const START_PARAM_RE = /^[a-z0-9_]{1,32}$/;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sanitizeStartParam(v) {
  const s = String(v || 'novedades').trim().toLowerCase();
  return START_PARAM_RE.test(s) ? s : 'novedades';
}

function parseAllowlist(optAllow) {
  if (Array.isArray(optAllow) && optAllow.length > 0) {
    return new Set(optAllow.map((x) => String(x).trim()).filter(Boolean));
  }
  const envRaw = String(process.env.BROADCAST_ALLOWLIST || '').trim();
  if (!envRaw) return null;
  const items = envRaw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? new Set(items) : null;
}

function extractRetryAfterSec(err) {
  if (!err) return null;
  const direct = err.parameters && Number(err.parameters.retry_after);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const resp = err.response && err.response.body && err.response.body.parameters && Number(err.response.body.parameters.retry_after);
  if (Number.isFinite(resp) && resp > 0) return resp;
  const status = (err.response && err.response.statusCode) || err.statusCode;
  if (status === 429) {
    const m = /retry after (\d+)/i.exec(String(err.message || ''));
    return m ? Number(m[1]) : 1;
  }
  return null;
}

function isBlockedError(err) {
  if (!err) return false;
  const status = (err.response && err.response.statusCode) || err.statusCode;
  if (status === 403) return true;
  return /bot was blocked by the user|user is deactivated|chat not found|have no rights to send/i.test(String(err.message || ''));
}

function buildReplyMarkup(buttonText, startParam, buttonUrl) {
  const link = buttonUrl || miniapp.directLink();
  if (!link) return undefined;
  const sep = link.includes('?') ? '&' : '?';
  const url = buttonUrl ? link : `${link}${sep}startapp=${encodeURIComponent(startParam)}`;
  return { inline_keyboard: [[{ text: buttonText || 'Ver novedades', url }]] };
}

async function sendCampaign(bot, {
  campaignKey,
  text,
  buttonText = 'Ver novedades',
  buttonUrl = null,
  startParam = 'novedades',
  dryRun = true,
  allowlist = null,
  maxPerSec = MAX_RATE_PER_SEC,
  sleep = defaultSleep,
} = {}) {
  const key = String(campaignKey || '').trim();
  const body = String(text || '').trim();
  if (!key || !/^[a-zA-Z0-9_.:-]{1,64}$/.test(key)) throw new Error('campaignKey inválido');
  if (!body) throw new Error('text requerido');
  if (!dryRun && (!bot || typeof bot.sendMessage !== 'function')) throw new Error('bot requerido para envío live');

  const cleanStart = sanitizeStartParam(startParam);
  const allowSet = parseAllowlist(allowlist);
  const rate = Math.min(MAX_RATE_PER_SEC, Math.max(1, Number(maxPerSec) || MAX_RATE_PER_SEC));
  const minIntervalMs = Math.ceil(1000 / rate);
  const replyMarkup = buildReplyMarkup(buttonText, cleanStart, buttonUrl);
  const extra = replyMarkup ? { reply_markup: replyMarkup } : {};

  const users = await col('User').find({}).lean();
  const seenInCampaign = await col('BroadcastSend').find({ campaignKey: key }).lean();
  const alreadyIds = new Set(
    seenInCampaign
      .filter((r) => r.status === 'sent' || r.status === 'blocked')
      .map((r) => String(r.telegramUserId)),
  );

  const summary = {
    campaignKey: key,
    dryRun: Boolean(dryRun),
    totalUsers: users.length,
    targeted: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
    skippedAlreadySent: 0,
    skippedBlocked: 0,
    skippedNotAllowlisted: 0,
    recipients: [],
  };

  let lastSentAt = 0;

  for (const u of users) {
    const uid = String(u.telegramUserId || '');
    const chatId = String(u.telegramChatId || u.telegramUserId || '');
    if (!uid || !chatId) continue;

    if (allowSet && !allowSet.has(uid)) {
      summary.skippedNotAllowlisted += 1;
      continue;
    }
    if (u.blocked === true) {
      summary.skippedBlocked += 1;
      continue;
    }
    if (alreadyIds.has(uid)) {
      summary.skippedAlreadySent += 1;
      continue;
    }

    summary.targeted += 1;
    if (dryRun) {
      summary.recipients.push({ telegramUserId: uid, telegramChatId: chatId, status: 'dry_run' });
      continue;
    }

    const nowMs = Date.now();
    const waitMs = lastSentAt ? Math.max(0, minIntervalMs - (nowMs - lastSentAt)) : 0;
    if (waitMs > 0) await sleep(waitMs);

    const nowIso = clock.now().toISOString();
    let claim;
    try {
      claim = await col('BroadcastSend').create({
        campaignKey: key,
        telegramUserId: uid,
        telegramChatId: chatId,
        status: 'sent',
        sentAt: nowIso,
      });
    } catch (err) {
      if (err && err.code === 11000) {
        summary.skippedAlreadySent += 1;
        summary.targeted -= 1;
        continue;
      }
      throw err;
    }

    lastSentAt = Date.now();
    try {
      await bot.sendMessage(chatId, body, extra);
      summary.sent += 1;
      summary.recipients.push({ telegramUserId: uid, status: 'sent' });
    } catch (err) {
      const retrySec = extractRetryAfterSec(err);
      if (retrySec !== null) {
        await sleep((retrySec + 0.05) * 1000);
        lastSentAt = Date.now();
        try {
          await bot.sendMessage(chatId, body, extra);
          summary.sent += 1;
          summary.recipients.push({ telegramUserId: uid, status: 'sent' });
          continue;
        } catch (retryErr) {
          err = retryErr;
        }
      }

      if (isBlockedError(err)) {
        summary.blocked += 1;
        await col('User').updateOne({ telegramUserId: uid }, { $set: { blocked: true } }).catch(() => {});
        await col('BroadcastSend').updateOne(
          { _id: claim._id },
          { $set: { status: 'blocked', error: String(err.message || '403').slice(0, 300) } },
        ).catch(() => {});
        summary.recipients.push({ telegramUserId: uid, status: 'blocked' });
        continue;
      }

      summary.failed += 1;
      await col('BroadcastSend').updateOne(
        { _id: claim._id },
        { $set: { status: 'failed', error: String((err && err.message) || err).slice(0, 300) } },
      ).catch(() => {});
      logger.warn('broadcast send failed', { campaignKey: key, telegramUserId: uid, error: err && err.message });
      summary.recipients.push({ telegramUserId: uid, status: 'failed' });
    }
  }

  return summary;
}

module.exports = {
  MAX_RATE_PER_SEC,
  sanitizeStartParam,
  sendCampaign,
};
