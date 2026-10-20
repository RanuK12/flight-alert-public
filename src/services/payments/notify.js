'use strict';

const flags = require('../../config/flags');
const logger = require('../../utils/logger').child('payments');
const { paymentsMode } = require('./mode');

function providerName(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
}

function amountField(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return '';
  return raw.slice(0, 16);
}

function currencyField(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
}

/**
 * Aviso al owner: monto, moneda y proveedor.
 * Stars es dinero real también en test. Stripe y Mercado Pago solo en live.
 */
async function notifyCharge({ provider, amount, currency }) {
  const name = providerName(provider);
  if (!name) return;
  if (name !== 'stars' && paymentsMode() !== 'live') return;
  const amt = amountField(amount);
  const cur = currencyField(currency);
  const text = ['Cobro real', name, amt, cur].filter(Boolean).join(' ');
  logger.info('cobro real', { provider: name, amount: amt, currency: cur });
  let bot = null;
  try {
    bot = require('../../bot').getBot();
  } catch (err) {
    logger.warn('alerta de cobro', { error: err.message });
    return;
  }
  if (!bot) return;
  const { send } = require('../../bot/notifier');
  for (const chatId of flags.owners()) {
    try {
      await send(bot, chatId, text);
    } catch (err) {
      logger.warn('alerta de cobro', { error: err.message });
    }
  }
}

module.exports = { notifyCharge };
