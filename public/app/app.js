/* Mini App Flight Alert v2: Vanilla JS sin dependencias, CSP strict, Option B CTA. */
(function () {
  'use strict';
  var tg = window.Telegram && window.Telegram.WebApp;
  var initData = (tg && tg.initData) || '';
  var langCode = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) || navigator.language || 'es';
  var lang = /^es/i.test(langCode) ? 'es' : (/^pt/i.test(langCode) ? 'pt' : 'en');
  var STR = {
    es: {
      search: 'Buscar vuelo', from: 'Desde', to: 'Hasta', swap: 'Invertir origen y destino', swapOff: 'La ruta invertida no está cubierta',
      oneway: 'Solo ida', round: 'Ida y vuelta', dep: 'Ida', ret: 'Vuelta', pick: 'Elegir', pickDestFirst: 'Elegí destino primero', adults: 'adulto(s)', go: 'Buscar',
      notCovered: 'Todavía no cubrimos {c}. Cubrimos:', calFoot: 'Precios vistos en las últimas horas. Pueden cambiar.',
      cheap: 'barato', mid: 'medio', high: 'caro', nodata: 'sin dato', flex: 'Fechas flexibles: cualquier día del mes', seen: 'visto hace {h} h', seenLt: 'visto hace menos de 1 h',
      offer: 'Ver oferta ↗', alertMe: '🔔 Avisarme', alertExists: 'Ya tenés alerta ✓', cheapest: 'Más barato', fewer: 'Menos escalas', direct: 'Directo', stops: '{n} escala(s)',
      foot: 'Precio en caché, revisado cada 2–3 h. El precio final lo confirma la página. Algunos enlaces son de afiliado.',
      empty: 'No hay precios guardados para estas fechas', tryFlex: 'Probar fechas flexibles', error: 'No pude traer precios ahora', retry: 'Reintentar', wait: 'Esperá unos segundos y probá de nuevo.',
      paywall: 'Usaste tus {n} búsquedas de este mes. Se renuevan el 1°. Con Pro son ilimitadas (uso justo).',
      verPro: 'Ver Pro', proLimitReached: 'Alcanzaste el tope de {n} alertas activas de tu plan Pro. Pausá o borrá una para sumar otra.',
      planConfigDown: 'Ahora no podemos crear ni reactivar alertas por un ajuste temporal. Tus alertas activas siguen funcionando.',
      alerts: 'Mis alertas', none: 'No tenés alertas todavía.', first: 'Crear la primera', active: 'Activa', paused: 'Pausada', pausedPlan: 'Pausada por plan',
      pause: 'Pausar', resume: 'Reanudar', edit: 'Editar', del: 'Borrar', undo: 'Deshacer', confirmDel: '¿Borrar la alerta {r}?', delAlert: 'Borrar alerta {r}',
      deletedToast: 'Alerta borrada', versionConflict: 'Esta alerta se actualizó recién. Recargamos el estado actual.',
      ceiling: 'Techo', last: 'último', save: 'Guardar', saved: 'Alerta actualizada', created: 'Alerta creada', back: 'Volver', next: 'Siguiente',
      confirm: 'Confirmar alerta', notifyLabel: 'Tipo de aviso', notifyDrop: 'Avisos si baja del techo', notifyDaily: 'Resumen de las 21:00',
      suggestOk: 'Sugerido ({s} días): €{p} (mediana €{m})', suggestUse: 'Usar sugerido €{p}',
      suggestCold: 'Recién hay {s} días reales; en 10 días calculamos techo automático.', suggestNone: 'Sin histórico aún; elegí tu techo manual.',
      seriesNone: 'Sin serie diaria aún', seriesCold: '{s} observación(es) — recolectando serie', seriesTitle: 'Últimos {n} días reales',
      stepOf: 'Paso {a} de 3', proTitle: 'Pasate a Flight Alert Pro', proBtn: 'Ir a Pro en el bot',
      proBody: 'Con Pro tenés búsquedas ilimitadas, hasta {max} alertas activas y avisos de bajada sin esperar al resumen de las 21:00. Pago mensual.',
      madeBy: 'Hecho por Ranuk IT', tabSearch: 'Buscar', tabAlerts: 'Mis alertas',
      auth: 'Abrí esta pantalla desde el bot en Telegram.',
      months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
      dows: ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'], of: 'de', euReturn: '🇪🇺 Vuelta desde Europa',
      regAll: 'Todos', regBr: '🇧🇷 Brasil', regCaribe: '🏝️ Caribe', regUs: '🇺🇸 EE. UU.', regAsia: '🇨🇳 Asia', regSur: '🇺🇾🇨🇱 Cono Sur', regEu: '🇪🇺 Europa'
    },
    pt: {
      search: 'Buscar voo', from: 'De', to: 'Para', swap: 'Inverter origem e destino', swapOff: 'A rota invertida não está coberta',
      oneway: 'Só ida', round: 'Ida e volta', dep: 'Ida', ret: 'Volta', pick: 'Escolher', pickDestFirst: 'Escolha o destino primeiro', adults: 'adulto(s)', go: 'Buscar',
      notCovered: 'Ainda não cobrimos {c}. Cobrimos:', calFoot: 'Preços vistos nas últimas horas. Podem mudar.',
      cheap: 'barato', mid: 'médio', high: 'caro', nodata: 'sem dado', flex: 'Datas flexíveis: qualquer dia do mês', seen: 'visto há {h} h', seenLt: 'visto há menos de 1 h',
      offer: 'Ver oferta ↗', alertMe: '🔔 Me avisar', alertExists: 'Alerta ativo ✓', cheapest: 'Mais barato', fewer: 'Menos escalas', direct: 'Direto', stops: '{n} escala(s)',
      foot: 'Preço em cache, revisado a cada 2–3 h. O preço final é confirmado no site. Alguns links são de afiliado.',
      empty: 'Não há preços salvos para estas datas', tryFlex: 'Tentar datas flexíveis', error: 'Não consegui trazer preços agora', retry: 'Tentar de novo', wait: 'Espere alguns segundos e tente de novo.',
      paywall: 'Você usou suas {n} buscas deste mês. Elas renovam no dia 1º. Com o Pro são ilimitadas (uso justo).',
      verPro: 'Ver Pro', proLimitReached: 'Você atingiu o limite de {n} alertas ativos do plano Pro. Pause ou apague um para adicionar outro.',
      planConfigDown: 'Não podemos criar ou reativar alertas agora por um ajuste temporário. Seus alertas ativos continuam funcionando.',
      alerts: 'Meus alertas', none: 'Você ainda não tem alertas.', first: 'Criar o primeiro', active: 'Ativo', paused: 'Pausado', pausedPlan: 'Pausado pelo plano',
      pause: 'Pausar', resume: 'Retomar', edit: 'Editar', del: 'Apagar', undo: 'Desfazer', confirmDel: 'Apagar o alerta {r}?', delAlert: 'Apagar alerta {r}',
      deletedToast: 'Alerta apagado', versionConflict: 'Este alerta foi atualizado recentemente. Recarregando.',
      ceiling: 'Teto', last: 'último', save: 'Salvar', saved: 'Alerta atualizado', created: 'Alerta criado', back: 'Voltar', next: 'Próximo',
      confirm: 'Confirmar alerta', notifyLabel: 'Tipo de aviso', notifyDrop: 'Avisos se cair do teto', notifyDaily: 'Resumo das 21:00',
      suggestOk: 'Sugerido ({s} dias): €{p} (mediana €{m})', suggestUse: 'Usar sugerido €{p}',
      suggestCold: 'Só temos {s} dias reais; com 10 calculamos teto automático.', suggestNone: 'Sem histórico ainda; defina seu teto manual.',
      seriesNone: 'Sem série diária ainda', seriesCold: '{s} ponto(s) — coletando histórico', seriesTitle: 'Últimos {n} dias reais',
      stepOf: 'Passo {a} de 3', proTitle: 'Assine o Flight Alert Pro', proBtn: 'Ir para o Pro no bot',
      proBody: 'Com o Pro você tem buscas ilimitadas, até {max} alertas ativos e avisos de queda sem esperar o resumo das 21:00. Pagamento mensal.',
      madeBy: 'Feito por Ranuk IT', tabSearch: 'Buscar', tabAlerts: 'Meus alertas',
      auth: 'Abra esta tela pelo bot no Telegram.',
      months: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
      dows: ['Se', 'Te', 'Qa', 'Qi', 'Sx', 'Sá', 'Do'], of: 'de', euReturn: '🇪🇺 Volta da Europa',
      regAll: 'Todos', regBr: '🇧🇷 Brasil', regCaribe: '🏝️ Caribe', regUs: '🇺🇸 EUA', regAsia: '🇨🇳 Ásia', regSur: '🇺🇾🇨🇱 Cone Sul', regEu: '🇪🇺 Europa'
    },
    en: {
      search: 'Search flight', from: 'From', to: 'To', swap: 'Swap origin and destination', swapOff: 'The reversed route is not covered',
      oneway: 'One-way', round: 'Round trip', dep: 'Depart', ret: 'Return', pick: 'Pick', pickDestFirst: 'Pick a destination first', adults: 'adult(s)', go: 'Search',
      notCovered: "We don't cover {c} yet. We cover:", calFoot: 'Prices seen in the last few hours. They may change.',
      cheap: 'cheap', mid: 'average', high: 'expensive', nodata: 'no data', flex: 'Flexible dates: any day of the month', seen: 'seen {h} h ago', seenLt: 'seen less than 1 h ago',
      offer: 'See deal ↗', alertMe: '🔔 Alert me', alertExists: 'Alert active ✓', cheapest: 'Cheapest', fewer: 'Fewest stops', direct: 'Direct', stops: '{n} stop(s)',
      foot: 'Cached price, checked every 2–3 h. The final price is confirmed on the site. Some links are affiliate links.',
      empty: 'No saved prices for these dates', tryFlex: 'Try flexible dates', error: "Couldn't fetch prices right now", retry: 'Retry', wait: 'Wait a few seconds and try again.',
      paywall: "You've used your {n} searches this month. They renew on the 1st. Pro is unlimited (fair use).",
      verPro: 'See Pro', proLimitReached: 'You reached your Pro limit of {n} active alerts. Pause or delete one to add another.',
      planConfigDown: 'Creating or reactivating alerts is temporarily paused on our side. Your existing alerts keep running.',
      alerts: 'My alerts', none: 'You have no alerts yet.', first: 'Create the first one', active: 'Active', paused: 'Paused', pausedPlan: 'Paused by plan',
      pause: 'Pause', resume: 'Resume', edit: 'Edit', del: 'Delete', undo: 'Undo', confirmDel: 'Delete the alert {r}?', delAlert: 'Delete alert {r}',
      deletedToast: 'Alert deleted', versionConflict: 'Alert changed elsewhere. Reloading.',
      ceiling: 'Ceiling', last: 'last', save: 'Save', saved: 'Alert updated', created: 'Alert created', back: 'Back', next: 'Next',
      confirm: 'Confirm alert', notifyLabel: 'Alert type', notifyDrop: 'Alerts if below ceiling', notifyDaily: '21:00 daily summary',
      suggestOk: 'Suggested ({s} days): €{p} (median €{m})', suggestUse: 'Use €{p} suggestion',
      suggestCold: '{s} real days collected so far; need 10 days for auto suggestion.', suggestNone: 'No history yet — set your own ceiling.',
      seriesNone: 'No daily history yet', seriesCold: '{s} point(s) — collecting history', seriesTitle: 'Last {n} real days',
      stepOf: 'Step {a} of 3', proTitle: 'Upgrade to Flight Alert Pro', proBtn: 'Open Pro in bot',
      proBody: 'Pro gives you unlimited searches, up to {max} active alerts, and drop alerts without waiting for the 21:00 summary. Billed monthly.',
      madeBy: 'Built by Ranuk IT', tabSearch: 'Search', tabAlerts: 'My alerts',
      auth: 'Open this screen from the bot in Telegram.',
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      dows: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], of: '', euReturn: '🇪🇺 Return from Europe',
      regAll: 'All', regBr: '🇧🇷 Brazil', regCaribe: '🏝️ Caribbean', regUs: '🇺🇸 USA', regAsia: '🇨🇳 Asia', regSur: '🇺🇾🇨🇱 South Cone', regEu: '🇪🇺 Europe'
    }
  };
  var S = STR[lang];
  function tr(k, v) { return String(S[k] || '').replace(/\{(\w+)\}/g, function (_, x) { return v && v[x] !== undefined ? v[x] : ''; }); }
  var root = document.getElementById('root');

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'on') Object.keys(attrs.on).forEach(function (e) { el.addEventListener(e, attrs.on[e]); });
      else if (k === 'text') el.textContent = attrs.text;
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null) continue; (Array.isArray(c) ? c : [c]).forEach(function (n) { if (n != null) el.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); }); }
    return el;
  }
  function sv(tag, attrs) {
    var el = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) el.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
    return el;
  }
  function planeSvg(size) {
    return sv('svg', { width: String(size), height: String(size), viewBox: '0 0 32 32', 'aria-hidden': 'true' },
      sv('rect', { width: '32', height: '32', rx: '7', fill: '#112240' }),
      sv('polygon', { points: '5,16 27,6 13,18', fill: '#64ffda' }),
      sv('polygon', { points: '13,18 27,6 20,26', fill: '#64ffda', opacity: '0.82' }),
      sv('polygon', { points: '13,18 16,25 18,20', fill: '#3fcfae' }));
  }
  function ico(d, size) {
    return sv('svg', { width: String(size || 16), height: String(size || 16), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
      sv('path', { d: d }));
  }
  var IC = {
    search: 'M21 21l-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
    bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
    swap: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
    cal: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    pin: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10zm0-7a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    takeoff: 'M2 19h20M4.5 14.5l3.2-1.5 5.3-5.3 4.8-1.2c1-.2 1.8.6 1.5 1.5l-1.2 4.8-5.3 5.3',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  };
  function ranukSvg(size) {
    return sv('svg', { width: String(size), height: String(size), viewBox: '0 0 32 32', 'aria-hidden': 'true' },
      sv('rect', { width: '32', height: '32', rx: '7', fill: '#0a192f', stroke: '#64ffda', 'stroke-opacity': '0.35' }),
      sv('path', { d: 'M7 8h7a4 4 0 0 1 0 8H7V8zm5 8l5 8', stroke: '#e6f1ff', 'stroke-width': '2.4', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      sv('path', { d: 'M21 8c2.5 0 3 1.8 3 4v1.5c0 1.4.8 2.2 2 2.5-1.2.3-2 1.1-2 2.5V20c0 2.2-.5 4-3 4', stroke: '#64ffda', 'stroke-width': '2.4', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  function uuid4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function botUser() {
    var attr = document.body && document.body.getAttribute ? document.body.getAttribute('data-bot') : '';
    return (attr || (me && me.botUsername) || '').replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
  }
  function openProLink() {
    var b = botUser();
    var url = b ? 'https://t.me/' + b + '?start=pro_search_paywall' : '/pro';
    if (tg && tg.openTelegramLink && b) tg.openTelegramLink(url);
    else if (tg && tg.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener');
  }
  function hap(kind, arg) { try { var H = tg && tg.HapticFeedback; if (!H) return; if (kind === 'sel') H.selectionChanged(); else if (kind === 'imp') H.impactOccurred(arg || 'light'); else H.notificationOccurred(arg); } catch (e) { /* noop */ } }
  function api(method, url, body, extraHeaders) {
    var hdr = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData };
    if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { if (extraHeaders[k] != null) hdr[k] = extraHeaders[k]; });
    return fetch(url, { method: method, headers: hdr, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, data: j }; }); });
  }
  function money(p, c) { return (c === 'EUR' || !c ? '€' : c + ' ') + p; }
  function seen(at) { var hrs = Math.floor((Date.now() - new Date(at).getTime()) / 3600000); return hrs < 1 ? S.seenLt : tr('seen', { h: hrs }); }
  function dm(iso) { var p = iso.split('-'); return Number(p[2]) + ' ' + S.months[Number(p[1]) - 1].slice(0, 3); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function lev(a, b) { var d = []; for (var i = 0; i <= a.length; i++) d[i] = [i]; for (var j = 1; j <= b.length; j++) d[0][j] = j; for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }

  function theme() {
    var light = tg && tg.colorScheme === 'light';
    document.documentElement.classList.toggle('light', !!light);
    if (tg && tg.viewportStableHeight) document.documentElement.style.setProperty('--vh', tg.viewportStableHeight + 'px');
    if (tg && tg.MainButton && tg.MainButton.setParams) tg.MainButton.setParams({ color: light ? '#0f8a6f' : '#64ffda', text_color: light ? '#ffffff' : '#0a192f' });
  }

  var P = { origins: [], destinations: [] };
  var me = { plan: 'free', safeMode: false, quota: { alerts: { used: 0, cap: 1 }, searches: { used: 0, cap: 10 } }, features: { alerts: true } };
  var plansCfg = { free: { searchesPerMonth: 10, maxActiveAlerts: 1 }, pro: { maxActiveAlerts: 30 } };
  var st = { o: null, d: null, t: '2', dep: null, ret: null, adults: 1, flex: false, month: null, results: null, sort: 'price', sessionId: uuid4() };
  var stack = [];
  var mainHandler = null;
  var fallbackBtn = null;

  function setMain(text, enabled, fn) {
    mainHandler = fn;
    if (tg && tg.MainButton) {
      tg.MainButton.setText(text);
      if (enabled) tg.MainButton.enable(); else tg.MainButton.disable();
      tg.MainButton.show();
    } else {
      fallbackBtn = h('button', { type: 'button', 'class': 'primary cta-main fallback-main', disabled: !enabled, on: { click: function () { if (mainHandler) mainHandler(); } }, text: text });
      root.appendChild(fallbackBtn);
    }
  }
  function hideMain() { mainHandler = null; if (tg && tg.MainButton) tg.MainButton.hide(); }
  function renderChrome(activeTab) {
    var planLabel = String(me.plan || 'free').toUpperCase();
    var q = me.quota && me.quota.alerts ? ' ' + me.quota.alerts.used + '/' + me.quota.alerts.cap : '';
    root.appendChild(h('header', { 'class': 'fa-hdr' },
      h('div', { 'class': 'fa-brand' }, planeSvg(28), h('span', { text: 'Flight Alert' })),
      h('span', { 'class': 'badge mono' + (me.plan === 'pro' ? ' on' : ''), text: planLabel + q })));
    if (me.safeMode) root.appendChild(h('div', { 'class': 'fa-banner', role: 'status', text: S.planConfigDown }));
    root.appendChild(h('nav', { 'class': 'fa-tabs' },
      h('button', { type: 'button', 'aria-current': activeTab === 'search' ? 'page' : false, on: { click: function () { stack = [searchScreen]; render(); } } }, ico(IC.search, 16), h('span', { text: S.tabSearch })),
      h('button', { type: 'button', 'aria-current': activeTab === 'alerts' ? 'page' : false, on: { click: function () { stack = [alertsScreen]; render(); } } }, ico(IC.bell, 16), h('span', { text: S.tabAlerts }))));
  }
  function renderFooter() {
    root.appendChild(h('footer', { 'class': 'fa-foot' },
      h('a', { href: 'https://ranuk.dev', target: '_blank', rel: 'noopener noreferrer', on: { click: function (e) { if (tg && tg.openLink) { e.preventDefault(); tg.openLink('https://ranuk.dev'); } } } }, ranukSvg(20), h('span', { text: S.madeBy }))));
  }
  function go(screen) { stack.push(screen); render(); }
  function back() { if (stack.length > 1) { stack.pop(); render(); } else if (tg) tg.close(); }
  function render() {
    root.textContent = '';
    hideMain();
    var top = stack[stack.length - 1];
    if (tg && tg.BackButton) tg.BackButton.show();
    top();
  }

  function covered(list, code) { return list.some(function (p) { return p.code === code; }); }
  function isEu(code) { return P.origins.some(function (p) { return p.code === code && p.eu; }); }
  function sideList(side) {
    if (side === 'o') return P.origins;
    var backRoute = st.o && isEu(st.o);
    return P.destinations.filter(function (p) { return backRoute ? p.ret : !p.ret; });
  }
  var REGIONS = [
    { id: 'br', key: 'regBr', kw: ['brasil', 'brazil', 'playa', 'praia'] },
    { id: 'caribe', key: 'regCaribe', kw: ['caribe', 'caribbean', 'playa'] },
    { id: 'us', key: 'regUs', kw: ['usa', 'eeuu', 'ee. uu.', 'estados unidos', 'united states'] },
    { id: 'asia', key: 'regAsia', kw: ['asia', 'china', 'orient'] },
    { id: 'sur', key: 'regSur', kw: ['cono sur', 'uruguay', 'chile'] },
    { id: 'eu', key: 'regEu', kw: ['europa', 'europe'] }
  ];
  function regionKeywords(reg) {
    for (var i = 0; i < REGIONS.length; i++) if (REGIONS[i].id === reg) return REGIONS[i].kw;
    return [];
  }
  function suggest(q, side) {
    var list = sideList(side), n = norm(q);
    if (!n && side === 'o') return list.filter(function (p) { return !p.eu; });
    if (!n) return list;
    var scored = [];
    list.forEach(function (p, i) {
      var names = [p.city, p.airport, p.country].concat(p.alias || []).filter(Boolean).map(norm);
      var kws = regionKeywords(p.region).map(norm);
      var allTerms = names.concat(kws), s = null;
      if (p.code.toLowerCase() === n) s = 0;
      else if (allTerms.some(function (x) { return x.indexOf(n) === 0; })) s = 1;
      else if (allTerms.some(function (x) { return x.indexOf(n) >= 0; })) s = 2;
      else if (n.length >= 4) { var maxD = n.length >= 5 ? 2 : 1; var b = Math.min.apply(null, names.map(function (x) { return lev(x, n); })); if (b <= maxD) s = 3 + b; }
      if (s !== null) scored.push({ p: p, s: s, i: i });
    });
    scored.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    return scored.slice(0, 24).map(function (x) { return x.p; });
  }
  function labelOf(code) { var all = P.origins.concat(P.destinations); for (var i = 0; i < all.length; i++) if (all[i].code === code) return all[i].label; return code; }

  function cityField(side) {
    var wrap = h('div', { 'class': 'card' }), id = 'f-' + side, regFilter = 'all';
    var input = h('input', { type: 'text', id: id, autocomplete: 'off', value: st[side] ? labelOf(st[side]) : '', 'aria-autocomplete': 'list' });
    var ul = h('ul', { 'class': 'sugg', role: 'listbox' });
    function fill(forceOpen) {
      ul.textContent = '';
      var q = forceOpen && st[side] && labelOf(st[side]) === input.value ? '' : input.value;
      if (!forceOpen && st[side] && labelOf(st[side]) === q) return;
      var res = suggest(q, side);
      if (!res.length && norm(q).length >= 3) {
        var all = sideList(side);
        ul.appendChild(h('li', { 'class': 'muted', text: tr('notCovered', { c: q }) }));
        res = all.slice(0, 8);
      }
      var pickBtn = function (p) {
        return h('li', null, h('button', { type: 'button', role: 'option', on: { click: function () { if (side === 'o' && isEu(p.code) !== isEu(st.o)) st.d = null; st[side] = p.code; hap('sel'); if (side === 'd') st.month = null; render(); } } }, p.label + ' · ' + p.country));
      };
      var backRoute = st.o && isEu(st.o);
      if (side === 'd' && !norm(q) && !backRoute) {
        var availRegs = REGIONS.filter(function (rg) { return res.some(function (p) { return (p.region || 'eu') === rg.id; }); });
        if (availRegs.length > 1) {
          var tabsLi = h('li', { 'class': 'sugg-tabs', role: 'presentation' });
          var mkTab = function (regId, label) {
            return h('button', { type: 'button', 'class': 'sugg-tab', 'aria-pressed': String(regFilter === regId), text: label, on: { mousedown: function (e) { e.preventDefault(); }, click: function () { regFilter = regId; hap('sel'); fill(true); } } });
          };
          tabsLi.appendChild(mkTab('all', S.regAll));
          availRegs.forEach(function (rg) { tabsLi.appendChild(mkTab(rg.id, S[rg.key])); });
          ul.appendChild(tabsLi);
          availRegs.forEach(function (rg) {
            if (regFilter !== 'all' && regFilter !== rg.id) return;
            var group = res.filter(function (p) { return (p.region || 'eu') === rg.id; });
            if (!group.length) return;
            ul.appendChild(h('li', { 'class': 'sugg-head', role: 'presentation', text: S[rg.key] }));
            group.forEach(function (p) { ul.appendChild(pickBtn(p)); });
          });
          return;
        }
      }
      res.forEach(function (p) { ul.appendChild(pickBtn(p)); });
      if (side === 'o' && !norm(q)) {
        var hubs = P.origins.filter(function (p) { return p.eu && p.hub; });
        if (hubs.length) { ul.appendChild(h('li', { 'class': 'sugg-head', role: 'presentation', text: S.euReturn })); hubs.forEach(function (p) { ul.appendChild(pickBtn(p)); }); }
      }
    }
    input.addEventListener('input', function () { st[side] = null; regFilter = 'all'; fill(false); validMain(); });
    input.addEventListener('focus', function () { if (input.value) try { input.select(); } catch (_) {} fill(true); });
    wrap.appendChild(h('label', { 'for': id }, ico(side === 'o' ? IC.takeoff : IC.pin, 14), h('span', { text: side === 'o' ? S.from : S.to })));
    wrap.appendChild(input);
    wrap.appendChild(ul);
    return wrap;
  }
  function canSwap() { return st.o && st.d && covered(P.origins, st.d) && covered(P.destinations, st.o); }
  function ready() { return st.o && st.d && st.dep && (st.t === '1' || st.ret || st.flex); }
  function validMain() {
    if (tg && tg.MainButton) { if (ready()) tg.MainButton.enable(); else tg.MainButton.disable(); }
    if (fallbackBtn) fallbackBtn.disabled = !ready();
  }

  function searchScreen() {
    renderChrome('search');
    root.appendChild(h('h1', { text: S.search }));
    root.appendChild(cityField('o'));
    var swap = h('button', { type: 'button', 'class': 'swap', 'aria-label': S.swap, title: canSwap() ? S.swap : S.swapOff, disabled: !canSwap(), on: { click: function () { var x = st.o; st.o = st.d; st.d = x; hap('sel'); render(); } } }, ico(IC.swap, 18));
    root.appendChild(h('div', { 'class': 'swap-row' }, swap));
    root.appendChild(cityField('d'));
    root.appendChild(h('div', { 'class': 'seg', role: 'group' },
      h('button', { type: 'button', 'aria-pressed': st.t === '1' ? 'true' : 'false', on: { click: function () { st.t = '1'; hap('sel'); render(); } }, text: S.oneway }),
      h('button', { type: 'button', 'aria-pressed': st.t === '2' ? 'true' : 'false', on: { click: function () { st.t = '2'; hap('sel'); render(); } }, text: S.round })));
    var dateBtn = function (label, value, empty) {
      return h('button', { type: 'button', 'class': 'date' + (empty ? ' empty' : ''), disabled: !(st.o && st.d), 'aria-describedby': (st.o && st.d) ? null : 'date-hint', on: { click: function () { go(calendarScreen); } } },
        h('small', null, ico(IC.cal, 12), h('span', { text: label })), h('strong', { text: value }));
    };
    var depText = st.dep ? (st.flex ? S.months[Number(st.dep.slice(5, 7)) - 1] : dm(st.dep)) : S.pick;
    root.appendChild(h('div', { 'class': 'row dates' }, dateBtn(S.dep, depText, !st.dep), st.t === '2' ? dateBtn(S.ret, st.ret ? dm(st.ret) : (st.flex ? '—' : S.pick), !st.ret) : null));
    if (!(st.o && st.d)) root.appendChild(h('p', { 'class': 'date-hint', id: 'date-hint', text: S.pickDestFirst }));
    root.appendChild(h('div', { 'class': 'card stepper' },
      h('span', { 'class': 'grow mono row', style: 'gap:8px;flex:1' }, ico(IC.user, 16), h('span', { text: st.adults + ' ' + S.adults })),
      h('button', { type: 'button', 'aria-label': '−', disabled: st.adults <= 1, on: { click: function () { st.adults--; hap('imp', 'light'); render(); } } }, '−'),
      h('button', { type: 'button', 'aria-label': '+', disabled: st.adults >= 9, on: { click: function () { st.adults++; hap('imp', 'light'); render(); } } }, '+')));
    renderFooter();
    setMain(S.go, ready(), doSearch);
  }

  function ymCode(y, m) { return String(y).slice(2) + String(m).padStart(2, '0'); }
  function calendarScreen() {
    var now = new Date();
    if (!st.month) st.month = { y: now.getFullYear(), m: now.getMonth() + 1 };
    var y = st.month.y, m = st.month.m;
    root.appendChild(h('div', { 'class': 'row cal-head' },
      h('h1', { text: S.months[m - 1] + ' ' + y }),
      h('button', { type: 'button', 'aria-label': '‹', disabled: y === now.getFullYear() && m === now.getMonth() + 1, on: { click: function () { st.month = m === 1 ? { y: y - 1, m: 12 } : { y: y, m: m - 1 }; render(); } } }, '‹'),
      h('button', { type: 'button', 'aria-label': '›', on: { click: function () { st.month = m === 12 ? { y: y + 1, m: 1 } : { y: y, m: m + 1 }; render(); } } }, '›')));
    var grid = h('div', { 'class': 'cal', role: 'grid' });
    S.dows.forEach(function (d) { grid.appendChild(h('div', { 'class': 'dow', text: d })); });
    root.appendChild(grid);
    root.appendChild(h('div', { 'class': 'legend', 'aria-hidden': 'true' }, ['cheap', 'mid', 'high', 'nodata'].map(function (k) { return h('span', null, h('i', { 'class': 'sw ' + k }), S[k]); })));
    root.appendChild(h('button', { type: 'button', on: { click: function () { st.flex = true; st.dep = y + '-' + String(m).padStart(2, '0') + '-01'; st.ret = null; hap('sel'); back(); } } }, S.flex));
    root.appendChild(h('p', { 'class': 'muted cal-foot', text: S.calFoot }));
    var today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    api('GET', '/app/api/calendar?o=' + st.o + '&d=' + st.d + '&m=' + ymCode(y, m) + '&t=' + st.t).then(function (r) {
      var days = r.status === 200 ? r.data : [];
      var by = {}; (days || []).forEach(function (d) { by[d.day] = d; });
      var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); var pad = (first + 6) % 7;
      for (var i = 0; i < pad; i++) grid.appendChild(h('span'));
      var n = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (var d = 1; d <= n; d++) (function (d) {
        var iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var info = by[iso], cls = info ? info.level : 'nodata';
        if (st.dep && !st.flex && iso === st.dep) cls += ' sel';
        if (st.ret && iso === st.ret) cls += ' sel';
        if (st.dep && st.ret && iso > st.dep && iso < st.ret) cls += ' inrange';
        var lbl = d + ' ' + S.of + ' ' + S.months[m - 1] + (info ? ', ' + money(info.price, info.currency) + ', ' + S[info.level] + ', ' + seen(info.seen_at) : ', ' + S.nodata);
        grid.appendChild(h('button', { type: 'button', 'class': cls, 'aria-label': lbl, disabled: iso < today, on: { click: function () {
          hap('sel'); st.flex = false;
          if (st.t === '1') { st.dep = iso; st.ret = null; back(); return; }
          if (!st.dep || st.ret || iso <= st.dep) { st.dep = iso; st.ret = null; render(); return; }
          st.ret = iso; back();
        } } }, h('span', { text: String(d) }), info ? h('small', { text: (info.level === 'cheap' ? '↓' : '') + money(info.price, info.currency) }) : null));
      })(d);
    });
  }

  function proSheet(reasonText) {
    renderChrome('alerts');
    root.appendChild(h('h1', { text: S.proTitle }));
    var maxPro = (plansCfg.pro && plansCfg.pro.maxActiveAlerts) || 30;
    root.appendChild(h('div', { 'class': 'card' },
      reasonText ? h('p', { text: reasonText }) : null,
      h('p', { text: tr('proBody', { max: maxPro }) }),
      h('div', { 'class': 'row', style: 'margin:8px 0 12px' },
        h('div', { 'class': 'fa-brand' }, ranukSvg(18), h('span', { 'class': 'muted', text: S.madeBy + ' · ranuk.dev' }))),
      h('div', { 'class': 'row' },
        h('button', { type: 'button', 'class': 'primary cta-main', on: { click: openProLink }, text: S.verPro }),
        h('button', { type: 'button', on: { click: back }, text: S.back }))));
    renderFooter();
  }

  function doSearch() {
    if (!ready()) return;
    st.sessionId = uuid4();
    if (tg && tg.MainButton) tg.MainButton.showProgress();
    api('POST', '/app/api/search', { o: st.o, d: st.d, dep: st.dep, ret: st.t === '2' ? st.ret : null, adults: st.adults, flex: st.flex }).then(function (r) {
      if (tg && tg.MainButton) tg.MainButton.hideProgress();
      st.results = r;
      hap('notif', r.status === 200 ? 'success' : 'error');
      go(resultsScreen);
    }, function () { if (tg && tg.MainButton) tg.MainButton.hideProgress(); st.results = { status: 0 }; hap('notif', 'error'); go(resultsScreen); });
  }

  function resultsScreen() {
    renderChrome('search');
    var r = st.results || {};
    root.appendChild(h('h1', { text: st.o + ' → ' + st.d }));
    if (r.status === 401) { root.appendChild(h('p', { text: S.auth })); return; }
    if (r.status === 402) {
      var lim = (r.data && r.data.error && r.data.error.limit) || (plansCfg.free && plansCfg.free.searchesPerMonth) || 10;
      root.appendChild(h('div', { 'class': 'card' },
        h('p', { text: tr('paywall', { n: lim }) }),
        h('button', { type: 'button', 'class': 'primary cta-main', on: { click: openProLink }, text: S.verPro })));
      renderFooter();
      return;
    }
    if (r.status !== 200) {
      root.appendChild(h('div', { 'class': 'card' },
        h('p', { text: r.status === 429 ? S.wait : (r.status === 403 || r.status === 503) && r.data && r.data.text ? r.data.text : S.error }),
        h('button', { type: 'button', on: { click: function () { stack.pop(); doSearch(); } } }, S.retry)));
      return;
    }
    var list = (r.data.results || []).slice();
    if (!list.length) {
      root.appendChild(h('div', { 'class': 'card' }, h('p', { text: S.empty }), h('button', { type: 'button', on: { click: function () { st.flex = true; stack.pop(); doSearch(); } } }, S.tryFlex)));
      return;
    }
    list.sort(st.sort === 'stops' ? function (a, b) { return a.stops - b.stops || a.price - b.price; } : function (a, b) { return a.price - b.price; });
    root.appendChild(h('div', { 'class': 'chips' },
      h('button', { type: 'button', 'aria-pressed': st.sort === 'price' ? 'true' : 'false', on: { click: function () { st.sort = 'price'; render(); } } }, S.cheapest),
      h('button', { type: 'button', 'aria-pressed': st.sort === 'stops' ? 'true' : 'false', on: { click: function () { st.sort = 'stops'; render(); } } }, S.fewer)));
    list.forEach(function (x) {
      var rightBtn = x.existingAlertId
        ? h('button', { type: 'button', on: { click: function () { stack = [function () { alertsScreen(x.existingAlertId); }]; render(); } } }, S.alertExists)
        : h('button', { type: 'button', on: { click: function () { startCreateFlow(x); } } }, S.alertMe);
      root.appendChild(h('div', { 'class': 'card' },
        h('div', { 'class': 'row' }, h('strong', { text: x.origin + ' → ' + x.destination }), h('span', { 'class': 'muted', text: x.returnDate ? '⇄ ' + S.round : '→ ' + S.oneway })),
        h('div', { 'class': 'price', text: money(x.price, x.currency) }),
        h('div', { text: dm(x.departureDate) + (x.returnDate ? ' → ' + dm(x.returnDate) : '') + ' · ' + (x.stops === 0 ? S.direct : tr('stops', { n: x.stops })) }),
        h('div', { 'class': 'seen', text: seen(x.seen_at) }),
        h('div', { 'class': 'row' },
          h('button', { type: 'button', 'class': 'primary cta-main', on: { click: function () { if (tg && tg.openLink) tg.openLink(x.url); else window.open(x.url, '_blank', 'noopener'); } } }, S.offer),
          rightBtn)));
    });
    root.appendChild(h('p', { 'class': 'muted res-foot', text: S.foot }));
    renderFooter();
  }

  function handleAlertApiError(r) {
    var err = (r.data && r.data.error) || {};
    if (r.status === 503 || err.code === 'PLAN_CONFIG_UNAVAILABLE') { toast(S.planConfigDown); return; }
    if (r.status === 409 && err.code === 'LIMIT_REACHED') { toast(tr('proLimitReached', { n: err.cap || 30 })); return; }
    if (r.status === 402 || err.code === 'PAYWALL') { go(function () { proSheet((r.data && r.data.text) || err.text); }); return; }
    toast((r.data && r.data.text) || S.error);
  }

  function startCreateFlow(x) {
    var draft = { o: x.origin, d: x.destination, dep: x.departureDate, ret: x.returnDate || null, notify: 'drop', ceiling: x.price || 600, ceilingSource: 'manual', step: 1, suggest: null, idem: uuid4() };
    var trip = draft.ret ? '2' : '1';
    api('GET', '/app/api/suggest?o=' + draft.o + '&d=' + draft.d + '&t=' + trip).then(function (sr) {
      if (sr.status === 200) { draft.suggest = sr.data; if (sr.data.suggested && draft.ceilingSource !== 'manual') draft.ceiling = sr.data.suggested; render(); }
    });
    go(function createWizard() {
      renderChrome('search');
      root.appendChild(h('h1', { text: draft.o + ' → ' + draft.d }));
      root.appendChild(h('div', { 'class': 'step-pills' }, [1, 2, 3].map(function (n) { return h('div', { 'class': 'step-pill' + (draft.step >= n ? ' on' : '') }); })));
      root.appendChild(h('p', { 'class': 'muted', text: tr('stepOf', { a: draft.step }) }));
      var card = h('div', { 'class': 'card' });
      if (draft.step === 1) {
        card.appendChild(h('div', { text: dm(draft.dep) + (draft.ret ? ' → ' + dm(draft.ret) : '') }));
        card.appendChild(h('label', { 'for': 'nw-not', text: S.notifyLabel }));
        var sel = h('select', { id: 'nw-not', on: { change: function (e) { draft.notify = e.target.value; } } },
          h('option', { value: 'drop', selected: draft.notify === 'drop' ? 'selected' : null, text: S.notifyDrop }),
          h('option', { value: 'daily', selected: draft.notify === 'daily' ? 'selected' : null, text: S.notifyDaily }));
        card.appendChild(sel);
        card.appendChild(h('div', { 'class': 'row', style: 'margin-top:12px' },
          h('button', { type: 'button', on: back, text: S.back }),
          h('button', { type: 'button', 'class': 'primary cta-main', on: function () { draft.step = 2; render(); }, text: S.next })));
      } else if (draft.step === 2) {
        var sg = draft.suggest;
        var sMsg = !sg ? '' : (sg.confidence === 'ok' && sg.suggested ? tr('suggestOk', { s: sg.samples, p: sg.suggested, m: sg.median }) : (sg.confidence === 'cold' ? tr('suggestCold', { s: sg.samples }) : S.suggestNone));
        if (sMsg) card.appendChild(h('p', { 'class': 'muted', text: sMsg }));
        if (sg && sg.suggested) card.appendChild(h('button', { type: 'button', on: function () { draft.ceiling = sg.suggested; draft.ceilingSource = 'suggested'; render(); }, text: tr('suggestUse', { p: sg.suggested }) }));
        card.appendChild(h('label', { 'for': 'nw-ceil', text: S.ceiling + ' (€)' }));
        card.appendChild(h('input', { type: 'number', id: 'nw-ceil', min: 50, max: 9999, value: draft.ceiling, on: { input: function (e) { draft.ceiling = Number(e.target.value); draft.ceilingSource = 'manual'; } } }));
        card.appendChild(h('div', { 'class': 'row', style: 'margin-top:12px' },
          h('button', { type: 'button', on: function () { draft.step = 1; render(); }, text: S.back }),
          h('button', { type: 'button', 'class': 'primary cta-main', on: function () { draft.step = 3; render(); }, text: S.next })));
      } else {
        card.appendChild(h('div', { 'class': 'price', text: S.ceiling + ': €' + draft.ceiling }));
        card.appendChild(h('div', { 'class': 'muted', text: dm(draft.dep) + (draft.ret ? ' → ' + dm(draft.ret) : '') + ' · ' + (draft.notify === 'drop' ? S.notifyDrop : S.notifyDaily) }));
        card.appendChild(h('div', { 'class': 'row', style: 'margin-top:12px' },
          h('button', { type: 'button', on: function () { draft.step = 2; render(); }, text: S.back }),
          h('button', { type: 'button', 'class': 'primary cta-main', on: function () {
            api('POST', '/app/api/alerts', {
              o: draft.o, d: draft.d, dep: draft.dep, ret: draft.ret, ceiling: draft.ceiling, ceilingSource: draft.ceilingSource, notify: draft.notify,
            }, { 'Idempotency-Key': draft.idem, 'X-FA-From': 'search', 'X-FA-Session-Id': st.sessionId }).then(function (r) {
              hap('notif', r.status === 200 ? 'success' : 'error');
              if (r.status === 200) { stack = [alertsScreen]; render(); toast(S.created); }
              else handleAlertApiError(r);
            });
          }, text: S.confirm })));
      }
      root.appendChild(card);
      renderFooter();
    });
  }

  var toastEl = null;
  function toast(text, action, fn, ms) {
    if (toastEl) toastEl.remove();
    toastEl = h('div', { 'class': 'toast', role: 'status' }, h('span', { text: text }), action ? h('button', { type: 'button', on: { click: function () { fn(); toastEl.remove(); } } }, action) : null);
    document.body.appendChild(toastEl);
    var el = toastEl;
    setTimeout(function () { if (el.parentNode) el.remove(); }, ms || 5000);
  }

  function renderSparkline(box, res) {
    box.textContent = '';
    if (!res || !res.points || !res.points.length) { box.appendChild(h('div', { 'class': 'muted', text: S.seriesNone })); return; }
    if (res.points.length === 1) { box.appendChild(h('div', { 'class': 'muted mono', text: tr('seriesCold', { s: 1 }) + ' · ' + money(res.points[0].price, res.points[0].currency) })); return; }
    var pts = res.points, vals = pts.map(function (p) { return p.price; });
    if (res.ceiling) vals.push(res.ceiling);
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = Math.max(1, max - min);
    var W = 280, H = 52;
    var poly = pts.map(function (p, i) {
      var px = Math.round((i / (pts.length - 1)) * (W - 8) + 4);
      var py = Math.round(H - 6 - ((p.price - min) / span) * (H - 12));
      return px + ',' + py;
    }).join(' ');
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': tr('seriesTitle', { n: pts.length }) });
    if (res.ceiling) {
      var cy = Math.round(H - 6 - ((res.ceiling - min) / span) * (H - 12));
      svg.appendChild(sv('line', { x1: '0', x2: String(W), y1: String(cy), y2: String(cy), stroke: '#f59e0b', 'stroke-dasharray': '4 3', 'stroke-width': '1.2' }));
    }
    svg.appendChild(sv('polyline', { points: poly, fill: 'none', stroke: '#64ffda', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    box.appendChild(svg);
    box.appendChild(h('div', { 'class': 'spark-meta mono' }, h('span', { text: 'min €' + min }), h('span', { text: tr('seriesTitle', { n: pts.length }) }), h('span', { text: 'max €' + max })));
  }

  function alertsScreen(focusId) {
    renderChrome('alerts');
    root.appendChild(h('h1', { text: S.alerts }));
    api('GET', '/app/api/alerts').then(function (r) {
      if (r.status === 401) { root.appendChild(h('p', { text: S.auth })); return; }
      var list = Array.isArray(r.data) ? r.data : (r.data.items || r.data.alerts || []);
      var quotaText = (r.data && r.data.cap != null) ? ' (' + r.data.used + '/' + r.data.cap + ')' : ' (' + list.length + ')';
      root.querySelector('h1').textContent = S.alerts + quotaText;
      if (!list.length) {
        root.appendChild(h('p', { text: S.none }));
        root.appendChild(h('button', { type: 'button', 'class': 'primary cta-main', on: { click: function () { stack = [searchScreen]; render(); } } }, S.first));
        renderFooter();
        return;
      }
      list.forEach(function (a) {
        var card = h('div', { 'class': 'card', id: 'alert-' + a.id });
        var m = a.outboundDate ? S.months[Number(a.outboundDate.slice(5, 7)) - 1].slice(0, 3) : '';
        var badgeCls = 'badge' + (!a.paused ? ' on' : (a.pausedReason === 'plan_limit' ? ' warn' : ''));
        var badgeTxt = !a.paused ? '● ' + S.active : (a.pausedReason === 'plan_limit' ? S.pausedPlan : S.paused);
        card.appendChild(h('div', { 'class': 'row' }, h('strong', { text: a.origin + ' → ' + a.destination + (m ? ' · ' + m : '') + (a.tripType === 'roundtrip' ? ' · ⇄' : '') }), h('span', { 'class': badgeCls, text: badgeTxt })));
        card.appendChild(h('div', { 'class': 'muted mono', text: (a.ceiling ? S.ceiling + ' ' + money(a.ceiling, a.currency) : '') + (a.lastPrice ? ' · ' + S.last + ' ' + money(a.lastPrice, 'EUR') : '') }));
        var sparkBox = h('div', { 'class': 'spark', text: '…' });
        card.appendChild(sparkBox);
        api('GET', '/app/api/alerts/' + a.id + '/series').then(function (sr) { if (sr.status === 200) renderSparkline(sparkBox, sr.data); else sparkBox.remove(); });
        var edCeil = h('input', { type: 'number', id: 'c-' + a.id, min: 50, max: 9999, value: a.ceiling || 600 });
        var edDep = h('input', { type: 'date', id: 'd-' + a.id, value: a.outboundDate || '' });
        var edRet = a.tripType === 'roundtrip' ? h('input', { type: 'date', id: 'r-' + a.id, value: a.returnDate || '' }) : null;
        var edNot = h('select', { id: 'n-' + a.id },
          h('option', { value: 'drop', selected: a.notify === 'drop' ? 'selected' : null, text: S.notifyDrop }),
          h('option', { value: 'daily', selected: a.notify === 'daily' ? 'selected' : null, text: S.notifyDaily }));
        var editor = h('div', { hidden: true },
          h('label', { 'for': 'c-' + a.id, text: S.ceiling + ' (€)' }),
          h('input', { type: 'range', min: 50, max: 3000, step: 10, value: a.ceiling || 600, 'aria-label': S.ceiling, on: { input: function (e) { edCeil.value = e.target.value; } } }),
          edCeil,
          h('label', { 'for': 'd-' + a.id, text: S.dep }), edDep,
          edRet ? h('label', { 'for': 'r-' + a.id, text: S.ret }) : null, edRet,
          h('label', { 'for': 'n-' + a.id, text: S.notifyLabel }), edNot,
          h('button', { type: 'button', 'class': 'primary cta-main', style: 'margin-top:8px;width:100%', on: { click: function () {
            var patch = { ceiling: Number(edCeil.value), notify: edNot.value, version: a.version || 1 };
            if (edDep.value) patch.outboundDate = edDep.value;
            if (edRet && edRet.value) patch.returnDate = edRet.value;
            api('PATCH', '/app/api/alerts/' + a.id, patch, { 'If-Match': String(a.version || 1) }).then(function (x) {
              hap('notif', x.status === 200 ? 'success' : 'error');
              if (x.status === 409 && x.data && x.data.error && x.data.error.code === 'VERSION_CONFLICT') { toast(S.versionConflict); render(); }
              else if (x.status === 200) { toast(S.saved); render(); }
              else handleAlertApiError(x);
            });
          } } }, S.save));
        card.appendChild(h('div', { 'class': 'row' },
          h('button', { type: 'button', on: { click: function () {
            var next = !a.paused; hap('imp', 'light');
            api('PATCH', '/app/api/alerts/' + a.id, { paused: next, version: a.version || 1 }, { 'If-Match': String(a.version || 1) }).then(function (x) {
              if (x.status === 200) { render(); if (next) toast(S.paused, S.undo, function () { api('PATCH', '/app/api/alerts/' + a.id, { paused: false }).then(render); }, 30000); }
              else if (x.status === 409 && x.data && x.data.error && x.data.error.code === 'VERSION_CONFLICT') { toast(S.versionConflict); render(); }
              else handleAlertApiError(x);
            });
          } } }, a.paused ? S.resume : S.pause),
          h('button', { type: 'button', on: { click: function () { editor.hidden = !editor.hidden; } } }, S.edit),
          h('button', { type: 'button', 'aria-label': tr('delAlert', { r: a.origin + ' → ' + a.destination }), on: { click: function () {
            var q = tr('confirmDel', { r: a.origin + ' → ' + a.destination });
            var del = function (ok) {
              if (!ok) return;
              api('DELETE', '/app/api/alerts/' + a.id).then(function (dRes) {
                if (dRes.status === 200) {
                  hap('notif', 'success'); render();
                  toast(S.deletedToast, S.undo, function () {
                    api('POST', '/app/api/alerts/' + a.id + '/restore').then(function (rr) { if (rr.status === 200) render(); else handleAlertApiError(rr); });
                  }, 30000);
                }
              });
            };
            if (tg && tg.showConfirm) tg.showConfirm(q, del); else del(window.confirm(q));
          } } }, '🗑')));
        card.appendChild(editor);
        root.appendChild(card);
        if (focusId === a.id) { editor.hidden = false; card.scrollIntoView(); }
      });
      renderFooter();
    });
  }

  function routeStartParam(start) {
    var s = String(start || '').trim();
    if (!s || s.length > 64) return [searchScreen];
    var m = /^search_([A-Za-z]{3})_([A-Za-z]{3})$/.exec(s);
    if (m) { st.o = m[1].toUpperCase(); st.d = m[2].toUpperCase(); return [searchScreen]; }
    var al = /^alert_([a-f0-9]{24}|m[0-9]{1,9})$/.exec(s);
    if (al) return [function () { alertsScreen(al[1]); }];
    var low = s.toLowerCase();
    if (low === 'alerts') return [alertsScreen];
    if (low === 'pro') return [function () { proSheet(); }];
    if (low === 'novedades') return [searchScreen];
    return [searchScreen];
  }

  function boot() {
    if (tg) {
      tg.ready(); tg.expand(); theme();
      tg.onEvent('themeChanged', theme);
      tg.onEvent('viewportChanged', theme);
      tg.MainButton.onClick(function () { if (mainHandler) mainHandler(); });
      tg.BackButton.onClick(back);
    }
    if (!initData) { root.textContent = ''; root.appendChild(h('p', { text: S.auth })); return; }
    api('GET', '/app/api/places').then(function (r) {
      if (r.status !== 200) { root.textContent = ''; root.appendChild(h('p', { text: S.auth })); return; }
      P = r.data;
      api('GET', '/app/api/me').then(function (mr) {
        if (mr.status === 200 && mr.data && mr.data.plan) { me = mr.data; render(); }
      });
      api('GET', '/app/api/plans').then(function (pr) {
        if (pr.status === 200 && pr.data && pr.data.free) plansCfg = pr.data;
      });
      var start = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
      stack = routeStartParam(start);
      render();
    });
  }
  boot();
})();
