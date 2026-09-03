////////////////
// PARAMETERS //
////////////////

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

// Weather info
const weatherLocation = urlParams.get("weatherLocation") || "Jakarta";
// Durasi alert (detik -> ms). Dipakai HANYA untuk alert.
const alertDisplayDuration = GetIntParam("alertDuration", 4) * 1000;

// Durasi rotasi panel info (tanggal / jam / durasi / cuaca / penonton). Terpisah dari
// alertDisplayDuration supaya antrean padat tidak mempercepat putaran info.
const infoCycleDuration = GetIntParam("infoDuration", 4) * 1000;

// ---- Durasi alert dinamis saat antrean padat ----
// Antrean = event yang MASIH MENUNGGU (alertQueue.length), tidak termasuk alert yang tayang.
const queueThreshold = GetIntParam("queueThreshold", 2);        // <= ini -> pakai alertDisplayDuration
const alertDurationMinMs = GetFloatParam("alertDurationMin", 1.5) * 1000;
const burstFullBacklog = GetIntParam("burstFullBacklog", 6);    // backlog >= ini -> durasi minimum

// Floor absolut: animasi pop 0.38s + transisi pill 0.35s harus sempat selesai.
const MIN_ALERT_FLOOR_MS = 1000;

// Durasi alert lagu baru (songchange): ikut setting "Alert Duration (seconds)"
// (alertDisplayDuration). URL param musicAlertDuration = override legacy.
const musicAlertDuration = GetIntParam("musicAlertDuration", 4) * 1000;
const useLegacyMusicDuration = urlParams.has("musicAlertDuration");

// Durasi alert musik dinamis: SELALU mengikuti setting "Alert Duration
// (seconds)" — tidak pernah ditunggu sampai marquee selesai.
function ComputeMusicAlertDuration(alertData) {
	// Basis: sama dengan alert lain (setting + penyusutan saat antrean padat),
	// kecuali URL param musicAlertDuration dipakai (legacy).
	return useLegacyMusicDuration ? musicAlertDuration : ComputeAlertDuration();
}

// Custom Font (System font or Google Font)
const font = urlParams.get("font") || "";
if (font) {
	const cleanFont = font.trim();
	const fontLink = document.createElement("link");
	fontLink.rel = "stylesheet";
	fontLink.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(cleanFont).replace(/%20/g, '+')}:wght@400;500;600;700;800;900&display=swap`;
	document.head.appendChild(fontLink);

	document.body.style.fontFamily = `'${cleanFont}', "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`;
}

// Custom content size untuk teks & ikon (opsi "Content Size" di settings)
let contentSize = GetFloatParam("contentSize", 20);
if (contentSize && contentSize > 0) {
	// Clamp 10-100 untuk menanggulangi input manual via UI
	contentSize = Math.max(10, Math.min(100, contentSize));
	// Baseline aslinya adalah font ukuran 13px (= scale 1.0)
	const scale = contentSize / 13;
	document.documentElement.style.setProperty('--island-font-size', contentSize + 'px');
	document.documentElement.style.setProperty('--island-icon-ambient', Math.round(20 * scale) + 'px');
	document.documentElement.style.setProperty('--island-icon-alert', Math.round(24 * scale) + 'px');
		document.documentElement.style.setProperty('--island-avatar-size', Math.round(38 * scale) + 'px');
	
				// Pertambahan padding dikecilkan supaya UI tetap compact.
		const extraPadX = Math.max(0, (contentSize - 13) * 0.4);
		const extraPadY = Math.max(0, (contentSize - 13) * 0.35);
		document.documentElement.style.setProperty('--island-padding-x', Math.round(20 + extraPadX) + 'px');
		document.documentElement.style.setProperty('--island-alert-padding-x', Math.round(24 + extraPadX) + 'px');
		document.documentElement.style.setProperty('--island-padding-y', Math.round(14 + extraPadY) + 'px');
		document.documentElement.style.setProperty('--island-alert-padding-y', Math.round(12 + extraPadY) + 'px');
}

// TikTok parameters
const tiktokService = (urlParams.get("tiktokService") || "both").toLowerCase(); // 'both', 'tikfinity', 'indofinity', 'none'
const tikfinityPort = GetIntParam("tikfinityPort", 21213);
const indofinityPort = GetIntParam("indofinityPort", 62024);
const tikfinityHost = urlParams.get("tikfinityHost") || "localhost";
const indofinityHost = urlParams.get("indofinityHost") || "localhost";

// Live detection (TikTok LIVE Studio -> Stream Deck Socket.IO channel)
const enableLiveDetect = GetBoolParam("enableLiveDetect", true);
const liveStudioPort = GetIntParam("liveStudioPort", 0); // 0 = auto-scan
const offlineText = urlParams.get("offlineText") || "Stream Offline";
const offlineViewersText = urlParams.get("offlineViewersText") || "-";

// Alert event filters
const followMessage = urlParams.get("followMessage") || "followed!";
const subscribeMessage = urlParams.get("subscribeMessage") || "subscribed!";
const shareMessage = urlParams.get("shareMessage") || "shared the live!";
const giftMessage = urlParams.get("giftMessage") || "sent {gift} x{count}!";

const enableFollow = GetBoolParam("enableFollow", true);
const enableSubscribe = GetBoolParam("enableSubscribe", true);
const enableShare = GetBoolParam("enableShare", true);
const enableGift = GetBoolParam("enableGift", true);
const enableFirstChatter = GetBoolParam("enableFirstChatter", true);

// SMTC Bridge & Now Playing settings
const enableNowPlaying = GetBoolParam("enableNowPlaying", true);
const includedApplications = urlParams.get("includedApplications") || '';
const excludedApplications = urlParams.get("excludedApplications") || '';
const enableDynamicStyleBig = GetBoolParam("enableDynamicStyleBig", true);
const enableDynamicBig = GetBoolParam("enableDynamicStyleBig", true);
const SMTC_BRIDGE_PORT = GetIntParam("smtcBridgePort", 5000);
const SMTC_BRIDGE_URL = `http://127.0.0.1:${SMTC_BRIDGE_PORT}/now-playing`;

// Peran warna palet artwork untuk accent (wave icon, pause overlay, scrubber).
// 'lightVibrant' = perilaku lama, jadi widget tanpa param tampil persis seperti sebelumnya.
const accentPaletteRole = (urlParams.get("accentPaletteRole") || "lightVibrant").toLowerCase();

// Pemetaan role settings -> key palet Vibrant.js. Nama key harus sama persis dengan
// output GetAccentPalette() (LightVibrant, Vibrant, DarkVibrant).
const ACCENT_ROLE_MAP = {
	lightvibrant: 'LightVibrant',
	vibrant: 'Vibrant',
	darkvibrant: 'DarkVibrant'
};

// Ambil warna accent dari palet sesuai role pilihan user.
// Fallback: role pilihan -> LightVibrant -> Vibrant -> ungu default.
// Palet Vibrant.js tidak selalu punya semua role (artwork gelap biasanya tanpa LightVibrant),
// jadi fallback ini penting supaya accent tidak pernah kosong.
function ResolveAccentColor(hexPalette) {
	const preferred = ACCENT_ROLE_MAP[accentPaletteRole];
	return (preferred && hexPalette[preferred])
		|| hexPalette.LightVibrant
		|| hexPalette.Vibrant
		|| '#8A2BE2';
}

// Inisialisasi Audio Notifikasi
const alertAudio = new Audio("../resources/sfx/notification.mp3");
// Turunkan volume karena aslinya sfx ini cukup keras (sesuaikan kalau kurang)
alertAudio.volume = 0.5;

// Konstanta status playback Windows SMTC
const PlaybackStatus = Object.freeze({
	CLOSED: 0,   // Engine uninitialized or empty
	OPENED: 1,   // Pipeline loaded but idling
	CHANGING: 2, // Buffering, track skipping, or seeking
	STOPPED: 3,  // Track queued but fully stopped (at 0:00)
	PLAYING: 4,  // Audio actively streaming (Run dead reckoning)
	PAUSED: 5    // Audio frozen (Halt dead reckoning)
});

let nowPlayingData = {
	albumArt: "",
	isPlaying: false,
	title: "Unknown",
	artist: "Unknown",
	lightVibrant: "#8A2BE2",
	palette: {},
	_lastSongKey: "",
	// [Seed] true setelah bacaan aktif pertama - mencegah alert song change muncul
	// begitu bridge tersambung / widget di-refresh.
	_seeded: false,
	// Kunci render terakhir panel musik; mencegah render ulang tiap tick.
	_lastRenderKey: "",
	// Posisi (ms) saat lagu dijeda; null bila play / tidak ada lagu.
	// Dipakai label "Paused • m:ss" pada panel musik versi pause.
	pausedAtMs: null,
	// Identitas lagu TANPA thumbnail: penentu ganti lagu harus kebal terhadap artwork
	// yang datang terlambat.
	_lastSongId: "",
	// Identitas lagu yang alert-nya DITUNDA karena artwork belum ada. Alert song change
	// menunggu thumbnail; begitu artwork tiba, alert ditembak sekali.
	_pendingSongAlert: null,
	// [ANTI DOBEL] Lagu yang SUDAH ditembak alert-nya: satu songId = satu alert. Mencegah
	// invocation ApplyNowPlayingData yang overlap menembak ulang lagu yang sama.
	_lastAlertedSongId: ""
};

// Pastikan Vibrant.js ter-load, lalu ambil palet hex dari URL gambar.
async function GetAccentPalette(imageUrl) {
	// 1. Dynamic Loader: Load Vibrant.js
	if (typeof Vibrant === 'undefined') {
		await new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = "https://cdnjs.cloudflare.com/ajax/libs/node-vibrant/3.1.6/vibrant.min.js";
			script.onload = resolve;
			script.onerror = reject;
			document.head.appendChild(script);
		});
	}

	return new Promise((resolve) => {
		// Vibrant can take the URL directly!
		Vibrant.from(imageUrl).getPalette((err, palette) => {
			if (err) {
				console.warn("Vibrant failed, using fallback.");
				return resolve({
					Vibrant: "#ffffff",
					Muted: "#cccccc",
					DarkVibrant: "#000000"
				});
			}

			// Extract Hex from each swatch
			const hexPalette = {};
			for (let role in palette) {
				if (palette[role]) {
					hexPalette[role] = palette[role].getHex();
				}
			}
			resolve(hexPalette);
		});
	});
}

// Cache palet per-URL artwork: tanpa cache, warna yang sama diekstrak ulang tiap tick
// (boros dan bikin wave berkedut).
const accentPaletteCache = new Map();
async function GetAccentPaletteCached(imageUrl) {
	if (!imageUrl) return { Vibrant: "#8A2BE2" };
	if (accentPaletteCache.has(imageUrl)) {
		return accentPaletteCache.get(imageUrl);
	}
	const palette = await GetAccentPalette(imageUrl);
	accentPaletteCache.set(imageUrl, palette);
	// Batasi ukuran cache agar memori tidak tumbuh terus sepanjang sesi OBS.
	if (accentPaletteCache.size > 40) {
		const oldestKey = accentPaletteCache.keys().next().value;
		accentPaletteCache.delete(oldestKey);
	}
	return palette;
}

/////////////
// HELPERS //
/////////////

// Hitung panjang string per grapheme cluster supaya aturan marquee adil untuk
// emoji, kanji, Arab, Devanagari, dll.
function GetGraphemeCount(str) {
	if (!str) return 0;
	if (typeof Intl !== 'undefined' && Intl.Segmenter) {
		const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
		let count = 0;
		for (const _ of seg.segment(str)) count++;
		return count;
	}
	return [...str].length;
}

function GetIntParam(paramName, defaultValue) {
	const paramValue = urlParams.get(paramName);
	if (paramValue === null) return defaultValue;
	const intValue = parseInt(paramValue, 10);
	return isNaN(intValue) ? defaultValue : intValue;
}

function GetBoolParam(paramName, defaultValue) {
	const paramValue = urlParams.get(paramName);
	if (paramValue === null) return defaultValue;
	const val = String(paramValue).toLowerCase();
	if (val === 'true' || val === '1') return true;
	if (val === 'false' || val === '0') return false;
	return defaultValue;
}

// Sama seperti GetIntParam tapi menerima desimal (parseInt memotong 1.5 -> 1).
function GetFloatParam(paramName, defaultValue) {
	const paramValue = urlParams.get(paramName);
	if (paramValue === null) return defaultValue;
	const floatValue = parseFloat(paramValue);
	return isNaN(floatValue) ? defaultValue : floatValue;
}

