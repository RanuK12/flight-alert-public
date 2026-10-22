'use strict';

const mongoose = require('mongoose');

/** Auditoría del modo admin del bot: quién, qué, cuándo, sobre quién. */
const schema = new mongoose.Schema({
  adminId: { type: String, required: true, index: true },
  action: { type: String, required: true },
  target: { type: String, default: null },
  status: { type: String, default: 'done' },
  at: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.AdminAudit || mongoose.model('AdminAudit', schema);
