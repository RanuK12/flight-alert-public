'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  telegramUserId: { type: String, required: true },
  method: { type: String, required: true },
  path: { type: String, required: true },
  key: { type: String, required: true },
  status: { type: Number, required: true },
  body: { type: mongoose.Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { timestamps: true });

schema.index({ telegramUserId: 1, method: 1, path: 1, key: 1 }, { unique: true, name: 'idempotency_unique' });

module.exports = mongoose.models.IdempotencyRecord || mongoose.model('IdempotencyRecord', schema);
