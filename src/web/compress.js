'use strict';

const zlib = require('zlib');

const MIN_BYTES = 1024;

function compressible(type) {
  return /text|json|javascript|svg|xml|css/.test(String(type || ''));
}

/**
 * Gzip de la respuesta cuando el cliente lo pide. Sin dependencia nueva.
 * Los cuerpos chicos siguen igual para no tocar webhooks ni /health.
 */
function compress(req, res, next) {
  const accept = String(req.headers['accept-encoding'] || '');
  if (req.method === 'HEAD' || !/\bgzip\b/.test(accept)) return next();
  const chunks = [];
  const write = res.write;
  const end = res.end;
  res.write = function writeChunk(chunk, enc, cb) {
    if (typeof enc === 'function') {
      cb = enc;
      enc = undefined;
    }
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc || 'utf8'));
    if (typeof cb === 'function') cb();
    return true;
  };
  res.end = function endChunk(chunk, enc, cb) {
    if (typeof chunk === 'function') {
      cb = chunk;
      chunk = undefined;
      enc = undefined;
    } else if (typeof enc === 'function') {
      cb = enc;
      enc = undefined;
    }
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc || 'utf8'));
    const body = Buffer.concat(chunks);
    const type = res.getHeader('Content-Type');
    res.write = write;
    res.end = end;
    if (!compressible(type) || body.length < MIN_BYTES || res.getHeader('Content-Encoding')) {
      return end.call(res, body, cb);
    }
    zlib.gzip(body, (err, gz) => {
      if (err || gz.length >= body.length) return end.call(res, body, cb);
      res.setHeader('Content-Encoding', 'gzip');
      res.removeHeader('Content-Length');
      const vary = res.getHeader('Vary');
      res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
      return end.call(res, gz, cb);
    });
    return undefined;
  };
  return next();
}

module.exports = { compress };
