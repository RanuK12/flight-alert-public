'use strict';

(function () {
  var BOT = 'https://t.me/flightalertpro_bot';

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function applyTheme(mode) {
    var root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    var opts = document.querySelectorAll('#theme-pick .theme-opt');
    for (var i = 0; i < opts.length; i++) opts[i].setAttribute('aria-pressed', String(opts[i].getAttribute('data-mode') === mode));
  }

  var themePick = document.getElementById('theme-pick');
  if (themePick) {
    var saved = 'system';
    try {
      var stored = localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark' || stored === 'system') saved = stored;
    } catch (err) { /* sin almacenamiento, queda el sistema */ }
    applyTheme(saved);
    themePick.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.theme-opt');
      if (!btn) return;
      var next = btn.getAttribute('data-mode');
      try { localStorage.setItem('theme', next); } catch (err) { /* el tema igual cambia en esta visita */ }
      applyTheme(next);
    });
  }

  var sentinel = document.getElementById('top-sentinel');
  var header = document.querySelector('.site-header');
  if (sentinel && header && 'IntersectionObserver' in window) {
    var headObserver = new IntersectionObserver(function (entries) {
      header.classList.toggle('is-scrolled', !entries[0].isIntersecting);
    });
    headObserver.observe(sentinel);
  }

  var reveals = document.querySelectorAll('.reveal');
  if (reduceMotion() || !('IntersectionObserver' in window)) {
    reveals.forEach(function (node) { node.classList.add('is-in'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.15 });
    reveals.forEach(function (node) { revealObserver.observe(node); });
  }

  var tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    function selectTab(index) {
      tabs.forEach(function (tab, i) {
        var on = i === index;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(tab.getAttribute('aria-controls'));
        if (panel) panel.classList.toggle('is-active', on);
      });
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { selectTab(i); });
      tab.addEventListener('keydown', function (event) {
        var next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (i + 1) % tabs.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        selectTab(next);
        tabs[next].focus();
      });
    });
  }

  var country = document.getElementById('country-preview');
  if (country) {
    var prices = document.querySelectorAll('[data-price-region]');
    function showRegion(region) {
      prices.forEach(function (node) {
        var on = node.getAttribute('data-price-region') === region;
        node.hidden = !on;
        if (on) node.setAttribute('aria-current', 'true');
        else node.removeAttribute('aria-current');
      });
    }
    country.addEventListener('change', function (e) {
      if (!e.target || e.target.name !== 'ccy') return;
      var go = function () { showRegion(e.target.value); };
      if (document.startViewTransition && !reduceMotion()) document.startViewTransition(go); else go();
    });
  }

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';
      var live = document.getElementById('copy-status');
      var done = btn.getAttribute('data-copied') || 'Copiado';
      function mark() { if (live) live.textContent = done; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(mark).catch(function () {});
      }
    });
  });

  function countUp(el) {
    var to = Number(el.getAttribute('data-value'));
    if (!Number.isFinite(to) || to <= 0) return;
    if (reduceMotion()) {
      el.textContent = String(to);
      return;
    }
    var start = performance.now();
    function frame(now) {
      var p = Math.min(1, (now - start) / 300);
      el.textContent = String(Math.round(to * p));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  document.querySelectorAll('.js-price').forEach(countUp);

  function titleFor(code) {
    var nodes = document.querySelectorAll('abbr');
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].textContent === code && nodes[i].title) return nodes[i].title;
    }
    return code;
  }

  function abbr(code) {
    var el = document.createElement('abbr');
    el.textContent = code;
    el.title = titleFor(code);
    return el;
  }

  function paintSample(sample) {
    var card = document.getElementById('sample-card');
    if (!card) return;
    var amount = card.querySelector('.price-card__amount');
    var route = card.querySelector('.route-chip');
    var when = card.querySelector('.price-card__when');
    var words = card.querySelector('.price-card__words');
    var seen = card.querySelector('.seen__text');
    var cta = card.querySelector('a.btn');
    var lang = document.documentElement.lang === 'en' ? 'en' : 'es';
    var price = sample ? Math.round(Number(sample.price)) : 0;
    var origin = sample && /^[A-Z]{3}$/.test(sample.origin) ? sample.origin : '';
    var destination = sample && /^[A-Z]{3}$/.test(sample.destination) ? sample.destination : '';
    var currency = sample && /^[A-Z]{3}$/.test(sample.currency) ? sample.currency : '';
    var popular = card.querySelector('.popular-routes-preview');
    if (!sample || price <= 0 || !origin || !destination || !currency) {
      card.setAttribute('data-state', 'empty');
      if (popular) popular.style.display = '';
      if (cta) cta.setAttribute('href', BOT + '?start=landing_hero');
      return;
    }
    card.setAttribute('data-state', 'ready');
    if (popular) popular.style.display = 'none';
    if (route) {
      route.textContent = '';
      route.appendChild(abbr(origin));
      route.appendChild(document.createTextNode(' → '));
      route.appendChild(abbr(destination));
    }
    if (when) {
      when.textContent = /^\d{4}-\d{2}-\d{2}/.test(String(sample.departureDate || ''))
        ? String(sample.departureDate).slice(0, 10) : '';
    }
    if (amount) {
      amount.textContent = '';
      var num = document.createElement('span');
      num.className = 'js-price';
      num.setAttribute('data-value', String(price));
      num.textContent = String(price);
      amount.appendChild(num);
      amount.appendChild(document.createTextNode(' '));
      var ccy = document.createElement('span');
      ccy.className = 'price-card__ccy';
      ccy.textContent = currency;
      amount.appendChild(ccy);
      countUp(num);
    }
    if (words) words.textContent = fareWords(price, currency, lang);
    if (seen) {
      var hours = Number(sample.seenHours);
      if (lang === 'en' && Number.isFinite(hours) && hours >= 0) seen.textContent = 'seen ' + Math.round(hours) + ' h ago';
      else if (typeof sample.seen === 'string') seen.textContent = sample.seen;
    }
    if (cta) cta.setAttribute('href', BOT + '?start=' + origin + '-' + destination);
    var path = card.querySelector('.route-draw path');
    if (path && !reduceMotion()) {
      path.style.animation = 'none';
      path.getBoundingClientRect();
      path.style.animation = '';
    }
  }

  function fareWords(price, currency, lang) {
    var n = String(price);
    if (currency === 'EUR') return n + ' euros';
    if (currency === 'USD') return lang === 'en' ? n + ' US dollars' : n + ' dólares estadounidenses';
    if (currency === 'ARS') return lang === 'en' ? n + ' Argentine pesos' : n + ' pesos argentinos';
    return n + ' ' + currency;
  }

  var card = document.getElementById('sample-card');
  if (card && window.fetch) {
    fetch('/api/sample-price', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !Object.prototype.hasOwnProperty.call(data, 'sample')) return;
        var existing = card.querySelector('.js-price');
        var same = existing && data.sample
          && String(Math.round(Number(data.sample.price))) === existing.getAttribute('data-value')
          && card.getAttribute('data-state') === 'ready';
        if (same) return;
        paintSample(data.sample);
      })
      .catch(function () { /* se queda el HTML del servidor */ });
  }
}());

