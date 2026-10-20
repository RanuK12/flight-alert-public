'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { col } = require('../../database');
const entitlements = require('../entitlements');
const logger = require('../../utils/logger').child('mp');
const { savePending } = require('./pending');

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

function assertMpTest(token) {
  if (!String(token || '').startsWith('TEST-')) {
    throw new Error('MP_ACCESS_TOKEN debe ser de test');
  }
}

function authHeaders(token) {
  assertMpTest(token);
  return { Authorization: `Bearer ${token}` };
}

async function fetchPreapproval(id) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN missing');
  const res = await axios.get(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`, {
    timeout: 8000,
    headers: authHeaders(token),
  });
  return res.data;
}

async function fetchPayment(id) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN missing');
  const res = await axios.get(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
    timeout: 8000,
    headers: authHeaders(token),
  });
  return res.data;
}

function checkoutUrl(data) {
  return (data && data.sandbox_init_point) || '';
}

function eventKind(req) {
  const raw = String(
    (req.body && (req.body.type || req.body.topic))
    || (req.query && (req.query.type || req.query.topic))
    || '',
  ).toLowerCase();
  if (raw.includes('payment') && !raw.includes('preapproval')) return 'payment';
  return 'subscription';
}

async function createPreapproval({ amount, externalReference, payerEmail, backUrl }) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN missing');
  assertMpTest(token);
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
  if (!String(token).startsWith('TEST-')) {
    logger.warn('no actualicé el monto: el token de MP no es de test');
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
  if (eventKind(req) === 'payment') {
    const remote = await fetchPayment(dataId);
    if (!remote || remote.status !== 'approved') return { status: 200, ignored: true };
    const ref = remote.external_reference ? String(remote.external_reference) : '';
    const checkout = ref ? await col('Checkout').findOne({ externalReference: ref }) : null;
    if (!checkout) return { status: 200, payment: true, activated: false };
    if (!checkout.telegramUserId) {
      await savePending({ provider: 'mp', ref: String(dataId), externalReference: ref });
      return { status: 200, payment: true, pendingLink: true, activated: false };
    }
    const result = await entitlements.activatePro(
      checkout.telegramUserId,
      'mp',
      String(dataId),
      entitlements.proUntilFromNow(),
    );
    await col('Entitlement').updateOne(
      { telegramUserId: String(checkout.telegramUserId) },
      { $set: { country: 'AR', priceCurrency: 'ARS' } },
    );
    return { status: 200, payment: true, activated: true, duplicate: Boolean(result.duplicate) };
  }
  const remote = await fetchPreapproval(dataId);
  if (!remote || remote.status !== 'authorized') return { status: 200, ignored: true };
  const ref = remote.external_reference;
  const checkout = await col('Checkout').findOne({ externalReference: String(ref) });
  if (!checkout || !checkout.telegramUserId) {
    await savePending({ provider: 'mp', ref: String(dataId), externalReference: ref });
    return { status: 200, pendingLink: true };
  }
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
  fetchPayment,
  createPreapproval,
  checkoutUrl,
  updatePreapprovalAmount,
  handleWebhook,
};
