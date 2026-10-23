'use strict';

const mongoose = require('mongoose');

/** Agregado diario de visitas web. Sin PII: solo contadores. TTL 90 días. */
const schema = new mongoose.Schema({
  day: { type: String, required: true, unique: true },
  pageviews: { type: Number, default: 0 },
  uniques: { type: Number, default: 0 },
  pages: { type: mongoose.Schema.Types.Mixed, default: {} },
  refs: { type: mongoose.Schema.Types.Mixed, default: {} },
  utm: { type: mongoose.Schema.Types.Mixed, default: {} },
  expireAt: { type: Date, required: true },
}, { timestamps: false, minimize: false });
schema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.VisitDay || mongoose.model('VisitDay', schema);
