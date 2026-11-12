'use strict';

const plans = require('../config/plans');
const pricing = require('../config/pricing');

function caps() {
  const cfg = plans.current();
  return {
    freeSearches: cfg.free.searchesPerMonth,
    freeAlerts: cfg.free.maxActiveAlerts,
    trialDays: cfg.trial.days,
    trialAlerts: cfg.trial.maxActiveAlerts,
    trialInstant: cfg.trial.instantTotalMax,
    proAlerts: cfg.pro.maxActiveAlerts,
    proDays: cfg.pro.days || pricing.proDays(),
  };
}

module.exports = {
  maintenance: 'Estamos en mantenimiento, volvé en un rato',
  wait: 'Esperá un toque',
  slow: 'Estás yendo muy rápido. Probá de nuevo en un rato.',
  searchOff: 'La búsqueda todavía no está prendida.',
  alertsOff: 'Las alertas todavía no están prendidas.',
  get paywall() {
    const c = caps();
    return `Llegaste a las ${c.freeSearches} búsquedas gratis de este mes. Con Pro buscás sin límite (uso justo), te aviso sin esperar al resumen de las 21:00 cuando un precio baja de tu techo y te llega el informe diario.`;
  },
  proCapMinute: 'Vas muy rápido. Esperá un minuto y seguí buscando.',
  proCapDay: (n) => `Por hoy llegaste a ${n} búsquedas, el tope para evitar abusos. Mañana seguís sin límite.`,
  get alertsPaywall() {
    const c = caps();
    return `Ya usás todas las alertas activas de tu plan (${c.freeAlerts}). Pausá o borrá una, o pasate a Pro para sumar hasta ${c.proAlerts} alertas y avisos sin esperar al resumen.`;
  },
  get trialOn() {
    const c = caps();
    const avisos = c.trialInstant ? ` (${c.trialInstant} avisos sin esperar al resumen y hasta ${c.trialAlerts} alertas)` : ` (hasta ${c.trialAlerts} alertas)`;
    return `Listo: tenés ${c.trialDays} días de prueba de Pro${avisos}. Después seguís con tu alerta gratis.`;
  },
  get trialOver() {
    const c = caps();
    return `Terminó tu prueba de Pro. Quedaron pausadas las alertas que superan el límite (${c.freeAlerts}). Con /pro las volvés a prender.`;
  },
  get payOver() {
    return 'No pude cobrar tu Pro. Pausé las alertas extra. Renovalo con /pro y reactivo las que pausé.';
  },
  get terms() {
    const c = caps();
    return `Pro se paga por mes (${c.proDays} días) y podés cancelarlo cuando quieras. Los precios de los vuelos son orientativos y pueden cambiar antes de comprar. Privacidad: el país de la conexión lo estimamos con una base GeoIP local en el servidor. La IP no se manda a otro servicio.`;
  },
  get paysupport() {
    const contact = String(process.env.SUPPORT_CONTACT || '').trim();
    const extra = contact ? ` Contacto de soporte: ${contact}.` : '';
    return `Si un pago con Stars no se acreditó o necesitás ayuda, escribinos.${extra} No mandes datos de tarjeta.`;
  },
  help: [
    'Comandos:',
    '/buscar: precio más barato para una ruta y fecha',
    '/nueva_alerta: guardar una ruta con tu techo de precio',
    '/mis_alertas: ver y pausar tus alertas',
    '/informe: tu informe con precios al momento (Pro, hasta 2 por día)',
    '/pro: planes y pago',
    '/cancel: cortar lo que estabas haciendo',
    '',
    'Un producto de Ranuk IT Solutions · https://ranuk.dev',
  ].join('\n'),
  starsOff: 'El pago con estrellas todavía no está prendido.',
  welcome: (name) => {
    const c = caps();
    const who = name ? `, ${name}` : '';
    return [
      `Hola${who}.`,
      'Busco vuelos baratos entre Latinoamérica y Europa.',
      `Tenés ${c.freeSearches} búsquedas por mes y ${c.freeAlerts} alerta activa sin tarjeta.`,
      `Las funciones Pro se prueban ${c.trialDays} días, una sola vez.`,
      'Con Pro: búsquedas ilimitadas (uso justo), avisos sin esperar al resumen de las 21:00 e informe diario.',
      '',
      '/buscar  /alertas  /pro  /ayuda',
      '',
      'Un producto de Ranuk IT Solutions · https://ranuk.dev',
    ].join('\n');
  },
};
