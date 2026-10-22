'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  owner: { type: String, default: null },
  until: { type: Number, default: 0 },
  lastWindow: { type: String, default: null },
  lastRunAt: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.JobLock || mongoose.model('JobLock', schema);
