'use strict';

const copy = require('../copy');
const fmt = require('../formatters');
const sessions = require('../sessions');
const rateLimit = require('../../services/rateLimit');
const { runSearch } = require('../../services/search');
const { bookingUrl } = require('../deepLinks');

async function replySearch(bot, chatId, userId, query) {
  const result = await runSearch(userId, query);
  if (result.status !== 200) {
    await bot.sendMessage(chatId, result.text);
    return result;
  }
  await bot.sendMessage(chatId, fmt.results(result.results), result.results[0] ? {
    reply_markup: {
      inline_keyboard: [[{ text: 'Ver el más barato', url: bookingUrl(result.results[0]) }]],
    },
  } : undefined);
  return result;
}

function register(bot) {
  bot.onText(/^\/buscar(?:@\w+)?(?:\s+([A-Za-z]{3}))?(?:\s+([A-Za-z]{3}))?\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{4}-\d{2}-\d{2}))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (match[1] && match[2] && match[3]) {
      await replySearch(bot, chatId, userId, {
        origin: match[1],
        destination: match[2],
        departureDate: match[3],
        returnDate: match[4] || null,
      });
      return;
    }
    if (rateLimit.limited('wizard', userId, 3, 60 * 60 * 1000)) {
      await bot.sendMessage(chatId, copy.slow);
      return;
    }
    await sessions.setSession(chatId, { userId, state: 'buscar:origin', data: {} });
    await bot.sendMessage(chatId, '¿Desde qué aeropuerto salís? Por ejemplo EZE.');
  });
}

async function handleText(bot, msg) {
  const session = await sessions.getSession(msg.chat.id);
  if (!session || !String(session.state || '').startsWith('buscar:')) return false;
  const text = String(msg.text || '').trim().toUpperCase();
  const data = { ...(session.data || {}) };
  if (session.state === 'buscar:origin') {
    data.origin = text;
    await sessions.setSession(msg.chat.id, { userId: msg.from.id, state: 'buscar:destination', data });
    await bot.sendMessage(msg.chat.id, '¿A qué aeropuerto? Por ejemplo MAD.');
    return true;
  }
  if (session.state === 'buscar:destination') {
    data.destination = text;
    await sessions.setSession(msg.chat.id, { userId: msg.from.id, state: 'buscar:date', data });
    await bot.sendMessage(msg.chat.id, '¿Qué día salís? Formato AAAA-MM-DD.');
    return true;
  }
  if (session.state === 'buscar:date') {
    data.departureDate = String(msg.text || '').trim();
    await sessions.clearSession(msg.chat.id);
    await replySearch(bot, msg.chat.id, msg.from.id, data);
    return true;
  }
  return false;
}

module.exports = { register, handleText, replySearch, runSearch };
