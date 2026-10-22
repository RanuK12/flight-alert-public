'use strict';

const transport = require('./transport');

const TelegramBot = require('node-telegram-bot-api');
const flags = require('../config/flags');
const copy = require('./copy');
const rateLimit = require('../services/rateLimit');
const logger = require('../utils/logger').child('bot');
const stars = require('../services/payments/stars');

const startHandler = require('./handlers/start');
const buscarHandler = require('./handlers/buscar');
const nuevaAlertaHandler = require('./handlers/nuevaAlerta');
const naturalSearch = require('./handlers/naturalSearch');
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
  transport.assertConfig(process.env);
  const how = transport.mode(process.env);
  const polling = how === 'polling';
  const bot = new TelegramBot(token, { polling });
  botInstance = bot;
  bot.on('polling_error', (err) => logger.error('polling', transport.safeError(err, token)));
  bot.on('webhook_error', (err) => logger.error('webhook', transport.safeError(err, token)));
  install(bot);

  startHandler.register(bot);
  buscarHandler.register(bot);
  // UX v1: /buscar, /nueva_alerta, /mis_alertas, /informe y /pro (ES y EN) van por el panel único.
  ux.register(bot);
  // /admin oculto (no va en setMyCommands): solo ADMIN_TELEGRAM_IDS.
  require('./admin').register(bot);

  bot.on('callback_query', async (cq) => {
    try {
      if (await require('./admin').onCallback(bot, cq)) return;
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
        || (await nuevaAlertaHandler.handleText(bot, msg))
        || (await naturalSearch.handleText(bot, msg));
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

  if (how === 'webhook') {
    transport.registerWebhook(bot, process.env)
      .then(() => logger.info('webhook registrado', { path: transport.WEBHOOK_PATH }))
      .catch((err) => logger.error('webhook', transport.safeError(err)))
      .then(() => transport.refreshInfo(bot));
    const tick = setInterval(() => transport.refreshInfo(bot), 5 * 60 * 1000);
    if (tick.unref) tick.unref();
  }
  logger.info('bot iniciado', { mode: how, polling });
  return bot;
}

function getBot() {
  return botInstance;
}

function resetBot() {
  botInstance = null;
}

module.exports = { startBot, getBot, resetBot };
