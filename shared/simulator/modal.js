// Tombol + overlay "Simulator" untuk navbar dashboard widget.
//
// Disuntikkan ke tiap dashboard (dynamic-island-alert, live-qa, dst.) dengan
// satu baris <script src="../../shared/simulator/modal.js"></script>. Skrip
// ini GENERIK: ia membaca nama widget dari URL dashboard sendiri, lalu membuka
// halaman Simulator (shared/simulator/index.html) di dalam overlay modal,
// meneruskan kanal BroadcastChannel widget itu.
//
// Tombol ditempatkan tepat sebelum tombol Interact (ujung kanan navbar).
(function () {
	'use strict';

	const tabs = document.getElementById('tabs');
	if (!tabs) return;

	// Nama widget = segmen sebelum "dashboard" pada path dashboard ini.
	// .../<widget>/dashboard/index.html -> <widget>
	const segs = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
	let widget = '';
	const di = segs.lastIndexOf('dashboard');
	if (di > 0) widget = segs[di - 1];
	if (!widget) widget = 'widget';

	const channel = 'geseki:' + widget + ':channel';
	const simulatorURL = new URL('../../shared/simulator/index.html', location.href).href +
		'?channel=' + encodeURIComponent(channel) +
		'&widget=' + encodeURIComponent(widget);

	// ── Gaya (disuntik sekali) ────────────────────────────────────────────
	const style = document.createElement('style');
	style.textContent = [
		'#tabSimulator{margin-left:auto;}',
		'#tabs #tabInteract{margin-left:0;}',
		'#simOverlay{position:fixed;inset:0;z-index:9999;display:none;',
		'align-items:center;justify-content:center;background:rgba(8,7,10,0.66);}',
		'#simOverlay.is-open{display:flex;}',
		'#simBox{width:min(760px,92vw);height:min(620px,88vh);background:#17161a;',
		'border:1px solid rgba(255,255,255,0.12);border-radius:14px;overflow:hidden;',
		'box-shadow:0 24px 60px rgba(0,0,0,0.5);display:flex;}',
		'#simFrame{width:100%;height:100%;border:0;display:block;}'
	].join('');
	document.head.appendChild(style);

	// ── Overlay ───────────────────────────────────────────────────────────
	const overlay = document.createElement('div');
	overlay.id = 'simOverlay';
	const box = document.createElement('div');
	box.id = 'simBox';
	const frame = document.createElement('iframe');
	frame.id = 'simFrame';
	frame.setAttribute('allow', 'clipboard-write; clipboard-read');
	box.appendChild(frame);
	overlay.appendChild(box);
	document.body.appendChild(overlay);

	// Iframe dimuat saat pertama dibuka, lalu dibiarkan hidup (hemat waktu
	// buka berikutnya; isinya tidak bergantung pada state dashboard).
	let loaded = false;
	function Open() {
		if (!loaded) { frame.src = simulatorURL; loaded = true; }
		overlay.classList.add('is-open');
	}
	function Close() { overlay.classList.remove('is-open'); }

	// Klik di luar kotak = tutup.
	overlay.addEventListener('click', (e) => { if (e.target === overlay) Close(); });
	// Esc = tutup.
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && overlay.classList.contains('is-open')) Close();
	});
	// Permintaan tutup dari halaman Simulator (tombol X di dalam iframe).
	window.addEventListener('message', (e) => {
		if (e.data && e.data.type === 'geseki_simulator_close') Close();
	});

	// ── Tombol navbar ─────────────────────────────────────────────────────
	const btn = document.createElement('button');
	btn.id = 'tabSimulator';
	btn.type = 'button';
	btn.title = 'Open the Simulator to send test events to this widget';
	btn.innerHTML =
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
		'<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"></path></svg><span>Simulator</span>';
	btn.addEventListener('click', Open);

	const interact = document.getElementById('tabInteract');
	if (interact) tabs.insertBefore(btn, interact);
	else tabs.appendChild(btn);
})();
