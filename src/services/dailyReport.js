'use strict';

const { col } = require('../database');
const clock = require('../utils/clock');
const flags = require('../config/flags');
const entitlements = require('./entitlements');
const { sortFlights, seenLabel, isFresh } = require('./sortFlights');
const { bookingUrl } = require('../bot/deepLinks');
const notifier = require('../bot/notifier');
const reportData = require('./reportData');
const logger = require('../utils/logger').child('daily');

function pdfOn() {
  return flags.on('FEATURE_REPORT_PDF');
}

function reportLinks() {
  // Carga perezosa: miniapp importa config del bot.
  const { miniAppUrl, directLink } = require('../bot/miniapp');
  const direct = directLink();
  const web = miniAppUrl();
  return {
    edit: direct ? `${direct}?startapp=alerts` : web,
    manage: direct || web,
    webApp: web,
  };
}

let renderer = null;
function render(report) {
  if (!renderer) renderer = require('./reportPdf').renderReport;
  return renderer(report);
}
function setRenderer(fn) { renderer = fn; }

/** Informe nuevo (FEATURE_REPORT_PDF): PDF con caption y 2 botones; si falla el render, texto. */
async function pdfSummary(bot, userId, chatId, budget) {
  const now = clock.now();
  const own = !budget;
  const b = budget || reportData.createBudget(now);
  const { queryFor, matchesRoute } = require('./instantAlerts');
  const routes = (await col('Route').find({ telegramUserId: String(userId) }).lean()).filter((r) => !r.paused);
  const user = (await col('User').findOne({ telegramUserId: String(userId) })) || {};
  const lang = user.lang || (routes.find((r) => r.lang) || {}).lang || 'es';
  const filled = await reportData.liveFill(routes, now, b, { queryFor, matchesRoute });
  const hist = await reportData.historyFor(filled, now, b);
  const links = reportLinks();
  const report = reportData.buildReport({ routes: filled, user, now, lang, histByKey: hist, links });
  await require('./ai/advice').attachToReport(userId, report, hist, lang);
  let pdf = null;
  try {
    pdf = await render(report);
  } catch (err) {
    logger.warn('render', { error: err.message });
  }
  if (pdf) {
    try {
      await notifier.sendDocument(bot, chatId, pdf, {
        caption: reportData.captionFor(report),
        reply_markup: reportData.keyboardFor(report, links),
      }, { filename: reportData.fileName(report), contentType: 'application/pdf' });
      return { chats: [chatId], count: report.counts.priced, pdf: true, stats: own ? b.stats : undefined };
    } catch (err) {
      logger.warn('sendDocument', { error: err.message });
    }
  }
  const txt = reportData.textFor(report);
  await notifier.send(bot, chatId, txt.header);
  for (const item of txt.items) await notifier.send(bot, chatId, item.text, item.extra);
  return { chats: [chatId], count: report.counts.priced, pdf: false, stats: own ? b.stats : undefined };
}

async function sendSummaryForUser(bot, userId, chatId, budget) {
  if (pdfOn()) return pdfSummary(bot, userId, chatId, budget);
  return legacySummary(bot, userId, chatId);
}

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

async function legacySummary(bot, userId, chatId) {
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
  // Un solo presupuesto por corrida (concurrencia, Duffel total, deadline) compartido entre usuarios.
  const budget = pdfOn() ? reportData.createBudget(clock.now()) : undefined;
  let sent = 0;
  for (const doc of docs) {
    if (!['trial', 'pro', 'owner'].includes(doc.plan)) continue;
    if (!(await entitlements.canUseAlerts(doc.telegramUserId))) continue;
    const routes = await col('Route').find({ telegramUserId: doc.telegramUserId, paused: false }).lean();
    if (!routes.length) continue;
    const chatId = doc.telegramChatId || doc.telegramUserId;
    if (budget) {
      try {
        await sendSummaryForUser(bot, doc.telegramUserId, chatId, budget);
      } catch (err) {
        logger.warn('user', { error: err.message });
        continue;
      }
    } else {
      await sendSummaryForUser(bot, doc.telegramUserId, chatId);
    }
    sent += 1;
  }
  return budget ? { sent, stats: budget.stats } : { sent };
}

module.exports = { sendSummaryForUser, runDailyDigest, rowsFromRoutes, setRenderer };
