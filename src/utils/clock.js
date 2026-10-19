'use strict';

let current = () => new Date();

function now() {
  return new Date(current().getTime());
}

function setNow(value) {
  if (typeof value === 'function') current = value;
  else if (value instanceof Date) current = () => new Date(value.getTime());
  else current = () => new Date(value);
}

function reset() {
  current = () => new Date();
}

/** YYYY-MM en America/Argentina/Buenos_Aires. */
function artMonth(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year').value;
  const month = parts.find((p) => p.type === 'month').value;
  return `${year}-${month}`;
}

module.exports = { now, setNow, reset, artMonth };
