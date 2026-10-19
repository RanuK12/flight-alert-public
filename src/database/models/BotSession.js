'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true },
  userId: { type: String, default: null },
  state: { type: String, default: '' },
  data: { type: Object, default: {} },
  expiresAt: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.BotSession || mongoose.model('BotSession', schema);
