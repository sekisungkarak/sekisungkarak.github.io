/* ============================================================================
   Live Q&A — antrean pertanyaan penonton + overlay yang dikendalikan streamer.
   ----------------------------------------------------------------------------
   Alur:
     1. Chat yang diawali prefix (mis. "!q") masuk ke ANTREAN, bukan langsung
        tampil. Bila streamer memilih gift tiket di dashboard, penanya harus
        mengirim gift itu dulu (satu gift = satu pertanyaan).
     2. Streamer membuka Queue page di dashboard, melihat daftar pertanyaan,
        lalu MENGKLIK salah satu untuk menampilkannya di overlay.
     3. Overlay menampilkan SATU pertanyaan sampai streamer memilih yang lain
        atau menutupnya. Tidak ada pergantian otomatis.

   Widget ini TIDAK memakai fitur Q&A bawaan TikTok: TikTok harus mengaktifkan
   mode itu di aplikasinya dan event-nya belum terbukti terkirim. Yang dipakai
   di sini hanya `gift` dan `chat`, dua event yang sudah pasti mengalir.

   Kontrol dari luar memakai BroadcastChannel `geseki:live-qa:channel`:
     - Widget menyiarkan  : { type:'qa_state', questions, currentId, ... }
     - Queue page kirim : qa_hello / qa_show / qa_hide / qa_remove / qa_clear
   Kanal yang sama juga membawa 'reload' dan 'callFunction' dari dashboard.

   Sumber konfigurasi (prioritas):
     1. query string      -> URL dari dashboard (paling kuat)
     2. profil tersimpan  -> geseki:live-qa:scene-<nama> (dipilih oleh ?profile=)
     3. nilai bawaan      -> salinan settings.json di bawah
   ========================================================================== */

////////////////
// PARAMETERS //
////////////////

const urlParams = new URLSearchParams(window.location.search);

/* Namespace per-widget. Folder widget ini 'live-qa', jadi semua kuncinya
   'geseki:live-qa:...'. Ini memisahkannya dari widget lain di origin yang sama
   (dynamic-island-alert), yang dulu memakai kunci bersama `geseki-scene-<nama>`
   sehingga profil kedua widget saling menimpa. */
/* Akar folder widget, dihitung dari src script ini sendiri. Dipakai untuk
   menunjuk aset yang tidak bergantung pada halaman mana yang memuatnya
   (index.html di root vs obs/index.html satu level di bawah). */
const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
const WIDGET_ROOT = SCRIPT_SRC
	? SCRIPT_SRC.replace(/[^/]*$/, '')
	: new URL('./', window.location.href).href;
const SAMPLE_AVATAR = new URL('../resources/sekisungkarak_avatar.jpeg', WIDGET_ROOT).href;

/* Pertanyaan SAMPLE (tombol Sample) TIDAK boleh ikut arsip maupun Export CSV.
   Dikenali dari dua tanda, supaya sample lama — yang tersimpan sebelum ada
   penanda `sample` — tetap tertangkap:
     1. penanda `sample: true` (sample baru), atau
     2. avatar sample (nama berkasnya khas milik widget ini).
   Avatar chat TikTok asli selalu berasal dari tiktokcdn, jadi tidak bentrok. */
function IsSampleQuestion(q) {
	if (!q) return false;
	if (q.sample === true) return true;
	return /sekisungkarak_avatar\.jpe?g/i.test(String(q.avatar || ''));
}

const WIDGET_NS = 'geseki:live-qa:';
const CHANNEL_NAME = WIDGET_NS + 'channel';
const SCENE_PREFIX = WIDGET_NS + 'scene-';

/* Profil scene: dashboard menyimpan satu set setting per scene OBS dengan
   kunci `geseki:live-qa:scene-<nama>`, dan tombol Save menempelkan
   `?profile=<scene>` ke URL source. Widget ini membacanya supaya tiap scene
   bisa punya tampilan sendiri — sama seperti dynamic-island-alert. */
function LoadSceneProfile(profileName) {
	if (!profileName) return {};
	try {
		const raw = localStorage.getItem(SCENE_PREFIX + profileName);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		const list = Array.isArray(parsed.settings) ? parsed.settings : [];
		const out = {};
		list.forEach(function (pair) {
			if (Array.isArray(pair) && pair.length === 2) out[pair[0]] = pair[1];
		});
		return out;
	} catch (e) {
		return {};
	}
}

/* Kalau URL tidak membawa ?profile=, pakai profil aktif yang dicatat panel
   (`geseki:live-qa:controls:active`), lalu jatuh ke scene terakhir yang
   dibuka. Panel overlay widget ini belum menulis profil, jadi biasanya kosong;
   jalur utamanya tetap `?profile=` dari dashboard. */
function ActiveProfileName() {
	try {
		const direct = localStorage.getItem(WIDGET_NS + 'controls:active');
		if (direct) return direct;
	} catch (e) { /* abaikan */ }
	return '';
}

const profileName = urlParams.get('profile') || ActiveProfileName();
const profile = LoadSceneProfile(profileName);

/* GetParam: query string dulu, lalu profil scene, lalu bawaan. */
function GetParam(name, fallback) {
	if (urlParams.has(name)) return urlParams.get(name);
	if (Object.prototype.hasOwnProperty.call(profile, name)) {
		const v = profile[name];
		return v === null || v === undefined ? fallback : String(v);
	}
	return fallback;
}

function GetBoolParam(name, fallback) {
	if (urlParams.has(name)) {
		const v = (urlParams.get(name) || '').toLowerCase();
		return v === 'true' || v === '1' || v === 'yes' || v === 'on';
	}
	if (Object.prototype.hasOwnProperty.call(profile, name)) {
		const v = profile[name];
		if (typeof v === 'boolean') return v;
		const s = String(v).toLowerCase();
		return s === 'true' || s === '1' || s === 'yes' || s === 'on';
	}
	return fallback;
}

function GetIntParam(name, fallback) {
	const raw = GetParam(name, null);
	if (raw === null) return fallback;
	const n = parseInt(raw, 10);
	return isNaN(n) ? fallback : n;
}

// ── Pengaturan ───────────────────────────────────────────────────────────────

const bridgeHost = GetParam('bridgeHost', '127.0.0.1');
const bridgePort = GetIntParam('bridgePort', 47800);
// Resolved once at startup by ResolveBridgePort(); discovery may move it
// to whatever port the plugin is actually listening on.
let BRIDGE_WS_URL = 'ws://' + bridgeHost + ':' + bridgePort + '/ws';

/* Tiket: syarat untuk boleh bertanya, dipilih di dashboard sebagai SATU ATAU
   LEBIH kategori (boleh kosong = siapa saja boleh). Penonton lolos bila
   memenuhi SALAH SATU kondisi (OR). Gift & Likes butuh AKSI (kirim gift /
   kirim like) untuk dapat tiket; Follower, Fan Club, Subscriber, dan Superfan
   lolos bila statusnya aktif saat mengetik prefix. */
const TICKET_CONDITIONS = ['gift', 'follower', 'likes', 'fanclub', 'subscriber', 'superfan'];
/* Nilai datang sebagai array (profil scene) atau string berkoma (URL). */
function ParseConditionList(raw) {
	if (Array.isArray(raw)) raw = raw.join(',');
	return String(raw ?? '').split(',').map(function (v) { return v.trim().toLowerCase(); })
		.filter(function (v) { return TICKET_CONDITIONS.indexOf(v) !== -1; });
}
const ticketConditions = ParseConditionList(GetParam('ticketCondition', ''));
const ticketHasGift = ticketConditions.indexOf('gift') !== -1;
const ticketHasLikes = ticketConditions.indexOf('likes') !== -1;
/* Syarat berbasis STATUS (bukan aksi). */
const ticketStatusConditions = ticketConditions.filter(function (c) {
	return c !== 'gift' && c !== 'likes';
});
/* Cara menggabungkan beberapa kondisi: 'all' = AND (harus memenuhi semua),
   selain itu 'any' = OR (cukup salah satu). */
const ticketMatchAll = String(GetParam('ticketMatch', 'any')).trim().toLowerCase() === 'all';

/* Gift: SATU gift dipilih lewat dropdown dan disimpan sebagai ID numerik —
   nama gift dilokalisasi TikTok (Galaxy -> Galaksi), jadi ID adalah
   satu-satunya kunci yang stabil lintas bahasa dan region. */
const ticketGiftId = String(GetParam('ticketGiftId', '')).trim();
/* Likes: jumlah like yang harus dikirim untuk mendapat satu tiket. */
const ticketLikeCount = Math.max(1, GetIntParam('ticketLikeCount', 30));
/* Syarat aktif? (dipakai Queue page & teks hint). */
const ticketRequired = ticketConditions.length > 0;

