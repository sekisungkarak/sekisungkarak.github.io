/* Docs core: fetch a widget's README.md, render it, and build the page around it.
   The shim carries only an id — title, eyebrow, platforms and URLs all come
   from catalog.js, so a widget is described in exactly one place. */
(function () {
  'use strict';

  var C = window.CHROME;
  var site = window.SITE || {};
  var boot = JSON.parse(document.getElementById('docsBoot').textContent);
  var entry = (C && C.entry(boot.id)) || {};

  // Catalog supplies the defaults; anything set inline in the shim still wins.
  ['eyebrow', 'version', 'platforms'].forEach(function (k) {
    if (boot[k] === undefined && entry[k] !== undefined) boot[k] = entry[k];
  });
  // The hero paragraph is 'lede' everywhere on the site; the catalog calls it 'description'.
  if (boot.lede === undefined) boot.lede = entry.description;
  if (boot.title === undefined) boot.title = entry.name || '';
  if (!boot.source && entry.widgetUrl) boot.source = C.root(entry.widgetUrl + 'README.md');
  if (!boot.widgetUrl && entry.widgetUrl) boot.widgetUrl = C.root(entry.widgetUrl);
  if (!boot.settingsUrl && entry.settingsUrl) boot.settingsUrl = C.root(entry.settingsUrl);
  if (!boot.breadcrumb) boot.breadcrumb = ['Docs', boot.title];

  // The shim's <title> is a generic no-JS fallback; the real one is the widget's.
  if (boot.title) document.title = boot.title + ' — Panduan Pasang';

  var ICON = C.ICON, PLATFORM = C.PLATFORM;
  var svg = C.svg, mark = C.mark, el = C.el, esc = C.esc;

  var ALERT = {
    NOTE: { cls: 'note', stroke: '#3b82f6', path: 'M12 11v5M12 8h.01', circle: true },
    TIP: { cls: 'tip', stroke: '#2f9e51', path: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z' },
    IMPORTANT: { cls: 'important', stroke: '#ddc54a', path: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 8v5M12 16h.01' },
    WARNING: { cls: 'warning', stroke: '#ef4444', path: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' },
    CAUTION: { cls: 'caution', stroke: '#ef4444', path: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' }
  };

  function buildHero() {
    var chips = (boot.platforms || []).map(function (p) {
      var m = PLATFORM[p];
      if (!m) return '';
      return '<span class="chip"><span class="dot" style="background:' + m[1] + '"></span>' + m[0] + '</span>';
    }).join('');

    var crumbs = (boot.breadcrumb || ['Docs']).map(function (c, i, a) {
      var last = i === a.length - 1;
      return (last ? '<span class="here">' + esc(c) + '</span>' : '<span>' + esc(c) + '</span>');
    }).join('<span>/</span>');

    var widgetUrl = new URL(boot.widgetUrl || '../', location.href).href;

    return el(
      '<div>' +
        '<div class="breadcrumb">' + crumbs + '</div>' +
        '<div class="eyebrow-row">' +
          (boot.eyebrow ? '<span class="eyebrow">' + esc(boot.eyebrow) + '</span>' : '') +
          (boot.version ? '<span class="version-pill">v' + esc(boot.version) + '</span>' : '') +
        '</div>' +
        '<h1 class="doc-title">' + esc(boot.title || '') + '</h1>' +
        (boot.lede ? '<p class="doc-lede">' + esc(boot.lede) + '</p>' : '') +
        (chips || boot.updated ? '<div class="meta-row">' + chips +
          (boot.updated ? '<span class="updated">Updated ' + esc(boot.updated) + '</span>' : '') + '</div>' : '') +
        '<div class="install-card">' +
          '<div class="install-label">' + svg(ICON.link, { size: 15, stroke: '#7fa6e6' }) + 'URL browser source</div>' +
          '<div class="install-row">' +
            '<div class="install-url">' + esc(widgetUrl) + '</div>' +
            '<button class="install-copy" type="button" data-url="' + esc(widgetUrl) + '">' +
              svg(ICON.copy, { size: 15, stroke: '#fff' }).replace('<path', '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path') +
              '<span>Salin</span></button>' +
          '</div>' +
          (boot.settingsUrl ? '<div class="install-links" id="configure-widget">' + svg(ICON.link, { size: 14, stroke: '#7fa6e6' }) +
            '<a href="' + esc(boot.settingsUrl) + '">Atur widget ini di editor pengaturan</a></div>' : '') +
        '</div>' +
      '</div>'
    );
  }

  // Widgets keep their Streamer.bot actions in <widget>/import.sb; when one is
  // there, the hero gets a second copy box beside the browser source URL.
  function buildImportCard(code) {
    var preview = code.length > 220 ? code.slice(0, 220) + '…' : code;
    var card = el(
      '<div class="install-card is-sb" id="import-code">' +
        '<div class="install-label">' + svg(ICON.bolt, { size: 15, stroke: '#c9a5ff' }) + 'Kode impor Streamer.bot</div>' +
        '<div class="install-row">' +
          '<div class="install-url">' + esc(preview) + '</div>' +
          '<button class="install-copy" type="button">' +
            svg(ICON.copy, { size: 15, stroke: '#fff' }).replace('<path', '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path') +
            '<span>Salin</span></button>' +
        '</div>' +
      '</div>'
    );
    card.querySelector('.install-copy').addEventListener('click', function () {
      copy(code, this);
    });
    return card;
  }

  function buildFooter() {
    var cards = '';
    if (boot.prev) {
      cards += '<a class="foot-card prev" href="' + esc(boot.prev.href) + '">' +
        '<div class="foot-dir">← SEBELUMNYA</div><div class="foot-label">' + esc(boot.prev.label) + '</div></a>';
    }
    if (boot.next) {
      cards += '<a class="foot-card next" href="' + esc(boot.next.href) + '">' +
        '<div class="foot-dir">BERIKUTNYA →</div><div class="foot-label">' + esc(boot.next.label) + '</div></a>';
    }

    var edit = '';
    if (site.repo) {
      // Repo-relative path. Assumes a user/org page, where the site root is the repo root.
      var path = new URL(boot.source, location.href).pathname.replace(/^\//, '');
      var href = 'https://github.com/' + site.repo + '/edit/' + (site.branch || 'main') + '/' + path;
      edit = '<div class="edit-link">' + svg(ICON.pencil, { size: 14, stroke: '#5c5c5c' }) +
        '<a href="' + esc(href) + '" target="_blank" rel="noopener">Edit halaman ini di GitHub</a></div>';
    }

    return el('<div>' + (cards ? '<div class="doc-footer">' + cards + '</div>' : '') + edit + '</div>');
  }

  /* ── markdown post-processing ───────────────────────── */

  // "> [!NOTE]" blockquotes become callouts. GitHub renders these natively too.
  function upgradeAlerts(root) {
    root.querySelectorAll('blockquote').forEach(function (q) {
      var first = q.querySelector('p');
      if (!first) return;
      var m = first.innerHTML.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br\s*\/?>|\n)?/i);
      if (!m) return;

      var kind = m[1].toUpperCase();
      var spec = ALERT[kind];
      first.innerHTML = first.innerHTML.slice(m[0].length);
      if (!first.textContent.trim() && !first.querySelector('*')) first.remove();

      var box = el(
        '<div class="callout callout-' + spec.cls + '">' +
          svg(spec.path, { size: 18, stroke: spec.stroke, width: 1.9, circle: spec.circle }) +
          '<div><div class="callout-title">' + kind.charAt(0) + kind.slice(1).toLowerCase() + '</div>' +
          '<div class="callout-body"></div></div>' +
        '</div>'
      );
      var body = box.querySelector('.callout-body');
      while (q.firstChild) body.appendChild(q.firstChild);
      q.replaceWith(box);
    });
  }

  // Headings get an id and a hover anchor; "### 1. Foo" gets a numbered badge.
  function upgradeHeadings(root) {
    var seen = {};
    root.querySelectorAll('h2, h3').forEach(function (h) {
      var step = h.tagName === 'H3' && h.textContent.match(/^\s*(\d+)\.\s+/);
      if (step) {
        h.classList.add('step');
        h.innerHTML = h.innerHTML.replace(/^\s*\d+\.\s+/, '');
        h.insertBefore(el('<span class="step-num">' + step[1] + '</span>'), h.firstChild);

        // Markdown can't nest under a heading, so pull the step's content into a
        // wrapper that lines up with the heading text rather than the badge.
        var body = el('<div class="step-body"></div>');
        var n = h.nextElementSibling;
        while (n && !/^H[23]$/.test(n.tagName)) {
          var after = n.nextElementSibling;
          body.appendChild(n);
          n = after;
        }
        h.after(body);
      }

      // Same slug function search.js uses, so its deep links land correctly.
      var slug = C.slugify(h.textContent);
      if (seen[slug]) slug += '-' + (++seen[slug]); else seen[slug] = 1;
      h.id = slug;

      h.appendChild(el('<a class="anchor" href="#' + slug + '" aria-label="Link to this section">#</a>'));
    });
  }

  function upgradeCode(root) {
    root.querySelectorAll('pre > code').forEach(function (code) {
      var pre = code.parentElement;
      var lang = (code.className.match(/language-(\S+)/) || [, 'text'])[1];

      var fig = el(
        '<figure class="code-figure">' +
          '<div class="code-head"><span>' + esc(lang) + '</span>' +
            '<button class="code-copy" type="button">' +
              svg(ICON.copy, { size: 13, stroke: '#5c5c5c' }).replace('<path', '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path') +
              '<span>Salin</span></button>' +
          '</div>' +
        '</figure>'
      );
      pre.replaceWith(fig);
      fig.appendChild(pre);

      fig.querySelector('.code-copy').addEventListener('click', function () {
        copy(code.textContent, this);
      });
    });
  }

  function upgradeTables(root) {
    root.querySelectorAll('table').forEach(function (t) {
      var wrap = el('<div class="table-wrap"></div>');
      t.replaceWith(wrap);
      wrap.appendChild(t);
    });
  }

  // Relative paths in the markdown are relative to the .md file, not to this page,
  // so "docs/assets/x.png" resolves the same way here as it does on GitHub.
  function rebase(root, base) {
    root.querySelectorAll("img[src], a[href], source[src]").forEach(function (n) {
      var attr = n.tagName === "A" ? "href" : "src";
      var v = n.getAttribute(attr);
      if (!v) return;
      var c = v.charAt(0);
      if (c === "#" || c === "?" || c === "/") return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return;
      n.setAttribute(attr, new URL(v, base).href);
    });
  }

  // Links leave the page, so they open in a new tab; in-page anchors stay put.
  function externalize(root) {
    root.querySelectorAll('a[href]').forEach(function (a) {
      if (a.getAttribute('href').charAt(0) === '#') return;
      a.target = '_blank';
      a.rel = 'noopener';
    });
  }

  function lightbox(root) {
    var box = el('<div class="lightbox"><button class="lightbox-close" type="button" aria-label="Close">' +
      svg(ICON.close, { size: 20, stroke: '#d4d4d4', width: 2 }) + '</button><img alt=""></div>');
    document.body.appendChild(box);

    var full = box.querySelector('img');
    var close = function () { box.classList.remove('is-open'); };

    root.querySelectorAll('img').forEach(function (im) {
      // A linked image follows its link instead of zooming.
      if (im.closest('a')) return;
      im.addEventListener('click', function () {
        full.src = im.currentSrc || im.src;
        full.alt = im.alt || '';
        box.classList.add('is-open');
      });
    });

    box.addEventListener('click', function (e) { if (e.target !== full) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  function copy(text, btn) {
    navigator.clipboard.writeText(text).then(function () {
      var label = btn.querySelector('span');
      var was = label.textContent;
      label.textContent = 'Tersalin';
      btn.classList.add('is-done');
      setTimeout(function () {
        label.textContent = was;
        btn.classList.remove('is-done');
      }, 1600);
    });
  }

  /* ── heading rail ───────────────────────────────────── */

  function buildRail(root) {
    var heads = Array.prototype.slice.call(root.querySelectorAll('h2, h3'));
    if (heads.length < 2) return;

    var ticks = '', links = '';
    heads.forEach(function (h) {
      var lvl = h.tagName === 'H3' ? 3 : 2;

      // Read the label off a clone so the anchor and the step badge do not run
      // into the title as one word.
      var clone = h.cloneNode(true);
      var anchor = clone.querySelector('.anchor');
      if (anchor) anchor.remove();
      var num = clone.querySelector('.step-num');
      var prefix = '';
      if (num) { prefix = num.textContent.trim() + '. '; num.remove(); }
      var text = prefix + clone.textContent.trim();
      ticks += '<div class="rail-tick" data-for="' + h.id + '" data-base="' + (lvl === 2 ? 22 : 13) + '" ' +
        'style="width:' + (lvl === 2 ? 22 : 13) + 'px"></div>';
      links += '<a class="rail-link' + (lvl === 3 ? ' lvl3' : '') + '" data-for="' + h.id + '" href="#' + h.id + '">' + esc(text) + '</a>';
    });

    var rail = el(
      '<div class="rail"><div class="rail-inner">' +
        '<div class="rail-ticks">' + ticks + '</div>' +
        '<div class="rail-panel"><div class="rail-label">DI HALAMAN INI</div>' + links + '</div>' +
      '</div></div>'
    );
    document.body.appendChild(rail);

    var toc = el(
      '<details class="toc-mobile"><summary>' + svg(ICON.list, { size: 16, stroke: '#7fa6e6', width: 1.9 }) +
      'Di halaman ini</summary><div class="toc-list">' + links + '</div></details>'
    );
    root.parentElement.insertBefore(toc, root);

    magnify(rail);
    spy(heads, rail);
  }

  // Ticks grow and warm toward the pointer, dock-style.
  function magnify(rail) {
    var ticks = Array.prototype.slice.call(rail.querySelectorAll('.rail-tick'));
    var REACH_Y = 96, REACH_X = 240, GROW = 15;
    var lastX = null, lastY = 0, queued = false;

    function paint(px, py) {
      lastX = px;
      lastY = py;
      var rr = rail.getBoundingClientRect();
      var near = px === null ? 0 : Math.max(0, 1 - Math.abs(px - rr.right) / REACH_X);

      ticks.forEach(function (t) {
        var base = Number(t.dataset.base) || 13;
        var r = t.getBoundingClientRect();
        var d = px === null ? Infinity : Math.abs(py - (r.top + r.height / 2));
        var lin = Math.max(0, 1 - d / REACH_Y);
        var e = lin * lin * (3 - 2 * lin) * near;
        var bonus = t.classList.contains('is-active') ? 4 : 0;

        t.style.width = (base + bonus + GROW * e) + 'px';
        t.style.transform = 'translateX(' + (-7 * e) + 'px)';
        if (!t.classList.contains('is-active')) {
          t.style.background = 'rgb(' + Math.round(61 + 66 * e) + ',' +
            Math.round(61 + 105 * e) + ',' + Math.round(61 + 169 * e) + ')';
        }
      });
    }

    document.addEventListener('pointermove', function (ev) {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; paint(ev.clientX, ev.clientY); });
    }, { passive: true });
    document.addEventListener('pointerleave', function () { paint(null, 0); });

    rail.repaint = function () { paint(lastX, lastY); };
    paint(null, 0);
  }

  // Last heading past the reading line wins.
  function spy(heads, rail) {
    var line = 110;
    var queued = false;

    function sync() {
      var current = heads[0];
      heads.forEach(function (h) {
        if (h.getBoundingClientRect().top <= line) current = h;
      });

      rail.querySelectorAll('.rail-tick').forEach(function (t) {
        var on = t.dataset.for === current.id;
        t.classList.toggle('is-active', on);
        if (!on) t.style.background = '';
      });
      document.querySelectorAll('.rail-link').forEach(function (a) {
        a.classList.toggle('is-active', a.dataset.for === current.id);
      });
      if (rail.repaint) rail.repaint();
    }

    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; sync(); });
    }, { passive: true });
    sync();
  }

  /* ── boot ───────────────────────────────────────────── */

  function fail(msg) {
    document.body.appendChild(el(
      '<div class="doc-wrap"><h1 class="doc-title">Dokumentasi ini gagal dimuat</h1>' +
      '<p class="doc-lede">' + esc(msg) + '</p></div>'
    ));
  }

  var header = C.buildHeader();
  document.body.appendChild(header);
  C.slideNav(header);

  var wrap = el('<main class="doc-wrap"></main>');
  document.body.appendChild(wrap);
  wrap.appendChild(buildHero());

  var article = el('<article class="doc-body"></article>');
  wrap.appendChild(article);

  externalize(wrap);

  wrap.querySelector('.install-copy').addEventListener('click', function () {
    copy(this.dataset.url, this);
  });

  var importUrl = boot.importUrl || new URL('import.sb', new URL(boot.widgetUrl || '../', location.href)).href;
  fetch(importUrl)
    .then(function (r) { return r.ok ? r.text() : null; })
    .then(function (code) {
      // A missing file can come back as the host's 404 page, so require an .sb payload.
      if (!code || /^\s*</.test(code)) return;
      var card = buildImportCard(code.trim());
      wrap.querySelector('.install-card').after(card);
      if (location.hash === '#' + card.id) card.scrollIntoView();
    })
    .catch(function () {});

  fetch(boot.source)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (md) {
      // Drop a leading H1 — the hero already carries the title.
      md = md.replace(/^\s*#\s+.*\n+/, '');
      // Parsed inert so nothing loads before the paths are corrected.
      var parsed = new DOMParser().parseFromString(marked.parse(md), "text/html");
      rebase(parsed, new URL(boot.source, location.href));
      while (parsed.body.firstChild) article.appendChild(parsed.body.firstChild);

      upgradeAlerts(article);
      upgradeHeadings(article);
      upgradeCode(article);
      upgradeTables(article);
      buildRail(article);
      lightbox(article);
      externalize(article);

      wrap.appendChild(buildFooter());

      if (location.hash) {
        var t = document.getElementById(location.hash.slice(1));
        if (t) t.scrollIntoView();
      }
    })
    .catch(function (e) {
      fail('Tidak bisa membaca ' + boot.source + ' (' + e.message + '). Kalau ini dibuka dari ' +
        'sistem berkas, sajikan foldernya lewat http — fetch tidak bekerja pada URL file://.');
    });
})();
