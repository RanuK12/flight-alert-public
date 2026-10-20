'use strict';

const mongoose = require('mongoose');
const memory = require('./memory');
const logger = require('../utils/logger').child('db');

let connected = false;

function open() {
  if (!process.env.MONGODB_URI && process.env.NODE_ENV === 'production') {
    throw new Error('MONGODB_URI missing');
  }
}

async function connect() {
  open();
  const uri = process.env.MONGODB_URI;
  if (!uri) return false;
  if (connected) return true;
  await mongoose.connect(uri);
  connected = true;
  logger.info('mongo conectado');
  return true;
}

function health() {
  if (!process.env.MONGODB_URI) {
    if (process.env.NODE_ENV === 'production') return { ok: false, db: 'missing' };
    return { ok: true, db: 'memory' };
  }
  if (!connected) return { ok: false, db: 'down' };
  return { ok: true, db: 'up' };
}

function col(name) {
  if (process.env.MONGODB_URI) {
    return require(`./models/${name}`);
  }
  return memory.collection(name);
}

function reset() {
  memory.reset();
  connected = false;
}

module.exports = { connect, open, health, col, reset };
