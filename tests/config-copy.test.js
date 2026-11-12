'use strict';

const fs = require('fs');
const path = require('path');
const { cleanEnv } = require('./helpers');
const { reset } = require('../src/database');
const i18n = require('../src/bot/ux/i18n');
const i18nPt = require('../src/bot/ux/i18n.pt');
const botCopy = require('../src/bot/copy');
const landing = require('../src/web/landing');
const pages = require('../src/web/pages');
const country = require('../src/services/country');

const FORBIDDEN_IMMEDIACY = [
  /\bal instante\b/i,
  /\binstant[aá]nea?\b/i,
  /\bal toque\b/i,
  /\bright away\b/i,
  /\bna hora\b/i,
  /\bilimitad[oa]s?\b(?=.{0,25}alertas?|\s*avisos?)/i,
];

function collectStrings(obj, out = []) {
  if (typeof obj === 'string') {
    out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) collectStrings(v, out);
    return out;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') out.push(`${k}: ${v}`);
      else collectStrings(v, out);
    }
  }
  return out;
}

beforeEach(() => {
  cleanEnv();
  reset();
});

afterEach(() => cleanEnv());

describe('Paridad de copy (ES/EN/PT + Web + Mini App) y fallback MP', () => {
  test('ningún texto visible al usuario promete avisos "al instante" ni términos prohibidos', () => {
    const samples = [];

    for (const lang of ['es', 'en', 'pt']) {
      for (const [key, entry] of Object.entries(i18n.STRINGS)) {
        const val = typeof entry === 'string' ? entry : entry[lang];
        if (typeof val === 'string') samples.push({ src: `i18n.${lang}.${key}`, text: val });
      }
      samples.push({ src: `botCopy.paywall`, text: botCopy.paywall });
      samples.push({ src: `botCopy.alertsPaywall`, text: botCopy.alertsPaywall });
      samples.push({ src: `botCopy.trialOn`, text: botCopy.trialOn });
      samples.push({ src: `botCopy.trialOver`, text: botCopy.trialOver });
      samples.push({ src: `botCopy.payOver`, text: botCopy.payOver });
      samples.push({ src: `botCopy.terms`, text: botCopy.terms });
      samples.push({ src: `botCopy.paysupport`, text: botCopy.paysupport });
      samples.push({ src: `botCopy.welcome`, text: botCopy.welcome('Emilio') });
      samples.push({ src: `landing.${lang}`, text: landing.renderLanding({ lang }) });
    }
    for (const s of collectStrings(i18nPt)) {
      samples.push({ src: 'i18n.pt', text: s });
    }

    samples.push({ src: 'pages.pro.es', text: pages.pro({ choice: 'ES', nonce: 'n1' }) });
    samples.push({ src: 'pages.pro.ar', text: pages.pro({ choice: 'AR', ipCountry: 'AR', ars: 7700, nonce: 'n2' }) });

    const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'app.js'), 'utf8');
    // Chequea solo strings literales de UI dentro de app.js
    const uiLiterals = [...appJs.matchAll(/(['"`])((?:\\.|(?!\1)[^\\]){6,})\1/g)].map((m) => m[2]);
    for (const lit of uiLiterals) {
      if (!/[a-zA-Z]/.test(lit)) continue;
      samples.push({ src: 'public/app/app.js', text: lit });
    }

    for (const item of samples) {
      const visible = item.text
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ');
      for (const re of FORBIDDEN_IMMEDIACY) {
        if (re.test(visible)) {
          throw new Error(`Texto prohibido (${re}) encontrado en ${item.src}: ${visible.slice(0, 160)}`);
        }
      }
    }
  });

  test('ES/EN/PT usan "sin esperar al resumen" y mencionan 3 avisos en el trial', () => {
    expect(i18n.t('es', 'endGot', { k: 1 })).toBe(' Avisos que te llegaron: 1.');
    expect(i18n.t('en', 'endGot', { k: 1 })).toBe(' Alerts you got: 1.');
    expect(i18n.t('pt', 'endGot', { k: 1 })).toBe(' Avisos que você recebeu: 1.');
    expect(i18n.t('es', 'trialEnded', { got: '', paused: '' })).toContain('sin esperar al resumen');
    expect(i18n.t('en', 'trialEnded', { got: '', paused: '' })).toContain('without waiting for the summary');
    expect(i18n.t('pt', 'trialEnded', { got: '', paused: '' })).toContain('sem esperar o resumo');
    expect(i18n.t('es', 'payLapsed', { active: '', paused: '' })).toContain('reactivo las que pausé');
    expect(i18n.t('en', 'payLapsed', { active: '', paused: '' })).toContain("I'll turn the paused ones back on");
    expect(i18n.t('pt', 'payLapsed', { active: '', paused: '' })).toContain('reativo os que pausei');
    expect(botCopy.paywall).toContain('sin esperar al resumen');
    expect(botCopy.welcome('Emilio')).toContain('sin esperar al resumen');
    expect(i18n.t('es', 'trialOn', { days: 7, instant: 3, maxAlerts: 3 })).toContain('3 avisos sin esperar al resumen');
  });

  test('FEATURE_PAYMENTS_MP=off hace fallback limpio a Stripe USD para Argentina', () => {
    delete process.env.FEATURE_PAYMENTS_MP;
    expect(country.rail({ choice: 'AR', ipCountry: 'AR' })).toBe('stripe');
    expect(country.currencyFor('AR', 'AR')).toEqual({ rail: 'stripe', currency: 'USD', unitAmount: 500 });
    const proHtml = pages.pro({ choice: 'AR', ipCountry: 'AR', ars: 7700 });
    expect(proHtml).toContain('US$5');
    expect(proHtml).not.toContain('7700 pesos');
  });
});
