'use strict';

/**
 * Weekly engagement pulse:
 * Sends a useful, non-spammy weekly message to all opted-in users in MongoDB
 * with real fresh flight deals across top regions + direct Mini App CTA + 1-tap mute.
 * At-most-once per (campaignKey, telegramUserId) backed by BroadcastSend.
 */

const { col } = require('../database');
const clock = require('../utils/clock');
const art = require('../utils/art');
const flags = require('../config/flags');
const travelpayouts = require('../providers/travelpayouts');
const { sortFlights } = require('./sortFlights');
const places = require('../bot/ux/places');
const miniapp = require('../bot/miniapp');
const cb = require('../bot/ux/cb');
const { extractRetryAfterSec, isBlockedError } = require('./broadcast');
const logger = require('../utils/logger').child('weekly-pulse');

const MAX_RATE_PER_SEC = 25;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FEATURED_ROUTES = [
  { origin: 'EZE', destination: 'FLN', flag: '🇧🇷' },
  { origin: 'EZE', destination: 'PUJ', flag: '🏝️' },
  { origin: 'EZE', destination: 'MIA', flag: '🇺🇸' },
  { origin: 'EZE', destination: 'MAD', flag: '🇪🇸' },
  { origin: 'EZE', destination: 'FCO', flag: '🇮🇹' },
  { origin: 'EZE', destination: 'PVG', flag: '🇨🇳' },
];

const COPY = {
  es: {
    hiName: '¡Hola {name}!',
    hi: '¡Hola!',
    title: '✈️ Ofertas y novedades de la semana en Flight Alert',
    dealsHead: 'Algunas de las tarifas más bajas que vimos esta semana:',
    dealLine: '{flag} {oCity} → {dCity} desde €{price} ({date})',
    fallbackBody: 'Seguimos monitoreando vuelos baratos a Brasil (Canasvieiras, Camboriú, Pipa, Río), Caribe (Aruba, Punta Cana, Cancún), EE. UU., Europa y Shanghái.',
    tipInstant: '⚡ Nuevo: en Mis alertas ahora podés elegir avisos apenas baje de tu techo (sin esperar al resumen) o solo el reporte diario con PDF.',
    ctaZero: 'Creá tu primera alerta gratis en 30 segundos y te avisamos apenas baje el precio 👇',
    ctaHas: 'Tenés {n} alerta(s) activa(s). Entrá para revisar tus precios o sumar otro destino 👇',
    btnOpen: '🔎 Explorar vuelos',
    btnMute: '🔕 Silenciar novedades',
  },
  en: {
    hiName: 'Hi {name}!',
    hi: 'Hi!',
    title: '✈️ Weekly flight deals & updates on Flight Alert',
    dealsHead: 'Some of the lowest fares we spotted this week:',
    dealLine: '{flag} {oCity} → {dCity} from €{price} ({date})',
    fallbackBody: 'We keep tracking cheap flights to Brazil, the Caribbean, the US, Europe, and Shanghai.',
    tipInstant: '⚡ New: in My alerts you can now choose price-drop notices (without waiting for 21:00) or the daily 21:00 PDF report.',
    ctaZero: 'Create your first free alert in 30 seconds and get notified when fares drop 👇',
    ctaHas: 'You have {n} active alert(s). Open the app to check prices or track another destination 👇',
    btnOpen: '🔎 Explore flights',
    btnMute: '🔕 Mute weekly highlights',
  },
  pt: {
    hiName: 'Olá, {name}!',
    hi: 'Olá!',
    title: '✈️ Ofertas e novidades da semana no Flight Alert',
    dealsHead: 'Algumas das tarifas mais baixas que vimos esta semana:',
    dealLine: '{flag} {oCity} → {dCity} a partir de €{price} ({date})',
    fallbackBody: 'Continuamos monitorando voos baratos para Brasil, Caribe, EUA, Europa e Xangai.',
    tipInstant: '⚡ Novidade: em Meus alertas agora você pode escolher avisos na hora quando o preço cair ou só o relatório diário em PDF.',
    ctaZero: 'Crie seu primeiro alerta grátis em 30 segundos e te avisamos assim que baixar 👇',
    ctaHas: 'Você tem {n} alerta(s) ativo(s). Abra o app para ver preços ou seguir outro destino 👇',
    btnOpen: '🔎 Explorar voos',
    btnMute: '🔕 Silenciar novidades',
  },
};

