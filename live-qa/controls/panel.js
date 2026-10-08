/* ============================================================================
   Live Q&A, mode Layout DI DALAM overlay.
   ----------------------------------------------------------------------------
   Tidak ada panel kotak lagi: klik gear kecil di sudut kiri-atas (atau tekan S)
   untuk masuk mode Layout, klik sekali lagi untuk keluar. Semua pengaturan lain
   (gift tiket, prefix, jumlah pertanyaan) ada di dashboard.

   Di mode Layout:
     - seret badan widget    -> geser posisi
     - seret sisi (n/s/e/w)  -> ubah LEBAR / TINGGI widget
     - seret sudut (4 pojok) -> skala widget (perbesar/perkecil keseluruhan)
     - seret knob atas       -> rotasi
     - ikon reset mengambang -> kembalikan semua ke bawaan

   Hasil geser/ukuran/skala/rotasi disimpan lewat window.GesekiQaLayout
   (script.js), jadi tidak hilang saat overlay dimuat ulang.
   ========================================================================== */

(function () {
	'use strict';

	var qaPanel = document.getElementById('qaPanel');
	if (!qaPanel) return;

	var LAYOUT_MIN_SCALE = 0.5;
	var LAYOUT_MAX_SCALE = 2.0;
	// Skala bawaan (sama dengan script.js), sedikit di bawah 1.
	var LAYOUT_DEFAULT_SCALE = 0.8;
	var LAYOUT_SNAP = 8;
	// Ukuran minimum supaya widget tidak bisa diciutkan sampai tak terlihat.
	var LAYOUT_MIN_W = 120;
	var LAYOUT_MIN_H = 60;

	/* Nilai awal diambil dari widget (window.GesekiQaLayout), yang menyimpannya
	   di localStorage. Tanpa itu geser/ukuran/skala/rotasi hilang setiap overlay
	   dimuat ulang. width/height = 0 berarti "ikuti CSS" (auto). */
	var LAYOUT = window.GesekiQaLayout || null;
	var layoutState = LAYOUT ? LAYOUT.get() : { x: 0, y: 0, scale: LAYOUT_DEFAULT_SCALE, rotation: 0, width: 0, height: 0 };

	var layoutOn = false;

	var giOverlay = null, giFrame = null, giGuideV = null, giGuideH = null, giRotate = null, giReset = null;
	var gear = null;
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

	// Jangkar = TENGAH canvas (khusus Live Q&A). Offset disimpan sebagai margin
	// dari titik tengah, jadi (0,0) = widget pas di tengah.
	function ApplyOffset(x, y) {
		layoutState.x = Math.round(x);
		layoutState.y = Math.round(y);
		qaPanel.style.marginLeft = layoutState.x + 'px';
		qaPanel.style.marginTop = layoutState.y + 'px';
	}

	/* Ukuran eksplisit dari handle sisi. 0 = kembali ke lebar/tinggi CSS.
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

	// transform-origin panel = TENGAH (lihat style.css), jadi pivot-nya juga tengah.
	// transform-origin = TENGAH panel, jadi pivot skala/rotasi juga tengah.
	function Pivot() {
		var r = qaPanel.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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

	// ── Drag / resize / scale / rotate ──────────────────────────────────────

	/* Delta pointer diubah ke koordinat LOKAL panel (batalkan rotasi & skala
	   awal) supaya handle sisi mengikuti arah kursor walau widget sudah
	   diputar/diperbesar. */
	function LocalDelta(d, dx, dy) {
		var rad = -(d.startRot || 0) * Math.PI / 180;
		var sc = d.startScale || 1;
		return {
			x: (dx * Math.cos(rad) - dy * Math.sin(rad)) / sc,
			y: (dx * Math.sin(rad) + dy * Math.cos(rad)) / sc
		};
	}

	function HandleMove(e) {
		var d = handleDrag;
		if (!d) return;

		// Sudut (2 huruf: nw/ne/se/sw) -> skala: rasio jarak kursor dari pivot.
		if (d.mode === 'scale') {
			var ratio = dist({ x: e.clientX, y: e.clientY }, d.anchor) / d.startDist;
			if (!isFinite(ratio) || ratio <= 0) return;
			ApplyScale(d.startScale * ratio);
			return;
		}

		// Sisi (1 huruf) -> lebar / tinggi.
		var ld = LocalDelta(d, e.clientX - d.px, e.clientY - d.py);
		var w = d.startW, hgt = d.startH;
		var ox = d.startX, oy = d.startY;

		// Jangkar TENGAH: ukuran tumbuh/menyusut simetris dari titik tengah,
		// jadi offset tidak perlu ikut bergeser.
		if (d.handle.indexOf('e') !== -1) w = d.startW + ld.x;
		if (d.handle.indexOf('w') !== -1) w = d.startW - ld.x;
		if (d.handle.indexOf('s') !== -1) hgt = d.startH + ld.y;
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
		if (handleDrag) { HandleMove(e); return; }
		if (!frameDrag) return;
		var d = frameDrag;
		var dx = e.clientX - d.px, dy = e.clientY - d.py;
		var vw = window.innerWidth, vh = window.innerHeight;
		var cx = d.rect.left + dx + d.rect.width / 2;
		var cy = d.rect.top + dy + d.rect.height / 2;
		var nx = d.ox + dx, ny = d.oy + dy; // Jangkar tengah: Y tumbuh ke bawah.
		var gx = null, gy = null;
		if (Math.abs(cx - vw / 2) <= LAYOUT_SNAP) { nx += (vw / 2 - cx); gx = vw / 2; }
		if (Math.abs(cy - vh / 2) <= LAYOUT_SNAP) { ny += (cy - vh / 2); gy = vh / 2; }
		ApplyOffset(clamp(nx, -vw, vw), clamp(ny, -vh, vh));
		ShowGuides(gx, gy);
	}

	function ResetLayout() {
		ApplyOffset(0, 0);
		ApplySize(0, 0);
		ApplyScale(LAYOUT_DEFAULT_SCALE);
		ApplyRotation(0);
		PersistLayout();
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

		Array.prototype.forEach.call(giFrame.querySelectorAll('.gi-handle'), function (hn) {
			hn.addEventListener('pointerdown', function (e) {
				if (e.button !== 0) return;
				var pos = hn.dataset.h;
				var anchor = Pivot();
				var p = { x: e.clientX, y: e.clientY };
				handleDrag = {
					handle: pos,
					// Sudut (2 huruf) -> skala; sisi (1 huruf) -> ukuran.
					mode: pos.length === 2 ? 'scale' : 'resize',
					anchor: anchor,
					px: e.clientX, py: e.clientY,
					startScale: layoutState.scale,
					startRot: layoutState.rotation || 0,
					startDist: Math.max(1, dist(p, anchor)),
					// Ukuran dasar: pakai nilai eksplisit bila ada, kalau tidak
					// ukuran yang sedang dirender (offsetWidth/Height = px layout).
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

		// Ikon reset mengambang (gaya sama seperti knob rotasi).
		giReset = h('button', 'gi-reset');
		giReset.type = 'button';
		giReset.title = 'Reset layout';
		giReset.innerHTML =
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
			'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
			'<polyline points="1 4 1 10 7 10"></polyline>' +
			'<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
		giReset.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
		giReset.addEventListener('click', function (e) { e.stopPropagation(); ResetLayout(); });
		giFrame.appendChild(giReset);

		giOverlay.appendChild(giGuideV);
		giOverlay.appendChild(giGuideH);
		giOverlay.appendChild(giFrame);
		giOverlay.appendChild(h('div', 'gi-hint', 'Layout mode, drag to move · sides to resize · corners to scale · top dot to rotate'));
		document.body.appendChild(giOverlay);

		// Terapkan layout tersimpan (widget sudah menerapkannya; mode Layout
		// menulis style-nya sendiri saat drag, jadi state-nya disamakan dulu).
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
			ArmIdleExit();
		} else {
			if (giOverlay) giOverlay.classList.remove('is-on');
			qaPanel.classList.remove('is-layout');
			if (layoutIdleTimer) { clearTimeout(layoutIdleTimer); layoutIdleTimer = null; }
		}
		if (gear) {
			gear.classList.toggle('is-active', layoutOn);
			if (layoutOn) gear.classList.remove('is-available');
		}
	}

	function Toggle() { SetLayoutMode(!layoutOn); }

	/* Keluar mode Layout otomatis saat jendela Interact OBS ditutup.
	   OBS meneruskan fokus jendela Interact ke halaman ini lewat
	   obs_source_send_focus -> CEF SetFocus, yang memicu event DOM
	   `blur`/`focus`. Jadi `blur` adalah sinyal DETERMINISTIK (bukan
	   timer): begitu Interact kehilangan fokus atau ditutup, mode Layout
	   langsung ditutup supaya guide-nya tidak ikut terekam di stream.
	   Timer idle cuma jaring pengaman kalau `blur` tidak datang (mis.
	   build OBS lain): tanpa input sama sekali selama LAYOUT_IDLE_EXIT_MS
	   -> keluar juga. Tiap gerak mouse/ketikan mengulang timer itu. */
	var LAYOUT_IDLE_EXIT_MS = 30000;
	var layoutIdleTimer = null;

	function ArmIdleExit() {
		if (layoutIdleTimer) clearTimeout(layoutIdleTimer);
		layoutIdleTimer = setTimeout(function () {
			if (layoutOn) ExitLayoutAuto();
		}, LAYOUT_IDLE_EXIT_MS);
	}

	/* Keluar mode Layout tanpa aksi pengguna. Simpan dulu bila sedang
	   drag supaya posisi terakhir tidak hilang saat jendela ditutup. */
	function ExitLayoutAuto() {
		if (!layoutOn) return;
		EndDrag();
		SetLayoutMode(false);
	}

	function OnLayoutActivity() {
		if (layoutOn) ArmIdleExit();
	}

	/* Fokus halaman. OBS mengirim blur lewat CEF SetFocus(false) saat
	   jendela Interact kehilangan fokus/ditutup. `hadFocus` mencegah
	   polling keluar sendiri di konteks yang memang tidak pernah fokus
	   (mis. source latar): poll hanya berlaku setelah halaman ini benar-
	   benar pernah fokus, jadi tidak ada false positive. */
	var hadFocus = false;
	var layoutFocusPoll = null;

	// Interact OBS kehilangan fokus / ditutup -> keluar mode Layout.
	window.addEventListener('blur', ExitLayoutAuto);
	window.addEventListener('focus', function () { hadFocus = true; });

	/* Lapis kedua: kalau event `blur` tertelan (mis. build OBS yang tidak
	   meneruskan fokus), poll `document.hasFocus()` menutup mode Layout
	   saat jendela Interact sudah tidak fokus lagi. Hanya aktif kalau
	   halaman ini PERNAH fokus, supaya tidak salah keluar. */
	layoutFocusPoll = setInterval(function () {
		if (!layoutOn) { hadFocus = false; return; }
		if (hadFocus && !document.hasFocus()) ExitLayoutAuto();
	}, 1000);

	// Aktivitas apa pun menunda jaring pengaman idle.
	['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(function (ev) {
		document.addEventListener(ev, OnLayoutActivity, { passive: true });
	});

	// Gear kecil di sudut: hanya tampak saat mouse mendekat, tidak pernah
	// ikut terekam karena opacity 0 saat idle. Klik = masuk mode Layout;
	// klik sekali lagi = keluar.
	function BuildGear() {
		gear = h('button', 'cp-gear', '\u2699');
		gear.type = 'button';
		gear.title = 'Layout (S)';
		gear.addEventListener('click', Toggle);
		document.body.appendChild(gear);

		/* Muncul saat pointer bergerak, sembunyi setelah idle. Tidak pernah
		   disembunyikan selagi kursor masih DI ATAS gear (kalau tidak, hover-
		   state-nya kedip: hilang -> pointer tak lagi di atas -> muncul lagi). */
		var gearTimer = null;
		function HideGearSoon(ms) {
			if (gearTimer) clearTimeout(gearTimer);
			gearTimer = setTimeout(function () {
				if (!layoutOn && !gear.matches(':hover')) gear.classList.remove('is-available');
			}, ms);
		}
		document.addEventListener('pointermove', function () {
			if (layoutOn) return;
			gear.classList.add('is-available');
			HideGearSoon(2500);
		});
		gear.addEventListener('mouseleave', function () {
			if (!layoutOn) HideGearSoon(1200);
		});
	}

	document.addEventListener('keydown', function (e) {
		if (e.key === 's' || e.key === 'S') {
			// Jangan bajak saat user sedang mengetik di input.
			var t = e.target;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
			Toggle();
		}
		if (e.key === 'Escape' && layoutOn) SetLayoutMode(false);
	});

	// API untuk dikendalikan dari console / dashboard.
	window.GesekiLayout = {
		enter: function () { SetLayoutMode(true); },
		exit: function () { SetLayoutMode(false); },
		toggle: Toggle,
		isOn: function () { return layoutOn; }
	};

	BuildGear();

	// Dibuka otomatis hanya kalau URL meminta (?controls=1).
	if (new URLSearchParams(location.search).get('controls') === '1') SetLayoutMode(true);
})();
