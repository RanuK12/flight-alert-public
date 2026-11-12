'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  campaignKey: { type: String, required: true, index: true },
  telegramUserId: { type: String, required: true },
  telegramChatId: { type: String, required: true },
  status: { type: String, enum: ['sent', 'blocked', 'failed', 'dry_run'], required: true },
  error: { type: String, default: null },
  sentAt: { type: String, required: true },
}, { timestamps: true });

schema.index({ campaignKey: 1, telegramUserId: 1 }, { unique: true, name: 'broadcast_campaign_user_unique' });

module.exports = mongoose.models.BroadcastSend || mongoose.model('BroadcastSend', schema);
