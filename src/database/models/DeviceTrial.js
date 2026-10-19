'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  deviceHash: { type: String, required: true, unique: true },
  telegramUserId: { type: String, required: true },
  usedAt: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.DeviceTrial || mongoose.model('DeviceTrial', schema);
