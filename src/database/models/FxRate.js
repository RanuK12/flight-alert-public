'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  usedRate: { type: Number, required: true },
  source: { type: String, required: true },
  spotArs: { type: Number, required: true },
  publishedArs: { type: Number, required: true },
  publishedRate: { type: Number, required: true },
  at: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.FxRate || mongoose.model('FxRate', schema);
