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
  // Búsqueda flexible: 'YYYY-MM' o 'next3'; noches fijas. Sin esto Mongoose (strict) los descartaba
  // y las alertas flexibles se trataban como fecha exacta.
  flexMonth: { type: String, default: null },
  stayDays: { type: Number, default: null },
  notify: { type: String, default: 'daily' },
  lang: { type: String, default: null },
  // Mejor precio visto en el último tick (se guarda en cada tick, haya o no aviso).
  bestDepartureDate: { type: String, default: null },
  bestReturnDate: { type: String, default: null },
  gate: { type: String, default: null },
  source: { type: String, default: null },
  checkedAt: { type: String, default: null },
  confirmedAt: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.Route || mongoose.model('Route', schema);
