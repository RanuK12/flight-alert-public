'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: null },
  by: { type: String, default: 'admin' },
  at: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.RuntimeFlag || mongoose.model('RuntimeFlag', schema);