function FormatDuration(ms) {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Format angka penonton: >= 1.000.000 -> "1.2M", >= 1.000 -> "1.5K", di bawah itu apa
// adanya. Format compact menjaga pill tidak melebar.
function FormatViewers(count) {
	let n = Number(count);
	if (!isFinite(n) || isNaN(n) || n < 0) return '0';
	n = Math.floor(n);

	if (n >= 1000000) {
		let s = (n / 1000000).toFixed(1);
		if (s.endsWith('.0')) s = s.slice(0, -2);
		return s + 'M';
	}
	if (n >= 1000) {
		let s = (n / 1000).toFixed(1);
		if (s.endsWith('.0')) s = s.slice(0, -2);
		return s + 'K';
	}
	return n.toString();
}

///////////////////////
// DYNAMIC ISLAND    //
///////////////////////

const dynamicIsland = document.getElementById('dynamicIsland');
const widgetScale = GetFloatParam("widgetScale", 1.0);
const verticalAlign = urlParams.get("verticalAlign") || "top";

let baseTransform = "translateX(-50%)";
if (widgetScale !== 1.0) {
	baseTransform += ` scale(${widgetScale})`;
}
if (verticalAlign === "center") {
	dynamicIsland.style.top = "50%";
	dynamicIsland.style.bottom = "auto";
	baseTransform += " translateY(-50%)";
} else if (verticalAlign === "bottom") {
	dynamicIsland.style.top = "auto";
	dynamicIsland.style.bottom = "32px";
} else {
	dynamicIsland.style.top = "32px"; // slightly padded for stream elements
	dynamicIsland.style.bottom = "auto";
}

document.documentElement.style.setProperty('--base-transform', baseTransform);
dynamicIsland.style.transform = baseTransform;

// Default kini "glass" (Liquid Glass) - harus sama dengan defaultValue widgetStyle di
// settings.json, kalau tidak widget tanpa param akan tampil Solid Black.
if ((urlParams.get("widgetStyle") || "glass") === "solid") {
	dynamicIsland.classList.add("style-solid");
}
const islandAvatar = document.getElementById('islandAvatar');
const islandIcon = document.getElementById('islandIcon');
const islandIconWrap = document.getElementById('islandIconWrap');
// Sinkronkan visibilitas wrapper dengan ikon: event TikTok memakai avatar, bukan ikon,
// jadi slot 20px wrapper tidak boleh dipesan.
const SyncIconWrapHidden = () => {
	if (!islandIconWrap || !islandIcon) return;
	islandIconWrap.classList.toggle('hidden', islandIcon.classList.contains('hidden'));
};
const islandContent = document.getElementById('islandContent');
const islandText = document.getElementById('islandText');
const islandSubtext = document.getElementById('islandSubtext');
const islandEventIcon = document.getElementById('islandEventIcon');
const islandAlert = document.getElementById('islandAlert');
const alertIcon = document.getElementById('alertIcon');
const alertText = document.getElementById('alertText');

// CATATAN OBS: OBS 32.2.2 memakai CEF Chromium 127, yang belum mendukung
// `interpolate-size: allow-keywords` (baru Chromium 129). Transisi lebar pill
// (`width: max-content`) karena itu tidak berjalan di OBS - lebar langsung lompat,
// hanya tinggi yang morph. Keterbatasan engine, bukan bug kode.

/////////////////////////////////////////
// GESER WIDGET (hanya mode pratinjau) //
/////////////////////////////////////////

// Geser widget hanya di mode pratinjau: drag aktif bila URL memuat `dragPreview=1`
// (ditambahkan settings builder). Browser source OBS tidak memakai param itu, jadi
// widget tetap statis saat tayang. Posisi sengaja tidak disimpan.
// Pergeseran memakai margin, bukan transform: transform sudah dipakai
// --base-transform untuk penskalaan & perataan pill.
(function initPreviewDrag() {
	if (!urlParams.has('dragPreview')) return;
	if (!dynamicIsland) return;

	// -- TIDAK MENGGANTI LEFT/TOP/BOTTOM --
	// Mengubah posisi ke absolut px merusak `left: 50%` + translateX(-50%) bawaan CSS,
	// sehingga animasi pelebaran/penyusutan pill kacau. Drag HANYA mengatur margin;
	// posisi dasar dari CSS tidak disentuh.
	let startX = 0, startY = 0;
	let originMarginX = 0, originMarginY = 0;
	let pendingX = 0, pendingY = 0, rafId = 0, dragging = false;

	const batas = () => {
		// Batas dihitung longgar seluas iframe (kira-kira)
		const r = dynamicIsland.getBoundingClientRect();
		// Get viewport dimensions
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		// Perkiraan seberapa jauh margin bisa digeser, dari rect saat ini.
		const marginX = parseFloat(dynamicIsland.style.marginLeft) || 0;
		const marginY = parseFloat(dynamicIsland.style.marginTop) || 0;
		const limitLeft = marginX - r.left;
		const limitRight = marginX + (vw - r.right);
		const limitTop = marginY - r.top;
		const limitBottom = marginY + (vh - r.bottom);
		return { minX: limitLeft, maxX: limitRight, minY: limitTop, maxY: limitBottom };
	};

	const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));

	const applyPosition = () => {
		rafId = 0;
		const b = batas();
		dynamicIsland.style.marginLeft = clamp(pendingX, b.minX, b.maxX) + 'px';
		dynamicIsland.style.marginTop = clamp(pendingY, b.minY, b.maxY) + 'px';
	};

	const onDown = (e) => {
		if (e.button !== 0) return;
		dragging = true;
		startX = e.clientX;
		startY = e.clientY;
		originMarginX = parseFloat(dynamicIsland.style.marginLeft) || 0;
		originMarginY = parseFloat(dynamicIsland.style.marginTop) || 0;
		dynamicIsland.style.cursor = 'grabbing';
		mulailahDragRingan();
		try { dynamicIsland.setPointerCapture(e.pointerId); } catch (err) {}
		e.preventDefault();
	};

	const onMove = (e) => {
		if (!dragging) return;
		pendingX = originMarginX + (e.clientX - startX);
		pendingY = originMarginY + (e.clientY - startY);
		if (!rafId) rafId = requestAnimationFrame(applyPosition);
	};

	const onUp = (e) => {
		if (!dragging) return;
		dragging = false;
		if (rafId) { cancelAnimationFrame(rafId); rafId = 0; applyPosition(); }
		dynamicIsland.style.cursor = 'grab';
		try { dynamicIsland.releasePointerCapture(e.pointerId); } catch (err) {}
		restoreAfterDrag();
	};

	window.addEventListener('resize', () => {
		const b = batas();
		const curMarginX = parseFloat(dynamicIsland.style.marginLeft) || 0;
		const curMarginY = parseFloat(dynamicIsland.style.marginTop) || 0;
		dynamicIsland.style.marginLeft = clamp(curMarginX, b.minX, b.maxX) + 'px';
		dynamicIsland.style.marginTop = clamp(curMarginY, b.minY, b.maxY) + 'px';
	});

	dynamicIsland.style.cursor = 'grab';
	dynamicIsland.style.userSelect = 'none';
	dynamicIsland.style.touchAction = 'none'; // cegah scroll ikut bergerak

	// -- Ringankan SELAMA drag, pulihkan SETELAHNYA --
	// `transition: all 0.5s` membuat pill mengejar kursor, dan backdrop-filter
	// dihitung ulang tiap frame saat digeser. Keduanya di-override saat drag, lalu
	// dihapus sesudahnya supaya aturan stylesheet berlaku kembali.
	const mulailahDragRingan = () => {
		dynamicIsland.style.transition = 'none';
		dynamicIsland.style.backdropFilter = 'blur(8px)';
		dynamicIsland.style.webkitBackdropFilter = 'blur(8px)';
	};

	// Pulihkan: HAPUS override inline supaya aturan stylesheet berlaku kembali.
	// Menyetel nilai computed justru mengunci nilai itu dan mematikan transisi pill.
	const restoreAfterDrag = () => {
		dynamicIsland.style.removeProperty('transition');
		dynamicIsland.style.removeProperty('backdrop-filter');
		dynamicIsland.style.removeProperty('-webkit-backdrop-filter');
	};

	dynamicIsland.addEventListener('pointerdown', onDown);
	dynamicIsland.addEventListener('pointermove', onMove);
	dynamicIsland.addEventListener('pointerup', onUp);
	dynamicIsland.addEventListener('pointercancel', onUp);

	console.debug('[Geseki] drag pratinjau aktif (dragPreview=1)');
})();
if (islandAvatar) {
	islandAvatar.onerror = () => {
		islandAvatar.classList.add('hidden');
		islandIcon.classList.remove('hidden');
		SyncIconWrapHidden();
	};
}

// Icon sources matching date and time style (Icons8 Fluency Systems Filled)
const ALERT_ICONS = {
	calendar: 'https://img.icons8.com/fluency-systems-filled/96/8A2BE2/calendar.png',
	clock: 'https://img.icons8.com/fluency-systems-filled/96/8A2BE2/clock.png',
	weather: 'https://img.icons8.com/fluency-systems-filled/96/8A2BE2/partly-cloudy-day.png',
	timer: 'https://img.icons8.com/fluency-systems-filled/96/FFD700/timer.png',
	viewers: 'https://img.icons8.com/fluency-systems-filled/96/FFD700/visible.png',
	gift: 'https://img.icons8.com/fluency-systems-filled/96/FF0050/gift.png',
	follow: 'https://img.icons8.com/fluency-systems-filled/96/00F2FE/add-user-male.png',
	subscribe: 'https://img.icons8.com/fluency-systems-filled/96/FFD700/star.png',
	share: 'https://img.icons8.com/fluency-systems-filled/96/00F2FE/share.png',
	like: 'https://img.icons8.com/fluency-systems-filled/96/FF0050/like.png'
};

let weatherData = null;
let viewerCount = null;
let currentPanelIndex = 0;
let cycleTimer = null;
let secondTicker = null;
let isAlertActive = false;
const widgetStartTime = Date.now();

// ---- Status live (dari deteksi LIVE Studio) ----
// null = belum diketahui, 0 = offline, 1 = paused, 2 = live
let liveStatus = null;
// Waktu mulai live yang sudah disepakati (ms). Diisi dari deteksi / localStorage / manual.
let liveStartedAtMs = null;
// Penanda: waktu mulai berasal dari localStorage (reload), bukan sesi baru.
let liveStartFromStorage = false;