const questionPrefix = String(GetParam('questionPrefix', '!q')).trim();
/* Panjang minimum pertanyaan tetap (dulu bisa diatur di dashboard). */
const MIN_QUESTION_LENGTH = 3;
/* Batas antrean: mencegah daftar Queue page tumbuh tanpa henti pada live
   yang sangat ramai. Yang tertua dibuang lebih dulu, kecuali yang sedang
   tampil di overlay. */
const MAX_QUEUE = 100;

const showAvatar = GetBoolParam('showAvatar', true);
const showTicketHint = GetBoolParam('showTicketHint', true);
const ticketHintText = GetParam('ticketHintText', 'Send {gift}, then type {prefix} your question');

// ── Design (grup "Design" di dashboard) ──────────────────────────────────────
// Semua nilai masuk sebagai custom property CSS; style.css hanya menyediakan
// nilai bawaan. Opsi mengikuti Better Alerts (kecuali Duration).
const design = {
	font: GetParam('designFont', 'Archivo'),
	showTitle: GetBoolParam('showTitle', true),
	nameSize: GetIntParam('designNameSize', 22),
	textSize: GetIntParam('designTextSize', 20),
	colorName: GetParam('designColorName', '#d4a843'),
	colorText: GetParam('designColorText', '#f1eef5'),
	colorHint: GetParam('designColorHint', '#a8a3b0'),
	highlightOn: GetBoolParam('designHighlightOn', true),
	highlight: GetParam('designHighlight', '#d4a843'),
	align: GetParam('designAlign', 'left'),
	weight: GetIntParam('designWeight', 500),
	lineGap: GetIntParam('designLineGap', 4),
	hlAnim: GetParam('designHlAnim', 'none'),
	outline: parseFloat(GetParam('designOutline', '0')) || 0,
	outlineColor: GetParam('designOutlineColor', '#000000'),
	shadow: GetBoolParam('designShadow', true),
	card: GetParam('designCard', 'solid'),
	cardColor: GetParam('designCardColor', '#201e28'),
	cardOpacity: GetIntParam('designCardOpacity', 100),
	cardRadius: GetIntParam('designCardRadius', 16),
	// Isi latar khusus style Outline (toggle + warna + opacity).
	outlineFill: GetBoolParam('designOutlineFill', false),
	outlineFillColor: GetParam('designOutlineFillColor', '#201e28'),
	outlineFillOpacity: GetIntParam('designOutlineFillOpacity', 100),
	// Desain "embed": kartu konten di dalam panel (stripe aksen + latar).
	embed: GetBoolParam('designEmbed', true),
	embedColor: GetParam('designEmbedColor', '#ffffff'),
	embedOpacity: GetIntParam('designEmbedOpacity', 5),
	contentRadius: GetIntParam('designContentRadius', 12),
	animIn: GetParam('designAnimIn', 'up'),
	animOut: GetParam('designAnimOut', 'fade'),
	inMs: GetIntParam('designInMs', 500),
	outMs: GetIntParam('designOutMs', 500)
};

/* #rrggbb + opacity persen -> rgba(). Nilai aneh jatuh ke warna bawaan. */
function HexToRgba(hex, opacityPct) {
	let h = String(hex || '').replace('#', '').trim();
	if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
	if (h.length !== 6) h = '201e28';
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	let a = Number(opacityPct);
	if (isNaN(a)) a = 100;
	a = Math.max(0, Math.min(100, a)) / 100;
	return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

/* Muat font dari Google Fonts (sama seperti Dynamic Island Alert). Tanpa ini
   nama font tidak pernah terpasang di OBS, jadi pilihan Font dan Weight tidak
   terlihat berubah. */
function LoadDesignFont(name) {
	const clean = String(name || '').trim();
	if (!clean) return;
	// Font sistem tidak perlu diunduh; biarkan fallback browser yang menangani.
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = 'https://fonts.googleapis.com/css2?family=' +
		encodeURIComponent(clean).replace(/%20/g, '+') +
		':wght@400;500;600;700;800;900&display=swap';
	document.head.appendChild(link);
}

/* Pasang grup Design ke CSS. Outline "relatif" Better Alerts adalah fraksi
   dari ukuran huruf, jadi dikali ukuran teks pertanyaan yang sedang dipakai. */
function ApplyDesign() {
	const root = document.documentElement;
	root.style.setProperty('--qa-font', design.font
		? '"' + design.font + '", "Archivo", "Segoe UI", system-ui, sans-serif'
		: '"Archivo", "Segoe UI", system-ui, sans-serif');
	root.style.setProperty('--qa-name-size', design.nameSize + 'px');
	root.style.setProperty('--qa-text-size', design.textSize + 'px');
	root.style.setProperty('--qa-name-color', design.colorName);
	root.style.setProperty('--qa-text-color', design.colorText);
	root.style.setProperty('--qa-hint-color', design.colorHint);
	root.style.setProperty('--qa-hl', design.highlight);
	root.style.setProperty('--qa-align', design.align);
	root.style.setProperty('--qa-weight', String(design.weight));
	root.style.setProperty('--qa-gap', design.lineGap + 'px');
	root.style.setProperty('--qa-outline-color', design.outlineColor);
	root.style.setProperty('--qa-outline-px', design.outline > 0 ? (design.outline * design.textSize).toFixed(2) + 'px' : '0px');
	root.style.setProperty('--qa-shadow', design.shadow ? '0 2px 6px rgba(0, 0, 0, 0.6)' : 'none');
	root.style.setProperty('--qa-card-radius', design.cardRadius + 'px');
	root.style.setProperty('--qa-card-bg', HexToRgba(design.cardColor, design.cardOpacity));
	// Style Outline: latar transparan kecuali Fill diaktifkan.
	root.style.setProperty('--qa-outline-fill',
		design.outlineFill ? HexToRgba(design.outlineFillColor, design.outlineFillOpacity) : 'transparent');
	// Latar konten: selalu dari Content Colour + Content Opacity (independen
	// dari switch Embed). Switch Embed hanya mengatur desain embed-nya.
	root.style.setProperty('--qa-content-bg', HexToRgba(design.embedColor, design.embedOpacity));
	// Radius kartu konten (terpisah dari radius panel background).
	root.style.setProperty('--qa-content-radius', design.contentRadius + 'px');

	const header = document.getElementById('qaHeader');
	if (header) header.classList.toggle('hidden', !design.showTitle);
	qaPanel.classList.remove('card-none', 'card-outline');
	if (design.card === 'none') qaPanel.classList.add('card-none');
	else if (design.card === 'outline') qaPanel.classList.add('card-outline');
	// Embed off -> sembunyikan stripe aksen kartu konten.
	qaPanel.classList.toggle('no-embed', !design.embed);
}

// ── Elemen ───────────────────────────────────────────────────────────────────

const qaPanel = document.getElementById('qaPanel');
const qaCard = document.getElementById('qaCard');
const qaHint = document.getElementById('qaHint');

// ── Layout (geser / skala / rotasi) dari panel overlay ──────────────────────
// Bukan bagian dari settings.json, jadi disimpan di kunci sendiri oleh panel.
// Nilainya MENANG atas profil dan URL: panel di overlay adalah aksi terakhir
// pengguna, sama seperti preferensi panel di dynamic-island-alert.
const LAYOUT_MIN_SCALE = 0.5;
const LAYOUT_MAX_SCALE = 2.0;
// Skala bawaan widget overlay — sengaja sedikit di bawah 1 supaya tidak
// terlalu besar di canvas. Bisa diubah lewat handle sudut di mode Layout.
const LAYOUT_DEFAULT_SCALE = 0.8;
/* Bentuk widget (geser / ukuran / skala / rotasi) disimpan PER SCENE, sama
   seperti profil settings scene: satu scene = satu kunci `layout:<scene>`.
   Dulu kuncinya GLOBAL, sehingga mengatur bentuk di scene "Live" ikut
   mengubah scene lain — sekarang tiap scene mandiri.

   Kunci ini SENGAJA terpisah dari profil settings: Reset dan Save di
   dashboard hanya menyentuh `live-qa-settings` dan
   `geseki:live-qa:scene-<scene>`, jadi bentuk pilihan pengguna tidak pernah
   ikut tereset. */
const LAYOUT_SLOT = profileName || '_default';
const LAYOUT_KEY = WIDGET_NS + 'layout:' + LAYOUT_SLOT;

/* Kunci LAMA (global, sebelum per-scene). Dibaca sebagai cadangan lalu disalin
   ke slot scene yang memuatnya, supaya bentuk yang sudah disetel tidak hilang
   setelah pembaruan ini. Tidak dihapus: scene baru tetap mewarisi bentuk
   terakhir pengguna, lalu boleh menyimpang sendiri. */
const LAYOUT_LEGACY_KEYS = {
	x: WIDGET_NS + 'layout-x',
	y: WIDGET_NS + 'layout-y',
	scale: WIDGET_NS + 'layout-scale',
	rotation: WIDGET_NS + 'layout-rotation',
	width: WIDGET_NS + 'layout-width',
	height: WIDGET_NS + 'layout-height'
};

function ReadLayoutNumber(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null || raw === '') return fallback;
		const n = Number(raw);
		return isFinite(n) ? n : fallback;
	} catch (e) {
		return fallback;
	}
}

