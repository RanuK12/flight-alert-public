'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  externalReference: { type: String, required: true, unique: true },
  telegramUserId: { type: String, default: null },
  webUserKey: { type: String, default: null },
  provider: { type: String, required: true },
  amount: { type: Number, default: null },
  currency: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.Checkout || mongoose.model('Checkout', schema);
