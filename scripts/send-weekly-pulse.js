#!/usr/bin/env node
'use strict';

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('../src/database');
const weeklyPulse = require('../src/services/weeklyPulse');

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const keyArg = args.find((a) => a.startsWith('--key='));
  const campaignKey = keyArg ? keyArg.slice('--key='.length) : null;

  await db.connect();
  const bot = live ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false }) : null;
  const out = await weeklyPulse.run(bot, { dryRun: !live, campaignKey });
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
