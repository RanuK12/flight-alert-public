'use strict';

const { col } = require('../../database');
const entitlements = require('../../services/entitlements');
const copy = require('../copy');
const { page, nav } = require('../paginator');

function label(route) {
  const state = route.paused ? 'pausada' : 'activa';
  return `${route.origin}→${route.destination} ${route.outboundDate} · ${state}`;
}

async function list(bot, chatId, userId, index = 0) {
  const routes = await col('Route').find({ telegramUserId: String(userId) }).lean();
  if (!routes.length) {
    await bot.sendMessage(chatId, 'Todavía no tenés alertas. Con /nueva_alerta armás una.');
    return;
  }
  const view = page(routes, index, 5);
  const lines = view.items.map((route) => label(route));
  const keyboard = nav('alerts', view.index, view.pages);
  keyboard.inline_keyboard.push(
    ...view.items.map((route) => [{
      text: route.paused ? `Reanudar ${route.origin}` : `Pausar ${route.origin}`,
      callback_data: route.paused ? `route:resume:${route._id}` : `route:pause:${route._id}`,
    }]),
  );
  await bot.sendMessage(chatId, lines.join('\n'), { reply_markup: keyboard });
}

function register(bot) {
  bot.onText(/^\/mis_alertas(?:@\w+)?$/, async (msg) => {
    await list(bot, msg.chat.id, msg.from.id, 0);
  });
}

async function handleRouteCallback(bot, cq) {
  const data = cq.data || '';
  if (!data.startsWith('route:') && !data.startsWith('alerts:')) return false;
  const chatId = cq.message && cq.message.chat.id;
  const userId = cq.from.id;
  if (data.startsWith('alerts:')) {
    const index = Number(data.split(':')[1]);
    if (Number.isFinite(index)) await list(bot, chatId, userId, index);
    await bot.answerCallbackQuery(cq.id, {});
    return true;
  }
  const [, action, routeId] = data.split(':');
  if (action === 'resume') {
    if (!(await entitlements.canUseAlerts(userId))) {
      await bot.answerCallbackQuery(cq.id, {});
      await bot.sendMessage(chatId, copy.alertsPaywall);
      return true;
    }
    await col('Route').updateOne(
      { _id: routeId, telegramUserId: String(userId) },
      { $set: { paused: false, pausedByBilling: false } },
    );
  }
  if (action === 'pause') {
    await col('Route').updateOne(
      { _id: routeId, telegramUserId: String(userId) },
      { $set: { paused: true } },
    );
  }
  await bot.answerCallbackQuery(cq.id, {});
  await bot.sendMessage(chatId, action === 'resume' ? 'La alerta volvió a estar activa.' : 'Pausé esa alerta.');
  return true;
}

module.exports = { register, handleRouteCallback, list };
