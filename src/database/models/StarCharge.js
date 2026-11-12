'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  chargeId: { type: String, required: true, unique: true, index: true },
  telegramUserId: { type: String, required: true },
  chatId: { type: String, default: null },
  payload: { type: String, default: null },
  origin: { type: String, default: null },
  totalAmount: { type: Number, default: null },
  currency: { type: String, default: 'XTR' },
  work: { type: String, enum: ['open', 'done'], default: 'open', index: true },
  outcome: { type: String, enum: ['credit', 'refund', 'pending_credit', 'pending_refund', null], default: null },
  lockedAt: { type: Date, default: null },
  lockId: { type: String, default: null },
  claimedAt: { type: Date, default: Date.now },
}, { timestamps: true });

schema.index(
  { claimedAt: 1 },
  { partialFilterExpression: { work: 'open' }, name: 'star_charge_open_claimed_idx' },
);

module.exports = mongoose.models.StarCharge || mongoose.model('StarCharge', schema);
