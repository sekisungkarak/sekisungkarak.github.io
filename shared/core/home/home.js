/* Homepage. Everything on this page is rendered from catalog.js — add a widget
   there and its card, its menu row and its search entries all follow. */
(function () {
  'use strict';

  var C = window.CHROME;
  var site = C.site;
  var T = C.T || function (s) { return s; };
  var boot = JSON.parse(document.getElementById('homeBoot').textContent);

  var PLAT_LOGO = {
    twitch: ['twitch/logo-twitch.svg', 19],
    youtube: ['youtube/logo-youtube.svg', 21],
    kick: ['kick/logo-kick.svg', 19],
    tiktok: ['tiktok/logo-tiktok.svg', 19]
  };

  function hex(h, a) {
    var n = parseInt(h.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // Splits a blurb into words, each carrying its own index so the stagger is
  // pure CSS. The card gets .is-in when it first scrolls into view.
  function reveal(text) {
    return String(text || '').split(/\s+/).filter(Boolean).map(function (w, i) {
      return '<span class="w" style="--i:' + i + '">' + C.esc(w) + '</span>';
    }).join(' ');
  }

  function platforms(list) {
    var marks = (list || []).map(function (p) {
      var spec = PLAT_LOGO[p];
      if (!spec) return '';
      var label = (C.PLATFORM[p] || [p])[0];
      return '<img class="plat" style="height:' + spec[1] + 'px" ' +
        'src="' + C.esc(C.root('shared/assets/images/' + spec[0])) + '" alt="' + C.esc(label) + '" title="' + C.esc(label) + '">';
    }).join('');
    return '<span class="plat-row">' + marks + '</span>';
  }

  function badge(tier) {
    if (tier === 'pro') return '<span class="badge badge-pro">PRO</span>';
    if (tier === 'freemium') {
      return '<span class="badge-split"><span class="badge badge-free">FREE</span>' +
        '<span class="badge badge-pro">PRO</span></span>';
    }
    return '<span class="badge badge-free">FREE</span>';
  }

  function card(c) {
    var href = C.root(c.docsUrl);
    // Cards do use a colour, but leaving it out should never break a build.
    var accent = c.accent || '#D4A843';
    // The placeholder is the card's own background, so a card with no art still
    // looks designed. A real thumb.png layers over it and removes itself if missing.
    var art = c.thumb
      ? '<img class="art" src="' + C.esc(C.root(c.thumb)) + '" alt="" onerror="this.remove()">'
      : '';

    // Get PRO goes elsewhere, so it sits above the cover link.
    var extra = '';
    if (c.proHref) extra += '<a href="' + C.esc(c.proHref) + '" target="_blank" rel="noopener">' + C.esc(T('Get PRO')) + '</a>';

    return '<article class="tile" style="--brand:' + accent +
        ';--wash-a:' + hex(accent, 0.34) + ';--wash-b:' + hex(accent, 0.12) + '">' +
      // Covers the card — thumbnail, title and body all lead to the docs.
      '<a class="tile-cover" href="' + C.esc(href) + '" aria-label="' + C.esc(c.name + ' ' + T('documentation')) + '"></a>' +
      // Features-6 accent: a soft gradient blob tinted by the card's own
      // --brand, sitting behind the body copy.
      '<span class="tile-blob" aria-hidden="true"></span>' +
      '<div class="thumb">' + art +
      '</div>' +
      // Platform mark leads the card; the name sits in the footer beside Docs.
      '<div class="tile-body">' +
        '<div class="tile-head">' + platforms(c.platforms) +
          badge(c.tier) +
        '</div>' +
        '<p class="tile-desc">' + reveal(T(c.description)) + '</p>' +
        '<div class="tile-foot">' +
          '<span class="tile-name">' + C.esc(c.name) + '</span>' +
          '<span class="tile-links">' + extra +
            '<a class="tile-go" href="' + C.esc(href) + '">' + C.esc(T('Docs')) + C.svg(C.ICON.arrow, { size: 14, stroke: 'currentColor', width: 2.4 }) + '</a>' +
          '</span>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function shelf(id, label, rows) {
    if (!rows.length) return '';
    return '<section class="shelf" id="' + id + '"><div class="rule">' + C.esc(label) + '</div>' +
      '<div class="grid">' + rows.map(card).join('') + '</div></section>';
  }

  function hero() {
    // Hanya platform yang benar-benar dipakai katalog, urut tetap.
    var order = ['twitch', 'youtube', 'kick', 'tiktok'];
    var used = {};
    (C.catalog || []).forEach(function (c) { (c.platforms || []).forEach(function (p) { used[p] = 1; }); });
    var runs = order.filter(function (p) { return used[p]; }).map(function (p) {
      var spec = PLAT_LOGO[p];
      var label = (C.PLATFORM[p] || [p])[0];
      return '<span><img class="plat" style="height:' + spec[1] + 'px" src="' +
        C.esc(C.root('shared/assets/images/' + spec[0])) + '" alt="">' + C.esc(label) + '</span>';
    }).join('');

    // Patreon and Ko-fi, declared in site.js so the hero stays markup-only.
    var support = (site.support || []).map(function (b) {
      return '<a class="btn btn-brand" style="--brand:' + b.color + '" href="' + C.esc(b.href) + '" ' +
        'target="_blank" rel="noopener">' + C.mark(b.icon, { size: 17, fill: b.color }) + C.esc(b.label) + '</a>';
    }).join('');

    return '<section class="hero">' +
      '<div class="eyebrow">' + C.esc(T(boot.eyebrow)) + '</div>' +
      '<h1>' + C.esc(T(boot.title)) + '</h1>' +
      '<p>' + C.esc(T(boot.lede)) + '</p>' +
      '<div class="cta-row">' +
        '<a class="btn btn-primary" href="#widgets">' + C.esc(T('Browse widgets')) +
          C.svg(C.ICON.arrow, { size: 17, stroke: 'currentColor', width: 2.4 }) + '</a>' +
        support +
      '</div>' +
      '<div class="runs-on"><span style="color:inherit">' + C.esc(T('Supports')) + '</span>' + runs + '</div>' +
    '</section>';
  }

  /* ── render ─────────────────────────────────────────── */

  // A fresh visit opens on the hero alone; once expanded it stays that way for
  // the session, so coming back from a docs page does not replay the landing.
  // 404.html runs this same script and promises the widgets are below it, so the
  // landing is for the homepage only — at '/' or at '/index.html'.
  var opened;
  try { opened = sessionStorage.getItem('home-open'); } catch (e) {}
  var isHome = location.pathname.replace(/index\.html$/, '') === new URL(C.root()).pathname;
  if (isHome && location.hash !== '#widgets' && opened !== '1') {
    document.documentElement.classList.add('is-landing');
  }

  document.body.appendChild(C.buildHeader());
  C.slideNav(document.querySelector('.site-header'));

  var free = C.catalog.filter(function (c) { return c.tier !== 'pro'; });
  var pro = C.catalog.filter(function (c) { return c.tier === 'pro'; });

  var main = C.el('<main class="page-wrap"></main>');
  // The inner div is what the landing collapses to zero height; the shelves
  // cannot do it themselves, since 0fr sizing needs a single child to measure.
  main.innerHTML = hero() +
    '<div class="shelves"><div>' +
      shelf('widgets', T('Widgets & tools'), free) +
      // Renders nothing at all while there are no pro entries — no empty shelf.
      shelf('exclusive', T('Patreon-exclusive'), pro) +
    '</div></div>';
  document.body.appendChild(main);

  // The blurb reveals the first time its card is seen. On the landing the
  // shelves are 0fr tall, so this fires when they open rather than on load.
  var tiles = main.querySelectorAll('.tile');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      });
    }, { threshold: 0.25 });
    tiles.forEach(function (t) { io.observe(t); });
  } else {
    tiles.forEach(function (t) { t.classList.add('is-in'); });
  }

  main.appendChild(C.buildSiteFooter());

  // Browse widgets and the header's Widgets tab both point at #widgets. From the
  // landing they expand the page instead of navigating; the hero collapsing is
  // what brings the grid into view, so there is no scroll to run. Registering
  // before nav.js means preventDefault also calls off its hold-and-warm.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href$="#widgets"]');
    if (!a || !document.documentElement.classList.contains('is-landing')) return;
    e.preventDefault();
    var root = document.documentElement;
    root.classList.remove('is-landing');
    // Keeps the shelves clipped while they grow; dropped afterwards so the top
    // row's hover lift is not cut off.
    root.classList.add('is-opening');
    setTimeout(function () { root.classList.remove('is-opening'); }, 560);
    try { sessionStorage.setItem('home-open', '1'); } catch (err) {}
    history.replaceState(null, '', '#widgets');
  });

  // Arriving on #widgets from elsewhere: the browser's own hash scroll already
  // ran, before this script had put a grid on the page.
  if (location.hash === '#widgets') {
    requestAnimationFrame(function () {
      var t = document.getElementById('widgets');
      if (t) t.scrollIntoView();
    });
  }
})();
