/* Antigravity — a field of particles that gathers into a ring around the
   pointer. Ported from React Bits' <Antigravity /> (React + react-three/fiber)
   to plain three.js, because this site has no build step and no React.

   The maths is the component's own, kept 1:1 so the motion matches the
   original: particles drift on a random walk, and any particle whose distance
   to the pointer drops below `magnetRadius` is pulled onto a ring of
   `ringRadius` and pushed around it by a travelling wave.

   The pointer is fed in as normalised device coords (-1..1, y up), which is
   exactly what react-three/fiber's `state.pointer` gives the original, so no
   part of the simulation needed rewriting.

   Usage:
     Antigravity.mount(container, { count: 300, color: '#d4a843' })
   Returns a handle with .destroy(), or null when WebGL is unavailable. */

import * as THREE from '../vendor/three.module.min.js';

const DEFAULTS = {
  count: 300,
  magnetRadius: 6,
  ringRadius: 7,
  waveSpeed: 0.4,
  waveAmplitude: 1,
  particleSize: 1.5,
  lerpSpeed: 0.05,
  color: '#d4a843',
  autoAnimate: true,
  particleVariance: 1,
  rotationSpeed: 0,
  depthFactor: 1,
  pulseSpeed: 3,
  particleShape: 'capsule',
  fieldStrength: 10,
};

// react-three/fiber's default camera for this component: position [0,0,50], fov 35.
const CAMERA_FOV = 35;
const CAMERA_Z = 50;

function geometryFor(shape) {
  switch (shape) {
    case 'sphere': return new THREE.SphereGeometry(0.2, 16, 16);
    case 'box': return new THREE.BoxGeometry(0.3, 0.3, 0.3);
    case 'tetrahedron': return new THREE.TetrahedronGeometry(0.3);
    default: return new THREE.CapsuleGeometry(0.1, 0.4, 4, 8);
  }
}

/* A field of particles drawn as one instanced mesh. Every particle carries its
   own drift state; the per-frame loop only writes matrices. */
