'use strict';

/**
 * Backfills MarketPrice from observed rows in PriceHistory.
 * Runs in DRY-RUN mode by default; pass --write to persist into MarketPrice.
 * Never modifies or writes into PriceHistory and never interpolates missing days.
 */

const { connect, col } = require('../database');
const { routeMarketKey, medianOf } = require('../services/suggest');
const logger = require('../utils/logger').child('backfill-market');

function parseRouteKey(key) {
  const [origin, destination, , , tripType] = String(key || '').split('|');
  if (!origin || !destination) return null;
  const t = tripType === 'roundtrip' ? 'roundtrip' : 'oneway';
  return { origin: origin.toUpperCase(), destination: destination.toUpperCase(), tripType: t };
}

async function runBackfill({ write = false } = {}) {
  const rows = await col('PriceHistory').find({}).lean();
  const grouped = new Map();

  for (const r of rows) {
    const meta = parseRouteKey(r.routeKey);
    const price = Math.round(Number(r.minPrice));
    if (!meta || !r.date || !Number.isFinite(price) || price <= 0) continue;
    const mkKey = routeMarketKey(meta.origin, meta.destination, meta.tripType);
    const groupKey = `${mkKey}|${r.date}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        routeKey: mkKey,
        origin: meta.origin,
        destination: meta.destination,
        tripType: meta.tripType,
        obsDate: r.date,
        prices: [],
        currency: r.currency || 'EUR',
        source: r.source || 'travelpayouts',
      });
    }
    grouped.get(groupKey).prices.push(price);
  }

  let upserted = 0;
  const preview = [];
  for (const g of grouped.values()) {
    const min = Math.min(...g.prices);
    const median = Math.round(medianOf(g.prices));
    const item = {
      routeKey: g.routeKey,
      origin: g.origin,
      destination: g.destination,
      tripType: g.tripType,
      obsDate: g.obsDate,
      min,
      median,
      currency: g.currency,
      source: g.source,
    };
    preview.push(item);
    if (write) {
      await col('MarketPrice').updateOne(
        { routeKey: item.routeKey, obsDate: item.obsDate },
        {
          $min: { min: item.min },
          $set: { median: item.median },
          $setOnInsert: {
            routeKey: item.routeKey,
            origin: item.origin,
            destination: item.destination,
            tripType: item.tripType,
            obsDate: item.obsDate,
            currency: item.currency,
            source: item.source,
          },
        },
        { upsert: true },
      );
      upserted += 1;
    }
  }

  return {
    dryRun: !write,
    scanned: rows.length,
    daysPrepared: preview.length,
    upserted,
    sample: preview.slice(0, 5),
  };
}

if (require.main === module) {
  const write = process.argv.includes('--write');
  connect()
    .then(() => runBackfill({ write }))
    .then((res) => {
      logger.info('backfill complete', res);
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      logger.error('backfill failed', { error: err.message });
      process.exit(1);
    });
}

module.exports = { runBackfill, parseRouteKey };
