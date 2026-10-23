'use strict';

jest.mock('../src/providers/travelpayouts', () => ({ search: jest.fn().mockResolvedValue([]) }));

const { cleanEnv } = require('./helpers');
const { reset } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const beacon = require('../src/web/cfBeacon');
const { createApp } = require('../src/app');

let server; let base;
beforeAll(async () => {
  cleanEnv(); reset();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { rateLimit.reset(); delete process.env.CF_BEACON_TOKEN; });

test('la landing trae el beacon y la CSP lo permite', async () => {
  const res = await fetch(`${base}/es`, { headers: { Accept: 'text/html' } });
  const html = await res.text();
  expect(html).toContain('https://static.cloudflareinsights.com/beacon.min.js');
  expect(html).toContain(beacon.DEFAULT_TOKEN);
  const csp = res.headers.get('content-security-policy');
  expect(csp).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
  expect(csp).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/);
});

test('se puede apagar con CF_BEACON_TOKEN=off', async () => {
  process.env.CF_BEACON_TOKEN = 'off';
  const html = await (await fetch(`${base}/es`)).text();
  expect(html).not.toContain('cloudflareinsights');
});

test('inject: una sola vez y solo con </body>', () => {
  const once = beacon.inject('<html><body>x</body></html>', beacon.DEFAULT_TOKEN);
  expect(beacon.inject(once, beacon.DEFAULT_TOKEN)).toBe(once);
  expect(beacon.inject('{"a":1}', beacon.DEFAULT_TOKEN)).toBe('{"a":1}');
});
