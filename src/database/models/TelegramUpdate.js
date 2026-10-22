'use strict';

const mongoose = require('mongoose');

// Un documento por update_id recibido por webhook. Índice único = idempotencia; TTL 24 h.
const schema = new mongoose.Schema({
  updateId: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

schema.index({ updateId: 1 }, { unique: true });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.models.TelegramUpdate || mongoose.model('TelegramUpdate', schema);
