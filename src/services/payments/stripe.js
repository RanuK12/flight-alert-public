'use strict';

const { col } = require('../../database');
const clock = require('../../utils/clock');
const entitlements = require('../entitlements');
const { savePending } = require('./pending');
const { paymentsMode, assertStripeKey } = require('./mode');
const { notifyCharge } = require('./notify');

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  assertStripeKey(key);
  return require('stripe')(key);
}

function webhookSecret() {
  if (paymentsMode() === 'live') return process.env.STRIPE_WEBHOOK_SECRET_LIVE || '';
  return process.env.STRIPE_WEBHOOK_SECRET || '';
}

function lineItem(currency, unitAmount) {
  if (paymentsMode() !== 'live') {
    return {
      quantity: 1,
      price_data: {
        currency: String(currency || '').toLowerCase(),
        unit_amount: unitAmount,
        recurring: { interval: 'month' },
        product_data: { name: 'Vuelos Pro' },
        tax_behavior: 'inclusive',
      },
    };
  }
  const cur = String(currency || '').toUpperCase();
  const envName = cur === 'EUR' ? 'STRIPE_PRICE_EUR' : 'STRIPE_PRICE_USD';
  if (cur !== 'EUR' && cur !== 'USD') throw new Error('moneda de Stripe no soportada');
  const price = process.env[envName] || '';
  if (!price) throw new Error(`${envName} missing`);
  return { quantity: 1, price };
}

function automaticTax(currency) {
  const flag = String(process.env.STRIPE_TAX_ENABLED || '').toLowerCase() === 'on';
  if (paymentsMode() === 'live' && String(currency || '').toUpperCase() === 'EUR') return true;
  return flag;
}

function majorAmount(minor) {
  const n = Number(minor);
  if (!Number.isFinite(n) || n <= 0) return '';
  return (n / 100).toFixed(2);
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
  const customer = await stripe.customers.create({
    email: customerEmail,
    metadata: { external_reference: externalReference },
  });
  const tax = automaticTax(currency);
  const session = {
    mode: 'subscription',
    customer: customer.id,
    client_reference_id: externalReference,
    metadata: { external_reference: externalReference },
    subscription_data: { metadata: { external_reference: externalReference } },
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [lineItem(currency, unitAmount)],
    automatic_tax: { enabled: tax },
  };
  if (tax) {
    session.customer_update = { address: 'auto' };
    session.billing_address_collection = 'required';
  }
  return stripe.checkout.sessions.create(session);
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
  const secret = webhookSecret();
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
    const currency = String(obj.currency || (checkout && checkout.currency) || '').toUpperCase();
    const isCharge = event.type === 'invoice.paid' || !obj.subscription;
    const alert = async () => {
      if (!isCharge) return;
      const minor = obj.amount_paid != null ? obj.amount_paid : obj.amount_total;
      await notifyCharge({
        provider: 'stripe',
        amount: majorAmount(minor),
        currency,
      });
    };
    if (!userId) {
      const existing = chargeRef
        ? await col('Payment').findOne({ provider: 'stripe', ref: chargeRef })
        : null;
      await savePending({ provider: 'stripe', ref: chargeRef, externalReference: ref });
      if (!existing) await alert();
      return { status: 200, pendingLink: true };
    }
    const result = await entitlements.activatePro(userId, 'stripe', chargeRef, entitlements.proUntilFromNow());
    if (currency) {
      await col('Entitlement').updateOne(
        { telegramUserId: String(userId) },
        { $set: { priceCurrency: currency } },
      );
    }
    if (!result.duplicate) await alert();
    return { status: 200, duplicate: Boolean(result.duplicate) };
  }
  if (event.type === 'invoice.payment_failed') {
    const g = userId ? await entitlements.openGrace(userId) : null;
    return { status: 200, grace: Boolean(g && g.graceUntil) };
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
