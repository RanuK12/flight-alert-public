'use strict';

const { col } = require('../database');
const clock = require('../utils/clock');
const flags = require('../config/flags');
const logger = require('../utils/logger').child('entitlements');

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 7;
const TRIAL_MS = TRIAL_DAYS * DAY_MS;
const GRACE_MS = 3 * DAY_MS;
const PRO_MS = 30 * DAY_MS;
const SEARCH_CAP = 10;

function ent() { return col('Entitlement'); }
function routes() { return col('Route'); }
function devices() { return col('DeviceTrial'); }
function payments() { return col('Payment'); }

function idOf(id) { return String(id); }

async function ensure(id) {
  const telegramUserId = idOf(id);
  const month = clock.artMonth(clock.now());
  await ent().updateOne(
    { telegramUserId },
    {
      $setOnInsert: {
        telegramUserId,
        plan: flags.isOwner(telegramUserId) ? 'owner' : 'free',
        searchesUsed: 0,
        searchMonth: month,
      },
    },
    { upsert: true },
  );
  return ent().findOne({ telegramUserId });
}

async function resetMonthIfNeeded(id) {
  const telegramUserId = idOf(id);
  const month = clock.artMonth(clock.now());
  await ensure(id);
  await ent().updateOne(
    { telegramUserId, searchMonth: { $ne: month } },
    { $set: { searchMonth: month, searchesUsed: 0 } },
  );
}

async function peek(id) {
  if (flags.isOwner(id)) return { ok: true, owner: true };
  await resetMonthIfNeeded(id);
  const doc = await ent().findOne({ telegramUserId: idOf(id) });
  const used = doc ? doc.searchesUsed : 0;
  return { ok: used < SEARCH_CAP, used };
}

async function reserveSearch(id) {
  if (flags.isOwner(id)) return { ok: true, charged: false, owner: true };
  await resetMonthIfNeeded(id);
  const doc = await ent().findOneAndUpdate(
    { telegramUserId: idOf(id), searchesUsed: { $lt: SEARCH_CAP } },
    { $inc: { searchesUsed: 1 } },
  );
  if (!doc) return { ok: false, charged: false };
  return { ok: true, charged: true, used: doc.searchesUsed };
}

async function refundSearch(id) {
  if (flags.isOwner(id)) return;
  const doc = await ent().findOneAndUpdate(
    { telegramUserId: idOf(id), searchesUsed: { $gt: 0 } },
    { $inc: { searchesUsed: -1 } },
  );
  return doc;
}

async function canUseAlerts(id) {
  if (flags.isOwner(id) || flags.isAdmin(id)) return true;
  const doc = await ent().findOne({ telegramUserId: idOf(id) });
  if (!doc) return false;
  const t = clock.now().getTime();
  if (doc.plan === 'owner') return true;
  if (doc.plan === 'trial' && doc.trialEndsAt && new Date(doc.trialEndsAt).getTime() > t) return true;
  if (doc.plan === 'pro' && doc.proUntil && new Date(doc.proUntil).getTime() > t) return true;
  if (doc.plan === 'pro' && doc.graceUntil && new Date(doc.graceUntil).getTime() > t) return true;
  return false;
}

/** Pro activo (o en gracia) u owner. La prueba no cuenta como Pro. */
async function isPro(id) {
  if (flags.isOwner(id) || flags.isAdmin(id)) return true;
  const doc = await ent().findOne({ telegramUserId: idOf(id) });
  if (!doc) return false;
  const t = clock.now().getTime();
  if (doc.plan === 'owner') return true;
  if (doc.plan !== 'pro') return false;
  if (doc.proUntil && new Date(doc.proUntil).getTime() > t) return true;
  return Boolean(doc.graceUntil && new Date(doc.graceUntil).getTime() > t);
}

