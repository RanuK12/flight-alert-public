'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  chargeId: { type: String, required: true, unique: true },
  telegramUserId: { type: String, required: true },
  chatId: { type: String, default: null },
  origin: { type: String, default: null },
  totalAmount: { type: Number, default: null },
  currency: { type: String, default: 'XTR' },
  status: { type: String, enum: ['pending', 'done', 'exhausted'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: null },
  nextAttemptAt: { type: Date, default: Date.now },
  userNotifiedAt: { type: Date, default: null },
  notifiedAdminAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.models.StarCredit || mongoose.model('StarCredit', schema);
