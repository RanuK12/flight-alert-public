'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  telegramUserId: { type: String, required: true, unique: true, index: true },
  telegramChatId: { type: String, required: true },
  currency: { type: String, default: 'EUR' },
  lang: { type: String, enum: ['es', 'en', 'pt', null], default: null },
  firstName: { type: String, default: null },
  alertMinLevel: { type: String, enum: ['steal', 'great', 'good', 'all'], default: 'good' },
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', schema);
