'use strict';

const { col } = require('../database');
const clock = require('../utils/clock');
const art = require('../utils/art');
const flags = require('../config/flags');
const entitlements = require('./entitlements');
const travelpayouts = require('../providers/travelpayouts');
const { sortFlights, seenLabel } = require('./sortFlights');
const { bookingUrl } = require('../bot/deepLinks');
const notifier = require('../bot/notifier');
const logger = require('../utils/logger').child('instant');

function num(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const cooldownMs = () => num('INSTANT_ALERTS_COOLDOWN_HOURS', 12) * art.HOUR_MS;
const maxPerDay = () => num('INSTANT_ALERTS_MAX_PER_DAY', 5);

function groupKey(r) {
  return [r.origin, r.destination, r.outboundDate, r.returnDate || ''].join('|');
}

function messageFor(route, flight, now) {
  return [
    `Bajó el precio: ${flight.origin} → ${flight.destination}`,
    `€${flight.price} · ${flight.departureDate}${flight.returnDate ? ` → ${flight.returnDate}` : ''}`,
    `Tu techo: €${route.priceThreshold} · ${seenLabel(flight.foundAt, now)}`,
    'Precio en caché; el final lo ves en Aviasales.',
  ].join('\n');
}

/**
 * Revisa las alertas activas de usuarios Pro. Una sola consulta a Travelpayouts por ruta+fechas,
 * aunque varias alertas la compartan. Avisa si el precio está en o debajo del techo.
 */
async function run(bot, opts = {}) {
  if (flags.kill() || !flags.instantAlerts()) return { skipped: true };
  const now = clock.now();
  // Forzado desde /admin: revisa igual, pero no manda nada en horario de silencio.
  if (art.isQuiet(now)) return { quiet: true, forced: Boolean(opts.force) };
  const routes = (await col('Route').find({ paused: false }).lean())
    .filter((r) => Number(r.priceThreshold) > 0);
  const proCache = new Map();
  const eligible = [];
  for (const r of routes) {
    if (!proCache.has(r.telegramUserId)) proCache.set(r.telegramUserId, await entitlements.isPro(r.telegramUserId));
    if (proCache.get(r.telegramUserId)) eligible.push(r);
  }
  const groups = new Map();
  for (const r of eligible) {
    const k = groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dayStart = art.startOfArtDay(now).toISOString();
  let calls = 0;
  let sent = 0;
  for (const [, list] of groups) {
    const first = list[0];
    let best;
    try {
      calls += 1;
      best = sortFlights(await travelpayouts.search({
        origin: first.origin,
        destination: first.destination,
        departureDate: first.outboundDate,
        returnDate: first.returnDate || null,
      }))[0];
    } catch (err) {
      logger.warn('travelpayouts', { error: err.message });
      continue;
    }
    if (!best) continue;
    for (const route of list) {
      if (best.price > Number(route.priceThreshold)) continue;
      if (route.instantLastAt && now.getTime() - new Date(route.instantLastAt).getTime() < cooldownMs()) continue;
      const dup = await col('Notification').findOne({
        telegramUserId: route.telegramUserId,
        kind: 'instant',
        origin: best.origin,
        destination: best.destination,
        departureDate: best.departureDate,
        price: best.price,
      });
      if (dup) continue;
      const today = await col('Notification').countDocuments({
        telegramUserId: route.telegramUserId,
        kind: 'instant',
        sentAtIso: { $gt: dayStart },
      });
      if (today >= maxPerDay()) continue;
      await notifier.send(bot, route.telegramChatId, messageFor(route, best, now), {
        reply_markup: { inline_keyboard: [[{ text: 'Ver en Aviasales', url: bookingUrl(best) }]] },
      });
      await col('Notification').create({
        telegramUserId: route.telegramUserId,
        origin: best.origin,
        destination: best.destination,
        departureDate: best.departureDate,
        returnDate: best.returnDate || null,
        price: best.price,
        currency: best.currency || 'EUR',
        stops: best.stops ?? 0,
        durationMin: best.durationMin ?? null,
        foundAt: best.foundAt,
        sentAtIso: now.toISOString(),
        kind: 'instant',
      });
      await col('Route').updateOne(
        { _id: route._id },
        { $set: { instantLastAt: now.toISOString(), lastPriceEur: best.price, foundAt: best.foundAt } },
      );
      sent += 1;
    }
  }
  return { groups: groups.size, calls, sent };
}

module.exports = { run, groupKey, messageFor };
