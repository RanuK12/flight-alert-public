'use strict';

const mongoose = require('mongoose');
const memory = require('./memory');
const logger = require('../utils/logger').child('db');

let connected = false;
const ATTEMPTS = 3;

let connector = (uri) => mongoose.connect(uri);

function setConnector(fn) {
  connector = fn;
}

function resetConnector() {
  connector = (uri) => mongoose.connect(uri);
}

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
  const attempts = process.env.NODE_ENV === 'production' ? ATTEMPTS : 1;
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await connector(uri);
      connected = true;
      logger.info('mongo conectado');
      return true;
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error('mongo no conectó');
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

module.exports = { connect, open, health, col, reset, setConnector, resetConnector, ATTEMPTS };
