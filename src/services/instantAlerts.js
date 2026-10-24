'use strict';

const duffel = require('../providers/duffel');

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
// Banda de precio para dedup: mismo aviso si el precio está dentro de ±este % (mín. 1 unidad).
const dedupBandPct = () => num('INSTANT_ALERTS_DEDUP_BAND_PCT', 1);

/** Rango de precios que cuenta como "el mismo aviso" (precio ± banda). */
function priceBand(price) {
  const d = Math.max(1, Math.round(Number(price) * dedupBandPct()) / 100);
  return { $gte: Number(price) - d, $lte: Number(price) + d };
}

function groupKey(r) {
  return [r.origin, r.destination, r.outboundDate, r.returnDate || '', r.tripType || '', r.flexMonth || '', r.stayDays || ''].join('|');
}

const ym = (iso) => String(iso).slice(0, 7);
function addMonthsYm(y, m, i) {
  const d = new Date(Date.UTC(y, m - 1 + i, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Consulta para una alerta. Las flexibles (mes o próximos 3 meses) usan el rango y
 * también respetan la vuelta: misma fecha de vuelta, o misma cantidad de noches.
 */
function queryFor(r, now) {
  const roundtrip = r.tripType === 'roundtrip' || Boolean(r.returnDate) || Boolean(r.stayDays);
  if (!r.flexMonth) {
    return { kind: 'exact', q: { origin: r.origin, destination: r.destination, departureDate: r.outboundDate, returnDate: r.returnDate || null } };
  }
  const today = now.toISOString().slice(0, 10);
  let months;
  if (r.flexMonth === 'next3') {
    const [y, m] = today.split('-').map(Number);
    months = [0, 1, 2].map((i) => addMonthsYm(y, m, i));
  } else {
    months = [ym(r.flexMonth)];
  }
  return {
    kind: 'range',
    q: {
      origin: r.origin,
      destination: r.destination,
      months,
      day: null,
      from: today,
      oneway: !roundtrip,
      // Con noches fijas, la vuelta depende de la ida; si no, se respeta la fecha de vuelta guardada.
      returnDate: r.stayDays ? null : (roundtrip ? r.returnDate || null : null),
      stay: r.stayDays ? Number(r.stayDays) : null,
    },
  };
}

/** Un vuelo sirve para la alerta si respeta ida y vuelta de la alerta. */
function matchesRoute(r, f) {
  const roundtrip = r.tripType === 'roundtrip' || Boolean(r.returnDate) || Boolean(r.stayDays);
  if (!roundtrip) return !f.returnDate;
  if (!f.returnDate || f.returnDate <= f.departureDate) return false;
  if (r.stayDays) {
    const nights = Math.round((Date.parse(`${f.returnDate}T00:00:00Z`) - Date.parse(`${f.departureDate}T00:00:00Z`)) / 86400000);
    return nights === Number(r.stayDays);
  }
  if (r.flexMonth) return !r.returnDate || f.returnDate === r.returnDate;
  return !r.returnDate || f.returnDate === r.returnDate;
}

const ALERT_TEXT = {
  es: { title: 'Bajó el precio', ceiling: 'Tu techo', cached: 'Precio en caché; el final lo ves en Aviasales.', live: 'Precio de referencia; el final lo ves en Aviasales.' },
  en: { title: 'Price drop', ceiling: 'Your ceiling', cached: 'Cached price; see the final price on Aviasales.', live: 'Reference price; see the final price on Aviasales.' },
  pt: { title: 'O preço caiu', ceiling: 'Seu teto', cached: 'Preço em cache; o final você vê na Aviasales.', live: 'Preço de referência; o final você vê na Aviasales.' },
};

function messageFor(route, flight, now) {
  const lang = ALERT_TEXT[route.lang] ? route.lang : 'es';
  const T = ALERT_TEXT[lang];
  return [
    `${T.title}: ${flight.origin} → ${flight.destination}`,
    `€${flight.price} · ${flight.departureDate}${flight.returnDate ? ` → ${flight.returnDate}` : ''}`,
    `${T.ceiling}: €${route.priceThreshold} · ${seenLabel(flight.foundAt, now, lang)}`,
    flight.source === 'duffel' ? T.live : T.cached,
  ].join('\n');
}

/**
 * Revisa las alertas activas de usuarios Pro. Una sola consulta a Travelpayouts por ruta+fechas,
 * aunque varias alertas la compartan. Avisa si el precio está en o debajo del techo.
 */
async function run(bot, opts = {}) {
  duffel.beginTick();
  try {
    return await runTick(bot, opts);
  } finally {
    duffel.endTick();
  }
}

async function runTick(bot, opts = {}) {
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
      const { kind, q } = queryFor(first, now);
      const rows = kind === 'range' ? await travelpayouts.searchRange(q) : await travelpayouts.search(q);
      best = sortFlights((rows || []).filter((f) => matchesRoute(first, f)))[0];
    } catch (err) {
      logger.warn('travelpayouts', { error: err.message });
      continue;
    }
    if (!best) continue;
    // Re-verificación en tiempo real antes de avisar (si hay DUFFEL_ACCESS_TOKEN y algún techo lo permite).
    // Si Duffel responde, manda el precio verificado (o nada si supera el techo); si no, sigue con Travelpayouts.
    if (best.source !== 'duffel' && duffel.enabled() && list.some((r) => best.price <= Number(r.priceThreshold))) {
      const verified = await duffel.cheapest({
        origin: first.origin, destination: first.destination, departureDate: best.departureDate, returnDate: best.returnDate || null,
      });
      if (verified) best = verified;
    }
    for (const route of list) {
      if (best.price > Number(route.priceThreshold)) continue;
      if (route.instantLastAt && now.getTime() - new Date(route.instantLastAt).getTime() < cooldownMs()) continue;
      const dup = await col('Notification').findOne({
        telegramUserId: route.telegramUserId,
        kind: 'instant',
        origin: best.origin,
        destination: best.destination,
        departureDate: best.departureDate,
        returnDate: best.returnDate || null,
        price: priceBand(best.price),
        status: { $ne: 'failed' },
      });
      if (dup) continue;
      const today = await col('Notification').countDocuments({
        telegramUserId: route.telegramUserId,
        kind: 'instant',
        sentAtIso: { $gt: dayStart },
        status: { $ne: 'failed' },
      });
      const cap = require('../config/flags').isAdmin(route.telegramUserId) ? num('ADMIN_ALERTS_PER_DAY', 500) : maxPerDay();
      if (today >= cap) continue;
      // Outbox: se registra ANTES de mandar. Si el proceso se cae después del envío,
      // el registro 'pending' ya bloquea un segundo aviso (at-most-once).
      const row = await col('Notification').create({
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
        status: 'pending',
      });
      const rowId = row && row._id;
      try {
        await notifier.send(bot, route.telegramChatId, messageFor(route, best, now), {
          reply_markup: { inline_keyboard: [[{ text: 'Ver en Aviasales', url: bookingUrl(best) }]] },
        });
      } catch (err) {
        logger.warn('send', { error: err.message });
        if (rowId) await col('Notification').updateOne({ _id: rowId }, { $set: { status: 'failed' } });
        continue;
      }
      if (rowId) await col('Notification').updateOne({ _id: rowId }, { $set: { status: 'sent' } });
      await col('Route').updateOne(
        { _id: route._id },
        { $set: { instantLastAt: now.toISOString(), lastPriceEur: best.price, foundAt: best.foundAt } },
      );
      sent += 1;
    }
  }
  return { groups: groups.size, calls, sent };
}

module.exports = { run, groupKey, messageFor, queryFor, matchesRoute, priceBand };
