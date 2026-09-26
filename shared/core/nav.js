/* Hold-on-navigate.

   Clicking an internal link normally swaps pages the moment the browser has a
   response, so you land on a document that is still fetching its images. This
   keeps you on the page you are already looking at, runs a progress bar, warms
   the destination, and only then navigates — so arrivals are whole.

   Everything degrades to a plain link: no JS, modifier-click, new tab, external
   host, download and in-page anchors are all left alone. */
(function () {
  'use strict';

  var root = document.documentElement;
  var bar, timer, done;

  function build() {
    bar = document.createElement('div');
    bar.className = 'nav-progress';
    document.body.appendChild(bar);
  }

  function start() {
    if (!bar) build();
    clearTimeout(timer);
    done = false;
    bar.classList.remove('is-done');
    bar.style.transform = 'scaleX(0)';
    // Crawls toward 90% — it reports that something is happening, not how far along.
    requestAnimationFrame(function () {
      bar.classList.add('is-on');
      bar.style.transform = 'scaleX(0.9)';
    });
  }

  function finish() {
    if (!bar || done) return;
    done = true;
    bar.style.transform = 'scaleX(1)';
    bar.classList.add('is-done');
    timer = setTimeout(function () { bar.classList.remove('is-on', 'is-done'); }, 320);
  }

  // Pull the document into cache before leaving. Capped, so a slow or failed
  // request never strands anyone on the old page.
  function warm(href) {
    return Promise.race([
      fetch(href, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).catch(function () {}),
      new Promise(function (r) { setTimeout(r, 2500); })
    ]);
  }

  function handled(e) {
    if (e.defaultPrevented || e.button !== 0) return null;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;

    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.hasAttribute('download') || a.target === '_blank') return null;
    if ((a.getAttribute('rel') || '').indexOf('external') > -1) return null;

    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return null; }
    if (url.origin !== location.origin) return null;
    if (!/^https?:$/.test(url.protocol)) return null;
    // An anchor on this page is not a navigation.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
    return url;
  }

  document.addEventListener('click', function (e) {
    var url = handled(e);
    if (!url) return;
    e.preventDefault();
    start();
    warm(url.href).then(function () { location.href = url.href; });
  });

  // Back/forward and any navigation we did not start still get the bar.
  window.addEventListener('beforeunload', start);
  window.addEventListener('pageshow', finish);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
