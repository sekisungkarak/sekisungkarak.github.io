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
const BRIDGE_WS_URL = 'ws://' + bridgeHost + ':' + bridgePort + '/ws';

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

// ── Elemen ───────────────────────────────────────────────────────────────────

const qaPanel = document.getElementById('qaPanel');
const qaCard = document.getElementById('qaCard');
const qaHint = document.getElementById('qaHint');

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
let currentId = null;
let questionSeq = 0;

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

	const text = document.createElement('span');
	text.className = 'qa-text';
	text.textContent = q.text;

	body.appendChild(who);
	body.appendChild(text);
	card.appendChild(body);
	return card;
}

/* Overlay hanya menampilkan pertanyaan yang sedang dipilih. Tidak ada
   pertanyaan terpilih -> panel disembunyikan (opacity 0). */
function RenderOverlay() {
	qaCard.innerHTML = '';

	const q = currentId === null ? null : FindQuestion(currentId);
	if (!q) {
		qaPanel.classList.add('is-empty');
		return;
	}

	qaCard.appendChild(BuildCard(q));
	qaPanel.classList.remove('is-empty');
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
		while (idx < questions.length && questions[idx].id === currentId) idx += 1;
		if (idx >= questions.length) break;
		questions.splice(idx, 1);
	}

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
	BroadcastState();
}

function HideQuestion() {
	if (currentId === null) return;
	currentId = null;
	RenderOverlay();
	BroadcastState();
}

function RemoveQuestion(id) {
	const idx = questions.findIndex(function (q) { return q.id === id; });
	if (idx < 0) return;
	questions.splice(idx, 1);
	if (currentId === id) currentId = null;
	RenderOverlay();
	BroadcastState();
}

function ClearQuestions() {
	questions.length = 0;
	currentId = null;
	RenderOverlay();
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

function bridgeConnection() {
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

/* Keadaan yang dibutuhkan Queue page. Dikirim setiap kali berubah, dan saat
   Queue page baru dibuka (qa_hello) supaya daftarnya langsung terisi. */
function BroadcastState() {
	PostToChannel({
		type: 'qa_state',
		currentId: currentId,
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
   lorem ipsum lalu dipotong pada batas kata dengan panjang acak, supaya
   pertanyaan pendek dan panjang sama-sama bisa diuji.

   CATATAN soal batas karakter: komentar TikTok LIVE dibatasi sekitar 150
   karakter, jadi teks sepanjang ini tidak datang dari penonton sungguhan —
   ini murni alat uji tata letak. (Angka 30 karakter yang beredar adalah batas
   NAMA TAMPILAN, dan 32 karakter adalah batas judul live; bukan chat.) */
const SAMPLE_TEXT = [
	'Lorem ipsum dolor sit amet, consequat cillum anim ullamco commodo. Aliqua est dolore fugiat et id magna quis occaecat elit. Exercitation irure occaecat aliquip aliqua deserunt reprehenderit enim consectetur dolore do esse. Veniam fugiat pariatur sed esse et cillum pariatur mollit do non ullamco.',
	'Reprehenderit ut commodo officia in do et sed consequat non in. Elit consectetur est officia dolore exercitation irure velit reprehenderit labore pariatur consequat. Duis esse anim mollit nisi velit occaecat velit ea esse deserunt. Et consectetur do ut irure reprehenderit in nisi cillum labore magna in.',
	'Duis tempor qui sint anim occaecat esse dolore sint dolore nisi ullamco tempor. Ad esse dolore culpa ut labore dolore nisi sint aliquip voluptate laboris. Consectetur esse elit aute et est velit dolore mollit deserunt. Excepteur anim aute occaecat eu magna esse ex.'
].join(' ');

/* Potongan acak: 12-70 kata, mulai dari posisi acak. */
function RandomSampleText() {
	const words = SAMPLE_TEXT.split(' ');
	const maxWords = Math.min(words.length, 70);
	const count = 12 + Math.floor(Math.random() * (maxWords - 12 + 1));
	const start = Math.floor(Math.random() * (words.length - count + 1));
	return words.slice(start, start + count).join(' ');
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
	RenderHint();
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