// Teks panel durasi: offline -> "Stream Offline", live -> "Live - HH:MM:SS".
// Waktu mulai HANYA dari deteksi LIVE Studio (liveStartedAtMs).
function GetLiveDurationText() {
	if (liveStatus !== 2) return offlineText;

	const startMs = liveStartedAtMs !== null ? liveStartedAtMs : widgetStartTime;

	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
	const hours = Math.floor(elapsedSeconds / 3600);
	const minutes = Math.floor((elapsedSeconds % 3600) / 60);
	const seconds = elapsedSeconds % 60;

	const pad = (n) => String(n).padStart(2, '0');
	return `Live • ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const appLanguage = urlParams.get("language") || "id";

// Mengaktifkan bahasa pilihan untuk dayjs (jika dimuat)
if (typeof dayjs !== 'undefined') {
	dayjs.locale(appLanguage);
}

function GetTimeNowText() {
	const timeFormat = urlParams.get("timeFormat") || "HH:mm:ss A";
	if (typeof dayjs !== 'undefined') {
		return dayjs().format(timeFormat);
	}
	return new Date().toLocaleTimeString('id-ID');
}

// Rotate through info panels
// Purple icons = date/time & weather, yellow icons = event-related (duration, viewers)
// Ada lagu yang bisa ditampilkan? Pause TETAP dihitung ada (panel musik punya
// tampilan khusus pause). Hanya false bila bridge putus / metadata kosong.
// -- Persistensi state pause --
// Saat reload, nowPlayingData di-reset padahal lagu masih dijeda. Simpan ke
// localStorage supaya panel musik langsung tampil mode pause setelah reload.
const PAUSE_STORAGE_KEY = 'geseki-paused-state';

// Metadata lagu terakhir yang VALID (bukan "Unknown"), disimpan terpisah supaya
// judul/artis tidak pernah tertimpa "Unknown" - kalau itu terjadi
// HasPlayableTrack() jadi false dan panel musik di-skip saat reload.
function SaveTrackMeta() {
	if (!HasPlayableTrack()) return;   // jangan simpan metadata kosong
	try {
		const raw = localStorage.getItem(PAUSE_STORAGE_KEY);
		const st = raw ? JSON.parse(raw) : {};
		st.title = nowPlayingData.title;
		st.artist = nowPlayingData.artist;
		st.art = nowPlayingData.albumArt || '';
		st.lv = nowPlayingData.lightVibrant || '';
		localStorage.setItem(PAUSE_STORAGE_KEY, JSON.stringify(st));
	} catch (e) { /* localStorage bisa diblokir */ }
}

function SavePauseState() {
	try {
		if (nowPlayingData.pausedAtMs === null) {
			// Keluar dari pause: hapus posisi, TAPI pertahankan metadata lagu terakhir.
			const raw = localStorage.getItem(PAUSE_STORAGE_KEY);
			if (!raw) return;
			const st = JSON.parse(raw);
			delete st.pos;
			localStorage.setItem(PAUSE_STORAGE_KEY, JSON.stringify(st));
			return;
		}
		const raw = localStorage.getItem(PAUSE_STORAGE_KEY);
		const st = raw ? JSON.parse(raw) : {};
		st.pos = nowPlayingData.pausedAtMs;
		if (HasPlayableTrack()) {
			st.title = nowPlayingData.title;
			st.artist = nowPlayingData.artist;
			st.art = nowPlayingData.albumArt || '';
			st.lv = nowPlayingData.lightVibrant || '';
		}
		localStorage.setItem(PAUSE_STORAGE_KEY, JSON.stringify(st));
	} catch (e) { /* localStorage bisa diblokir (mode private / OBS) */ }
}

function LoadPauseState() {
	try {
		const raw = localStorage.getItem(PAUSE_STORAGE_KEY);
		if (!raw) return;
		const st = JSON.parse(raw);
		if (!st || typeof st.pos !== 'number') return;
		if (typeof st.pos === 'number') nowPlayingData.pausedAtMs = st.pos;
		if (st.title && st.title !== 'Unknown') nowPlayingData.title = st.title;
		if (st.artist && st.artist !== 'Unknown') nowPlayingData.artist = st.artist;
		if (st.art) nowPlayingData.albumArt = st.art;
		// Pulihkan warna palet: kalau tidak, wave icon & progress bar kembali ke ungu
		// default sampai palet diekstrak ulang.
		if (st.lv) {
			nowPlayingData.lightVibrant = st.lv;
			const fill = document.querySelector('.scrub-fill');
			if (fill) fill.style.setProperty('--accent-color', st.lv);
		}
		// Paksa render ulang panel musik aktif setelah reload.
		nowPlayingData._lastRenderKey = "";
	} catch (e) { /* abaikan */ }
}

function HasPlayableTrack() {
	if (!nowPlayingData.title || nowPlayingData.title === 'Unknown') return false;
	if (!nowPlayingData.artist || nowPlayingData.artist === 'Unknown') return false;
	return true;
}

// Apakah provider TikTok (TikFinity / IndoFinity) sedang terhubung. Panel viewer
// count memakai ini sebagai sumber kebenaran: selama terhubung, angka penonton
// dari event roomUser selalu valid - tidak perlu menunggu status live.
function IsTikTokProviderConnected() {
	return Boolean(
		(typeof tikFinityStatus !== 'undefined' && tikFinityStatus.connected) ||
		(typeof indoFinityStatus !== 'undefined' && indoFinityStatus.connected)
	);
}

const infoPanels = [
	{
		id: 'date',
		icon: ALERT_ICONS.calendar, // purple calendar
		ticks: false,
		text: () => {
			const dateFormat = urlParams.get("dateFormat") || "dddd, DD MMMM YYYY";
			if (typeof dayjs !== 'undefined') {
				return dayjs().format(dateFormat);
			}
			return new Date().toLocaleDateString('id-ID');
		}
	},
	{
		id: 'time',
		icon: ALERT_ICONS.clock, // purple clock
		ticks: true,
		text: () => GetTimeNowText()
	},
	{
		id: 'duration',
		icon: ALERT_ICONS.timer, // yellow stopwatch
		ticks: true,
		text: () => GetLiveDurationText()
	},
	{
		id: 'weather',
		icon: ALERT_ICONS.weather, // purple weather
		ticks: false,
		text: () => {
			if (weatherData) {
				return `${weatherData.desc} • ${weatherData.tempC}°C`;
			}
			return 'Cuaca tidak tersedia';
		}
	},
	{
		id: 'viewers',
		icon: ALERT_ICONS.viewers, // yellow eye
		ticks: false,
		text: () => {
			// Provider terhubung = angka penonton valid, lewati liveStatus (sumber terpisah).
			if (!IsTikTokProviderConnected() && liveStatus !== 2) return offlineViewersText;
			const n = FormatViewers(viewerCount ?? 0);
			// Ikuti pengaturan Language global (appLanguage): id = "penonton",
			// en = "viewers". Tidak ada default terpisah.
			const word = appLanguage === 'en' ? 'viewers' : 'penonton';
			return `${n} ${word}`;
		},
		// Simpan nilai mentah di data-viewers supaya angka aslinya tidak hilang setelah diformat.
		rawViewers: () => ((IsTikTokProviderConnected() || liveStatus === 2)
			? Math.max(0, Math.floor(Number(viewerCount) || 0))
			: 0)
	},
	{
		id: 'music',
		// Jangan tayangkan panel musik bila tidak ada lagu yang benar-benar diputar: pause
		// TETAP tayang (tampilan khusus: album art + overlay pause), tapi di-skip bila
		// bridge putus / metadata kosong. [NO FALLBACK] bila artwork tidak ada, panel musik
		// tidak tayang sama sekali - tidak ada ikon pengganti.
		skip: () => !HasPlayableTrack() || !nowPlayingData.albumArt,
		icon: () => nowPlayingData.albumArt,
		rightIcon: () => {
			const hexStr = encodeURIComponent(nowPlayingData.lightVibrant || "#8A2BE2");
			return `data:image/svg+xml;utf8,%3Csvg%20fill%3D%22${hexStr}%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%222%22%20y%3D%229%22%20width%3D%225%22%20height%3D%226%22%20rx%3D%222%22%3E%3Canimate%20attributeName%3D%22height%22%20values%3D%226%3B16%3B6%22%20begin%3D%220s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3Canimate%20attributeName%3D%22y%22%20values%3D%229%3B4%3B9%22%20begin%3D%220s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3C%2Frect%3E%3Crect%20x%3D%229%22%20y%3D%223%22%20width%3D%225%22%20height%3D%2218%22%20rx%3D%222%22%3E%3Canimate%20attributeName%3D%22height%22%20values%3D%2218%3B8%3B18%22%20begin%3D%220.2s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3Canimate%20attributeName%3D%22y%22%20values%3D%223%3B8%3B3%22%20begin%3D%220.2s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3C%2Frect%3E%3Crect%20x%3D%2216%22%20y%3D%227%22%20width%3D%225%22%20height%3D%2210%22%20rx%3D%222%22%3E%3Canimate%20attributeName%3D%22height%22%20values%3D%2210%3B18%3B10%22%20begin%3D%220.4s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3Canimate%20attributeName%3D%22y%22%20values%3D%227%3B3%3B7%22%20begin%3D%220.4s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3C%2Frect%3E%3C%2Fsvg%3E`;
		},
		ticks: true,
		// Marquee berdasarkan lebar piksel nyata, bukan hitungan karakter: teks melebihi
		// kapasitas pill -> hidupkan teks berjalan.
		isMarquee: () => MeasureIslandTextWidth(musicText()) > MARQUEE_MAX_WIDTH,
		// Satu jalur teks: play = judul • artis; pause = "Paused • m:ss". Perbedaan pause
		// hanya di sini (dan overlay ikon di CSS).
		text: () => (nowPlayingData.pausedAtMs !== null
			? 'Paused • ' + formatTimeMs(nowPlayingData.pausedAtMs)
			: musicText()),
	}
];

// Urutan rotasi info (settings: infoRotationOrder). Panel yang tidak dipilih
// dikeluarkan dari rotasi sama sekali.
(function ApplyInfoRotationOrder() {
	const raw = urlParams.get('infoRotationOrder');
	if (!raw) return;
	let order;
	try {
		order = JSON.parse(raw);
	} catch (e) {
		order = raw.split(',');
	}
	if (!Array.isArray(order) || order.length === 0) return;
	const sorted = [];
	order.forEach(id => {
		const panel = infoPanels.find(p => p.id === id);
		// Hindari dobel bila URL mengandung id yang sama dua kali.
		if (panel && !sorted.includes(panel)) sorted.push(panel);
	});
	if (sorted.length === 0) return;
	infoPanels.length = 0;
	sorted.forEach(p => infoPanels.push(p));
})();

// Teks panel musik (judul + artist)
function musicText() {
	// [FIX] Yang menentukan ada/tidaknya lagu adalah metadata, bukan status play: dulu
	// gerbangnya isPlaying, jadi saat pause teks berubah jadi "Tidak ada lagu difilter".
	if (HasPlayableTrack()) {
		const separator = nowPlayingData.artist && nowPlayingData.title ? ' • ' : '';
		return `${nowPlayingData.title}${separator}${nowPlayingData.artist}`;
	}
	return 'Tidak ada lagu difilter';
}

// Lebar maksimum teks pill sebelum marquee aktif: disamakan dengan panel tanggal
// (panel terpanjang) supaya pill musik tidak pernah lebih lebar dari panel info lain.
function ComputeMarqueeMaxWidth() {
	// Pill date: padding 20*2 + ikon 20 + gap 10 = 70px di luar teks; kapasitas musik
	// lebih kecil karena ada wave icon di kanan (20px + gap 10).
	// Metrik WAJIB sama dengan MeasureIslandTextWidth (probe DOM) - batas dan teks harus
	// diukur dengan metrik yang SATU dan sama.
	const dateTextW = MeasureDomTextWidth(infoPanels[0].text(), islandText);
	return Math.max(60, dateTextW - 30); // sisakan ruang wave icon
}
let MARQUEE_MAX_WIDTH = 250;
// Script berada di akhir body: DOM & font sudah siap, hitung langsung.
try {
	MARQUEE_MAX_WIDTH = ComputeMarqueeMaxWidth();
	document.documentElement.style.setProperty('--marquee-width', MARQUEE_MAX_WIDTH + 'px');
} catch (e) { /* fallback tetap 250 */ }

// Ukur lebar piksel teks dengan font #islandText saat ini.
// [NON-LATIN] WAJIB probe DOM, BUKAN canvas measureText: canvas tidak selalu
// menjalankan complex-script shaping yang sama (Thai, Devanagari, Arab, Ibrani, CJK
// kerap terukur lebih sempit) sehingga marquee tak pernah aktif. Probe juga dipakai
// ComputeMarqueeMaxWidth, jadi batas dan teks diukur dengan metrik yang sama.
function MeasureIslandTextWidth(str) {
	if (!str) return 0;
	return MeasureDomTextWidth(str, islandText);
}

// Satu-satunya fungsi ukur: probe <span> absolut, tersembunyi, nowrap,
// memakai font elemen acuan (default #islandText).
function MeasureDomTextWidth(str, refEl) {
	if (!str) return 0;
	const el = refEl || islandText || document.body;
	let probe = MeasureDomTextWidth._probe;
	if (!probe) {
		probe = document.createElement('span');
		// absolute + visibility:hidden -> tidak memengaruhi layout pill; nowrap -> satu baris.
		probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none;left:-9999px;top:0;';
		MeasureDomTextWidth._probe = probe;
	}
	// Salin properti font yang memengaruhi lebar (shorthand `font` me-reset
	// weight/style/variant dan bisa menimpa sizing).
	const cs = getComputedStyle(el);
	probe.style.fontFamily = cs.fontFamily;
	probe.style.fontSize = cs.fontSize;
	probe.style.fontWeight = cs.fontWeight;
	probe.style.fontStyle = cs.fontStyle;
	probe.style.fontVariant = cs.fontVariant;
	probe.style.letterSpacing = cs.letterSpacing;
	probe.style.fontStretch = cs.fontStretch;
	probe.style.textTransform = 'none';
	// textContent (bukan innerHTML) aman dari markup judul lagu.
	probe.textContent = str;
	if (probe.parentNode !== document.body) document.body.appendChild(probe);
	// Ambil presisi fraksional (offsetWidth dibulatkan) supaya shift marquee tidak meleset.
	const rect = probe.getBoundingClientRect();
	const w = (rect && rect.width) ? rect.width : probe.offsetWidth;
	return w || 0;
}

// Render teks island: marquee bila teks melebihi kapasitas, shift & durasi dihitung
// dari overflow nyata (selalu scroll kiri). Return HTML string.
function RenderIslandText(nextText, allowMarquee = false) {
	if (!allowMarquee) return nextText;
	const textW = MeasureIslandTextWidth(nextText);
	// Batas TUNGGAL dari CSS (--marquee-width), nilainya berbeda per mode. Karena batas
	// dan lebar container dibaca dari variabel yang sama, shift selalu pas dan teks
	// tidak pernah berjalan melewati wave icon.
	const limitW = GetMarqueeWidth();
	if (textW > limitW) {
		const shift = limitW - textW; // selalu negatif -> scroll kiri
		// Kecepatan konsisten ~50px/s: durasi proporsional panjang teks.
		const duration = Math.min(20, Math.max(6, Math.round(Math.abs(shift) / 50)));
		return `<span class="marquee-container"><span class="marquee-content" style="--marquee-shift:${shift.toFixed(1)}px;--marquee-duration:${duration}s">${nextText}</span></span>`;
	}
	return nextText;
}

// Baca batas marquee yang SEDANG BERLAKU dari CSS. Sumber kebenaran tunggal =
// --marquee-width, di-override per mode (lihat style.css), sehingga JS tidak perlu
// tahu mode apa yang sedang aktif.
function GetMarqueeWidth() {
	try {
		const el = dynamicIsland || document.documentElement;
		const v = parseFloat(getComputedStyle(el).getPropertyValue('--marquee-width'));
		if (v > 0) return v;
	} catch (e) { /* abaikan */ }
	return MARQUEE_MAX_WIDTH;
}

function ForceMusicPanelActive() {
	if (isAlertActive) return;
	const musicIdx = infoPanels.findIndex(p => p.id === 'music');
	if (musicIdx !== -1) {
		currentPanelIndex = musicIdx;
		StartCycleTimer(); 
		UpdateInfoText(true);
	}
}

function formatTimeMs(timeMs) {
	if (isNaN(timeMs) || timeMs <= 0) return "0:00";
	const totalSeconds = Math.floor(timeMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const paddedSeconds = ('0' + seconds).slice(-2);
	if (hours > 0) {
		const paddedMinutes = ('0' + minutes).slice(-2);
		return `${hours}:${paddedMinutes}:${paddedSeconds}`;
	}
	return `${minutes}:${paddedSeconds}`;
}

let scrubberAnimFrame = null;
function StartScrubberAnimation() {
	if (scrubberAnimFrame) cancelAnimationFrame(scrubberAnimFrame);
	
	const elCurr = document.getElementById('scrubberCurrent');
	const elTot = document.getElementById('scrubberTotal');
	const elFill = document.querySelector('.scrub-fill');
	const elThumb = document.querySelector('.scrub-thumb');

	// [PERF] Throttle scrubber: posisi hanya berubah per detik, jadi 250ms (4 fps) cukup.
	// Di Electron/TTLS yang berbagi GPU dengan encoding, menulis DOM 60x/detik bikin
	// marquee & wave icon tersendat.
	const SCRUBBER_INTERVAL_MS = 250;
	let lastPaintAt = 0;
	// [PERF] Simpan nilai terakhir: penulisan identik tetap memicu repaint.
	let lastCurr = null;
	let lastTot = null;
	let lastVisualPct = null;
	
	function loop() {
		// Stop animating if alert is no longer showing music big style
		if (!isAlertActive || !window.currentActiveAlertData || window.currentActiveAlertData.type !== 'music' || !enableDynamicStyleBig) {
			return; 
		}
		
		if (nowPlayingData.timeline) {
			const tp = nowPlayingData.timeline;
			// Pakai timestamp asli dari Windows SMTC Bridge agar posisi tersinkron (mengatasi stutter).
			let lastUpdateAnchor = Date.now();
			if (tp.LastUpdatedTime) {
				const parsed = Date.parse(tp.LastUpdatedTime.replace(' ', 'T'));
				if (!isNaN(parsed)) lastUpdateAnchor = parsed;
			}
			const driftMs = Date.now() - lastUpdateAnchor;
			
			// Bridge bisa mengirim Ticks (100ns); deteksi dari besaran angkanya.
			let pos = Number(tp.Position) || 0;
			let end = Number(tp.EndTime) || 0;
			// Konversi Tick -> ms bila endTime > 1 juta ms padahal ini lagu biasa.
			if (end > 864000000) { 
				pos = Math.floor(pos / 10000);
				end = Math.floor(end / 10000);
			}

			const currentPositionMs = end > 0 && nowPlayingData.isPlaying ? pos + driftMs : pos;
			const posMs = Math.max(0, Math.min(currentPositionMs, end));
			const totalMs = end;
			
			// [PERF] Throttle: hanya tulis DOM bila sudah lewat interval.
			const now = Date.now();
			if (now - lastPaintAt < SCRUBBER_INTERVAL_MS) {
				scrubberAnimFrame = requestAnimationFrame(loop);
				return;
			}
			lastPaintAt = now;

			const currStr = formatTimeMs(posMs);
			const totStr = formatTimeMs(totalMs);
			if (elCurr && currStr !== lastCurr) {
				elCurr.textContent = currStr;
				lastCurr = currStr;
			}
			if (elTot && totStr !== lastTot) {
				elTot.textContent = totStr;
				lastTot = totStr;
			}
			
			if (elFill && totalMs > 0) {
				const pct = (posMs / totalMs) * 100;
				// Posisikan matematis: visual mulai minimal dari 25% lebarnya, lalu bergerak ke 100%
				// saat lagu mendekati akhir.
				const visualPct = 25 + (pct * 0.75);
				// [PERF] Bulatkan ke 2 desimal: perubahan di bawah itu tak terlihat tapi tetap
				// memicu repaint.
				const roundedPct = Math.round(visualPct * 100) / 100;
				if (roundedPct !== lastVisualPct) {
					elFill.style.width = `${roundedPct}%`;
					if (elThumb) elThumb.style.left = `${roundedPct}%`;
					lastVisualPct = roundedPct;
				}
				// Progress bar polos: tidak ada pergantian blob wave.
			}
		}
		
		scrubberAnimFrame = requestAnimationFrame(loop);
	}
	
	loop();
}

// Durasi animasi .ambient-bounce di style.css (0.3s). Dipakai mencegah bounce
// di-restart oleh dua panggilan UpdateInfoText berurutan.
const AMBIENT_BOUNCE_MS = 300;
let lastAmbientBounceAt = 0;

// Tidak ada panel yang bisa tayang? Sembunyikan pill - lebih baik hilang daripada
// menampilkan teks fallback.
function SyncIslandVisibility() {
	if (!dynamicIsland) return;
	const anyVisible = infoPanels.some(p => !(p.skip && p.skip()));
	dynamicIsland.classList.toggle('island-no-panel', !anyVisible);
}

function CycleInfo() {
	if (isAlertActive) return;
	let attempts = 0;
	do {
		currentPanelIndex = (currentPanelIndex + 1) % infoPanels.length;
		attempts++;
	} while (infoPanels[currentPanelIndex].skip && infoPanels[currentPanelIndex].skip() && attempts < infoPanels.length);
	// Guard: bila SEMUA panel ter-skip, jangan biarkan pill menampilkan panel yang di-skip.
	if (infoPanels[currentPanelIndex].skip && infoPanels[currentPanelIndex].skip()) return;

	SyncIslandVisibility();
	UpdateInfoText();
}

function UpdateInfoText(animate = true, allowBounce = true) {
	if (isAlertActive) return;
	ApplyInfoPanel(animate, allowBounce);
}

// Segarkan ikon audio wave (warna lightVibrant) secara diam-diam. Dipakai di semua
// mode: ambient, senyap, dan pasca-alert.
function RefreshMusicWaveIcon(force = false) {
	if (isAlertActive && !force) return;
	const panel = infoPanels[currentPanelIndex];
	if (!panel || panel.id !== 'music' || !panel.rightIcon) return;
	if (islandEventIcon) {
		// Jangan set ulang src kalau warna belum berubah: set ulang me-restart animasi
		// <animate> di dalam SVG (wave jadi patah-patah).
		const nextSrc = typeof panel.rightIcon === 'function' ? panel.rightIcon() : panel.rightIcon;
		if (force || islandEventIcon.src !== nextSrc) {
			islandEventIcon.src = nextSrc;
		}
		islandEventIcon.classList.remove('hidden');
	}
}

// Perbarui panel penonton TANPA animasi bounce.
// Dipakai oleh poll deteksi live, tick per detik, dan pembaruan viewer count
// supaya tampilan tidak berkedut terus-menerus.
function RefreshInfoText() {
	if (isAlertActive) return;
	ApplyInfoPanel(false);
}

// Terapkan perubahan jumlah penonton: HANYA bila panel penonton sedang tampil
// (index 4), dan tanpa bounce supaya animasi masuk tidak dipicu ulang.
function UpdateViewerCount() {
	if (isAlertActive) return;

	const panel = infoPanels[currentPanelIndex];
	if (!panel || panel.id !== 'viewers') return; // panel lain: diam

	if (typeof panel.rawViewers === 'function') {
		islandText.dataset.viewers = String(panel.rawViewers());
	}

	const nextText = panel.text();
	if (islandText.textContent !== nextText) {
		islandText.textContent = nextText;
	}
}

function ApplyInfoPanel(animate, allowBounce = true) {
	if (isAlertActive) return;
	const panel = infoPanels[currentPanelIndex];
	if (!panel) return;

	const nextText = panel.text();

	// -- SATU-SATUNYA penanda pause --
	// Panel ambient musik = SATU panel. Pause HANYA mengubah: 1) class pill
	// `music-paused` -> overlay pause (CSS), 2) teks -> "Paused • m:ss". Wave icon,
	// marquee, ikon, dan jalur render SAMA PERSIS seperti saat play.
	if (dynamicIsland) {
		dynamicIsland.classList.toggle('music-paused',
			panel.id === 'music' && nowPlayingData.pausedAtMs !== null);
		// Warna aksen untuk icon pause. Hanya panel ambient - dynamic big tidak disentuh.
		if (panel.id === 'music' && !dynamicIsland.classList.contains('alert-music-big')) {
			dynamicIsland.style.setProperty('--accent-color',
				nowPlayingData.lightVibrant || '#8A2BE2');
		}
	}

	// Mode senyap: tulis ulang teks bila benar-benar berubah. Tidak menyentuh elemen
	// lain dan tidak memicu animasi.
	if (!animate) {
		// Panel musik butuh RenderIslandText: marquee hidup dari innerHTML terstruktur.
		// Menulis textContent saja membuat marquee tak aktif saat panel digambar ulang.
		if (panel.id === 'music') {
			const nextHtml = RenderIslandText(nextText, true);
			if (islandText.innerHTML !== nextHtml) {
				islandText.innerHTML = nextHtml;
			}
		} else if (islandText.textContent !== nextText) {
			islandText.textContent = nextText;
		}
		RefreshMusicWaveIcon();
		return;
	}

	// Mode rotasi / render awal: isi ulang panel + animasi fade/bounce pada teks.
	islandText.innerHTML = RenderIslandText(nextText, panel.id === 'music');

	// Fade/bounce-in halus pada teks saat panel berganti + bounce pill yang sangat tipis
	// (ambient-bounce), jika diizinkan.
	islandText.classList.remove('bounce-in');
	void islandText.offsetWidth; // restart animasi
	islandText.classList.add('bounce-in');
	
	// Bounce pill TIPIS saat panel berganti. [OBS] JANGAN restart kalau bounce masih
	// berjalan: saat keluar music big, UpdateInfoText dipanggil dua kali - di Chrome
	// jatuh di frame sama (satu animasi), di OBS jatuh di frame berbeda (bounce ganda).
	if (allowBounce && (Date.now() - (lastAmbientBounceAt || 0)) < AMBIENT_BOUNCE_MS) {
		// bounce sebelumnya masih berjalan: biarkan, jangan di-restart
	} else {
		dynamicIsland.classList.remove('ambient-bounce');
		void dynamicIsland.offsetWidth;
		if (allowBounce) {
			lastAmbientBounceAt = Date.now();
			dynamicIsland.classList.add('ambient-bounce');
		}
	}

	islandIcon.src = typeof panel.icon === 'function' ? panel.icon() : panel.icon;
	if (panel.id === 'music' && nowPlayingData.albumArt && nowPlayingData.albumArt !== "") {
		islandIcon.classList.add('rounded-icon');
	} else {
		islandIcon.classList.remove('rounded-icon');
	}
	
	// [NO FALLBACK] Tidak ada ikon pengganti untuk artwork: panel musik
	// hanya dirender bila artwork benar-benar ada (lihat skip di atas).
	// onerror di-null-kan supaya handler panel SEBELUMNYA tidak menempel.
	islandIcon.onerror = null;
	islandIcon.classList.remove('hidden');
	SyncIconWrapHidden();

	// Simpan nilai mentah di span.dataset.viewers untuk inspeksi/debug (dan siap bila
	// nanti perlu menjumlahkan penonton lintas platform).
	if (typeof panel.rawViewers === 'function') {
		islandText.dataset.viewers = String(panel.rawViewers());
	} else if (islandText.dataset.viewers) {
		delete islandText.dataset.viewers;
	}

	if (islandAvatar) {
		islandAvatar.classList.add('hidden');
		islandAvatar.src = '';
	}
	if (islandSubtext) {
		islandSubtext.classList.add('hidden');
		islandSubtext.textContent = '';
	}
	
	// Mode pause panel musik: overlay pause menutupi album art, wave icon disembunyikan.
	// Diterapkan di atas blok mode senyap supaya berlaku di SEMUA mode render.
	if (islandEventIcon && panel.rightIcon) {
		const nextRight = typeof panel.rightIcon === 'function' ? panel.rightIcon() : panel.rightIcon;
		if (islandEventIcon.__gesekiRightSrc !== nextRight) {
			islandEventIcon.__gesekiRightSrc = nextRight;
			islandEventIcon.src = nextRight;
		}
		islandEventIcon.classList.remove('hidden');
	} else if (islandEventIcon) {
		islandEventIcon.classList.add('hidden');
		islandEventIcon.src = '';
		islandEventIcon.__gesekiRightSrc = '';
	}

	// Animations on text/icons removed to prevent glitches
}

async function FetchNowPlaying() {
	if (!enableNowPlaying) {
		nowPlayingData.isPlaying = false;
		return;
	}

	try {
		const response = await fetch(SMTC_BRIDGE_URL);
		if (!response.ok) throw new Error("Bridge offline");

		const data = await response.json();

		ApplyNowPlayingData(data);
	} catch (error) {
		nowPlayingData.isPlaying = false;
		// Bridge putus -> koneksi berikutnya dianggap sesi baru (lagu pertama tidak lagi
		// dianggap "ganti lagu").
		nowPlayingData._seeded = false;
	}
}

// Dekode artwork di luar DOM untuk memastikan gambar valid & bisa digambar.
// Dipakai penundaan alert song change: alert tidak tayang sebelum artwork siap.
function DecodeArtwork(src) {
	return new Promise((resolve) => {
		const img = new Image();
		let done = false;
		const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
		// Timeout: jangan biarkan decode menggantung (fetch jalan tiap 1 detik, tick
		// berikutnya mencoba lagi).
		const timer = setTimeout(() => finish(false), 3000);
		img.onload = () => { clearTimeout(timer); finish(img.naturalWidth > 0 && img.naturalHeight > 0); };
		img.onerror = () => { clearTimeout(timer); finish(false); };
		img.src = src;
	});
}

// Inti pemrosesan now playing. Dipanggil dari fetch lokal.
async function ApplyNowPlayingData(data) {

	{
		// Parse and clean settings arrays
		const includedList = includedApplications
			? includedApplications.split(',').map(app => app.trim().toLowerCase()).filter(Boolean)
			: [];
		const excludedList = excludedApplications
			? excludedApplications.split(',').map(app => app.trim().toLowerCase()).filter(Boolean)
			: [];

		// Filter out any sessions belonging to excluded apps
		const validSessions = data.sessions.filter(s => {
			const appId = (s.source_app_id || "").toLowerCase();
			return !excludedList.some(excluded => appId.includes(excluded));
		});

		let targetSession = null;

		// Priority Check: Jika ada included apps, cari yang cocok dan sedang tayang.
		if (includedList.length > 0) {
			for (const targetApp of includedList) {
				targetSession = validSessions.find(s => {
					const matchesApp = (s.source_app_id || "").toLowerCase().includes(targetApp);
					const isPlaying = s.playback_info && s.playback_info.PlaybackStatus === 4;
					return matchesApp && isPlaying;
				});
				if (targetSession) break;
			}
			// Jatuh kembali (fallback) walau sedang pause (opsional).
			if (!targetSession) {
				for (const targetApp of includedList) {
					targetSession = validSessions.find(s => (s.source_app_id || "").toLowerCase().includes(targetApp));
					if (targetSession) break;
				}
			}
		} else {
			// Fallback tanpa included list:
			// Priority 1: pakai current_session_id dari bridge (Windows focused session)
			if (data.current_session_id) {
				targetSession = validSessions.find(s => s.source_app_id === data.current_session_id);
			}

			// Priority 2: jika current session tidak valid/pause, cari session yang PLAYING
			if (!targetSession || targetSession.playback_info?.PlaybackStatus !== PlaybackStatus.PLAYING) {
				const playingSession = validSessions.find(s => s.playback_info && s.playback_info.PlaybackStatus === PlaybackStatus.PLAYING);
				if (playingSession) targetSession = playingSession;
			}

			// Priority 3: fallback terakhir ke session valid pertama.
			if (!targetSession && validSessions.length > 0) {
				targetSession = validSessions[0];
			}
		}

		// [PENTING] Timeline & metadata diisi untuk SEMUA status (play/pause). Dulu hanya
		// saat PLAYING, jadi saat pause `timeline` masih milik lagu terakhir -> posisi
		// pause selalu salah.
		if (targetSession) {
			nowPlayingData.timeline = targetSession.timeline_properties;
		}

		if (targetSession && targetSession.playback_info?.PlaybackStatus === PlaybackStatus.PLAYING) {
			nowPlayingData.isPlaying = true;
			// Lagu main lagi -> keluar dari mode pause.
			nowPlayingData.pausedAtMs = null;
			SavePauseState();
			const nextTitle = targetSession.media_properties?.Title || "Unknown";
			const nextArtist = targetSession.media_properties?.Artist || "Unknown";

			// Masalah #1: jangan tampilkan alert song-change untuk metadata kosong. PENTING:
			// jangan reset _lastSongId di sini - SMTC sering melapor "Unknown" 1-2 detik
			// sebelum metadata asli tiba; kalau di-reset, alert HILANG saat metadata lengkap.
			const isUnknownMeta = (nextTitle === "Unknown" || nextArtist === "Unknown");
			if (isUnknownMeta) {
				return;
			}

			const newArt = targetSession.media_properties?.Thumbnail || targetSession.media_properties?.ThumbnailBase64 || "";

			// [WAIT ARTWORK] Artwork harus benar-benar BISA DIGAMBAR sebelum commit: base64
			// potongan / data URL invalid bikin palet jatuh ke fallback. Karena itu artwork
			// di-DECODE DULU; gagal -> simpan keinginan alert, data lama utuh, coba lagi.
			if (!newArt || newArt === "") {
				nowPlayingData._pendingSongAlert = nextTitle + "-" + nextArtist;
				return;
			}

			const artReady = await DecodeArtwork(newArt);
			if (!artReady) {
				nowPlayingData._pendingSongAlert = nextTitle + "-" + nextArtist;
				return;
			}

			nowPlayingData.title = nextTitle;
			nowPlayingData.artist = nextArtist;
			// Simpan metadata valid untuk dipulihkan setelah reload.
			SaveTrackMeta();

			// DUA key, dua keperluan:
			// 1) songIdKey = Title-Artist -> penentu ganti lagu, kebal terhadap artwork yang
			//                datang terlambat.
			const songIdKey = nowPlayingData.title + "-" + nowPlayingData.artist;
			// 2) currentSongKey = Title-Artist-Thumbnail -> khusus guard race palet.
			const currentSongKey = songIdKey + "-" + newArt;
			const expectedKeyOnFinish = currentSongKey;

			// songChanged murni dari identitas lagu, bukan thumbnail. [Seed] Bacaan AKTIF
			// pertama hanya MENANAM key - tanpa ini, lagu yang sedang berjalan langsung
			// dianggap "ganti lagu" begitu bridge connect.
			if (!nowPlayingData._seeded) {
				nowPlayingData._seeded = true;
				nowPlayingData._lastSongId = songIdKey;
				nowPlayingData._lastSongKey = currentSongKey;
				return;
			}
			// PENEMBAK ULANG alert yang ditunda: artwork sudah ada -> paksa songChanged agar
			// alert tayang SEKALI.
			const pendingSongAlert = nowPlayingData._pendingSongAlert || null;
			if (pendingSongAlert && pendingSongAlert === songIdKey) {
				nowPlayingData._pendingSongAlert = null;
			}
			// [ANTI DOBEL] Penjaga absolut: lagu ini sudah pernah ditembak -> JANGAN tembak
			// lagi, apa pun alasannya. _pendingSongAlert dibersihkan dulu supaya tidak
			// menggantung dan menembak ulang di tick berikutnya.
			const alreadyAlerted = (songIdKey === nowPlayingData._lastAlertedSongId);
			if (alreadyAlerted) {
				nowPlayingData._pendingSongAlert = null;
			}
			const songChanged = !alreadyAlerted
				&& ((!!nowPlayingData._lastSongId && songIdKey !== nowPlayingData._lastSongId)
					|| pendingSongAlert === songIdKey);
			nowPlayingData._lastSongId = songIdKey;
			nowPlayingData._lastSongKey = currentSongKey;

			// TUNGGU palet selesai DULU, tanpa syarat, sebelum menilai status playback maupun
			// ganti lagu. `await` ini sekaligus menjadi mekanisme "tunggu album art benar-benar
			// ada". Normalisasi base64 SMTC -> data URL; tanpa artwork artUrl tetap ''.
			let artUrl = newArt;
			if (newArt && newArt.length > 100 && !newArt.startsWith("http") && !newArt.startsWith("data:")) {
				artUrl = "data:image/jpeg;base64," + newArt;
			}
			// Palet diekstrak dari artwork nyata. Bila tidak ada artwork, palet dikosongkan -
			// dipulihkan dari catch di bawah.
			const paletteSource = artUrl;
			nowPlayingData.albumArt = artUrl;

			const prevLightVibrant = nowPlayingData.lightVibrant;

			try {
				const hexPalette = await GetAccentPaletteCached(paletteSource);

				// [Race Condition Fix] Spam 'Next' cepat: lagu bisa terganti LAGI saat ekstraksi
				// palet berjalan. Bila key lagu sudah usang, batalkan perwujudan warna & alert ini.
				if (nowPlayingData._lastSongKey !== expectedKeyOnFinish) return;

				nowPlayingData.palette = hexPalette;
				// Warna accent mengikuti role pilihan user (settings: accentPaletteRole).
				// ResolveAccentColor() sudah menangani fallback bila role tidak ada di palet.
				nowPlayingData.lightVibrant = ResolveAccentColor(hexPalette);
			} catch (e) {
				if (nowPlayingData._lastSongKey !== expectedKeyOnFinish) return;
				nowPlayingData.lightVibrant = nowPlayingData.lightVibrant || "#8A2BE2";
			}

			// Segarkan wave icon HANYA bila warna benar-benar berubah: force=true me-restart
			// animasi SMIL <animate>, sehingga memanggilnya tiap tick bikin wave berkedut.
			if (nowPlayingData.lightVibrant !== prevLightVibrant) {
				RefreshMusicWaveIcon(true);
			}

			SyncIslandVisibility();

			// Data sudah benar-benar siap (metadata + palet): langsung ChangeTrack tanpa
			// setTimeout debounce.
			if (songChanged) {
				nowPlayingData._pendingSongAlert = null;
				// Tandai SEBELUM TriggerAlert: satu songId = satu alert.
				nowPlayingData._lastAlertedSongId = songIdKey;
				const musicPanel = infoPanels.find(p => p.id === 'music');
				// Dua mode judul (bergantung enableDynamicStyleBig):
				// - Big ON : judul SAJA - artist sudah tampil di baris #islandSubtext.
				// - Big OFF: "judul • artis" - tidak ada subtext, artis wajib inline atau hilang.
				const alertText = enableDynamicStyleBig ? nowPlayingData.title : musicText();
				TriggerAlert({
					type: 'music',
					// Artwork sudah pasti ada: alert song change ditunda sampai thumbnail tiba.
					icon: nowPlayingData.albumArt,
					rightIcon: musicPanel.rightIcon,
					text: alertText,
					// WAJIB sertakan artis: update in-place menulis `alertData.subtext || ''`, kalau
					// tidak dikirim nama artis hilang saat lagu ganti di tengah antrean.
					subtext: enableDynamicStyleBig ? (nowPlayingData.artist || '') : ''
				});
				// JANGAN panggil ForceMusicPanelActive(): itu memaksa panel musik aktif dan
				// melompati antrean. Biarkan TriggerAlert mengantre.
			} else if (infoPanels[currentPanelIndex].id === 'music') {
				// [PERF] Jangan render ulang tiap tick (fetch jalan tiap 1 detik): menggambar ulang
				// panel aktif tiap kali membuat overlay pause & teks berkedip. Bandingkan dulu.
				// JANGAN gambar ulang saat song change sedang tayang (music big): menimpa judul,
				// artwork, dan palet kartu besar -> tampilan berkedip.
				// Biarkan antrean alert yang mengatur tampilan itu.
				const bigBusy = isAlertActive ||
					(dynamicIsland && dynamicIsland.classList.contains('alert-music-big'));
				if (bigBusy) {
					// Tetap simpan kunci render supaya setelah kartu besar selesai, panel ambient
					// langsung sinkron.
					nowPlayingData._lastRenderKey = [
						nowPlayingData.albumArt || '',
						nowPlayingData.title || '',
						nowPlayingData.artist || '',
						nowPlayingData.lightVibrant || '',
						nowPlayingData.pausedAtMs === null ? 'play' : 'pause'
					].join('|');
					return;
				}
				const renderKey = [
					nowPlayingData.albumArt || '',
					nowPlayingData.title || '',
					nowPlayingData.artist || '',
					nowPlayingData.lightVibrant || '',
					nowPlayingData.pausedAtMs === null ? 'play' : 'pause'
				].join('|');
				if (renderKey !== nowPlayingData._lastRenderKey) {
					nowPlayingData._lastRenderKey = renderKey;
					UpdateInfoText(false);
				}
			}
		} else {
			const wasPlaying = nowPlayingData.isPlaying;
			nowPlayingData.isPlaying = false;
			// [JANGAN hapus albumArt] Panel musik versi pause butuh artwork + overlay pause.
			// Simpan posisi pause untuk label "Paused • m:ss".
			if (targetSession && nowPlayingData.timeline) {
				const tp = nowPlayingData.timeline;
				const end = Number(tp.EndTime) || 0;
				let pos = Number(tp.Position) || 0;
				if (end > 864000000) pos = Math.floor(pos / 10000);
				nowPlayingData.pausedAtMs = Math.max(0, pos);
			SavePauseState();
			}
			if (!targetSession) {
				nowPlayingData.albumArt = "";
				nowPlayingData.pausedAtMs = null;
			}

			// Lagu dimatikan SAAT panel musik tayang -> sela putarannya (skip) agar teks
			// 'Tidak ada lagu' tidak pernah muncul.
			// Panel musik yang sedang tayang HARUS digambar ulang saat status berubah: pause ->
			// overlay + "Paused • m:ss", play -> judul/artis + wave icon. Tanpa ini pill membeku
			// di tampilan terakhir sampai rotasi berganti panel.
			if (infoPanels[currentPanelIndex] && infoPanels[currentPanelIndex].id === 'music') {
				UpdateInfoText(false);
			} else if (wasPlaying) {
				CycleInfo();
			}
			SyncIslandVisibility();
		}
	}
}

function StartCycleTimer() {
	StopCycleTimer();
	cycleTimer = setInterval(() => {
		if (!isAlertActive) {
			CycleInfo();
		}
	}, infoCycleDuration);
	StartSecondTicker();
}

function StopCycleTimer() {
	if (cycleTimer) {
		clearInterval(cycleTimer);
		cycleTimer = null;
	}
	StopSecondTicker();
}

function StartSecondTicker() {
	StopSecondTicker();
	secondTicker = setInterval(() => {
		if (isAlertActive) return;
		const currentPanel = infoPanels[currentPanelIndex];
		if (currentPanel && currentPanel.ticks) {
			// Jam berdetak tiap detik: perbarui teks saja, tanpa bounce.
			RefreshInfoText();
		}
	}, 1000);
}

function StopSecondTicker() {
	if (secondTicker) {
		clearInterval(secondTicker);
		secondTicker = null;
	}
}

/////////////////////////////////////////////
// TIKTOK LIVE STUDIO - DETEKSI STATUS LIVE //
/////////////////////////////////////////////

// Protokol Stream Deck LIVE Studio (terverifikasi di 1.35.2).
// Port tidak tetap; LIVE Studio memilih salah satu dari daftar ini.
const LIVE_STUDIO_PORTS = [28189, 39728, 34246, 42205, 38534, 40825, 40622];
const LS_SOCKET_PATH = '/socket.io/';
const LS_SOCKET_PROTOCOL = 'streamdeck_ttls_v1';
const LS_EVENT_JOIN_ROOM = 'stream_deck/join_room';
const LS_EVENT_SYNC_SETTINGS = 'stream_deck/sync_settings';

const LS_STATUS = { offline: 0, paused: 1, live: 2 };
const LS_POLL_INTERVAL = 2500;      // status tidak di-push, harus dipoll
const LS_RETRY_INTERVAL = 10000;    // jeda bila belum terhubung
const LS_STORAGE_KEY = 'geseki-live-started-at';
const LS_MAX_AGE = 12 * 60 * 60 * 1000; // localStorage dianggap basi setelah 12 jam

let lsSocket = null;
let lsPollTimer = null;
let lsRetryTimer = null;
let lsEndpoint = null;

// localStorage: simpan waktu mulai supaya reload OBS tidak mereset durasi.
function LoadStoredStartMs() {
	try {
		const raw = localStorage.getItem(LS_STORAGE_KEY);
		if (!raw) return null;
		const ms = parseInt(raw, 10);
		if (!isFinite(ms)) return null;
		if (Date.now() - ms > LS_MAX_AGE) {
			localStorage.removeItem(LS_STORAGE_KEY);
			return null;
		}
		return ms;
	} catch (e) {
		return null; // localStorage bisa diblokir (mode private / OBS)
	}
}

function SaveStartMs(ms) {
	try {
		localStorage.setItem(LS_STORAGE_KEY, String(ms));
	} catch (e) {
		console.debug('[Geseki][LiveDetect] localStorage tidak tersedia:', e);
	}
}

function ClearStoredStartMs() {
	try {
		localStorage.removeItem(LS_STORAGE_KEY);
	} catch (e) { /* abaikan */ }
}

// Terapkan perubahan status. startOverrideMs: waktu mulai eksplisit (uji coba).
function ApplyLiveStatus(nextStatus, startOverrideMs) {
	const prev = liveStatus;
	const changed = prev !== nextStatus;
	liveStatus = nextStatus;

	if (nextStatus === LS_STATUS.live) {
		if (startOverrideMs !== undefined && startOverrideMs !== null) {
			// Nilai eksplisit selalu menang (dipakai untuk uji coba).
			liveStartedAtMs = startOverrideMs;
			liveStartFromStorage = false;
			SaveStartMs(liveStartedAtMs);
		} else if (liveStartedAtMs === null) {
			// Belum punya waktu mulai -> sesi live baru (atau widget baru load), pakai waktu
			// sekarang. Cukup cek `liveStartedAtMs === null`; JANGAN pakai penanda
			// liveStartFromStorage di kondisi ini - penanda itu khusus startup, dan
			// menggunakannya membuat poll berikutnya (tiap 2.5 detik) terus menghitung ulang
			// waktu mulai.
			liveStartedAtMs = Date.now();
			liveStartFromStorage = false;
			SaveStartMs(liveStartedAtMs);
		}
		// else: liveStartedAtMs sudah ada -> pertahankan, jangan pernah diubah oleh polling.
		//        Inilah yang membuat durasi terus bertambah.
		if (prev !== LS_STATUS.live) {
			console.debug('[Geseki][LiveDetect] LIVE, start =', new Date(liveStartedAtMs).toLocaleString('id-ID'));
			// Live BARU dimulai dari aplikasi (bukan reload): bersihkan riwayat first chatter.
			if (typeof ResetFirstChatter === 'function') ResetFirstChatter();
		}
	} else if (prev === LS_STATUS.live || liveStartFromStorage) {
		// Live berakhir, ATAU terbukti bukan reload (status pertama = offline). Reset supaya
		// sesi berikutnya menghitung dari nol.
		liveStartedAtMs = null;
		liveStartFromStorage = false;
		ClearStoredStartMs();
		viewerCount = null;
		console.debug('[Geseki][LiveDetect] Tidak live, status =', nextStatus);
	}

	// Segarkan tampilan HANYA bila status benar-benar berubah: poll tiap 2.5 detik,
	// tanpa penjaga ini widget akan bounce terus walau statusnya sama.
	if (!changed || isAlertActive) return;

	const panel = infoPanels[currentPanelIndex];
	if (panel && (panel.id === 'duration' || panel.id === 'viewers')) {
		// Transisi live <-> offline memang layak dapat animasi, karena panel berpindah antara
		// "Stream Offline" dan "Live - ...".
		UpdateInfoText();
	}
}

function ParseSyncSettings(data) {
	let state = data;
	if (typeof state === 'string') {
		try {
			state = JSON.parse(state);
		} catch (e) {
			return null;
		}
	}
	if (!state || typeof state !== 'object') return null;
	return state;
}

function PollLiveStatus() {
	if (!lsSocket || !lsSocket.connected) return;
	lsSocket.once(LS_EVENT_SYNC_SETTINGS, (data) => {
		const state = ParseSyncSettings(data);
		if (!state || state.stream_status === undefined) return;
		ApplyLiveStatus(Number(state.stream_status));
	});
	lsSocket.emit(LS_EVENT_SYNC_SETTINGS);
}

function StopLivePolling() {
	if (lsPollTimer) {
		clearInterval(lsPollTimer);
		lsPollTimer = null;
	}
	if (lsRetryTimer) {
		clearTimeout(lsRetryTimer);
		lsRetryTimer = null;
	}
	if (lsSocket) {
		try {
			lsSocket.removeAllListeners();
			lsSocket.close();
		} catch (e) { /* abaikan */ }
		lsSocket = null;
	}
	lsEndpoint = null;
}

function ConnectLiveStudio(portIndex) {
	// socket.io-client dimuat dari CDN; bila gagal, deteksi dilewati.
	if (typeof io === 'undefined') {
		console.debug('[Geseki][LiveDetect] socket.io-client tidak tersedia, deteksi dilewati.');
		ScheduleLiveRetry(0);
		return;
	}

	const ports = liveStudioPort > 0 ? [liveStudioPort] : LIVE_STUDIO_PORTS;
	if (portIndex >= ports.length) {
		// Semua port gagal -> ulangi dari port PERTAMA.
		// Dulu meneruskan `portIndex` (sudah di luar rentang), sehingga
		// ScheduleLiveRetry memanggil ConnectLiveStudio(7) yang langsung
		// kembali ke sini: terjebak selamanya tanpa pernah memindai port
		// 0-6 lagi. Akibatnya deteksi baru jalan setelah halaman
		// di-refresh — itu satu-satunya saat pemindaian penuh terjadi.
		ScheduleLiveRetry(0);
		return;
	}

	const port = ports[portIndex];
	const url = `ws://127.0.0.1:${port}`;
	let socket = null;

	try {
		socket = io(url, {
			path: LS_SOCKET_PATH,
			transports: ['websocket'],
			protocols: [LS_SOCKET_PROTOCOL],
			autoConnect: false,
			reconnection: false,
			timeout: 2500
		});
	} catch (e) {
		console.debug(`[Geseki][LiveDetect] Gagal membuat socket port ${port}:`, e);
		ConnectLiveStudio(portIndex + 1);
		return;
	}

	const connectTimer = setTimeout(() => {
		try {
			socket.close();
		} catch (e) { /* abaikan */ }
		console.debug(`[Geseki][LiveDetect] Timeout port ${port}, coba port berikutnya.`);
		ConnectLiveStudio(portIndex + 1);
	}, 3500);

	socket.once('connect', () => {
		clearTimeout(connectTimer);
		lsSocket = socket;
		lsEndpoint = url;
		console.debug(`[Geseki][LiveDetect] Terhubung ke LIVE Studio di ${url}`);

		socket.emit(LS_EVENT_JOIN_ROOM);

		// Baca status pertama kali, lalu poll berkala.
		PollLiveStatus();
		if (lsPollTimer) clearInterval(lsPollTimer);
		lsPollTimer = setInterval(PollLiveStatus, LS_POLL_INTERVAL);
	});

	socket.once('connect_error', (err) => {
		clearTimeout(connectTimer);
		try {
			socket.close();
		} catch (e) { /* abaikan */ }
		console.debug(`[Geseki][LiveDetect] Port ${port} menolak koneksi:`, err && err.message);
		ConnectLiveStudio(portIndex + 1);
	});

	socket.on('disconnect', (reason) => {
		console.debug('[Geseki][LiveDetect] Terputus:', reason);
		if (lsPollTimer) {
			clearInterval(lsPollTimer);
			lsPollTimer = null;
		}
		if (reason !== 'io client disconnect') {
			ScheduleLiveRetry(0);
		}
	});

	socket.connect();
}

