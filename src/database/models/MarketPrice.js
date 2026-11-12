'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  routeKey: { type: String, required: true, index: true },
  origin: { type: String, required: true, uppercase: true, trim: true },
  destination: { type: String, required: true, uppercase: true, trim: true },
  tripType: { type: String, enum: ['oneway', 'roundtrip'], required: true },
  obsDate: { type: String, required: true },
  min: { type: Number, required: true },
  median: { type: Number, default: null },
  currency: { type: String, default: 'EUR' },
  source: { type: String, default: 'travelpayouts' },
}, { timestamps: true });

schema.index({ routeKey: 1, obsDate: 1 }, { unique: true, name: 'market_price_route_obs_unique' });
schema.index({ origin: 1, destination: 1, tripType: 1, obsDate: -1 }, { name: 'market_price_lookup_idx' });

module.exports = mongoose.models.MarketPrice || mongoose.model('MarketPrice', schema);