function ClampLayoutScale(v) {
	if (!isFinite(v)) return 1;
	return Math.min(LAYOUT_MAX_SCALE, Math.max(LAYOUT_MIN_SCALE, Math.round(v * 100) / 100));
}

function ClampLayoutRotation(v) {
	if (!isFinite(v)) return 0;
	let r = v % 360;
	if (r > 180) r -= 360;
	if (r <= -180) r += 360;
	return Math.round(r);
}

/* Angka dari nilai apa pun; bukan angka -> fallback. */
function NumOr(v, fallback) {
	const n = Number(v);
	return isFinite(n) ? n : fallback;
}

/* Baca bentuk scene ini. Urutan: kunci per-scene -> kunci GLOBAL lama (sekali,
   lalu disalin ke slot scene ini) -> bawaan. */
function ReadLayout() {
	let d = null;
	try {
		const raw = localStorage.getItem(LAYOUT_KEY);
		if (raw) d = JSON.parse(raw);
	} catch (e) { d = null; }

	let usedLegacy = false;
	if (!d || typeof d !== 'object') {
		const legacy = {};
		let any = false;
		Object.keys(LAYOUT_LEGACY_KEYS).forEach(function (k) {
			const v = ReadLayoutNumber(LAYOUT_LEGACY_KEYS[k], null);
			if (v !== null) { legacy[k] = v; any = true; }
		});
		d = any ? legacy : {};
		usedLegacy = any;
	}

	const st = {
		x: Math.round(NumOr(d.x, 0)),
		y: Math.round(NumOr(d.y, 0)),
		scale: ClampLayoutScale(NumOr(d.scale, LAYOUT_DEFAULT_SCALE)),
		rotation: ClampLayoutRotation(NumOr(d.rotation, 0)),
		width: Math.max(0, Math.round(NumOr(d.width, 0))),
		height: Math.max(0, Math.round(NumOr(d.height, 0)))
	};

	// Bentuk berasal dari kunci lama: simpan sebagai milik scene ini supaya
	// scene ini mandiri dan bentuk lama tidak hilang.
	if (usedLegacy) SaveLayout(st);
	return st;
}

/* Offset sebagai MARGIN dari jangkar CSS (TENGAH canvas), bukan left/top:
   mengubah posisi absolut merusak animasi panel. */
function ApplyLayoutToPanel(st) {
	qaPanel.style.marginLeft = st.x + 'px';
	qaPanel.style.marginTop = st.y + 'px';
	// Pusat ditahan oleh properti `translate` di .qa-panel (style.css);
	// transform di sini hanya skala + rotasi, jadi pusat tidak ikut bergeser.
	qaPanel.style.transform = 'scale(' + st.scale + ') rotate(' + st.rotation + 'deg)';

	// Ukuran eksplisit (fitur resize). 0 = kembali ke lebar/tinggi CSS.
	if (st.width > 0) {
		qaPanel.style.width = st.width + 'px';
		// CSS memasang max-width: calc(100vw - 80px); batalkan saat di-resize
		// supaya lebar pilihan pengguna benar-benar dipakai.
		qaPanel.style.maxWidth = 'none';
	} else {
		qaPanel.style.removeProperty('width');
		qaPanel.style.removeProperty('max-width');
	}
	if (st.height > 0) qaPanel.style.height = st.height + 'px';
	else qaPanel.style.removeProperty('height');
}

/* Simpan bentuk scene ini (satu kunci JSON per scene). */
function SaveLayout(st) {
	try {
		localStorage.setItem(LAYOUT_KEY, JSON.stringify({
			x: st.x, y: st.y, scale: st.scale, rotation: st.rotation,
			width: st.width, height: st.height
		}));
	} catch (e) { /* abaikan */ }
}

// Dipakai panel overlay: baca nilai awal, dan simpan hasil geser/skala/rotasi.
window.GesekiQaLayout = {
	get: ReadLayout,
	set: function (st) {
		const clean = {
			x: Math.round(Number(st.x) || 0),
			y: Math.round(Number(st.y) || 0),
			scale: ClampLayoutScale(Number(st.scale)),
			rotation: ClampLayoutRotation(Number(st.rotation)),
			width: Math.max(0, Math.round(Number(st.width) || 0)),
			height: Math.max(0, Math.round(Number(st.height) || 0))
		};
		SaveLayout(clean);
		ApplyLayoutToPanel(clean);
		return clean;
	}
};

ApplyLayoutToPanel(ReadLayout());

//////////////////
// TICKET STORE //
//////////////////

/* Tiket hasil AKSI (gift / likes): per user, berisi AKSI mana yang sudah
   dipenuhi. Dipisah supaya mode AND bisa menuntut gift DAN likes sekaligus;
   tiket hangus begitu pertanyaan terkirim. */
const ticketHolders = new Map();

function AddActionTicket(key, action) {
	if (!key) return;
	let set = ticketHolders.get(key);
	if (!set) { set = new Set(); ticketHolders.set(key, set); }
	set.add(action);
}

/* Aksi yang diminta user ini, sesuai mode: 'all' = harus punya SEMUA,
   'any' = cukup punya salah satu. Mengembalikan true bila lolos. */
function HasActionTickets(key, actions, modeAll) {
	if (!key || actions.length === 0) return false;
	const set = ticketHolders.get(key);
	if (!set) return false;
	return modeAll
		? actions.every(function (a) { return set.has(a); })
		: actions.some(function (a) { return set.has(a); });
}

/* Akumulasi like per user menuju ticketLikeCount (syarat "Likes"). */
const likeProgress = new Map();

/* Superfan yang pernah terlihat di sesi ini. Payload TikTok tidak membawa
   tanda superfan per-chat, jadi statusnya diingat dari event superFan/
   superFanJoin lalu dipakai saat penonton mengetik prefix. */
const superFanHolders = new Set();

/* Warna badge fan club: OREN = masih member aktif, ABU = keanggotaan dorman
   (TikTok meng-abu-kan badge dan membekukan hak setelah 7 hari tanpa poin).
   Warna dikirim sebagai #AARRGGBB atau rgba(); warna tanpa rona (selisih
   channel nyaris nol) dianggap abu. Warna kosong -> bukan abu, supaya sumber
   yang tidak mengirim warna tidak membuang member asli. Sama seperti DIA. */