function ScheduleLiveRetry(portIndex) {
	if (lsRetryTimer) clearTimeout(lsRetryTimer);
	lsRetryTimer = setTimeout(() => {
		lsRetryTimer = null;
		ConnectLiveStudio(portIndex > 0 ? portIndex : 0);
	}, LS_RETRY_INTERVAL);
}

function InitLiveDetection() {
	if (!enableLiveDetect) {
		// Deteksi mati: tidak ada sumber waktu mulai lain, jadi selalu anggap live dan hitung
		// dari widgetStartTime - durasi akan nol tiap kali OBS me-reload source.
		console.debug('[Geseki][LiveDetect] Dinonaktifkan lewat pengaturan.');
		liveStatus = LS_STATUS.live;
		liveStartedAtMs = widgetStartTime;
		UpdateInfoText();
		return;
	}

	// Default "belum diketahui" (null), BUKAN offline. Kalau status pertama terbaca live,
	// kita tidak tahu itu reload di tengah sesi atau sesi baru.
	liveStatus = null;

	// Pulihkan waktu mulai dari localStorage: khusus widget di-reload di tengah sesi live
	// yang sama (OBS suka me-reload browser source). Dibuang bila ternyata sesi baru.
	if (liveStartedAtMs === null) {
		const stored = LoadStoredStartMs();
		if (stored !== null) {
			liveStartedAtMs = stored;
			liveStartFromStorage = true;
		}
	}

	ConnectLiveStudio(0);
}

