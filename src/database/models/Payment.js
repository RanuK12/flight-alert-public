'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  provider: { type: String, required: true },
  ref: { type: String, required: true },
  telegramUserId: { type: String, required: true },
}, { timestamps: true });

schema.index({ provider: 1, ref: 1 }, { unique: true });

module.exports = mongoose.models.Payment || mongoose.model('Payment', schema);
