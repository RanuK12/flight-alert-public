'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  telegramUserId: { type: String, required: true, unique: true, index: true },
  telegramChatId: { type: String, default: null },
  plan: { type: String, enum: ['free', 'trial', 'pro', 'owner'], default: 'free' },
  searchMonth: { type: String, default: null },
  searchesUsed: { type: Number, default: 0 },
  trialUsedAt: { type: String, default: null },
  trialEndsAt: { type: String, default: null },
  proUntil: { type: String, default: null },
  provider: { type: String, enum: ['stars', 'mp', 'stripe', null], default: null },
  providerRef: { type: String, default: null },
  country: { type: String, default: null },
  priceCurrency: { type: String, default: null },
  graceUntil: { type: String, default: null },
  expiryNoticeAt: { type: String, default: null },
  deviceHash: { type: String, default: null },
  pendingArs: { type: Number, default: null },
  noticeSentAt: { type: String, default: null },
  lastAdjustAt: { type: String, default: null },
  proSearchDay: { type: String, default: null },
  proSearchesToday: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.models.Entitlement || mongoose.model('Entitlement', schema);
