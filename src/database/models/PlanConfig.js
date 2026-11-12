'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  plans: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAtIso: { type: String, default: null },
  updatedBy: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.PlanConfig || mongoose.model('PlanConfig', schema);
