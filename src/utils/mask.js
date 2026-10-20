'use strict';

const crypto = require('crypto');

function maskId(id) {
  const raw = String(id ?? '');
  if (!raw) return '***';
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

const secretPatterns = [
  new RegExp(String.raw`\d{6,}:[A-Za-z0-9_-]{20,}`, 'g'),
  new RegExp('mongodb' + '(?:\\+srv)?:\\/\\/\\S+', 'gi'),
  new RegExp('sk_' + 'live_[A-Za-z0-9]+', 'g'),
  new RegExp('APP_' + 'USR-\\S+', 'g'),
];

function redact(value) {
  if (typeof value === 'string') {
    return secretPatterns.reduce((text, pattern) => text.replace(pattern, '***'), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/token|secret|authorization|password|uri|apiKey|key/i.test(k)) out[k] = '***';
      else if (/telegramUserId|chatId|userId/i.test(k)) out[k] = maskId(v);
      else out[k] = redact(v);
    }
    return out;
  }
  return value;
}

module.exports = { maskId, sha256, redact };
