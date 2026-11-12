'use strict';

const mongoose = require('mongoose');

const EVENTS = [
  'search',
  'alert_create',
  'alert_create_from_search',
  'trial_start',
  'first_cheap_alert',
  'paywall_seen',
  'pro_checkout_open',
  'pro_paid',
];

const schema = new mongoose.Schema({
  event: { type: String, enum: EVENTS, required: true, index: true },
  userHash: { type: String, required: true, index: true },
  plan: { type: String, enum: ['free', 'trial', 'pro', 'owner', null], default: null },
  outcome: { type: String, enum: ['created', '402', '409', '503', null], default: null },
  sessionId: { type: String, default: null, index: true },
  origin: { type: String, default: null },
  method: { type: String, enum: ['card', 'mp', 'stripe', 'stars', null], default: null },
  interval: { type: String, enum: ['monthly', 'annual', null], default: null },
  subscriptionId: { type: String, default: null },
  at: { type: String, required: true, index: true },
}, { timestamps: true });

schema.index(
  { userHash: 1, event: 1 },
  {
    unique: true,
    partialFilterExpression: { event: { $in: ['trial_start', 'first_cheap_alert'] } },
    name: 'funnel_user_once_event',
  },
);

schema.index(
  { event: 1, subscriptionId: 1 },
  {
    unique: true,
    partialFilterExpression: { event: 'pro_paid', subscriptionId: { $type: 'string' } },
    name: 'funnel_pro_paid_sub_unique',
  },
);

module.exports = mongoose.models.FunnelEvent || mongoose.model('FunnelEvent', schema);
module.exports.EVENTS = EVENTS;