function BadgeColorIsGrey(raw) {
	const s = String(raw == null ? '' : raw).trim();
	if (!s) return false;
	let r, g, b;
	const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
	if (m) {
		r = Number(m[1]); g = Number(m[2]); b = Number(m[3]);
	} else {
		const h = s.replace(/^#/, '');
		if (/^[0-9a-f]{8}$/i.test(h)) {
			r = parseInt(h.slice(2, 4), 16); g = parseInt(h.slice(4, 6), 16); b = parseInt(h.slice(6, 8), 16);
		} else if (/^[0-9a-f]{6}$/i.test(h)) {
			r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
		} else {
			return false;
		}
	}
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	return (max - min) < 24;
}

/* Keaktifan fan club. Geseki Bridge mengirim `fanClubActive` dari proto
   TikTok (userFansClubStatus / isSleeping); sumber tanpa field itu mengandalkan
   warna badge. `false` eksplisit selalu menang. Sama seperti DIA. */
function FanClubIsActive(data, color) {
	const user = (data && data.user) || {};
	const explicit = data && data.fanClubActive !== undefined
		? data.fanClubActive
		: user.fanClubActive;
	if (explicit === false) return false;
	return !BadgeColorIsGrey(color);
}

/* Cek apakah sebuah gift adalah gift tiket yang dipilih. Pencocokan HANYA
   lewat ID: nama gift berbeda-beda per bahasa dan region. */
function IsTicketGift(data) {
	const id = data.giftId === undefined || data.giftId === null ? '' : String(data.giftId).trim();
	return id !== '' && id === ticketGiftId;
}

/* Peran user dari payload TikTok, untuk syarat berbasis STATUS (follower,
   fan club, subscriber, superfan) yang dievaluasi saat chat masuk. */
function UserPermissionFlags(data) {
	const flags = { follower: false, fanclub: false, subscriber: false, superfan: false };
	if (!data) return flags;
	const user = data.user || {};

	/* Fan club dideteksi dari BADGE-nya, sama seperti DIA: TikFinity menandainya
	   badgeSceneType 10, Geseki Bridge mengisi scene itu dari artwork badge
	   (fans_badge_icon), jadi kedua sumber mengirim bentuk yang sama. Nama
	   berkas dicek juga sebagai jaring pengaman bila scene tidak diisi.
	   Badge ABU (dorman) TIDAK dihitung. */
	const badges = data.userBadges || user.userBadges || [];
	let fanBadgeGrey = false;
	if (Array.isArray(badges)) {
		for (const b of badges) {
			if (!b) continue;
			const st = Number(b.badgeSceneType !== undefined ? b.badgeSceneType : b.sceneType);
			const url = String(b.image || b.imageUrl || b.url || '');
			if (st === 4) flags.subscriber = true;
			const isFanBadge = st === 10 || url.indexOf('fans_badge_icon') !== -1;
			if (isFanBadge) {
				if (FanClubIsActive(data, b.color)) flags.fanclub = true;
				else fanBadgeGrey = true;
			}
		}
	}

	const identity = data.userIdentity || user.userIdentity || {};
	const followRole = Number(data.followRole !== undefined ? data.followRole : user.followRole);
	flags.follower = (isFinite(followRole) && followRole >= 1)
		|| !!data.isFollower || !!identity.isFollowerOfAnchor || !!identity.isFollower;
	flags.subscriber = flags.subscriber || !!data.isSubscriber
		|| !!identity.isSubscriberOfAnchor || !!identity.isSubscriber;

	/* Jalur tanpa warna badge (bridge mengirim fanClubBadge + fanClubActive):
	   pakai sinyal keanggotaan, tapi jangan menyalakan kembali badge yang abu. */
	const clubSignal = !!(data.fanClubBadge || data.fansClub || data.fansClubInfo
		|| user.fanClubBadge || user.fansClub || user.fansClubInfo);
	if (!FanClubIsActive(data, null)) {
		flags.fanclub = false;
	} else if (!fanBadgeGrey && clubSignal) {
		flags.fanclub = true;
	}

	flags.superfan = superFanHolders.has(UserKey(data));
	return flags;
}

/* Apakah penonton memenuhi syarat berbasis status SAAT INI. */
function HasRequiredStatus(data, condition) {
	return UserPermissionFlags(data)[condition] === true;
}

/* Log id+nama setiap gift. Dropdown di dashboard sudah menampilkan id, tapi
   log ini tetap berguna untuk mencocokkan gift yang benar-benar masuk. */
function LogGift(data) {
	const id = data.giftId === undefined || data.giftId === null ? '(none)' : data.giftId;
	const name = data.giftName || '(unnamed)';
	const user = data.nickname || data.uniqueId || '?';
	console.log('[Geseki][Live Q&A] gift id=' + id + ' name="' + name + '" from=' + user);
}

function UserKey(data) {
	const id = data.userId;
	if (id === undefined || id === null || id === '') {
		return String(data.uniqueId || data.nickname || '');
	}
	return String(id);
}

////////////////////
// QUESTION QUEUE //
////////////////////

/* Antrean pertanyaan: { id, name, avatar, text, shown, at }.
   `shown` menandai sudah pernah tampil (badge di Queue page) — barisnya
   TETAP di daftar supaya streamer bisa menampilkannya lagi. */
const questions = [];
/* Arsip pertanyaan yang pernah masuk, dipakai tombol Export CSV di halaman
   Queue supaya riwayat tanya-jawab bisa diunduh (mis. dibuka lagi di Excel).
   Entri tetap disimpan walau dihapus atau di-Clear dari antrean.

   Retensi: hanya 7 HARI TERAKHIR — entri lebih tua dibuang otomatis. Selain
   itu ada batas aman JUMLAH entri: localStorage cuma ~5 MB dan kegagalan
   simpan ditelan diam-diam, jadi seminggu stream ramai bisa membuat arsip
   berhenti tersimpan tanpa peringatan. Batas ini menjaga itu, dan hanya
   menyisakan entri terbaru. */
const questionHistory = [];
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HISTORY = 3000;
/* Pertanyaan yang sedang tayang di overlay SCENE INI. Ikut disimpan bersama
   antrean scene (kunci per scene), jadi pindah scene menampilkan On screen
   milik scene itu sendiri — bukan membawa pertanyaan dari scene sebelumnya. */
let currentId = null;
let questionSeq = 0;

/* Antrean disimpan PER SCENE, meniru Dynamic Island Alert: tiap scene punya
   daftar pertanyaannya sendiri. Nama scene datang dari `?profile=<scene>` yang
   ditempelkan dashboard ke URL tiap browser source, jadi scene "Gameplay" dan
   "Just Chatting" tidak saling menimpa.

   Kunci selalu PASTI: bila `?profile=` kosong (dibuka di browser biasa), dipakai
   sentinel `_default` — bukan kunci bersama tanpa sufiks. Dulu kunci tanpa
   sufiks itu terbagi semua instance sehingga dua source bisa saling menimpa;
   sekarang tiap scene punya kuncinya sendiri, kosong atau tidak. Data lama di
   kunci bersama dimigrasikan sekali ke `_default` supaya tidak hilang. */
const PROFILE_SLOT = profileName || '_default';
const QUEUE_KEY = WIDGET_NS + 'queue:' + PROFILE_SLOT;
const HISTORY_KEY = WIDGET_NS + 'history:' + PROFILE_SLOT;

/* ── Auto export per sesi live ─────────────────────────────────────────
   Saat bridge melaporkan TikTok "connected" sesi live dimulai; begitu
   statusnya keluar dari connected, sesi berakhir dan (kalau dinyalakan)
   CSV pertanyaan sesi itu dikirim ke bridge -> folder Downloads.
   Disimpan per scene, sama seperti antrean, supaya tiap scene punya
   berkas sesinya sendiri. Sesi yang gagal terkirim disimpan sebagai
   pending dan dicoba lagi saat live berikutnya. */
const AUTOEXPORT_KEY = WIDGET_NS + 'autoexport';
const SESSION_KEY = WIDGET_NS + 'session:' + PROFILE_SLOT;
const SESSION_PENDING_KEY = WIDGET_NS + 'session-pending:' + PROFILE_SLOT;

/* Tombol Export di halaman Queue mengirim nilai ini lewat BroadcastChannel. */
function LoadAutoExport() {
	try { return localStorage.getItem(AUTOEXPORT_KEY) === '1'; }
	catch (e) { return false; }
}
let autoExportEnabled = LoadAutoExport();
/* Waktu mulai sesi live berjalan, atau null kalau tidak live. */
let sessionStartMs = null;

/* Migrasi sekali jalan: antrean lama tanpa sufiks dipindah ke `_default`
   (hanya berlaku untuk instance yang memang tanpa profil). */
(function MigrateQueueKeys() {
	if (profileName) return;
	try {
		const legacy = localStorage.getItem(WIDGET_NS + 'queue');
		if (legacy && !localStorage.getItem(QUEUE_KEY)) {
			localStorage.setItem(QUEUE_KEY, legacy);
		}
	} catch (e) { /* abaikan */ }
})();

function SaveQueue() {
	try {
		localStorage.setItem(QUEUE_KEY, JSON.stringify({
			questions: questions,
			currentId: currentId,
			questionSeq: questionSeq
		}));
	} catch (e) { /* abaikan */ }
}

function LoadQueue() {
	try {
		const raw = localStorage.getItem(QUEUE_KEY);
		if (!raw) return;
		const d = JSON.parse(raw);
		if (Array.isArray(d.questions)) {
			questions.length = 0;
			d.questions.forEach(function (q) { questions.push(q); });
		}
		// Pulihkan pertanyaan yang sedang tayang di scene ini (bisa saja null).
		currentId = (d.currentId === undefined) ? null : d.currentId;
		const seq = Number(d.questionSeq);
		const fromIds = questions.reduce(function (m, q) {
			const n = parseInt(String(q.id).replace(/^q/, ''), 10);
			return isNaN(n) ? m : Math.max(m, n);
		}, 0);
		questionSeq = Math.max(isNaN(seq) ? 0 : seq, fromIds);
	} catch (e) { /* abaikan */ }
}

/* Buang arsip di luar jendela retensi (7 hari), lalu rapikan bila melewati
   batas aman jumlah. Kembalikan true bila ada yang dibuang supaya pemanggil
   bisa menyimpan hasilnya. Entri tanpa `at` dipertahankan (tidak bisa
   ditanggalkan), tetapi tetap ikut hitungan batas jumlah. */
function PruneHistory() {
	const cutoff = Date.now() - HISTORY_RETENTION_MS;
	const before = questionHistory.length;
	for (let i = questionHistory.length - 1; i >= 0; i--) {
		const at = questionHistory[i] && questionHistory[i].at;
		if (typeof at === 'number' && at < cutoff) questionHistory.splice(i, 1);
	}
	if (questionHistory.length > MAX_HISTORY) {
		questionHistory.splice(0, questionHistory.length - MAX_HISTORY);
	}
	return questionHistory.length !== before;
}

function SaveHistory() {
	try { localStorage.setItem(HISTORY_KEY, JSON.stringify(questionHistory)); }
	catch (e) { /* abaikan */ }
}

function LoadHistory() {
	try {
		const raw = localStorage.getItem(HISTORY_KEY);
		if (!raw) return;
		const d = JSON.parse(raw);
		if (Array.isArray(d)) {
			questionHistory.length = 0;
			// Sample lama (sebelum ada penanda) dibuang sekali di sini supaya
			// arsip yang tersimpan pun bersih, bukan cuma hasil CSV-nya.
			let dropped = false;
			d.forEach(function (q) {
				if (IsSampleQuestion(q)) { dropped = true; return; }
				questionHistory.push(q);
			});
			// Buang entri di luar jendela retensi 7 hari (dan rapikan kuota).
			if (PruneHistory()) dropped = true;
			if (dropped) SaveHistory();
		}
	} catch (e) { /* abaikan */ }
}

// ── Sesi live: deteksi + auto export ────────────────────────────────────

function LoadSession() {
	try {
		const raw = localStorage.getItem(SESSION_KEY);
		if (!raw) return;
		const ms = parseInt(raw, 10);
		// Sesi lebih tua dari 24 jam dianggap basi (OBS mati lama).
		if (isFinite(ms) && Date.now() - ms < 24 * 60 * 60 * 1000)
			sessionStartMs = ms;
		else
			localStorage.removeItem(SESSION_KEY);
	} catch (e) { /* abaikan */ }
}

function SaveSession() {
	try {
		if (sessionStartMs === null) localStorage.removeItem(SESSION_KEY);
		else localStorage.setItem(SESSION_KEY, String(sessionStartMs));
	} catch (e) { /* abaikan */ }
}

/* Satu sel CSV, mengikuti aturan kutip yang sama dengan halaman Queue. */
function CsvCell(v) {
	const t = (v === null || v === undefined) ? '' : String(v);
	return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

function FormatDateTime(ms) {
	try { return new Date(ms).toLocaleString(); } catch (e) { return ''; }
}

/* Pertanyaan sesi ini (arsip sejak sesi mulai), diurutkan waktu. */
function SessionRows(startMs) {
	return (questionHistory || [])
		.filter(function (q) {
			return q && typeof q.at === 'number' && q.at >= startMs && !IsSampleQuestion(q);
		})
		.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
}

function BuildSessionCsv(startMs) {
	const rows = SessionRows(startMs);
	const lines = ['Time,Name,Question,Status'];
	rows.forEach(function (q) {
		lines.push([
			CsvCell(FormatDateTime(q.at)),
			CsvCell(q.name),
			CsvCell(GesekiCsvText(q.text, q.emotes)),
			CsvCell(q.shown ? 'shown' : 'queued')
		].join(','));
	});
	return { csv: '\uFEFF' + lines.join('\r\n'), count: rows.length };
}

/* Stempel untuk nama berkas: YYYYMMDD-HHMMSS waktu lokal. */
function FileStamp(ms) {
	const d = new Date(ms);
	function p(n) { return (n < 10 ? '0' : '') + n; }
	return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
		d.getHours() + p(d.getMinutes()) + p(d.getSeconds());
}

/* Kirim CSV ke bridge (tulis ke folder Downloads). true kalau tersimpan. */
async function PostSessionCsv(csv, name) {
	try {
		const ctl = new AbortController();
		const t = setTimeout(function () { ctl.abort(); }, 5000);
		const r = await fetch('http://' + bridgeHost + ':47800/save?name=' + encodeURIComponent(name), {
			method: 'POST',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: csv,
			signal: ctl.signal
		});
		clearTimeout(t);
		if (!r.ok) return false;
		const d = await r.json();
		return !!(d && d.ok);
	} catch (e) {
		return false;
	}
}

/* Simpan sesi yang belum terkirim supaya dicoba lagi saat live berikutnya. */
function StashPending(startMs) {
	try {
		const raw = localStorage.getItem(SESSION_PENDING_KEY);
		const list = raw ? JSON.parse(raw) : [];
		const arr = Array.isArray(list) ? list : [];
		arr.push(startMs);
		localStorage.setItem(SESSION_PENDING_KEY, JSON.stringify(arr.slice(-20)));
	} catch (e) { /* abaikan */ }
}

function ReadPending() {
	try {
		const raw = localStorage.getItem(SESSION_PENDING_KEY);
		const list = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list : [];
	} catch (e) { return []; }
}

function ClearPending() {
	try { localStorage.removeItem(SESSION_PENDING_KEY); } catch (e) { /* abaikan */ }
}

/* Export sesi `startMs`. Hanya scene yang sedang tayang yang menulis, supaya
   satu sesi tidak menghasilkan berkas dari tiap source scene. */
async function ExportSession(startMs, endMs) {
	if (startMs === null || startMs === undefined) return;
	const built = BuildSessionCsv(startMs);
	const name = 'live-qa-questions-' + FileStamp(startMs) + '-' + FileStamp(endMs || Date.now()) + '.csv';
	const ok = await PostSessionCsv(built.csv, name);
	if (!ok) StashPending(startMs);
}

/* Coba kirim sesi-sesi yang tertunda (bridge tadinya mati). */
async function FlushPendingSessions() {
	const pending = ReadPending();
	if (!pending.length) return;
	const left = [];
	for (const startMs of pending) {
		const built = BuildSessionCsv(startMs);
		const name = 'live-qa-questions-' + FileStamp(startMs) + '-' + FileStamp(Date.now()) + '.csv';
		const ok = await PostSessionCsv(built.csv, name);
		if (!ok) left.push(startMs);
	}
	if (left.length) {
		try { localStorage.setItem(SESSION_PENDING_KEY, JSON.stringify(left)); } catch (e) { /* abaikan */ }
	} else {
		ClearPending();
	}
}

/* Transisi status TikTok dari bridge. state 'connected' = live berjalan. */
function ApplyTikTokState(state) {
	const wasLive = sessionStartMs !== null;
	const isLive = (state === 'connected');
	if (isLive && !wasLive) {
		sessionStartMs = Date.now();
		SaveSession();
		// Bridge hidup lagi: coba kirim sesi yang sempat tertunda.
		FlushPendingSessions();
	} else if (!isLive && wasLive) {
		const startMs = sessionStartMs;
		sessionStartMs = null;
		SaveSession();
		// Hanya scene yang SEDANG TAYANG yang menulis berkasnya.
		if (autoExportEnabled && activeState === true) {
			ExportSession(startMs, Date.now());
		}
	}
}

LoadSession();

function FindQuestion(id) {
	for (let i = 0; i < questions.length; i++) {
		if (questions[i].id === id) return questions[i];
	}
	return null;
}

/* Bangun satu kartu pertanyaan. Dipakai overlay (satu kartu) dan tidak
   dipakai ulang di tempat lain. */
function BuildCard(q) {
	const card = document.createElement('div');
	card.className = 'qa-item';

	if (showAvatar) {
		const img = document.createElement('img');
		img.className = 'qa-avatar';
		img.alt = '';
		img.src = q.avatar || '';
		// Avatar gagal dimuat (URL kedaluwarsa) -> sembunyikan, jangan
		// tampilkan kotak rusak.
		img.addEventListener('error', function () { img.style.display = 'none'; });
		card.appendChild(img);
	}

	const body = document.createElement('div');
	body.className = 'qa-body';

	const who = document.createElement('span');
	who.className = 'qa-name';
	who.textContent = q.name;
	if (design.highlightOn) {
		who.classList.add('is-highlight');
		if (design.hlAnim && design.hlAnim !== 'none') who.classList.add('hl-' + design.hlAnim);
	}

	const text = document.createElement('span');
	text.className = 'qa-text';
	// innerHTML: teks di-escape di dalam renderer, emote dari payload/shortcode
	// disisipkan sebagai <img class="emote">.
	text.innerHTML = RenderChatMessageHtml(q.text, q.emotes);

	body.appendChild(who);
	body.appendChild(text);
	card.appendChild(body);
	return card;
}

/* Mainkan animasi masuk/keluar pada panel. Nama animasi = nilai opsi
   (pop/fade/up/...), keyframes-nya ada di style.css. */
function PlayPanelAnim(kind, name, ms) {
	if (!name || name === 'none') {
		qaPanel.style.animation = '';
		return;
	}
	// Reset dulu supaya animasi yang sama bisa diputar ulang (ganti pertanyaan).
	qaPanel.style.animation = 'none';
	void qaPanel.offsetWidth;
	qaPanel.style.animation = 'qa-' + kind + '-' + name + ' ' + ms + 'ms ease both';
}

/* Overlay hanya menampilkan pertanyaan yang sedang dipilih. Tidak ada
   pertanyaan terpilih -> panel disembunyikan setelah animasi keluar. */
function RenderOverlay() {
	const q = currentId === null ? null : FindQuestion(currentId);

	if (!q) {
		if (qaPanel.classList.contains('is-empty')) return;
		// Tanpa animasi keluar: sembunyikan langsung (tidak ada animationend).
		if (!design.animOut || design.animOut === 'none') {
			qaPanel.style.animation = '';
			qaPanel.classList.add('is-empty');
			return;
		}
		PlayPanelAnim('out', design.animOut, design.outMs);
		const done = function () {
			qaPanel.style.animation = '';
			qaPanel.classList.add('is-empty');
			qaPanel.removeEventListener('animationend', done);
		};
		qaPanel.addEventListener('animationend', done);
		return;
	}

	qaCard.innerHTML = '';
	qaCard.appendChild(BuildCard(q));
	qaPanel.classList.remove('is-empty');
	PlayPanelAnim('in', design.animIn, design.inMs);
}

function RenderHint() {
	if (!showTicketHint) {
		qaHint.textContent = '';
		qaHint.classList.add('hidden');
		return;
	}

	if (ticketHasGift) {
		// Nama gift tidak ikut tersimpan (hanya ID yang stabil), jadi teks
		// bawaan memakai sebutan umum; streamer bebas mengubahnya.
		qaHint.textContent = ticketHintText
			.replaceAll('{gift}', 'the gift')
			.replaceAll('{prefix}', questionPrefix);
	} else if (ticketHasLikes) {
		qaHint.textContent = 'Send ' + ticketLikeCount + ' likes, then type ' + questionPrefix + ' to ask a question';
	} else {
		// Syarat berbasis status (atau tanpa syarat): cukup ketik prefix.
		qaHint.textContent = 'Type ' + questionPrefix + ' to ask a question';
	}
	qaHint.classList.remove('hidden');
}

/* Tambah pertanyaan ke antrean. TIDAK menampilkannya: overlay hanya berubah
   saat streamer memilih dari Queue page.

   skipHistory=true dipakai pertanyaan SAMPLE: masuk antrean seperti biasa,
   tetapi TIDAK ikut arsip, supaya Export CSV tetap berisi chat sungguhan. */
function AddQuestion(q, skipHistory) {
	questionSeq += 1;
	// Satu pintu masuk untuk semua teks dari pemirsa: bersihkan di sini supaya
	// antrean, overlay, arsip, dan Export CSV semuanya memakai teks yang sama.
	const item = {
		id: 'q' + questionSeq,
		name: SanitizeVisibleText(q.name),
		avatar: q.avatar,
		// Teks disimpan apa adanya (placeholder emote ikut): emote hanya bisa
		// digambar dari indeks placeholder-nya. Pembersihan karakter tak
		// terlihat dilakukan saat render (lihat emotes.js) dan saat CSV.
		text: String(q.text == null ? '' : q.text),
		emotes: Array.isArray(q.emotes) ? q.emotes : [],
		shown: false,
		at: Date.now(),
		// Penanda pertanyaan SAMPLE: tampil di antrean, tetapi disaring dari
		// arsip dan dari Export CSV supaya tidak mengotori data sungguhan.
		sample: skipHistory === true
	};
	questions.push(item);

	// Arsip: SEMUA pertanyaan yang pernah masuk ikut disimpan (untuk Export CSV).
	// Pertanyaan sample dikecualikan agar tidak mengotori arsip.
	if (!skipHistory) {
		questionHistory.push(item);
		PruneHistory();
		SaveHistory();
	}

	while (questions.length > MAX_QUEUE) {
		let idx = 0;
		// Jangan buang pertanyaan yang sedang tayang di overlay.
		while (idx < questions.length && questions[idx].id === currentId) idx += 1;
		if (idx >= questions.length) break;
		questions.splice(idx, 1);
	}

	SaveQueue();
	BroadcastState();
	return item;
}

// ── Perintah dari Queue page ───────────────────────────────────────────────

function ShowQuestion(id) {
	const q = FindQuestion(id);
	if (!q) return;
	currentId = id;
	q.shown = true;
	RenderOverlay();
	SaveQueue();
	BroadcastState();
}

function HideQuestion() {
	if (currentId === null) return;
	currentId = null;
	RenderOverlay();
	SaveQueue();
	BroadcastState();
}

function RemoveQuestion(id) {
	const idx = questions.findIndex(function (q) { return q.id === id; });
	if (idx < 0) return;
	questions.splice(idx, 1);
	if (currentId === id) currentId = null;
	RenderOverlay();
	SaveQueue();
	BroadcastState();
}

function ClearQuestions() {
	questions.length = 0;
	currentId = null;
	RenderOverlay();
	SaveQueue();
	BroadcastState();
}

function ClearTickets() {
	ticketHolders.clear();
	likeProgress.clear();
	BroadcastState();
}

/////////////////////////////
// EVENT TIKTOK DARI BRIDGE //
/////////////////////////////

function HandleGift(data) {
	LogGift(data);
	if (!ticketHasGift) return;
	if (!IsTicketGift(data)) return;
	const key = UserKey(data);
	if (!key) return;
	AddActionTicket(key, 'gift');
	BroadcastState();
}

/* Likes menumpuk menuju ticketLikeCount lalu memberi satu tiket. Nilai
   direset setelah tiket diberikan supaya jumlah berikutnya dihitung ulang. */
function HandleLike(data) {
	if (!ticketHasLikes) return;
	const key = UserKey(data);
	if (!key) return;
	const add = Math.max(0, Number(data.likeCount) || 0);
	if (!add) return;
	const total = (likeProgress.get(key) || 0) + add;
	if (total >= ticketLikeCount) {
		likeProgress.delete(key);
		AddActionTicket(key, 'likes');
	} else {
		likeProgress.set(key, total);
	}
	BroadcastState();
}

/* Follow / subscribe / superfan tidak memberi tiket langsung: statusnya
   dievaluasi saat chat masuk. Namun Superfan TIDAK ikut terkirim di payload
   chat, jadi event superfan dicatat di sini agar chat berikutnya mengenali. */
function HandleStatusEvent(event, data) {
	if (event === 'superFan' || event === 'superFanJoin' || event === 'superFanBox') {
		const key = UserKey(data);
		if (key && !superFanHolders.has(key)) {
			superFanHolders.add(key);
			BroadcastState();
		}
	}
}

/* Chat yang diawali prefix masuk antrean. Bila ada syarat tiket, penanya
   WAJIB memenuhi SALAH SATU kondisi (OR): AKSI (gift / likes) lewat
   ticketHolders — tiket habis sekali pakai; STATUS (follower, fan club,
   subscriber, superfan) dicek pada payload chat dan tidak dikonsumsi. */
function HandleChat(data) {
	// Komentar mentah: placeholder emote (bila ada) masih di dalamnya, dan
	// placeInComment menunjuk indeks di string INI. Prefix dibuang SETELAH
	// offset dihitung, supaya indeks emote bisa digeser dengan benar.
	const raw = String(data.comment || '');
	if (!raw) return;
	const lead = raw.length - raw.replace(/^\s+/, '').length;
	const afterLead = raw.slice(lead);
	if (!afterLead.startsWith(questionPrefix)) return;

	if (ticketRequired) {
		const key = UserKey(data);
		// Syarat AKSI yang dipilih (gift/likes) harus terpenuhi, mengikuti mode.
		const actionConds = ticketConditions.filter(function (c) {
			return c === 'gift' || c === 'likes';
		});
		const hasTicket = HasActionTickets(key, actionConds, ticketMatchAll);
		const hasStatus = ticketStatusConditions.some(function (c) {
			return HasRequiredStatus(data, c);
		});
		let passes;
		if (ticketMatchAll) {
			// AND: tiap kelompok yang dipilih harus terpenuhi.
			const actionOk = actionConds.length === 0 || hasTicket;
			const statusOk = ticketStatusConditions.length === 0
				|| ticketStatusConditions.every(function (c) { return HasRequiredStatus(data, c); });
			passes = actionOk && statusOk;
		} else {
			// OR: cukup salah satu (aksi atau status).
			passes = hasTicket || hasStatus;
		}
		if (!passes) return;
		// Tiket aksi terpakai begitu dipakai untuk lolos.
		if (key && ticketHolders.has(key)) ticketHolders.delete(key);
	}

	const rest = afterLead.slice(questionPrefix.length);
	const restLead = rest.length - rest.replace(/^\s+/, '').length;
	const text = rest.replace(/^\s+/, '').replace(/\s+$/, '');
	if (text.length < MIN_QUESTION_LENGTH) return;

	// Geser indeks emote dari komentar asli ke teks yang sudah dipotong prefix.
	const startOffset = lead + questionPrefix.length + restLead;
	const emotes = GesekiRebaseEmotes(data.emotes, startOffset, text);

	AddQuestion({
		name: data.nickname || data.uniqueId || 'Viewer',
		avatar: data.profilePictureUrl || '',
		text: text,
		emotes: emotes
	});
}

function HandleTikTokEvent(event, data) {
	if (!data || typeof data !== 'object') return;
	// SETIAP source memproses chat: source yang tidak di scene aktif tetap
	// hidup di belakang layar dan mengisi antrean scene-nya sendiri. Tidak ada
	// penggandaan karena tiap source memelihara daftar scene-nya masing-masing.
	switch (event) {
		case 'gift':
			HandleGift(data);
			break;
		case 'like':
			HandleLike(data);
			break;
		case 'superFan':
		case 'superFanJoin':
		case 'superFanBox':
			HandleStatusEvent(event, data);
			break;
		case 'chat':
			HandleChat(data);
			break;
		default:
			break;
	}
}

///////////////////////
// KONEKSI KE BRIDGE //
///////////////////////

let bridgeWebsocket = null;
let bridgeConnected = false;

// Port discovery: ask the fixed discovery port which port the bridge's
// WebSocket is on, so a port change in the plugin needs no edit here. Silent
// fallback to the configured port when discovery is unreachable (older bridge,
// or the discovery port is taken).
async function ResolveBridgePort(fallbackPort) {
	try {
		const ctl = new AbortController();
		const t = setTimeout(() => ctl.abort(), 1500);
		const r = await fetch(`http://${bridgeHost}:47800/bridge-port`, { signal: ctl.signal });
		clearTimeout(t);
		if (!r.ok) return fallbackPort;
		const d = await r.json();
		const p = Number(d && d.wsPort);
		if (Number.isInteger(p) && p > 0 && p <= 65535) {
			if (p !== fallbackPort) console.debug(`[Geseki][Bridge] discovery: ws port ${p}`);
			return p;
		}
	} catch (e) { /* discovery tidak tersedia: pakai port dari URL */ }
	return fallbackPort;
}

async function bridgeConnection() {
	// Discovery first: the plugin may be listening on another port.
	BRIDGE_WS_URL = 'ws://' + bridgeHost + ':' + await ResolveBridgePort(bridgePort) + '/ws';

	const reconnectDelay = 10000;
	let errorLogged = false;

	function connect() {
		try {
			bridgeWebsocket = new WebSocket(BRIDGE_WS_URL);
		} catch (err) {
			if (!errorLogged) {
				console.debug('[Geseki][Live Q&A][Bridge] Connection error:', err);
				errorLogged = true;
			}
			setTimeout(connect, reconnectDelay);
			return null;
		}

		bridgeWebsocket.onopen = function () {
			console.debug('[Geseki][Live Q&A][Bridge] Connected to ' + BRIDGE_WS_URL);
			errorLogged = false;
			bridgeConnected = true;
			BroadcastState();
		};

		bridgeWebsocket.onmessage = function (response) {
			let data;
			try {
				data = JSON.parse(response.data);
			} catch (e) {
				return;
			}
			if (!data || typeof data !== 'object') return;

			if (data.type === 'tiktok') {
				HandleTikTokEvent(data.event, data.data);
			} else if (data.type === 'status') {
				// Deteksi sesi live untuk auto export.
				if (data.tiktok && typeof data.tiktok.state === 'string')
					ApplyTikTokState(data.tiktok.state);
			}
			// hello / pong / tipe masa depan: diabaikan (protokol aditif).
		};

		bridgeWebsocket.onclose = function () {
			bridgeConnected = false;
			BroadcastState();
			setTimeout(connect, reconnectDelay);
		};

		bridgeWebsocket.onerror = function () {
			if (bridgeWebsocket && bridgeWebsocket.readyState !== WebSocket.CLOSED) {
				bridgeWebsocket.close();
			}
		};

		return bridgeWebsocket;
	}

	return connect();
}

///////////////////////////////////
// KANAL KE CONTROL PAGE/DASHBOARD //
///////////////////////////////////

/* Satu BroadcastChannel untuk dua arah: Queue page mengirim perintah ke sini,
   widget menyiarkan keadaannya balik supaya daftar di Queue page sinkron. */
let channel = null;

function PostToChannel(msg) {
	if (!channel) return;
	try { channel.postMessage(msg); } catch (e) { /* abaikan */ }
}

/* Id instance: widget ini bisa hidup di beberapa tempat sekaligus (browser
   source OBS, tab browser, pratinjau). Tiap instance punya daftar sendiri,
   jadi Queue page perlu tahu dari instance mana sebuah qa_state datang —
   tanpa itu daftarnya bergantian antara dua daftar yang berbeda. */
const INSTANCE_ID = 'w' + Math.random().toString(36).slice(2, 10);

/* Status "source ini ada di scene yang sedang tayang", dari obs-browser.
   Dipakai HANYA untuk menandai state mana yang ditampilkan halaman Queue —
   bukan lagi untuk memilih satu pemimpin. SEMUA source tetap aktif di
   belakang layar dan mengisi antrean scene-nya masing-masing:
     true  -> diketahui ada di scene yang sedang tayang
     false -> diketahui TIDAK tayang (scene lain / auto-sleep)
     null  -> belum tahu (browser biasa, atau OBS belum mengirim event) */
let activeState = null;

// ── Status aktif dari obs-browser ───────────────────────────────────────
// 'active' = source ada di scene yang SEDANG TAYANG (bukan sekadar tampil di
// preview Studio Mode). Dipakai HANYA menandai scene mana yang ditampilkan
// halaman Queue; semua source tetap memproses chat.
//
// Dua jalur, karena jalur event saja tidak cukup:
//   1. 'obsSceneChanged' — obs-browser menyiarkannya ke SEMUA browser source,
//      membawa NAMA scene program, dan TIDAK butuh izin. Nama itu dibandingkan
//      dengan scene milik source ini (?profile=<scene>). Ini yang membuat
//      halaman Queue langsung tahu scene mana yang tayang begitu scene pindah.
//   2. getCurrentScene() — sekali saat halaman dimuat, untuk mengisi status
//      AWAL. Event 'obsSourceActiveChanged' hanya menyala saat status BERUBAH,
//      jadi source yang sudah aktif sejak halaman dimuat tidak pernah
//      menerimanya; tanpa pengisian awal status tetap kosong sampai scene
//      diganti ("harus pindah scene dulu"). Butuh control level ReadUser pada
//      browser source — dashboard menyetelnya saat Save.
function ApplyProgramScene(name) {
	// Tanpa ?profile=<scene> scene source ini tidak diketahui; serahkan ke
	// event aktif biasa (perilaku lama).
	if (!profileName || typeof name !== 'string' || !name) return;
	activeState = (name === profileName);
	// Siarkan selalu: saat scene ini tayang, Queue menampilkannya; saat scene
	// lain tayang, Queue menyerahkannya ke source scene itu.
	BroadcastState();
}

window.addEventListener('obsSceneChanged', function (e) {
	if (!e || !e.detail) return;
	ApplyProgramScene(e.detail.name);
});

window.addEventListener('obsSourceActiveChanged', function (e) {
	if (!e || !e.detail) return;
	activeState = !!e.detail.active;
	// Scene ini masuk program view: siarkan SEKARANG supaya halaman Queue
	// langsung menampilkan antrean scene yang sedang tayang.
	if (activeState) BroadcastState();
});

if (typeof window !== 'undefined' && window.obsstudio) {
	window.obsstudio.onActiveChange = function (active) {
		activeState = !!active;
		if (activeState) BroadcastState();
	};

	// Isi status awal sekali saat dimuat (lihat catatan di atas).
	if (typeof window.obsstudio.getCurrentScene === 'function') {
		try {
			window.obsstudio.getCurrentScene(function (scene) {
				if (scene && scene.name) ApplyProgramScene(scene.name);
			});
		} catch (err) { /* control level belum cukup — abaikan */ }
	}
}

/* Keadaan yang dibutuhkan Queue page. Dikirim setiap kali berubah, dan saat
   Queue page baru dibuka (qa_hello) supaya daftarnya langsung terisi. */
function BroadcastState() {
	// SEMUA source menyiarkan antreannya sendiri, dan tiap qa_state membawa
	// nama scene + penanda apakah scene itu yang SEDANG TAYANG. Halaman Queue
	// hanya menampilkan state dari scene yang sedang tayang, jadi daftar dan
	// angka tidak bertabrakan meski semua source aktif bersamaan.
	const onAir = currentId === null ? null : FindQuestion(currentId);
	PostToChannel({
		type: 'qa_state',
		instanceId: INSTANCE_ID,
		scene: profileName,
		active: activeState === true,
		currentId: currentId,
		currentQuestion: onAir,
		connected: bridgeConnected,
		ticketCount: ticketHolders.size,
		ticketRequired: ticketRequired,
		ticketCondition: ticketConditions.join(','),
		prefix: questionPrefix,
		questions: questions.map(function (q) {
			return { id: q.id, name: q.name, avatar: q.avatar, text: q.text, emotes: q.emotes || [], shown: q.shown, at: q.at, sample: q.sample === true };
		}),
		// Arsip lengkap untuk tombol Export CSV di halaman Queue.
		history: questionHistory.map(function (q) {
			return { id: q.id, name: q.name, avatar: q.avatar, text: q.text, emotes: q.emotes || [], shown: q.shown, at: q.at, sample: q.sample === true };
		})
	});
}

/* Perintah dari Queue page. Dipakai baik lewat BroadcastChannel maupun
   postMessage (kalau Queue page berada di iframe halaman yang sama). */
function HandleQueueMessage(d) {
	if (!d || typeof d !== 'object') return;

	// qa_state dari source lain tidak ditiru: tiap scene berdiri sendiri.
	if (d.type === 'qa_state') return;

	// Perintah antrean (tampilkan/hapus/bersihkan) hanya dijalankan scene yang
	// SEDANG TAYANG: halaman Queue menampilkan antrean scene itu, jadi perintah
	// diarahkan ke sana. Source di scene lain tetap hidup mengumpulkan chat,
	// tetapi tidak ikut mengeksekusi. 'qa_hello', 'reload', dan 'callFunction'
	// tetap dilayani semua instance.
	const sceneCmd = d.type !== 'qa_hello' && d.type !== 'reload' && d.type !== 'callFunction';
	if (sceneCmd && activeState === false) return;

	switch (d.type) {
		case 'qa_hello':
			BroadcastState();
			break;
		case 'qa_show':
			ShowQuestion(d.id);
			break;
		case 'qa_hide':
			HideQuestion();
			break;
		case 'qa_remove':
			RemoveQuestion(d.id);
			break;
		case 'qa_clear':
			ClearQuestions();
			break;
		case 'qa_clearTickets':
			ClearTickets();
			break;
		case 'qa_test':
			AddTestQuestion();
			break;
		case 'qa_set_autoexport':
			autoExportEnabled = !!d.enabled;
			try { localStorage.setItem(AUTOEXPORT_KEY, autoExportEnabled ? '1' : '0'); } catch (e) { /* abaikan */ }
			break;
		case 'callFunction':
			CallFunctionByName(d.fn, d.args);
			break;
		case 'reload':
			location.reload();
			break;
		default:
			break;
	}
}

/* Dashboard dan panel lama memanggil fungsi widget lewat postMessage
   ({ type:'callFunction', fn, args }). Dipertahankan supaya jalur itu tetap
   hidup, di samping perintah qa_* di atas. */
window.ClearQuestions = ClearQuestions;
window.ClearTickets = ClearTickets;
window.ShowQuestion = ShowQuestion;
window.HideQuestion = HideQuestion;
window.RemoveQuestion = RemoveQuestion;

/* Teks contoh untuk memeriksa tata letak overlay. Diambil dari tiga paragraf
   lorem ipsum lalu dipotong pada batas kata, mulai dari posisi acak.

   BATAS PANJANG: chat TikTok LIVE yang bisa dikirim viewer pendek — sekitar
   100 karakter. Contoh nyata (97 karakter):
     "Lorem ipsum dolor sit amet, irure exercitation fugiat occaecat.
      Anim exercitation nisi minim nisi"
   Jadi sample TIDAK pernah melebihi batas itu, supaya yang diuji benar-benar
   sepanjang chat sungguhan. (Angka 30 karakter adalah batas NAMA TAMPILAN,
   dan 32 karakter batas judul live; bukan chat.) */
const SAMPLE_TEXT = [
	'Lorem ipsum dolor sit amet, consequat cillum anim ullamco commodo. Aliqua est dolore fugiat et id magna quis occaecat elit. Exercitation irure occaecat aliquip aliqua deserunt reprehenderit enim consectetur dolore do esse. Veniam fugiat pariatur sed esse et cillum pariatur mollit do non ullamco.',
	'Reprehenderit ut commodo officia in do et sed consequat non in. Elit consectetur est officia dolore exercitation irure velit reprehenderit labore pariatur consequat. Duis esse anim mollit nisi velit occaecat velit ea esse deserunt. Et consectetur do ut irure reprehenderit in nisi cillum labore magna in.',
	'Duis tempor qui sint anim occaecat esse dolore sint dolore nisi ullamco tempor. Ad esse dolore culpa ut labore dolore nisi sint aliquip voluptate laboris. Consectetur esse elit aute et est velit dolore mollit deserunt. Excepteur anim aute occaecat eu magna esse ex.'
].join(' ');

/* Batas panjang chat TikTok LIVE (karakter). */
const SAMPLE_MAX_CHARS = 100;
/* Panjang minimum supaya sample tidak cuma satu-dua kata. */
const SAMPLE_MIN_CHARS = 24;

/* Potongan acak: mulai dari kata acak, lalu tambah kata sampai mendekati
   batas karakter. Panjangnya bervariasi (beberapa kata s/d ~100 karakter),
   tetapi tidak pernah melebihi batas chat TikTok. */
function RandomSampleText() {
	const words = SAMPLE_TEXT.split(' ');

	function Take(from) {
		let out = '';
		for (let i = from; i < words.length; i++) {
			const next = out ? out + ' ' + words[i] : words[i];
			if (next.length > SAMPLE_MAX_CHARS) break;
			out = next;
		}
		return out;
	}

	let out = Take(Math.floor(Math.random() * words.length));
	// Mulai terlalu jauh di belakang -> potongannya cuma beberapa karakter.
	// Ambil dari awal teks supaya tetap ada beberapa kata untuk diuji.
	if (out.length < SAMPLE_MIN_CHARS) out = Take(0);
	return out;
}

/* Pertanyaan contoh untuk menguji alur Queue page -> overlay tanpa chat
   sungguhan. Hanya masuk antrean, sama seperti pertanyaan asli. */
function AddTestQuestion() {
	AddQuestion({
		name: 'Sekisungkarak',
		avatar: SAMPLE_AVATAR,
		text: RandomSampleText()
	}, /* skipHistory */ true);
}

window.testQuestion = AddTestQuestion;

function CallFunctionByName(fn, args) {
	if (typeof window[fn] === 'function') window[fn].apply(null, args || []);
}

function RegisterMessageHooks() {
	window.addEventListener('message', function (ev) {
		HandleQueueMessage(ev.data);
	});

	if (window.BroadcastChannel) {
		try {
			channel = new BroadcastChannel(CHANNEL_NAME);
			channel.onmessage = function (ev) {
				HandleQueueMessage(ev.data);
			};
		} catch (e) { /* abaikan */ }
	}
}

//////////
// INIT //
//////////

function Init() {
	LoadDesignFont(design.font);
	ApplyDesign();
	RenderHint();
	// Muat antrean scene ini DULU (termasuk On screen scene ini), baru gambar.
	LoadQueue();
	LoadHistory();
	RenderOverlay();
	RegisterMessageHooks();

	bridgeConnection();
	BroadcastState();

	console.log('[Geseki] Live Q&A loaded');
	document.body.style.backgroundColor = 'transparent';
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', Init);
} else {
	Init();
}
