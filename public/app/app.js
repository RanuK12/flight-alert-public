/* Mini App Flight Alert (spec PRISM v2 P0.3–P0.6). Vanilla JS, sin dependencias. */
(function () {
  'use strict';
  var tg = window.Telegram && window.Telegram.WebApp;
  var initData = (tg && tg.initData) || '';
  var lang = /^es/i.test((tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) || navigator.language || 'es') ? 'es' : 'en';
  var S = {
    es: {
      search: 'Buscar vuelo', from: 'Desde', to: 'Hasta', swap: 'Invertir origen y destino', swapOff: 'La ruta invertida no está cubierta',
      oneway: 'Solo ida', round: 'Ida y vuelta', dep: 'Ida', ret: 'Vuelta', pick: 'Elegir', adults: 'adulto(s)', go: 'Buscar', searching: 'Buscando…',
      notCovered: 'Todavía no cubrimos {c}. Cubrimos:', calFoot: 'Precios vistos en las últimas horas. Pueden cambiar.',
      cheap: 'barato', mid: 'medio', high: 'caro', nodata: 'sin dato', flex: 'Fechas flexibles: cualquier día del mes', seen: 'visto hace {h} h', seenLt: 'visto hace menos de 1 h',
      offer: 'Ver oferta ↗', alertMe: '🔔 Avisarme si baja', cheapest: 'Más barato', fewer: 'Menos escalas', direct: 'Directo', stops: '{n} escala(s)',
      foot: 'Precio en caché, revisado cada 2–3 h. El precio final lo confirma la página. Algunos enlaces son de afiliado.',
      empty: 'No hay precios guardados para estas fechas', tryFlex: 'Probar fechas flexibles', error: 'No pude traer precios ahora', retry: 'Reintentar',
      paywall: 'Usaste tus 10 búsquedas de este mes. Se renuevan el 1°. Con Pro son ilimitadas (uso justo).',
      alerts: 'Mis alertas', none: 'No tenés alertas todavía.', first: 'Crear la primera', active: 'Activa', paused: 'Pausada', pause: 'Pausar', resume: 'Reanudar',
      edit: 'Editar', del: 'Borrar', undo: 'Deshacer', confirmDel: '¿Borrar la alerta {r}?', ceiling: 'Techo', last: 'último', save: 'Guardar', created: 'Alerta creada',
      auth: 'Abrí esta pantalla desde el bot en Telegram.', months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
      dows: ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'], newSearch: 'Buscar vuelo', of: 'de'
    },
    en: {
      search: 'Search flight', from: 'From', to: 'To', swap: 'Swap origin and destination', swapOff: 'The reversed route is not covered',
      oneway: 'One-way', round: 'Round trip', dep: 'Depart', ret: 'Return', pick: 'Pick', adults: 'adult(s)', go: 'Search', searching: 'Searching…',
      notCovered: "We don't cover {c} yet. We cover:", calFoot: 'Prices seen in the last few hours. They may change.',
      cheap: 'cheap', mid: 'average', high: 'expensive', nodata: 'no data', flex: 'Flexible dates: any day of the month', seen: 'seen {h} h ago', seenLt: 'seen less than 1 h ago',
      offer: 'See deal ↗', alertMe: '🔔 Alert me if it drops', cheapest: 'Cheapest', fewer: 'Fewest stops', direct: 'Direct', stops: '{n} stop(s)',
      foot: 'Cached price, checked every 2–3 h. The final price is confirmed on the site. Some links are affiliate links.',
      empty: 'No saved prices for these dates', tryFlex: 'Try flexible dates', error: "Couldn't fetch prices right now", retry: 'Retry',
      paywall: "You've used your 10 searches this month. They renew on the 1st. Pro is unlimited (fair use).",
      alerts: 'My alerts', none: 'You have no alerts yet.', first: 'Create the first one', active: 'Active', paused: 'Paused', pause: 'Pause', resume: 'Resume',
      edit: 'Edit', del: 'Delete', undo: 'Undo', confirmDel: 'Delete the alert {r}?', ceiling: 'Ceiling', last: 'last', save: 'Save', created: 'Alert created',
      auth: 'Open this screen from the bot in Telegram.', months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      dows: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], newSearch: 'Search flight', of: ''
    }
  }[lang];
  function tr(k, v) { return String(S[k]).replace(/\{(\w+)\}/g, function (_, x) { return v && v[x] !== undefined ? v[x] : ''; }); }
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
  function hap(kind, arg) { try { var H = tg && tg.HapticFeedback; if (!H) return; if (kind === 'sel') H.selectionChanged(); else if (kind === 'imp') H.impactOccurred(arg || 'light'); else H.notificationOccurred(arg); } catch (e) { /* sin haptics */ } }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, data: j }; }); });
  }
  function money(p, c) { return (c === 'EUR' || !c ? '€' : c + ' ') + p; }
  function seen(at) { var hrs = Math.floor((Date.now() - new Date(at).getTime()) / 3600000); return hrs < 1 ? S.seenLt : tr('seen', { h: hrs }); }
  function dm(iso) { var p = iso.split('-'); return Number(p[2]) + ' ' + S.months[Number(p[1]) - 1].slice(0, 3); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function lev(a, b) { var d = []; for (var i = 0; i <= a.length; i++) { d[i] = [i]; } for (var j = 1; j <= b.length; j++) d[0][j] = j; for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }

  // Tema: themeParams → variables CSS; claro usa menta oscuro.
  function theme() {
    var light = tg && tg.colorScheme === 'light';
    document.documentElement.classList.toggle('light', !!light);
    if (tg && tg.viewportStableHeight) document.documentElement.style.setProperty('--vh', tg.viewportStableHeight + 'px');
    if (tg && tg.MainButton && tg.MainButton.setParams) tg.MainButton.setParams({ color: light ? '#0f8a6f' : '#64ffda', text_color: light ? '#ffffff' : '#0a192f' });
  }

  var P = { origins: [], destinations: [] };
  var st = { o: null, d: null, t: '2', dep: null, ret: null, adults: 1, flex: false, month: null, results: null, sort: 'price' };
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
      fallbackBtn = h('button', { 'class': 'primary fallback-main', disabled: !enabled, on: { click: function () { if (mainHandler) mainHandler(); } }, text: text });
      root.appendChild(fallbackBtn);
    }
  }
  function hideMain() { mainHandler = null; if (tg && tg.MainButton) tg.MainButton.hide(); }
  function go(screen) { stack.push(screen); render(); }
  function back() { if (stack.length > 1) { stack.pop(); render(); } else if (tg) tg.close(); }
  function render() {
    root.textContent = '';
    hideMain();
    var top = stack[stack.length - 1];
    if (tg && tg.BackButton) tg.BackButton.show();
    top();
  }

  function covered(list, side, code) { return list.some(function (p) { return p.code === code; }); }
  function suggest(q, side) {
    var list = side === 'o' ? P.origins : P.destinations;
    var n = norm(q); if (!n) return list.slice(0, 6);
    var scored = [];
    list.forEach(function (p, i) {
      var names = [p.city, p.airport].concat(p.alias || []).map(norm);
      var s = null;
      if (p.code.toLowerCase() === n) s = 0;
      else if (names.some(function (x) { return x.indexOf(n) === 0; })) s = 1;
      else if (names.some(function (x) { return x.indexOf(n) >= 0; })) s = 2;
      else if (n.length >= 3) { var b = Math.min.apply(null, names.map(function (x) { return lev(x, n); })); if (b <= 2) s = 3 + b; }
      if (s !== null) scored.push({ p: p, s: s, i: i });
    });
    scored.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    return scored.slice(0, 6).map(function (x) { return x.p; });
  }
  function labelOf(code) { var all = P.origins.concat(P.destinations); for (var i = 0; i < all.length; i++) if (all[i].code === code) return all[i].label; return code; }

  function cityField(side) {
    var wrap = h('div', { 'class': 'card' });
    var id = 'f-' + side;
    var input = h('input', { type: 'text', id: id, autocomplete: 'off', value: st[side] ? labelOf(st[side]) : '', 'aria-autocomplete': 'list' });
    var ul = h('ul', { 'class': 'sugg', role: 'listbox' });
    function fill() {
      ul.textContent = '';
      var q = input.value;
      if (st[side] && labelOf(st[side]) === q) return;
      var res = suggest(q, side);
      if (!res.length && norm(q).length >= 3) {
        var all = side === 'o' ? P.origins : P.destinations;
        ul.appendChild(h('li', { 'class': 'muted', text: tr('notCovered', { c: q }) }));
        res = all.slice(0, 6);
      }
      res.forEach(function (p) {
        ul.appendChild(h('li', null, h('button', { type: 'button', role: 'option', on: { click: function () { st[side] = p.code; hap('sel'); if (side === 'd') st.month = null; render(); } } }, p.label + ' · ' + p.country)));
      });
    }
    input.addEventListener('input', function () { st[side] = null; fill(); validMain(); });
    input.addEventListener('focus', fill);
    wrap.appendChild(h('label', { 'for': id, text: side === 'o' ? S.from : S.to }));
    wrap.appendChild(input);
    wrap.appendChild(ul);
    return wrap;
  }
  function canSwap() { return st.o && st.d && covered(P.origins, 'o', st.d) && covered(P.destinations, 'd', st.o); }
  function ready() { return st.o && st.d && st.dep && (st.t === '1' || st.ret || st.flex); }
  function validMain() {
    if (tg && tg.MainButton) { if (ready()) tg.MainButton.enable(); else tg.MainButton.disable(); }
    if (fallbackBtn) fallbackBtn.disabled = !ready();
  }

  function searchScreen() {
    root.appendChild(h('h1', { text: S.search }));
    root.appendChild(cityField('o'));
    var swap = h('button', { type: 'button', 'class': 'swap', 'aria-label': S.swap, title: canSwap() ? S.swap : S.swapOff, disabled: !canSwap(), on: { click: function () { var x = st.o; st.o = st.d; st.d = x; hap('sel'); render(); } } }, '⇄');
    root.appendChild(h('div', { 'class': 'row' }, h('span', { 'class': 'muted', text: '' }), swap));
    root.appendChild(cityField('d'));
    var seg = h('div', { 'class': 'seg', role: 'group' },
      h('button', { type: 'button', 'aria-pressed': st.t === '1' ? 'true' : 'false', on: { click: function () { st.t = '1'; hap('sel'); render(); } }, text: S.oneway }),
      h('button', { type: 'button', 'aria-pressed': st.t === '2' ? 'true' : 'false', on: { click: function () { st.t = '2'; hap('sel'); render(); } }, text: S.round }));
    root.appendChild(seg);
    var dates = h('div', { 'class': 'row' },
      h('button', { type: 'button', disabled: !(st.o && st.d), on: { click: function () { go(calendarScreen); } } }, S.dep + ' ' + (st.dep ? (st.flex ? S.months[Number(st.dep.slice(5, 7)) - 1] : dm(st.dep)) : S.pick)),
      st.t === '2' ? h('button', { type: 'button', disabled: !(st.o && st.d), on: { click: function () { go(calendarScreen); } } }, S.ret + ' ' + (st.ret ? dm(st.ret) : (st.flex ? '—' : S.pick))) : null);
    root.appendChild(dates);
    root.appendChild(h('div', { 'class': 'card stepper' },
      h('span', { text: '👤 ' + st.adults + ' ' + S.adults }),
      h('button', { type: 'button', 'aria-label': '−', disabled: st.adults <= 1, on: { click: function () { st.adults--; hap('imp', 'light'); render(); } } }, '−'),
      h('button', { type: 'button', 'aria-label': '+', disabled: st.adults >= 9, on: { click: function () { st.adults++; hap('imp', 'light'); render(); } } }, '+')));
    setMain(S.go, ready(), doSearch);
  }

  function ymCode(y, m) { return String(y).slice(2) + String(m).padStart(2, '0'); }
  function calendarScreen() {
    var now = new Date();
    if (!st.month) st.month = { y: now.getFullYear(), m: now.getMonth() + 1 };
    var y = st.month.y, m = st.month.m;
    var head = h('div', { 'class': 'row' },
      h('h1', { text: S.months[m - 1] + ' ' + y }),
      h('button', { type: 'button', 'aria-label': '‹', disabled: y === now.getFullYear() && m === now.getMonth() + 1, on: { click: function () { st.month = m === 1 ? { y: y - 1, m: 12 } : { y: y, m: m - 1 }; render(); } } }, '‹'),
      h('button', { type: 'button', 'aria-label': '›', on: { click: function () { st.month = m === 12 ? { y: y + 1, m: 1 } : { y: y, m: m + 1 }; render(); } } }, '›'));
    root.appendChild(head);
    var grid = h('div', { 'class': 'cal', role: 'grid' });
    S.dows.forEach(function (d) { grid.appendChild(h('div', { 'class': 'dow', text: d })); });
    root.appendChild(grid);
    root.appendChild(h('div', { 'class': 'legend' }, '↓ ' + S.cheap, ' ▒ ' + S.mid, ' █ ' + S.high, ' · ' + S.nodata));
    root.appendChild(h('button', { type: 'button', on: { click: function () { st.flex = true; st.dep = y + '-' + String(m).padStart(2, '0') + '-01'; st.ret = null; hap('sel'); back(); } } }, S.flex));
    root.appendChild(h('p', { 'class': 'muted', text: S.calFoot }));
    var today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    var paint = function (days) {
      var by = {}; (days || []).forEach(function (d) { by[d.day] = d; });
      var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); var pad = (first + 6) % 7;
      for (var i = 0; i < pad; i++) grid.appendChild(h('span'));
      var n = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (var d = 1; d <= n; d++) (function (d) {
        var iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var info = by[iso];
        var cls = info ? info.level : 'nodata';
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
    };
    api('GET', '/app/api/calendar?o=' + st.o + '&d=' + st.d + '&m=' + ymCode(y, m) + '&t=' + st.t).then(function (r) { paint(r.status === 200 ? r.data : []); });
  }

  function doSearch() {
    if (!ready()) return;
    if (tg && tg.MainButton) tg.MainButton.showProgress();
    api('POST', '/app/api/search', { o: st.o, d: st.d, dep: st.dep, ret: st.t === '2' ? st.ret : null, adults: st.adults, flex: st.flex }).then(function (r) {
      if (tg && tg.MainButton) tg.MainButton.hideProgress();
      st.results = r;
      hap('notif', r.status === 200 ? 'success' : 'error');
      go(resultsScreen);
    }, function () { if (tg && tg.MainButton) tg.MainButton.hideProgress(); st.results = { status: 0 }; hap('notif', 'error'); go(resultsScreen); });
  }

  function resultsScreen() {
    var r = st.results || {};
    root.appendChild(h('h1', { text: st.o + ' → ' + st.d }));
    if (r.status === 401) { root.appendChild(h('p', { text: S.auth })); return; }
    if (r.status === 402) { root.appendChild(h('p', { text: S.paywall })); return; }
    if (r.status !== 200) { root.appendChild(h('div', { 'class': 'card' }, h('p', { text: S.error }), h('button', { type: 'button', on: { click: function () { stack.pop(); doSearch(); } } }, S.retry))); return; }
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
      root.appendChild(h('div', { 'class': 'card' },
        h('div', { 'class': 'row' }, h('strong', { text: x.origin + ' → ' + x.destination }), h('span', { 'class': 'muted', text: x.returnDate ? '⇄ ' + S.round : '→ ' + S.oneway })),
        h('div', { 'class': 'price', text: money(x.price, x.currency) }),
        h('div', { text: dm(x.departureDate) + (x.returnDate ? ' → ' + dm(x.returnDate) : '') + ' · ' + (x.stops === 0 ? S.direct : tr('stops', { n: x.stops })) }),
        h('div', { 'class': 'muted', text: seen(x.seen_at) }),
        h('div', { 'class': 'row' },
          h('button', { type: 'button', 'class': 'primary', on: { click: function () { if (tg && tg.openLink) tg.openLink(x.url); else window.open(x.url, '_blank', 'noopener'); } } }, S.offer),
          h('button', { type: 'button', on: { click: function () { createAlert(x); } } }, S.alertMe))));
    });
    root.appendChild(h('p', { 'class': 'muted', text: S.foot }));
  }

  function createAlert(x) {
    api('POST', '/app/api/alerts', { o: x.origin, d: x.destination, dep: x.departureDate, ret: x.returnDate, ceiling: x.price }).then(function (r) {
      hap('notif', r.status === 200 ? 'success' : 'error');
      if (r.status === 200) { stack = [alertsScreen]; render(); toast(S.created); }
      else toast(r.data && r.data.text ? r.data.text : S.error);
    });
  }

  var toastEl = null;
  function toast(text, action, fn) {
    if (toastEl) toastEl.remove();
    toastEl = h('div', { 'class': 'toast', role: 'status' }, h('span', { text: text }), action ? h('button', { type: 'button', on: { click: function () { fn(); toastEl.remove(); } } }, action) : null);
    document.body.appendChild(toastEl);
    var el = toastEl; setTimeout(function () { if (el.parentNode) el.remove(); }, 5000);
  }

  function alertsScreen(focusId) {
    root.appendChild(h('h1', { text: S.alerts }));
    api('GET', '/app/api/alerts').then(function (r) {
      if (r.status === 401) { root.appendChild(h('p', { text: S.auth })); return; }
      var list = r.data || [];
      root.querySelector('h1').textContent = S.alerts + ' (' + list.length + ')';
      if (!list.length) { root.appendChild(h('p', { text: S.none })); root.appendChild(h('button', { type: 'button', 'class': 'primary', on: { click: function () { stack = [searchScreen]; render(); } } }, S.first)); return; }
      list.forEach(function (a) {
        var card = h('div', { 'class': 'card', id: 'alert-' + a.id });
        var m = a.outboundDate ? S.months[Number(a.outboundDate.slice(5, 7)) - 1].slice(0, 3) : '';
        card.appendChild(h('div', { 'class': 'row' }, h('strong', { text: a.origin + ' → ' + a.destination + (m ? ' · ' + m : '') + (a.tripType === 'roundtrip' ? ' · ⇄' : '') }), h('span', { 'class': 'badge' + (a.paused ? '' : ' on'), text: a.paused ? S.paused : '● ' + S.active })));
        card.appendChild(h('div', { 'class': 'muted', text: (a.ceiling ? S.ceiling + ' ' + money(a.ceiling, a.currency) : '') + (a.lastPrice ? ' · ' + S.last + ' ' + money(a.lastPrice, 'EUR') + (a.seen_at ? ' (' + seen(a.seen_at) + ')' : '') : '') }));
        var editor = h('div', { hidden: true },
          h('label', { 'for': 'c-' + a.id, text: S.ceiling + ' (€)' }),
          h('input', { type: 'range', min: 50, max: 3000, step: 10, value: a.ceiling || 600, 'aria-label': S.ceiling, on: { input: function (e) { editor.querySelector('input[type=number]').value = e.target.value; } } }),
          h('input', { type: 'number', id: 'c-' + a.id, min: 50, max: 9999, value: a.ceiling || 600 }),
          h('button', { type: 'button', 'class': 'primary', on: { click: function () { var v = Number(editor.querySelector('input[type=number]').value); api('PATCH', '/app/api/alerts/' + a.id, { ceiling: v }).then(function (x) { hap('notif', x.status === 200 ? 'success' : 'error'); render(); }); } } }, S.save));
        card.appendChild(h('div', { 'class': 'row' },
          h('button', { type: 'button', on: { click: function () {
            var next = !a.paused; hap('imp', 'light');
            api('POST', '/app/api/alerts/' + a.id + '/pause', { paused: next }).then(function () {
              render();
              if (next) toast(S.paused, S.undo, function () { api('POST', '/app/api/alerts/' + a.id + '/pause', { paused: false }).then(render); });
            });
          } } }, a.paused ? S.resume : S.pause),
          h('button', { type: 'button', on: { click: function () { editor.hidden = !editor.hidden; } } }, S.edit),
          h('button', { type: 'button', 'aria-label': S.del, on: { click: function () {
            var q = tr('confirmDel', { r: a.origin + ' → ' + a.destination });
            var del = function (ok) { if (ok) api('DELETE', '/app/api/alerts/' + a.id).then(function () { hap('notif', 'success'); render(); }); };
            if (tg && tg.showConfirm) tg.showConfirm(q, del); else del(window.confirm(q));
          } } }, '🗑')));
        card.appendChild(editor);
        root.appendChild(card);
        if (focusId === a.id) { editor.hidden = false; card.scrollIntoView(); }
      });
    });
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
      var start = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
      var m = /^search_([A-Z]{3})_([A-Z]{3})$/.exec(start);
      if (m) { st.o = m[1]; st.d = m[2]; }
      var al = /^alert_([a-f0-9]{24}|m[0-9]{1,9})$/.exec(start);
      if (al) stack = [function () { alertsScreen(al[1]); }];
      else if (start === 'alerts') stack = [alertsScreen];
      else stack = [searchScreen];
      render();
    });
  }
  boot();
})();
