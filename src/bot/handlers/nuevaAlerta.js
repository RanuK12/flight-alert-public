'use strict';

const copy = require('../copy');
const flags = require('../../config/flags');
const { col } = require('../../database');
const entitlements = require('../../services/entitlements');
const sessions = require('../sessions');
const rateLimit = require('../../services/rateLimit');
const { t, langOf } = require('../ux/i18n');

async function resolveLang(userId, preferredLang) {
  if (preferredLang && ['es', 'en', 'pt'].includes(preferredLang)) return preferredLang;
  const u = await col('User').findOne({ telegramUserId: String(userId) }).lean();
  if (u && ['es', 'en', 'pt'].includes(u.lang)) return u.lang;
  return 'es';
}

async function gate(userId, chatId, opts = {}) {
  const lang = await resolveLang(userId, typeof opts === 'string' ? opts : opts && opts.lang);
  if (!flags.alerts()) return { ok: false, status: 403, code: 'ALERTS_OFF', text: t(lang, 'alertsOff') };
  const verdict = await entitlements.canCreateOrReactivate(userId);
  if (verdict.ok) {
    await col('Entitlement').updateOne(
      { telegramUserId: String(userId) },
      { $set: { telegramChatId: String(chatId) } },
      { upsert: true },
    ).catch(() => {});
    return { ok: true, plan: verdict.plan, active: verdict.active, cap: verdict.cap };
  }
  if (verdict.status === 503 || verdict.code === 'PLAN_CONFIG_UNAVAILABLE') {
    return {
      ok: false,
      status: 503,
      code: 'PLAN_CONFIG_UNAVAILABLE',
      text: t(lang, 'planConfigDown'),
    };
  }
  return {
    ok: false,
    status: verdict.status,
    code: verdict.code,
    plan: verdict.plan,
    active: verdict.active,
    cap: verdict.cap,
    text: verdict.plan === 'pro'
      ? t(lang, 'capReachedPro', { n: verdict.cap })
      : t(lang, 'capReached', { n: verdict.cap }),
  };
}

async function finalize(bot, chatId, userId, data, opts = {}) {
  const lang = await resolveLang(userId, opts && opts.lang);
  const again = await gate(userId, chatId, { lang });
  if (!again.ok) {
    await bot.sendMessage(chatId, again.text);
    return;
  }
  const hour = data.hour || '21:00';
  await col('Route').create({
    telegramUserId: String(userId),
    telegramChatId: String(chatId),
    origin: data.origin,
    destination: data.destination,
    tripType: data.returnDate ? 'roundtrip' : 'oneway',
    outboundDate: data.departureDate,
    returnDate: data.returnDate || null,
    priceThreshold: data.threshold || null,
    currency: data.currency || 'EUR',
    hour,
    paused: false,
    version: 1,
    name: `${data.origin}→${data.destination}`,
  });
  const extra = again.text ? `\n${again.text}` : '';
  const msgText = lang === 'en'
    ? `Saved alert ${data.origin}→${data.destination}, every day at ${hour}.${extra}`
    : lang === 'pt'
      ? `Alerta salvo ${data.origin}→${data.destination}, todo dia às ${hour}.${extra}`
      : `Quedó la alerta ${data.origin}→${data.destination}, todos los días a las ${hour}.${extra}`;
  await bot.sendMessage(chatId, msgText);
}

function register(bot) {
  bot.onText(/^\/nueva_alerta(?:@\w+)?$/, async (msg) => {
    const lang = await resolveLang(msg.from.id, langOf(msg.from));
    const opened = await gate(msg.from.id, msg.chat.id, { lang });
    if (!opened.ok) {
      await bot.sendMessage(msg.chat.id, opened.text);
      return;
    }
    if (rateLimit.limited('wizard', msg.from.id, 3, 60 * 60 * 1000)) {
      await bot.sendMessage(msg.chat.id, copy.slow);
      return;
    }
    await sessions.setSession(msg.chat.id, { userId: msg.from.id, state: 'alerta:origin', data: {}, lang });
    const intro = opened.text ? `${opened.text}\n\n` : '';
    const prompt = lang === 'en'
      ? 'From which airport do you want the alert?'
      : lang === 'pt'
        ? 'De qual aeroporto você quer o alerta?'
        : '¿Desde qué aeropuerto querés la alerta?';
    await bot.sendMessage(msg.chat.id, `${intro}${prompt}`);
  });
}

async function handleText(bot, msg) {
  const session = await sessions.getSession(msg.chat.id);
  if (!session || !String(session.state || '').startsWith('alerta:')) return false;
  const data = { ...(session.data || {}) };
  const text = String(msg.text || '').trim();
  const steps = {
    'alerta:origin': ['destination', '¿Hacia dónde?', (v) => v.toUpperCase(), 'origin'],
    'alerta:destination': ['date', '¿Qué día, en AAAA-MM-DD?', (v) => v, 'destination'],
    'alerta:date': ['threshold', '¿Hasta qué precio en euros te aviso? Un número.', (v) => v, 'departureDate'],
    'alerta:threshold': ['hour', '¿A qué hora te aviso? Por ejemplo 21:00.', (v) => Number(v), 'threshold'],
    'alerta:hour': [null, null, (v) => v, 'hour'],
  };
  const step = steps[session.state];
  if (!step) return false;
  data[step[3]] = step[2](text);
  if (!step[0]) {
    await sessions.clearSession(msg.chat.id);
    await finalize(bot, msg.chat.id, msg.from.id, data);
    return true;
  }
  const next = `alerta:${step[0] === 'date' ? 'date' : step[0] === 'threshold' ? 'threshold' : step[0] === 'hour' ? 'hour' : 'destination'}`;
  const state = session.state === 'alerta:origin' ? 'alerta:destination'
    : session.state === 'alerta:destination' ? 'alerta:date'
      : session.state === 'alerta:date' ? 'alerta:threshold'
        : 'alerta:hour';
  await sessions.setSession(msg.chat.id, { userId: msg.from.id, state, data });
  await bot.sendMessage(msg.chat.id, step[1]);
  return true;
}

async function handleCallback() {
  return false;
}

module.exports = { register, handleText, handleCallback, gate, finalize };
