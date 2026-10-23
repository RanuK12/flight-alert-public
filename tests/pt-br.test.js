'use strict';
const pages = require('../src/web/pages');
const { renderLanding } = require('../src/web/landing');
const { langOf } = require('../src/bot/ux/i18n');

describe('pt-BR', () => {
  test('landing /pt: html lang pt-BR, canonical /pt, hreflang pt-BR y sin copy en español', () => {
    const html = renderLanding({ lang: 'pt', base: 'https://x.test' });
    expect(html).toContain('<html lang="pt-BR"');
    expect(html).toContain('hreflang="pt-BR" href="https://x.test/pt"');
    expect(html).toContain('Perguntas frequentes');
    expect(html).toContain('Buscas ilimitadas');
    for (const es of ['Preguntas frecuentes', 'Búsquedas ilimitadas', 'Pro con IA', 'Privacidad:']) expect(html).not.toContain(es);
  });

  test('landing es y en siguen iguales y anuncian la alternativa pt-BR', () => {
    const es = renderLanding({ lang: 'es', base: 'https://x.test' });
    const en = renderLanding({ lang: 'en', base: 'https://x.test' });
    expect(es).toContain('<html lang="es"');
    expect(es).toContain('Búsquedas ilimitadas');
    expect(en).toContain('<html lang="en"');
    expect(en).toContain('hreflang="pt-BR"');
    expect(en).not.toContain('Perguntas frequentes');
  });

  test('Pro en pt por idioma, por Brasil o por ?lang=pt; es por defecto', () => {
    expect(pages.proLang({ language: 'pt-BR,pt;q=0.9' })).toBe('pt');
    expect(pages.proLang({ country: 'BR' })).toBe('pt');
    expect(pages.proLang({ lang: 'pt' })).toBe('pt');
    expect(pages.proLang({ language: 'es-AR', country: 'AR' })).toBe('es');
    const br = pages.pro({ choice: 'BR' });
    expect(br).toContain('<html lang="pt-BR"');
    expect(br).toContain('Buscas ilimitadas (uso justo).');
    expect(br).toContain('Seguir com cartão');
    expect(br).toContain('US$5 por mês.');
    expect(br).not.toContain('Búsquedas ilimitadas');
    expect(pages.pro({ choice: 'ES' })).toContain('<html lang="es"');
  });

  test('bot: pt por language_code o por origen GRU/GIG sin idioma', () => {
    expect(langOf({ language_code: 'pt-br' })).toBe('pt');
    expect(langOf({}, { origin: 'GRU' })).toBe('pt');
    expect(langOf({}, { origin: 'GIG' })).toBe('pt');
    expect(langOf({ language_code: 'es' }, { origin: 'GRU' })).toBe('es');
  });
});