// Muat socket.io-client dari CDN, lalu mulai deteksi.
function LoadSocketIoAndDetect() {
	if (typeof io !== 'undefined') {
		InitLiveDetection();
		return;
	}
	const script = document.createElement('script');
	script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
	script.onload = () => {
		console.debug('[Geseki][LiveDetect] socket.io-client siap.');
		InitLiveDetection();
	};
	script.onerror = () => {
		console.debug('[Geseki][LiveDetect] Gagal memuat socket.io-client, deteksi dilewati.');
	};
	document.head.appendChild(script);
}

// Fetch live data in the background (standard 15-minute interval)
const WEATHER_REFRESH_INTERVAL = 15 * 60 * 1000;

async function FetchWeather() {
	try {
		const isId = (appLanguage && appLanguage.toLowerCase().startsWith("id"));
		const langQuery = isId ? "&lang=id" : "";
		const response = await fetch(`https://wttr.in/${encodeURIComponent(weatherLocation)}?format=j1${langQuery}`);
		const data = await response.json();
		const condition = data.current_condition[0];
		
		let weatherDesc = condition.weatherDesc[0].value;
		if (isId) {
			if (condition.lang_id && condition.lang_id[0]) {
				weatherDesc = condition.lang_id[0].value;
			}
			// Manual fallback dictionary for wttr.in untranslated terms (mostly smog/haze in Asia)
			const dictMap = {
				"smog": "Kabut Asap",
				"smoky haze": "Kabut Asap",
				"haze": "Kabut",
				"mist": "Kabut Tipis",
				"partly cloudy": "Cerah Berawan",
				"cloudy": "Berawan", 
				"overcast": "Mendung",
				"clear": "Cerah",
				"sunny": "Cerah",
				"light rain": "Hujan Ringan",
				"moderate rain": "Hujan Sedang",
				"heavy rain": "Hujan Lebat",
				"light drizzle": "Gerimis",
				"patchy rain possible": "Potensi Hujan"
			};
			const lowerDesc = weatherDesc.trim().toLowerCase();
			if (dictMap[lowerDesc]) {
				weatherDesc = dictMap[lowerDesc];
			}
		}

		weatherData = {
			tempC: condition.temp_C,
			desc: weatherDesc
		};
	} catch (error) {
		console.debug("[Geseki] Weather data fetch failed:", error);
	}
}

