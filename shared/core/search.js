/* Site-wide jump-to. Opened by the header pill or "/", closed by Escape.

   The index is derived, never hand-written: every catalog entry, plus every
   ## and ### in every widget's README. Add a widget to catalog.js and it
   becomes searchable with no other change. */
(function () {
  'use strict';

  var C = window.CHROME;
  if (!C) return;

  // Keyed on the catalog's own contents, so editing catalog.js drops the
  // stale index instead of serving it for the rest of the session.
  var CACHE_KEY = 'geseki:search:v2:' + stamp();
  var index = null;
  var loading = null;
  var box, input, list, results = [], cursor = 0;

  /* ── index ──────────────────────────────────────────── */

  function stamp() {
    var src = JSON.stringify(C.catalog), h = 0;
    for (var i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Mirrors upgradeHeadings() in docs.js: a "### 1. Foo" heading renders its
  // number as a badge, so the slug is built from "1" + "Foo". Diverge here and
  // every step deep-link lands on the wrong place, silently.
  function headings(md) {
    var out = [], seen = {};
    md.replace(/```[\s\S]*?```/g, '').replace(/^(#{2,3})\s+(.+?)\s*$/gm, function (_, hashes, raw) {
      var text = raw.replace(/[*`_]/g, '').trim();
      var step = text.match(/^(\d+)\.\s+(.*)$/);
      var slug = C.slugify(step ? step[1] + step[2] : text);
      if (seen[slug]) slug += '-' + (++seen[slug]); else seen[slug] = 1;
      out.push({ label: step ? step[1] + '. ' + step[2] : text, slug: slug, level: hashes.length });
      return '';
    });
    return out;
  }

  function build() {
    if (loading) return loading;

    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(CACHE_KEY)); } catch (e) {}
    if (cached) { index = cached; return Promise.resolve(index); }

    loading = Promise.all(C.catalog.map(function (c) {
      var rows = [{
        kind: 'widget', widget: c.name, accent: c.accent, icon: c.icon,
        label: c.name, sub: c.eyebrow || 'widget', href: C.root(c.docsUrl)
      }];
      return fetch(C.root(c.widgetUrl + 'README.md'))
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (md) {
          // A missing file can come back as the host's 404 page.
          if (md && !/^\s*</.test(md)) {
            headings(md).forEach(function (h) {
              rows.push({
                kind: 'heading', widget: c.name, accent: c.accent, icon: c.icon,
                label: h.label, sub: c.name, level: h.level,
                href: C.root(c.docsUrl) + '#' + h.slug
              });
            });
          }
          return rows;
        })
        .catch(function () { return rows; });
    })).then(function (groups) {
      index = groups.reduce(function (a, b) { return a.concat(b); }, []);
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(index)); } catch (e) {}
      return index;
    });

    return loading;
  }

  /* ── matching ───────────────────────────────────────── */

  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return index.filter(function (r) { return r.kind === 'widget'; });

    return index
      .map(function (r) {
        var label = r.label.toLowerCase();
        var at = label.indexOf(q);
        if (at < 0 && (r.sub || '').toLowerCase().indexOf(q) < 0) return null;
        // Whole-word starts beat mid-word hits; widgets beat their headings.
        var score = (at === 0 ? 0 : at < 0 ? 40 : 10) + (r.kind === 'widget' ? 0 : 5);
        return { row: r, score: score };
      })
      .filter(Boolean)
      .sort(function (a, b) { return a.score - b.score; })
      .slice(0, 24)
      .map(function (x) { return x.row; });
  }

  /* ── ui ─────────────────────────────────────────────── */

  function render() {
    if (!results.length) {
      list.innerHTML = '<div class="sr-empty">Tidak ada yang cocok.</div>';
      return;
    }
    var last = null, html = '';
    results.forEach(function (r, i) {
      if (r.widget !== last) {
        html += '<div class="sr-group">' + C.esc(r.widget) + '</div>';
        last = r.widget;
      }
      var url = C.iconUrl(r.icon, r.accent);
      var glyph = r.kind === 'widget' && url
        ? '<img class="sr-icon" src="' + C.esc(url) + '" alt="" width="15" height="15">'
        : '<span class="sr-dot" style="background:' + r.accent + '"></span>';
      html += '<a class="sr-item' + (i === cursor ? ' is-on' : '') + '" data-i="' + i + '" href="' + C.esc(r.href) + '">' +
        glyph + '<span class="sr-label">' + C.esc(r.label) + '</span>' +
        '<span class="sr-sub">' + C.esc(r.kind === 'widget' ? r.sub : 'dokumentasi') + '</span></a>';
    });
    list.innerHTML = html;
    var on = list.querySelector('.is-on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function run() {
    results = index ? search(input.value) : [];
    cursor = 0;
    render();
  }

  function open() {
    if (!box) return;
    box.classList.add('is-open');
    input.value = '';
    list.innerHTML = '<div class="sr-empty">Memuat…</div>';
    input.focus();
    build().then(function () { run(); });
  }

  function close() {
    if (box) box.classList.remove('is-open');
  }

  function move(step) {
    if (!results.length) return;
    cursor = (cursor + step + results.length) % results.length;
    render();
  }

  function mount() {
    box = C.el(
      '<div class="search-modal" role="dialog" aria-label="Cari">' +
        '<div class="search-panel">' +
          '<div class="search-field">' +
            C.svg('M21 21l-4.3-4.3', { size: 16, stroke: '#8b8b8b', width: 2 })
              .replace('<path', '<circle cx="11" cy="11" r="7"></circle><path') +
            '<input type="text" placeholder="Cari widget dan dokumentasi" autocomplete="off" spellcheck="false">' +
            '<kbd>esc</kbd>' +
          '</div>' +
          '<div class="search-results"></div>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(box);
    input = box.querySelector('input');
    list = box.querySelector('.search-results');

    input.addEventListener('input', run);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    list.addEventListener('pointermove', function (e) {
      var item = e.target.closest('.sr-item');
      if (item && +item.dataset.i !== cursor) { cursor = +item.dataset.i; render(); }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter' && results[cursor]) { location.href = results[cursor].href; }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') return close();
      // "/" opens from anywhere, unless the caret is already in a field.
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); open(); }
    });

    document.querySelectorAll('.search-pill').forEach(function (b) {
      b.addEventListener('click', open);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.SEARCH = { open: open, close: close };
})();