export function createField(renderer, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 1000);
  camera.position.set(0, 0, CAMERA_Z);

  const dummy = new THREE.Object3D();
  const particles = [];
  // Visible height at z=0 for this camera — the plane the ring lives on.
  let viewW = 100;
  let viewH = 100;

  const mesh = new THREE.InstancedMesh(
    geometryFor(o.particleShape),
    new THREE.MeshBasicMaterial({ color: o.color }),
    o.count
  );
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Mirrors the original's useMemo([count, viewport.width, viewport.height]):
  // seeding is relative to the viewport, so it must be redone on resize.
  function seed() {
    particles.length = 0;
    for (let i = 0; i < o.count; i++) {
      const x = (Math.random() - 0.5) * viewW;
      const y = (Math.random() - 0.5) * viewH;
      const z = (Math.random() - 0.5) * 20;
      particles.push({
        t: Math.random() * 100,
        speed: 0.01 + Math.random() / 200,
        mx: x, my: y, mz: z,
        cx: x, cy: y, cz: z,
        randomRadiusOffset: (Math.random() - 0.5) * 2,
      });
    }
  }

  function resize(w, h) {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Same expression three.js uses for the visible plane at a given depth.
    viewH = 2 * Math.tan((camera.fov * Math.PI) / 360) * CAMERA_Z;
    viewW = viewH * camera.aspect;
    seed();
  }

  // Pointer state, in the same shape react-three/fiber hands the original.
  const pointer = { x: 0, y: 0 };
  const lastMousePos = { x: 0, y: 0 };
  let lastMouseMoveTime = 0;
  const virtualMouse = { x: 0, y: 0 };
  let elapsed = 0;
  let lastFrameAt = 0;

  function frame(now) {
    const dt = lastFrameAt ? Math.min((now - lastFrameAt) / 1000, 0.1) : 0;
    lastFrameAt = now;
    elapsed += dt;

    const m = pointer;
    const v = { width: viewW, height: viewH };

    const mouseDist = Math.hypot(m.x - lastMousePos.x, m.y - lastMousePos.y);
    if (mouseDist > 0.001) {
      lastMouseMoveTime = now;
      lastMousePos.x = m.x;
      lastMousePos.y = m.y;
    }

    let destX = (m.x * v.width) / 2;
    let destY = (m.y * v.height) / 2;

    if (o.autoAnimate && now - lastMouseMoveTime > 2000) {
      const time = elapsed;
      destX = Math.sin(time * 0.5) * (v.width / 4);
      destY = Math.cos(time * 0.5 * 2) * (v.height / 4);
    }

    const smoothFactor = 0.05;
    virtualMouse.x += (destX - virtualMouse.x) * smoothFactor;
    virtualMouse.y += (destY - virtualMouse.y) * smoothFactor;

    const targetX = virtualMouse.x;
    const targetY = virtualMouse.y;
    const globalRotation = elapsed * o.rotationSpeed;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let { t, speed, mx, my, mz, cz, randomRadiusOffset } = p;

      t = p.t += speed / 2;

      const projectionFactor = 1 - cz / 50;
      const projectedTargetX = targetX * projectionFactor;
      const projectedTargetY = targetY * projectionFactor;

      const dx = mx - projectedTargetX;
      const dy = my - projectedTargetY;
      const dist = Math.hypot(dx, dy);

      let tx = mx, ty = my, tz = mz * o.depthFactor;

      if (dist < o.magnetRadius) {
        const angle = Math.atan2(dy, dx) + globalRotation;
        const wave = Math.sin(t * o.waveSpeed + angle) * (0.5 * o.waveAmplitude);
        const deviation = randomRadiusOffset * (5 / (o.fieldStrength + 0.1));
        const currentRingRadius = o.ringRadius + wave + deviation;

        tx = projectedTargetX + currentRingRadius * Math.cos(angle);
        ty = projectedTargetY + currentRingRadius * Math.sin(angle);
        tz = mz * o.depthFactor + Math.sin(t) * (1 * o.waveAmplitude * o.depthFactor);
      }

      p.cx += (tx - p.cx) * o.lerpSpeed;
      p.cy += (ty - p.cy) * o.lerpSpeed;
      p.cz += (tz - p.cz) * o.lerpSpeed;

      dummy.position.set(p.cx, p.cy, p.cz);
      dummy.lookAt(projectedTargetX, projectedTargetY, p.cz);
      dummy.rotateX(Math.PI / 2);

      const distToMouse = Math.hypot(p.cx - projectedTargetX, p.cy - projectedTargetY);
      const distFromRing = Math.abs(distToMouse - o.ringRadius);
      let scaleFactor = 1 - distFromRing / 10;
      scaleFactor = Math.max(0, Math.min(1, scaleFactor));

      const finalScale =
        scaleFactor * (0.8 + Math.sin(t * o.pulseSpeed) * 0.2 * o.particleVariance) * o.particleSize;
      dummy.scale.set(finalScale, finalScale, finalScale);
      dummy.updateMatrix();

      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  }

  seed();

  return { frame, resize, pointer, scene, camera, mesh, options: o };
}

/* Mounts a full-viewport particle field. The renderer is capped at ~30fps
   because this is a backdrop: it never needs to keep up with the display, and
   halving the draws keeps the page's own interactions smooth. */
export function mount(container, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
  } catch (e) {
    return null;
  }
  if (!renderer || !renderer.getContext()) return null;

  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  container.appendChild(canvas);

  const field = createField(renderer, o);
  field.resize(container.clientWidth, container.clientHeight);

  // Pointer -> normalised device coords, exactly what r3f exposes as `pointer`.
  function onPointerMove(e) {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    field.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    field.pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }

  let raf = 0;
  let running = false;
  let lastDraw = 0;
  const MIN_FRAME_MS = 1000 / 30;

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - lastDraw < MIN_FRAME_MS) return;
    lastDraw = now;
    field.frame(now);
  }

  function start() {
    if (running) return;
    running = true;
    lastDraw = 0;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const ro = 'ResizeObserver' in window
    ? new ResizeObserver(() => field.resize(container.clientWidth, container.clientHeight))
    : null;
  if (ro) ro.observe(container);

  document.addEventListener('pointermove', onPointerMove, { passive: true });

  // Pause when the tab is hidden or the page is scrolled out of view: a
  // backdrop has no business burning GPU behind another tab.
  function onVisibility() { document.hidden ? stop() : start(); }
  document.addEventListener('visibilitychange', onVisibility);

  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { en.isIntersecting && !document.hidden ? start() : stop(); });
    }, { threshold: 0 });
    io.observe(container);
  } else {
    start();
  }

  start();

  return {
    destroy() {
      stop();
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      field.mesh.geometry.dispose();
      field.mesh.material.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

export default { mount, createField };
