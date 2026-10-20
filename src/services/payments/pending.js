'use strict';

const { col } = require('../../database');

async function savePending({ provider, ref, externalReference }) {
  const id = String(ref);
  const existing = await col('Payment').findOne({ provider, ref: id });
  if (existing) return existing;
  return col('Payment').create({
    provider,
    ref: id,
    externalReference: externalReference ? String(externalReference) : null,
    telegramUserId: null,
    status: 'pending_link',
  });
}

module.exports = { savePending };
