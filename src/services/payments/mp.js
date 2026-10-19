'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { col } = require('../../database');
const entitlements = require('../entitlements');
const logger = require('../../utils/logger').child('mp');

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifySignature({ id, requestId, signatureHeader, secret }) {
  if (!secret || !signatureHeader || !id) return false;
  const ts = /(?:^|,)ts=(\d+)/.exec(signatureHeader);
  const v1 = /(?:^|,)v1=([a-f0-9]+)/.exec(signatureHeader);
  if (!ts || !v1) return false;
  const manifest = `id:${id};request-id:${requestId || ''};ts:${ts[1]};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return timingSafeEqual(expected, v1[1]);
}

async function fetchPreapproval(id) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN missing');
  const res = await axios.get(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`, {
    timeout: 8000,
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

async function createPreapproval({ amount, externalReference, payerEmail, backUrl }) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN missing');
  const res = await axios.post('https://api.mercadopago.com/preapproval', {
    reason: 'Alertas de vuelos Pro',
    external_reference: externalReference,
    payer_email: payerEmail,
    back_url: backUrl,
    status: 'pending',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: amount,
      currency_id: 'ARS',
    },
  }, {
    timeout: 8000,
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

/**
 * PUT documentado por Mercado Pago para cambiar el monto.
 * https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/update-preapproval/put
 */
async function updatePreapprovalAmount(id, amount) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    logger.warn('no actualicé el monto: falta el token de MP');
    return { skipped: true };
  }
  const res = await axios.put(
    `https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`,
    { auto_recurring: { transaction_amount: amount, currency_id: 'ARS' } },
    { timeout: 8000, headers: { Authorization: `Bearer ${token}` } },
  );
  return res.data;
}

async function handleWebhook(req) {
  const secret = process.env.MP_WEBHOOK_SECRET || '';
  const dataId = (req.query && (req.query['data.id'] || req.query.id))
    || (req.body && req.body.data && req.body.data.id)
    || (req.body && req.body.id);
  const ok = verifySignature({
    id: dataId,
    requestId: req.headers['x-request-id'] || '',
    signatureHeader: req.headers['x-signature'] || '',
    secret,
  });
  if (!ok) return { status: 401 };
  const remote = await fetchPreapproval(dataId);
  if (!remote || remote.status !== 'authorized') return { status: 200, ignored: true };
  const ref = remote.external_reference;
  const checkout = await col('Checkout').findOne({ externalReference: String(ref) });
  if (!checkout || !checkout.telegramUserId) return { status: 200, pendingLink: true };
  await entitlements.activatePro(
    checkout.telegramUserId,
    'mp',
    String(dataId),
    entitlements.proUntilFromNow(),
  );
  await col('Entitlement').updateOne(
    { telegramUserId: String(checkout.telegramUserId) },
    { $set: { country: 'AR', priceCurrency: 'ARS' } },
  );
  return { status: 200, activated: true };
}

module.exports = {
  verifySignature,
  fetchPreapproval,
  createPreapproval,
  updatePreapprovalAmount,
  handleWebhook,
};
