'use strict';

require('dotenv').config();
const flags = require('./flags');
const { paymentsMode } = require('../services/payments/mode');

function optional(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : String(v).trim();
}

function summary() {
  return {
    env: optional('NODE_ENV', 'development'),
    port: optional('PORT', '4000'),
    kill: flags.kill(),
    features: flags.FEATURES.filter((name) => flags.on(name)),
    telegram: { hasToken: Boolean(process.env.TELEGRAM_BOT_TOKEN) },
    mongo: { hasUri: Boolean(process.env.MONGODB_URI) },
    travelpayouts: { enabled: Boolean(process.env.TRAVELPAYOUTS_TOKEN) },
    payments: paymentsMode(),
  };
}

module.exports = { summary, optional };
