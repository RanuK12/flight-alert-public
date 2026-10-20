'use strict';

const { col } = require('../../database');
const clock = require('../../utils/clock');
const entitlements = require('../entitlements');
const { savePending } = require('./pending');

function assertStripeTest(key) {
  const prefix = 'sk_' + 'test';
  if (!String(key || '').startsWith(prefix)) {
    throw new Error('STRIPE_SECRET_KEY debe ser de test');
  }
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  assertStripeTest(key);
  return require('stripe')(key);
}

async function createCheckout({
  externalReference,
  currency,
  unitAmount,
  customerEmail,
  successUrl,
  cancelUrl,
}) {
  const stripe = stripeClient();
  const automaticTax = String(process.env.STRIPE_TAX_ENABLED || '').toLowerCase() === 'on';
  const customer = await stripe.customers.create({
    email: customerEmail,
    metadata: { external_reference: externalReference },
  });
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    client_reference_id: externalReference,
    metadata: { external_reference: externalReference },
    subscription_data: { metadata: { external_reference: externalReference } },
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: String(currency || '').toLowerCase(),
        unit_amount: unitAmount,
        recurring: { interval: 'month' },
        product_data: { name: 'Vuelos Pro' },
        tax_behavior: 'inclusive',
      },
    }],
    automatic_tax: { enabled: automaticTax },
  });
}

async function metadataRef(stripe, obj) {
  if (obj.object === 'subscription' && obj.metadata && obj.metadata.external_reference) {
    return String(obj.metadata.external_reference);
  }
  const subId = typeof obj.subscription === 'string' ? obj.subscription : '';
  if (subId && stripe.subscriptions) {
    const sub = await stripe.subscriptions.retrieve(subId);
    if (sub && sub.metadata && sub.metadata.external_reference) {
      return String(sub.metadata.external_reference);
    }
  }
  const custId = typeof obj.customer === 'string' ? obj.customer : '';
  if (custId && stripe.customers && stripe.customers.retrieve) {
    const cust = await stripe.customers.retrieve(custId);
    if (cust && cust.metadata && cust.metadata.external_reference) {
      return String(cust.metadata.external_reference);
    }
  }
  if (obj.metadata && obj.metadata.external_reference) return String(obj.metadata.external_reference);
  return '';
}

async function resolveRef(stripe, type, obj) {
  if (type === 'invoice.payment_failed' || type === 'checkout.session.completed') {
    if (obj.client_reference_id) return String(obj.client_reference_id);
    if (obj.metadata && obj.metadata.external_reference) return String(obj.metadata.external_reference);
  }
  return metadataRef(stripe, obj);
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
  const ref = await resolveRef(stripe, event.type, obj);
  const checkout = ref ? await col('Checkout').findOne({ externalReference: String(ref) }) : null;
  const userId = checkout && checkout.telegramUserId;

  if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
    const chargeRef = String(obj.id || '');
    if (!userId) {
      await savePending({ provider: 'stripe', ref: chargeRef, externalReference: ref });
      return { status: 200, pendingLink: true };
    }
    await entitlements.activatePro(userId, 'stripe', chargeRef, entitlements.proUntilFromNow());
    const currency = String(obj.currency || (checkout && checkout.currency) || '').toUpperCase();
    if (currency) {
      await col('Entitlement').updateOne(
        { telegramUserId: String(userId) },
        { $set: { priceCurrency: currency } },
      );
    }
    return { status: 200 };
  }
  if (event.type === 'invoice.payment_failed') {
    if (userId) await entitlements.openGrace(userId);
    return { status: 200, grace: Boolean(userId) };
  }
  if (event.type === 'customer.subscription.deleted') {
    if (!userId) {
      if (ref) {
        await col('Payment').updateMany(
          { externalReference: String(ref), status: 'pending_link' },
          { $set: { status: 'cancelled' } },
        );
      }
      return { status: 200, pendingLink: true };
    }
    await entitlements.downgrade(userId);
    return { status: 200, downgraded: true };
  }
  return { status: 200, ignored: true };
}

module.exports = { createCheckout, handleWebhook, stripeClient };
