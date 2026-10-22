'use strict';

const { IATA } = require('./schema');

/** Parser por reglas: "EZE MAD 2026-12-10 [2027-01-05] [2 adultos]". Null si no alcanza. */
function parseRules(text) {
  const up = String(text || '').toUpperCase();
  const codes = (up.match(/\b[A-Z]{3}\b/g) || []).filter((c) => IATA.has(c));
  const dates = up.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  if (codes.length < 2 || dates.length < 1) return null;
  const adultsM = /\b(\d)\s*(?:ADULTOS?|ADULTS?|PERSONAS?|PAX)\b/.exec(up);
  return {
    origin: codes[0],
    destination: codes[1],
    departDate: dates[0],
    returnDate: dates[1] || null,
    adults: adultsM ? Number(adultsM[1]) : 1,
  };
}

module.exports = { parseRules };
