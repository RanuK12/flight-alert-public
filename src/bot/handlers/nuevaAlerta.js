'use strict';

const copy = require('../copy');
const flags = require('../../config/flags');
const { col } = require('../../database');
const entitlements = require('../../services/entitlements');
const sessions = require('../sessions');
const rateLimit = require('../../services/rateLimit');

async function gate(userId, chatId) {
  if (!flags.alerts()) return { ok: false, text: copy.alertsOff };
  if (await entitlements.canUseAlerts(userId)) return { ok: true };
  const trial = await entitlements.startTrial(userId);
  if (!trial.ok) return { ok: false, text: copy.alertsPaywall };
  await col('Entitlement').updateOne(
    { telegramUserId: String(userId) },
    { $set: { telegramChatId: String(chatId) } },
  );
  return { ok: true, text: copy.trialOn };
}

async function finalize(bot, chatId, userId, data) {
  const again = await gate(userId, chatId);
  if (!again.ok) {
    await bot.sendMessage(chatId, again.text);
    return;
  }
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
    hour: data.hour || '21:00',
    paused: false,
    name: `${data.origin}→${data.destination}`,
  });
  const extra = again.text ? `\n${again.text}` : '';
  await bot.sendMessage(chatId, `Quedó la alerta ${data.origin}→${data.destination}, todos los días a las ${data.hour || '21:00'}.${extra}`);
}

function register(bot) {
  bot.onText(/^\/nueva_alerta(?:@\w+)?$/, async (msg) => {
    const opened = await gate(msg.from.id, msg.chat.id);
    if (!opened.ok) {
      await bot.sendMessage(msg.chat.id, opened.text);
      return;
    }
    if (rateLimit.limited('wizard', msg.from.id, 3, 60 * 60 * 1000)) {
      await bot.sendMessage(msg.chat.id, copy.slow);
      return;
    }
    await sessions.setSession(msg.chat.id, { userId: msg.from.id, state: 'alerta:origin', data: {} });
    const intro = opened.text ? `${opened.text}\n\n` : '';
    await bot.sendMessage(msg.chat.id, `${intro}¿Desde qué aeropuerto querés la alerta?`);
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
