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

/* Tiket: SATU gift dipilih lewat dropdown di dashboard dan disimpan sebagai
   ID numerik — nama gift dilokalisasi TikTok (Galaxy -> Galaksi), jadi ID
   adalah satu-satunya kunci yang stabil lintas bahasa dan region.
   ID kosong = tiket OPSIONAL: penonton cukup mengetik prefix untuk bertanya. */
const ticketGiftId = String(GetParam('ticketGiftId', '')).trim();
const ticketRequired = ticketGiftId !== '';

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

	const header = document.getElementById('qaHeader');
	if (header) header.classList.toggle('hidden', !design.showTitle);
	qaPanel.classList.remove('card-none', 'card-outline');
	if (design.card === 'none') qaPanel.classList.add('card-none');
	else if (design.card === 'outline') qaPanel.classList.add('card-outline');
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
const LAYOUT_KEYS = {
	x: WIDGET_NS + 'layout-x',
	y: WIDGET_NS + 'layout-y',
	scale: WIDGET_NS + 'layout-scale',
	rotation: WIDGET_NS + 'layout-rotation',
	// Ukuran eksplisit dari fitur resize di panel. 0 = biarkan CSS (auto).
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

function ReadLayout() {
	return {
		x: Math.round(ReadLayoutNumber(LAYOUT_KEYS.x, 0)),
		y: Math.round(ReadLayoutNumber(LAYOUT_KEYS.y, 0)),
		scale: ClampLayoutScale(ReadLayoutNumber(LAYOUT_KEYS.scale, 1)),
		rotation: ClampLayoutRotation(ReadLayoutNumber(LAYOUT_KEYS.rotation, 0)),
		width: Math.max(0, Math.round(ReadLayoutNumber(LAYOUT_KEYS.width, 0))),
		height: Math.max(0, Math.round(ReadLayoutNumber(LAYOUT_KEYS.height, 0)))
	};
}

/* Offset sebagai MARGIN dari jangkar CSS (kiri-bawah), bukan left/top:
   mengubah posisi absolut merusak animasi panel. */
function ApplyLayoutToPanel(st) {
	qaPanel.style.marginLeft = st.x + 'px';
	qaPanel.style.marginBottom = st.y + 'px';
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

function SaveLayout(st) {
	try {
		localStorage.setItem(LAYOUT_KEYS.x, String(st.x));
		localStorage.setItem(LAYOUT_KEYS.y, String(st.y));
		localStorage.setItem(LAYOUT_KEYS.scale, String(st.scale));
		localStorage.setItem(LAYOUT_KEYS.rotation, String(st.rotation));
		localStorage.setItem(LAYOUT_KEYS.width, String(st.width));
		localStorage.setItem(LAYOUT_KEYS.height, String(st.height));
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

/* Satu tiket per user. Kuncinya userId; nilainya tidak dipakai lagi karena
   tiket hangus begitu pertanyaan terkirim — jadi cukup Set. */
const ticketHolders = new Set();

/* Cek apakah sebuah gift adalah gift tiket yang dipilih. Pencocokan HANYA
   lewat ID: nama gift berbeda-beda per bahasa dan region. */
function IsTicketGift(data) {
	if (!ticketRequired) return false;
	const id = data.giftId === undefined || data.giftId === null ? '' : String(data.giftId).trim();
	return id !== '' && id === ticketGiftId;
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
/* Pertanyaan yang sedang tayang di overlay SCENE INI. Ikut disimpan bersama
   antrean scene (kunci per scene), jadi pindah scene menampilkan On screen
   milik scene itu sendiri — bukan membawa pertanyaan dari scene sebelumnya. */
let currentId = null;
let questionSeq = 0;

/* Antrean disimpan PER SCENE, meniru Dynamic Island Alert: tiap scene punya
   daftar pertanyaannya sendiri. Nama scene datang dari `?profile=<scene>` yang
   ditempelkan dashboard ke URL tiap browser source, jadi scene "Gameplay" dan
   "Just Chatting" tidak saling menimpa. Dibuka di browser biasa (tanpa
   profile), kuncinya jatuh ke daftar bersama. */
const QUEUE_KEY = WIDGET_NS + 'queue' + (profileName ? ':' + profileName : '');

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
	text.textContent = q.text;

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

	if (ticketRequired) {
		// Nama gift tidak ikut tersimpan (hanya ID yang stabil), jadi teks
		// bawaan memakai sebutan umum; streamer bebas mengubahnya.
		qaHint.textContent = ticketHintText
			.replaceAll('{gift}', 'the gift')
			.replaceAll('{prefix}', questionPrefix);
	} else {
		// Tanpa syarat gift, teks tiket akan menyesatkan — pakai kalimat sendiri.
		qaHint.textContent = 'Type ' + questionPrefix + ' to ask a question';
	}
	qaHint.classList.remove('hidden');
}

/* Tambah pertanyaan ke antrean. TIDAK menampilkannya: overlay hanya berubah
   saat streamer memilih dari Queue page. */
function AddQuestion(q) {
	questionSeq += 1;
	const item = {
		id: 'q' + questionSeq,
		name: q.name,
		avatar: q.avatar,
		text: q.text,
		shown: false,
		at: Date.now()
	};
	questions.push(item);

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
	BroadcastState();
}

/////////////////////////////
// EVENT TIKTOK DARI BRIDGE //
/////////////////////////////

function HandleGift(data) {
	LogGift(data);
	if (!IsTicketGift(data)) return;
	const key = UserKey(data);
	if (!key) return;
	ticketHolders.add(key);
	BroadcastState();
}

/* Chat yang diawali prefix masuk antrean. Bila ada gift tiket, penanya WAJIB
   memegang tiket dan tiket itu habis terpakai (satu pertanyaan per gift); bila
   tidak ada gift tiket, siapa pun boleh bertanya. */
function HandleChat(data) {
	const comment = String(data.comment || '').trim();
	if (!comment) return;
	if (!comment.startsWith(questionPrefix)) return;

	if (ticketRequired) {
		const key = UserKey(data);
		if (!key || !ticketHolders.has(key)) return;
		ticketHolders.delete(key);
	}

	const text = comment.slice(questionPrefix.length).trim();
	if (text.length < MIN_QUESTION_LENGTH) return;

	AddQuestion({
		name: data.nickname || data.uniqueId || 'Viewer',
		avatar: data.profilePictureUrl || '',
		text: text
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
			}
			// hello / status / pong / tipe masa depan: diabaikan (protokol aditif).
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
// halaman Queue; semua source tetap memproses chat. Saat scene ini masuk
// program view, siarkan SEKARANG supaya halaman Queue langsung menampilkan
// antrean scene yang sedang tayang (termasuk On screen scene itu).
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
		prefix: questionPrefix,
		questions: questions.map(function (q) {
			return { id: q.id, name: q.name, avatar: q.avatar, text: q.text, shown: q.shown, at: q.at };
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
	});
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
