'use strict';

const crypto = require('crypto');
const FunnelEvent = require('../src/database/models/FunnelEvent');
const Notification = require('../src/database/models/Notification');
const Route = require('../src/database/models/Route');
const MarketPrice = require('../src/database/models/MarketPrice');
const IdempotencyRecord = require('../src/database/models/IdempotencyRecord');
const StarCharge = require('../src/database/models/StarCharge');
const StarRefund = require('../src/database/models/StarRefund');
const StarCredit = require('../src/database/models/StarCredit');
const BroadcastSend = require('../src/database/models/BroadcastSend');
const PlanConfig = require('../src/database/models/PlanConfig');
const User = require('../src/database/models/User');

describe('Mongoose validateSync schema contracts (B1/B2 & F1/F2/F3)', () => {
  test('B1: FunnelEvent acepta alert_create_from_search, pro_checkout_open, pro_paid, etc.', () => {
    const valid = new FunnelEvent({
      event: 'alert_create_from_search',
      userHash: 'abc123',
      plan: 'free',
      outcome: 'created',
      sessionId: crypto.randomUUID(),
      origin: 'search_paywall',
      at: new Date().toISOString(),
    });
    expect(valid.validateSync()).toBeUndefined();

    const invalid = new FunnelEvent({ event: 'bogus_event_not_in_enum', userHash: 'abc123' });
    expect(invalid.validateSync()).toBeDefined();
  });

  test('B2: Notification tiene status (sent/failed/pending/skipped) y alertId', () => {
    const sent = new Notification({
      telegramUserId: '101',
      alertId: 'r-1',
      kind: 'instant',
      status: 'sent',
      origin: 'EZE',
      destination: 'MAD',
      departureDate: '2026-12-01',
      price: 550,
    });
    expect(sent.validateSync()).toBeUndefined();
    expect(sent.status).toBe('sent');
    expect(sent.alertId).toBe('r-1');

    const failed = new Notification({
      telegramUserId: '101',
      kind: 'instant',
      status: 'failed',
      origin: 'EZE',
      destination: 'MAD',
      departureDate: '2026-12-01',
      price: 500,
      reason: 'telegram 403',
    });
    expect(failed.validateSync()).toBeUndefined();

    const badStatus = new Notification({ telegramUserId: '101', status: 'bogus' });
    expect(badStatus.validateSync()).toBeDefined();
  });

  test('Route soporta ceilingSource, pausedReason, version y deletedAt', () => {
    const doc = new Route({
      telegramUserId: '101',
      telegramChatId: '101',
      origin: 'COR',
      destination: 'MAD',
      tripType: 'roundtrip',
      outboundDate: '2026-12-01',
      ceilingSource: 'suggested',
      pausedReason: 'plan_limit',
      version: 2,
      deletedAt: new Date(),
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(new Route({ telegramUserId: '101', ceilingSource: 'bad' }).validateSync()).toBeDefined();
    expect(new Route({ telegramUserId: '101', pausedReason: 'bad' }).validateSync()).toBeDefined();
  });

  test('MarketPrice, IdempotencyRecord, StarCharge/Refund/Credit, BroadcastSend, PlanConfig y User.blocked validan', () => {
    expect(new MarketPrice({
      routeKey: 'EZE|MAD|roundtrip',
      origin: 'EZE',
      destination: 'MAD',
      tripType: 'roundtrip',
      obsDate: '2026-10-10',
      min: 610,
      median: 680,
    }).validateSync()).toBeUndefined();

    expect(new IdempotencyRecord({
      telegramUserId: '101',
      method: 'POST',
      path: '/app/api/alerts',
      key: 'idem-1',
      status: 201,
      body: { ok: true },
      expiresAt: new Date(Date.now() + 60000),
    }).validateSync()).toBeUndefined();

    expect(new StarCharge({
      chargeId: 'chg-1',
      telegramUserId: '101',
      work: 'done',
      outcome: 'credit',
    }).validateSync()).toBeUndefined();
    expect(new StarCharge({ chargeId: 'chg-2', telegramUserId: '101', work: 'invalid' }).validateSync()).toBeDefined();

    expect(new StarRefund({ chargeId: 'chg-1', telegramUserId: '101', status: 'pending', attempts: 1 }).validateSync()).toBeUndefined();
    expect(new StarCredit({ chargeId: 'chg-1', telegramUserId: '101', status: 'pending', attempts: 0 }).validateSync()).toBeUndefined();
    expect(new BroadcastSend({ campaignKey: 'f3_launch', telegramUserId: '101', telegramChatId: '101', sentAt: new Date().toISOString(), status: 'sent' }).validateSync()).toBeUndefined();
    expect(new BroadcastSend({ campaignKey: 'f3_launch', telegramUserId: '101', status: 'unknown' }).validateSync()).toBeDefined();
    expect(new PlanConfig({ key: 'active', plans: { free: {}, trial: {}, pro: {} } }).validateSync()).toBeUndefined();
    expect(new User({ telegramUserId: '101', telegramChatId: '101', blocked: true }).validateSync()).toBeUndefined();
  });
});
