'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  provider: { type: String, required: true },
  ref: { type: String, required: true },
  telegramUserId: { type: String, default: null },
  externalReference: { type: String, default: null },
  status: { type: String, default: 'paid' },
  paidAt: { type: String, default: null },
}, { timestamps: true });

schema.index({ provider: 1, ref: 1 }, { unique: true });

module.exports = mongoose.models.Payment || mongoose.model('Payment', schema);
