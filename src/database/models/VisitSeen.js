'use strict';

const mongoose = require('mongoose');

/**
 * Hash diario (sha256 de IP+UA+sal que rota cada día) para contar únicos.
 * Nunca se guarda la IP. Se borra a las 48 h (TTL).
 */
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  expireAt: { type: Date, required: true },
}, { timestamps: false });
schema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.VisitSeen || mongoose.model('VisitSeen', schema);
