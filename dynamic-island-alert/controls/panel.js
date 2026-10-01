/* ============================================================================
   CONTROLS PANEL - panel pengaturan di dalam overlay
   ----------------------------------------------------------------------------
   Dibuka dengan menekan S di dalam overlay, atau ?controls=1 pada URL.
   Dipakai lewat OBS: pilih browser source -> Interact -> tekan S, atau klik
   tombol gear yang muncul di pojok kiri atas saat pointer bergerak.

   Susunan menu mengikuti pola panel overlay yang sudah lazim (tab di atas,
   isi di bawah, opsi di cog):

     [ Alerts ] [ General ] [ Connections ] [ Options ]

   - Alerts      : satu kartu per jenis alert, bisa dinyalakan/dimatikan,
                   disimulasikan, dan pesannya diubah. Kartu Now Playing ikut di
                   sini. Semua kartu tertutup.
   - General     : tampilan & perilaku yang berlaku untuk semua alert.
   - Connections : Streamer.bot, OBS, TikTok, Live Detection.
                   Semua grup tertutup kecuali OBS Connection.
   - Options     : bukan tampilan - pause, antrean, export/import/reset.

   Catatan penting soal OBS (CEF):
   - <select> bawaan tidak bisa dibuka di OBS karena popup-nya dirender oleh
     sistem operasi, bukan oleh halaman. Karena itu semua pilihan memakai
     dropdown buatan sendiri (MakeSelect).
   - window.prompt() dan window.confirm() juga tidak dirender di OBS. Semua
     konfirmasi memakai dialog buatan sendiri (ShowDialog).

   Semua nilai disimpan sebagai profil di localStorage lewat window.GesekiConfig,
   jadi browser source tidak perlu URL panjang - cukup sekali pasang.

   Skema form diambil dari window.GESEKI_CONTROLS_SCHEMA (salinan settings.json
   yang dibangkitkan oleh shared/tools/build-controls-schema.mjs).
   ========================================================================== */
