'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const skip = new Set(['node_modules', '.git', 'data', 'coverage']);
const banned = [
  'mongodb+' + 'srv://',
  'sk_' + 'live',
  'APP_' + 'USR-',
];
const token = new RegExp(String.raw`\b\d{8,10}:[A-Za-z0-9_-]{30,}\b`);
const chatId = new RegExp(String.raw`\b\d{9,}\b`);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile() && stat.size < 2_000_000) out.push(full);
  }
  return out;
}

const hits = [];
for (const file of walk(root, [])) {
  if (file.endsWith(`${path.sep}scripts${path.sep}no-secrets.js`)) continue;
  if (file.endsWith('package-lock.json')) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of banned) {
    if (text.includes(needle)) hits.push(`${path.relative(root, file)} contiene un secreto`);
  }
  if (token.test(text)) hits.push(`${path.relative(root, file)} contiene un token de Telegram`);
  if (chatId.test(text)) hits.push(`${path.relative(root, file)} contiene un id numérico largo`);
}

if (hits.length) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log('sin secretos');
