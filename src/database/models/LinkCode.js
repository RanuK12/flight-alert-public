'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  hash: { type: String, required: true, unique: true },
  webUserKey: { type: String, required: true },
  telegramUserId: { type: String, default: null },
  expiresAt: { type: String, required: true },
  usedAt: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.LinkCode || mongoose.model('LinkCode', schema);
