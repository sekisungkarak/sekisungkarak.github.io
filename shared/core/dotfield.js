/* DotField, a grid of dots that bulges away from the cursor, under a soft glow
   that follows it. Ported from React Bits' <DotField /> (React + canvas) to a
   plain module, because this site has no build step and no React.

   No dependencies: the component is canvas 2D plus one SVG gradient, so the
   port keeps the original's maths untouched and drops only the React wrapper.

   Usage:
     var field = DotField.mount(container, { dotRadius: 1.5, dotSpacing: 14 });
     field.setOptions({ gradientFrom: '#fff' });   // on a theme change
     field.destroy();

   Returns null if the container has no size, so a caller can leave the page
   alone rather than draw into nothing. */

const DEFAULTS = {
  dotRadius: 1.5,
  dotSpacing: 14,
  cursorRadius: 500,
  cursorForce: 0.1,
  bulgeOnly: true,
  bulgeStrength: 67,
  glowRadius: 160,
  sparkle: false,
  waveAmplitude: 0,
  gradientFrom: 'rgba(168, 85, 247, 0.35)',
  gradientTo: 'rgba(180, 151, 207, 0.25)',
  glowColor: '#120F17',
};

const TWO_PI = Math.PI * 2;

let glowSeq = 0;

export function mount(container, opts) {
  if (!container) return null;
  const o = Object.assign({}, DEFAULTS, opts || {});

  const doc = container.ownerDocument || document;
  const canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    container.removeChild(canvas);
    return null;
  }

  // The glow is one SVG circle filled by a radial gradient. Its id must be
  // unique per instance: two fields on one page would otherwise share it.
  //
  // Both stops carry the SAME colour, and only the opacity falls to zero. The
  // obvious `stop-color="transparent"` is a trap: in SVG that keyword means
  // rgba(0,0,0,0), not "whatever colour, faded out", so the gradient would run
  // through black and leave a dark halo, invisible on a dark page, a grey
  // smudge on a light one.
  const glowId = 'dotfield-glow-' + (++glowSeq);
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  svg.innerHTML =
    '<defs><radialGradient id="' + glowId + '">' +
    '<stop offset="0%" stop-color="' + o.glowColor + '" stop-opacity="1"></stop>' +
    '<stop offset="100%" stop-color="' + o.glowColor + '" stop-opacity="0"></stop>' +
    '</radialGradient></defs>' +
    '<circle cx="-9999" cy="-9999" r="' + o.glowRadius + '" ' +
    'fill="url(#' + glowId + ')" style="opacity:0;will-change:opacity"></circle>';
  container.appendChild(svg);
  const glowEl = svg.querySelector('circle');
  const glowStops = svg.querySelectorAll('stop');

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let dots = [];
  let size = { w: 0, h: 0, offsetX: 0, offsetY: 0 };
  let raf = 0;
  let frameCount = 0;
  let running = false;

  const mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 };
  let glowOpacity = 0;
  let engagement = 0;

  function buildDots(w, h) {
    const step = o.dotRadius + o.dotSpacing;
    const cols = Math.floor(w / step);
    const rows = Math.floor(h / step);
    const padX = (w % step) / 2;
    const padY = (h % step) / 2;
    const next = new Array(Math.max(0, rows * cols));
    let idx = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const ax = padX + col * step + step / 2;
        const ay = padY + row * step + step / 2;
        next[idx++] = { ax: ax, ay: ay, sx: ax, sy: ay, vx: 0, vy: 0, x: ax, y: ay };
      }
    }
    dots = next;
  }

  function measure() {
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return false;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The pointer arrives in page coordinates, so the container's own page
    // offset is what turns it back into a local one.
    size = {
      w: w,
      h: h,
      offsetX: rect.left + window.scrollX,
      offsetY: rect.top + window.scrollY,
    };
    buildDots(w, h);
    return true;
  }

  function onMouseMove(e) {
    mouse.x = e.pageX - size.offsetX;
    mouse.y = e.pageY - size.offsetY;
  }

  // A smoothed pointer speed, sampled on its own timer: the component derives
  // how "engaged" the cursor is from this, and reading it per frame would make
  // the value depend on the frame rate.
  function updateMouseSpeed() {
    const dx = mouse.prevX - mouse.x;
    const dy = mouse.prevY - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    mouse.speed += (dist - mouse.speed) * 0.5;
    if (mouse.speed < 0.001) mouse.speed = 0;
    mouse.prevX = mouse.x;
    mouse.prevY = mouse.y;
  }

  function draw(animate) {
    const w = size.w;
    const h = size.h;
    const len = dots.length;
    const t = frameCount * 0.02;

    if (animate) {
      const targetEngagement = Math.min(mouse.speed / 5, 1);
      engagement += (targetEngagement - engagement) * 0.06;
      if (engagement < 0.001) engagement = 0;
      glowOpacity += (engagement - glowOpacity) * 0.08;
      glowEl.setAttribute('cx', mouse.x);
      glowEl.setAttribute('cy', mouse.y);
      glowEl.style.opacity = glowOpacity;
    }

    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, o.gradientFrom);
    grad.addColorStop(1, o.gradientTo);
    ctx.fillStyle = grad;

    const cr = o.cursorRadius;
    const crSq = cr * cr;
    const rad = o.dotRadius / 2;
    const eng = engagement;

    ctx.beginPath();

    for (let i = 0; i < len; i++) {
      const d = dots[i];

      if (animate) {
        const dx = mouse.x - d.ax;
        const dy = mouse.y - d.ay;
        const distSq = dx * dx + dy * dy;

        if (distSq < crSq && eng > 0.01) {
          const dist = Math.sqrt(distSq);
          const angle = Math.atan2(dy, dx);
          if (o.bulgeOnly) {
            // Bulge: the dot is pushed radially away, hardest at the centre.
            const f = 1 - dist / cr;
            const push = f * f * o.bulgeStrength * eng;
            d.sx += (d.ax - Math.cos(angle) * push - d.sx) * 0.15;
            d.sy += (d.ay - Math.sin(angle) * push - d.sy) * 0.15;
          } else {
            const move = (500 / dist) * (mouse.speed * o.cursorForce);
            d.vx += Math.cos(angle) * -move;
            d.vy += Math.sin(angle) * -move;
          }
        } else if (o.bulgeOnly) {
          d.sx += (d.ax - d.sx) * 0.1;
          d.sy += (d.ay - d.sy) * 0.1;
        }

        if (!o.bulgeOnly) {
          d.vx *= 0.9;
          d.vy *= 0.9;
          d.x = d.ax + d.vx;
          d.y = d.ay + d.vy;
          d.sx += (d.x - d.sx) * 0.1;
          d.sy += (d.y - d.sy) * 0.1;
        }
      }

      let drawX = d.sx;
      let drawY = d.sy;
      if (o.waveAmplitude > 0) {
        drawY += Math.sin(d.ax * 0.03 + t) * o.waveAmplitude;
        drawX += Math.cos(d.ay * 0.03 + t * 0.7) * o.waveAmplitude * 0.5;
      }

      // Sparkle: ~3% of dots, chosen by a hash of the index and the frame so
      // the set flickers instead of lighting up in the same place forever.
      let r = rad;
      if (o.sparkle) {
        const hash = ((i * 2654435761) ^ (frameCount >> 3)) >>> 0;
        if (hash % 100 < 3) r = rad * 1.8;
      }
      ctx.moveTo(drawX + r, drawY);
      ctx.arc(drawX, drawY, r, 0, TWO_PI);
    }

    ctx.fill();
  }

  function tick() {
    frameCount++;
    draw(true);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  if (!measure()) {
    // Laid out with no size yet (display:none, or a zero-height parent). Give
    // up rather than draw into a 0x0 canvas; the ResizeObserver below will not
    // have been created, so nothing is left running.
    container.removeChild(canvas);
    container.removeChild(svg);
    return null;
  }

  const speedTimer = setInterval(updateMouseSpeed, 20);

  const reduced = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The palette lives in CSS custom properties on :root, so a theme swap is a
  // stylesheet change. Re-reading them here is what keeps the canvas in step
  // without either side reaching into the other.
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const from = cs.getPropertyValue('--dot-from').trim();
    const to = cs.getPropertyValue('--dot-to').trim();
    const glow = cs.getPropertyValue('--dot-glow').trim();
    const patch = {};
    if (from) patch.gradientFrom = from;
    if (to) patch.gradientTo = to;
    if (glow) patch.glowColor = glow;
    return patch;
  }

  const api = {
    // A theme swap only changes colours, so this must not rebuild the grid,
    // rebuilding would snap every bulged dot back to rest.
    setOptions: function (patch) {
      const rebuild = !!(patch && ('dotRadius' in patch || 'dotSpacing' in patch));
      Object.assign(o, patch || {});
      if (patch && patch.glowColor) {
        for (let i = 0; i < glowStops.length; i++) {
          glowStops[i].setAttribute('stop-color', patch.glowColor);
        }
      }
      if (patch && patch.glowRadius) glowEl.setAttribute('r', patch.glowRadius);
      if (rebuild) buildDots(size.w, size.h);
      if (!running) draw(false);
    },
    destroy: function () {
      stop();
      clearInterval(speedTimer);
      clearTimeout(resizeTimer);
      if (themeObserver) themeObserver.disconnect();
      if (!reduced) {
        doc.removeEventListener('mousemove', onMouseMove);
        if (onVisibility) doc.removeEventListener('visibilitychange', onVisibility);
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', onResize);
        if (io) io.disconnect();
      }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    },
  };

  // Pick up the theme the page booted with, so the first frame already matches.
  api.setOptions(readPalette());

  let themeObserver = null;
  if ('MutationObserver' in window) {
    themeObserver = new MutationObserver(function () {
      api.setOptions(readPalette());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  let ro = null;
  let io = null;
  let onVisibility = null;
  let resizeTimer = 0;

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (measure()) draw(false);
    }, 100);
  }

  if (reduced) {
    // Static: the grid is drawn once and the pointer is never read.
    draw(false);
  } else {
    doc.addEventListener('mousemove', onMouseMove, { passive: true });

    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(onResize);
      ro.observe(container);
    } else {
      window.addEventListener('resize', onResize);
    }

    // A backdrop has no business burning a frame budget behind another tab or
    // below the fold.
    onVisibility = function () { doc.hidden ? stop() : start(); };
    doc.addEventListener('visibilitychange', onVisibility);

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && !doc.hidden) start(); else stop();
        });
      }, { threshold: 0 });
      io.observe(container);
    }

    start();
  }

  return api;
}

export default { mount };
