'use strict';

const mongoose = require('mongoose');

/** Mínimo diario por ruta (1 fila por ruta por día ART). Se borra sola a los 35 días. */
const schema = new mongoose.Schema({
  routeKey: { type: String, required: true },
  oneway: { type: Boolean, default: true },
  date: { type: String, required: true }, // YYYY-MM-DD (ART)
  minPrice: { type: Number, required: true },
  currency: { type: String, default: 'EUR' },
  source: { type: String, default: null },
  departureDate: { type: String, default: null },
  returnDate: { type: String, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

schema.index({ routeKey: 1, date: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.PriceHistory || mongoose.model('PriceHistory', schema);