(function () {
	'use strict';

	var CFG = window.GesekiConfig;
	var SCHEMA = window.GESEKI_CONTROLS_SCHEMA;
	if (!CFG || !SCHEMA) {
		console.warn('[Geseki][Controls] GesekiConfig / GESEKI_CONTROLS_SCHEMA missing, panel aborted.');
		return;
	}

	// Kontrol yang disembunyikan KHUSUS di Controls Panel; dashboard tetap
	// memilikinya. Nilainya tetap dipertahankan saat Save.
	//  - testAlertType : hanya memicu simulasi, tidak mengubah widget.
	//  - obsAddress/obsPort/obsPassword : diatur dari modal "Connect OBS" di
	//    navbar (tersimpan sebagai preferensi), bukan dari tab Connections.
	var PANEL_HIDDEN = ['testAlertType', 'obsAddress', 'obsPort', 'obsPassword'];
	// Kontrol yang TIDAK dirender di panel karena nilainya dikelola mode Layout
	// (handle resize), bukan oleh form. Slider-nya tetap ada di dashboard.
	// Sengaja dipisah dari PANEL_HIDDEN: PANEL_HIDDEN menyalin nilai LAMA saat
	// Save, jadi kalau widgetScale ada di sana hasil resize tidak akan tersimpan.
	var PANEL_LAYOUT_OWNED = ['widgetScale', 'widgetRotation'];
	var allSettings = SCHEMA.settings || [];
	var settings = allSettings.filter(function (s) {
		return PANEL_HIDDEN.indexOf(s.id) === -1 && PANEL_LAYOUT_OWNED.indexOf(s.id) === -1;
	});
	var defaults = SCHEMA.defaults || {};

	/* =========================================================== susunan menu */

	// Grup yang tidak mengatur tampilan, hanya koneksi.
	var CONNECTION_GROUPS = ['Streamer.bot Connection', 'TikTok Connection', 'Live Detection'];

// Now Playing dipindah dari tab Connections ke tab Alerts sebagai satu kartu.
var NOW_PLAYING_GROUP = 'Now Playing';

	// Grup koneksi yang terbuka sejak awal. Sisanya tertutup.
	var CONNECTION_DEFAULT_OPEN = 'Streamer.bot Connection';

	// Satu kartu "Alerts" = satu jenis alert. Urutan mengikuti alur siaran.
	var ALERT_TABS = [
		{ id: 'Follow Alert',        label: 'Follow',        event: 'follow',    enable: 'enableFollow',        icon: 'enableFollowIcon' },
		{ id: 'Subscribe Alert',     label: 'Subscribe',     event: 'subscribe', enable: 'enableSubscribe',     icon: 'enableSubscribeIcon' },
		{ id: 'Super Fan Alert',     label: 'Super Fan',     event: 'superFan',  enable: 'enableSuperFan',      icon: 'enableSuperFanIcon' },
		{ id: 'Share Alert',         label: 'Share',         event: 'share',     enable: 'enableShare',         icon: 'enableShareIcon' },
		{ id: 'Gift Alert',          label: 'Gift',          event: 'gift',      enable: 'enableGift',          icon: 'enableGiftIcon' },
		{ id: 'First Chatter',       label: 'First Chatter', event: 'chat',      enable: 'enableFirstChatter',  icon: 'enableFirstChatterIcon' }
	];

	// Kartu Now Playing tampil di tab Alerts tapi bukan event alert: isinya
	// diambil dari grup "Now Playing" dan tidak punya switch on/off terpisah.
	var NOW_PLAYING_CARD = {
		id: NOW_PLAYING_GROUP,
		label: 'Now Playing',
		enable: 'enableNowPlaying',
		nowPlaying: true
	};

	var TABS = [
		{ id: 'alerts',      label: 'Alerts' },
		{ id: 'general',     label: 'General' },
		{ id: 'connections', label: 'Connections' }
	];

	var activeTab = CFG.read('panelTab') || 'alerts';

	/* ------------------------------------------------------------------ nilai */

	// Nilai efektif yang SAMA dengan yang dipakai widget: profil tersimpan dulu,
	// baru query string, baru bawaan. Browser source buatan dashboard menyimpan
	// pengaturannya di URL, jadi URL harus ikut dibaca di sini - kalau tidak panel
	// menampilkan nilai bawaan padahal widget memakai nilai dari URL.
	function CurrentMap() {
		var saved = CFG.current();
		var map = {};
		settings.forEach(function (s) {
			var v;
			if (Object.prototype.hasOwnProperty.call(saved, s.id)) v = saved[s.id];
			else if (CFG.urlSearch && CFG.urlSearch.has(s.id)) v = CFG.urlSearch.get(s.id);
			else v = defaults[s.id];
			// Query string selalu string; samakan bentuknya dengan tipe kontrol.
			if (s.type === 'checkbox' && typeof v === 'string') {
				v = (v === 'true' || v === '1' || v === 'on');
			} else if ((s.type === 'number' || s.type === 'slider') && typeof v === 'string' && v !== '') {
				var n = Number(v);
				if (!isNaN(n)) v = n;
			}
			map[s.id] = v;
		});
		return map;
	}

	var values = CurrentMap();

	// Posisi widget dari mode Layout (offset margin, px). Bukan setting skema,
	// tapi ikut disimpan ke profil lewat ReadForm() dan dibaca widget saat load.
	var layoutState = {
		x: Number(CFG.read('widgetOffsetX')) || 0,
		y: Number(CFG.read('widgetOffsetY')) || 0,
		// Skala juga milik mode Layout: slider Widget Scale tidak ada di panel.
		scale: Number(CFG.read('widgetScale')) || 1,
		// Rotasi (derajat) juga milik mode Layout.
		rotation: Number(CFG.read('widgetRotation')) || 0
	};

	/* ------------------------------------------------- keadaan buka / tutup */

	// Disimpan di preferensi panel supaya pilihan buka/tutup bertahan setelah
	// overlay dimuat ulang. Kartu alert bawaannya TERTUTUP; grup koneksi
	// bawaannya tertutup kecuali OBS Connection.
	function PrefMap(key) {
		var raw = CFG.read(key);
		if (!raw) return {};
		try { var o = JSON.parse(raw); return o && typeof o === 'object' ? o : {}; }
		catch (e) { return {}; }
	}
	function PersistMap(key, map) {
		try { CFG.setPref(key, JSON.stringify(map)); } catch (e) { /* abaikan */ }
	}

	var openCards = PrefMap('cpOpenCards');
	var openGroups = PrefMap('cpOpenGroups');

	function CardOpen(id) {
		return !!openCards[id];
	}
	function SetCardOpen(id, on) {
		if (on) openCards[id] = 1; else delete openCards[id];
		PersistMap('cpOpenCards', openCards);
	}
	function GroupOpen(name, dflt) {
		if (Object.prototype.hasOwnProperty.call(openGroups, name)) return !!openGroups[name];
		return !!dflt;
	}
	function SetGroupOpen(name, on) {
		if (on) openGroups[name] = 1; else openGroups[name] = 0;
		PersistMap('cpOpenGroups', openGroups);
	}

	/* ------------------------------------------------------------------- DOM */

	var el = {};
	var wrapEl = {};

	function h(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	}

	// Tooltip kustom. Atribut title bawaan browser berkedip di OBS CEF, jadi
	// teksnya disimpan di data-tip dan digambar oleh satu kotak global
	// (.cp-tipbox) yang diposisikan di sini. Kotak itu milik <body>, jadi tidak
	// pernah terpotong overflow panel. Muncul hanya setelah pointer berhenti
	// sejenak (350 ms) supaya tidak berkedip saat pointer melintas.
	var tipBox = null;
	var tipTimer = null;
	var tipTarget = null;

	function TipBox() {
		if (!tipBox) {
			tipBox = document.createElement('div');
			tipBox.className = 'cp-tipbox';
			document.body.appendChild(tipBox);
		}
		return tipBox;
	}

	function HideTip() {
		if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
		tipTarget = null;
		if (tipBox) tipBox.classList.remove('is-on');
	}

	function ShowTip(el) {
		var text = el.getAttribute('data-tip');
		if (!text) return;
		var box = TipBox();
		box.textContent = text;
		// Ukur dulu, baru tempatkan, supaya tidak pernah keluar layar.
		box.style.left = '0px';
		box.style.top = '0px';
		var r = el.getBoundingClientRect();
		var b = box.getBoundingClientRect();
		var x = r.left + (r.width - b.width) / 2;
		var y = r.bottom + 8;
		if (y + b.height > window.innerHeight - 4) y = r.top - b.height - 8;
		x = Math.max(4, Math.min(x, window.innerWidth - b.width - 4));
		y = Math.max(4, y);
		box.style.left = Math.round(x) + 'px';
		box.style.top = Math.round(y) + 'px';
		box.classList.add('is-on');
	}

	function Tip(el, text) {
		el.setAttribute('data-tip', text);
		el.setAttribute('aria-label', text);
		el.addEventListener('mouseenter', function () {
			if (tipTarget === el) return;
			if (tipTimer) clearTimeout(tipTimer);
			tipTarget = el;
			tipTimer = setTimeout(function () { if (tipTarget === el) ShowTip(el); }, 350);
		});
		el.addEventListener('mouseleave', HideTip);
		el.addEventListener('pointerdown', HideTip);
		return el;
	}

	function Icon(name) {
		var NS = 'http://www.w3.org/2000/svg';
		var s = document.createElementNS(NS, 'svg');
		s.setAttribute('viewBox', '0 0 24 24');
		s.setAttribute('width', '16');
		s.setAttribute('height', '16');
		s.setAttribute('fill', 'none');
		s.setAttribute('stroke', 'currentColor');
		s.setAttribute('stroke-width', '2');
		s.setAttribute('stroke-linecap', 'round');
		s.setAttribute('stroke-linejoin', 'round');
		s.setAttribute('aria-hidden', 'true');
		var paths = {
			collapse: '<path d="M5 12h14"/>',
			restore:  '<rect x="4.5" y="7" width="15" height="10" rx="2.5"/>',
			close:    '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
			plus:     '<path d="M12 5.5v13M5.5 12h13"/>',
			trash:    '<path d="M4.5 7h15M9.5 7V5.5h5V7M7 7l1 12h8l1-12"/>'
			,gear:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
			,save:    '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>'
			,reset:   '<path d="M4 9a8 8 0 1 1 2.3 5.7"/><path d="M4 4v5h5"/>'
		};
		s.innerHTML = paths[name] || '';
		return s;
	}

	function settingById(id) {
		for (var i = 0; i < settings.length; i++) if (settings[i].id === id) return settings[i];
		return null;
	}

	function labelFor(s) {
		// Teks label TIDAK boleh mengaktifkan kontrol. Baik <label for> maupun
		// <label> yang membungkus input memicu kontrol saat diklik; di overlay
		// OBS klik nyasar sering terjadi. Jadi pembungkusnya <div> dan teksnya
		// <span> biasa - hanya kontrolnya sendiri yang aktif.
		var row = h('div', 'cp-label');
		var lab = h('span', 'cp-label-text');
		lab.textContent = s.label || s.id;
		row.appendChild(lab);
		if (s.description) {
			var d = h('span', 'cp-desc');
			// Deskripsi memakai <br> dan <a> sederhana dari skema bawaan kita
			// sendiri, bukan input pengguna, jadi aman dirender sebagai HTML.
			d.innerHTML = s.description;
			row.appendChild(d);
		}
		return row;
	}

	/* ================================================== dropdown buatan sendiri */

	// <select> bawaan tidak bisa dibuka di OBS (CEF tidak merender popup OS).
	// Dropdown ini dibangun dari elemen biasa, dan daftarnya ditempel ke .cp-root
	// dengan position:fixed supaya tidak terpotong overflow panel.

	var activeSelectWrap = null;
	var activeSelectClose = null;

	function CloseActiveSelect() {
		if (activeSelectClose) {
			var f = activeSelectClose;
			activeSelectClose = null;
			activeSelectWrap = null;
			f();
		}
	}

	function MakeSelect(optList, value, onChange) {
		var opts = optList || [];
		var cur = value === undefined || value === null ? '' : String(value);

		var wrap = h('div', 'cp-select');
		var btn = h('button', 'cp-input cp-select-btn');
		btn.type = 'button';
		var lbl = h('span', 'cp-select-label');
		var caret = h('span', 'cp-select-caret');
		btn.appendChild(lbl);
		btn.appendChild(caret);
		wrap.appendChild(btn);

		var list = null;

		function labelOf(v) {
			for (var i = 0; i < opts.length; i++) {
				if (String(opts[i].value) === String(v)) return String(opts[i].label);
			}
			return opts.length ? String(opts[0].label) : '';
		}

		function SetVal(v, fire) {
			cur = v === undefined || v === null ? '' : String(v);
			lbl.textContent = labelOf(cur);
			if (list) {
				Array.prototype.forEach.call(list.children, function (b) {
					b.classList.toggle('is-on', b.dataset.value === cur);
				});
			}
			if (fire && onChange) onChange(cur);
		}

		function BuildList() {
			list = h('div', 'cp-select-list');
			list.setAttribute('role', 'listbox');
			opts.forEach(function (o) {
				var item = h('button', 'cp-select-opt', String(o.label));
				item.type = 'button';
				item.dataset.value = String(o.value);
				item.setAttribute('role', 'option');
				if (String(o.value) === cur) item.classList.add('is-on');
				item.addEventListener('click', function (e) {
					e.stopPropagation();
					SetVal(o.value, true);
					CloseList();
				});
				list.appendChild(item);
			});
		}

		function PlaceList(initial) {
			var r = btn.getBoundingClientRect();
			// Kalau tombolnya tidak terlihat (mis. berada di grup yang tertutup),
			// rect-nya nol dan daftar akan muncul di pojok kiri atas. Jangan
			// digambar sama sekali.
			if (!r.width && !r.height) return false;

			// Saat panel di-scroll sampai tombolnya keluar layar, anchor-nya
			// sudah tidak ada lagi, jadi daftar ditutup. Khusus pembukaan
			// pertama, tombol dibawa ke tampilan dulu supaya tetap bisa dipakai.
			if (!initial && (r.bottom < 0 || r.top > window.innerHeight)) return false;

			var winH = window.innerHeight;
			var h = Math.min(list.scrollHeight, 260);

			// Arah buka dikunci saat daftar pertama dibuka. Tanpa ini, arahnya
			// bisa berubah di tengah scroll sehingga daftar terlihat melompat.
			if (initial || !list.dataset.dir) {
				var below = winH - r.bottom - 8;
				var above = r.top - 8;
				list.dataset.dir = (below >= Math.min(h, 120) || below >= above) ? 'down' : 'up';
			}

			var up = list.dataset.dir === 'up';
			var avail = Math.max(80, up ? (r.top - 8) : (winH - r.bottom - 8));
			var hh = Math.min(h, avail);

			// Top selalu dijepit ke dalam jendela supaya daftar tidak pernah
			// keluar layar, termasuk saat panel di-scroll setelah dibuka.
			var top = up ? (r.top - hh - 4) : (r.bottom + 4);
			top = Math.max(4, Math.min(top, winH - hh - 4));

			list.style.minWidth = Math.round(r.width) + 'px';
			list.style.left = Math.round(r.left) + 'px';
			list.style.maxHeight = Math.round(hh) + 'px';
			list.style.top = Math.round(top) + 'px';
			return true;
		}

		function CloseList() {
			if (list && list.parentNode) list.parentNode.removeChild(list);
			if (list) delete list.dataset.dir;
			wrap.classList.remove('is-open');
			document.removeEventListener('scroll', OnScroll, true);
			window.removeEventListener('resize', OnScroll);
			if (activeSelectClose === CloseList) {
				activeSelectClose = null;
				activeSelectWrap = null;
			}
		}

		// Pembungkus eksplisit: kalau PlaceList dipasang langsung sebagai
		// listener, argumen event-nya masuk ke parameter `initial` dan dianggap
		// true, sehingga arah daftar dihitung ulang di setiap scroll.
		// Kalau tombolnya tergulir keluar layar, daftar benar-benar ditutup -
		// kalau tidak, ia tertinggal menggantung dan state `is-open` pada
		// pembungkus membuat dropdown tidak bisa dibuka lagi.
		function OnScroll() {
			if (!list) return;
			if (!PlaceList(false)) CloseList();
		}

		function OpenList() {
			CloseActiveSelect();
			if (!list) BuildList();
			root.appendChild(list);
			wrap.classList.add('is-open');
			// is-open HARUS dipasang lebih dulu: selama display:none, scrollHeight
			// bernilai 0 sehingga daftar diukur sebagai kosong dan posisinya salah.
			list.classList.add('is-open');
			if (!PlaceList(true)) { CloseList(); return; }
			// Daftar ditempel dengan position:fixed, jadi posisinya harus
			// diperbarui saat panel di-scroll atau jendela berubah ukuran.
			// Fase capture dipakai supaya scroll di dalam .cp-body ikut tertangkap.
			document.addEventListener('scroll', OnScroll, true);
			window.addEventListener('resize', OnScroll);
			activeSelectClose = CloseList;
			activeSelectWrap = wrap;
		}

		btn.addEventListener('click', function (e) {
			e.stopPropagation();
			// Patokannya keberadaan daftar di DOM, bukan flag class, supaya
			// dropdown tidak pernah macet dalam keadaan setengah terbuka.
			if (list && list.parentNode) CloseList();
			else OpenList();
		});

		lbl.textContent = labelOf(cur);
		wrap.setValue = SetVal;
		wrap.getValue = function () { return cur; };
		return wrap;
	}
	/* Dropdown multi-pilih: dipakai setting bertipe 'tags' (mis. Info Rotation
	   Display). Sama seperti dashboard (wa-select multiple) - daftar tidak
	   menutup saat satu opsi diklik, jadi beberapa bisa dicentang sekaligus. */
	function MakeMultiSelect(optList, selected, onChange) {
		var opts = optList || [];
		var sel = Array.isArray(selected) ? selected.map(String) : [];

		var wrap = h('div', 'cp-select cp-multi');
		var btn = h('button', 'cp-input cp-select-btn');
		btn.type = 'button';
		var lbl = h('span', 'cp-select-label');
		var caret = h('span', 'cp-select-caret');
		btn.appendChild(lbl);
		btn.appendChild(caret);
		wrap.appendChild(btn);

		var list = null;

		function labelOf(v) {
			for (var i = 0; i < opts.length; i++) {
				if (String(opts[i].value) === String(v)) return String(opts[i].label);
			}
			return String(v);
		}

		function Summary() {
			if (!sel.length) return 'None selected';
			return sel.map(labelOf).join(', ');
		}

		function Sync() {
			lbl.textContent = Summary();
			wrap.classList.toggle('is-empty', sel.length === 0);
			if (list) {
				var f = list.querySelector('.cp-multi-foot');
				if (f) f.style.display = sel.length ? '' : 'none';
			}
			if (list) {
				Array.prototype.forEach.call(list.querySelectorAll('.cp-select-opt'), function (b) {
					var on = sel.indexOf(b.dataset.value) !== -1;
					b.classList.toggle('is-on', on);
					var cb = b.querySelector('.cp-check');
					if (cb) cb.classList.toggle('is-on', on);
				});
			}
		}

		function BuildList() {
			list = h('div', 'cp-select-list cp-multi-list');
			list.setAttribute('role', 'listbox');
			list.setAttribute('aria-multiselectable', 'true');

			// Tombol Clear all - hanya berguna bila ada yang dipilih.
			var foot = h('div', 'cp-multi-foot');
			var clr = h('button', 'cp-multi-clear');
			clr.type = 'button';
			clr.appendChild(Icon('close'));
			clr.appendChild(h('span', null, 'Clear all'));
			clr.addEventListener('click', function (e) {
				e.stopPropagation();
				sel = [];
				Sync();
				if (onChange) onChange(sel.slice());
			});
			foot.appendChild(clr);

			opts.forEach(function (o) {
				var item = h('button', 'cp-select-opt');
				item.type = 'button';
				item.dataset.value = String(o.value);
				item.setAttribute('role', 'option');
				item.appendChild(h('span', 'cp-check'));
				item.appendChild(h('span', 'cp-select-opt-text', String(o.label)));
				// Multi-pilih: klik menambah/menghapus tanpa menutup daftar.
				item.addEventListener('click', function (e) {
					e.stopPropagation();
					var v = String(o.value);
					var at = sel.indexOf(v);
					if (at === -1) sel.push(v); else sel.splice(at, 1);
					Sync();
					if (onChange) onChange(sel.slice());
				});
				list.appendChild(item);
			});
			list.appendChild(foot);
			Sync();
		}

		function PlaceList(initial) {
			var r = btn.getBoundingClientRect();
			if (!r.width && !r.height) return false;
			if (!initial && (r.bottom < 0 || r.top > window.innerHeight)) return false;

			var winH = window.innerHeight;
			var h = Math.min(list.scrollHeight, 260);
			if (initial || !list.dataset.dir) {
				var below = winH - r.bottom - 8;
				var above = r.top - 8;
				list.dataset.dir = (below >= Math.min(h, 120) || below >= above) ? 'down' : 'up';
			}
			var up = list.dataset.dir === 'up';
			var avail = Math.max(80, up ? (r.top - 8) : (winH - r.bottom - 8));
			var hh = Math.min(h, avail);
			var top = up ? (r.top - hh - 4) : (r.bottom + 4);
			top = Math.max(4, Math.min(top, winH - hh - 4));

			// Daftar multi lebih lebar dari tombolnya supaya label panjang
			// (mis. "Time & Now Playing") tidak terpotong ellipsis.
			list.style.minWidth = Math.round(Math.max(r.width, 210)) + 'px';
			list.style.left = Math.round(r.left) + 'px';
			list.style.maxHeight = Math.round(hh) + 'px';
			list.style.top = Math.round(top) + 'px';
			return true;
		}

		function CloseList() {
			if (list && list.parentNode) list.parentNode.removeChild(list);
			if (list) delete list.dataset.dir;
			wrap.classList.remove('is-open');
			document.removeEventListener('scroll', OnScroll, true);
			window.removeEventListener('resize', OnScroll);
			if (activeSelectClose === CloseList) {
				activeSelectClose = null;
				activeSelectWrap = null;
			}
		}

		function OnScroll() {
			if (!list) return;
			if (!PlaceList(false)) CloseList();
		}

		function OpenList() {
			CloseActiveSelect();
			if (!list) BuildList();
			root.appendChild(list);
			wrap.classList.add('is-open');
			list.classList.add('is-open');
			if (!PlaceList(true)) { CloseList(); return; }
			document.addEventListener('scroll', OnScroll, true);
			window.addEventListener('resize', OnScroll);
			activeSelectClose = CloseList;
			activeSelectWrap = wrap;
		}

		btn.addEventListener('click', function (e) {
			e.stopPropagation();
			if (list && list.parentNode) CloseList();
			else OpenList();
		});

		Sync();
		wrap.setValue = function (arr, fire) {
			sel = Array.isArray(arr) ? arr.map(String) : [];
			Sync();
			if (fire && onChange) onChange(sel.slice());
		};
		wrap.getValue = function () { return sel.slice(); };
		return wrap;
	}


	// Klik di luar dropdown menutupnya. Dipasang di fase capture karena root
	// menghentikan propagasi pointerdown, sehingga listener bubble tidak akan
	// pernah menerima klik dari dalam panel.
	document.addEventListener('pointerdown', function (e) {
		if (!activeSelectClose) return;
		var t = e.target;
		if (t && t.closest && (t.closest('.cp-select-list') || t.closest('.cp-select') === activeSelectWrap)) return;
		CloseActiveSelect();
	}, true);

	/* ==================================================== dialog buatan sendiri */

	// window.prompt()/confirm() tidak dirender di OBS, jadi dipakai dialog ini.

	function ShowDialog(o) {
		o = o || {};
		var back = h('div', 'cp-dialog-back');
		var box = h('div', 'cp-dialog');

		box.appendChild(h('div', 'cp-dialog-title', o.title || ''));
		if (o.message) box.appendChild(h('div', 'cp-dialog-msg', o.message));

		var inp = null;
		if (o.input) {
			inp = h('input', 'cp-input');
			inp.type = 'text';
			inp.value = o.value || '';
			if (o.placeholder) inp.placeholder = o.placeholder;
			box.appendChild(inp);
		}
		if (o.textarea) {
			inp = h('textarea', 'cp-export');
			inp.value = o.value || '';
			if (o.placeholder) inp.placeholder = o.placeholder;
			box.appendChild(inp);
		}
		if (o.fileInput && inp) {
			var fbtn = h('button', 'cp-btn cp-btn-ghost cp-btn-sm', 'Choose file...');
			fbtn.type = 'button';
			var fin = h('input');
			fin.type = 'file';
			fin.accept = '.json,application/json';
			fin.style.display = 'none';
			fin.addEventListener('change', function () {
				var f = fin.files && fin.files[0];
				if (!f) return;
				var rd = new FileReader();
				rd.onload = function () { inp.value = String(rd.result); };
				rd.readAsText(f);
			});
			fbtn.addEventListener('click', function () { fin.click(); });
			box.appendChild(fbtn);
			box.appendChild(fin);
		}

		var row = h('div', 'cp-dialog-row');
		var cancel = h('button', 'cp-btn cp-btn-ghost', o.cancelLabel || 'Cancel');
		cancel.type = 'button';
		var ok = h('button', 'cp-btn ' + (o.danger ? 'cp-btn-danger' : 'cp-btn-primary'), o.confirmLabel || 'OK');
		ok.type = 'button';
		row.appendChild(cancel);
		row.appendChild(ok);
		box.appendChild(row);
		back.appendChild(box);
		root.appendChild(back);

		function CloseD() {
			if (back.parentNode) back.parentNode.removeChild(back);
			document.removeEventListener('keydown', onKey, true);
		}
		function Accept() {
			var v = inp ? inp.value : null;
			CloseD();
			if (o.onConfirm) o.onConfirm(v);
		}
		function onKey(e) {
			if (e.key === 'Escape') { e.stopPropagation(); CloseD(); if (o.onCancel) o.onCancel(); }
			else if (e.key === 'Enter' && inp && document.activeElement === inp && !o.textarea) {
				e.preventDefault();
				Accept();
			}
		}
		ok.addEventListener('click', Accept);
		cancel.addEventListener('click', function () { CloseD(); if (o.onCancel) o.onCancel(); });
		back.addEventListener('click', function (e) {
			if (e.target === back) { CloseD(); if (o.onCancel) o.onCancel(); }
		});
		document.addEventListener('keydown', onKey, true);

		if (inp) {
			inp.focus();
			if (inp.select && !o.textarea) inp.select();
		}
		return { close: CloseD };
	}

	/* ======================================= obs-websocket (sync profil) */

	// Klien obs-websocket v5 ringkas, khusus untuk panel. Dipakai tombol
	// "Connect & Sync Profile" di tab Connections.
	//
	// Kenapa perlu: halaman TIDAK bisa tahu nama browser source-nya sendiri
	// (obs-browser tidak menyediakan API itu), dan localStorage dibagi semua
	// source satu origin. Akibatnya source yang ditambah MANUAL ikut membaca
	// "profil aktif" terakhir sehingga saling menimpa.
	//
	// Cara kerja: cari source OBS yang URL-nya menunjuk widget ini (halaman
	// tak bisa menyebut namanya, tapi URL-nya bisa dicocokkan), baca scene
	// tempat source itu berada, buat profil bernama scene itu, lalu tulis
	// ?profile=<scene> ke URL source lewat SetInputSettings.
	//
	// Catatan: source yang dibuat lewat dashboard sudah dipin otomatis oleh
	// shared/settings/obs_source.js, jadi tombol ini untuk source manual.

	var ObsWS = (function () {
		var socket = null;
		var endpoint = null;
		var seq = 0;
		var pending = {};

		// Alamat OBS dibaca dari input yang sedang tampil di panel; kalau kontrol
		// itu tidak dirender (tab lain), jatuh ke nilai tersimpan.
		function Cfg() {
			function val(id, fb) {
				var i = el[id];
				var v = (i && typeof i.value === 'string') ? i.value : CFG.read(id);
				if (v === undefined || v === null || v === '') return fb;
				return v;
			}
			return {
				address: String(val('obsAddress', '127.0.0.1')) || '127.0.0.1',
				port: Number(val('obsPort', 4455)) || 4455,
				password: String(val('obsPassword', ''))
			};
		}

		function Sha256Base64(text) {
			var bytes = new TextEncoder().encode(text);
			return crypto.subtle.digest('SHA-256', bytes).then(function (d) {
				var v = new Uint8Array(d);
				var out = '';
				for (var i = 0; i < v.length; i++) out += String.fromCharCode(v[i]);
				return btoa(out);
			});
		}

		function Connect() {
			var c = Cfg();
			var ep = 'ws://' + c.address + ':' + c.port;
			if (socket && endpoint === ep && socket.readyState === WebSocket.OPEN) {
				return Promise.resolve(socket);
			}
			if (socket) { try { socket.close(); } catch (e) { /* abaikan */ } socket = null; endpoint = null; }

			return new Promise(function (resolve, reject) {
				var ws;
				try { ws = new WebSocket(ep); }
				catch (e) { reject(new Error('WebSocket is not available here')); return; }

				var timer = setTimeout(function () {
					try { ws.close(); } catch (e) { /* abaikan */ }
					reject(new Error('Timed out. Check Tools > WebSocket Server Settings and the IP/port/password.'));
				}, 6000);

				ws.addEventListener('message', function (ev) {
					var msg;
					try { msg = JSON.parse(ev.data); } catch (e) { return; }

					if (msg.op === 0) {
						var auth = msg.d && msg.d.authentication;
						if (auth) {
							Sha256Base64(c.password + auth.salt)
								.then(function (secret) { return Sha256Base64(secret + auth.challenge); })
								.then(function (resp) {
									ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication: resp, eventSubscriptions: 0 } }));
								})
								.catch(function () { /* biarkan timeout yang melaporkan */ });
						} else {
							ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0 } }));
						}
						return;
					}

					if (msg.op === 2) {
						clearTimeout(timer);
						socket = ws; endpoint = ep;
						resolve(ws);
						return;
					}

					if (msg.op === 7) {
						var id = msg.d && msg.d.requestId;
						var entry = pending[id];
						if (!entry) return;
						delete pending[id];
						if (msg.d.requestStatus && msg.d.requestStatus.result) entry.resolve(msg.d.responseData);
						else entry.reject(new Error((msg.d.requestStatus && msg.d.requestStatus.comment) || 'OBS refused the request'));
					}
				});

				ws.addEventListener('error', function () {
					clearTimeout(timer);
					reject(new Error('Could not reach OBS WebSocket at ' + c.address + ':' + c.port));
				});
			});
		}

		function Request(type, data) {
			return Connect().then(function (ws) {
				return new Promise(function (resolve, reject) {
					var id = 'cp-' + (++seq);
					pending[id] = { resolve: resolve, reject: reject };
					ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
					setTimeout(function () {
						if (pending[id]) { delete pending[id]; reject(new Error('OBS did not answer: ' + type)); }
					}, 8000);
				});
			});
		}

		return { connect: Connect, request: Request, cfg: Cfg };
	})();

	/* ------------------------------------------- status OBS (badge navbar) */

	var obsBadge = null;
	var OBS_STATE = 'off';
	// Modal Connect OBS yang sedang terbuka. 'required' masih didukung untuk
	// pemanggil yang memang butuh (mis. alur OBS sync), tapi auto-pop-up panel
	// TIDAK wajib — user boleh menutupnya.
	var obsDialogBack = null;
	var obsDialogRequired = false;

	function RenderObsBadge() {
		if (!obsBadge) return;
		obsBadge.classList.toggle('is-on', OBS_STATE === 'on');
		obsBadge.classList.toggle('is-connecting', OBS_STATE === 'connecting');
		obsBadge.classList.toggle('is-off', OBS_STATE === 'off');
		var label = obsBadge.querySelector('.cp-obs-badge-label');
		if (label) label.textContent =
			OBS_STATE === 'on' ? 'Connected' :
			OBS_STATE === 'connecting' ? 'Connecting' : 'OBS Offline';
	}

	function SetObsState(state) { OBS_STATE = state; RenderObsBadge(); }

	function ConnectObs(opts) {
		opts = opts || {};
		SetObsState('connecting');
		return ObsWS.connect().then(function () {
			SetObsState('on');
			if (!opts.silent) SetStatus('OBS connected.');
			return true;
		}).catch(function (e) {
			SetObsState('off');
			if (!opts.silent) SetStatus('OBS: ' + e.message);
			throw e;
		});
	}

	// Modal "Connect OBS" (Port + Password). Nilai koneksi disimpan sebagai
	// preferensi karena alamat OBS itu milik mesin, bukan milik satu scene.
	function ObsConnectDialog(opts) {
		opts = opts || {};
		var required = !!opts.required;
		var back = h('div', 'cp-dialog-back');
		var box = h('div', 'cp-dialog');

		var hd = h('div', 'cp-dialog-head');
		var ic = h('span', 'cp-dialog-icon');
		ic.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
		hd.appendChild(ic);
		hd.appendChild(h('div', 'cp-dialog-title', 'Connect OBS'));
		var x = h('button', 'cp-dialog-x', '\u00d7');
		x.type = 'button';
		if (required) x.style.display = 'none';
		hd.appendChild(x);
		box.appendChild(hd);

		box.appendChild(h('label', 'cp-dialog-label', 'Port'));
		var port = h('input', 'cp-input');
		port.type = 'text';
		port.value = String(CFG.read('obsPort') || 4455);
		box.appendChild(port);

		box.appendChild(h('label', 'cp-dialog-label', 'Password'));
		var pwWrap = h('div', 'cp-pw');
		var pw = h('input', 'cp-input');
		pw.type = 'password';
		pw.value = String(CFG.read('obsPassword') || '');
		var eye = h('button', 'cp-pw-eye');
		eye.type = 'button';
		eye.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
		eye.addEventListener('click', function () { pw.type = pw.type === 'password' ? 'text' : 'password'; });
		pwWrap.appendChild(pw);
		pwWrap.appendChild(eye);
		box.appendChild(pwWrap);

		var msg = h('div', 'cp-dialog-msg');
		box.appendChild(msg);

		var go = h('button', 'cp-btn cp-btn-primary cp-dialog-connect', 'Connect');
		go.type = 'button';
		box.appendChild(go);

		back.appendChild(box);
		root.appendChild(back);

		obsDialogBack = back;
		obsDialogRequired = required;
		function CloseD() {
			// Mode wajib: tolak semua upaya menutup sebelum Connect berhasil.
			if (obsDialogRequired) return;
			if (back.parentNode) back.parentNode.removeChild(back);
			obsDialogBack = null;
		}
		x.addEventListener('click', CloseD);
		back.addEventListener('click', function (e) { if (e.target === back) CloseD(); });

		go.addEventListener('click', function () {
			CFG.setPref('obsPort', port.value.trim());
			CFG.setPref('obsPassword', pw.value);
			if (el['obsPort']) el['obsPort'].value = port.value.trim();
			if (el['obsPassword']) el['obsPassword'].value = pw.value;
			go.disabled = true;
			go.textContent = 'Connecting...';
			msg.textContent = '';
			ConnectObs({ silent: true }).then(function () {
				CFG.setPref('obsAutoConnect', '1');
				// Sudah terhubung: modal boleh ditutup (juga kalau tadinya wajib).
				obsDialogRequired = false;
				msg.textContent = 'Connected.';
				go.textContent = 'Connected';
				setTimeout(function () { CloseD(); SyncProfileToScene(); }, 500);
			}).catch(function (e) {
				go.disabled = false;
				go.textContent = 'Connect';
				msg.textContent = e.message;
			});
		});

		port.focus();
		return { close: CloseD };
	}

	// Konek otomatis saat panel dimuat, hanya setelah form OBS Connection
	// pernah diisi (obsAutoConnect). Bila URL belum dipin ke profil, sekalian
	// buat profil dari nama scene dan pin URL-nya.
	setTimeout(function () {
		if (CFG.read('obsAutoConnect') !== '1') return;
		ConnectObs({ silent: true }).then(function () {
			if (!new URLSearchParams(location.search).get('profile')) SyncProfileToScene();
		}).catch(function () { /* badge sudah menunjukkan Offline */ });
	}, 900);

	// Akar URL widget. Halaman OBS memuat ./obs/index.html sementara URL source
	// biasanya berhenti di folder widget, jadi keduanya disamakan dulu supaya
	// bisa dicocokkan.
	function WidgetRoot(u) {
		try {
			var p = new URL(u, location.href).pathname;
			p = p.replace(/index\.html$/i, '').replace(/obs\/$/i, '').replace(/\/+$/, '');
			return p.toLowerCase();
		} catch (e) { return ''; }
	}

	// Cari browser source OBS yang URL-nya menunjuk widget ini, beserta scene
	// tempat source itu berada. Grup di dalam scene tidak ditelusuri.
	function FindOurSource() {
		var mine = WidgetRoot(location.href);
		var perScene = {};
		var current = '';

		return ObsWS.request('GetSceneList', {}).then(function (sl) {
			var scenesList = (sl && sl.scenes) || [];
			current = (sl && sl.currentProgramSceneName) || '';
			var chain = Promise.resolve();
			scenesList.forEach(function (sc) {
				chain = chain.then(function () {
					return ObsWS.request('GetSceneItemList', { sceneName: sc.sceneName }).then(function (r) {
						perScene[sc.sceneName] = ((r && r.sceneItems) || []).map(function (it) { return it.sourceName; });
					}).catch(function () { perScene[sc.sceneName] = []; });
				});
			});
			return chain;
		}).then(function () {
			return ObsWS.request('GetInputList', { inputKind: 'browser_source' });
		}).then(function (il) {
			var names = ((il && il.inputs) || []).map(function (i) { return i.inputName; });
			var matches = [];
			var chain = Promise.resolve();
			names.forEach(function (n) {
				chain = chain.then(function () {
					return ObsWS.request('GetInputSettings', { inputName: n }).then(function (st) {
						var url = ((st && st.inputSettings) || {}).url || '';
						if (WidgetRoot(url) === mine) matches.push({ sourceName: n, url: url });
					}).catch(function () { /* input hilang / tidak terbaca */ });
				});
			});
			return chain.then(function () {
				var out = [];
				matches.forEach(function (m) {
					Object.keys(perScene).forEach(function (sc) {
						if (perScene[sc].indexOf(m.sourceName) !== -1) {
							out.push({ sceneName: sc, sourceName: m.sourceName, url: m.url });
						}
					});
				});
				return { found: out, current: current };
			});
		});
	}

	function PinProfileUrl(url, name) {
		try {
			var u = new URL(url, location.href);
			u.searchParams.set('profile', name);
			return u.href;
		} catch (e) {
			return url + (url.indexOf('?') === -1 ? '?' : '&') + 'profile=' + encodeURIComponent(name);
		}
	}

	function ObsSyncStatus(msg) {
		var box = document.getElementById('cp-obs-sync-status');
		if (box) box.textContent = msg || '';
		SetStatus(msg || '');
	}

	function SyncProfileToScene() {
		ObsSyncStatus('Connecting to OBS...');
		ConnectObs({ silent: true }).then(function () {
			ObsSyncStatus('Connected. Looking for this widget in OBS...');
			return FindOurSource();
		}).then(function (res) {
			if (!res.found.length) {
				throw new Error('No browser source in OBS points at this widget. Add the source first, then connect.');
			}
			var pick = null;
			for (var i = 0; i < res.found.length; i++) {
				if (res.found[i].sceneName === res.current) { pick = res.found[i]; break; }
			}
			if (!pick) pick = res.found[0];

			var name = pick.sceneName;
			CFG.saveProfile(name, ReadForm());
			CFG.setActive(name);

			var newUrl = PinProfileUrl(pick.url, name);
			return ObsWS.request('SetInputSettings', {
				inputName: pick.sourceName,
				inputSettings: { url: newUrl },
				overlay: true
			}).then(function () {
				CFG.setPref('panelOpen', '1');
				var note = res.found.length > 1
					? ' (' + res.found.length + ' sources matched; used the one in the current scene)'
					: '';
				ObsSyncStatus('Profile "' + name + '" saved and "' + pick.sourceName + '" pinned to it' + note + '.');
				setTimeout(function () { ReloadAllWidgetSources(); }, 300);
			});
		}).catch(function (e) {
			ObsSyncStatus('OBS sync failed: ' + e.message);
		});
	}

	/* ============================================================== kontrol */

	function BuildControl(s) {
		var box = h('div', 'cp-field');
		box.dataset.id = s.id;
		if (s.full) box.classList.add('cp-full');

		var input;

		switch (s.type) {
			case 'checkbox': {
				box.classList.add('cp-field-check');
				input = h('input');
				input.type = 'checkbox';
				input.checked = !!values[s.id];
				var sw = h('span', 'cp-switch');
				var line = h('label', 'cp-check-line');
				line.appendChild(input);
				line.appendChild(sw);
				line.appendChild(h('span', 'cp-check-text', s.label || s.id));
				box.appendChild(line);
				if (s.description) {
					var dc = h('span', 'cp-desc cp-desc-block');
					dc.innerHTML = s.description;
					box.appendChild(dc);
				}
				break;
			}

			case 'select': {
				box.classList.add('cp-row');
				box.appendChild(labelFor(s));
				// Nilai disimpan di input tersembunyi supaya ReadForm/FillForm
				// dan showIf tetap bekerja seperti kontrol lain.
				input = h('input');
				input.type = 'hidden';
				input.value = values[s.id] !== undefined ? String(values[s.id]) : '';
				var sel = MakeSelect(s.options || [], input.value, function (v) {
					input.value = v;
					input.dispatchEvent(new Event('change', { bubbles: true }));
				});
				input.__select = sel;
				box.appendChild(sel);
				box.appendChild(input);
				break;
			}

			case 'slider': {
				// Baris mendatar seperti .row Better Alerts: label kiri, kontrol kanan.
				box.classList.add('cp-row');
				var lab = h('div', 'cp-label');
				lab.appendChild(h('span', 'cp-label-text', s.label || s.id));
				box.appendChild(lab);

				var ctl = h('div', 'cp-slider-ctl');
				input = h('input', 'cp-range');
				input.type = 'range';
				if (s.min !== undefined) input.min = s.min;
				if (s.max !== undefined) input.max = s.max;
				input.step = s.step !== undefined ? s.step : 1;
				input.value = values[s.id] !== undefined ? values[s.id] : (s.min || 0);
				var out = h('span', 'cp-slider-val');
				var show = function () { out.textContent = input.value; };
				input.addEventListener('input', show);
				show();
				ctl.appendChild(input);
				ctl.appendChild(out);
				box.appendChild(ctl);
				break;
			}

			case 'tags': {
				// Dropdown multi-pilih seperti dashboard (wa-select multiple):
				// label kiri, dropdown 180px kanan, isi bisa dicentang banyak.
				box.classList.add('cp-row');
				box.classList.remove('cp-full');
				box.appendChild(labelFor(s));

				// Nilai disimpan di input tersembunyi (JSON array) supaya
				// ReadForm/FillForm dan pemeriksaan minTags tetap bekerja.
				input = h('input');
				input.type = 'hidden';
				var selInit = Array.isArray(values[s.id]) ? values[s.id].slice()
					: String(values[s.id] || '').split(',').filter(Boolean);
				input.value = JSON.stringify(selInit);
				var msel = MakeMultiSelect(s.options || [], selInit, function (arr) {
					input.value = JSON.stringify(arr);
					input.dispatchEvent(new Event('change', { bubbles: true }));
				});
				input.__select = msel;
				box.appendChild(msel);
				box.appendChild(input);
				break;
			}

			case 'font': {
				box.classList.add('cp-row');
				box.appendChild(labelFor(s));
				input = h('input', 'cp-input');
				input.type = 'text';
				input.placeholder = s.placeholder || 'Google Font name, e.g. Inter';
				input.value = values[s.id] !== undefined ? values[s.id] : '';
				box.appendChild(input);
				break;
			}

			case 'number': {
				box.classList.add('cp-row');
				box.appendChild(labelFor(s));
				input = h('input', 'cp-input');
				input.type = 'number';
				if (s.min !== undefined) input.min = s.min;
				if (s.max !== undefined) input.max = s.max;
				if (s.step !== undefined) input.step = s.step;
				input.value = values[s.id] !== undefined ? values[s.id] : '';
				box.appendChild(input);
				break;
			}

			case 'password': {
				box.classList.add('cp-row');
				box.appendChild(labelFor(s));
				input = h('input', 'cp-input');
				input.type = 'password';
				input.autocomplete = 'off';
				input.value = values[s.id] !== undefined ? values[s.id] : '';
				box.appendChild(input);
				break;
			}

			default: { // text
				box.classList.add('cp-row');
				box.appendChild(labelFor(s));
				input = h('input', 'cp-input');
				input.type = 'text';
				if (s.placeholder) input.placeholder = s.placeholder;
				input.value = values[s.id] !== undefined ? values[s.id] : '';
				box.appendChild(input);
			}
		}

		if (input) {
			input.id = 'cp-' + s.id;
			el[s.id] = input;
			// Setiap perubahan menandai belum tersimpan DAN memperbarui `values`,
			// supaya edit yang dibuat di satu tab tetap terbawa saat pindah tab
			// (RenderBody membangun ulang kontrol dari `values`).
			var sync = function () {
				var v = ReadControl(s, input);
				if (v !== undefined) values[s.id] = v;
				MarkDirty();
				// Setiap perubahan bisa mengubah showIf kontrol lain
				// (mis. Widget Style -> Background Opacity).
				ApplyShowIf();
			};
			input.addEventListener('input', sync);
			input.addEventListener('change', sync);
		}
		wrapEl[s.id] = box;
		return box;
	}

	function ApplyShowIf() {
		settings.forEach(function (s) {
			if (!s.showIf) return;
			var box = wrapEl[s.id];
			if (!box) return;
			var src = el[s.showIf];
			var cur = src ? (src.type === 'checkbox' ? String(src.checked) : src.value) : '';
			box.style.display = (String(cur) === String(s.showIfValue)) ? '' : 'none';
		});
	}

	/* ------------------------------------------------------------ baca / isi */

