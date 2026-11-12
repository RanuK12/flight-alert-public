'use strict';

/**
 * Telegram Stars payment recovery service.
 * Ensures idempotent atomic claim on telegram_payment_charge_id, stale lock takeover,
 * orphan StarCharge recovery without age cutoffs, and exponential-backoff StarRefund /
 * StarCredit retry queues (max 5 attempts) with ADMIN_CHAT_ID escalation.
 */

const crypto = require('crypto');
const { col } = require('../../database');
const clock = require('../../utils/clock');
const art = require('../../utils/art');
const entitlements = require('../entitlements');
const funnel = require('../funnel');
const { notifyCharge } = require('./notify');
const logger = require('../../utils/logger').child('stars-recovery');

const STALE_LOCK_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_HOURS = [1, 2, 4, 8, 16];

function backoffMs(attempts) {
  const idx = Math.min(Math.max(0, Number(attempts) || 0), BACKOFF_HOURS.length - 1);
  return BACKOFF_HOURS[idx] * art.HOUR_MS;
}

function adminTargetId() {
  const explicit = String(process.env.ADMIN_CHAT_ID || '').trim();
  if (explicit) return explicit;
  const list = String(process.env.ADMIN_TELEGRAM_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list[0] || '';
}

async function notifyAdmin(bot, text) {
  const target = adminTargetId();
  if (!target || !bot || typeof bot.sendMessage !== 'function') return false;
  try {
    await bot.sendMessage(target, text);
    return true;
  } catch (err) {
    logger.warn('admin_notify_failed', { error: err && err.message });
    return false;
  }
}

/**
 * Atomically claims a telegram_payment_charge_id for fulfillment.
 * Concurrent calls either see 'already_fulfilled', 'already_refunded', 'in_flight', or 'claimed'.
 */
async function claim({ chargeId, userId, chatId = null, payload = null, origin = null, totalAmount = null, currency = 'XTR' }) {
  const cid = String(chargeId || '');
  if (!cid) throw new Error('chargeId required');
  const now = clock.now();
  const lockId = crypto.randomBytes(8).toString('hex');

  try {
    const row = await col('StarCharge').create({
      chargeId: cid,
      telegramUserId: String(userId),
      chatId: chatId ? String(chatId) : null,
      payload: payload ? String(payload) : null,
      origin: origin || null,
      totalAmount: totalAmount != null ? Number(totalAmount) : null,
      currency: currency || 'XTR',
      work: 'open',
      outcome: null,
      lockedAt: now,
      lockId,
      claimedAt: now,
    });
    return { status: 'claimed', lockId, recovered: false, row };
  } catch (err) {
    if (!err || err.code !== 11000) throw err;
  }

  const existing = await col('StarCharge').findOne({ chargeId: cid });
  if (!existing) return { status: 'in_flight' };
  if (existing.work === 'done') {
    if (existing.outcome === 'refund' || existing.outcome === 'pending_refund') {
      return { status: 'already_refunded', row: existing };
    }
    return { status: 'already_fulfilled', row: existing };
  }

  const lockedAtMs = existing.lockedAt ? new Date(existing.lockedAt).getTime() : 0;
  if (lockedAtMs && (now.getTime() - lockedAtMs) < STALE_LOCK_MS) {
    return { status: 'in_flight', row: existing };
  }

  const nextLock = crypto.randomBytes(8).toString('hex');
  const filter = existing.lockId
    ? { chargeId: cid, work: 'open', lockId: existing.lockId }
    : { chargeId: cid, work: 'open', lockId: null };
  const acquired = await col('StarCharge').findOneAndUpdate(
    filter,
    { $set: { lockedAt: now, lockId: nextLock } },
    { new: true },
  );
  if (!acquired) return { status: 'in_flight' };
  return { status: 'claimed', lockId: nextLock, recovered: true, row: acquired };
}

async function markFulfilled(chargeId, lockId) {
  const filter = { chargeId: String(chargeId) };
  if (lockId) filter.lockId = lockId;
  await col('StarCharge').updateOne(filter, {
    $set: { work: 'done', outcome: 'credit', lockedAt: null, lockId: null },
  });
}

async function fulfillCharge(bot, charge, { lockId = null, skipNotifyCharge = false } = {}) {
  const chargeId = String(charge.chargeId);
  const userId = String(charge.telegramUserId);
  const chatId = charge.chatId ? String(charge.chatId) : userId;

  const result = await entitlements.activatePro(
    userId,
    'stars',
    chargeId,
    entitlements.proUntilFromNow(),
    { source: 'stars' },
  );

  if (charge.payload) {
    await col('StarInvoice').updateOne(
      { payload: String(charge.payload), usedAt: null },
      { $set: { usedAt: clock.now().toISOString() } },
    );
  }
  await col('Entitlement').updateOne(
    { telegramUserId: userId },
    { $set: { telegramChatId: chatId, priceCurrency: 'XTR' } },
  );

  if (!result.duplicate) {
    await funnel.record({
      event: 'pro_paid',
      userId,
      method: 'stars',
      interval: 'monthly',
      origin: charge.origin || null,
      subscriptionId: chargeId,
    });
    if (!skipNotifyCharge) {
      await notifyCharge({
        provider: 'stars',
        amount: charge.totalAmount || 250,
        currency: charge.currency || 'XTR',
      });
    }
  }

  await markFulfilled(chargeId, lockId);
  const entDoc = await col('Entitlement').findOne({ telegramUserId: userId }).lean();
  return {
    ok: true,
    duplicate: Boolean(result.duplicate),
    proUntil: result.proUntil || (entDoc && entDoc.proUntil) || null,
  };
}

async function enqueueCredit(bot, charge, errMsg, { notifyUser = true } = {}) {
  const now = clock.now();
  const chargeId = String(charge.chargeId);
  const userId = String(charge.telegramUserId);
  const chatId = charge.chatId ? String(charge.chatId) : userId;

  await col('StarCredit').updateOne(
    { chargeId },
    {
      $setOnInsert: {
        chargeId,
        telegramUserId: userId,
        chatId,
        origin: charge.origin || null,
        totalAmount: charge.totalAmount ?? null,
        currency: charge.currency || 'XTR',
        status: 'pending',
        attempts: 0,
      },
      $set: {
        lastError: errMsg ? String(errMsg).slice(0, 400) : null,
        nextAttemptAt: new Date(now.getTime() + backoffMs(0)),
        ...(notifyUser ? { userNotifiedAt: now } : {}),
      },
    },
    { upsert: true },
  );

  await col('StarCharge').updateOne(
    { chargeId },
    { $set: { work: 'done', outcome: 'pending_credit', lockedAt: null, lockId: null } },
  );

  return { ok: false, creditPending: true };
}

async function attemptRefundOrQueue(bot, charge, reason) {
  const now = clock.now();
  const chargeId = String(charge.chargeId);
  const userId = String(charge.telegramUserId);
  const chatId = charge.chatId ? String(charge.chatId) : userId;

  if (bot && typeof bot.refundStarPayment === 'function') {
    try {
      await bot.refundStarPayment(Number(userId) || userId, chargeId);
      await col('StarRefund').updateOne(
        { chargeId },
        {
          $setOnInsert: { chargeId, telegramUserId: userId, chatId, reason: reason || 'activation_failed', attempts: 1 },
          $set: { status: 'done', lastError: null },
        },
        { upsert: true },
      );
      await col('StarCharge').updateOne(
        { chargeId },
        { $set: { work: 'done', outcome: 'refund', lockedAt: null, lockId: null } },
      );
      return { refunded: true, refundPending: false };
    } catch (err) {
      const errMsg = (err && err.message) || 'refund_failed';
      await col('StarRefund').updateOne(
        { chargeId },
        {
          $setOnInsert: { chargeId, telegramUserId: userId, chatId, reason: reason || 'activation_failed', status: 'pending', attempts: 1 },
          $set: { lastError: String(errMsg).slice(0, 400), nextAttemptAt: new Date(now.getTime() + backoffMs(1)) },
        },
        { upsert: true },
      );
      await col('StarCharge').updateOne(
        { chargeId },
        { $set: { work: 'done', outcome: 'pending_refund', lockedAt: null, lockId: null } },
      );
      return { refunded: false, refundPending: true };
    }
  }

  await col('StarRefund').updateOne(
    { chargeId },
    {
      $setOnInsert: { chargeId, telegramUserId: userId, chatId, reason: reason || 'activation_failed', status: 'pending', attempts: 0 },
      $set: { lastError: 'refund_api_unavailable', nextAttemptAt: new Date(now.getTime() + backoffMs(0)) },
    },
    { upsert: true },
  );
  await col('StarCharge').updateOne(
    { chargeId },
    { $set: { work: 'done', outcome: 'pending_refund', lockedAt: null, lockId: null } },
  );
  return { refunded: false, refundPending: true };
}

/**
 * Hourly recovery sweep:
 * 1) Open StarCharge rows (sorted ascending by claimedAt, no age cutoff) whose lock expired.
 * 2) Pending StarRefund queue up to MAX_ATTEMPTS -> escalate to StarCredit & notify admin.
 * 3) Pending StarCredit queue up to MAX_ATTEMPTS -> exhaust & notify admin.
 */
async function sweep(bot) {
  const now = clock.now();
  const stats = { orphansRecovered: 0, refundsDone: 0, refundsExhausted: 0, creditsDone: 0, creditsExhausted: 0 };

  const openQuery = col('StarCharge').find({ work: 'open' });
  const openRows = typeof openQuery.sort === 'function'
    ? await openQuery.sort({ claimedAt: 1 }).lean()
    : (await openQuery.lean()).sort((a, b) => new Date(a.claimedAt || 0).getTime() - new Date(b.claimedAt || 0).getTime());

  for (const c of openRows) {
    const lockedAtMs = c.lockedAt ? new Date(c.lockedAt).getTime() : 0;
    if (lockedAtMs && (now.getTime() - lockedAtMs) < STALE_LOCK_MS) continue;
    const nextLock = crypto.randomBytes(8).toString('hex');
    const filter = c.lockId
      ? { chargeId: c.chargeId, work: 'open', lockId: c.lockId }
      : { chargeId: c.chargeId, work: 'open', lockId: null };
    const acquired = await col('StarCharge').findOneAndUpdate(
      filter,
      { $set: { lockedAt: now, lockId: nextLock } },
      { new: true },
    );
    if (!acquired) continue;

    try {
      const existingPay = await col('Payment').findOne({ provider: 'stars', ref: c.chargeId });
      if (existingPay) {
        await markFulfilled(c.chargeId, nextLock);
      } else {
        await fulfillCharge(bot, c, { lockId: nextLock });
      }
      stats.orphansRecovered += 1;
    } catch (err) {
      await enqueueCredit(bot, c, err && err.message, { notifyUser: false });
    }
  }

  const refunds = await col('StarRefund').find({ status: 'pending' }).lean();
  for (const r of refunds) {
    if (r.nextAttemptAt && new Date(r.nextAttemptAt).getTime() > now.getTime()) continue;
    if (bot && typeof bot.refundStarPayment === 'function') {
      try {
        await bot.refundStarPayment(Number(r.telegramUserId) || r.telegramUserId, String(r.chargeId));
        await col('StarRefund').updateOne({ _id: r._id }, { $set: { status: 'done', lastError: null } });
        await col('StarCharge').updateOne({ chargeId: r.chargeId }, { $set: { work: 'done', outcome: 'refund' } });
        stats.refundsDone += 1;
        continue;
      } catch (err) {
        const nextAttempts = Number(r.attempts || 0) + 1;
        const errMsg = (err && err.message) || 'refund_retry_failed';
        if (nextAttempts >= MAX_ATTEMPTS) {
          const notified = await notifyAdmin(bot, `StarRefund exhausted after ${nextAttempts} attempts for user ${r.telegramUserId}, charge ${r.chargeId}: ${errMsg}`);
          await col('StarRefund').updateOne(
            { _id: r._id },
            { $set: { status: 'exhausted', attempts: nextAttempts, lastError: String(errMsg).slice(0, 400), ...(notified ? { notifiedAdminAt: now } : {}) } },
          );
          await enqueueCredit(bot, r, errMsg, { notifyUser: false });
          stats.refundsExhausted += 1;
        } else {
          await col('StarRefund').updateOne(
            { _id: r._id },
            { $set: { attempts: nextAttempts, lastError: String(errMsg).slice(0, 400), nextAttemptAt: new Date(now.getTime() + backoffMs(nextAttempts)) } },
          );
        }
      }
    }
  }

  const credits = await col('StarCredit').find({ status: 'pending' }).lean();
  for (const cr of credits) {
    if (cr.nextAttemptAt && new Date(cr.nextAttemptAt).getTime() > now.getTime()) continue;
    try {
      await fulfillCharge(bot, cr, { skipNotifyCharge: true });
      await col('StarCredit').updateOne({ _id: cr._id }, { $set: { status: 'done', lastError: null } });
      stats.creditsDone += 1;
    } catch (err) {
      const nextAttempts = Number(cr.attempts || 0) + 1;
      const errMsg = (err && err.message) || 'credit_retry_failed';
      if (nextAttempts >= MAX_ATTEMPTS) {
        const notified = await notifyAdmin(bot, `StarCredit exhausted after ${nextAttempts} attempts for user ${cr.telegramUserId}, charge ${cr.chargeId}: ${errMsg}`);
        await col('StarCredit').updateOne(
          { _id: cr._id },
          { $set: { status: 'exhausted', attempts: nextAttempts, lastError: String(errMsg).slice(0, 400), ...(notified ? { notifiedAdminAt: now } : {}) } },
        );
        stats.creditsExhausted += 1;
      } else {
        await col('StarCredit').updateOne(
          { _id: cr._id },
          { $set: { attempts: nextAttempts, lastError: String(errMsg).slice(0, 400), nextAttemptAt: new Date(now.getTime() + backoffMs(nextAttempts)) } },
        );
      }
    }
  }

  return stats;
}

module.exports = {
  STALE_LOCK_MS,
  MAX_ATTEMPTS,
  claim,
  markFulfilled,
  fulfillCharge,
  enqueueCredit,
  attemptRefundOrQueue,
  sweep,
  notifyAdmin,
};
