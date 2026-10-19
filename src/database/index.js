'use strict';

const mongoose = require('mongoose');
const memory = require('./memory');
const logger = require('../utils/logger').child('db');

let connected = false;

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return false;
  if (connected) return true;
  await mongoose.connect(uri);
  connected = true;
  logger.info('mongo conectado');
  return true;
}

function col(name) {
  if (process.env.MONGODB_URI) {
    return require(`./models/${name}`);
  }
  return memory.collection(name);
}

function reset() {
  memory.reset();
}

module.exports = { connect, col, reset };
