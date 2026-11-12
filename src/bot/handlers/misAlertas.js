'use strict';

const { col } = require('../../database');
const entitlements = require('../../services/entitlements');
const { page, nav } = require('../paginator');
const { t, langOf } = require('../ux/i18n');

async function resolveLang(userId, from) {
  const u = await col('User').findOne({ telegramUserId: String(userId) }).lean();
  if (u && ['es', 'en', 'pt'].includes(u.lang)) return u.lang;
  return langOf(from);
}

function label(route) {
  const state = route.paused ? 'pausada' : 'activa';
  return `${route.origin}→${route.destination} ${route.outboundDate} · ${state}`;
}

async function list(bot, chatId, userId, index = 0) {
  const rawRoutes = await col('Route').find({ telegramUserId: String(userId) }).lean();
  const routes = rawRoutes.filter((r) => !r.deletedAt);
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
  const lang = await resolveLang(userId, cq.from);
  if (action === 'resume') {
    const route = await col('Route').findOne({ _id: routeId, telegramUserId: String(userId) }).lean();
    if (!route || route.deletedAt) {
      await bot.answerCallbackQuery(cq.id, {});
      return true;
    }
    if (route.paused) {
      const verdict = await entitlements.canCreateOrReactivate(userId);
      if (!verdict.ok) {
        await bot.answerCallbackQuery(cq.id, {});
        const msg = verdict.status === 503
          ? t(lang, 'planConfigDown')
          : verdict.plan === 'pro'
            ? t(lang, 'capReachedPro', { n: verdict.cap })
            : t(lang, 'capReached', { n: verdict.cap });
        await bot.sendMessage(chatId, msg);
        return true;
      }
    }
    await col('Route').updateOne(
      { _id: routeId, telegramUserId: String(userId) },
      { $set: { paused: false, pausedByBilling: false, pausedReason: null }, $inc: { version: 1 } },
    );
  }
  if (action === 'pause') {
    await col('Route').updateOne(
      { _id: routeId, telegramUserId: String(userId) },
      { $set: { paused: true, pausedReason: 'user' }, $inc: { version: 1 } },
    );
  }
  await bot.answerCallbackQuery(cq.id, {});
  const doneMsg = action === 'resume'
    ? (lang === 'en' ? 'Alert is active again.' : lang === 'pt' ? 'Alerta ativado novamente.' : 'La alerta volvió a estar activa.')
    : (lang === 'en' ? 'Paused that alert.' : lang === 'pt' ? 'Pausei esse alerta.' : 'Pausé esa alerta.');
  await bot.sendMessage(chatId, doneMsg);
  return true;
}

module.exports = { register, handleRouteCallback, list };