function enabled(env = process.env) {
  return String(env.FEATURE_WEEKLY_PULSE || 'on').trim().toLowerCase() !== 'off';
}

/** ISO week key in ART, e.g. weekly_pulse_2026-W47. */
function isoWeekKey(now = clock.now()) {
  const { day } = art.parts(now);
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `weekly_pulse_${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function nextMonths(now, count = 2) {
  const { day } = art.parts(now);
  const [y, m] = day.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const dt = new Date(Date.UTC(y, m - 1 + i, 1));
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function fetchHighlights(now = clock.now(), { routes = FEATURED_ROUTES, limit = 3 } = {}) {
  const months = nextMonths(now, 2);
  const today = art.parts(now).day;
  const deals = [];
  for (const r of routes) {
    if (deals.length >= limit) break;
    try {
      const rows = await travelpayouts.searchRange({
        origin: r.origin,
        destination: r.destination,
        months,
        from: today,
        oneway: true,
        duffelMax: 0,
      });
      const best = sortFlights((rows || []).filter((f) => f && Number(f.price) > 0))[0];
      if (best) {
        deals.push({
          origin: r.origin,
          destination: r.destination,
          flag: r.flag,
          price: Math.round(best.price),
          departureDate: best.departureDate || '',
        });
      }
    } catch (err) {
      logger.warn('highlight fetch failed', { route: `${r.origin}-${r.destination}`, error: err.message });
    }
  }
  return deals;
}

function cityName(code) {
  return (places.PLACES[code] && places.PLACES[code].city) || code;
}

function buildMessage(user, { deals = [], activeAlertsCount = 0 } = {}) {
  const lang = COPY[user && user.lang] ? user.lang : 'es';
  const C = COPY[lang];
  const name = user && user.firstName ? String(user.firstName).trim().slice(0, 40) : '';
  const greet = name ? C.hiName.replace('{name}', name) : C.hi;
  const lines = [`${greet} ${C.title}`, ''];
  if (deals.length) {
    lines.push(C.dealsHead);
    for (const d of deals.slice(0, 3)) {
      lines.push(
        C.dealLine
          .replace('{flag}', d.flag || '✈️')
          .replace('{oCity}', cityName(d.origin))
          .replace('{dCity}', cityName(d.destination))
          .replace('{price}', String(d.price))
          .replace('{date}', d.departureDate || ''),
      );
    }
  } else {
    lines.push(C.fallbackBody);
  }
  lines.push('');
  lines.push(C.tipInstant);
  lines.push('');
  lines.push(activeAlertsCount > 0 ? C.ctaHas.replace('{n}', String(activeAlertsCount)) : C.ctaZero);
  return lines.join('\n');
}

function buildKeyboard(lang = 'es') {
  const C = COPY[lang] || COPY.es;
  const rows = [];
  const direct = miniapp.directLink();
  const webUrl = miniapp.miniAppUrl();
  if (direct) {
    const sep = direct.includes('?') ? '&' : '?';
    rows.push([{ text: C.btnOpen, url: `${direct}${sep}startapp=novedades` }]);
  } else if (webUrl) {
    rows.push([{ text: C.btnOpen, web_app: { url: webUrl } }]);
  }
  rows.push([{ text: C.btnMute, callback_data: cb.encode('s', 'poff') }]);
  return { inline_keyboard: rows };
}

async function run(bot, {
  dryRun = false,
  campaignKey = null,
  deals = null,
  maxPerSec = MAX_RATE_PER_SEC,
  sleep = defaultSleep,
  now = clock.now(),
} = {}) {
  if (flags.kill() || !enabled()) return { skipped: true };
  if (!dryRun && (!bot || typeof bot.sendMessage !== 'function')) {
    return { skipped: true, reason: 'no_bot' };
  }
  const key = String(campaignKey || isoWeekKey(now)).trim();
  const highlights = Array.isArray(deals) ? deals : await fetchHighlights(now);

  const users = await col('User').find({}).lean();
  const seen = await col('BroadcastSend').find({ campaignKey: key }).lean();
  const alreadyIds = new Set(
    seen.filter((r) => r.status === 'sent' || r.status === 'blocked').map((r) => String(r.telegramUserId)),
  );
  const activeRoutes = (await col('Route').find({ paused: false }).lean()).filter((r) => !r.deletedAt);
  const alertCountByUser = new Map();
  for (const rt of activeRoutes) {
    const uid = String(rt.telegramUserId || '');
    if (uid) alertCountByUser.set(uid, (alertCountByUser.get(uid) || 0) + 1);
  }

  const rate = Math.min(MAX_RATE_PER_SEC, Math.max(1, Number(maxPerSec) || MAX_RATE_PER_SEC));
  const minIntervalMs = Math.ceil(1000 / rate);
  let lastSentAt = 0;

  const summary = {
    campaignKey: key,
    dryRun: Boolean(dryRun),
    dealsCount: highlights.length,
    totalUsers: users.length,
    targeted: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
    skippedOptOut: 0,
    skippedBlocked: 0,
    skippedAlreadySent: 0,
    sampleText: null,
  };

  for (const u of users) {
    const uid = String(u.telegramUserId || '');
    const chatId = String(u.telegramChatId || u.telegramUserId || '');
    if (!uid || !chatId) continue;
    if (u.blocked) { summary.skippedBlocked += 1; continue; }
    if (u.weeklyPulseOptOut) { summary.skippedOptOut += 1; continue; }
    if (alreadyIds.has(uid)) { summary.skippedAlreadySent += 1; continue; }

    summary.targeted += 1;
    const lang = COPY[u.lang] ? u.lang : 'es';
    const text = buildMessage(u, { deals: highlights, activeAlertsCount: alertCountByUser.get(uid) || 0 });
    if (!summary.sampleText) summary.sampleText = text;
    if (dryRun) continue;

    const waitMs = minIntervalMs - (Date.now() - lastSentAt);
    if (lastSentAt > 0 && waitMs > 0) await sleep(waitMs);

    const extra = { reply_markup: buildKeyboard(lang) };
    let sentOk = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        lastSentAt = Date.now();
        await bot.sendMessage(chatId, text, extra);
        sentOk = true;
        break;
      } catch (err) {
        lastErr = err;
        const retryAfter = extractRetryAfterSec(err);
        if (retryAfter !== null && attempt === 0) {
          await sleep(retryAfter * 1000);
          continue;
        }
        break;
      }
    }

    const stamp = clock.now().toISOString();
    const record = async (status, error = null) => {
      try {
        await col('BroadcastSend').updateOne(
          { campaignKey: key, telegramUserId: uid },
          { $set: { campaignKey: key, telegramUserId: uid, telegramChatId: chatId, status, error, sentAt: stamp } },
          { upsert: true },
        );
      } catch (err) {
        if (!err || err.code !== 11000) logger.warn('broadcast record failed', { userId: uid, error: err && err.message });
      }
    };

    if (sentOk) {
      summary.sent += 1;
      await record('sent', null);
    } else if (isBlockedError(lastErr)) {
      summary.blocked += 1;
      await record('blocked', String((lastErr && lastErr.message) || '403').slice(0, 200));
      await col('User').updateOne({ telegramUserId: uid }, { $set: { blocked: true, blockedAt: stamp } }).catch(() => {});
    } else {
      summary.failed += 1;
      await record('failed', String((lastErr && lastErr.message) || 'error').slice(0, 200));
      logger.warn('pulse send failed', { userId: uid, error: lastErr && lastErr.message });
    }
  }

  logger.info('weekly pulse done', {
    campaignKey: summary.campaignKey,
    dryRun: summary.dryRun,
    targeted: summary.targeted,
    sent: summary.sent,
    blocked: summary.blocked,
    failed: summary.failed,
    skippedOptOut: summary.skippedOptOut,
  });
  return summary;
}

module.exports = { run, isoWeekKey, fetchHighlights, buildMessage, buildKeyboard, enabled, FEATURED_ROUTES };
