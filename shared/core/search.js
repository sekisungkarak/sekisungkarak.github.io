/* Site-wide jump-to. Opened by the header pill or "/", closed by Escape.

   The index is derived, never hand-written: every catalog entry, plus every
   ## and ### in every widget's README. Add a widget to catalog.js and it
   becomes searchable with no other change.

   Presentation is a command palette: a leading kind glyph, the matched run
   highlighted in the label, a trailing action glyph, rows grouped under a
   heading that names where the group leads. */
(function () {
  'use strict';

  var C = window.CHROME;
  if (!C) return;
  var T = C.T || function (s) { return s; };

  // Keyed on the catalog's own contents, so editing catalog.js drops the
  // stale index instead of serving it for the rest of the session.
  var CACHE_KEY = 'geseki:search:v3:' + stamp();
  var index = null;
  var loading = null;
  var box, input, list, results = [], cursor = 0;

  // A leading glyph per row kind, so the two groups are told apart at a glance
  // even when a widget has no icon of its own.
  var KIND = {
    widget: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    heading: 'M9 3L7 21M17 3l-2 18M3 9h18M3 15h18'
  };
  // The trailing glyph: a plain arrow for a page, a return key for a jump.
  var ACT = {
    widget: 'M5 12h13M13 6l6 6-6 6',
    heading: 'M9 10L4 15l5 5M4 15h11a5 5 0 0 0 5-5V6'
  };

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
        label: c.name, sub: c.eyebrow || T('widget'), href: C.root(c.docsUrl)
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

  /* ── render ─────────────────────────────────────────── */

  // Escapes, then wraps the matched run so the query stays visible in the row.
  // Escaping first and slicing after keeps the <mark> tags out of the escape.
  function mark(label, q) {
    if (!q) return C.esc(label);
    var at = label.toLowerCase().indexOf(q);
    if (at < 0) return C.esc(label);
    return C.esc(label.slice(0, at)) +
      '<mark>' + C.esc(label.slice(at, at + q.length)) + '</mark>' +
      C.esc(label.slice(at + q.length));
  }

  // The glyph a row leads with: the widget's own icon when it has one, and a
  // kind glyph otherwise.
  function glyph(r) {
    var url = r.kind === 'widget' ? C.iconUrl(r.icon, r.accent) : null;
    if (url) return '<img class="sr-icon" src="' + C.esc(url) + '" alt="" width="15" height="15">';
    return '<span class="sr-kind" style="color:' + C.esc(r.accent) + '">' +
      C.svg(KIND[r.kind] || KIND.widget, { size: 15, stroke: 'currentColor', width: 1.8 }) + '</span>';
  }

  function render() {
    if (!results.length) {
      list.innerHTML = '<div class="sr-empty">' + C.esc(T('Nothing matches that.')) + '</div>';
      return;
    }
    var q = input.value.trim().toLowerCase();
    var last = null, html = '';
    results.forEach(function (r, i) {
      // A heading row names the group and says where it leads.
      if (r.widget !== last) {
        html += '<div class="sr-group">' +
          '<span class="sr-group-name">' + C.esc(r.widget) + '</span>' +
          '<span class="sr-group-hint">' + C.esc(T('opens documentation')) + '</span></div>';
        last = r.widget;
      }
      html += '<a class="sr-item' + (i === cursor ? ' is-on' : '') + '" data-i="' + i + '" href="' + C.esc(r.href) + '">' +
        glyph(r) +
        '<span class="sr-text">' +
          '<span class="sr-label">' + mark(r.label, q) + '</span>' +
          '<span class="sr-sub">' + C.esc(r.kind === 'widget' ? T(r.sub) : T('Section')) + '</span>' +
        '</span>' +
        '<span class="sr-act">' + C.svg(ACT[r.kind] || ACT.widget, { size: 14, stroke: 'currentColor', width: 1.9 }) + '</span>' +
      '</a>';
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
    list.innerHTML = '<div class="sr-empty">' + C.esc(T('Loading…')) + '</div>';
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
      '<div class="search-modal" role="dialog" aria-label="' + C.esc(T('Search')) + '">' +
        '<div class="search-panel">' +
          '<div class="search-field">' +
            C.svg('M21 21l-4.3-4.3', { size: 16, stroke: 'currentColor', width: 2 })
              .replace('<path', '<circle cx="11" cy="11" r="7"></circle><path') +
            '<input type="text" placeholder="' + C.esc(T('Search widgets, sections, or keywords…')) + '" autocomplete="off" spellcheck="false">' +
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
