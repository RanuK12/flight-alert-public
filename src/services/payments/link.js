'use strict';

const crypto = require('crypto');
const { col } = require('../../database');
const clock = require('../../utils/clock');
const { sha256 } = require('../../utils/mask');
const entitlements = require('../entitlements');

const TTL_MS = 15 * 60 * 1000;

async function createLink(webUserKey) {
  const code = crypto.randomBytes(9).toString('hex');
  const expiresAt = new Date(clock.now().getTime() + TTL_MS).toISOString();
  await col('LinkCode').create({
    hash: sha256(code),
    webUserKey: String(webUserKey),
    expiresAt,
    usedAt: null,
  });
  const bot = process.env.TELEGRAM_BOT_USERNAME || '';
  const url = bot ? `https://t.me/${bot}?start=link_${code}` : '';
  return { url, expiresAt, code };
}

async function claimPending(webUserKey, telegramUserId) {
  const checkouts = await col('Checkout').find({
    webUserKey: String(webUserKey),
    telegramUserId: null,
  }).lean();
  await col('Checkout').updateMany(
    { webUserKey: String(webUserKey), telegramUserId: null },
    { $set: { telegramUserId: String(telegramUserId) } },
  );
  for (const checkout of checkouts) {
    const pays = await col('Payment').find({
      externalReference: checkout.externalReference,
      status: 'pending_link',
    }).lean();
    for (const pay of pays) {
      await entitlements.activatePro(
        telegramUserId,
        pay.provider,
        pay.ref,
        entitlements.proUntilFromNow(),
      );
      const patch = {};
      if (checkout.currency) patch.priceCurrency = checkout.currency;
      if (checkout.currency === 'ARS') patch.country = 'AR';
      if (Object.keys(patch).length) {
        await col('Entitlement').updateOne(
          { telegramUserId: String(telegramUserId) },
          { $set: patch },
        );
      }
    }
  }
}

async function consume(code, telegramUserId, telegramChatId) {
  const row = await col('LinkCode').findOne({ hash: sha256(code) });
  if (!row) return { ok: false, reason: 'no' };
  if (row.usedAt) return { ok: false, reason: 'usado' };
  if (new Date(row.expiresAt).getTime() <= clock.now().getTime()) return { ok: false, reason: 'vencido' };
  await col('LinkCode').updateOne(
    { hash: row.hash },
    { $set: { usedAt: clock.now().toISOString(), telegramUserId: String(telegramUserId) } },
  );
  await claimPending(row.webUserKey, telegramUserId);
  await col('Entitlement').updateOne(
    { telegramUserId: String(telegramUserId) },
    { $setOnInsert: { telegramUserId: String(telegramUserId), plan: 'free', searchesUsed: 0 }, $set: { telegramChatId: String(telegramChatId) } },
    { upsert: true },
  );
  return { ok: true };
}

async function newReference(provider, extra) {
  const externalReference = crypto.randomBytes(12).toString('hex');
  await col('Checkout').create({
    externalReference,
    provider,
    telegramUserId: extra.telegramUserId ? String(extra.telegramUserId) : null,
    webUserKey: extra.webUserKey || null,
    amount: extra.amount || null,
    currency: extra.currency || null,
  });
  return externalReference;
}

module.exports = { createLink, consume, newReference, TTL_MS };
