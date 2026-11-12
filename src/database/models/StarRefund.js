'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  chargeId: { type: String, required: true, unique: true },
  telegramUserId: { type: String, required: true },
  chatId: { type: String, default: null },
  reason: { type: String, default: null },
  status: { type: String, enum: ['pending', 'done', 'exhausted'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: null },
  nextAttemptAt: { type: Date, default: Date.now },
  notifiedAdminAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.models.StarRefund || mongoose.model('StarRefund', schema);
