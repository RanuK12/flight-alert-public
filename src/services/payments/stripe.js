'use strict';

const { col } = require('../../database');
const clock = require('../../utils/clock');
const entitlements = require('../entitlements');

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY missing');
  return require('stripe')(key);
}

async function createCheckout({ priceId, externalReference, successUrl, cancelUrl }) {
  const stripe = stripeClient();
  const automaticTax = String(process.env.STRIPE_TAX_ENABLED || '').toLowerCase() === 'on';
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: externalReference,
    automatic_tax: { enabled: automaticTax },
  });
}

async function handleWebhook(req) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const stripe = stripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'] || '', secret, 300);
  } catch {
    return { status: 400 };
  }
  const age = Math.abs((clock.now().getTime() / 1000) - Number(event.created || 0));
  if (age > 300) return { status: 400 };
  const obj = event.data && event.data.object ? event.data.object : {};
  const ref = obj.client_reference_id || (obj.metadata && obj.metadata.external_reference) || '';
  const checkout = ref ? await col('Checkout').findOne({ externalReference: String(ref) }) : null;
  const userId = checkout && checkout.telegramUserId;
  if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
    if (userId) {
      await entitlements.activatePro(userId, 'stripe', String(obj.id), entitlements.proUntilFromNow());
      await col('Entitlement').updateOne(
        { telegramUserId: String(userId) },
        { $set: { priceCurrency: (obj.currency || 'usd').toUpperCase() } },
      );
    }
    return { status: 200 };
  }
  if (event.type === 'invoice.payment_failed') {
    if (userId) await entitlements.openGrace(userId);
    return { status: 200, grace: true };
  }
  if (event.type === 'customer.subscription.deleted') {
    if (userId) {
      await col('Entitlement').updateOne(
        { telegramUserId: String(userId) },
        { $set: { graceUntil: clock.now().toISOString() } },
      );
      await entitlements.expire(null);
    }
    return { status: 200 };
  }
  return { status: 200, ignored: true };
}

module.exports = { createCheckout, handleWebhook, stripeClient };
