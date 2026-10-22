'use strict';

const mongoose = require('mongoose');

/** /start con payload de deep link, para atribución de campañas. Sin PII más allá del id. */
const schema = new mongoose.Schema({
  telegramUserId: { type: String, required: true, index: true },
  startParam: { type: String, required: true, index: true },
  at: { type: Date, required: true },
}, { timestamps: false });

module.exports = mongoose.models.StartEvent || mongoose.model('StartEvent', schema);
