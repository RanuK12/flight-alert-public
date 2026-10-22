'use strict';

const crypto = require('crypto');
const { sha256 } = require('../utils/mask');

let ephemeral = '';

function assertSecret() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.DEVICE_COOKIE_SECRET) {
    throw new Error('DEVICE_COOKIE_SECRET missing');
  }
}

function secret() {
  if (process.env.DEVICE_COOKIE_SECRET) return process.env.DEVICE_COOKIE_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DEVICE_COOKIE_SECRET missing');
  }
  if (!ephemeral) ephemeral = crypto.randomBytes(16).toString('hex');
  return ephemeral;
}

function readCookie(req) {
  const raw = String(req.headers.cookie || '');
  const hit = raw.split(';').map((p) => p.trim()).find((p) => p.startsWith('fa_d='));
  return hit ? decodeURIComponent(hit.slice('fa_d='.length)) : '';
}

function deviceHash(req, res) {
  const key = secret();
  let token = readCookie(req);
  const [value, mac] = token.split('.');
  const expected = value ? crypto.createHmac('sha256', key).update(value).digest('hex') : '';
  if (!value || !mac || mac !== expected) {
    const fresh = crypto.randomBytes(8).toString('hex');
    const sig = crypto.createHmac('sha256', key).update(fresh).digest('hex');
    token = `${fresh}.${sig}`;
    res.setHeader('Set-Cookie', `fa_d=${token}; HttpOnly; SameSite=Lax; Path=/`);
  }
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
  const ua = req.headers['user-agent'] || '';
  return sha256(`${token.split('.')[0]}|${ip}|${ua}`);
}

module.exports = { deviceHash, assertSecret, secret };
