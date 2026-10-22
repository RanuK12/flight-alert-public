'use strict';

module.exports = {
  maintenance: 'Estamos en mantenimiento, volvé en un rato',
  wait: 'Esperá un toque',
  slow: 'Estás yendo muy rápido. Probá de nuevo en un rato.',
  searchOff: 'La búsqueda todavía no está prendida.',
  alertsOff: 'Las alertas todavía no están prendidas.',
  paywall: 'Llegaste a las 10 búsquedas gratis de este mes. Con Pro buscás sin límite, te aviso al toque cuando un precio baja de tu techo y te llega el informe de las 21.',
  proCapMinute: 'Vas muy rápido. Esperá un minuto y seguí buscando.',
  proCapDay: (n) => `Por hoy llegaste a ${n} búsquedas, el tope para evitar abusos. Mañana seguís sin límite.`,
  alertsPaywall: 'Las alertas y el informe diario van con Pro. La prueba es una sola, por 7 días.',
  trialOn: 'Listo: tenés 7 días de prueba para las alertas y el informe de las 21. Después sigue con Pro.',
  trialOver: 'Se terminó la prueba. Pausé tus alertas. Con /pro las volvés a prender.',
  payOver: 'Se venció el pago. Pausé tus alertas. Cuando pagues, quedan como estaban.',
  terms: 'Pro es una suscripción de 30 días. Podés dejar de renovar cuando quieras. Los precios de los vuelos son orientativos y pueden cambiar antes de comprar. Privacidad: el país de la conexión lo estimamos con una base GeoIP local en el servidor. La IP no se manda a otro servicio.',
  paysupport: 'Si un pago no se acreditó, escribinos por este chat y lo vemos. No mandes datos de la tarjeta.',
  help: [
    'Comandos:',
    '/buscar: precio más barato para una ruta y fecha',
    '/nueva_alerta: guardar una ruta con tu techo de precio',
    '/mis_alertas: ver y pausar tus alertas',
    '/informe: el último informe de las 21:00',
    '/pro: planes y pago',
    '/cancel: cortar lo que estabas haciendo',
    '',
    'Un producto de Ranuk IT Solutions · https://ranuk.dev',
  ].join('\n'),
  starsOff: 'El pago con estrellas todavía no está prendido.',
  welcome: (name) => {
    const who = name ? `, ${name}` : '';
    return [
      `Hola${who}.`,
      'Busco vuelos baratos entre Argentina y Europa.',
      'La primera búsqueda es gratis y después tenés 10 por mes.',
      'La alerta diaria y el informe de las 21 se prueban 7 días, una sola vez.',
      'Con Pro: búsquedas ilimitadas (uso justo), te avisamos cuando un precio baja de tu techo e informe de las 21.',
      '',
      '/buscar  /alertas  /pro  /ayuda',
      '',
      'Un producto de Ranuk IT Solutions · https://ranuk.dev',
    ].join('\n');
  },
};
