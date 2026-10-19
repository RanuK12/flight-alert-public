'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  telegramUserId: { type: String, required: true, unique: true, index: true },
  telegramChatId: { type: String, required: true },
  currency: { type: String, default: 'EUR' },
  alertMinLevel: { type: String, enum: ['steal', 'great', 'good', 'all'], default: 'good' },
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', schema);
