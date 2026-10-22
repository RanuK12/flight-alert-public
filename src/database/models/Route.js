'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  telegramUserId: { type: String, required: true, index: true },
  telegramChatId: { type: String, required: true },
  origin: { type: String, required: true, uppercase: true, trim: true },
  destination: { type: String, required: true, uppercase: true, trim: true },
  tripType: { type: String, enum: ['oneway', 'roundtrip'], required: true },
  outboundDate: { type: String, required: true },
  returnDate: { type: String, default: null },
  priceThreshold: { type: Number, default: null },
  currency: { type: String, default: 'EUR' },
  name: { type: String, default: '' },
  paused: { type: Boolean, default: false },
  pausedByBilling: { type: Boolean, default: false },
  lastPriceEur: { type: Number, default: null },
  stops: { type: Number, default: null },
  durationMin: { type: Number, default: null },
  foundAt: { type: String, default: null },
  hour: { type: String, default: '21:00' },
  instantLastAt: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.Route || mongoose.model('Route', schema);
