'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  origin: String,
  destination: String,
  price: Number,
  currency: String,
  foundAt: String,
  departureDate: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.SamplePrice || mongoose.model('SamplePrice', schema);