function proCaps(id) {
  const n = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  // Admin: sin límites prácticos, solo un tope anti-loop alto.
  if (id !== undefined && flags.isAdmin(id)) return { perMin: n('ADMIN_SEARCH_PER_MIN', 60), perDay: n('ADMIN_SEARCH_PER_DAY', 500) };
  return { perMin: n('PRO_SEARCH_PER_MIN', 10), perDay: n('PRO_SEARCH_PER_DAY', 60) };
}

/** Tope anti-abuso de Pro: búsquedas exitosas por día (fecha ART), guardado en Mongo. */
async function proDayOk(id) {
  const day = require('../utils/art').parts(clock.now()).day;
  const doc = await ent().findOne({ telegramUserId: idOf(id) });
  const used = doc && doc.proSearchDay === day ? Number(doc.proSearchesToday) || 0 : 0;
  return used < proCaps(id).perDay;
}

/**
 * Reserva atómica de una búsqueda Pro del día (fecha ART).
 * Un $inc condicional (proSearchesToday < tope) evita que dos búsquedas concurrentes pasen el tope;
 * después se relee el documento para verificar.
 */
async function reserveProSearch(id) {
  const day = require('../utils/art').parts(clock.now()).day;
  const telegramUserId = idOf(id);
  const cap = proCaps(id).perDay;
  await ensure(id);
  // Día nuevo: reiniciar el contador en 0 (solo si el día guardado es otro).
  await ent().updateOne(
    { telegramUserId, proSearchDay: { $ne: day } },
    { $set: { proSearchDay: day, proSearchesToday: 0 } },
  );
  const r = await ent().updateOne(
    { telegramUserId, proSearchDay: day, proSearchesToday: { $lt: cap } },
    { $inc: { proSearchesToday: 1 } },
  );
  if (!r.modifiedCount) return false;
  const doc = await ent().findOne({ telegramUserId });
  if (!doc || doc.proSearchDay !== day || Number(doc.proSearchesToday) > cap) {
    await releaseProSearch(id);
    return false;
  }
  return true;
}

/** Devuelve una reserva (búsqueda sin resultados o fallida). Nunca baja de 0. */
async function releaseProSearch(id) {
  const day = require('../utils/art').parts(clock.now()).day;
  await ent().updateOne(
    { telegramUserId: idOf(id), proSearchDay: day, proSearchesToday: { $gt: 0 } },
    { $inc: { proSearchesToday: -1 } },
  );
}

/** Compatibilidad: cuenta una búsqueda (sin tope). */
async function countProSearch(id) {
  return reserveProSearch(id);
}

async function startTrial(id, deviceHash) {
  const telegramUserId = idOf(id);
  await ensure(id);
  const doc = await ent().findOne({ telegramUserId });
  if (doc.trialUsedAt || doc.plan === 'pro' || doc.plan === 'owner') {
    return { ok: false, reason: 'cuenta' };
  }
  if (deviceHash) {
    const used = await devices().findOne({ deviceHash });
    if (used) return { ok: false, reason: 'dispositivo' };
  }
  const start = clock.now();
  const trialEndsAt = new Date(start.getTime() + TRIAL_MS).toISOString();
  await ent().updateOne(
    { telegramUserId },
    {
      $set: {
        plan: 'trial',
        trialUsedAt: start.toISOString(),
        trialEndsAt,
        deviceHash: deviceHash || null,
        expiryNoticeAt: null,
      },
    },
  );
  if (deviceHash) {
    await devices().create({
      deviceHash,
      telegramUserId,
      usedAt: start.toISOString(),
    });
  }
  return { ok: true, trialEndsAt };
}