// Tunggu paling lama `ms`, lalu lanjut apa pun hasilnya: kalau jaringan mati, widget
// tetap tayang (teks fallback) daripada tidak pernah menggambar apa pun.
function WithTimeout(promise, ms) {
	return Promise.race([
		Promise.resolve(promise),
		new Promise(resolve => setTimeout(resolve, ms))
	]);
}

// Ambil SEMUA data panel dulu, baru gambar pill pertama.
// RIWAYAT (jangan diulang): dulu fetch dipanggil lalu langsung UpdateInfoText()
// tanpa await, jadi panel pertama selalu digambar SEBELUM data balik -> teks fallback
// yang tampil. Menambah `skip` per panel BUKAN solusi: itu menyembunyikan panel,
// bukan mengisi datanya tepat waktu.
async function InitInfoLoop() {
	// Deteksi live dijalankan SEBELUM menunggu data panel. Dulu ia
	// dipanggil setelah `await` 2,5 detik, jadi deteksi baru mulai
	// beberapa detik setelah widget tayang.
	LoadSocketIoAndDetect();

	// Isi dulu, tanpa menggambar apa pun.
	await WithTimeout(Promise.all([FetchWeather(), FetchNowPlaying()]), 2500);

	setInterval(FetchWeather, WEATHER_REFRESH_INTERVAL);
	setInterval(FetchNowPlaying, 1000); // FetchNowPlaying = 1000ms

	// Baru gambar: data sudah tersedia untuk semua panel.
	UpdateInfoText();
	StartCycleTimer();
	// Pill disembunyikan sejak frame pertama (class island-no-panel) supaya teks
	// "Loading..." tanpa icon tidak pernah terlihat. Sekarang data siap -> tampilkan
	// (atau biarkan tersembunyi bila tidak ada panel yang bisa tayang).
	SyncIslandVisibility();
	// Deteksi status LIVE Studio (mengisi liveStatus + liveStartedAtMs)
	LoadSocketIoAndDetect();
}

// Pulihkan state pause SEBELUM fetch pertama supaya panel musik langsung benar
// setelah reload.
LoadPauseState();
InitInfoLoop();

/////////////////////
// ALERT SYSTEM    //
/////////////////////

const alertQueue = [];
let alertLocked = false;
const recentAlerts = new Map();

// Durasi alert saat ini, dihitung ulang tiap kali alert mulai tayang: antrean padat ->
// lebih cepat; antrean surut -> kembali ke alertDisplayDuration.
function ComputeAlertDuration() {
	// Hanya event yang MASIH MENUNGGU. Alert yang sedang tayang tidak dihitung.
	const backlog = alertQueue.length;

	if (backlog <= queueThreshold) return alertDisplayDuration;

	// Interpolasi linear: threshold -> durasi normal, burstFullBacklog -> durasi minimum.
	const span = Math.max(1, burstFullBacklog - queueThreshold);
	const t = Math.min(1, (backlog - queueThreshold) / span);
	const scaled = alertDisplayDuration - t * (alertDisplayDuration - alertDurationMinMs);

	// Floor absolut menjaga animasi pop (0.38s) + transisi pill (0.35s).
	return Math.max(MIN_ALERT_FLOOR_MS, Math.round(scaled));
}

function TriggerAlert(iconOrOptions, textArg, avatarArg, titleArg, subtextArg) {
	let alertData = {};
	if (typeof iconOrOptions === 'object' && iconOrOptions !== null) {
		alertData = { ...iconOrOptions };
	} else {
		alertData = {
			icon: iconOrOptions,
			text: textArg,
			avatar: avatarArg || '',
			title: titleArg || '',
			subtext: subtextArg || ''
		};
	}

	// Song change SELALU masuk antrean (tidak ada update in-place). Buang alert musik
	// usang yang masih mengantre agar hanya 1 lagu terbaru yang menunggu.
	if (alertData.type === 'music') {
		for (let i = alertQueue.length - 1; i >= 0; i--) {
			if (alertQueue[i].type === 'music') {
				alertQueue.splice(i, 1);
			}
		}
	}

	// Deduplicate identical alerts within 4s
	const key = `${alertData.icon}:${alertData.text || alertData.title}`;
	const now = Date.now();
	if (recentAlerts.has(key) && (now - recentAlerts.get(key) < 4000)) {
		return;
	}
	recentAlerts.set(key, now);
	if (recentAlerts.size > 50) {
		for (const [k, time] of recentAlerts.entries()) {
			if (now - time > 10000) recentAlerts.delete(k);
		}
	}

	// Song change PRIORITAS: disisipkan sebelum event lain yang masih mengantre, tapi
	// TETAP di belakang song change lain supaya urutan lagu tidak terbalik.
	if (alertData.type === 'music') {
		// Cari event NON-musik pertama dari depan: song change disisipkan tepat SEBELUMnya,
		// otomatis di belakang semua song change lain (urutan lagu aman).
		let insertAt = alertQueue.length;
		for (let i = 0; i < alertQueue.length; i++) {
			if (alertQueue[i].type !== 'music') {
				insertAt = i;
				break;
			}
		}
		alertQueue.splice(insertAt, 0, alertData);
	} else {
		alertQueue.push(alertData);
	}
	ProcessAlertQueue();
}

let pendingRevealToken = 0;

