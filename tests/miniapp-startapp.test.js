'use strict';

/** Ejecuta public/app/app.js en un DOM mínimo y verifica el deep link startapp. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'app.js'), 'utf8');

function el(tag) {
  const node = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, hidden: false, parentNode: null, _text: '',
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener() {},
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); },
    scrollIntoView() {},
    focus() {},
    querySelector(sel) { return find(this, sel); },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(node, 'textContent', {
    get() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set(v) { this._text = String(v); this.children = []; },
  });
  return node;
}
function find(root, sel) {
  for (const c of root.children) {
    if (c.tagName === sel.toUpperCase()) return c;
    const f = find(c, sel);
    if (f) return f;
  }
  return null;
}

async function boot(startParam) {
  const root = el('div');
  const calls = [];
  const document = {
    documentElement: el('html'), body: el('body'),
    getElementById: () => root, createElement: el,
    createTextNode: (t) => { const n = el('#text'); n._text = String(t); return n; },
  };
  const btn = { setText() {}, enable() {}, disable() {}, show() {}, hide() {}, onClick() {}, setParams() {} };
  const tg = {
    initData: 'signed', initDataUnsafe: { start_param: startParam, user: { language_code: 'es' } },
    ready() {}, expand() {}, onEvent() {}, close() {}, MainButton: btn, BackButton: { ...btn },
  };
  const fetch = async (url) => {
    calls.push(url);
    const body = url.endsWith('/places') ? { origins: [], destinations: [] } : { alerts: [] };
    return { status: 200, json: async () => body };
  };
  const ctx = { window: { Telegram: { WebApp: tg } }, document, navigator: { language: 'es' }, fetch, setTimeout, console };
  ctx.window.window = ctx.window;
  vm.runInNewContext(SRC, ctx);
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
  return { root, calls };
}

describe('Mini App: deep link startapp', () => {
  test('startapp=alerts abre directamente "Mis alertas"', async () => {
    const { root, calls } = await boot('alerts');
    expect(root.querySelector('h1').textContent).toMatch(/^Mis alertas/);
    expect(calls).toContain('/app/api/alerts');
  });
  test('sin startapp abre la búsqueda (no la lista de alertas)', async () => {
    const { root, calls } = await boot('');
    expect(root.querySelector('h1') && root.querySelector('h1').textContent).not.toMatch(/^Mis alertas/);
    expect(calls).not.toContain('/app/api/alerts');
  });
});
