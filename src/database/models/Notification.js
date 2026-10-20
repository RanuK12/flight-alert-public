'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  telegramUserId: { type: String, required: true, index: true },
  origin: { type: String, required: true },
  destination: { type: String, required: true },
  departureDate: { type: String, required: true },
  returnDate: { type: String, default: null },
  price: { type: Number, required: true },
  currency: { type: String, default: 'EUR' },
  stops: { type: Number, default: 0 },
  durationMin: { type: Number, default: null },
  foundAt: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
  kind: { type: String, default: 'digest' },
}, { timestamps: true });

module.exports = mongoose.models.Notification || mongoose.model('Notification', schema);