function ProcessAlertQueue() {
	if (alertLocked || alertQueue.length === 0)
		return;

	// Intip alert pertama dalam antrean
	const nextAlert = alertQueue[0];

	// [Prefetch Avatar] Tunggu foto profil 100% selesai didownload SEBELUM membuka widget
	// agar tidak blink kotak/lingkaran transparan.
	if (nextAlert.avatar && !nextAlert._avatarLoaded) {
		alertLocked = true; // Kunci sementara
		const imgLoader = new Image();
		imgLoader.onload = () => {
			nextAlert._avatarLoaded = true;
			alertLocked = false;
			ProcessAlertQueue(); // Lanjutkan buka widget
		};
		imgLoader.onerror = () => {
			nextAlert.avatar = ''; // Hapus avatar jika gagal unduh (fallback)
			nextAlert._avatarLoaded = true;
			alertLocked = false;
			ProcessAlertQueue();
		};
		imgLoader.src = nextAlert.avatar;
		return; // Hentikan fungsi; tunggu onload memicu ulang ProcessAlertQueue
	}

	// Jika avatar sudah didownload atau tidak butuh avatar: keluarkan dari antrean
	const alertData = alertQueue.shift();
	window.currentActiveAlertData = alertData;
	alertLocked = true;
	isAlertActive = true;
	StopCycleTimer(); // IMMEDIATELY interrupt the looping widget!
	
	// Mainkan suara notifikasi KECUALI untuk alert lagu baru (music)
	if (alertData.type !== 'music') {
		alertAudio.currentTime = 0; // Ulang suara bila sebelumnya masih main
		alertAudio.play().catch(e => console.debug("[Geseki] Audio play diblokir oleh browser:", e));
	}

	// Dihitung SETELAH shift(): yang dihitung event yang MASIH MENUNGGU. Durasi alert yang
	// sedang tayang diputuskan di sini dan tidak dipotong di tengah jalan supaya animasi
	// pop tidak ter-clip. Alert lagu (type 'music') memakai durasi Info Rotation; bila
	// teksnya marquee, durasi diperpanjang otomatis.
	let currentAlertDuration;
	if (alertData.type === 'music') {
		currentAlertDuration = musicAlertDuration;
		if (typeof ComputeMusicAlertDuration === 'function') {
			currentAlertDuration = ComputeMusicAlertDuration(alertData);
		}
	} else {
		currentAlertDuration = ComputeAlertDuration();
	}

	const { icon, text, title, subtext, avatar, type, rightIcon } = alertData;

	// Avatar sudah 100% didownload di atas (Prefetch Avatar), jadi aman disuntikkan tanpa
	// efek berkedip/hitam.
	if (avatar && islandAvatar) {
		islandAvatar.src = avatar;
		islandAvatar.classList.remove('hidden');
		islandIcon.classList.add('hidden');
		SyncIconWrapHidden();
	} else if (islandAvatar) {
		islandAvatar.classList.add('hidden');
		islandAvatar.src = '';
		islandIcon.src = icon;
		islandIcon.classList.remove('hidden');
		SyncIconWrapHidden();
	}

	// Event icon on the right side if avatar or rightIcon is present
	if (islandEventIcon) {
		if (rightIcon) {
			islandEventIcon.src = typeof rightIcon === 'function' ? rightIcon() : rightIcon;
			islandEventIcon.classList.remove('hidden');
		} else if (avatar) {
			islandEventIcon.src = icon;
			islandEventIcon.classList.remove('hidden');
		} else {
			islandEventIcon.classList.add('hidden');
			islandEventIcon.src = '';
		}
	}

	// Text and subtext (2-line layout during alert)
	if (title && subtext && islandSubtext) {
		islandText.textContent = title;
		islandSubtext.textContent = subtext;
		islandSubtext.classList.remove('hidden');
	} else {
		islandText.textContent = text || title || '';
		if (islandSubtext) {
			islandSubtext.textContent = '';
			islandSubtext.classList.add('hidden');
		}
	}

	// Trigger animation on the dynamic island.
	// Alert lagu (type 'music') TIDAK memakai .alert-active: pill tetap berukuran Info
	// Rotation (40px, single-line) seperti panel date/time.
	if (type === 'music') {
		if (enableDynamicStyleBig) {
			dynamicIsland.classList.add('alert-active', 'alert-music-big');
			document.getElementById('musicBigExtra').classList.remove('hidden');
			if (islandSubtext) {
				islandSubtext.textContent = alertData.subtext || nowPlayingData.artist || 'Unknown Artist';
				islandSubtext.classList.remove('hidden');
			}
			const color = nowPlayingData.lightVibrant || "#8A2BE2";
			
			const pA1 = "M0,16 L0,12 C20,12 35,0 50,0 C65,0 80,12 100,12 L100,16 Z";
			const pA2 = "M0,16 L0,10 C25,10 45,3 60,3 C75,3 85,10 100,10 L100,16 Z";
			const pA3 = "M0,16 L0,14 C15,14 25,3 40,3 C60,3 80,14 100,14 L100,16 Z";
			
			const pB1 = "M0,16 L0,10 C15,10 30,4 45,4 C60,4 85,10 100,10 L100,16 Z";
			const pB2 = "M0,16 L0,13 C25,13 40,2 55,2 C70,2 80,13 100,13 L100,16 Z";
			const pB3 = "M0,16 L0,11 C20,11 35,5 65,5 C80,5 90,11 100,11 L100,16 Z";

			
			// Progress bar polos: warna solid palet. Blob wave (svgBlobAnimated / svgBlobStatic)
			// tidak lagi dipakai - tidak ada sisa string SVG animasi yang tidak terpakai.
			
			const scrubFill = document.querySelector('.scrub-fill');
			if (scrubFill) {
				// Progress bar polos: warna solid palet, TANPA wave dance.
				scrubFill.style.setProperty('--accent-color', color);
				scrubFill.style.backgroundImage = 'none';
			}
			const scrubThumb = document.querySelector('.scrub-thumb');
			if (scrubThumb) scrubThumb.style.backgroundColor = color;
			StartScrubberAnimation();
		} else {
			dynamicIsland.classList.remove('alert-active', 'alert-music-big');
			document.getElementById('musicBigExtra').classList.add('hidden');
			if (islandSubtext) {
				islandSubtext.textContent = '';
				islandSubtext.classList.add('hidden');
			}
		}
		islandText.innerHTML = RenderIslandText(text || title || '', true);
	} else {
		dynamicIsland.classList.add('alert-active');
		dynamicIsland.classList.remove('alert-music-big');
		document.getElementById('musicBigExtra').classList.add('hidden');
	}

	// Spring pop pill saat alert masuk (translateY + scale bouncy).
	dynamicIsland.classList.remove('alert-pop');
	void dynamicIsland.offsetWidth; // restart animasi
	dynamicIsland.classList.add('alert-pop');

	// Alert gift: goyangkan IMAGE hadiah (event icon kanan), bukan profil pic.
	if (type === 'gift' && islandEventIcon) {
		islandEventIcon.classList.remove('shake-anim');
		void islandEventIcon.offsetWidth; // restart animasi
		islandEventIcon.classList.add('shake-anim');
	}

	if (type === 'music') {
		if (islandIcon) islandIcon.classList.add('rounded-icon');
	} else {
		if (islandIcon) islandIcon.classList.remove('rounded-icon');
	}

	// Legacy #islandAlert container mirror
	if (islandAlert) {
		if (alertIcon) {
			if (alertIcon.tagName === 'IMG') alertIcon.src = icon;
			else alertIcon.innerHTML = `<img src="${icon}" style="width:20px;height:20px;object-fit:contain;">`;
		}
		if (alertText) alertText.textContent = text || `${title} ${subtext}`;
	}

	setTimeout(() => {
		if (alertQueue.length > 0) {
			alertLocked = false;
			// [UX] Keluar song change Big MENUJU ALERT BERIKUTNYA: sembunyikan konten, tulis konten
			// alert baru (tak terlihat) supaya pill morph ke ukuran yang BENAR, lalu fade-in di
			// ~400ms. Dilewati bila alert berikutnya juga music big (tidak ada penyusutan).
			const nextAlert = alertQueue[0];
			const nextIsBig = nextAlert && nextAlert.type === 'music' && enableDynamicStyleBig;
			const topRow = document.getElementById('islandTopRow');

			// Token transisi, BUKAN currentActiveAlertData: alert berikutnya bisa lewat jalur
			// prefetch avatar, yang mengembalikan ProcessAlertQueue sebelum currentActiveAlertData
			// diganti. Token SELALU dinaikkan dulu supaya reveal lama batal.
			pendingRevealToken = (pendingRevealToken || 0) + 1;
			const myToken = pendingRevealToken;

			if (type === 'music' && enableDynamicStyleBig) {
				if (!nextIsBig) {
					// Alert berikutnya BUKAN music big: sembunyikan dulu supaya pill morph ke ukuran
					// benar, lalu fade-in di 400ms.
					if (topRow) topRow.style.visibility = 'hidden';
				} else {
					// Alert berikutnya JUGA music big: pill tidak menyusut, tidak perlu sembunyikan.
					// Pulihkan visibility yang mungkin masih 'hidden' - kalau tidak, lagu berikutnya tak
					// pernah terlihat.
					if (topRow) topRow.style.visibility = '';
				}
			}

			ProcessAlertQueue(); // Show next alert in queue immediately

			if (type === 'music' && enableDynamicStyleBig && !nextIsBig) {
				setTimeout(() => {
					if (myToken !== pendingRevealToken) return; // hide lain mengambil alih
					if (topRow) {
						topRow.style.visibility = '';
						topRow.classList.remove('ambient-fade-in');
						void topRow.offsetWidth;
						topRow.classList.add('ambient-fade-in');
					}
				}, 400);
			}
			} else {
				// All alerts completed: resume ambient looping widget!
			// [UX] Simetris dengan saat mekar: easing TANPA overshoot selama menyusut keluar dari
			// music big, lalu lepas lagi.
			if (type === 'music' && enableDynamicStyleBig) {
				dynamicIsland.classList.add('morph-no-overshoot');
				setTimeout(() => dynamicIsland.classList.remove('morph-no-overshoot'), 600);
			}
			dynamicIsland.classList.remove('alert-active', 'alert-pop', 'alert-music-big');
			document.getElementById('musicBigExtra').classList.add('hidden');
			if (islandAvatar) {
				islandAvatar.classList.add('hidden');
				islandAvatar.src = '';
			}
			islandIcon.classList.remove('shake-anim');
			if (islandEventIcon) {
				islandEventIcon.classList.add('hidden');
				islandEventIcon.classList.remove('shake-anim');
				islandEventIcon.src = '';
			}
			if (islandSubtext) {
				islandSubtext.classList.add('hidden');
				islandSubtext.textContent = '';
			}
			// [UX] Keluar song change (music): sembunyikan konten SEBELUM pill menyusut supaya pill
			// menyusut LANGSUNG ke ukuran konten ambient yang benar.
			// Urutan: 1) visibility:hidden  2) class alert dihapus + konten ambient ditulis (tak
			// terlihat)  3) pill menyusut ke ukuran final  4) ~400ms: konten ambient fade-in.
			// Langkah 2 HARUS melewati guard isAlertActive, kalau tidak konten tidak pernah
			// tertulis dan pill menyusut memakai ukuran konten lagu.
			// PENGECUALIAN: bila Dynamic Style Big NONAKTIF, pill tidak pernah membesar jauh -
			// konten ambient langsung tampil, tanpa sembunyi & tanpa timer reveal.
			let needRevealAmbient = false;
			if (type === 'music' && enableDynamicStyleBig) {
				const topRow = document.getElementById('islandTopRow');
				if (topRow) topRow.style.visibility = 'hidden';
				islandIcon.classList.remove('hidden');
				SyncIconWrapHidden();
				isAlertActive = false;          // buka guard sebentar
				UpdateInfoText(true, true);
				RefreshMusicWaveIcon();
				isAlertActive = true;           // kunci lagi sampai timer reveal
				needRevealAmbient = true;
			} else {
				islandIcon.classList.remove('hidden');
				SyncIconWrapHidden();
			}

			// [UX] Lompati panel 'music' di rotasi bila alert yang baru selesai adalah songchange:
			// widget tidak mengulang musik ambient untuk lagu yang sama.
			if (type === 'music') {
				const musicPanelIdx = infoPanels.findIndex(p => p.id === 'music');
				if (musicPanelIdx !== -1 && currentPanelIndex === musicPanelIdx) {
					let attempts = 0;
					do {
						currentPanelIndex = (currentPanelIndex + 1) % infoPanels.length;
						attempts++;
					} while (infoPanels[currentPanelIndex].skip && infoPanels[currentPanelIndex].skip() && attempts < infoPanels.length);
				}
				// Panel sudah digeser: tulis ulang konten ambient yang benar.
				isAlertActive = false;
				UpdateInfoText(true, true);
				RefreshMusicWaveIcon();
				isAlertActive = true;
			}

			isAlertActive = false;
			alertLocked = false;
			window.currentActiveAlertData = null;

			// [UX] Langkah 4: tampilkan kembali konten ambient di ~80% transisi menyusut (400ms dari
			// 500ms), fade-in 150ms. StartCycleTimer dipindah ke sini: cycle tidak boleh tick di
			// tengah jendela delay (mencegah double render ambient). Saat Big nonaktif, lompat -
			// konten ambient tampil seketika.
			if (needRevealAmbient) {
				let revealed = false;
				const revealAmbient = () => {
					if (revealed || isAlertActive) return;
					revealed = true;
					clearTimeout(revealTimer);
					const topRow = document.getElementById('islandTopRow');
					if (topRow) {
						topRow.style.visibility = '';
						topRow.classList.remove('ambient-fade-in');
						void topRow.offsetWidth;
						topRow.classList.add('ambient-fade-in');
					}
					StartCycleTimer();
				};
				const revealTimer = setTimeout(revealAmbient, 400);
				// Saat Big nonaktif, music sudah ditulis di atas dan timer reveal dilewati - cukup
				// jalankan cycle.
				} else if (type !== 'music') {
				UpdateInfoText(true, true);
				RefreshMusicWaveIcon();
				StartCycleTimer();
			} else {
				StartCycleTimer();
			}
		}
	}, currentAlertDuration);
}

// Global test helpers for preview / dev
const testUser = 'sekisungkarak';
const testAvatar = '../resources/sekisungkarak_avatar.jpeg';

window.testFollow = function () {
	const msg = urlParams.get("followMessage") || "followed!";
	TriggerAlert({
		type: 'follow',
		icon: typeof ALERT_ICONS !== 'undefined' ? ALERT_ICONS.follow : '',
		text: `${testUser} ${msg.replaceAll('{name}', testUser)}`,
		title: testUser,
		subtext: msg.replaceAll('{name}', testUser),
		avatar: testAvatar
	});
};

window.testSubscribe = function () {
	const msg = urlParams.get("subscribeMessage") || "subscribed!";
	TriggerAlert({
		type: 'subscribe',
		icon: typeof ALERT_ICONS !== 'undefined' ? ALERT_ICONS.subscribe : '',
		text: `${testUser} ${msg.replaceAll('{name}', testUser)}`,
		title: testUser,
		subtext: msg.replaceAll('{name}', testUser),
		avatar: testAvatar
	});
};

window.testShare = function () {
	const msg = urlParams.get("shareMessage") || "shared the live!";
	TriggerAlert({
		type: 'share',
		icon: typeof ALERT_ICONS !== 'undefined' ? ALERT_ICONS.share : '',
		text: `${testUser} ${msg.replaceAll('{name}', testUser)}`,
		title: testUser,
		subtext: msg.replaceAll('{name}', testUser),
		avatar: testAvatar
	});
};

window.testGift = function () {
	const msg = urlParams.get("giftMessage") || "sent {gift} x{count}!";
	const action = msg.replaceAll('{name}', testUser).replaceAll('{gift}', 'Galaxy').replaceAll('{count}', '1');
	TriggerAlert({
		type: 'gift',
		icon: typeof ALERT_ICONS !== 'undefined' ? ALERT_ICONS.gift : '',
		text: `${testUser} ${action}`,
		title: testUser,
		subtext: action,
		avatar: testAvatar
	});
};

// Test first chatter: chat pertama dari seorang user. Teks dipotong 30 char, sama
// seperti jalur live (case 'chat').
window.testFirstChatter = function () {
	const msg = urlParams.get("firstChatterMessage") || "Lorem ipsum dolor sit amet, laboris dolor do sunt.";
	const message = msg.length > 30 ? msg.slice(0, 30) + '…' : msg;
	TriggerAlert({
		type: 'firstChatter',
		icon: 'https://img.icons8.com/fluency-systems-filled/96/FFFFFF/chat.png',
		text: `${testUser}: ${message}`,
		title: testUser,
		subtext: message,
		avatar: testAvatar
	});
};

window.testWidgetSelect = function(testType) {
	if (testType === "follow") {
		window.testFollow();
	} else if (testType === "subscribe") {
		window.testSubscribe();
	} else if (testType === "share") {
		window.testShare();
	} else if (testType === "gift") {
		window.testGift();
	} else if (testType === "firstChatter" || testType === "first_chatter") {
		window.testFirstChatter();
	} else if (testType === "all") {
		window.testFollow();
		window.testSubscribe();
		window.testShare();
		window.testGift();
		window.testFirstChatter();
	}
};

window.testWidget = function() {
	const testType = urlParams.get("testAlertType") || "all";
	window.testWidgetSelect(testType);
};
window.testAlert = TriggerAlert;
window.ALERT_ICONS = ALERT_ICONS;

// Broadcaster receiver: test murni & live update dari jendela Pengaturan / tab lain.
window.setWidgetScale = function(scale) {
	if (!dynamicIsland) return;
	let t = "translateX(-50%)";
	const s = parseFloat(scale);
	if (!isNaN(s) && s !== 1.0) {
		t += ` scale(${s})`;
	}
	const va = (typeof verticalAlign !== 'undefined') ? verticalAlign : "top";
	if (va === "center") {
		t += " translateY(-50%)";
	}
	document.documentElement.style.setProperty('--base-transform', t);
	dynamicIsland.style.transform = t;
};

if (window.BroadcastChannel) {
	const bc = new BroadcastChannel('geseki_island_channel');
	bc.onmessage = function(event) {
		if (!event.data) return;
		if (event.data.type === 'trigger_test') {
			window.testWidgetSelect(event.data.testType);
		} else if (event.data.type === 'set_scale') {
			window.setWidgetScale(event.data.scale);
		} else if (event.data.type === 'callFunction') {
			// Perintah dari settings page (mis. tombol Reset First Chatter), lewat BroadcastChannel
			// supaya menjangkau instance OBS di luar settings page.
			const fn = window[event.data.fn];
			if (typeof fn === 'function') {
				try {
					fn(...(Array.isArray(event.data.args) ? event.data.args : []));
				} catch (e) {
					console.warn('[Geseki] Gagal memanggil ' + event.data.fn, e);
				}
			}
		}
	};
}

// Helper debug status live: panggil window.liveInfo() di console.
window.liveInfo = function () {
	return {
		liveStatus: liveStatus,
		arti: liveStatus === 2 ? 'LIVE' : liveStatus === 1 ? 'PAUSED' : liveStatus === 0 ? 'OFFLINE' : 'BELUM DIKETAHUI',
		endpoint: lsEndpoint,
		startedAtMs: liveStartedAtMs,
		startedAt: liveStartedAtMs ? new Date(liveStartedAtMs).toLocaleTimeString('id-ID') : null,
		viewers: viewerCount,
		enableLiveDetect: enableLiveDetect
	};
};

