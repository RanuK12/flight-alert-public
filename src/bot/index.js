'use strict';

const TelegramBot = require('node-telegram-bot-api');
const flags = require('../config/flags');
const copy = require('./copy');
const rateLimit = require('../services/rateLimit');
const logger = require('../utils/logger').child('bot');
const stars = require('../services/payments/stars');

const startHandler = require('./handlers/start');
const buscarHandler = require('./handlers/buscar');
const nuevaAlertaHandler = require('./handlers/nuevaAlerta');
const misAlertasHandler = require('./handlers/misAlertas');
const ux = require('./ux');

let botInstance = null;

function install(bot) {
  const origOnText = bot.onText.bind(bot);
  const origOn = bot.on.bind(bot);

  bot.onText = (regexp, callback) => origOnText(regexp, async (msg, match) => {
    if (flags.kill()) {
      await bot.sendMessage(msg.chat.id, copy.maintenance);
      return;
    }
    const userId = msg.from && msg.from.id;
    if (rateLimit.limited('cmd', userId, 30, 60 * 1000)) {
      await bot.sendMessage(msg.chat.id, copy.slow);
      return;
    }
    return callback(msg, match);
  });

  bot.on = (event, listener, ...rest) => {
    if (event === 'message') {
      return origOn(event, async (msg) => {
        if (flags.kill()) {
          if ((msg.text && !msg.text.startsWith('/')) || msg.successful_payment) {
            await bot.sendMessage(msg.chat.id, copy.maintenance);
          }
          return;
        }
        return listener(msg);
      }, ...rest);
    }
    if (event === 'callback_query') {
      return origOn(event, async (cq) => {
        if (flags.kill()) {
          if (cq.id) await bot.answerCallbackQuery(cq.id, {}).catch(() => {});
          if (cq.message) await bot.sendMessage(cq.message.chat.id, copy.maintenance);
          return;
        }
        return listener(cq);
      }, ...rest);
    }
    return origOn(event, listener, ...rest);
  };
}

function startBot() {
  if (botInstance) return botInstance;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const polling = String(process.env.TELEGRAM_POLLING || 'true').toLowerCase() !== 'false';
  const bot = new TelegramBot(token, { polling });
  botInstance = bot;
  install(bot);

  startHandler.register(bot);
  buscarHandler.register(bot);
  // UX v1: /buscar, /nueva_alerta, /mis_alertas, /informe y /pro (ES y EN) van por el panel único.
  ux.register(bot);

  bot.on('callback_query', async (cq) => {
    try {
      const consumed = (await ux.onCallback(bot, cq)) || (await misAlertasHandler.handleRouteCallback(bot, cq));
      if (!consumed && cq.id) await bot.answerCallbackQuery(cq.id, {}).catch(() => {});
    } catch (err) {
      logger.error('callback', err);
    }
  });

  bot.on('message', async (msg) => {
    if (msg.successful_payment) {
      try {
        const result = await stars.onSuccess(msg);
        if (result && result.ok !== false && !result.reason) {
          await bot.sendMessage(msg.chat.id, result.duplicate
            ? 'Ese pago ya estaba acreditado.'
            : 'Listo, ya tenés Pro por 30 días.');
        } else {
          await bot.sendMessage(msg.chat.id, 'No pude validar el pago.');
        }
      } catch (err) {
        logger.error('pago stars', err);
      }
      return;
    }
    if (!msg.text || msg.text.startsWith('/')) return;
    try {
      const consumed = (await ux.onKeyboard(bot, msg))
        || (await ux.onText(bot, msg))
        || (await buscarHandler.handleText(bot, msg))
        || (await nuevaAlertaHandler.handleText(bot, msg));
      if (!consumed) await ux.notUnderstood(bot, msg);
    } catch (err) {
      logger.error('mensaje', err);
    }
  });

  bot.on('pre_checkout_query', async (q) => {
    if (flags.kill()) {
      await bot.answerPreCheckoutQuery(q.id, false, { error_message: copy.maintenance }).catch(() => {});
      return;
    }
    const verdict = await stars.validatePreCheckout(q);
    if (!verdict.ok) {
      await bot.answerPreCheckoutQuery(q.id, false, { error_message: 'No pude validar este pago.' }).catch(() => {});
      return;
    }
    await bot.answerPreCheckoutQuery(q.id, true).catch(() => {});
  });

  // Menu (Mini App) y comandos ES/EN. Solo corre donde arranca el bot.
  require('./miniapp').setup(bot).catch(() => {});

  logger.info('bot iniciado', { polling });
  return bot;
}

function getBot() {
  return botInstance;
}

function resetBot() {
  botInstance = null;
}

module.exports = { startBot, getBot, resetBot };
