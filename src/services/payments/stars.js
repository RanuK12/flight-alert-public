'use strict';

const crypto = require('crypto');
const flags = require('../../config/flags');
const { col } = require('../../database');
const clock = require('../../utils/clock');
const entitlements = require('../entitlements');
const copy = require('../../bot/copy');
const starsRecovery = require('./starsRecovery');

const STARS_TOTAL = 250;

function assertSecret() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.STARS_PAYLOAD_SECRET) {
    throw new Error('STARS_PAYLOAD_SECRET missing');
  }
}

function assertStartupConfig() {
  assertSecret();
  if (flags.stars() && !String(process.env.SUPPORT_CONTACT || '').trim()) {
    throw new Error('SUPPORT_CONTACT required when FEATURE_PAYMENTS_STARS=on');
  }
}

function payloadSecret() {
  const secret = process.env.STARS_PAYLOAD_SECRET;
  if (!secret) throw new Error('STARS_PAYLOAD_SECRET missing');
  return secret;
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

async function issuePayload(userId, origin = null) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${nonce}.${sign(userId, nonce)}`;
  await col('StarInvoice').create({
    payload,
    telegramUserId: String(userId),
    total: STARS_TOTAL,
    currency: 'XTR',
    origin: origin || null,
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
    const chargeId = String(pay.telegram_payment_charge_id);
    const seen = await col('Payment').findOne({ provider: 'stars', ref: chargeId });
    if (seen && String(seen.telegramUserId) === String(userId)) return { ok: true, replay: true, origin: row.origin || null };
    if (pay.is_recurring && String(row.telegramUserId) === String(userId)) {
      return { ok: true, recurring: true, origin: row.origin || null };
    }
    return { ok: false, reason: 'usado' };
  }
  return { ok: true, origin: row.origin || null };
}

async function validatePreCheckout(query) {
  const userId = query && query.from && query.from.id;
  return checkStar(userId, {
    currency: query && query.currency,
    total_amount: query && query.total_amount,
    invoice_payload: query && query.invoice_payload,
  }, { requireCharge: false });
}

async function sendInvoice(bot, chatId, userId, { origin = null } = {}) {
  if (!flags.stars()) {
    await bot.sendMessage(chatId, copy.starsOff);
    return;
  }
  const userDoc = await col('User').findOne({ telegramUserId: String(userId) });
  const lang = (userDoc && ['es', 'en', 'pt'].includes(userDoc.lang) && userDoc.lang) || 'es';
  const proDays = entitlements.PRO_DAYS;
  const payload = await issuePayload(userId, origin);
  const desc = {
    en: `${proDays} days of unlimited searches, alerts without waiting for the summary, and the 21:00 ART digest.`,
    pt: `${proDays} dias de buscas sem limite, avisos sem esperar o resumo e relatório das 21:00.`,
    es: `${proDays} días de búsquedas sin límite, avisos sin esperar al resumen y el informe de las 21:00.`,
  }[lang];
  const label = {
    en: `Pro ${proDays} days`,
    pt: `Pro ${proDays} dias`,
    es: `Pro ${proDays} días`,
  }[lang];
  const link = await bot.createInvoiceLink(
    'Flight Alert Pro',
    desc,
    payload,
    '',
    'XTR',
    [{ label, amount: STARS_TOTAL }],
    { subscription_period: proDays * 86400 },
  );
  const msg = {
    en: `Pro for ${proDays} days: ${STARS_TOTAL} Telegram Stars (billed monthly).\n${link}\n${desc}`,
    pt: `Pro por ${proDays} dias: ${STARS_TOTAL} estrelas do Telegram (pagamento mensal).\n${link}\n${desc}`,
    es: `Pro por ${proDays} días: ${STARS_TOTAL} estrellas de Telegram (pago mensual).\n${link}\n${desc}`,
  }[lang];
  await bot.sendMessage(chatId, msg);
  return { ok: true, payload, origin };
}

async function onSuccess(msg, opts = {}) {
  const pay = msg.successful_payment;
  const userId = msg.from && msg.from.id;
  const bot = opts && opts.bot ? opts.bot : null;
  const verdict = await checkStar(userId, pay, { requireCharge: true });
  if (!verdict.ok) return verdict;

  const chargeId = String(pay.telegram_payment_charge_id);
  const chargeOrigin = (opts && opts.origin) || verdict.origin || null;
  const chargeMeta = {
    chargeId,
    userId,
    chatId: msg.chat && msg.chat.id ? String(msg.chat.id) : String(userId),
    payload: pay.invoice_payload,
    origin: chargeOrigin,
    totalAmount: pay.total_amount,
    currency: pay.currency,
  };
  const claimRes = await starsRecovery.claim(chargeMeta);
  if (claimRes.status === 'already_fulfilled') {
    const entDoc = await col('Entitlement').findOne({ telegramUserId: String(userId) }).lean();
    return { ok: true, duplicate: true, proUntil: (entDoc && entDoc.proUntil) || null };
  }
  if (claimRes.status === 'already_refunded') return { ok: false, refunded: true, reason: 'already_refunded' };
  if (claimRes.status === 'in_flight') return { ok: false, inFlight: true, reason: 'in_flight' };

  try {
    return await starsRecovery.fulfillCharge(bot, {
      chargeId,
      telegramUserId: String(userId),
      chatId: chargeMeta.chatId,
      payload: pay.invoice_payload,
      origin: chargeMeta.origin,
      totalAmount: pay.total_amount,
      currency: pay.currency,
    }, { lockId: claimRes.lockId });
  } catch (err) {
    const rec = await starsRecovery.attemptRefundOrQueue(bot, {
      chargeId,
      telegramUserId: String(userId),
      chatId: chargeMeta.chatId,
      payload: pay.invoice_payload,
      origin: chargeMeta.origin,
      totalAmount: pay.total_amount,
      currency: pay.currency,
    }, err && err.message);
    return {
      ok: false,
      refunded: Boolean(rec.refunded),
      refundPending: Boolean(rec.refundPending),
      reason: rec.refunded ? 'refunded' : 'refund_pending',
      error: err && err.message,
    };
  }
}

module.exports = {
  sendInvoice,
  onSuccess,
  issuePayload,
  validatePreCheckout,
  assertSecret,
  assertStartupConfig,
  STARS_TOTAL,
};
