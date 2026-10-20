'use strict';

const crypto = require('crypto');
const flags = require('../../config/flags');
const { col } = require('../../database');
const clock = require('../../utils/clock');
const entitlements = require('../entitlements');
const copy = require('../../bot/copy');

const STARS_TOTAL = 250;

let ephemeral = '';

function payloadSecret() {
  if (process.env.STARS_PAYLOAD_SECRET) return process.env.STARS_PAYLOAD_SECRET;
  if (!ephemeral) ephemeral = crypto.randomBytes(16).toString('hex');
  return ephemeral;
}

function sign(userId, nonce) {
  return crypto.createHmac('sha256', payloadSecret()).update(`${userId}:${nonce}`).digest('hex').slice(0, 32);
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function payloadOk(userId, payload) {
  const raw = String(payload || '');
  const dot = raw.indexOf('.');
  if (dot <= 0) return false;
  const nonce = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  return timingSafeEqual(sign(userId, nonce), mac);
}

async function issuePayload(userId) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${nonce}.${sign(userId, nonce)}`;
  await col('StarInvoice').create({
    payload,
    telegramUserId: String(userId),
    total: STARS_TOTAL,
    currency: 'XTR',
    usedAt: null,
  });
  return payload;
}

async function checkStar(userId, pay, { requireCharge } = { requireCharge: true }) {
  if (!pay || pay.currency !== 'XTR') return { ok: false, reason: 'currency' };
  if (Number(pay.total_amount) !== STARS_TOTAL) return { ok: false, reason: 'total' };
  if (requireCharge && !pay.telegram_payment_charge_id) return { ok: false, reason: 'charge' };
  if (!payloadOk(userId, pay.invoice_payload)) return { ok: false, reason: 'firma' };
  const row = await col('StarInvoice').findOne({ payload: String(pay.invoice_payload) });
  if (!row || String(row.telegramUserId) !== String(userId)) return { ok: false, reason: 'payload' };
  if (row.currency !== 'XTR' || Number(row.total) !== STARS_TOTAL) return { ok: false, reason: 'guardado' };
  if (row.usedAt) {
    if (!requireCharge) return { ok: false, reason: 'usado' };
    const seen = await col('Payment').findOne({
      provider: 'stars',
      ref: String(pay.telegram_payment_charge_id),
    });
    if (seen && String(seen.telegramUserId) === String(userId)) return { ok: true, replay: true };
    return { ok: false, reason: 'usado' };
  }
  return { ok: true };
}

async function validatePreCheckout(query) {
  const userId = query && query.from && query.from.id;
  return checkStar(userId, {
    currency: query && query.currency,
    total_amount: query && query.total_amount,
    invoice_payload: query && query.invoice_payload,
  }, { requireCharge: false });
}

async function sendInvoice(bot, chatId, userId) {
  if (!flags.stars()) {
    await bot.sendMessage(chatId, copy.starsOff);
    return;
  }
  const payload = await issuePayload(userId);
  const link = await bot.createInvoiceLink(
    'Vuelos Pro',
    '30 días de búsquedas, alertas e informe diario.',
    payload,
    '',
    'XTR',
    [{ label: 'Pro 30 días', amount: STARS_TOTAL }],
    { subscription_period: 2592000 },
  );
  await bot.sendMessage(chatId, `Pro por 30 días: 250 estrellas.\n${link}`);
}

async function onSuccess(msg) {
  const pay = msg.successful_payment;
  const userId = msg.from && msg.from.id;
  const verdict = await checkStar(userId, pay, { requireCharge: true });
  if (!verdict.ok) return verdict;
  const result = await entitlements.activatePro(
    userId,
    'stars',
    String(pay.telegram_payment_charge_id),
    entitlements.proUntilFromNow(),
  );
  if (!result.duplicate) {
    await col('StarInvoice').updateOne(
      { payload: String(pay.invoice_payload) },
      { $set: { usedAt: clock.now().toISOString() } },
    );
    await col('Entitlement').updateOne(
      { telegramUserId: String(userId) },
      { $set: { telegramChatId: String(msg.chat.id), priceCurrency: 'XTR' } },
    );
  }
  return result;
}

module.exports = { sendInvoice, onSuccess, issuePayload, validatePreCheckout, STARS_TOTAL };
