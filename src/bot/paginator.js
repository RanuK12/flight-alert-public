'use strict';

function page(items, index, size = 5) {
  const start = Math.max(0, index) * size;
  return {
    items: items.slice(start, start + size),
    index,
    pages: Math.max(1, Math.ceil(items.length / size)),
  };
}

function nav(prefix, index, pages) {
  const row = [];
  if (index > 0) row.push({ text: '←', callback_data: `${prefix}:${index - 1}` });
  row.push({ text: `${index + 1}/${pages}`, callback_data: `${prefix}:noop` });
  if (index + 1 < pages) row.push({ text: '→', callback_data: `${prefix}:${index + 1}` });
  return { inline_keyboard: [row] };
}

module.exports = { page, nav };
