'use strict';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function monthKeyboard(year, month, prefix) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = [];
  let row = [];
  for (let day = 1; day <= days; day += 1) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    row.push({ text: String(day), callback_data: `${prefix}:${iso}` });
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.unshift([{ text: `${MONTHS[month - 1]} ${year}`, callback_data: `${prefix}:noop` }]);
  return { inline_keyboard: rows };
}

module.exports = { monthKeyboard, MONTHS };
