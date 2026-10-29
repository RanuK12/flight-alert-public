'use strict';

/**
 * Tope diario de llamadas a la IA por usuario (día ART). Contador atómico en Mongo:
 * un $inc condicional (aiCallsToday < tope) no deja pasar dos llamadas concurrentes del mismo usuario.
 * Los aciertos de caché no consumen cupo; una llamada que no devolvió nada se devuelve (release).
 */
const { col } = require('../../database');
const { todayART } = require('./today');
const clock = require('../../utils/clock');

const DAILY_CAP = 20;

function ent() { return col('Entitlement'); }

async function reserve(userId) {
  const telegramUserId = String(userId);
  const day = todayART(clock.now());
  await require('../entitlements').ensure(telegramUserId);
  await ent().updateOne({ telegramUserId, aiDay: { $ne: day } }, { $set: { aiDay: day, aiCallsToday: 0 } });
  const r = await ent().updateOne(
    { telegramUserId, aiDay: day, aiCallsToday: { $lt: DAILY_CAP } },
    { $inc: { aiCallsToday: 1 } },
  );
  return Boolean(r && r.modifiedCount);
}

async function release(userId) {
  const day = todayART(clock.now());
  await ent().updateOne(
    { telegramUserId: String(userId), aiDay: day, aiCallsToday: { $gt: 0 } },
    { $inc: { aiCallsToday: -1 } },
  );
}

async function used(userId) {
  const day = todayART(clock.now());
  const doc = await ent().findOne({ telegramUserId: String(userId) });
  return doc && doc.aiDay === day ? Number(doc.aiCallsToday) || 0 : 0;
}

module.exports = { reserve, release, used, DAILY_CAP };
