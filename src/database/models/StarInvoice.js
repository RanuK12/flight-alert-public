'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  payload: { type: String, required: true, unique: true },
  telegramUserId: { type: String, required: true },
  total: { type: Number, required: true },
  currency: { type: String, required: true },
  usedAt: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.StarInvoice || mongoose.model('StarInvoice', schema);