/////////////////////////
// STREAMER.BOT CLIENT //
/////////////////////////

let streamerBotStatus = { connected: false, disconnected: false, error: false };
let client = null;

const sbAddress = urlParams.get("address") || urlParams.get("streamerBotServerAddress") || "127.0.0.1";
const sbPort = urlParams.get("port") || urlParams.get("streamerBotServerPort") || "8080";

if (typeof StreamerbotClient !== 'undefined') {
	try {
		client = new StreamerbotClient({
			host: sbAddress,
			port: sbPort,
			autoReconnect: false,

			onConnect: (data) => {
				streamerBotStatus.connected = true;
				streamerBotStatus.disconnected = false;
				streamerBotStatus.error = false;
				console.debug('[Geseki][Streamer.bot] Connected successfully');
			},

			onDisconnect: () => {
				if (!streamerBotStatus.disconnected) {
					console.debug('[Geseki][Streamer.bot] Disconnected');
				}
				streamerBotStatus.connected = false;
				streamerBotStatus.disconnected = true;
			},

			onError: (err) => {
				if (!streamerBotStatus.error) {
					console.debug('[Geseki][Streamer.bot] Connection error:', err);
				}
				streamerBotStatus.connected = false;
				streamerBotStatus.error = true;
			}
		});
	} catch (e) {
		console.debug('[Geseki][Streamer.bot] Init error:', e);
	}
}

if (client) {
	client.on('TikTok.Follow', (response) => {
		if (!enableFollow) return;
		console.debug('[Streamer.bot][TikTok.Follow]', response.data);
		const user = response.data.userName || response.data.user || 'Someone';
		const avatar = response.data.userProfileImageUrl || response.data.profileImageUrl || response.data.avatar || '';
		TriggerAlert({
			icon: ALERT_ICONS.follow,
			text: `${user} ${followMessage.replaceAll('{name}', user)}`,
			title: user,
			subtext: followMessage.replaceAll('{name}', user),
			avatar: avatar
		});
	});

	client.on('TikTok.Subscribe', (response) => {
		if (!enableSubscribe) return;
		console.debug('[Streamer.bot][TikTok.Subscribe]', response.data);
		const user = response.data.userName || response.data.user || 'Someone';
		const avatar = response.data.userProfileImageUrl || response.data.profileImageUrl || response.data.avatar || '';
		TriggerAlert({
			icon: ALERT_ICONS.subscribe,
			text: `${user} ${subscribeMessage.replaceAll('{name}', user)}`,
			title: user,
			subtext: subscribeMessage.replaceAll('{name}', user),
			avatar: avatar
		});
	});

	client.on('TikTok.Share', (response) => {
		if (!enableShare) return;
		console.debug('[Streamer.bot][TikTok.Share]', response.data);
		const user = response.data.userName || response.data.user || 'Someone';
		const avatar = response.data.userProfileImageUrl || response.data.profileImageUrl || response.data.avatar || '';
		TriggerAlert({
			icon: ALERT_ICONS.share,
			text: `${user} ${shareMessage.replaceAll('{name}', user)}`,
			title: user,
			subtext: shareMessage.replaceAll('{name}', user),
			avatar: avatar
		});
	});

	client.on('TikTok.Gift', (response) => {
		if (!enableGift) return;
		console.debug('[Streamer.bot][TikTok.Gift]', response.data);
		const user = response.data.userName || response.data.user || 'Someone';
		const gift = response.data.giftName || 'a gift';
		const repeatCount = response.data.repeatCount || 1;
		const action = giftMessage.replaceAll('{name}', user).replaceAll('{gift}', gift).replaceAll('{count}', repeatCount);
		const avatar = response.data.userProfileImageUrl || response.data.profileImageUrl || response.data.avatar || '';
		TriggerAlert({
			type: 'gift',
			icon: ALERT_ICONS.gift,
			text: `${user} ${action}`,
			title: user,
			subtext: action,
			avatar: avatar
		});
	});
}

////////////////////////////////////////
// TIKTOK CLIENT //
////////////////////////////////////////

const tikFinityStatus = { connected: false, disconnected: false, error: false };
const indoFinityStatus = { connected: false, disconnected: false, error: false };

let tikfinityWebsocket = null;
let indofinityWebsocket = null;

async function tikfinityConnection() {
	if (tiktokService !== 'tikfinity' && tiktokService !== 'both') {
		return null;
	}

	const tikfinityWebSocketURL = `ws://${tikfinityHost}:${tikfinityPort}/`;
	const reconnectDelay = 10000;
	let retryCount = 0;
	let errorLogged = false;

	function connect() {
		try {
			tikfinityWebsocket = new WebSocket(tikfinityWebSocketURL);
		} catch (err) {
			if (!errorLogged) {
				console.debug(`[Geseki][TikFinity] Connection error:`, err);
				errorLogged = true;
			}
			setTimeout(connect, reconnectDelay);
			return null;
		}

		tikfinityWebsocket.onopen = () => {
			console.debug(`[Geseki][TikFinity] Connected to TikFinity successfully!`);
			retryCount = 0;
			errorLogged = false;

			tikFinityStatus.connected = true;
			UpdateViewerCount(); // provider terhubung -> angka penonton valid
			tikFinityStatus.disconnected = false;
			tikFinityStatus.error = false;
		};

		tikfinityWebsocket.onmessage = (response) => {
			try {
				const data = JSON.parse(response.data);
				const tiktokData = data.data;

				console.debug(`[Geseki][TikFinity][TikTok] ${data.event}`, data);

				handleTikTokEvent(data.event, tiktokData, 'TikFinity');
			} catch (e) {
				console.debug(`[Geseki][TikFinity] Error parsing message:`, e);
			}
		};

		tikfinityWebsocket.onclose = (event) => {
			setTimeout(() => {
				connect();
			}, reconnectDelay);

			if (tikFinityStatus.disconnected === false && tikFinityStatus.connected === true) {
				console.debug(`[Geseki][TikFinity] Disconnected.`);
			}

			tikFinityStatus.connected = false;
			UpdateViewerCount(); // provider putus -> panel kembali ke teks offline
			tikFinityStatus.disconnected = true;
			tikFinityStatus.error = true;
		};

		tikfinityWebsocket.onerror = (error) => {
			if (!errorLogged) {
				console.debug(`[Geseki][TikFinity] Connection error:`, error);
				errorLogged = true;
			}

			if (tikfinityWebsocket && tikfinityWebsocket.readyState !== WebSocket.CLOSED) {
				tikfinityWebsocket.close();
			}

			tikFinityStatus.connected = false;
			tikFinityStatus.disconnected = true;
			tikFinityStatus.error = true;
		};

		return tikfinityWebsocket;
	}

	return connect();
}

async function indofinityConnection() {
	if (tiktokService !== 'indofinity' && tiktokService !== 'both') {
		return null;
	}

	const indofinityWebSocketURL = `ws://${indofinityHost}:${indofinityPort}/`;
	const reconnectDelay = 10000;
	let retryCount = 0;
	let errorLogged = false;

	function connect() {
		try {
			indofinityWebsocket = new WebSocket(indofinityWebSocketURL);
		} catch (err) {
			if (!errorLogged) {
				console.debug(`[Geseki][IndoFinity] Connection error:`, err);
				errorLogged = true;
			}
			setTimeout(connect, reconnectDelay);
			return null;
		}

		indofinityWebsocket.onopen = () => {
			console.debug(`[Geseki][IndoFinity] Connected to IndoFinity successfully!`);
			retryCount = 0;
			errorLogged = false;

			indoFinityStatus.connected = true;
			UpdateViewerCount(); // provider terhubung -> angka penonton valid
			indoFinityStatus.disconnected = false;
			indoFinityStatus.error = false;
		};

		indofinityWebsocket.onmessage = (response) => {
			try {
				const data = JSON.parse(response.data);
				const tiktokData = data.data;

				console.debug(`[Geseki][IndoFinity][TikTok] ${data.event}`, data);

				handleTikTokEvent(data.event, tiktokData, 'IndoFinity');
			} catch (e) {
				console.debug(`[Geseki][IndoFinity] Error parsing message:`, e);
			}
		};

		indofinityWebsocket.onclose = (event) => {
			setTimeout(() => {
				connect();
			}, reconnectDelay);

			if (indoFinityStatus.disconnected === false && indoFinityStatus.connected === true) {
				console.debug(`[Geseki][IndoFinity] Disconnected.`);
			}

			indoFinityStatus.connected = false;
			indoFinityStatus.disconnected = true;
			indoFinityStatus.error = true;
		};

		indofinityWebsocket.onerror = (error) => {
			if (!errorLogged) {
				console.debug(`[Geseki][IndoFinity] Connection error:`, error);
				errorLogged = true;
			}

			if (indofinityWebsocket && indofinityWebsocket.readyState !== WebSocket.CLOSED) {
				indofinityWebsocket.close();
			}

			indoFinityStatus.connected = false;
			indoFinityStatus.disconnected = true;
			indoFinityStatus.error = true;
		};

		return indofinityWebsocket;
	}

	return connect();
}

// Riwayat first chatter DIPERTAHANKAN lintas reload (localStorage). Hanya dibersihkan
// via tombol Reset (window.ResetFirstChatter) atau saat live dimulai dari aplikasi.
const FC_STORAGE_KEY = 'geseki_first_chatters';

function LoadFirstChatters() {
	try {
		const raw = localStorage.getItem(FC_STORAGE_KEY);
		if (!raw) return;
		const arr = JSON.parse(raw);
		if (Array.isArray(arr)) arr.forEach(id => firstChatters.add(String(id)));
	} catch (e) { /* abaikan: storage penuh / nonaktif */ }
}

function SaveFirstChatters() {
	try {
		localStorage.setItem(FC_STORAGE_KEY, JSON.stringify([...firstChatters]));
	} catch (e) { /* abaikan */ }
}

const firstChatters = new Set();
LoadFirstChatters();

function ResetFirstChatter() {
	firstChatters.clear();
	try { localStorage.removeItem(FC_STORAGE_KEY); } catch (e) { /* abaikan */ }
	console.log('[Geseki] First Time Chatter history telah direset.');
}
window.ResetFirstChatter = ResetFirstChatter;

// Terima panggilan fungsi dari settings page (postMessage). Diperlukan karena settings
// page TIDAK bisa memakai contentWindow[fn]?.(): bila widget menjalani redirect
// internal (index.html -> obs/index.html), referensi contentWindow menjadi basi dan
// panggilan dilewati tanpa error. Pesan ini tiba terlepas dari redirect.
window.addEventListener('message', (event) => {
	const data = event.data;
	if (!data || data.type !== 'geseki:callFunction') return;
	const fn = window[data.fn];
	if (typeof fn !== 'function') return;
	try {
		fn(...(Array.isArray(data.args) ? data.args : []));
	} catch (e) {
		console.warn('[Geseki] Gagal memanggil ' + data.fn, e);
	}
});

function handleTikTokEvent(event, tiktokData, source) {
	if (!tiktokData) return;

	const userName = tiktokData.nickname || tiktokData.uniqueId || 'Someone';
	// Username dibatasi 20 karakter (sama seperti first chatter) supaya marquee tidak
	// berjalan terlalu jauh dan pill tetap proporsional.
	const displayUser = userName.length > 20 ? userName.slice(0, 20) + '…' : userName;
	const avatar = tiktokData.profilePictureUrl || tiktokData.profilePicture || tiktokData.avatarThumb || tiktokData.user?.profilePictureUrl || '';

	switch (event) {
		case 'chat': {
			if (!enableFirstChatter) return;
			const userId = tiktokData.userId;
			if (!userId) return;

			if (!firstChatters.has(userId)) {
				firstChatters.add(userId);
				SaveFirstChatters();
				let message = tiktokData.comment || tiktokData.msg || tiktokData.text || '';
				if (message.length > 30) {
					message = message.slice(0, 30) + '…';
				}
				// Username dibatasi 20 karakter supaya marquee tidak berjalan terlalu jauh.
				const displayName = displayUser;

				TriggerAlert({
					icon: 'https://img.icons8.com/fluency-systems-filled/96/FFFFFF/chat.png',
					title: displayName,
					subtext: message,
					text: `${displayName}: ${message}`,
					avatar: avatar
				});
			}
			break;
		}

		case 'roomUser': {
			if (tiktokData.viewerCount !== undefined) {
				viewerCount = Number(tiktokData.viewerCount);
				// Angka disimpan; yang menggambar ke layar adalah rotasi panel.
				UpdateViewerCount();
			}
			break;
		}

		case 'gift': {
			if (!enableGift) return;
			// Streak handling: bila gift streak berulang, tunggu sampai streak berakhir.
			if (tiktokData.giftType === 1 && !tiktokData.repeatEnd) {
				return;
			}
			const giftName = tiktokData.giftName || 'a gift';
			const repeatCount = tiktokData.repeatCount || 1;
			const giftIcon = tiktokData.giftPictureUrl || ALERT_ICONS.gift;
			const action = giftMessage.replaceAll('{name}', displayUser).replaceAll('{gift}', giftName).replaceAll('{count}', repeatCount);
			TriggerAlert({
				type: 'gift',
				icon: giftIcon,
				text: `${displayUser} ${action}`,
				title: displayUser,
				subtext: action,
				avatar: avatar
			});
			break;
		}

		case 'subscribe': {
			if (!enableSubscribe) return;
			TriggerAlert({
				icon: ALERT_ICONS.subscribe,
				text: `${displayUser} ${subscribeMessage.replaceAll('{name}', displayUser)}`,
				title: displayUser,
			subtext: subscribeMessage.replaceAll('{name}', displayUser),
				avatar: avatar
			});
			break;
		}

		case 'follow': {
			if (!enableFollow) return;
			TriggerAlert({
				icon: ALERT_ICONS.follow,
				text: `${displayUser} ${followMessage.replaceAll('{name}', displayUser)}`,
				title: displayUser,
			subtext: followMessage.replaceAll('{name}', displayUser),
				avatar: avatar
			});
			break;
		}

		case 'share': {
			if (!enableShare) return;
			TriggerAlert({
				icon: ALERT_ICONS.share,
				text: `${displayUser} ${shareMessage.replaceAll('{name}', displayUser)}`,
				title: displayUser,
			subtext: shareMessage.replaceAll('{name}', displayUser),
				avatar: avatar
			});
			break;
		}

		case 'like': {
			// Like event
			break;
		}
	}
}

// Connect TikTok services on ready
function initTikTokServices() {
	tikfinityConnection();
	indofinityConnection();
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initTikTokServices);
} else {
	initTikTokServices();
}

console.log("Geseki dynamic-island-alert loaded");
document.body.style.backgroundColor = 'transparent';