// Baca nilai SATU kontrol dari DOM (dipakai ReadForm dan sinkronisasi live).
	function ReadControl(s, i) {
		if (!i) return undefined;
		if (s.type === 'checkbox') return i.checked;
		if (s.type === 'tags') {
			if (i.__select) return i.__select.getValue();
			var arr = [];
			try { arr = JSON.parse(i.value || '[]'); }
			catch (e) { arr = String(i.value || '').split(',').filter(Boolean); }
			return Array.isArray(arr) ? arr : [];
		}
		if (s.type === 'number' || s.type === 'slider') return i.value === '' ? '' : Number(i.value);
		return i.value;
	}

	// RenderBody() hanya membangun kontrol untuk TAB YANG AKTIF, jadi `el`
	// tidak memuat kontrol tab lain. Kalau ReadForm hanya membaca DOM, menyimpan
	// dari satu tab akan MENGHAPUS seluruh pengaturan tab lain dari profil -
	// widget lalu jatuh ke bawaan (mis. widgetStyle kembali ke "glass"). Karena
	// itu nilai dasar diambil dari `values` (peta efektif penuh saat dimuat),
	// lalu ditimpa oleh nilai DOM untuk kontrol yang benar-benar dirender.
	function ReadForm() {
		var map = {};
		settings.forEach(function (s) {
			if (Object.prototype.hasOwnProperty.call(values, s.id)) map[s.id] = values[s.id];
		});
		settings.forEach(function (s) {
			var i = el[s.id];
			if (!i) return; // tab lain: pertahankan nilai dasar
			var v = ReadControl(s, i);
			if (v !== undefined) map[s.id] = v;
		});
		// Offset & skala dari mode Layout bukan setting skema; offset disuntikkan
		// di sini supaya setiap jalur simpan (Save, OBS sync) ikut membawanya.
		map.widgetOffsetX = layoutState.x;
		map.widgetOffsetY = layoutState.y;
		map.widgetScale = layoutState.scale;
		map.widgetRotation = layoutState.rotation;
		return map;
	}

	function FillForm(map) {
		settings.forEach(function (s) {
			var i = el[s.id];
			if (!i) return;
			var v = map[s.id];
			if (s.type === 'checkbox') i.checked = !!v;
			else if (s.type === 'tags') {
				var list = Array.isArray(v) ? v : String(v || '').split(',').filter(Boolean);
				if (i.__select) i.__select.setValue(list, false);
				i.value = JSON.stringify(list);
			} else if (s.type === 'slider') {
				i.value = v !== undefined && v !== '' ? v : i.min;
				i.dispatchEvent(new Event('input'));
			} else if (s.type === 'select') {
				i.value = v === undefined || v === null ? '' : String(v);
				// Dropdown buatan sendiri perlu disuruh menggambar ulang labelnya.
				if (i.__select) i.__select.setValue(i.value, false);
			} else i.value = v === undefined || v === null ? '' : v;
		});
		ApplyShowIf();
	}

	/* -------------------------------------------------------- status tersimpan */

	var dirty = false;

	function MarkDirty() {
		if (dirty) return;
		dirty = true;
		if (btnSave) btnSave.classList.add('is-dirty');
	}
	function ClearDirty() {
		dirty = false;
		if (btnSave) btnSave.classList.remove('is-dirty');
	}

	/* ---------------------------------------------------------------- bangunan */

	var root = h('div', 'cp-root');
	root.setAttribute('role', 'dialog');
	root.setAttribute('aria-label', 'Controls Panel');

	var panel = h('div', 'cp-panel');

	/* -- header: judul + aksi (profil, collapse, close) ----------------------- */

	var head = h('div', 'cp-head');

	var titleBox = h('div', 'cp-head-title');
	titleBox.appendChild(h('div', 'cp-title', 'Controls Panel'));
	head.appendChild(titleBox);

	var headActions = h('div', 'cp-head-actions');
	var btnGear = null;

	obsBadge = h('button', 'cp-obs-badge is-off');
	obsBadge.type = 'button';
	Tip(obsBadge, 'OBS connection status. Click to connect.');
	obsBadge.appendChild(h('span', 'cp-obs-badge-dot'));
	obsBadge.appendChild(h('span', 'cp-obs-badge-label', 'OBS Offline'));
	obsBadge.addEventListener('click', ObsConnectDialog);
	headActions.appendChild(obsBadge);
	RenderObsBadge();

	// Profil aktif, ditampilkan sebagai pill (bukan dropdown). Profil dibuat
	// otomatis dari nama scene lewat koneksi OBS, jadi tidak ada tombol
	// tambah/hapus di sini.
	var profilePill = h('span', 'cp-obs-badge cp-profile-pill is-static');
	profilePill.appendChild(h('span', 'cp-obs-badge-dot'));
	profilePill.appendChild(h('span', 'cp-obs-badge-label', CFG.active || 'Default'));
	Tip(profilePill, 'Active profile');
	headActions.appendChild(profilePill);

	// Save & Reset dipindah dari footer ke navbar sebagai ikon, mengikuti
	// gaya Better Alerts. Save berdenyut (is-dirty) saat ada perubahan belum
	// disimpan; lihat MarkDirty().
	var btnSave = h('button', 'cp-btn cp-btn-icon cp-btn-primary');
	btnSave.type = 'button';
	Tip(btnSave, 'Save and apply');
	btnSave.appendChild(Icon('save'));
	btnSave.addEventListener('click', SaveNow);
	headActions.appendChild(btnSave);

	var btnReset = h('button', 'cp-btn cp-btn-icon');
	btnReset.type = 'button';
	Tip(btnReset, 'Reset to defaults');
	btnReset.appendChild(Icon('reset'));
	btnReset.addEventListener('click', function () {
		ShowDialog({
			title: 'Reset to defaults',
			message: 'Restore every setting to its default value?',
			confirmLabel: 'Reset',
			danger: true,
			onConfirm: function () {
				FillForm(defaults);
				// Skala & posisi widget bukan bagian form (dikelola mode Layout),
				// jadi FillForm(defaults) tidak menyentuhnya. Reset eksplisit di sini
				// supaya "Reset to Defaults" benar-benar mengembalikan widget juga.
				LayoutApplyOffset(0, 0);
				LayoutApplyScale(1);
				LayoutApplyRotation(0);
				MarkDirty();
				SetStatus('Defaults loaded. Press Save to apply.');
			}
		});
	});
	headActions.appendChild(btnReset);

	// Options dipindah ke gear icon di navbar (seperti Better Alerts), bukan tab.
	btnGear = h('button', 'cp-btn cp-btn-icon');
	btnGear.type = 'button';
	Tip(btnGear, 'Options');
	btnGear.appendChild(Icon('gear'));
	btnGear.addEventListener('click', function () {
		SwitchTab(activeTab === 'options' ? 'alerts' : 'options');
	});
	headActions.appendChild(btnGear);

	// Collapse: panel mengecil jadi bar judul supaya canvas terlihat penuh.
	var btnCollapse = h('button', 'cp-btn cp-btn-icon');
	btnCollapse.type = 'button';
	Tip(btnCollapse, 'Collapse panel');
	btnCollapse.appendChild(Icon('collapse'));
	btnCollapse.addEventListener('click', function () {
		var on = root.classList.toggle('is-collapsed');
		btnCollapse.textContent = '';
		btnCollapse.appendChild(Icon(on ? 'restore' : 'collapse'));
		Tip(btnCollapse, on ? 'Restore panel size' : 'Collapse panel');
		// Saat panel dikecilkan, widget masuk mode Layout (drag/resize).
		SetLayoutMode(on);
	});
	headActions.appendChild(btnCollapse);

	var btnClose = h('button', 'cp-btn cp-btn-icon');
	btnClose.type = 'button';
	Tip(btnClose, 'Close panel');
	btnClose.appendChild(Icon('close'));
	btnClose.addEventListener('click', Close);
	headActions.appendChild(btnClose);

	head.appendChild(headActions);
	panel.appendChild(head);

	/* -- geser panel dengan menyeret bar judul ------------------------------
	   Pola sama seperti Better Alerts: pointerdown di bar judul, lalu
	   pointermove/pointerup dipasang di window supaya seretan tetap mulus
	   walau kursor keluar dari bar judul. Tidak ada grip pengubah ukuran -
	   panel selalu 640 px, persis seperti Better Alerts. */

	var pos = null;
	try { pos = JSON.parse(CFG.read('panelPos') || 'null'); } catch (e) { pos = null; }

	function Clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

	function ApplyPos() {
		if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
		panel.style.left = Math.round(pos.x) + 'px';
		panel.style.top = Math.round(pos.y) + 'px';
		panel.style.bottom = 'auto'; // posisi tersimpan memakai top, jangan biarkan bottom ikut
	}

	function ResetPos() {
		pos = null;
		panel.style.left = '';
		panel.style.top = '';
		panel.style.bottom = ''; // kembali ke bawaan CSS: kiri bawah
		try { CFG.setPref('panelPos', ''); } catch (e) { /* abaikan */ }
	}

	var drag = null;

	head.addEventListener('pointerdown', function (e) {
		if (e.button !== 0) return;
		if (e.target && e.target.closest && e.target.closest('button, input, textarea, .cp-select')) return;
		var r = panel.getBoundingClientRect();
		drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
		head.classList.add('is-dragging');
		document.body.style.userSelect = 'none';
		try { head.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
		e.preventDefault();
	});

	window.addEventListener('pointermove', function (e) {
		if (!drag) return;
		panel.style.left = Clamp(e.clientX - drag.dx, -380, window.innerWidth - 60) + 'px';
		panel.style.top = Clamp(e.clientY - drag.dy, 0, window.innerHeight - 40) + 'px';
		panel.style.bottom = 'auto';
	});

	function EndDrag() {
		if (!drag) return;
		drag = null;
		head.classList.remove('is-dragging');
		document.body.style.userSelect = '';
		var r = panel.getBoundingClientRect();
		pos = { x: r.left, y: r.top };
		try { CFG.setPref('panelPos', JSON.stringify(pos)); } catch (e) { /* abaikan */ }
	}

	window.addEventListener('pointerup', EndDrag);
	window.addEventListener('pointercancel', EndDrag);

	// Klik dua kali pada bar judul mengembalikan panel ke kiri bawah.
	head.addEventListener('dblclick', function (e) {
		if (e.target && e.target.closest && e.target.closest('button, input, textarea, .cp-select')) return;
		ResetPos();
	});

	/* -- baris tab ---------------------------------------------------------- */

	var tabBar = h('div', 'cp-tabs');
	panel.appendChild(tabBar);

	/* -- isi ---------------------------------------------------------------- */

	var body = h('div', 'cp-body');
	panel.appendChild(body);

	/* -- footer dihapus: Save & Reset sekarang ikon di navbar ----------------- */

	// Pesan status tampil sebagai toast di pojok kanan atas LAYAR, seperti
	// Better Alerts (bukan baris di bawah tombol Save). Ditempel ke root
	// yang menutupi seluruh viewport, bukan ke dalam panel.
	var toasts = h('div', 'cp-toasts');
	root.appendChild(toasts);

	root.appendChild(panel);

	/* -- tombol pembuka (untuk OBS Interact) --------------------------------
	   Di OBS, keyboard tidak selalu sampai ke browser source, jadi menekan S
	   saja tidak cukup. Tombol ini hanya tampil saat pointer bergerak. Saat
	   tidak ada Interact tidak ada pointer, jadi tombol tidak pernah ikut
	   terekam di stream. */
	var launcher = h('button', 'cp-launcher');
	launcher.type = 'button';
	Tip(launcher, 'Open Controls Panel');
	launcher.innerHTML =
		'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
		'<circle cx="12" cy="12" r="3"></circle>' +
		'<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>' +
		'</svg>';
	launcher.addEventListener('click', Open);
	document.body.appendChild(launcher);

	function SetLauncherVisible(on) {
		launcher.classList.toggle('is-available', !!on);
	}

	var launcherTimer = null;
	document.addEventListener('pointermove', function () {
		if (isOpen) return;
		SetLauncherVisible(true);
		if (launcherTimer) clearTimeout(launcherTimer);
		launcherTimer = setTimeout(function () { SetLauncherVisible(false); }, 2500);
	});

	function SetStatus(msg) {
		if (!msg) return;
		var isError = /fail|error|cannot|could not|not found|not available|refused|timed out|blocked/i.test(msg);
		var t = h('div', 'cp-toast' + (isError ? ' is-error' : ''), msg);
		toasts.appendChild(t);
		// Batasi tumpukan supaya tidak memenuhi layar saat pesan beruntun.
		while (toasts.children.length > 4) toasts.removeChild(toasts.firstChild);
		setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3400);
	}

	/* =========================================== mode Layout (drag & resize) */
	/* Pola Better Alerts: saat panel di-collapse, widget diberi bingkai + 8
	   handle. Badan widget digeser, handle mengubah skala (widgetScale).
	   Posisi disimpan sebagai OFFSET MARGIN, bukan left/top: mengubah posisi
	   absolut merusak left:50% + translateX(-50%) bawaan CSS dan membuat
	   animasi pill melebar/menyusut kacau. Snap + garis bantu saat menggeser. */

	var LAYOUT_SNAP = 8;            // px: toleransi snap ke TENGAH canvas
	var LAYOUT_MIN_SCALE = 0.5;
	var LAYOUT_MAX_SCALE = 2.0;

	var layoutOn = false;
	var layoutRaf = 0;
	var giOverlay = null, giFrame = null, giGuideV = null, giGuideH = null, giRotate = null;
	var layoutFrameDrag = null, layoutHandleDrag = null, layoutRotateDrag = null;

	function LayoutWidget() { return document.getElementById('dynamicIsland'); }
	function LayoutClamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
	function LayoutDist(a, b) {
		var dx = a.x - b.x, dy = a.y - b.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function LayoutApplyOffset(x, y) {
		layoutState.x = Math.round(x);
		layoutState.y = Math.round(y);
		var w = LayoutWidget();
		if (w) {
			w.style.marginLeft = layoutState.x + 'px';
			w.style.marginTop = layoutState.y + 'px';
		}
		MarkDirty();
	}

	function LayoutApplyScale(sc) {
		var sc2 = LayoutClamp(Math.round(sc / 0.05) * 0.05, LAYOUT_MIN_SCALE, LAYOUT_MAX_SCALE);
		sc2 = Math.round(sc2 * 100) / 100;
		if (typeof window.setWidgetScale === 'function') window.setWidgetScale(sc2);
		layoutState.scale = sc2;
		MarkDirty();
		return sc2;
	}

	function LayoutApplyRotation(deg) {
		var d = Number(deg);
		if (!isFinite(d)) d = 0;
		// Normalisasi ke rentang (-180, 180].
		d = d % 360;
		if (d > 180) d -= 360;
		if (d <= -180) d += 360;
		d = Math.round(d);
		if (d === -180) d = 180;
		if (typeof window.setWidgetRotation === 'function') window.setWidgetRotation(d);
		layoutState.rotation = d;
		MarkDirty();
		return d;
	}

	function LayoutShowGuides(gx, gy) {
		if (!giGuideV || !giGuideH) return;
		if (gx === null) giGuideV.classList.remove('is-on');
		else { giGuideV.style.left = gx + 'px'; giGuideV.classList.add('is-on'); }
		if (gy === null) giGuideH.classList.remove('is-on');
		else { giGuideH.style.top = gy + 'px'; giGuideH.classList.add('is-on'); }
	}

	// Titik putar widget = transform-origin "top center". Saat widget
	// berotasi, AABB membesar dan titik tengahnya bukan lagi pivot, jadi
	// pivot dihitung ulang dari pusat AABB dikurangi setengah tinggi yang
	// sudah diputar. Dipakai untuk bingkai, handle resize, dan knob rotate.
	function LayoutPivot() {
		var w = LayoutWidget();
		if (!w) return null;
		var r = w.getBoundingClientRect();
		var h = w.offsetHeight * (layoutState.scale || 1);
		var th = (layoutState.rotation || 0) * Math.PI / 180;
		return {
			x: r.left + r.width / 2 + Math.sin(th) * h / 2,
			y: r.top + r.height / 2 - Math.cos(th) * h / 2
		};
	}

	function LayoutTick() {
		layoutRaf = 0;
		if (!layoutOn) return;
		var w = LayoutWidget();
		if (w && giFrame) {
			var p = LayoutPivot();
			var fw = w.offsetWidth * (layoutState.scale || 1);
			var fh = w.offsetHeight * (layoutState.scale || 1);
			giFrame.style.left = (p.x - fw / 2) + 'px';
			giFrame.style.top = p.y + 'px';
			giFrame.style.width = fw + 'px';
			giFrame.style.height = fh + 'px';
			giFrame.style.transform = 'rotate(' + (layoutState.rotation || 0) + 'deg)';
		}
		layoutRaf = requestAnimationFrame(LayoutTick);
	}

	function LayoutLighten(on) {
		var w = LayoutWidget();
		if (!w) return;
		if (on) {
			w.style.transition = 'none';
			w.style.backdropFilter = 'blur(8px)';
			w.style.webkitBackdropFilter = 'blur(8px)';
		} else {
			w.style.removeProperty('transition');
			w.style.removeProperty('backdrop-filter');
			w.style.removeProperty('-webkit-backdrop-filter');
		}
	}

	function LayoutResizeMove(e) {
		var d = layoutHandleDrag;
		if (!d) return;
		var cur = { x: e.clientX, y: e.clientY };
		var ratio;
		if (d.handle === 'n' || d.handle === 's') {
			ratio = Math.abs(cur.y - d.anchor.y) / d.startDistY;
		} else if (d.handle === 'e' || d.handle === 'w') {
			ratio = Math.abs(cur.x - d.anchor.x) / d.startDistX;
		} else {
			ratio = LayoutDist(cur, d.anchor) / d.startDist;
		}
		if (!isFinite(ratio) || ratio <= 0) return;
		LayoutApplyScale(d.startScale * ratio);
	}

	function LayoutRotateMove(e) {
		var d = layoutRotateDrag;
		if (!d) return;
		// Pivot = transform-origin widget (top center), sama seperti skala.
		var ang = Math.atan2(e.clientY - d.pivot.y, e.clientX - d.pivot.x) * 180 / Math.PI;
		LayoutApplyRotation(d.startRotation + (ang - d.startAngle));
	}

	function LayoutEndDrag() {
		if (!layoutFrameDrag && !layoutHandleDrag && !layoutRotateDrag) return;
		layoutFrameDrag = null;
		layoutHandleDrag = null;
		layoutRotateDrag = null;
		if (giFrame) giFrame.classList.remove('is-dragging');
		if (giFrame) giFrame.classList.remove('is-rotating');
		LayoutShowGuides(null, null);
		LayoutLighten(false);
	}

	function LayoutDocMove(e) {
		if (layoutRotateDrag) { LayoutRotateMove(e); return; }
		if (layoutHandleDrag) { LayoutResizeMove(e); return; }
		if (!layoutFrameDrag) return;
		var d = layoutFrameDrag;
		var dx = e.clientX - d.px;
		var dy = e.clientY - d.py;
		var vw = window.innerWidth, vh = window.innerHeight;
		var cx = d.rect.left + dx + d.rect.width / 2;
		var cy = d.rect.top + dy + d.rect.height / 2;
		var nx = d.ox + dx, ny = d.oy + dy;
		var gx = null, gy = null;
		// Snap HANYA ke tengah canvas. Garis bantu pun muncul hanya saat
		// benar-benar menempel ke tengah, bukan pada grid 40px.
		if (Math.abs(cx - vw / 2) <= LAYOUT_SNAP) { nx += (vw / 2 - cx); gx = vw / 2; }
		if (Math.abs(cy - vh / 2) <= LAYOUT_SNAP) { ny += (vh / 2 - cy); gy = vh / 2; }
		LayoutApplyOffset(LayoutClamp(nx, -vw / 2, vw / 2), LayoutClamp(ny, -vh / 2, vh / 2));
		LayoutShowGuides(gx, gy);
	}

	function LayoutBind() {
		giFrame.addEventListener('pointerdown', function (e) {
			if (e.button !== 0) return;
			if (e.target !== giFrame) return; // handle punya listener sendiri
			var w = LayoutWidget();
			if (!w) return;
			layoutFrameDrag = {
				px: e.clientX, py: e.clientY,
				ox: layoutState.x, oy: layoutState.y,
				rect: w.getBoundingClientRect()
			};
			giFrame.classList.add('is-dragging');
			LayoutLighten(true);
			e.preventDefault();
		});

		// Double-click badan widget: reset posisi & skala ke semula.
		giFrame.addEventListener('dblclick', function (e) {
			if (e.target !== giFrame) return; // handle diabaikan
			LayoutApplyOffset(0, 0);
			LayoutApplyScale(1);
			LayoutApplyRotation(0);
			SetStatus('Widget layout reset. Press Save to apply.');
		});

		Array.prototype.forEach.call(giFrame.querySelectorAll('.gi-handle'), function (hn) {
			hn.addEventListener('pointerdown', function (e) {
				if (e.button !== 0) return;
				var w = LayoutWidget();
				if (!w) return;
				// transform-origin widget = "top center": titik itu tetap diam
				// saat skala/rotasi berubah, jadi rasio diukur dari titik itu.
				var anchor = LayoutPivot();
				var p = { x: e.clientX, y: e.clientY };
				layoutHandleDrag = {
					handle: hn.dataset.h,
					anchor: anchor,
					startScale: layoutState.scale,
					startDist: Math.max(1, LayoutDist(p, anchor)),
					startDistX: Math.max(1, Math.abs(p.x - anchor.x)),
					startDistY: Math.max(1, Math.abs(p.y - anchor.y))
				};
				LayoutLighten(true);
				e.preventDefault();
				e.stopPropagation();
			});
		});

		// pointermove/up di document: pointer capture pada handle akan
		// mengarahkan event ke handle, bukan ke giFrame, jadi satu listener
		// global yang merutekan berdasarkan state lebih andal.
		giRotate.addEventListener('pointerdown', function (e) {
			if (e.button !== 0) return;
			var w = LayoutWidget();
			if (!w) return;
			var pivot = LayoutPivot();
			var p = { x: e.clientX, y: e.clientY };
			layoutRotateDrag = {
				pivot: pivot,
				startAngle: Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180 / Math.PI,
				startRotation: layoutState.rotation || 0
			};
			if (giFrame) giFrame.classList.add('is-rotating');
			LayoutLighten(true);
			e.preventDefault();
			e.stopPropagation();
		});

		document.addEventListener('pointermove', LayoutDocMove);
		document.addEventListener('pointerup', LayoutEndDrag);
		document.addEventListener('pointercancel', LayoutEndDrag);
	}

	function LayoutBuild() {
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
		giOverlay.appendChild(h('div', 'gi-hint', 'Layout mode \u2014 drag to move \u00b7 corners to resize \u00b7 top dot to rotate'));
		document.body.appendChild(giOverlay);
		LayoutBind();
	}

	function LayoutEnter() {
		if (layoutOn) return;
		layoutOn = true;
		LayoutBuild();
		giOverlay.classList.add('is-on');
		if (!layoutRaf) layoutRaf = requestAnimationFrame(LayoutTick);
	}

	function LayoutExit() {
		if (!layoutOn) return;
		layoutOn = false;
		if (giOverlay) giOverlay.classList.remove('is-on');
		LayoutShowGuides(null, null);
		LayoutLighten(false);
		if (layoutRaf) { cancelAnimationFrame(layoutRaf); layoutRaf = 0; }
	}

	function SetLayoutMode(on) {
		if (on) {
			LayoutEnter();
			SetStatus('Layout mode on \u2014 drag the widget to move, drag a handle to resize.');
		} else {
			var was = layoutOn;
			LayoutExit();
			if (was && dirty) SetStatus('Layout changed \u2014 press Save to apply.');
		}
	}

	// Muat ulang SEMUA browser source widget di semua scene, tanpa status apa pun.
	// BroadcastChannel juga sampai ke listener di halaman ini sendiri, jadi panel
	// ikut termuat ulang tanpa reload terpisah.
	function ReloadAllWidgetSources() {
		if (!window.BroadcastChannel) return;
		try {
			var rl = new BroadcastChannel('geseki_island_channel');
			rl.postMessage({ type: 'reload' });
			setTimeout(function () { try { rl.close(); } catch (e) {} }, 1000);
		} catch (e) { /* abaikan */ }
	}

	function SaveNow() {
		var bad = settings.filter(function (s) {
			if (!s.minTags || s.type !== 'tags') return false;
			var i = el[s.id];
			if (!i) return false;
			var picked = i.__select ? i.__select.getValue().length : 0;
			return picked < s.minTags;
		});
		if (bad.length) {
			SetStatus('Select at least ' + bad[0].minTags + ' options on "' + (bad[0].label || bad[0].id) + '".');
			if (wrapEl[bad[0].id]) wrapEl[bad[0].id].scrollIntoView({ block: 'center' });
			return;
		}

		var name = CFG.active || 'Default';
		var map = ReadForm();
		// Kontrol tersembunyi tidak dirender, jadi nilainya tidak ikut ReadForm.
		// Ambil dari profil yang tersimpan supaya tidak hilang saat Save.
		var prev = CFG.current();
		PANEL_HIDDEN.forEach(function (id) {
			if (Object.prototype.hasOwnProperty.call(prev, id)) map[id] = prev[id];
		});
		CFG.saveProfile(name, map);
		CFG.setActive(name);
		CFG.setPref('panelOpen', '1');
		ClearDirty();
		SetStatus('Saved to profile "' + name + '".');
		ReloadAllWidgetSources();
	}

	/* ================================================================== tab */

	function RenderTabs() {
		tabBar.textContent = '';
		TABS.forEach(function (t) {
			var b = h('button', 'cp-tab', t.label);
			b.type = 'button';
			b.dataset.tab = t.id;
			if (t.id === activeTab) b.classList.add('is-active');
			b.addEventListener('click', function () { SwitchTab(t.id); });
			tabBar.appendChild(b);
		});
	}

	function SwitchTab(id) {
		activeTab = id;
		CFG.setPref('panelTab', id);
		Array.prototype.forEach.call(tabBar.children, function (b) {
			b.classList.toggle('is-active', b.dataset.tab === id);
		});
		if (btnGear) btnGear.classList.toggle('is-on', id === 'options');
		CloseActiveSelect();
		RenderBodyAndShowIf();
	}

	/* ================================================================ render */

	// Bagian yang bisa dibuka/tutup. `opts.defaultOpen` menentukan keadaan awal.
	function GroupSection(gname, opts) {
		opts = opts || {};
		var sec = h('section', 'cp-group');

		if (opts.heading !== false) {
			var items = settings.filter(function (s) { return (s.group || 'Umum') === gname; });

			var gh = h('button', 'cp-group-head');
			gh.type = 'button';
			var caret = h('span', 'cp-caret');
			gh.appendChild(caret);
			gh.appendChild(h('span', 'cp-group-name', gname));
			sec.appendChild(gh);

			var gbody = h('div', 'cp-group-body');
			var isOpen = GroupOpen(gname, opts.defaultOpen);
			ApplyOpen();

			function ApplyOpen() {
				gbody.classList.toggle('is-open', isOpen);
				caret.classList.toggle('is-open', isOpen);
				gh.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
			}

			gh.addEventListener('click', function () {
				isOpen = !isOpen;
				SetGroupOpen(gname, isOpen);
				ApplyOpen();
			});

			settings.forEach(function (s) {
				if ((s.group || 'Umum') !== gname) return;
				gbody.appendChild(BuildControl(s));
			});
			sec.appendChild(gbody);
			return sec;
		}

		var gbody2 = h('div', 'cp-group-body is-open');
		settings.forEach(function (s) {
			if ((s.group || 'Umum') !== gname) return;
			gbody2.appendChild(BuildControl(s));
		});
		sec.appendChild(gbody2);
		return sec;
	}

	// Kartu satu jenis alert: header bisa diklik untuk buka/tutup, plus switch
	// dan tombol Simulate. Bawaannya TERTUTUP. Kartu Now Playing memakai bentuk
	// yang sama; tombol Simulate-nya menampilkan kartu musik dengan data uji.
	function AlertCard(cfg) {
		var sec = h('section', 'cp-alert-card');
		var head2 = h('div', 'cp-alert-head');

		var enSet = settingById(cfg.enable);

		var toggle = h('button', 'cp-alert-toggle');
		toggle.type = 'button';
		var caret = h('span', 'cp-caret');
		toggle.appendChild(caret);
		var nameBox = h('span', 'cp-alert-name');
		nameBox.appendChild(h('span', 'cp-alert-title', cfg.label));
		toggle.appendChild(nameBox);
		head2.appendChild(toggle);

		var right = h('div', 'cp-alert-actions');

		var btnSim = h('button', 'cp-btn cp-btn-ghost cp-btn-sm', 'Simulate');
		btnSim.type = 'button';
		btnSim.addEventListener('click', function () {
			if (cfg.nowPlaying) {
				// Simulasi kartu musik memakai DATA UJI (jalur terpisah dari alert asli).
				if (typeof window.testNowPlaying === 'function') {
					try {
						// false = ada alert asli sedang/akan tayang -> jangan ditimpa.
						var shown = window.testNowPlaying();
						SetStatus(shown === false
							? 'An alert is on screen, try again in a moment.'
							: 'Now Playing simulation sent.');
					} catch (e) { SetStatus('Simulation failed: ' + e.message); }
				} else SetStatus('Now Playing simulation is not available.');
				return;
			}
			var fnName = 'test' + cfg.label.replace(/\s+/g, '');
			var fn = window[fnName];
			if (typeof fn === 'function') {
				try { fn(); SetStatus(cfg.label + ' simulation sent.'); }
				catch (e) { SetStatus('Simulation failed: ' + e.message); }
			} else {
				SetStatus('Simulation function ' + fnName + '() not found.');
			}
		});
		right.appendChild(btnSim);

		// Switch nyala/mati ditaruh di kartu, bukan di daftar biasa.
		if (enSet) {
			var swWrap = h('div', 'cp-alert-switch');
			var cb = h('input');
			cb.type = 'checkbox';
			cb.checked = !!values[cfg.enable];
			cb.id = 'cp-' + cfg.enable;
			var sw = h('span', 'cp-switch');
			var line = h('label', 'cp-check-line');
			line.appendChild(cb);
			line.appendChild(sw);
			swWrap.appendChild(line);
			cb.addEventListener('change', MarkDirty);
			el[cfg.enable] = cb;
			right.appendChild(swWrap);

			// Alert yang dimatikan tidak bisa diuji: sembunyikan tombol Simulate/
			// Simulate selama switch-nya mati, tampilkan lagi begitu dinyalakan.
			var syncSim = function () { btnSim.hidden = !cb.checked; };
			cb.addEventListener('change', syncSim);
			syncSim();
		}

		head2.appendChild(right);
		sec.appendChild(head2);

		// Isi kartu: semua setting grup ini kecuali switch yang sudah dipindah.
		var gbody = h('div', 'cp-alert-body');
		settings.forEach(function (s) {
			if ((s.group || 'Umum') !== cfg.id) return;
			if (s.id === cfg.enable) return;
			gbody.appendChild(BuildControl(s));
		});
		sec.appendChild(gbody);

		var isOpen = CardOpen(cfg.id);
		ApplyOpen();

		function ApplyOpen() {
			sec.classList.toggle('is-open', isOpen);
			gbody.classList.toggle('is-open', isOpen);
			caret.classList.toggle('is-open', isOpen);
			toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
		}

		toggle.addEventListener('click', function () {
			isOpen = !isOpen;
			SetCardOpen(cfg.id, isOpen);
			ApplyOpen();
		});

		return sec;
	}

	function OptionsTab() {
		var wrap = h('div', 'cp-options');

		// --- Kontrol siaran ---
		var s1 = h('section', 'cp-group');
		s1.appendChild(h('div', 'cp-group-head')).appendChild(h('span', 'cp-group-name', 'Broadcast Control'));
		var b1 = h('div', 'cp-group-body is-open');

		var row1 = h('div', 'cp-opt-row');
		var btnPause = h('button', 'cp-btn cp-btn-ghost', 'Pause All Alerts');
		btnPause.type = 'button';
		var paused = CFG.read('alertsPaused') === '1';
		if (paused) btnPause.classList.add('is-on');
		btnPause.addEventListener('click', function () {
			var now = CFG.read('alertsPaused') === '1';
			// SetAlertsPaused menulis preferensi DAN langsung memproses ulang
			// antrean saat dilanjutkan, jadi tidak perlu reload.
			if (typeof window.SetAlertsPaused === 'function') window.SetAlertsPaused(!now);
			else CFG.setPref('alertsPaused', now ? '0' : '1');
			btnPause.classList.toggle('is-on', !now);
			btnPause.textContent = !now ? 'Resume Alerts' : 'Pause All Alerts';
			SetStatus(!now ? 'Alerts paused. New alerts are held.' : 'Alerts resumed.');
		});
		row1.appendChild(btnPause);

		var btnSkip = h('button', 'cp-btn cp-btn-ghost', 'Skip Current Alert');
		btnSkip.type = 'button';
		btnSkip.addEventListener('click', function () {
			try {
				var elAlert = document.getElementById('islandAlert');
				if (elAlert) elAlert.classList.add('hidden');
				SetStatus('Current alert skipped.');
			} catch (e) { SetStatus('Failed: ' + e.message); }
		});
		row1.appendChild(btnSkip);

		var btnClear = h('button', 'cp-btn cp-btn-ghost', 'Clear Queue');
		btnClear.type = 'button';
		btnClear.addEventListener('click', function () {
			try {
				if (typeof alertQueue !== 'undefined' && alertQueue.length !== undefined) {
					alertQueue.length = 0;
					SetStatus('Queue cleared.');
				} else SetStatus('Queue is not accessible.');
			} catch (e) { SetStatus('Failed: ' + e.message); }
		});
		row1.appendChild(btnClear);
		b1.appendChild(row1);

		var info = h('div', 'cp-opt-info');
		info.id = 'cp-queue-info';
		b1.appendChild(info);
		s1.appendChild(b1);
		wrap.appendChild(s1);

		// --- Tes tampilan ---
		var s2 = h('section', 'cp-group');
		s2.appendChild(h('div', 'cp-group-head')).appendChild(h('span', 'cp-group-name', 'Display Test'));
		var b2 = h('div', 'cp-group-body is-open');
		var row2 = h('div', 'cp-opt-row');
		[
			{ label: 'Follow', fn: 'testFollow' },
			{ label: 'Subscribe', fn: 'testSubscribe' },
			{ label: 'Super Fan', fn: 'testSuperFan' },
			{ label: 'Share', fn: 'testShare' },
			{ label: 'Gift', fn: 'testGift' },
			{ label: 'First Chatter', fn: 'testFirstChatter' },
			{ label: 'Info Panel', fn: 'testWidget' }
		].forEach(function (t) {
			var b = h('button', 'cp-btn cp-btn-ghost cp-btn-sm', t.label);
			b.type = 'button';
			b.addEventListener('click', function () {
				var fn = window[t.fn];
				if (typeof fn === 'function') {
					try { fn(); SetStatus(t.label + ' simulation sent.'); }
					catch (e) { SetStatus('Failed: ' + e.message); }
				} else SetStatus('Function ' + t.fn + '() not found.');
			});
			row2.appendChild(b);
		});
		b2.appendChild(row2);
		s2.appendChild(b2);
		wrap.appendChild(s2);

		// --- Tata letak panel ---
		// Bukan setting widget: ini mengembalikan ukuran & posisi panel ke bawaan.
		var s4 = h('section', 'cp-group');
		s4.appendChild(h('div', 'cp-group-head')).appendChild(h('span', 'cp-group-name', 'Panel Layout'));
		var b4 = h('div', 'cp-group-body is-open');

		var row4 = h('div', 'cp-opt-row');
		var btnResetLayout = h('button', 'cp-btn cp-btn-ghost cp-btn-sm', 'Reset Layout');
		btnResetLayout.type = 'button';
		btnResetLayout.addEventListener('click', function () {
			ResetPos();
			LayoutApplyOffset(0, 0);
			LayoutApplyScale(1);
			LayoutApplyRotation(0);
			SetStatus('Panel & widget layout reset to default. Press Save to apply.');
		});
		row4.appendChild(btnResetLayout);
		b4.appendChild(row4);

		var layoutInfo = h('div', 'cp-opt-info');
		layoutInfo.id = 'cp-layout-info';
		b4.appendChild(layoutInfo);
		setInterval(function () {
			var r = panel.getBoundingClientRect();
			layoutInfo.textContent = 'Panel: ' + Math.round(r.width) + ' \u00d7 ' + Math.round(r.height) +
				' px';
		}, 500);

		s4.appendChild(b4);
		wrap.appendChild(s4);

		// --- Data ---
		var s3 = h('section', 'cp-group');
		s3.appendChild(h('div', 'cp-group-head')).appendChild(h('span', 'cp-group-name', 'Data'));
		var b3 = h('div', 'cp-group-body is-open');
		var row3 = h('div', 'cp-opt-row');

		var btnResetAll = h('button', 'cp-btn cp-btn-ghost', 'Reset All Settings');
		btnResetAll.type = 'button';
		btnResetAll.addEventListener('click', function () {
			ShowDialog({
				title: 'Reset all settings',
				message: 'Delete every saved profile and setting? This cannot be undone.',
				confirmLabel: 'Delete all',
				danger: true,
				onConfirm: function () {
					try {
						var keys = [];
						for (var i = 0; i < localStorage.length; i++) {
							var k = localStorage.key(i);
							if (k && (k.indexOf('geseki:controls:') === 0 || k.indexOf('geseki-scene-') === 0)) keys.push(k);
						}
						keys.forEach(function (k) { localStorage.removeItem(k); });
						SetStatus('All settings deleted.');
						setTimeout(function () { ReloadAllWidgetSources(); }, 300);
					} catch (e) { SetStatus('Failed: ' + e.message); }
				}
			});
		});
		row3.appendChild(btnResetAll);
		b3.appendChild(row3);
		s3.appendChild(b3);
		wrap.appendChild(s3);

		// Info antrean berkala
		setInterval(function () {
			var n = 'unknown';
			try { if (typeof alertQueue !== 'undefined') n = alertQueue.length; } catch (e) { /* abaikan */ }
			var p = CFG.read('alertsPaused') === '1' ? 'paused' : 'active';
			info.textContent = 'Queue: ' + n + ' alerts waiting · status: ' + p;
		}, 700);

		return wrap;
	}

	function RenderBody() {
		body.textContent = '';
		body.scrollTop = 0;
		CloseActiveSelect();

		if (activeTab === 'alerts') {
			// Now Playing ditaruh paling atas, lalu kartu jenis alert.
			body.appendChild(AlertCard(NOW_PLAYING_CARD));
			ALERT_TABS.forEach(function (c) { body.appendChild(AlertCard(c)); });
			return;
		}

		if (activeTab === 'general') {
			body.appendChild(GroupSection('General', { defaultOpen: true }));
			return;
		}

		if (activeTab === 'connections') {
			CONNECTION_GROUPS.forEach(function (g) {
				if (settings.some(function (s) { return (s.group || 'Umum') === g; })) {
					body.appendChild(GroupSection(g, { defaultOpen: g === CONNECTION_DEFAULT_OPEN }));
				}
			});
			return;
		}

		if (activeTab === 'options') {
			body.appendChild(OptionsTab());
			return;
		}
	}

	// Dipanggil setelah RenderBody supaya showIf selalu benar saat tab
	// dibuka (kontrol tab lain belum ada ketika boot).
	function RenderBodyAndShowIf() {
		RenderBody();
		ApplyShowIf();
	}

	/* -------------------------------------------------------------- export/import */

	function DownloadJSON(text, name) {
		try {
			var blob = new Blob([text], { type: 'application/json' });
			var a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = name || 'sekisungkarak.json';
			a.click();
			setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
			SetStatus('File downloaded. If OBS blocks the download, copy the text from the box above.');
		} catch (e) {
			SetStatus('Cannot download here. Copy the JSON text manually.');
		}
	}

	function ExportJSON() {
		var payload = {
			app: 'sekisungkarak-dynamic-island-alert',
			version: 1,
			exportedAt: new Date().toISOString(),
			profile: CFG.active || 'Default',
			settings: ReadForm()
		};
		var text = JSON.stringify(payload, null, 2);

		// Di dalam OBS, unduhan file sering diblokir. Teksnya tetap ditampilkan
		// supaya bisa disalin manual.
		ShowDialog({
			title: 'Export settings',
			message: 'Copy this JSON as a backup, or save it as a file.',
			textarea: true,
			value: text,
			confirmLabel: 'Save file',
			cancelLabel: 'Close',
			onConfirm: function () {
				DownloadJSON(text, 'sekisungkarak-' + (CFG.active || 'default') + '.json');
			}
		});
	}

	function ApplyImport(text) {
		try {
			var data = JSON.parse(String(text || ''));
			var map = data && data.settings ? data.settings : data;
			if (!map || typeof map !== 'object') throw new Error('Unrecognised JSON shape');
			FillForm(map);
			MarkDirty();
			SetStatus('Import loaded into the form. Press Save to apply.');
		} catch (e) {
			SetStatus('Failed to read JSON: ' + e.message);
		}
	}

	function ImportJSON() {
		ShowDialog({
			title: 'Import settings',
			message: 'Paste exported JSON, or pick a file. In OBS, pasting text is more reliable than choosing a file.',
			textarea: true,
			placeholder: '{ "settings": { ... } }',
			fileInput: true,
			confirmLabel: 'Apply',
			onConfirm: ApplyImport
		});
	}

	/* ------------------------------------------------------------------- buka */

	var isOpen = false;

	// Panel di tiap scene adalah instance terpisah: satu browser source = satu
	// dokumen, jadi menutup panel di scene aktif tidak menyentuh panel yang sudah
	// terbuka di scene lain. State buka/tutup karena itu disiarkan lewat
	// BroadcastChannel yang sama dengan widget.
	// panelSyncing menahan siaran balik saat state dari scene lain diterapkan,
	// supaya tidak terjadi ping-pong pesan antar instance.
	var panelBc = window.BroadcastChannel ? new BroadcastChannel('geseki_island_channel') : null;
	var panelSyncing = false;

	function BroadcastPanelState(open) {
		if (!panelBc || panelSyncing) return;
		try { panelBc.postMessage({ type: 'panelState', open: open }); } catch (e) { /* abaikan */ }
	}

	// Buang edit yang belum di-Save: kembalikan form (dan posisi/skala/rotasi
	// widget) ke setting TERAKHIR YANG TERSIMPAN. Dipanggil tiap panel dibuka,
	// supaya perubahan yang tidak jadi disimpan tidak "diingat" panel.
	function ResetFormToSaved() {
		values = CurrentMap();
		layoutState.x = Number(CFG.read('widgetOffsetX')) || 0;
		layoutState.y = Number(CFG.read('widgetOffsetY')) || 0;
		layoutState.scale = Number(CFG.read('widgetScale')) || 1;
		layoutState.rotation = Number(CFG.read('widgetRotation')) || 0;
		var w = LayoutWidget();
		if (w) {
			w.style.marginLeft = layoutState.x + 'px';
			w.style.marginTop = layoutState.y + 'px';
		}
		if (typeof window.setWidgetScale === 'function') window.setWidgetScale(layoutState.scale);
		if (typeof window.setWidgetRotation === 'function') window.setWidgetRotation(layoutState.rotation);
		ClearDirty();
		RenderBodyAndShowIf();
	}

	function Open() {
		if (isOpen) return;
		// Panel dibuka ulang: form kembali ke setting tersimpan.
		ResetFormToSaved();
		isOpen = true;
		document.body.appendChild(root);
		ApplyPos();
		requestAnimationFrame(function () { root.classList.add('is-open'); });
		CFG.setPref('panelOpen', '1');
		BroadcastPanelState(true);
		// Panel dibuka dalam keadaan collapsed (mis. ditutup X saat collapsed):
		// Layout harus ikut hidup lagi supaya "collapsed <=> Layout aktif".
		if (root.classList.contains('is-collapsed')) SetLayoutMode(true);
		// Begitu panel pertama kali muncul dan OBS belum pernah dikonfigurasi,
		// modal Connect dipop-upkan sebagai SARAN — tidak wajib: X/backdrop/Esc
		// boleh menutupnya tanpa menyambung.
		if (CFG.read('obsAutoConnect') !== '1' && !obsDialogBack) {
			setTimeout(function () {
				if (isOpen && !obsDialogBack) ObsConnectDialog();
			}, 260);
		}
	}
	function Close() {
		if (!isOpen) return;
		// Modal wajib menahan panel tetap terbuka; menutup panel akan ikut
		// membuang modalnya (modal berada di dalam root).
		if (obsDialogRequired) { SetStatus('Connect to OBS first.'); return; }
		isOpen = false;
		CloseActiveSelect();
		HideTip();
		// Panel ditutup: jangan tinggalkan bingkai/handle Layout nyangkut di
		// layar (ikut terekam OBS kalau dibiarkan).
		LayoutExit();
		root.classList.remove('is-open');
		CFG.setPref('panelOpen', '0');
		BroadcastPanelState(false);
		setTimeout(function () {
			if (root.parentNode) root.parentNode.removeChild(root);
		}, 180);
	}
	function Toggle() { isOpen ? Close() : Open(); }

	// Terapkan state panel dari scene lain. panelSyncing menahan siaran balik
	// supaya dua instance tidak saling membalas tanpa henti.
	if (panelBc) {
		panelBc.onmessage = function (event) {
			var d = event && event.data;
			if (!d || d.type !== 'panelState') return;
			if (d.open === !!isOpen) return;
			panelSyncing = true;
			try { if (d.open) Open(); else Close(); }
			finally { panelSyncing = false; }
		};
	}

	function ReloadWithPanel() {
		CFG.setPref('panelOpen', '1');
		ReloadAllWidgetSources();
	}

	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape' && isOpen) {
			// Modal wajib (Connect OBS) tidak bisa dibatalkan dengan Esc.
			if (obsDialogRequired) { e.stopPropagation(); return; }
			// Esc menutup dropdown dulu, baru panel.
			if (activeSelectClose) { CloseActiveSelect(); e.stopPropagation(); return; }
			Close();
			e.stopPropagation();
			return;
		}

		// Ctrl/Cmd+S menyimpan, sama seperti kebiasaan editor.
		if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
			e.preventDefault();
			SaveNow();
			return;
		}

		// Tombol S membuka panel. Tidak aktif saat fokus di input supaya
		// mengetik tidak memicu panel.
		if (!isOpen && (e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
			var t = e.target;
			var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
			if (typing) return;
			e.preventDefault();
			Open();
		}
	});

	// Klik di dalam panel tidak boleh tembus ke widget (drag, dll).
	body.addEventListener('scroll', HideTip, true);

	root.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
	root.addEventListener('click', function (e) { e.stopPropagation(); });

	window.GesekiLayout = {
		enter: LayoutEnter,
		exit: LayoutExit,
		toggle: function () { if (layoutOn) SetLayoutMode(false); else SetLayoutMode(true); },
		get isOn() { return layoutOn; }
	};

	window.GesekiPanel = {
		open: Open,
		close: Close,
		toggle: Toggle,
		render: RenderBody,
		get isOpen() { return isOpen; }
	};

	CFG.saveDefaults(defaults);

	RenderTabs();
	if (btnGear) btnGear.classList.toggle('is-on', activeTab === 'options');
	RenderBody();
	ApplyShowIf();

	if (CFG.read('controls') === '1' || CFG.read('panelOpen') === '1') Open();
	console.log('[Geseki][Controls] panel ready - press S to open');
})();