async function activatePro(id, provider, ref, until) {
  const telegramUserId = idOf(id);
  const seen = await payments().findOne({ provider, ref });
  if (seen && seen.status !== 'pending_link') {
    const doc = await ent().findOne({ telegramUserId: seen.telegramUserId || telegramUserId });
    return { ok: true, duplicate: true, proUntil: doc && doc.proUntil };
  }
  if (seen && seen.status === 'pending_link') {
    await payments().updateOne(
      { provider, ref },
      { $set: { telegramUserId, status: 'paid' } },
    );
  } else {
    await payments().create({ provider, ref, telegramUserId, status: 'paid', paidAt: clock.now().toISOString() });
  }
  await ensure(id);
  const proUntil = (until instanceof Date ? until : new Date(until)).toISOString();
  await ent().updateOne(
    { telegramUserId },
    {
      $set: {
        plan: 'pro',
        provider,
        providerRef: ref,
        proUntil,
        graceUntil: null,
        expiryNoticeAt: null,
      },
    },
  );
  await routes().updateMany(
    { telegramUserId, pausedByBilling: true },
    { $set: { paused: false, pausedByBilling: false } },
  );
  return { ok: true, duplicate: false, proUntil };
}

async function downgrade(id) {
  const telegramUserId = idOf(id);
  await pauseForBilling(telegramUserId);
  await ensure(id);
  await ent().updateOne(
    { telegramUserId },
    { $set: { plan: 'free', proUntil: null, graceUntil: null, expiryNoticeAt: clock.now().toISOString() } },
  );
  return { plan: 'free' };
}

async function openGrace(id) {
  const telegramUserId = idOf(id);
  const graceUntil = new Date(clock.now().getTime() + GRACE_MS).toISOString();
  await ensure(id);
  await ent().updateOne(
    { telegramUserId },
    { $set: { plan: 'pro', graceUntil, expiryNoticeAt: null } },
  );
  return { graceUntil };
}

async function pauseForBilling(telegramUserId) {
  await routes().updateMany(
    { telegramUserId, paused: false },
    { $set: { paused: true, pausedByBilling: true } },
  );
}

async function endAccess(doc, bot, text) {
  await pauseForBilling(doc.telegramUserId);
  const noticeAt = clock.now().toISOString();
  await ent().updateOne(
    { telegramUserId: doc.telegramUserId },
    { $set: { plan: 'free', expiryNoticeAt: noticeAt, graceUntil: null } },
  );
  if (bot && doc.telegramChatId) {
    await bot.sendMessage(doc.telegramChatId, text);
  } else if (bot && doc.telegramUserId) {
    await bot.sendMessage(doc.telegramUserId, text);
  }
  logger.info('acceso vencido', { telegramUserId: doc.telegramUserId });
}

async function expire(bot) {
  if (require('../config/flags').kill()) return { skipped: true };
  const docs = await ent().find({}).lean();
  const t = clock.now().getTime();
  let ended = 0;
  for (const doc of docs) {
    if (doc.expiryNoticeAt) continue;
    const trialOver = doc.plan === 'trial' && doc.trialEndsAt && new Date(doc.trialEndsAt).getTime() <= t;
    const graceOver = doc.plan === 'pro' && doc.graceUntil && new Date(doc.graceUntil).getTime() <= t;
    const proOver = doc.plan === 'pro' && !doc.graceUntil && doc.proUntil && new Date(doc.proUntil).getTime() <= t;
    if (trialOver || graceOver || proOver) {
      await endAccess(doc, bot, trialOver
        ? 'Se terminó la prueba. Pausé tus alertas. Con /pro las volvés a prender.'
        : 'Se venció el pago. Pausé tus alertas. Cuando pagues, quedan como estaban.');
      ended += 1;
    }
  }
  return { ended };
}

function proUntilFromNow() {
  return new Date(clock.now().getTime() + PRO_MS);
}

module.exports = {
  isPro,
  proCaps,
  proDayOk,
  countProSearch,
  reserveProSearch,
  releaseProSearch,
  SEARCH_CAP,
  TRIAL_DAYS,
  DAY_MS,
  ensure,
  peek,
  reserveSearch,
  refundSearch,
  canUseAlerts,
  startTrial,
  activatePro,
  downgrade,
  openGrace,
  expire,
  pauseForBilling,
  proUntilFromNow,
};