(function () {
  var svg = document.querySelector('.hero-route');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  function still() {
    if (svg && svg.pauseAnimations && reduce && reduce.matches) { svg.pauseAnimations(); svg.setCurrentTime(3); }
    else if (svg && svg.unpauseAnimations) svg.unpauseAnimations();
  }
  still();
  if (reduce && reduce.addEventListener) reduce.addEventListener('change', still);
  var header = document.querySelector('.site-header');
  if (header) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () { header.classList.toggle('is-scrolled', window.scrollY > 8); ticking = false; });
    }, { passive: true });
  }

  // P1.3: filtro de destinos por región y "Ver los 31".
  var list = document.getElementById('dest-all');
  var more = document.querySelector('.dest-toggle');
  if (list) {
    var applyFilter = function (region) {
      list.setAttribute('data-region', region);
      list.querySelectorAll('.dest-mini').forEach(function (li) {
        li.hidden = region !== 'all' && li.getAttribute('data-region') !== region;
      });
      if (more) more.hidden = region !== 'all';
    };
    document.querySelectorAll('input[name="dest-region"]').forEach(function (r) {
      r.addEventListener('change', function () {
        var go = function () { applyFilter(r.value); };
        if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(go); else go();
      });
    });
  }
  if (more && list) {
    more.addEventListener('click', function () {
      var open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      list.setAttribute('data-collapsed', String(!open));
      more.textContent = more.getAttribute(open ? 'data-less' : 'data-more');
    });
  }
})();
