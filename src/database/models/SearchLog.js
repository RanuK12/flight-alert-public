'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  telegramUserId: { type: String, required: true, index: true },
  queryHash: { type: String, required: true },
  at: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.SearchLog || mongoose.model('SearchLog', schema);
