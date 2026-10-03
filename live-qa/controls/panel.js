/* ============================================================================
   Live Q&A — panel kontrol DI DALAM overlay.
   ----------------------------------------------------------------------------
   Panel ini SENGAJA hanya berisi mode Layout (geser / ukuran / skala /
   rotasi). Semua pengaturan lain (gift tiket, prefix, jumlah pertanyaan) ada
   di dashboard. Alasannya: panel menempel di overlay yang direkam, jadi
   semakin sedikit yang bisa salah klik saat live, semakin baik.

   Cara buka: tekan S di jendela overlay (saat Interact), atau klik gear kecil
   di sudut kiri-atas. Tombol Layout masuk/keluar mode Layout.

   Di mode Layout:
     - seret badan widget  -> geser posisi
     - seret 8 handle      -> ubah LEBAR / TINGGI widget
     - seret knob atas     -> rotasi
     - slider Scale        -> perbesar/perkecil keseluruhan (khusus Live Q&A)

   Hasil geser/ukuran/skala/rotasi disimpan lewat window.GesekiQaLayout
   (script.js), jadi tidak hilang saat overlay dimuat ulang.
   ========================================================================== */

(function () {
	'use strict';

	var qaPanel = document.getElementById('qaPanel');
	if (!qaPanel) return;

	var LAYOUT_MIN_SCALE = 0.5;
	var LAYOUT_MAX_SCALE = 2.0;
	var LAYOUT_SNAP = 8;
	// Ukuran minimum supaya widget tidak bisa diciutkan sampai tak terlihat.
	var LAYOUT_MIN_W = 120;
	var LAYOUT_MIN_H = 60;

	/* Nilai awal diambil dari widget (window.GesekiQaLayout), yang menyimpannya
	   di localStorage. Tanpa itu geser/ukuran/skala/rotasi hilang setiap overlay
	   dimuat ulang. width/height = 0 berarti "ikuti CSS" (auto). */
	var LAYOUT = window.GesekiQaLayout || null;
	var layoutState = LAYOUT ? LAYOUT.get() : { x: 0, y: 0, scale: 1, rotation: 0, width: 0, height: 0 };

	var panelOpen = false;
	var layoutOn = false;

	var root = null, btnCollapse = null, btnClose = null, statusEl = null, scaleRange = null, scaleOut = null;
	var giOverlay = null, giFrame = null, giGuideV = null, giGuideH = null, giRotate = null;
	var layoutRaf = 0;
	var frameDrag = null, handleDrag = null, rotateDrag = null;

	function h(tag, cls, text) {
		var el = document.createElement(tag);
		if (cls) el.className = cls;
		if (text !== undefined) el.textContent = text;
		return el;
	}

	function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
	function dist(a, b) {
		var dx = a.x - b.x, dy = a.y - b.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	// ── Terapkan offset / ukuran / skala / rotasi ke panel ──────────────────

	function ApplyOffset(x, y) {
		layoutState.x = Math.round(x);
		layoutState.y = Math.round(y);
		qaPanel.style.marginLeft = layoutState.x + 'px';
		qaPanel.style.marginBottom = layoutState.y + 'px';
	}

	/* Ukuran eksplisit dari handle resize. 0 = kembali ke lebar/tinggi CSS.
	   max-width CSS (calc(100vw - 80px)) dibatalkan saat di-resize supaya
	   lebar pilihan pengguna benar-benar dipakai. */
	function ApplySize(w, h) {
		layoutState.width = Math.max(0, Math.round(w));
		layoutState.height = Math.max(0, Math.round(h));
		if (layoutState.width > 0) {
			qaPanel.style.width = layoutState.width + 'px';
			qaPanel.style.maxWidth = 'none';
		} else {
			qaPanel.style.removeProperty('width');
			qaPanel.style.removeProperty('max-width');
		}
		if (layoutState.height > 0) qaPanel.style.height = layoutState.height + 'px';
		else qaPanel.style.removeProperty('height');
	}

	function ApplyScale(sc) {
		var s = clamp(Math.round(sc / 0.05) * 0.05, LAYOUT_MIN_SCALE, LAYOUT_MAX_SCALE);
		layoutState.scale = Math.round(s * 100) / 100;
		qaPanel.style.transform = 'scale(' + layoutState.scale + ') rotate(' + (layoutState.rotation || 0) + 'deg)';
		if (scaleRange) scaleRange.value = String(Math.round(layoutState.scale * 100));
		if (scaleOut) scaleOut.textContent = Math.round(layoutState.scale * 100) + '%';
		return layoutState.scale;
	}

	function ApplyRotation(deg) {
		var d = Number(deg);
		if (!isFinite(d)) d = 0;
		d = d % 360;
		if (d > 180) d -= 360;
		if (d <= -180) d += 360;
		d = Math.round(d);
		if (d === -180) d = 180;
		layoutState.rotation = d;
		qaPanel.style.transform = 'scale(' + (layoutState.scale || 1) + ') rotate(' + d + 'deg)';
		return d;
	}

	// transform-origin panel = "bottom left", jadi pivot-nya sudut kiri-bawah.
	function Pivot() {
		var r = qaPanel.getBoundingClientRect();
		return { x: r.left, y: r.bottom };
	}

	function ShowGuides(gx, gy) {
		if (!giGuideV || !giGuideH) return;
		if (gx === null) giGuideV.classList.remove('is-on');
		else { giGuideV.style.left = gx + 'px'; giGuideV.classList.add('is-on'); }
		if (gy === null) giGuideH.classList.remove('is-on');
		else { giGuideH.style.top = gy + 'px'; giGuideH.classList.add('is-on'); }
	}

	function Tick() {
		layoutRaf = 0;
		if (!layoutOn || !giFrame) return;
		var r = qaPanel.getBoundingClientRect();
		giFrame.style.left = r.left + 'px';
		giFrame.style.top = r.top + 'px';
		giFrame.style.width = r.width + 'px';
		giFrame.style.height = r.height + 'px';
		layoutRaf = requestAnimationFrame(Tick);
	}

	function Lighten(on) {
		if (on) {
			qaPanel.style.transition = 'none';
			qaPanel.style.backdropFilter = 'blur(8px)';
			qaPanel.style.webkitBackdropFilter = 'blur(8px)';
		} else {
			qaPanel.style.removeProperty('transition');
			qaPanel.style.removeProperty('backdrop-filter');
			qaPanel.style.removeProperty('-webkit-backdrop-filter');
		}
	}

	/* Simpan hasil layout. Dipanggil saat drag selesai (bukan tiap pointermove,
	   supaya localStorage tidak ditulis puluhan kali per detik). */
	function PersistLayout() {
		if (!LAYOUT) return;
		try { LAYOUT.set(layoutState); } catch (e) { /* abaikan */ }
	}

	// ── Drag / resize / rotate ───────────────────────────────────────────────

	/* Delta pointer diubah ke koordinat LOKAL panel (batalkan rotasi & skala)
	   supaya handle mengikuti arah kursor walau widget sudah diputar/diperbesar. */
	function LocalDelta(dx, dy) {
		var rad = -(layoutState.rotation || 0) * Math.PI / 180;
		var sc = layoutState.scale || 1;
		return {
			x: (dx * Math.cos(rad) - dy * Math.sin(rad)) / sc,
			y: (dx * Math.sin(rad) + dy * Math.cos(rad)) / sc
		};
	}

	function ResizeMove(e) {
		var d = handleDrag;
		if (!d) return;
		var ld = LocalDelta(e.clientX - d.px, e.clientY - d.py);
		var w = d.startW, hgt = d.startH;
		var ox = d.startX, oy = d.startY;

		// Sisi kanan: lebar tumbuh, jangkar kiri tetap.
		if (d.handle.indexOf('e') !== -1) w = d.startW + ld.x;
		// Sisi kiri: lebar tumbuh ke kiri -> panel ikut bergeser kiri.
		if (d.handle.indexOf('w') !== -1) { w = d.startW - ld.x; ox = d.startX + ld.x; }
		// Sisi bawah: tinggi tumbuh ke bawah -> margin bawah berkurang.
		if (d.handle.indexOf('s') !== -1) { hgt = d.startH + ld.y; oy = d.startY - ld.y; }
		// Sisi atas: tinggi tumbuh ke atas, jangkar bawah tetap.
		if (d.handle.indexOf('n') !== -1) hgt = d.startH - ld.y;

		ApplyOffset(ox, oy);
		ApplySize(Math.max(LAYOUT_MIN_W, w), Math.max(LAYOUT_MIN_H, hgt));
	}

	function RotateMove(e) {
		var d = rotateDrag;
		if (!d) return;
		var ang = Math.atan2(e.clientY - d.pivot.y, e.clientX - d.pivot.x) * 180 / Math.PI;
		ApplyRotation(d.startRotation + (ang - d.startAngle));
	}

	function EndDrag() {
		if (!frameDrag && !handleDrag && !rotateDrag) return;
		frameDrag = null; handleDrag = null; rotateDrag = null;
		if (giFrame) {
			giFrame.classList.remove('is-dragging');
			giFrame.classList.remove('is-rotating');
		}
		ShowGuides(null, null);
		Lighten(false);
		PersistLayout();
	}

	function DocMove(e) {
		if (rotateDrag) { RotateMove(e); return; }
		if (handleDrag) { ResizeMove(e); return; }
		if (!frameDrag) return;
		var d = frameDrag;
		var dx = e.clientX - d.px, dy = e.clientY - d.py;
		var vw = window.innerWidth, vh = window.innerHeight;
		var cx = d.rect.left + dx + d.rect.width / 2;
		var cy = d.rect.top + dy + d.rect.height / 2;
		var nx = d.ox + dx, ny = d.oy - dy; // Y dibalik: jangkar bawah.
		var gx = null, gy = null;
		if (Math.abs(cx - vw / 2) <= LAYOUT_SNAP) { nx += (vw / 2 - cx); gx = vw / 2; }
		if (Math.abs(cy - vh / 2) <= LAYOUT_SNAP) { ny += (cy - vh / 2); gy = vh / 2; }
		ApplyOffset(clamp(nx, -vw, vw), clamp(ny, -vh, vh));
		ShowGuides(gx, gy);
	}

	function ResetLayout() {
		ApplyOffset(0, 0);
		ApplySize(0, 0);
		ApplyScale(1);
		ApplyRotation(0);
		PersistLayout();
		SetStatus('Layout direset.');
	}

	function Bind() {
		giFrame.addEventListener('pointerdown', function (e) {
			if (e.button !== 0) return;
			if (e.target !== giFrame) return;
			frameDrag = {
				px: e.clientX, py: e.clientY,
				ox: layoutState.x, oy: layoutState.y,
				rect: qaPanel.getBoundingClientRect()
			};
			giFrame.classList.add('is-dragging');
			Lighten(true);
			e.preventDefault();
		});

		giFrame.addEventListener('dblclick', function (e) {
			if (e.target !== giFrame) return;
			ResetLayout();
		});

		Array.prototype.forEach.call(giFrame.querySelectorAll('.gi-handle'), function (hn) {
			hn.addEventListener('pointerdown', function (e) {
				if (e.button !== 0) return;
				// Ukuran dasar: pakai nilai eksplisit bila ada, kalau tidak ukuran
				// yang sedang dirender (offsetWidth/Height = px layout, tanpa skala).
				handleDrag = {
					handle: hn.dataset.h,
					px: e.clientX, py: e.clientY,
					startW: layoutState.width > 0 ? layoutState.width : qaPanel.offsetWidth,
					startH: layoutState.height > 0 ? layoutState.height : qaPanel.offsetHeight,
					startX: layoutState.x,
					startY: layoutState.y
				};
				Lighten(true);
				e.preventDefault();
				e.stopPropagation();
			});
		});

		giRotate.addEventListener('pointerdown', function (e) {
			if (e.button !== 0) return;
			var pivot = Pivot();
			var p = { x: e.clientX, y: e.clientY };
			rotateDrag = {
				pivot: pivot,
				startAngle: Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180 / Math.PI,
				startRotation: layoutState.rotation || 0
			};
			giFrame.classList.add('is-rotating');
			Lighten(true);
			e.preventDefault();
			e.stopPropagation();
		});

		document.addEventListener('pointermove', DocMove);
		document.addEventListener('pointerup', EndDrag);
		document.addEventListener('pointercancel', EndDrag);
	}

	function Build() {
		if (giOverlay) return;
		giOverlay = h('div', 'gi-overlay');
		giGuideV = h('div', 'gi-guide gi-guide-v');
		giGuideH = h('div', 'gi-guide gi-guide-h');
		giFrame = h('div', 'gi-frame');
		['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(function (pos) {
			var hd = h('div', 'gi-handle');
			hd.dataset.h = pos;
			giFrame.appendChild(hd);
		});
		giRotate = h('div', 'gi-rotate');
		giRotate.title = 'Drag to rotate';
		giFrame.appendChild(giRotate);
		giOverlay.appendChild(giGuideV);
		giOverlay.appendChild(giGuideH);
		giOverlay.appendChild(giFrame);
		giOverlay.appendChild(h('div', 'gi-hint', 'Layout — seret untuk pindah · handle sudut/sisi untuk ukuran · titik atas untuk rotasi'));
		document.body.appendChild(giOverlay);

		// Terapkan layout tersimpan (widget sudah menerapkannya; panel menulis
		// style-nya sendiri saat drag, jadi state-nya disamakan dulu).
		ApplyOffset(layoutState.x, layoutState.y);
		ApplySize(layoutState.width, layoutState.height);
		ApplyScale(layoutState.scale);
		ApplyRotation(layoutState.rotation);

		Bind();
	}

	function SetLayoutMode(on) {
		layoutOn = !!on;
		if (layoutOn) {
			Build();
			giOverlay.classList.add('is-on');
			qaPanel.classList.add('is-layout');
			if (!layoutRaf) layoutRaf = requestAnimationFrame(Tick);
		} else {
			if (giOverlay) giOverlay.classList.remove('is-on');
			qaPanel.classList.remove('is-layout');
		}
		if (btnCollapse) btnCollapse.classList.toggle('is-active', layoutOn);
	}

	// ── Panel ────────────────────────────────────────────────────────────────

	function SetStatus(msg) {
		if (statusEl) statusEl.textContent = msg || '';
	}

	function BuildPanel() {
		root = h('div', 'cp-root');
		root.id = 'qaControls';

		var bar = h('div', 'cp-titlebar');
		var title = h('span', 'cp-title', 'Live Q&A — Layout');
		btnCollapse = h('button', 'cp-btn cp-collapse', 'Layout');
		btnCollapse.title = 'Masuk/keluar mode Layout';
		btnClose = h('button', 'cp-btn cp-close', '×');
		btnClose.title = 'Tutup panel';
		bar.appendChild(title);
		bar.appendChild(btnCollapse);
		bar.appendChild(btnClose);

		var body = h('div', 'cp-body');

		// Slider skala keseluruhan (khusus Live Q&A — DIA tidak punya ini).
		var scaleRow = h('div', 'cp-row');
		var scaleLabel = h('span', 'cp-label', 'Scale');
		scaleRange = document.createElement('input');
		scaleRange.type = 'range';
		scaleRange.className = 'cp-range';
		scaleRange.min = String(Math.round(LAYOUT_MIN_SCALE * 100));
		scaleRange.max = String(Math.round(LAYOUT_MAX_SCALE * 100));
		scaleRange.step = '5';
		scaleRange.value = String(Math.round((layoutState.scale || 1) * 100));
		scaleOut = h('span', 'cp-value', Math.round((layoutState.scale || 1) * 100) + '%');
		scaleRange.addEventListener('input', function () {
			ApplyScale(Number(scaleRange.value) / 100);
			PersistLayout();
		});
		scaleRow.appendChild(scaleLabel);
		scaleRow.appendChild(scaleRange);
		scaleRow.appendChild(scaleOut);

		var btnReset = h('button', 'cp-btn cp-reset', 'Reset layout');
		btnReset.title = 'Kembalikan posisi, ukuran, skala, dan rotasi ke bawaan';
		btnReset.addEventListener('click', ResetLayout);

		var note = h('p', 'cp-note', 'Seret widget untuk pindah, handle untuk ubah ukuran, titik atas untuk rotasi. Pengaturan lain ada di dashboard.');

		statusEl = h('div', 'cp-status');

		body.appendChild(scaleRow);
		body.appendChild(btnReset);
		body.appendChild(note);
		body.appendChild(statusEl);

		root.appendChild(bar);
		root.appendChild(body);
		document.body.appendChild(root);

		btnCollapse.addEventListener('click', function () { SetLayoutMode(!layoutOn); });
		btnClose.addEventListener('click', Close);

		// Seret panel lewat titlebar.
		bar.addEventListener('pointerdown', function (e) {
			if (e.target !== bar && e.target !== title) return;
			var r = root.getBoundingClientRect();
			var sx = e.clientX, sy = e.clientY;
			var ox = r.left, oy = r.top;
			function mv(ev) {
				root.style.left = (ox + ev.clientX - sx) + 'px';
				root.style.top = (oy + ev.clientY - sy) + 'px';
				root.style.right = 'auto';
				root.style.bottom = 'auto';
			}
			function up() {
				document.removeEventListener('pointermove', mv);
				document.removeEventListener('pointerup', up);
			}
			document.addEventListener('pointermove', mv);
			document.addEventListener('pointerup', up);
			e.preventDefault();
		});
	}

	function OpenPanel() {
		if (!root) BuildPanel();
		root.classList.add('is-open');
		panelOpen = true;
		SetStatus('');
	}

	// Menutup panel WAJIB mematikan mode Layout: kalau tidak, bingkai + 8
	// handle tetap tergambar di overlay dan ikut terekam.
	function Close() {
		if (root) root.classList.remove('is-open');
		panelOpen = false;
		SetLayoutMode(false);
	}

	function Toggle() {
		if (panelOpen) Close(); else OpenPanel();
	}

	// Gear kecil di sudut: hanya tampak saat mouse mendekat, tidak pernah
	// ikut terekam karena opacity 0 saat idle.
	function BuildGear() {
		var gear = h('button', 'cp-gear', '\u2699');
		gear.title = 'Kontrol (S)';
		gear.addEventListener('click', Toggle);
		document.body.appendChild(gear);
	}

	document.addEventListener('keydown', function (e) {
		if (e.key === 's' || e.key === 'S') {
			// Jangan bajak saat user sedang mengetik di input.
			var t = e.target;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
			Toggle();
		}
		if (e.key === 'Escape' && panelOpen) Close();
	});

	// API untuk dikendalikan dari console / dashboard.
	window.GesekiLayout = {
		enter: function () { SetLayoutMode(true); },
		exit: function () { SetLayoutMode(false); },
		toggle: function () { SetLayoutMode(!layoutOn); },
		isOn: function () { return layoutOn; }
	};
	window.GesekiQaPanel = { open: OpenPanel, close: Close, toggle: Toggle };

	BuildGear();

	// Dibuka otomatis hanya kalau URL meminta (?controls=1), sama seperti
	// dynamic-island-alert.
	if (new URLSearchParams(location.search).get('controls') === '1') OpenPanel();
})();
