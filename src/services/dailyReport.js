'use strict';

const { col } = require('../database');
const clock = require('../utils/clock');
const flags = require('../config/flags');
const entitlements = require('./entitlements');
const { sortFlights, seenLabel, isFresh } = require('./sortFlights');
const { bookingUrl } = require('../bot/deepLinks');
const notifier = require('../bot/notifier');

function rowsFromRoutes(routes, now) {
  return routes
    .filter((r) => r.lastPriceEur && r.foundAt && isFresh({ foundAt: r.foundAt }, now))
    .map((r) => ({
      origin: r.origin,
      destination: r.destination,
      price: r.lastPriceEur,
      currency: r.currency || 'EUR',
      stops: r.stops ?? 0,
      durationMin: r.durationMin,
      departureDate: r.outboundDate,
      returnDate: r.returnDate,
      foundAt: r.foundAt,
    }));
}

async function sendSummaryForUser(bot, userId, chatId) {
  const now = clock.now();
  const routes = await col('Route').find({ telegramUserId: String(userId) }).lean();
  const active = routes.filter((r) => !r.paused);
  const ranked = sortFlights(rowsFromRoutes(active, now));
  const today = now.toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const header = [
    `Informe — ${today}`,
    `Alertas activas: ${active.length}`,
    ranked.length ? 'Orden: precio, escalas, duración y fecha.' : 'Todavía no tengo un precio fresco para esas alertas.',
  ].join('\n');
  await notifier.send(bot, chatId, header);
  for (const flight of ranked.slice(0, 8)) {
    const stops = flight.stops === 0 ? 'directo' : `${flight.stops} escala${flight.stops > 1 ? 's' : ''}`;
    const hours = flight.durationMin ? `${Math.round(flight.durationMin / 60)} h` : 's/d';
    const text = [
      `${flight.origin} → ${flight.destination}`,
      `€${flight.price} · ${stops} · ${hours} · ${flight.departureDate}`,
      seenLabel(flight.foundAt, now),
    ].join('\n');
    await notifier.send(bot, chatId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Ver en Aviasales', url: bookingUrl(flight) }]],
      },
    });
  }
  return { chats: [chatId], count: ranked.length };
}

async function runDailyDigest(bot) {
  if (flags.kill()) return { skipped: true };
  const docs = await col('Entitlement').find({}).lean();
  let sent = 0;
  for (const doc of docs) {
    if (!['trial', 'pro', 'owner'].includes(doc.plan)) continue;
    if (!(await entitlements.canUseAlerts(doc.telegramUserId))) continue;
    const routes = await col('Route').find({ telegramUserId: doc.telegramUserId, paused: false }).lean();
    if (!routes.length) continue;
    const chatId = doc.telegramChatId || doc.telegramUserId;
    await sendSummaryForUser(bot, doc.telegramUserId, chatId);
    sent += 1;
  }
  return { sent };
}

module.exports = { sendSummaryForUser, runDailyDigest, rowsFromRoutes };
