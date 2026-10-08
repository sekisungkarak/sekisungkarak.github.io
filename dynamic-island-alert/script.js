////////////////
// PARAMETERS //
////////////////

const queryString = window.location.search;
const _urlSearch = new URLSearchParams(queryString);

/* ============================================================================
   CONTROLS PANEL - sumber konfigurasi
   ----------------------------------------------------------------------------
   Dulu seluruh pengaturan dibaca dari query string, dan satu-satunya cara
   mengubahnya adalah dashboard dock yang menyusun ulang URL. Sekarang widget
   menyimpan sendiri profilnya di localStorage dan panel di dalam overlay
   (?controls=1 atau tombol S) yang mengeditnya.

   Prioritas nilai, dari yang paling kuat:
     1. preferensi sesi  -> yang diedit langsung di overlay (mis. scale)
     2. query string     -> URL lama & dashboard, tetap didahulukan
     3. profil aktif     -> hasil panel
     4. defaultValue     -> salinan settings.json, diisi panel

   Semua call site di bawah tetap memakai urlParams.get()/has(), jadi tidak ada
   yang perlu disentuh: objeknya saja yang sekarang memetakan ke sumber itu.
   ========================================================================== */
// ── Namespace per-widget ─────────────────────────────────────────
// Folder widget (segmen terakhir path setelah nama berkas dan subfolder
// internal 'obs'/'controls' dibuang) menjadi namespace semua kunci
// localStorage/sessionStorage dan nama BroadcastChannel widget ini. Tanpa
// ini, dua widget di origin yang sama berbagi kunci `geseki-scene-<scene>`
// dan `geseki:controls:*`, sehingga profil satu widget menimpa widget lain.
const WIDGET_NS = (() => {
	let segs = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
	if (segs.length && segs[segs.length - 1].indexOf('.') !== -1) segs.pop();
	if (segs.length && (segs[segs.length - 1] === 'obs' || segs[segs.length - 1] === 'controls')) segs.pop();
	return 'geseki:' + (segs[segs.length - 1] || 'widget') + ':';
})();

const CHANNEL_NAME = WIDGET_NS + 'channel';

const ConfigStore = (() => {
	const KEY_SCHEMA   = WIDGET_NS + 'controls:schema';
	const KEY_PROFILES = WIDGET_NS + 'controls:profiles';
	const KEY_ACTIVE   = WIDGET_NS + 'controls:active';
	const KEY_PREFS    = WIDGET_NS + 'controls:prefs';
	// Profil scene: kunci ber-namespace `geseki:<folder>:scene-<nama>` (yang
	// ditulis dashboard & panel). Kunci LAMA tanpa namespace tetap dibaca
	// sebagai cadangan supaya profil yang sudah tersimpan tidak hilang.
	const NS_SCENE_PREFIX = WIDGET_NS + 'scene-';
	const LEGACY_SCENE_PREFIXES = ['geseki-scene-', 'geseki:scene-'];
	// Kunci controls versi lama (tanpa namespace). Hanya widget historis yang
	// memilikinya; widget lain tidak menyentuhnya.
	const LEGACY_CONTROLS_PREFIX = WIDGET_NS === 'geseki:dynamic-island-alert:' ? 'geseki:controls:' : '';
	function MatchProfileKey(k) {
		if (!k) return null;
		if (k.indexOf(NS_SCENE_PREFIX) === 0) return k.slice(NS_SCENE_PREFIX.length);
		for (let i = 0; i < LEGACY_SCENE_PREFIXES.length; i++) {
			const p = LEGACY_SCENE_PREFIXES[i];
			if (k.indexOf(p) === 0) return k.slice(p.length);
		}
		return null;
	}

	const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
	const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
	const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

	// Migrasi SEKALI JALAN dari kunci lama tanpa namespace ke namespace widget.
	// Hanya widget historis (dynamic-island-alert) yang menjalankannya, supaya
	// widget baru tidak mencuri data miliknya. Setelah tersalin, kode di bawah
	// hanya memakai kunci ber-namespace.
	(function MigrateLegacyControlsKeys() {
		if (!LEGACY_CONTROLS_PREFIX) return;
		[[LEGACY_CONTROLS_PREFIX + 'schema', KEY_SCHEMA],
		 [LEGACY_CONTROLS_PREFIX + 'profiles', KEY_PROFILES],
		 [LEGACY_CONTROLS_PREFIX + 'active', KEY_ACTIVE],
		 [LEGACY_CONTROLS_PREFIX + 'prefs', KEY_PREFS]].forEach(function (pair) {
			try {
				if (lsGet(pair[1]) === null) {
					const v = localStorage.getItem(pair[0]);
					if (v !== null) localStorage.setItem(pair[1], v);
				}
			} catch (e) { /* abaikan */ }
		});
	})();

	// Nilai bawaan, disalin dari settings.json oleh panel. Sebelum panel pernah
	// dibuka salinan ini kosong; widget tetap jalan karena setiap call site
	// sudah punya fallback sendiri.
	let defaults = {};
	try { defaults = JSON.parse(lsGet(KEY_SCHEMA) || '{}') || {}; } catch (e) { defaults = {}; }

	// Profil. Dibaca dari kunci ber-namespace DAN kunci lama, supaya
	// pengaturan yang sudah tersimpan sebelum namespace tetap terpakai.
	const profiles = new Map();
	try {
		const raw = lsGet(KEY_PROFILES);
		if (raw) JSON.parse(raw).forEach(([k, v]) => profiles.set(k, v));
	} catch (e) { /* abaikan */ }
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			const scene = MatchProfileKey(k);
			if (!scene) continue;
			const val = JSON.parse(lsGet(k) || '{}');
			const list = Array.isArray(val.settings) ? val.settings : [];
			if (list.length) profiles.set(scene, Object.fromEntries(list));
		}
	} catch (e) { /* abaikan */ }

	// Profil aktif. `profile` di URL menang supaya satu browser source bisa
	// dipin ke profil tertentu (mis. ?profile=Gameplay); tanpa itu pakai
	// pilihan terakhir dari panel.
	const pinned = _urlSearch.get('profile');
	let active = pinned || lsGet(KEY_ACTIVE) || '';
	if (!profiles.has(active)) active = pinned || '';

	let prefs = {};
	try { prefs = JSON.parse(lsGet(KEY_PREFS) || '{}') || {}; } catch (e) { prefs = {}; }

	const current = () => (profiles.has(active) ? profiles.get(active) : {});
	const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

	// Urutan prioritas: preferensi panel > profil tersimpan > query string > bawaan.
	// Profil sengaja DI ATAS query string: browser source yang dibuat lewat dashboard
	// menaruh seluruh pengaturan di URL, dan kalau URL menang maka setiap perubahan
	// dari Controls Panel tidak akan pernah terpakai. Setelah panel menyimpan sekali,
	// profil berisi semua nilai (termasuk yang diambil dari URL saat pertama dibuka),
	// lalu menjadi sumber kebenaran. ?profile=... tetap mem-pin profil seperti biasa.
	const read = (key) => {
		if (own(prefs, key))     return prefs[key];
		const p = current();
		if (own(p, key))         return p[key];
		if (_urlSearch.has(key)) return _urlSearch.get(key);
		if (own(defaults, key))  return defaults[key];
		return null;
	};

	// Nilai bisa datang sebagai boolean / array dari profil, sedangkan kode
	// lama selalu menerima string dari query string. Disamakan di sini.
	const resolve = (value) => {
		if (typeof value === 'boolean') return value ? 'true' : 'false';
		if (Array.isArray(value))       return value.join(',');
		if (value === null || value === undefined) return '';
		return String(value);
	};

	const params = {
		get: (key) => resolve(read(key)),
		// .has() tetap khusus query string: dipakai untuk flag URL murni
		// (musicAlertDuration, dragPreview) yang tidak pernah jadi pengaturan.
		has: (key) => _urlSearch.has(key)
	};

	return {
		params, read, resolve, profiles, current, defaults,
		urlSearch: _urlSearch,
		get active() { return active; },
		setActive(name) {
			active = name || '';
			if (active) lsSet(KEY_ACTIVE, active); else lsDel(KEY_ACTIVE);
		},
		saveProfile(name, map) {
			if (!name) return;
			profiles.set(name, map);
			const flat = [...profiles.entries()];
			lsSet(KEY_PROFILES, JSON.stringify(flat));
			// Simpan dalam format yang dibaca dashboard: satu profil per scene.
			lsSet(NS_SCENE_PREFIX + name, JSON.stringify({
				savedAt: Date.now(),
				settings: Object.entries(map)
			}));
		},
		deleteProfile(name) {
			profiles.delete(name);
			lsSet(KEY_PROFILES, JSON.stringify([...profiles.entries()]));
			lsDel(NS_SCENE_PREFIX + name);
			LEGACY_SCENE_PREFIXES.forEach(function (p) { lsDel(p + name); });
		},
		saveDefaults(map) { defaults = map; lsSet(KEY_SCHEMA, JSON.stringify(map)); },
		setPref(key, value) { prefs[key] = value; lsSet(KEY_PREFS, JSON.stringify(prefs)); },
		clearPrefs() { prefs = {}; lsDel(KEY_PREFS); }
	};
})();

// Semua kode di bawah memakai urlParams.get()/has() seperti sebelumnya.
const urlParams = ConfigStore.params;
window.GesekiConfig = ConfigStore;

// Weather info
const weatherLocation = urlParams.get("weatherLocation") || "Jakarta";
// Durasi alert (detik -> ms). Dipakai HANYA untuk alert.
const alertDisplayDuration = GetIntParam("alertDuration", 4) * 1000;

// Durasi rotasi panel info (tanggal / jam / durasi / cuaca / penonton). Terpisah dari
// alertDisplayDuration supaya antrean padat tidak mempercepat putaran info.
const infoCycleDuration = GetIntParam("infoDuration", 4) * 1000;

// ---- Durasi alert dinamis saat antrean padat ----
// Antrean = event yang MASIH MENUNGGU (alertQueue.length), tidak termasuk alert yang tayang.
// Dikendalikan SATU slider "Adaptive Alert Speed" (0-100%) di dashboard:
// 0% = durasi tetap, 100% = paling agresif. Dua besaran diturunkan dari slider
// supaya selalu konsisten satu sama lain:
//   durasi terpendek = alertDisplayDuration * (1 - 0.625 * strength)
//   titik jenuh      = 2 + round(4 * strength)
const adaptiveStrength = Math.max(0, Math.min(100, GetIntParam("adaptiveStrength", 50))) / 100;
// Antrean <= ini belum dianggap padat: tetap pakai alertDisplayDuration.
const queueThreshold = 2;
const burstQueue = queueThreshold + Math.round(4 * adaptiveStrength);
const alertDurationMinMs = alertDisplayDuration * (1 - 0.625 * adaptiveStrength);

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

// Geseki Bridge: ONE WebSocket carries both TikTok events and Now Playing,
// replacing TikFinity, IndoFinity and the SMTC Bridge HTTP poll.
const bridgePort = GetIntParam("bridgePort", 47800);
const bridgeHost = urlParams.get("bridgeHost") || "127.0.0.1";
// Resolved once at startup by ResolveBridgePort(); discovery may move it
// to whatever port the plugin is actually listening on.
let BRIDGE_WS_URL = `ws://${bridgeHost}:${bridgePort}/ws`;

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

// Super Fan: a separate TikTok event family (became a Super Fan, a Super Fan
// joined, sent a Super Fan Box). Kept apart from the plain subscribe alert.
const superFanMessage = urlParams.get("superFanMessage") || "is now a Super Fan!";
const superFanJoinMessage = urlParams.get("superFanJoinMessage") || "Super Fan joined!";
const superFanBoxMessage = urlParams.get("superFanBoxMessage") || "sent a Super Fan Box x{count}!";

const enableFollow = GetBoolParam("enableFollow", true);
const enableSubscribe = GetBoolParam("enableSubscribe", true);
const enableShare = GetBoolParam("enableShare", true);
const enableGift = GetBoolParam("enableGift", true);
const enableFirstChatter = GetBoolParam("enableFirstChatter", true);
const enableSuperFan = GetBoolParam("enableSuperFan", true);
const enableSuperFanBox = GetBoolParam("enableSuperFanBox", true);

// Master switch: mematikan SEMUA alert TikTok sekaligus (dashboard).
const enableTikTokAlerts = GetBoolParam("enableTikTokAlerts", true);

// Ikon event TikTok (foto/gift/chat/follow/subscribe/share) — KHUSUS event TikTok.
// Tiap grup event punya toggle sendiri. Default true = perilaku lama tidak berubah.
// Hanya memengaruhi ikon event di kartu alert; ikon panel ambient (wave/album art)
// tidak tersentuh karena jalurnya beda (SyncIslandIcon, bukan ProcessAlertQueue).
const enableFollowIcon = GetBoolParam("enableFollowIcon", true);
const enableSubscribeIcon = GetBoolParam("enableSubscribeIcon", true);
const enableShareIcon = GetBoolParam("enableShareIcon", true);
const enableGiftIcon = GetBoolParam("enableGiftIcon", true);
const enableFirstChatterIcon = GetBoolParam("enableFirstChatterIcon", true);
const enableSuperFanIcon = GetBoolParam("enableSuperFanIcon", true);

// Suara notifikasi per overlay (Settings > General). Default true = perilaku lama.
// Overlay yang hanya perlu tampil visual (mis. pratinjau scene lain) bisa OFF.
const enableSound = GetBoolParam("enableSound", true);

// Badge TikTok (grade / Top Gifter) di samping username. Default true = perilaku
// lama. OFF -> badge tidak dirender sama sekali, terlepas dari payload userBadges.
const enableBadgeIcon = GetBoolParam("enableBadgeIcon", true);

// SMTC Bridge & Now Playing settings
const enableNowPlaying = GetBoolParam("enableNowPlaying", true);
const includedApplications = urlParams.get("includedApplications") || '';
const excludedApplications = urlParams.get("excludedApplications") || '';
// Gaya kartu alert musik. Satu dropdown menggantikan checkbox lama:
//   small  = tidak ada kartu (pill kecil biasa)
//   big    = kartu besar Dynamic Island (default, perilaku lama)
//   medium = kartu pendek lebar "Dynamic Medium"
// Param lama `enableDynamicStyleBig` masih dibaca sebagai cadangan supaya URL
// yang tersimpan sebelum perubahan ini tidak mendadak jadi "small".
const musicStyle = (() => {
	const raw = urlParams.get("musicStyle");
	if (raw) return raw.toLowerCase();
	return GetBoolParam("enableDynamicStyleBig", true) ? "big" : "small";
})();
const isMusicMedium = musicStyle === "medium";
// Kartu besar ATAU medium sama-sama "mekar" — kode lama memakai flag ini di
// banyak tempat, jadi nilainya diturunkan agar tidak perlu diubah semua.
const enableDynamicStyleBig = musicStyle !== "small";
const enableDynamicBig = enableDynamicStyleBig;
// Kelas penanda kartu musik sedang mekar. Dipakai di semua add/remove/contains
// supaya kode lama tetap satu jalur; CSS yang membedakan tampilan Big vs Medium.
const MUSIC_CARD_CLASS = isMusicMedium ? "alert-music-medium" : "alert-music-big";

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

// Sumber suara notifikasi. URL disimpan sebagai konstanta; elemen Audio-nya
// dibuat baru tiap pemutaran (lihat PlayAlertSound) supaya dua alert yang datang
// berdekatan tidak saling memotong.
const ALERT_SOUND_SRC = "../resources/sfx/notification.mp3";
// Turunkan volume karena aslinya sfx ini cukup keras (sesuaikan kalau kurang)
const ALERT_SOUND_VOLUME = 0.5;

// ---- Suara notifikasi (opsional per overlay) ----
// Diatur dari Settings > General ("Notification Sound", default ON). Overlay yang
// hanya perlu tampil visual bisa mematikannya. Suara selalu keluar dari jendela
// utama: pratinjau iframe di halaman Settings tidak pernah bunyi.
//
// Tiap browser source OBS adalah proses terpisah dan semuanya menerima event
// TikTok yang sama, jadi tanpa penjagaan di bawah satu event dibunyikan berkali-kali:
//   - visibility gate: hanya source yang sedang tampil yang bunyi (OBS mengirim
//     'obsSourceVisibleChanged' saat status tampil berubah, lihat BAGIAN 2).
//   - dedupe: kalau dua widget benar-benar tampil bersamaan (nested scene),
//     source pertama yang memproses event mengklaim suara lewat localStorage.
// Status "source ini sedang tampil" (visible) dan "source ini ada di scene yang
// sedang tayang" (active). Keduanya fail-open: default true, jadi browser biasa
// tanpa OBS tetap bunyi. OBS mengabari lewat tiga jalur:
//   1. status awal saat browser dibuat - CEF WasHidden() menggerakkan
//      document.hidden, jadi itu yang dibaca saat skrip ini dimuat.
//   2. 'obsSourceVisibleChanged' saat status tampil berubah.
//   3. 'obsSourceActiveChanged' saat source masuk/keluar program view - hanya
//      menyala untuk scene yang SEDANG TAYANG, tidak ikut di preview Studio Mode.
let sourceVisible = !(typeof document !== 'undefined' && document.hidden);
let sourceActive = true;
const SOUND_CLAIM_KEY = WIDGET_NS + 'sound-claim';
const SOUND_CLAIM_WINDOW_MS = 1500;

function PlayAlertSound(alertData) {
	// Pratinjau di iframe dashboard tidak pernah bunyi: suara selalu dari jendela utama (OBS).
	if (window.top !== window) return;
	if (!enableSound) return;
	// Alert hasil adopsi dari source lain sudah dibunyikan source asalnya.
	if (alertData && alertData._syncAdopted) return;
	// Hanya source di scene yang sedang tampil + sedang tayang yang bunyi.
	if (!sourceVisible || !sourceActive) return;

	// Dedupe lintas source: hanya source pertama yang memproses event ini yang bunyi.
	const key = AlertKey(alertData);
	if (key) {
		try {
			const now = Date.now();
			const raw = localStorage.getItem(SOUND_CLAIM_KEY);
			const claim = raw ? JSON.parse(raw) : null;
			if (claim && claim.key === key && (now - claim.at) < SOUND_CLAIM_WINDOW_MS) return;
			localStorage.setItem(SOUND_CLAIM_KEY, JSON.stringify({ key: key, at: now }));
		} catch (e) { /* localStorage diblokir: tetap bunyikan */ }
	}

	// Elemen BARU tiap pemutaran: currentTime = 0 pada elemen yang sedang main
	// akan menghentikan suara sebelumnya di tengah.
	const audio = new Audio(ALERT_SOUND_SRC);
	audio.volume = ALERT_SOUND_VOLUME;
	audio.play().catch(e => console.debug("[Geseki] Audio play diblokir oleh browser:", e));
}

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

// Batas panjang username. Username MURNI alphabet (huruf latin, angka,
// underscore - khas username TikTok) boleh sampai 15 karakter. Begitu ada
// emoji / huruf non-latin / tanda lain, batasnya dipotong jadi 10.
const USERNAME_ALPHABET_RE = /^[A-Za-z0-9_]+$/;
const USERNAME_MAX_ALPHA = 15;
const USERNAME_MAX_MIXED = 10;

// Satu "satuan" untuk kuota username campuran. Emoji dihitung TERPISAH per
// bagian yang terlihat: ZWJ (perekat), variation selector, modifier warna
// kulit/rambut, dan tanda gabung TIDAK dihitung, sehingga
// 👨‍👩‍👧‍👦 = 4, 👍🏽 = 1, dan é (e + tanda gabung) = 1.
function IsCountableUsernameUnit(ch, cp) {
	if (cp === 0x200D) return false;                    // ZWJ (perekat keluarga)
	if (cp === 0xFE0E || cp === 0xFE0F) return false;   // variation selector
	if (cp >= 0x1F3FB && cp <= 0x1F3FF) return false;   // modifier warna kulit
	if (cp >= 0x1F9B0 && cp <= 0x1F9B3) return false;   // modifier rambut
	if (/\p{M}/u.test(ch)) return false;                // tanda gabung (combining)
	return true;
}

// Buang perekat ZWJ yang menggantung di ujung (bila pemotongan jatuh tepat
// setelah ZWJ). Variation selector / tanda gabung TIDAK dibuang: keduanya
// menempel pada huruf dasarnya, jadi harus ikut tampil utuh.
function TrimTrailingGlue(s) {
	return s.replace(/\u200D+$/u, '');
}

// Potong username sesuai batas di atas. Murni alphabet -> potong per karakter
// (ASCII, jadi aman). Campuran -> potong per satuan terlihat, tanpa membelah
// emoji gabungan jadi karakter rusak.
function TruncateUsername(str) {
	if (!str) return '';
	if (USERNAME_ALPHABET_RE.test(str)) {
		return str.length <= USERNAME_MAX_ALPHA ? str : str.slice(0, USERNAME_MAX_ALPHA) + '…';
	}
	let out = '';
	let n = 0;
	for (const ch of str) {          // iterasi per code point
		const cp = ch.codePointAt(0);
		if (IsCountableUsernameUnit(ch, cp)) {
			if (n >= USERNAME_MAX_MIXED) return TrimTrailingGlue(out) + '…';
			n++;
		}
		out += ch;
	}
	return out;
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

// Baca parameter yang berisi DAFTAR nilai (setting tipe 'tags'). Nilai bisa
// datang sebagai array dari profil (sudah di-join koma oleh ConfigStore) atau
// sebagai string berkoma dari query string.
function GetListParam(paramName) {
	const raw = urlParams.get(paramName);
	if (!raw) return [];
	let list;
	try { list = JSON.parse(raw); } catch (e) { list = null; }
	if (!Array.isArray(list)) list = String(raw).split(',');
	return list.map(v => String(v).trim().toLowerCase()).filter(Boolean);
}

// Peran pengguna dari payload TikTok. Tiap engine mengirim bentuk berbeda,
// jadi semua jalur yang diketahui diperiksa. `badgeSceneType` adalah kunci yang
// paling andal karena TikFinity, IndoFinity, dan Geseki Bridge sama-sama
// mengirim userBadges.
// Warna badge fan club: OREN = masih member aktif, ABU = keanggotaan dorman
// (TikTok meng-abu-kan badge dan membekukan hak setelah 7 hari tanpa poin).
// Payload mengirim warna sebagai #AARRGGBB atau rgba(); warna tanpa rona
// (selisih channel nyaris nol) dianggap abu. Warna kosong -> bukan abu, supaya
// sumber yang tidak mengirim warna tidak membuang member asli.
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

// Keaktifan fan club. Geseki Bridge mengirim `fanClubActive` dari proto TikTok
// (userFansClubStatus / isSleeping); sumber tanpa field itu mengandalkan warna
// badge. `false` eksplisit selalu menang.
function FanClubIsActive(tiktokData, color) {
	const user = (tiktokData && tiktokData.user) || {};
	const explicit = tiktokData && tiktokData.fanClubActive !== undefined
		? tiktokData.fanClubActive
		: user.fanClubActive;
	if (explicit === false) return false;
	return !BadgeColorIsGrey(color);
}

function UserPermissionFlags(tiktokData) {
	const flags = { follower: false, fanclub: false, moderator: false, subscriber: false, superfan: false };
	if (!tiktokData) return flags;
	const user = tiktokData.user || {};

	// Fan club dideteksi dari BADGE fan club. TikFinity menandainya dengan
	// badgeSceneType 10; Geseki Bridge mengisi scene itu dari artwork badge
	// (fans_badge_icon), jadi ketiga sumber mengirim bentuk yang sama. Nama
	// berkas dicek juga sebagai jaring pengaman bila scene tidak diisi.
	// Badge ABU (dorman) TIDAK dihitung: TikTok meng-abu-kan badge member
	// yang berhenti mengumpulkan poin selama 7 hari berturut-turut.
	const badges = tiktokData.userBadges || user.userBadges || [];
	let fanBadgeGrey = false;
	if (Array.isArray(badges)) {
		for (const b of badges) {
			if (!b) continue;
			const st = Number(b.badgeSceneType !== undefined ? b.badgeSceneType : b.sceneType);
			const url = String(b.image || b.imageUrl || b.url || '');
			if (st === 1)  flags.moderator = true;
			if (st === 4)  flags.subscriber = true;
			const isFanBadge = st === 10 || url.indexOf('fans_badge_icon') !== -1;
			if (isFanBadge) {
				if (FanClubIsActive(tiktokData, b.color)) flags.fanclub = true;
				else fanBadgeGrey = true;
			}
		}
	}

	const identity = tiktokData.userIdentity || user.userIdentity || {};
	const followRole = Number(tiktokData.followRole !== undefined ? tiktokData.followRole : user.followRole);
	flags.follower = (isFinite(followRole) && followRole >= 1)
		|| !!tiktokData.isFollower || !!identity.isFollowerOfAnchor || !!identity.isFollower;
	flags.moderator = flags.moderator || !!tiktokData.isModerator || !!identity.isModeratorOfAnchor;
	flags.subscriber = flags.subscriber || !!tiktokData.isSubscriber || !!identity.isSubscriberOfAnchor;

	// Jalur tanpa warna badge (bridge mengirim fanClubBadge + fanClubActive):
	// pakai sinyal keanggotaan, tapi jangan menyalakan kembali badge yang abu.
	const clubSignal = !!(tiktokData.fanClubBadge || tiktokData.fansClub
		|| tiktokData.fansClubInfo || user.fanClubBadge || user.fansClub
		|| user.fansClubInfo);
	if (!FanClubIsActive(tiktokData, null)) {
		flags.fanclub = false;
	} else if (!fanBadgeGrey && clubSignal) {
		flags.fanclub = true;
	}

	// Superfan tidak ikut terkirim di payload chat, jadi keanggotaannya
	// diingat dari event superFan/superFanJoin/superFanBox (TrackSuperFan).
	flags.superfan = superFanHolders.has(UserKey(tiktokData));
	return flags;
}

// Daftar peran yang diizinkan (setting 'User Permissions'). Kosong = tanpa
// penyaringan: semua orang tetap disapa seperti sebelumnya.
const firstChatterPermissions = GetListParam('firstChatterPermissions');

function UserAllowedForFirstChatter(tiktokData) {
	if (firstChatterPermissions.length === 0) return true;
	const flags = UserPermissionFlags(tiktokData);
	return firstChatterPermissions.some(p => flags[p] === true);
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
// Widget Scale dibatasi 0.5–2.0. Clamp dilakukan di sini, bukan hanya lewat
// slider di settings.json, supaya nilai lama yang sudah tersimpan di localStorage
// (atau URL OBS yang lama) ikut terpotong otomatis.
const MIN_WIDGET_SCALE = 0.5;
const MAX_WIDGET_SCALE = 2.0;
const widgetScale = Math.min(MAX_WIDGET_SCALE,
	Math.max(MIN_WIDGET_SCALE, GetFloatParam("widgetScale", 1.0)));
const widgetRotation = (() => {
	let r = GetFloatParam("widgetRotation", 0);
	if (!isFinite(r)) return 0;
	// Normalisasi ke rentang (-180, 180] supaya sama dengan panel.
	r = r % 360;
	if (r > 180) r -= 360;
	if (r <= -180) r += 360;
	return Math.round(r);
})();
const verticalAlign = urlParams.get("verticalAlign") || "top";

let baseTransform = "translateX(-50%)";
if (widgetScale !== 1.0) {
	baseTransform += ` scale(${widgetScale})`;
}
// Rotasi dari mode Layout. Ikut transform yang sama supaya pivot-nya
// tetap transform-origin (top center) seperti skala.
if (widgetRotation !== 0) {
	baseTransform += ` rotate(${widgetRotation}deg)`;
}
if (verticalAlign === "center") {
	dynamicIsland.style.top = "50%";
	dynamicIsland.style.bottom = "auto";
	baseTransform += " translateY(-50%)";
} else if (verticalAlign === "bottom") {
	dynamicIsland.style.top = "auto";
	dynamicIsland.style.bottom = "32px";
} else {
	dynamicIsland.style.top = "40px"; // sedikit turun dari tepi atas
	dynamicIsland.style.bottom = "auto";
}

document.documentElement.style.setProperty('--base-transform', baseTransform);
dynamicIsland.style.transform = baseTransform;

// Offset posisi dari mode Layout (Controls Panel). Diterapkan sebagai MARGIN,
// bukan left/top, supaya left:50% + translateX(-50%) bawaan CSS tidak diubah
// (kalau diubah, animasi pill melebar/menyusut jadi kacau).
const widgetOffsetX = GetFloatParam("widgetOffsetX", 0);
const widgetOffsetY = GetFloatParam("widgetOffsetY", 0);
if (widgetOffsetX || widgetOffsetY) {
	dynamicIsland.style.marginLeft = widgetOffsetX + "px";
	dynamicIsland.style.marginTop = widgetOffsetY + "px";
}

// Default kini "solid" (Solid Black) - harus sama dengan defaultValue widgetStyle
// di settings.json, kalau tidak widget tanpa param akan tampil Liquid Glass.
if ((urlParams.get("widgetStyle") || "solid") === "solid") {
	dynamicIsland.classList.add("style-solid");
	// Background Opacity untuk Solid Black (10-100%, default 100 = hitam pekat).
	// Diterapkan sebagai CSS variable supaya CSS yang mengatur rgba-nya.
	const solidBgOpacity = Math.min(100, Math.max(10, GetIntParam("solidBgOpacity", 100))) / 100;
	document.documentElement.style.setProperty('--solid-bg-opacity', String(solidBgOpacity));
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
const islandBadges = document.getElementById('islandBadges');

// ══ Badge TikTok ══
// URL badge dari TikFinity/IndoFinity kadang dibungkus `@url:`…`` (lihat contoh
// payload userBadges). Bersihkan bungkus itu + kutip, kalau tidak <img> gagal muat.
function CleanBadgeUrl(raw) {
	if (!raw || typeof raw !== 'string') return '';
	let s = raw.trim();
	const m = s.match(/^@url:`([^`]+)`$/);
	if (m) s = m[1];
	else if (s.startsWith('@url:')) s = s.slice(4).replace(/^`|`$/g, '');
	if (!/^https?:\/\//i.test(s) && !s.startsWith('data:')) return '';
	// Tolak karakter yang bisa keluar dari atribut src saat disuntik via innerHTML.
	if (/["'<>\s]/.test(s)) return '';
	return s;
}

// Warna badge TikTok memakai format #AARRGGBB - alpha di DEPAN, bukan #RRGGBBAA.
// Payload nyata: #99789EE7 (grade, periwinkle) dan #66FE2C55 (Top Gifter, merah).
// WAJIB dinormalisasi: CSS membaca hex 8 digit sebagai #RRGGBBAA, jadi kalau
// string mentah diteruskan, #66FE2C55 tampil HIJAU (66, FE, 2C) bukan merah.
function ParseBadgeColor(raw) {
	if (!raw || typeof raw !== 'string') return '';
	const s = raw.trim();
	// Sudah berupa warna fungsional (mis. dari pemanggil lain) -> teruskan apa adanya.
	if (/^rgba?\(/i.test(s) || /^hsla?\(/i.test(s)) return s;
	const h = s.replace(/^#/, '');
	if (!/^[0-9a-f]{8}$/i.test(h)) return '';
	const a = parseInt(h.slice(0, 2), 16) / 255;
	const r = parseInt(h.slice(2, 4), 16);
	const g = parseInt(h.slice(4, 6), 16);
	const b = parseInt(h.slice(6, 8), 16);
	// Alpha payload (0.4) terlalu pudar di atas pill gelap -> beri lantai 0.55.
	return `rgba(${r}, ${g}, ${b}, ${Math.max(a, 0.55).toFixed(2)})`;
}

// Label badge: awalan "No." dilepas, sisanya utuh -> "No. 3" jadi "3".
function CleanBadgeLabel(raw) {
	if (!raw || typeof raw !== 'string') return '';
	const s = raw.trim();
	const m = s.match(/^No\.?\s*(\d+)$/i);
	return m ? m[1] : s;
}

function EscapeBadgeText(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	}[c]));
}

// Badge yang cukup ditampilkan IKONNYA saja. "New gifter" (badgeSceneType 2)
// membawa `name` berisi tulisan "New gifter" yang tidak perlu ikut tercetak di
// dalam pill - teks itu deskripsi badge, bukan angka/peringkat seperti grade
// atau Top Gifter. Ikonnya sudah berbicara sendiri.
function IsIconOnlyBadge(badge) {
	if (!badge || typeof badge !== 'object') return false;
	// badgeSceneType 2 = New gifter. Nama dicek juga sebagai jaring pengaman
	// bila suatu sumber tidak mengirim scene type-nya.
	if (Number(badge.badgeSceneType) === 2) return true;
	const name = String(badge.name || badge.topBadgeName?.name || '').trim();
	return /^new\s*gifter$/i.test(name);
}

// Batas karakter pesan chat, dihitung dari yang TERLIHAT pemirsa.
// Shortcode emote ("[thumb]") panjang di teks mentah tapi hanya tampil sebagai
// SATU emote, jadi menghitung `length` mentah membuat kuota habis oleh sintaks:
// empat "[thumb]" (28 karakter) menyisakan 2 slot untuk isi pesan. Di sini satu
// emote = satu slot, sama seperti yang terlihat di layar. Emoji juga dihitung
// SATU per emoji (bukan per code unit), supaya potongan tidak pernah membelah
// emoji jadi karakter rusak.
const CHAT_MESSAGE_MAX = 30;

// Batas jumlah emote pada alert first chatter. Viewer bisa mengirim puluhan
// emote sekaligus; tanpa batas ini pill penuh oleh stiker. Emote ke-16 dan
// seterusnya dipotong, bukan ditampilkan. Berlaku untuk emote payload MAUPUN
// shortcode yang diketik (mis. "[thumb]").
const FIRST_CHATTER_EMOTE_MAX = 15;

// Cocokkan shortcode emote yang DIKENAL pada posisi awal `text`.
// Mengembalikan panjang token, atau 0 bila bukan shortcode yang dikenal.
function ChatShortcodeAt(text, index) {
	const m = /^\[[a-z0-9_]+\]/i.exec(text.slice(index));
	if (!m) return 0;
	// Hanya token yang ada di tabel yang dihitung sebagai satu emote; kurung
	// biasa seperti "[INFO]" tetap dihitung per karakter.
	return Object.prototype.hasOwnProperty.call(EMOTES, m[0].toLowerCase()) ? m[0].length : 0;
}

// Panjang satu "satuan terlihat" pada posisi i: emote payload = 1 (menempati
// satu placeholder), shortcode dikenal = panjang token, emoji = 2 code unit
// (pasangan surrogate, tidak boleh dibelah), dan tanda yang menempel pada
// karakter dasar (ZWJ / variation selector / modifier / tanda gabung) = 0.
function ChatUnitAt(text, i, emoteAt) {
	if (emoteAt.has(i)) return 1;
	const tokenLen = ChatShortcodeAt(text, i);
	if (tokenLen > 0) return tokenLen;
	const cp = text.codePointAt(i);
	if (cp >= 0x1F3FB && cp <= 0x1F3FF) return 0;   // modifier warna kulit
	if (cp >= 0x1F9B0 && cp <= 0x1F9B3) return 0;   // modifier rambut
	if (cp === 0x200D) return 0;                    // ZWJ (perekat emoji)
	if (cp === 0xFE0E || cp === 0xFE0F) return 0;   // variation selector
	if (/\p{M}/u.test(text[i])) return 0;          // tanda gabung (combining)
	return cp > 0xFFFF ? 2 : 1;
}

// Kumpulkan indeks emote payload (dari `placeInComment`).
function ChatEmoteIndexSet(emotes) {
	const set = new Set();
	if (Array.isArray(emotes)) {
		for (const e of emotes) {
			const at = Number(e && e.placeInComment);
			if (isFinite(at) && at >= 0) set.add(at);
		}
	}
	return set;
}

// Potong kelebihan emote: emote payload DAN shortcode yang diketik digabung
// berurutan, lalu emote ke-(max+1) dan sesudahnya dibuang. Mengembalikan teks
// baru, atau teks asli bila jumlahnya masih di dalam batas.
function CutExcessEmotes(text, emotes, max) {
	if (!(max > 0)) return text;
	const emoteAt = ChatEmoteIndexSet(emotes);
	const marks = [];
	let i = 0;
	while (i < text.length) {
		if (emoteAt.has(i)) { marks.push({ start: i, end: i + 1 }); i += 1; continue; }
		const tokenLen = ChatShortcodeAt(text, i);
		if (tokenLen > 0) { marks.push({ start: i, end: i + tokenLen }); i += tokenLen; continue; }
		i += 1;
	}
	if (marks.length <= max) return text;
	return text.slice(0, marks[max].start);
}

// Indeks mentah tempat satuan TERLIHAT ke-`max` berakhir.
// Mengembalikan -1 bila seluruh teks masih di dalam kuota.
function ChatVisibleCutIndex(text, emotes, max) {
	const emoteAt = ChatEmoteIndexSet(emotes);

	let visible = 0;
	let i = 0;
	while (i < text.length) {
		const unitLen = ChatUnitAt(text, i, emoteAt);
		if (unitLen > 0) {
			if (visible + 1 > max) return i;
			visible += 1;
		}
		i += unitLen > 0 ? unitLen : 1;
	}
	return -1;
}

// Potong pesan chat pada kuota karakter TERLIHAT; tambahkan elipsis bila ada
// yang dibuang. `maxEmotes` (opsional) juga membatasi jumlah emote (payload dan
// shortcode). Dipakai jalur live maupun tombol Test.
function TruncateChatMessage(rawMessage, emotes, maxEmotes) {
	let text = String(rawMessage == null ? '' : rawMessage);
	text = CutExcessEmotes(text, emotes, maxEmotes);
	const cut = ChatVisibleCutIndex(text, emotes, CHAT_MESSAGE_MAX);
	return cut < 0 ? text : text.slice(0, cut) + '\u2026';
}

// Ambil maksimal 2 badge dari payload TikTok, lengkap dengan label + warnanya.
// Urutan payload dipertahankan (biasanya grade dulu, lalu Top Gifter).
function GetUserBadges(tiktokData) {
	if (!tiktokData) return [];
	const list = tiktokData.userBadges || tiktokData.user?.userBadges || [];
	if (!Array.isArray(list)) return [];
	const out = [];
	for (const b of list) {
		if (!b || typeof b !== 'object') continue;
		const url = CleanBadgeUrl(b.image || b.imageUrl || b.url);
		if (!url) continue;
		out.push({
			url,
			label: IsIconOnlyBadge(b) ? '' : CleanBadgeLabel(b.name || b.topBadgeName?.name || ''),
			color: ParseBadgeColor(b.color)
		});
		if (out.length >= 2) break;
	}
	return out;
}

// ══ Emote TikTok ══
// Dua sumber emote di komentar:
//   1. Shortcode yang DIKETIK viewer, mis. "[laugh]" -> PNG di resources/emotes/
//      (atau emoji, bila nilainya bukan nama berkas .png).
//   2. Emote bawaan TikTok yang dikirim PAYLOAD. Ini yang dipakai emote khusus
//      subscriber: tidak punya shortcode, jadi hanya bisa dirender dari payload.
const EMOTE_BASE = '../resources/emotes/';
const EMOTES = {
	// -- artwork TikTok sendiri -----------------------------------------------
	'[wow]': 'wow.png',
	'[laugh]': 'laugh.png',
	'[laughcry]': 'laughcry.png',
	'[thanks]': 'thanks.png',
	'[thumb]': 'thumb.png',
	'[hi]': 'hi.png',
	'[heart]': 'heart.png',
	'[congrat]': 'congrat.png',
	'[rockyserious]': 'rockyserious.png',
	'[rockyloveit]': 'rockyloveit.png',
	'[rockyproud]': 'rockyproud.png',
	'[rockycool]': 'rockycool.png',
	'[rosiedislike]': 'rosiedislike.png',
	'[rosieawkward]': 'rosieawkward.png',
	'[rosiekisskiss]': 'rosiekisskiss.png',
	'[rosiecute]': 'rosiecute.png',
	'[jolliekissingface]': 'jolliekissingface.png',
	'[jolliewow]': 'jolliewow.png',
	'[jolliespeechless]': 'jolliespeechless.png',
	'[jolliesatisfied]': 'jolliesatisfied.png',
	'[sagethink]': 'sagethink.png',
	'[sagefulfilled]': 'sagefulfilled.png',
	'[sageclever]': 'sageclever.png',
	'[sagemoney]': 'sagemoney.png',

	// -- unicode passthrough (shortcode -> emoji) ------------------------------
	'[grinning]': '😀', '[smiley]': '😃', '[smile]': '😄',
	'[grin]': '😁', '[laughing]': '😆', '[sweat_smile]': '😅',
	'[rofl]': '🤣', '[joy]': '😂', '[slightly_smiling_face]': '🙂',
	'[upside_down_face]': '🙃', '[wink]': '😉', '[blush]': '😊',
	'[innocent]': '😇', '[heart_eyes]': '😍', '[kissing_heart]': '😘',
	'[kissing]': '😗', '[kissing_closed_eyes]': '😚', '[kissing_smiling_eyes]': '😙',
	'[yum]': '😋', '[stuck_out_tongue]': '😛', '[stuck_out_tongue_winking_eye]': '😜',
	'[stuck_out_tongue_closed_eyes]': '😝', '[money_mouth_face]': '🤑', '[hugs]': '🤗',
	'[thinking]': '🤔', '[zipper_mouth_face]': '🤐', '[neutral_face]': '😐',
	'[expressionless]': '😑', '[no_mouth]': '😶', '[smirk]': '😏',
	'[unamused]': '😒', '[roll_eyes]': '🙄', '[grimacing]': '😬',
	'[lying_face]': '🤥', '[relieved]': '😌', '[pensive]': '😔',
	'[sleepy]': '😪', '[drooling_face]': '🤤', '[sleeping]': '😴',
	'[mask]': '😷', '[face_with_thermometer]': '🤒', '[face_with_head_bandage]': '🤕',
	'[nauseated_face]': '🤢', '[sneezing_face]': '🤧', '[dizzy_face]': '😵',
	'[cowboy_hat_face]': '🤠', '[sunglasses]': '😎', '[nerd_face]': '🤓',
	'[confused]': '😕', '[worried]': '😟', '[slightly_frowning_face]': '🙁',
	'[open_mouth]': '😮', '[hushed]': '😯', '[astonished]': '😲',
	'[flushed]': '😳', '[frowning]': '😦', '[anguished]': '😧',
	'[fearful]': '😨', '[cold_sweat]': '😰', '[disappointed_relieved]': '😥',
	'[cry]': '😢', '[sob]': '😭', '[scream]': '😱',
	'[confounded]': '😖', '[persevere]': '😣', '[disappointed]': '😞',
	'[sweat]': '😓', '[weary]': '😩', '[tired_face]': '😫',
	'[triumph]': '😤', '[rage]': '😡', '[angry]': '😠',
	'[smiling_imp]': '😈', '[imp]': '👿', '[skull]': '💀',
	'[hankey]': '💩', '[clown_face]': '🤡', '[japanese_ogre]': '👹',
	'[japanese_goblin]': '👺', '[ghost]': '👻', '[alien]': '👽',
	'[space_invader]': '👾', '[robot]': '🤖', '[smiley_cat]': '😺',
	'[smile_cat]': '😸', '[joy_cat]': '😹', '[heart_eyes_cat]': '😻',
	'[smirk_cat]': '😼', '[kissing_cat]': '😽', '[scream_cat]': '🙀',
	'[crying_cat_face]': '😿', '[pouting_cat]': '😾',
};

// Emote dari payload membawa `emoteImageUrl` + `placeInComment`: SATU emote
// menggantikan SATU karakter placeholder di dalam komentar, bukan rentang
// start/end seperti Twitch. Karena itu penyisipan harus memakai indeks itu.
function RenderChatMessageHtml(rawMessage, emotes) {
	// CATATAN: teks di sini TIDAK disanitasi. `emote.placeInComment` mengacu
	// pada pesan mentah, jadi menghapus karakter lebih dulu akan menggeser
	// indeks dan emote mendarat di posisi salah. Sanitasi dilakukan per
	// segmen teks di RenderChatTextHtml, yang tidak menyentuh indeks.
	const text = String(rawMessage == null ? '' : rawMessage);
	const list = Array.isArray(emotes) ? emotes.filter(Boolean).slice() : [];
	if (list.length === 0) return RenderChatTextHtml(text);

	list.sort((a, b) => (Number(a.placeInComment) || 0) - (Number(b.placeInComment) || 0));

	let html = '';
	let cursor = 0;
	for (const emote of list) {
		const at = Number(emote.placeInComment);
		// Indeks tidak sah, sudah dilewati emote sebelumnya, atau placeholder-nya
		// berada di luar teks (mis. kena potong kuota) -> lewati. Tanpa cek terakhir,
		// emote yang seharusnya terbuang tetap tersisip di ujung pesan.
		if (!isFinite(at) || at < cursor || at >= text.length) continue;
		if (at > cursor) html += RenderChatTextHtml(text.slice(cursor, at));
		const url = EmoteImageUrl(emote);
		if (url) {
			const label = EscapeBadgeText(String(emote.emoteId || ''));
			html += `<img class="emote" src="${url}" alt="${label}" title="${label}">`;
		}
		cursor = at + 1;
	}
	html += RenderChatTextHtml(text.slice(cursor));
	return html;
}

function EmoteImageUrl(emote) {
	const raw = emote.emoteImageUrl || emote.emoteUrl || emote.imageUrl || emote.url || '';
	// CleanBadgeUrl membuang bungkus `@url:`...`` dan menolak URL tak aman.
	return CleanBadgeUrl(raw);
}

// Segmen teks biasa tetap bisa memuat shortcode yang DIKETIK, mis. "[laugh]".
// Setiap potongan di-escape; hanya shortcode yang dikenal yang jadi <img>.
// Karakter TAK TERLIHAT yang bisa merusak bentuk overlay. Chat datang dari
// pemirsa, jadi harus dianggap tidak tepercaya:
//   - kontrol C0/C1 (termasuk baris baru & tab) -> memecah tata letak
//   - zero-width (U+200B, U+2060, U+FEFF)      -> teks tampak kosong
//   - bidi (U+200E/200F, U+202A-202E, U+2066-2069) -> MEMBALIK arah seluruh
//     teks, sehingga isi pill kacau tanpa terlihat sebabnya
//   - U+00AD (soft hyphen), U+180E, U+2061-2064
// ZWJ (U+200D) dan ZWNJ (U+200C) SENGAJA tidak dibuang: keduanya bagian sah
// dari emoji majemuk (mis. 👨‍👩‍👧) dan penulisan beberapa bahasa.
// Karakter TAK TERLIHAT yang bisa merusak bentuk overlay. Chat datang dari
// pemirsa, jadi harus dianggap tidak tepercaya:
//   - kontrol C0/C1 (termasuk baris baru & tab) -> memecah tata letak
//   - zero-width (U+200B, U+2060, U+FEFF)      -> teks tampak kosong
//   - bidi (U+200E/200F, U+202A-202E, U+2066-2069) -> MEMBALIK arah seluruh
//     teks, sehingga isi pill kacau tanpa terlihat sebabnya
//   - U+00AD (soft hyphen) dan U+180E
// ZWJ (U+200D) dan ZWNJ (U+200C) SENGAJA tidak dibuang: keduanya bagian sah
// dari emoji majemuk dan penulisan beberapa bahasa.
function SanitizeVisibleText(raw) {
	let s = String(raw == null ? '' : raw);
	let out = '';
	for (const ch of s) {
		const c = ch.codePointAt(0);
		// Baris baru / tab jadi spasi supaya kata tidak menempel.
		if (c === 9 || c === 10 || c === 13) { out += ' '; continue; }
		// Kontrol C0/C1.
		if (c <= 0x1F || (c >= 0x7F && c <= 0x9F)) continue;
		if (c === 0xAD || c === 0x180E) continue;
		if (c === 0x200B || c === 0x200E || c === 0x200F) continue;
		if (c >= 0x202A && c <= 0x202E) continue;
		if (c >= 0x2060 && c <= 0x2064) continue;
		if (c >= 0x2066 && c <= 0x2069) continue;
		if (c === 0xFEFF) continue;
		out += ch;
	}
	// Rapatkan spasi ganda sisa pembuangan karakter.
	return out.split('  ').join(' ').trim();
}

function RenderChatTextHtml(segment) {
	segment = SanitizeVisibleText(segment);
	let html = '';
	let cursor = 0;
	const pattern = /\[[a-z0-9_]+\]/gi;
	let match;

	while ((match = pattern.exec(segment)) !== null) {
		const token = match[0];
		const value = EMOTES[token.toLowerCase()];
		if (value === undefined) continue; // bukan shortcode dikenal -> teks biasa

		html += EscapeBadgeText(segment.slice(cursor, match.index));

		if (value.endsWith('.png')) {
			const label = EscapeBadgeText(token);
			html += `<img class="emote" src="${EMOTE_BASE + value}" alt="${label}" title="${label}">`;
		} else {
			html += EscapeBadgeText(value);
		}

		cursor = match.index + token.length;
	}

	html += EscapeBadgeText(segment.slice(cursor));
	return html;
}

// Badge TikTok PNG punya margin transparan yang TIDAK simetris (mis. Top Gifter:
// 7px di atas vs 13px di bawah), jadi medal-nya duduk lebih tinggi dari pusat
// kotak dan sisa margin bawah tampil sebagai "ruang kosong" (putih, bila viewer
// memakai latar terang). Potong gambar ke kotak isinya sekali per URL, lalu pakai
// hasilnya sebagai src. Gagal (CORS/canvas) -> pakai URL asli.
const badgeCropCache = new Map();

function CropBadgeToContent(url, onDone) {
	if (badgeCropCache.has(url)) {
		onDone(badgeCropCache.get(url));
		return;
	}
	const img = new Image();
	img.crossOrigin = 'anonymous';
	img.onload = () => {
		let out = url;
		try {
			const c = document.createElement('canvas');
			c.width = img.naturalWidth;
			c.height = img.naturalHeight;
			const ctx = c.getContext('2d', { willReadFrequently: true });
			ctx.drawImage(img, 0, 0);
			const d = ctx.getImageData(0, 0, c.width, c.height).data;
			let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
			for (let y = 0; y < c.height; y++) {
				for (let x = 0; x < c.width; x++) {
					if (d[(y * c.width + x) * 4 + 3] > 12) {
						if (x < x0) x0 = x;
						if (x > x1) x1 = x;
						if (y < y0) y0 = y;
						if (y > y1) y1 = y;
					}
				}
			}
			if (x1 > x0 && y1 > y0) {
				// Padding tipis seragam supaya tepi artwork tidak mepet kotak.
				const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.05);
				x0 = Math.max(0, x0 - pad);
				y0 = Math.max(0, y0 - pad);
				x1 = Math.min(c.width - 1, x1 + pad);
				y1 = Math.min(c.height - 1, y1 + pad);
				const w = x1 - x0 + 1, h = y1 - y0 + 1;
				const c2 = document.createElement('canvas');
				c2.width = w;
				c2.height = h;
				c2.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
				out = c2.toDataURL('image/png');
			}
		} catch (e) {
			// CORS / canvas tidak bisa dibaca -> biarkan URL asli.
			out = url;
		}
		badgeCropCache.set(url, out);
		onDone(out);
	};
	img.onerror = () => {
		badgeCropCache.set(url, url);
		onDone(url);
	};
	img.src = url;
}

// Tampilkan badge sebagai pill berwarna (ikon + label) di kanan username.
// Kosong -> sembunyikan. Label dilewatkan CleanBadgeLabel lagi supaya aturan
// "buang awalan No." juga berlaku untuk badge contoh (tombol Test).
function RenderBadges(badges) {
	if (!islandBadges) return;
	// Gerbang "Show Badge Icon" (Settings > General, di bawah Notification Sound).
	// Dicek di sini supaya jalur live DAN tombol Test ikut tunduk pada setelan yang
	// sama, tanpa perlu menyentuh setiap pemanggil.
	if (!enableBadgeIcon) {
		islandBadges.innerHTML = '';
		islandBadges.classList.add('hidden');
		return;
	}
	if (!Array.isArray(badges) || badges.length === 0) {
		islandBadges.innerHTML = '';
		islandBadges.classList.add('hidden');
		return;
	}
	islandBadges.innerHTML = badges
		.map((b) => {
			const url = typeof b === 'string' ? b : b.url;
			if (!url) return '';
			const label = typeof b === 'string' ? '' : CleanBadgeLabel(b.label || '');
			// Selalu lewat ParseBadgeColor: badge contoh membawa hex mentah, dan
			// hex 8 digit akan salah dibaca CSS sebagai #RRGGBBAA.
			const color = typeof b === 'string' ? '' : ParseBadgeColor(b.color || '');
			const style = color ? ` style="--badge-color:${color}"` : '';
			const cls = label ? 'island-badge' : 'island-badge icon-only';
			const text = label ? `<span class="badge-label">${EscapeBadgeText(label)}</span>` : '';
			return `<span class="${cls}"${style}><img src="${url}" alt="">${text}</span>`;
		})
		.join('');
	// Tampilkan dulu dengan URL asli (langsung terlihat), lalu perhalus dengan
	// versi yang sudah dipotong ke kotak isinya begitu selesai dihitung.
	for (const el of islandBadges.querySelectorAll('img')) {
		const original = el.getAttribute('src');
		CropBadgeToContent(original, (better) => {
			// Alert bisa sudah berganti saat pemotongan selesai -> pastikan elemen
			// ini masih terpasang dan src-nya belum diubah pihak lain.
			if (better && better !== original && el.isConnected && el.getAttribute('src') === original) {
				el.src = better;
			}
		});
	}
	islandBadges.classList.remove('hidden');
}

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
	superFan: 'https://img.icons8.com/fluency-systems-filled/96/FFD700/crown.png',
	share: 'https://img.icons8.com/fluency-systems-filled/96/00F2FE/share.png',
	like: 'https://img.icons8.com/fluency-systems-filled/96/FF0050/like.png'
};

let weatherData = null;
let viewerCount = null;
let currentPanelIndex = 0;
// Render pertama sudah jalan? Pill ditahan tersembunyi sampai ini true,
// supaya "Loading..." + ikon kosong tidak pernah terlihat saat reload.
let islandPaintedOnce = false;
// [AMBIENT ROTASI] Waktu (ms) panel saat ini mulai tayang. Rotasi dihitung dari
// anchor ini, bukan dari tick timer, supaya rotasi tetap berjalan selama alert
// menghentikan timer dan bisa dikejar (CatchUpRotation) saat ambient dipulihkan.
let cycleAnchorAt = Date.now();
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

const appLanguage = urlParams.get("language") || "en";

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
const PAUSE_STORAGE_KEY = WIDGET_NS + 'paused-state';

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

// Apakah provider TikTok (Geseki Bridge) sedang terhubung. Panel viewer
// count memakai ini sebagai sumber kebenaran: selama terhubung, angka penonton
// dari event roomUser selalu valid - tidak perlu menunggu status live.
function IsTikTokProviderConnected() {
	return Boolean(typeof tikTokStatus !== 'undefined' && tikTokStatus.connected);
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
		id: 'music',
		// ══ TIME & NOW PLAYING (panel gabungan, menggantikan panel time lama) ══
		// Selalu tampil: waktu tidak pernah kosong. Musik hanya menambah
		// wave icon (kiri) + album art (kanan); tanpa lagu tampil jam saja.
		// [PAUSE] overlay ⏸ tetap di album art: art tetap dirender ke
		// #islandIconWrap (rumah #islandPauseOverlay), lalu dipindah ke kanan
		// lewat CSS `order` saat panel ini aktif (lihat style.css).
		icon: () => (HasPlayableTrack() && nowPlayingData.albumArt) ? nowPlayingData.albumArt : ALERT_ICONS.clock,
		rightIcon: () => ((HasPlayableTrack() && nowPlayingData.albumArt) ? (() => {
			const hexStr = encodeURIComponent(nowPlayingData.lightVibrant || "#8A2BE2");
			// ══ Wave icon: PLAY vs PAUSE ══
			// - Play : 3 bar beranimasi (SMIL <animate>) — equalizer hidup.
			// - Pause: 3 bar FLAT pendek, tanpa animasi — "equalizer kosong".
			//   (Pilihan user 2026-09-19; overlay ⏸ tetap di album art.)
			// [PENTING] src berbeda antara play/pause -> RefreshMusicWaveIcon()
			// mengganti src hanya saat src-nya berbeda, jadi animasi tidak restart
			// tiap tick; transisi play<->pause berganti tepat saat status berubah.
			if (nowPlayingData.pausedAtMs !== null) {
				// Flat: y=10, height=4, semua bar sama. TANPA <animate>.
				return `data:image/svg+xml;utf8,%3Csvg%20fill%3D%22${hexStr}%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%222%22%20y%3D%2210%22%20width%3D%225%22%20height%3D%224%22%20rx%3D%222%22%2F%3E%3Crect%20x%3D%229%22%20y%3D%2210%22%20width%3D%225%22%20height%3D%224%22%20rx%3D%222%22%2F%3E%3Crect%20x%3D%2216%22%20y%3D%2210%22%20width%3D%225%22%20height%3D%224%22%20rx%3D%222%22%2F%3E%3C%2Fsvg%3E`;
			}
			return `data:image/svg+xml;utf8,%3Csvg%20fill%3D%22${hexStr}%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%222%22%20y%3D%229%22%20width%3D%225%22%20height%3D%226%22%20rx%3D%222%22%3E%3Canimate%20attributeName%3D%22height%22%20values%3D%226%3B16%3B6%22%20begin%3D%220s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3Canimate%20attributeName%3D%22y%22%20values%3D%229%3B4%3B9%22%20begin%3D%220s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3C%2Frect%3E%3Crect%20x%3D%229%22%20y%3D%223%22%20width%3D%225%22%20height%3D%2218%22%20rx%3D%222%22%3E%3Canimate%20attributeName%3D%22height%22%20values%3D%2218%3B8%3B18%22%20begin%3D%220.2s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3Canimate%20attributeName%3D%22y%22%20values%3D%223%3B8%3B3%22%20begin%3D%220.2s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3C%2Frect%3E%3Crect%20x%3D%2216%22%20y%3D%227%22%20width%3D%225%22%20height%3D%2210%22%20rx%3D%222%22%3E%3Canimate%20attributeName%3D%22height%22%20values%3D%2210%3B18%3B10%22%20begin%3D%220.4s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3Canimate%20attributeName%3D%22y%22%20values%3D%227%3B3%3B7%22%20begin%3D%220.4s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3C%2Frect%3E%3C%2Fsvg%3E`;
		})() : null),
		ticks: true,
		// Tengah: waktu saja — judul/artis tidak ditampilkan di panel gabungan.
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
			// Ikuti Language global, sama seperti deskripsi cuaca di FetchWeather.
			return (appLanguage || "en").toLowerCase().startsWith("id")
				? 'Cuaca tidak tersedia'
				: 'Weather unavailable';
		}
	},
	{
		id: 'viewers',
		icon: ALERT_ICONS.viewers, // yellow eye
		ticks: false,
		text: () => {
			// Provider terhubung = angka penonton valid, lewati liveStatus (sumber terpisah).
			if (!IsTikTokProviderConnected() && liveStatus !== 2) return offlineViewersText;
			// Terhubung ke websocket TIDAK berarti streamer sudah live. Sembunyikan angka
			// HANYA bila data penonton belum pernah diterima (null). Bila provider memang
			// melaporkan 0, itu data nyata -- tetap tampilkan "0 viewers".
			if (viewerCount === null || viewerCount === undefined
				|| !isFinite(Number(viewerCount))) return offlineViewersText;
			const n = FormatViewers(viewerCount);
			// Ikuti pengaturan Language global (appLanguage): id = "penonton",
			// en = "viewers". Tidak ada default terpisah.
			const word = appLanguage === 'en' ? 'viewers' : 'penonton';
			return `${n} ${word}`;
		},
		// Simpan nilai mentah di data-viewers supaya angka aslinya tidak hilang setelah diformat.
		rawViewers: () => ((IsTikTokProviderConnected() || liveStatus === 2)
			? Math.max(0, Math.floor(Number(viewerCount) || 0))
			: 0)
	}
	// [DIHAPUS] Panel music lama: digabung ke panel "Time & Now Playing" di atas
	// (wave kiri, waktu tengah, album art kanan). Jalur alert song-change tetap
	// memakai id 'music' — sekarang menunjuk panel gabungan ini.
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
		// Alias lama: id 'time' sudah digabung ke panel 'music' (Time & Now Playing).
		// URL/setting lama yang masih menyimpan 'time' diarahkan ke panel gabungan
		// supaya tampilan waktu tidak hilang.
		if (id === 'time') id = 'music';
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
				// Posisikan matematis: Big mulai minimal 25% lebar, lalu bergerak ke 100%
				// saat lagu mendekati akhir. Medium mulai 0% — bar mengisi penuh dari kiri.
				const visualPct = isMusicMedium ? pct : (25 + (pct * 0.75));
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
	// Jangan buka pill sebelum render pertama. ApplyNowPlayingData memanggil
	// fungsi ini begitu fetch data selesai (~1 dtk), JAUH sebelum UpdateInfoText()
	// menggambar teks & ikon - tanpa guard ini pill muncul dengan "Loading..."
	// dan ikon kosong (gambar rusak) saat reload.
	if (!islandPaintedOnce) {
		dynamicIsland.classList.add('island-no-panel');
		return;
	}
	const anyVisible = infoPanels.some(p => !(p.skip && p.skip()));
	dynamicIsland.classList.toggle('island-no-panel', !anyVisible);
}

// Majukan indeks rotasi SATU langkah, melewati panel yang di-skip.
// Dipakai rotasi normal (CycleInfo) dan pengejaran rotasi setelah alert.
function AdvancePanelIndexOnce() {
	let attempts = 0;
	do {
		currentPanelIndex = (currentPanelIndex + 1) % infoPanels.length;
		attempts++;
	} while (infoPanels[currentPanelIndex].skip && infoPanels[currentPanelIndex].skip() && attempts < infoPanels.length);
}

// [AMBIENT ROTASI] Selama alert, cycle timer dihentikan. Rotasi tetap dihitung dari
// cycleAnchorAt; saat ambient dipulihkan, kejar semua slot yang terlewat supaya panel
// yang tampil seolah alert TIDAK menginterupsi rotasi.
function CatchUpRotation(force = false) {
	if (isAlertActive && !force) return;
	const len = infoPanels.length;
	if (!len) return;
	let steps = Math.floor((Date.now() - cycleAnchorAt) / infoCycleDuration);
	if (steps <= 0) return;
	// Satu putaran penuh kembali ke panel yang sama - cukup sisanya saja.
	steps = steps % len;
	for (let i = 0; i < steps; i++) {
		AdvancePanelIndexOnce();
	}
}

function CycleInfo() {
	if (isAlertActive) return;
	AdvancePanelIndexOnce();
	cycleAnchorAt = Date.now(); // slot baru mulai sekarang
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
	// [ALERT] Slot kanan (#islandEventIcon) dipakai BERSAMA: kartu musik memakai
	// wave, alert TikTok lain (gift/chat/follow) memakai ikon event-nya. Saat ada
	// alert aktif, wave HANYA boleh ditulis bila alert itu memang alert musik --
	// tanpa cek ini, lagu yang berganti di tengah alert gift menimpa ikon gift
	// dengan wave, dan wave tampak "muncul duluan" sebelum alert musiknya tayang.
	if (isAlertActive) {
		const active = window.currentActiveAlertData;
		if (!active || active.type !== 'music') return;
	}
	const panel = infoPanels[currentPanelIndex];
	if (!panel || panel.id !== 'music' || !panel.rightIcon) return;
	if (islandEventIcon) {
		// Jangan set ulang src kalau warna belum berubah: set ulang me-restart animasi
		// <animate> di dalam SVG (wave jadi patah-patah).
		const nextSrc = typeof panel.rightIcon === 'function' ? panel.rightIcon() : panel.rightIcon;
		// [GUARD null] Panel gabungan mengembalikan null saat tidak ada lagu —
		// jangan set src=null (ikon rusak), sembunyikan saja wave-nya.
		if (!nextSrc) {
			islandEventIcon.classList.add('hidden');
			islandEventIcon.src = '';
			islandEventIcon.__gesekiRightSrc = '';
			return;
		}
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

// Sinkronkan ikon kiri (#islandIcon) dengan panel aktif: album art saat ada lagu,
// ikon panel (mis. jam) saat tidak ada. Dipakai jalur ANIMASI maupun jalur SENYAP.
// [BUG FIX] Dulu jalur senyap tidak pernah menyentuh ikon sama sekali; saat lagu
// berhenti sementara panel Time & Now Playing tayang, album art tertinggal dan
// ikon jam tidak muncul sampai rotasi berganti panel.
function SyncIslandIcon(panel) {
	if (!islandIcon || !panel) return;
	const nextIcon = typeof panel.icon === 'function' ? panel.icon() : panel.icon;
	// Bandingkan atribut mentah (getAttribute), bukan properti .src yang sudah
	// di-resolve jadi URL absolut — supaya tidak set ulang tiap detik (tick jam).
	if (islandIcon.getAttribute('src') !== nextIcon) {
		islandIcon.src = nextIcon;
	}
	// Kotak membulat hanya untuk ALBUM ART; ikon jam/panel lain tetap polos.
	if (panel.id === 'music' && HasPlayableTrack() && nowPlayingData.albumArt && nowPlayingData.albumArt !== "") {
		islandIcon.classList.add('rounded-icon');
	} else {
		islandIcon.classList.remove('rounded-icon');
	}
	// onerror di-null-kan supaya handler panel SEBELUMNYA tidak menempel.
	islandIcon.onerror = null;
	islandIcon.classList.remove('hidden');
	SyncIconWrapHidden();
}

function ApplyInfoPanel(animate, allowBounce = true) {
	if (isAlertActive) return;
	const panel = infoPanels[currentPanelIndex];
	if (!panel) return;

	const nextText = panel.text();

	// Penanda panel gabungan "Time & Now Playing" sedang aktif di AMBIENT.
	// Dipakai CSS untuk memindah album art ke kanan (order) — hanya bila
	// ada lagu; mode jam-saja tidak dipindah agar ikon jam tetap di kiri.
	// `panel-time` menyala TANPA syarat lagu: dipakai untuk mengunci lebar
	// teks jam (angka tabular) supaya pill tidak goyang tiap detik.
	if (dynamicIsland) {
		dynamicIsland.classList.toggle('panel-time', panel.id === 'music');
		dynamicIsland.classList.toggle('panel-time-music',
			panel.id === 'music' && HasPlayableTrack() && !!nowPlayingData.albumArt);
	}

	// -- SATU-SATUNYA penanda pause --
	// Panel ambient musik = SATU panel. Pause HANYA mengubah: 1) class pill
	// `music-paused` -> overlay pause (CSS), 2) teks -> "Paused • m:ss". Wave icon,
	// marquee, ikon, dan jalur render SAMA PERSIS seperti saat play.
	// [GUARD] pause hanya berlaku bila ADA album art: panel gabungan kini selalu
	// tampil, jadi tanpa syarat ini overlay ⏸ bisa menimpa ikon jam.
	if (dynamicIsland) {
		dynamicIsland.classList.toggle('music-paused',
			panel.id === 'music' && nowPlayingData.pausedAtMs !== null
			&& HasPlayableTrack() && !!nowPlayingData.albumArt);
		// Warna aksen untuk icon pause. Hanya panel ambient - dynamic big tidak disentuh.
		if (panel.id === 'music' && !dynamicIsland.classList.contains(MUSIC_CARD_CLASS)) {
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
		// [BUG FIX] Ikon kiri juga harus disinkronkan di jalur senyap: saat lagu
		// berhenti, album art harus berganti ke ikon jam TANPA menunggu rotasi.
		SyncIslandIcon(panel);
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

	// Sinkronkan ikon kiri (album art / ikon jam) — satu jalur dengan mode senyap.
	SyncIslandIcon(panel);

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
	// Badge hanya milik kartu alert: kembali ke ambient -> bersihkan.
	RenderBadges(null);
	
	// Mode pause panel musik: overlay pause menutupi album art, wave icon disembunyikan.
	// Diterapkan di atas blok mode senyap supaya berlaku di SEMUA mode render.
	// [GUARD null] rightIcon kini SELALU fungsi, tapi mengembalikan null saat tidak
	// ada lagu (panel gabungan hanya menampilkan jam). Tanpa cek ini, <img> di-set
	// src=null dan muncul ikon rusak.
	const nextRight = (islandEventIcon && panel.rightIcon)
		? (typeof panel.rightIcon === 'function' ? panel.rightIcon() : panel.rightIcon)
		: null;
	if (islandEventIcon && nextRight) {
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

// Now Playing is PUSHED over the bridge WebSocket (frame `type:"nowplaying"`),
// so there is no HTTP poll and no 1-second timer. The bridge sends it whenever
// it changes and at least once per second while a session plays.
async function ApplyNowPlayingPush(data) {
	if (!enableNowPlaying) {
		nowPlayingData.isPlaying = false;
		return;
	}
	if (!data) return;
	await ApplyNowPlayingData(data);
}

// Bridge putus -> koneksi berikutnya dianggap sesi baru (lagu pertama tidak lagi
// dianggap "ganti lagu").
function ResetNowPlayingOnDisconnect() {
	nowPlayingData.isPlaying = false;
	nowPlayingData._seeded = false;
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

// Inti pemrosesan now playing. Dipanggil dari push WebSocket bridge.
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
			// [ALERT] Saat lagu BERGANTI, biarkan alert musik yang menggambar kartunya
			// (termasuk wave-nya). Menulis wave ambient lebih dulu membuat pill sempat
			// menampilkan wave sebelum kartu alert membesar -- itulah kedipan "wave
			// muncul duluan".
			if (!songChanged && nowPlayingData.lightVibrant !== prevLightVibrant) {
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
					(dynamicIsland && dynamicIsland.classList.contains(MUSIC_CARD_CLASS));
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
	// Panel yang sedang tampil dihitung mulai sekarang; sisa < 1 slot diabaikan.
	cycleAnchorAt = Date.now();
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
const LS_STORAGE_KEY = WIDGET_NS + 'live-started-at';
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
			// Bersihkan riwayat first chatter HANYA untuk live yang benar-benar baru.
			// Saat source OBS di-refresh di tengah sesi, waktu mulai dipulihkan dari
			// localStorage (liveStartFromStorage = true) dan status pertama langsung
			// 'live' dengan prev = null. Tanpa penjaga ini, refresh dianggap live baru
			// dan riwayat first chatter ikut terhapus — padahal sesinya sama.
			if (!liveStartFromStorage && typeof ResetFirstChatter === 'function') ResetFirstChatter();
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
// Saat fetch gagal, coba lagi jauh lebih cepat daripada 15 menit: kalau penyedia
// cuaca hanya berkedip sebentar, panel tidak perlu kosong sampai seperempat jam.
const WEATHER_RETRY_INTERVAL = 90 * 1000;
// Batalkan fetch yang menggantung: server yang down masih menerima TCP connect
// tapi tidak mengirim byte apa pun, jadi tanpa batas ini fetch menggantung sampai
// timeout bawaan browser (~5 menit) dan rantai retry tidak pernah jalan.
const WEATHER_FETCH_TIMEOUT = 8000;

// ── Sumber cuaca: Open-Meteo ──────────────────────────────────────
// Menggantikan wttr.in, yang sertifikat TLS-nya sempat kedaluwarsa: server
// sehat tapi HTTPS ditolak browser, sehingga panel cuaca kosong total tanpa
// ada yang bisa diperbaiki dari sisi kode. Open-Meteo gratis, tanpa API key,
// dan mengirim kode cuaca numerik (WMO) yang dipetakan di bawah.
const WMO_DESC_ID = {
	0: "Cerah", 1: "Cerah Berawan", 2: "Berawan", 3: "Mendung",
	45: "Kabut", 48: "Kabut Beku",
	51: "Gerimis Ringan", 53: "Gerimis", 55: "Gerimis Lebat",
	56: "Gerimis Beku Ringan", 57: "Gerimis Beku",
	61: "Hujan Ringan", 63: "Hujan Sedang", 65: "Hujan Lebat",
	66: "Hujan Beku Ringan", 67: "Hujan Beku Lebat",
	71: "Salju Ringan", 73: "Salju Sedang", 75: "Salju Lebat", 77: "Butir Salju",
	80: "Hujan Lokal Ringan", 81: "Hujan Lokal", 82: "Hujan Lokal Lebat",
	85: "Hujan Salju Ringan", 86: "Hujan Salju Lebat",
	95: "Badai Petir", 96: "Badai Petir + Es Ringan", 99: "Badai Petir + Es Lebat"
};
const WMO_DESC_EN = {
	0: "Clear", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
	45: "Fog", 48: "Freezing Fog",
	51: "Light Drizzle", 53: "Drizzle", 55: "Dense Drizzle",
	56: "Light Freezing Drizzle", 57: "Freezing Drizzle",
	61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
	66: "Light Freezing Rain", 67: "Freezing Rain",
	71: "Light Snow", 73: "Snow", 75: "Heavy Snow", 77: "Snow Grains",
	80: "Light Rain Showers", 81: "Rain Showers", 82: "Violent Rain Showers",
	85: "Snow Showers", 86: "Heavy Snow Showers",
	95: "Thunderstorm", 96: "Thunderstorm + Light Hail", 99: "Thunderstorm + Heavy Hail"
};

// Nama kota -> lat/lon di-cache: nama kota tidak berubah selama widget hidup,
// jadi cukup satu panggilan geocoding, bukan tiap 15 menit.
let weatherGeo = null;
async function ResolveWeatherGeo(signal) {
	if (weatherGeo) return weatherGeo;
	const url = "https://geocoding-api.open-meteo.com/v1/search"
		+ `?name=${encodeURIComponent(weatherLocation)}&count=1&language=id&format=json`;
	const r = await fetch(url, { signal });
	if (!r.ok) throw new Error("geocoding HTTP " + r.status);
	const d = await r.json();
	const hit = d.results && d.results[0];
	if (!hit) throw new Error("lokasi tidak ditemukan: " + weatherLocation);
	weatherGeo = { lat: hit.latitude, lon: hit.longitude };
	return weatherGeo;
}

async function FetchWeather() {
	const controller = new AbortController();
	const abortTimer = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT);
	try {
		const isId = (appLanguage && appLanguage.toLowerCase().startsWith("id"));
		const geo = await ResolveWeatherGeo(controller.signal);
		const url = "https://api.open-meteo.com/v1/forecast"
			+ `?latitude=${geo.lat}&longitude=${geo.lon}`
			+ "&current=temperature_2m,weather_code,is_day&timezone=auto";
		const response = await fetch(url, { signal: controller.signal });
		// Respons error jangan di-parse sebagai JSON.
		if (!response.ok) throw new Error("HTTP " + response.status);
		const data = await response.json();
		const cur = data.current || {};
		// Tanpa suhu valid, biarkan panel kosong dan retry — jangan tampilkan angka palsu.
		if (typeof cur.temperature_2m !== "number") throw new Error("respons tanpa suhu");
		const table = isId ? WMO_DESC_ID : WMO_DESC_EN;
		const weatherDesc = table[cur.weather_code] || (isId ? "Cuaca" : "Weather");

		weatherData = {
			tempC: String(Math.round(cur.temperature_2m)),
			desc: weatherDesc
		};
		return true;
	} catch (error) {
		console.debug("[Geseki] Weather data fetch failed:", error);
		return false;
	} finally {
		clearTimeout(abortTimer);
	}
}

// Penjadwal cuaca berantai: interval berikutnya bergantung pada hasil fetch.
// Sukses -> kembali ke 15 menit; gagal -> coba lagi 1,5 menit. setTimeout
// berantai (bukan setInterval) supaya tidak ada dua fetch berjalan bersamaan.
let weatherTimer = null;
function ScheduleWeatherFetch(delayMs) {
	if (weatherTimer) clearTimeout(weatherTimer);
	weatherTimer = setTimeout(async () => {
		const ok = await FetchWeather();
		ScheduleWeatherFetch(ok ? WEATHER_REFRESH_INTERVAL : WEATHER_RETRY_INTERVAL);
	}, delayMs);
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
	await WithTimeout(Promise.all([FetchWeather()]), 2500);

	// Now Playing tidak di-poll: bridge mendorongnya lewat WebSocket (lihat
	// bridgeConnection), jadi tidak ada setInterval di sini.
	// Cuaca: jadwal pertama ditentukan hasil fetch di atas (sukses 15 menit,
	// gagal 1,5 menit) — bukan setInterval buta yang mengunci 15 menit.
	ScheduleWeatherFetch(weatherData ? WEATHER_REFRESH_INTERVAL : WEATHER_RETRY_INTERVAL);

	// Baru gambar: data sudah tersedia untuk semua panel.
	UpdateInfoText();
	// Render pertama selesai: baru izinkan pill ditampilkan. Sebelum ini
	// SyncIslandVisibility menahan pill tetap tersembunyi.
	islandPaintedOnce = true;
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
	// Slider 0% -> durasi tetap, antrean tidak mempercepat apa pun.
	if (adaptiveStrength <= 0) return alertDisplayDuration;

	// Hanya event yang MASIH MENUNGGU. Alert yang sedang tayang tidak dihitung.
	const backlog = alertQueue.length;

	if (backlog <= queueThreshold) return alertDisplayDuration;

	// Interpolasi linear: queueThreshold -> durasi normal, burstQueue -> durasi minimum.
	const span = Math.max(1, burstQueue - queueThreshold);
	const t = Math.min(1, (backlog - queueThreshold) / span);
	const scaled = alertDisplayDuration - t * (alertDisplayDuration - alertDurationMinMs);

	// Floor absolut menjaga animasi pop (0.38s) + transisi pill (0.35s).
	return Math.max(MIN_ALERT_FLOOR_MS, Math.round(scaled));
}

// Status & waktu event simulator. Dipakai TriggerAlert untuk melewati filter
// duplikat saat Simulator mengirim event, sehingga tiap klik selalu tampil.
var simAlertActive = false;
// True selama Simulator memproses event: kondisi "hanya chatter baru" di
// First Chatter boleh dilewati, jadi klik berulang tetap menampilkan kartu.
var simChatActive = false;

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

	// Deduplikasi berdasarkan IDENTITAS EVENT, bukan URL ikon.
	// Kunci lama `${icon}:${text}` gagal untuk event TikTok: ikon gift memakai
	// URL CDN yang berbeda tiap pengiriman, jadi duplikat lolos dan ikut
	// menumpuk di antrean -> bunyi beruntun setelah event musik.
	// `event` + `userId` dibawa dari payload websocket (lihat handleTikTokEvent).
	// Isi pesan tetap disertakan supaya dua event BERBEDA dari user yang sama
	// (mis. dua gift berlainan dalam 4 detik) tidak ikut terbuang.
	// Event non-TikTok tidak mengirim `event` -> fallback ke perilaku lama.
	const now = Date.now();
	const key = alertData.event
		? `evt:${alertData.event}:${alertData.userId || ''}:${alertData.text || alertData.title || ''}`
		: `${alertData.icon}:${alertData.text || alertData.title}`;
	// Simulator: tiap klik adalah uji sengaja, jadi filter duplikat 4 detik
	// dilewati supaya event yang baru diklik selalu tampil.
	if (!simAlertActive && recentAlerts.has(key) && (now - recentAlerts.get(key) < 4000)) {
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

// Pause semua alert (dari Controls Panel > Options). Nilainya disimpan di
// preferensi panel, jadi tetap berlaku setelah overlay dimuat ulang.
function AlertsPaused() {
	try {
		const raw = localStorage.getItem(WIDGET_NS + 'controls:prefs');
		if (!raw) return false;
		return JSON.parse(raw).alertsPaused === '1';
	} catch (e) { return false; }
}

// Dipakai panel untuk menjeda/melanjutkan tanpa reload. Saat dilanjutkan,
// antrean langsung diproses lagi supaya alert yang tertahan tidak menunggu.
window.SetAlertsPaused = function (on) {
	try {
		const raw = localStorage.getItem(WIDGET_NS + 'controls:prefs');
		const prefs = raw ? JSON.parse(raw) : {};
		prefs.alertsPaused = on ? '1' : '0';
		localStorage.setItem(WIDGET_NS + 'controls:prefs', JSON.stringify(prefs));
	} catch (e) { /* abaikan */ }
	if (!on && typeof ProcessAlertQueue === 'function') ProcessAlertQueue();
};

// ---- Sinkronisasi VISUAL alert antar browser source ----
// Source yang BARU muncul (pindah scene) atau habis reload punya antrean kosong,
// jadi pill-nya menampilkan ambient dan alert yang sedang tayang di scene lain
// terputus. Source yang menayangkan alert mencatatnya di localStorage; source
// yang baru tampil membaca catatan itu dan ikut menayangkan SISA durasinya.
const ALERT_SYNC_KEY = WIDGET_NS + 'alert-sync';

// Identitas event. Dipakai untuk dedupe suara DAN untuk mengenali alert yang sama
// saat adopsi lintas source.
function AlertKey(alertData) {
	if (!alertData) return '';
	return alertData.event
		? `evt:${alertData.event}:${alertData.userId || ''}:${alertData.text || alertData.title || ''}`
		: `${alertData.icon}:${alertData.text || alertData.title}`;
}

// Catat alert yang sedang tayang. Dilewati untuk alert hasil adopsi supaya tidak
// saling menimpa (durasi adopsi lebih pendek dari durasi asli).
function PublishRunningAlert(alertData, duration) {
	if (!alertData || alertData._syncAdopted) return;
	try {
		localStorage.setItem(ALERT_SYNC_KEY, JSON.stringify({
			key: AlertKey(alertData),
			data: alertData,
			startAt: Date.now(),
			duration: duration
		}));
	} catch (e) { /* localStorage diblokir: sinkronisasi visual dilewati */ }
}

// Ikut menayangkan alert yang sedang berjalan. Hanya jalan saat source ini
// menganggur; sisa durasinya dihitung dari waktu mulai yang dicatat source asal.
function AdoptRunningAlert() {
	if (isAlertActive || alertLocked || alertQueue.length > 0) return;
	let rec = null;
	try {
		const raw = localStorage.getItem(ALERT_SYNC_KEY);
		if (raw) rec = JSON.parse(raw);
	} catch (e) { return; }
	if (!rec || !rec.data || !rec.duration) return;
	const elapsed = Date.now() - rec.startAt;
	const remaining = rec.duration - elapsed;
	// Sudah selesai (atau jam tidak sinkron): jangan ikut.
	if (elapsed < 0 || remaining <= 0) return;
	alertQueue.push(Object.assign({}, rec.data, {
		_syncAdopted: true,
		_syncRemainingMs: remaining
	}));
	ProcessAlertQueue();
}

// OBS memberi tahu tiap source saat status tampilnya berubah. Saat source ini
// mulai tampil, cek apakah ada alert yang sedang berjalan di scene lain.
// Di browser biasa event ini tidak pernah datang, jadi sourceVisible tetap true.
// Source yang baru bangun dari auto sleep bisa menerima 'obsSourceVisibleChanged'
// saat renderer CEF masih ter-throttle, sehingga adopsi alert tertunda beberapa
// detik. Karena itu jangan bergantung pada satu percobaan: ulangi sebentar.
// AdoptRunningAlert() idempoten (berhenti kalau sudah ada alert), jadi mengulang
// tidak akan menggandakan alert.
let adoptRetryTimers = [];
function ScheduleAdoptRetries() {
	adoptRetryTimers.forEach(clearTimeout);
	adoptRetryTimers = [0, 250, 700, 1400, 2500].map(ms => setTimeout(() => {
		if (sourceVisible) AdoptRunningAlert();
	}, ms));
}

window.addEventListener('obsSourceVisibleChanged', function (e) {
	if (!e || !e.detail) return;
	sourceVisible = !!e.detail.visible;
	if (sourceVisible) ScheduleAdoptRetries();
});

// Sinyal yang lebih tepat: hanya menyala untuk source di scene yang sedang
// tayang (program view). Fail-open: kalau OBS tidak mengirimnya, tetap true.
window.addEventListener('obsSourceActiveChanged', function (e) {
	if (!e || !e.detail) return;
	sourceActive = !!e.detail.active;
});

// Status awal. obs-browser memanggil window.obsstudio.onVisibilityChange() /
// onActiveChange() tepat setelah browser dibuat, jadi fungsi ini didaftarkan
// supaya kalau panggilan itu datang setelah skrip dimuat, status awal terbaca.
// document.hidden di deklarasi atas menutup kasus sebaliknya.
if (typeof window !== 'undefined' && window.obsstudio) {
	window.obsstudio.onVisibilityChange = function (visible) { sourceVisible = !!visible; };
	window.obsstudio.onActiveChange = function (active) { sourceActive = !!active; };
}

// Jaring pengaman tambahan: kalau CEF menyalakan event DOM standar saat renderer
// bangun, manfaatkan. TIDAK diandalkan - obs-browser memakai jalur sendiri, dan
// listener 'obsSourceVisibleChanged' di atas adalah pemicu utamanya.
document.addEventListener('visibilitychange', function () {
	if (!document.hidden) ScheduleAdoptRetries();
});

function ProcessAlertQueue() {
	// Jeda: alert baru ditahan, tetapi yang sedang tayang dibiarkan selesai.
	if (AlertsPaused()) return;
	if (alertLocked || alertQueue.length === 0)
		return;

	// Intip alert pertama dalam antrean
	const nextAlert = alertQueue[0];

	// [Prefetch Avatar] Tunggu foto profil 100% selesai didownload SEBELUM membuka widget
	// agar tidak blink kotak/lingkaran transparan.
	// Alert hasil adopsi TIDAK menunggu avatar: source yang baru bangun dari sleep
	// belum punya avatar di cache, dan menunggunya justru menunda sinkronisasi.
	if (nextAlert.avatar && !nextAlert._avatarLoaded && !nextAlert._syncAdopted) {
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
	// Alert bisa tayang SEBELUM init panel selesai (source baru bangun dari sleep).
	// Saat itu pill masih membawa 'island-no-panel' (opacity 0) yang hanya dilepas
	// SyncIslandVisibility() setelah init selesai -> alert sudah aktif tapi tak
	// terlihat. Buka paksa di sini supaya alert selalu tampil seketika.
	if (dynamicIsland) dynamicIsland.classList.remove('island-no-panel');
	
	// Mainkan suara notifikasi KECUALI untuk alert lagu baru (music)
	if (alertData.type !== 'music') {
		PlayAlertSound(alertData);
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
	// Alert hasil adopsi dari source lain memakai SISA durasinya supaya tidak
	// molor melewati alert yang sedang tayang di scene lain.
	if (alertData._syncRemainingMs > 0) currentAlertDuration = alertData._syncRemainingMs;
	// Catat alert yang sedang tayang supaya source yang baru muncul (pindah scene
	// atau habis reload) bisa ikut menayangkan sisanya, bukan balik ke ambient.
	PublishRunningAlert(alertData, currentAlertDuration);

	const { icon, text, title, subtext, avatar, type, rightIcon, badges } = alertData;
	// showIcon=false (khusus toggle ikon event TikTok) -> sembunyikan TOTAL ikon
	// event: tidak di kanan, dan TIDAK dipindah ke slot kiri saat tanpa avatar.
	// Event non-TikTok tidak mengirim `showIcon`, jadi default tetap tampil.
	const showIcon = alertData.showIcon !== false;

	// Badge TikTok (maks 2) tampil setelah username. Kosong -> tersembunyi.
	RenderBadges(badges);

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
		// showIcon=false -> slot kiri dibiarkan kosong, ikon event tidak pindah ke sini.
		if (showIcon) {
			islandIcon.src = icon;
			islandIcon.classList.remove('hidden');
		} else {
			islandIcon.classList.add('hidden');
			islandIcon.src = '';
		}
		SyncIconWrapHidden();
	}

	// Event icon on the right side if avatar or rightIcon is present
	if (islandEventIcon) {
		if (!showIcon) {
			islandEventIcon.classList.add('hidden');
			islandEventIcon.src = '';
		} else if (rightIcon) {
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
		// subtextHtml membawa emote (shortcode + emote payload); tanpa itu
		// textContent biasa supaya teks tetap tidak bisa menyuntik HTML.
		if (alertData.subtextHtml) islandSubtext.innerHTML = alertData.subtextHtml;
		else islandSubtext.textContent = subtext;
		islandSubtext.classList.remove('hidden');
	} else {
		if (alertData.textHtml) islandText.innerHTML = alertData.textHtml;
		else islandText.textContent = text || title || '';
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
			dynamicIsland.classList.add('alert-active', MUSIC_CARD_CLASS);
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
			// Glow kartu Medium memakai warna artwork. Di-set di pill (bukan hanya
			// di fill) karena background gradient-nya ada di #dynamicIsland.
			if (isMusicMedium) {
				dynamicIsland.style.setProperty('--accent-color', color);
			}
			StartScrubberAnimation();
		} else {
			dynamicIsland.classList.remove('alert-active', MUSIC_CARD_CLASS);
			document.getElementById('musicBigExtra').classList.add('hidden');
			if (islandSubtext) {
				islandSubtext.textContent = '';
				islandSubtext.classList.add('hidden');
			}
		}
		islandText.innerHTML = RenderIslandText(text || title || '', true);
	} else {
		dynamicIsland.classList.add('alert-active');
		dynamicIsland.classList.remove(MUSIC_CARD_CLASS);
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
			// Kejar rotasi yang terlewat selama alert: ambient tampil seolah alert
			// tidak menginterupsi. Dilakukan SEBELUM render ambient mana pun di bawah.
			CatchUpRotation(true);
			// [UX] Simetris dengan saat mekar: easing TANPA overshoot selama menyusut keluar dari
			// music big, lalu lepas lagi.
			if (type === 'music' && enableDynamicStyleBig) {
				dynamicIsland.classList.add('morph-no-overshoot');
				setTimeout(() => dynamicIsland.classList.remove('morph-no-overshoot'), 600);
			}
			dynamicIsland.classList.remove('alert-active', 'alert-pop', MUSIC_CARD_CLASS);
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

			// [DIHAPUS] Dulu panel 'music' dilewati setelah alert songchange agar lagu
			// tidak tampil dua kali. Panel itu kini menampilkan WAKTU (Time & Now
			// Playing), bukan judul lagu -> tidak ada pengulangan, dan melewatinya
			// hanya membuat jam terlewat. Panel time lama juga tidak pernah di-skip.
			// Render ulang konten ambient tetap WAJIB (di mode Small tidak ada
			// needRevealAmbient, jadi tanpa ini teks alert tertinggal di pill).
			if (type === 'music') {
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
// Ikon gift untuk tombol Test: gambar Galaxy asli (webp, disimpan lokal).
// URL CDN TikTok bertanda tangan & kedaluwarsa, jadi tidak dipakai.
const testGiftIcon = '../resources/gifts/galaxy.webp';
// Badge contoh untuk tombol Test di dashboard (grade lv1 + Top Gifter No. 3),
// diambil dari payload TikTok asli supaya preview = tampilan live.
const testBadges = [
	{ url: 'https://p19-webcast.tiktokcdn.com/webcast-va/grade_badge_icon_lite_lv1_v1.png~tplv-obj.image', label: '1', color: '#99789EE7' },
	{ url: 'https://p19-webcast.tiktokcdn.com/webcast-sg/new_top_gifter_version_2.png~tplv-obj.image', label: 'No. 3', color: '#66FE2C55' }
];

window.testFollow = function () {
	const msg = urlParams.get("followMessage") || "followed!";
	TriggerAlert({
		type: 'follow',
		icon: typeof ALERT_ICONS !== 'undefined' ? ALERT_ICONS.follow : '',
		text: `${testUser} ${msg.replaceAll('{name}', testUser)}`,
		title: testUser,
		subtext: msg.replaceAll('{name}', testUser),
		avatar: testAvatar,
		badges: testBadges,
		showIcon: enableFollowIcon,
		event: 'follow',
		userId: 'test'
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
		avatar: testAvatar,
		badges: testBadges,
		showIcon: enableSubscribeIcon,
		event: 'subscribe',
		userId: 'test'
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
		avatar: testAvatar,
		badges: testBadges,
		showIcon: enableShareIcon,
		event: 'share',
		userId: 'test'
	});
};

// Simulasi Super Fan. testType 'superFan'/'superFanJoin'/'superFanBox' memilih
// variannya; tanpa argumen dipakai 'superFan' (jadi Super Fan).
window.testSuperFan = function (kind) {
	const which = kind || 'superFan';
	const isBox = which === 'superFanBox';
	const msg = isBox
		? (urlParams.get("superFanBoxMessage") || "sent a Super Fan Box x{count}!")
		: (which === 'superFanJoin'
			? (urlParams.get("superFanJoinMessage") || "Super Fan joined!")
			: (urlParams.get("superFanMessage") || "is now a Super Fan!"));
	const count = 1;
	TriggerAlert({
		type: which,
		icon: typeof ALERT_ICONS !== 'undefined' ? ALERT_ICONS.superFan : '',
		text: `${testUser} ${msg.replaceAll('{name}', testUser).replaceAll('{count}', count)}`,
		title: testUser,
		subtext: msg.replaceAll('{name}', testUser).replaceAll('{count}', count),
		avatar: testAvatar,
		badges: testBadges,
		showIcon: enableSuperFanIcon,
		event: which,
		userId: 'test'
	});
};

window.testGift = function () {
	const msg = urlParams.get("giftMessage") || "sent {gift} x{count}!";
	const action = msg.replaceAll('{name}', testUser).replaceAll('{gift}', 'Galaxy').replaceAll('{count}', '1');
	TriggerAlert({
		type: 'gift',
		icon: typeof testGiftIcon !== 'undefined' ? testGiftIcon : (typeof ALERT_ICONS !== 'undefined' ? ALERT_ICONS.gift : ''),
		text: `${testUser} ${action}`,
		title: testUser,
		subtext: action,
		avatar: testAvatar,
		badges: testBadges,
		showIcon: enableGiftIcon,
		event: 'gift',
		userId: 'test'
	});
};

// Test first chatter: chat pertama dari seorang user. Teks dipotong 30 char, sama
// seperti jalur live (case 'chat').
window.testFirstChatter = function () {
	const msg = urlParams.get("firstChatterMessage") || "Lorem ipsum dolor sit amet, laboris dolor do sunt.";
	// Jalur Test memakai pemotong yang sama dengan jalur live supaya keduanya
	// memperlakukan shortcode emote dengan aturan yang identik.
	const message = TruncateChatMessage(msg, []);
	TriggerAlert({
		type: 'firstChatter',
		icon: 'https://img.icons8.com/fluency-systems-filled/96/FFFFFF/chat.png',
		text: `${testUser}: ${message}`,
		title: testUser,
		subtext: message,
		avatar: testAvatar,
		badges: testBadges,
		showIcon: enableFirstChatterIcon,
		event: 'firstChatter',
		userId: 'test'
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
	} else if (testType === "superFan" || testType === "superfan" || testType === "super_fan") {
		window.testSuperFan('superFan');
	} else if (testType === "superFanJoin" || testType === "super_fan_join") {
		window.testSuperFan('superFanJoin');
	} else if (testType === "superFanBox" || testType === "super_fan_box") {
		window.testSuperFan('superFanBox');
	} else if (testType === "nowPlaying" || testType === "now_playing") {
		// Simulasi Now Playing memakai DATA UJI (jalur terpisah dari alert musik asli).
		if (typeof window.testNowPlaying === "function") window.testNowPlaying();
	} else if (testType === "all") {
		window.testFollow();
		window.testSubscribe();
		window.testSuperFan('superFan');
		window.testShare();
		window.testGift();
		window.testFirstChatter();
	}
};

window.testWidget = function() {
	const testType = urlParams.get("testAlertType") || "all";
	window.testWidgetSelect(testType);
};
// ══ Simulasi Now Playing (tombol "Simulate" di kartu Now Playing) ══
// JALUR TERPISAH dari alert musik asli: TIDAK memakai TriggerAlert/ProcessAlertQueue
// dan TIDAK menyentuh `nowPlayingData` sama sekali, sehingga simulasi tidak pernah
// mencampuri atau tertimpa data lagu asli. Fungsi ini hanya MENGGAMBAR kartu musik
// memakai DATA UJI PERSIS di bawah (payload bridge apa adanya), lalu memulihkan
// tampilan ambient saat selesai.
var NOW_PLAYING_TEST_PAYLOAD = {
	app_version: '1.0.0',
	color: '#fcd46c',
	current_session_id: 'com.github.th-ch.youtube-music',
	os: 'Windows 11',
	palette: ['#ecb320', '#847c74', '#952a10', '#473c36', '#fcd46c', '#c6ae9c'],
	sessions: [{
		media_properties: {
			AlbumArtist: '', AlbumTitle: '', AlbumTrackCount: 0,
			Artist: 'BIGBANG', Genres: [], Subtitle: '',
			Thumbnail: 'http://127.0.0.1:47800/artwork/comgithubth-chyoutube-music?v=1790583045145',
			Title: 'BiiiG', TrackNumber: 0
		},
		playback_info: { AutoRepeatMode: 0, IsShuffleActive: null, PlaybackRate: 1, PlaybackStatus: 4, PlaybackType: 1 },
		source_app_id: 'com.github.th-ch.youtube-music',
		timeline_properties: {
			EndTime: 164000, LastUpdatedTime: '2026-09-28 08:10:43.569408+00:00',
			MaxSeekTime: 164000, MinSeekTime: 0, Position: 11, StartTime: 0
		}
	}]
};

// Artwork uji: gambar BiiiG ASLI, diunduh dari bridge saat lagu itu diputar.
// Disimpan sebagai data URL karena /artwork/<app> hanya menyajikan art lagu yang
// SEDANG diputar (satu file per app, selalu ditimpa) - jadi URL di payload bisa
// menampilkan art lagu lain. Data URL membuat simulasi selalu tampil benar.
var NOW_PLAYING_TEST_ART = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAB4AHgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6b3UgoNJXAdA6ua8Y+OfDngyBX8RatBavICY4OXlceqouWI98Yql8VPGC+DPCs9+io1/JmK0RxlTIQTlv9kYJPTsMjNfC+saje6nq95e6lcyXd5cSu0s8x+aU9MnGCAARgDgDgDHFaQhzasiUrH1xbftEeCJb1oHXV4YVAIuXtQUI+isWHbqvpXpvhzxFpHiW1a60PUba+iU7HMbZZG9GXqp9iBX54wxq8/yLuTjuOM85/Mn6V6D8F31m08XavquhyyhdJsLi+ufLBZZ44wxEJA4YuxQDPQAkdKuVNW0JUmfYHi/xr4e8IxxNr+pw2ss3EUHLyyc4yqDJIzjnGB3IrgIv2hfCLTsr2Wtpb8kXP2ZHjYYznCuWxj29a+StU1q81rWpdW1W7e6v5yJZZJiSSx5wPRRwABgADgYqhJL97ylVdykHAxkf1pqkgc2foN4R8YeH/GFk1z4b1O2vkXHmKhKvHnpvQ4Zc89RUvivxTovhLT/tviHUYLGBsqm8kvIR2RRksfYA18F+EPEGpeH9attU0i5NvqEbAK4GAyk/Mrj+JTg5U/hgiuv+LNhq+q3WneN7+7kvtN1yFHtZeR9mIDM1rgZClCDjAw2CfvBjU+zVx8+h7rJ+0f4PF15UVhrk0GQPtCW8YQg4GcGQNgZHbPtXoHg3x/4Z8ZeYmgapDPcRjc9q4MUyjjJ2Ngkcj5hkc9a+BIF/f+Ui53fLg8YJ/l2rR0m+nsNegvNPmkgvIcMksGRIkgUcoB3zxg+6nqap00JTZ+iooauJ+EXjB/Gvg6C/uljTUYSYLtI87d46OB2DDBx2ORziu2NYNW0NBKKBRRYLiGkpRRSGfOH7V900WqeHonzs+zzuo65JKhjj/vn8+2TXzZO6s8qxM8q/MGJUKOCDkdfQZ/H619jftJeELjxH4Oi1DTbbz7/SXaTywuWeBhiQDHPGFfA6hCBnNfHv2X55342qp+bPHXGQe/5dK6abVjKS1DTwzTd93rjvjIyPy4r3r4AC78M/Eezs7q3aex8V6Y90jhCyxhJZSnPQrsXn3kQfXwazKLdfPx1GTjuRkZ9xkc/hX1P+z58U9IvtFs/C+r3KW2t2zNDbbx8t1GW+UKcYDDhSvfAIzk4J3sKO5gfHP4UaN4c+H2q6zpqrF9l1Jbi3jRceTBN5Ubwe6iTLrxxuIHUk/NgXdu6bl6Drkkev+e/evor9pH4p6brenf8ACJeG5BexNMHvrpM7Mo2ViQ/xHcASw4G0AEknHz2CywN1G7HHPIx/LkU4XtqErX0O80H4eajrHwrufFOm2FxfXi6olvHBAjSP5AU+ZIqJyx8xkHTgIe1fRFv4Cli/Zzl8Naqv+nrYzXirIQDDcF3nQEjP3WIBxwcHqDz53+zR8TtI8P6Rc+GfE92lgn2lp7K5m+WPDAbo2OMLggsCxwdxGeAD2nx9+LGk6T4e1Pw5ot2tzr12htZhCCVtEb5XLN0D4yAoOQSCRjrEuZuw1a1z5Ks2VX3I2GwNpOQRnoadJue6ldGD7cEdcYzgD+XNEIiZ2+U7VwCBxg44HTv/AJ9Kkb91NPuX7qHdkfdAxyO/vn2rUg+lP2TbqV31y352eTE5GCArAlcY/P8Al2r6JNeM/sweE73QfB0+qarG0N1qpRoo3J3LAoO0sD0LMzt9NueeK9mNc0/iNo7CiiiioHYKbXL/ABC8Raj4b0iC80rTH1KWSby3RVY7F2s247Qe4A/GvL1+OWott/4ktl83/Tdvw7V6OGyvE4qHtKSuvVHNWxtKjLlm7P5nvOK8j8efA3QfEc15eaVIdHv7kN5myMPCzN1cpwQevQgck4JrC1L473Vk7f8AEltJFXaApuGRmJx32npnPTsenWnw/HW6ZN/9j2ky88JdFSQD9D7VtHJcbe0Y6+q/zM3mGHtdv8GclB+zJq/n7X8S6csWfvi1dmx/u7gP1r2H4ZfCbw/4Cdrq08y/1dlKvf3WC6g9QgHCA85xye5Nec6l+0XfaftZ/CETxMSAy6qfyx5NQ6R+0pdalqFtZp4Qjj859u86mSFGMk/6nnjNcOIpVqDcKys1udVBxrtey1vojuviT8E9B8ZXsupWsj6Vq83Mk8Kb45z2MiZGT7ggnvmvLW/Zq8QLOqJrWlNBsK+e4k3Anv5e3HT/AG/TrXTS/FLxDaXT38s8MtuqhzZ+UuwgckAgb84yBye3Boj+K2uTXS6jb3tu1kxBFv5amIgnBGcbvbO7rXlrM6aV9e2x9A+G8Tzct43tff8A4H/A8zqfhp8EdD8G3sWpXsz6xq8eDHJMgSKBu7InJz7sTjtjNanxN+Evh/x6/wBqu/MsNXUbVvrYDewHQOp4cDtnkdiK4C2+K+vX179utbuFbXzGUWghVoxhsYLY3nHPORnsBVbVv2krjT9Tns28KQSNC5XcNUbBHBB/1PGQf5+1b0MUq83GO6OHG5ZVwVONSpZxl21M1v2bNWgul+z6xplxBxueQSRNkFcYUBvQ/wAVdz4K+AmiaNqn9o67N/a8q8xWxjCQIfl5YZJcgr1OBzyDVTwJ8bdX8YXjRWXg6KG1ix51y+pkomSOP9Ty2CTgenJAOa9BvfFcsO59sEUSjJLk/wA+P5Vz4zN6GElyVZe92WrOajhJ1VzRWh15FAFef+H/AIgTaz4cs9Ut7K1aW5tknW3+0cRsyg7GcKemcZ2/hW5pviKa7+wrcWkcE88cbSxrL5gidh8yhsDdg8ZwPwrJZthW3Hm1Ttazvcv6rV3tpudJRRRXonOFfIXjpF/4THXtuAq39wQAPR3yMV9d18j+Oo2/4THXv7v2+5P/AI+3/wBf/Jr6fhj+LP0PHzj+HE5LxF4D8XX8D69a6HdXWkyKSs8BWUqFJUjYpLjBDA8e/SuO8NSyrq8S2/KyZDejL3P4dv8A69fZHhQ6ynwRs/8AhFlD6uu77OPk5/0k7vv/AC/d3dfw5r5/1yJ7TxJqtvqUEMGueY0t5GgQbXYBicJxzkHj19aeFwrr42VRTUbTel/e0fRfgKvWVLDqLi3ePy2MHxCUXQrzf7Y6dc8f1rk9ChvX1CKXTYDLcW7eYoQdAOvHGeoH41r+J7XUZk37ke1j52oCCuBySO/b9a9S/ZV8N6X4gm8Ttqtt5zQR2oicOyOoYzbhkEHB2rx0+UccCseI6kp12+W1lbXr/wADU2ySMIRjzS0vfTdff1OU1XUtRvtMe3l8O3RlkQAqXGwHsQevBwRVcXd5/wAI99gTw1c7fK8vy94CY7nPX39ffvXtNna6RpyTx366cfs2slJHuTbLILRQ24sZcYTIGcYPXbip4ZfDMXgGKfULnS3EaKbiS2eLe0IuPmkTgy8xZcDJbHGSea+IhTTgrRSV77y3+8/R61Xlqazk20o7Q2fX4f8AgHielajf6fpcFvF4cuVeMcKGGwnucnmuMudO1K/8QxWdxA0epajMoRXBwSxKqT1wP5AH0r6LurS1vUtv9J0vfc6sIo009IGZbZjhHEiOd0ZUgjcuc9SeKn+IvhXSPD/xT+HK6bbeS0/9oGV2dnZykKlQSSeAScAccn1rSnVlh1WqqKuk2973Sb6t9jzs0jCdKjTdRvZJWSVtF0S+RveHNFtPDWhW2nWXy21qnzO2AWPVnY+p5Jr5i+InjC68Y61LLcTuulxuRa25OERRwGYd2I5J7Zx0FfS3j93h8C+I3t2IkXT5yGU4I+Q5Ir53+C1nbXvxb8MRXcAmh+1FyjjjKRuyj8CoNePwrQVR1cXV1nff8W/medmk3HlpR0Rc8FfDz4lq8Gr+GdDv7QtgpK8kdvvHfKSspZT7jB6jrX1P4d0zWVTSJtUsxBebIpLlEZWWKQgF1BBOQDkcE1rf8JU3/PkM/wDXQ/8AxNKPFTfe+xY9P3vX/wAdrTHZhlWOlGc52lHqk7+j02Chh8VQTSV0/Nf5nUGis7RtR/tK2aXy9m19uN27PAOe1FfQ0a0K8FUpu6Z584ShJxlui+1fJPjo/wDFYa4u75f7QuTgd8OxP9K+jviBdeJLXSIG8IW0dxetMFkDhTtj2tkgEgddv+FeB3ngTxrdXUtxcaLdyTzO8srlo8u7ZLE4bHftX1nD3s6LlVqTir6WbVzxc05qiUIRbt5aHunwgP8AxbvSPpL+fnPXyT8eHdfjJ4peL76TRsOORiGLB/z/AFr334cR+P8ARJ7bS7jTnXRF85szIhMZKOwAYNnBkx2P3j0FeP8AjKSJfF2q3nidbW21+TElymRlCI1xgZPOAOn9a56mX+0xc2qsbN3vfo2/xRrHEONCK5Hfa1uyKFoGbbvxu2gsDzz3Fej/ALISLFq3jqKJdsSvaqg/2Q9xivF9R8SRKjJp++WVjjdghVz7HkmvRf2a7rXrG38VP4btIb28kexEgkBYLHtust95edwUde/SuniPG0asYxpvm5d2te33meSYSpz2l7vN30/4Yf8AEeTenijd/euR+Ad6wG2/8IR8i4X+zeO+B5f61u+NSumahPZeLGSyu7tDNJHI4DMkhbLDbnAJDflWIuraCun/AGL7fb/Z/K8gL5n8G3GM/SvzW07Jcj+K+x+t81HmbVWPwcu63Nn4cfL/AMIv/vW3b/aSu0/ae1f+wvGHw71T+C2lu3k4z+7JgV8D/dJxXHeCtuo6hBZeE2jvbyyQSxxQurFVQgA8nnB2/mKj/aWvNcvbTwnL4nso7O9V75VSMYDRgW2GxubuWHXt0r0MBDnlUp1Iu0r9OjueBnyTp0qlOcXyJLRq99OnY9jnht9V0+WCXZNZ3cJRuhVkYYP5g188/CbRrzw/8ftB0u/jKTQXUig4OJF8qTa4PoRz/PpUvwu+KEvhqBdJ19ZrjSVYLBOgJe3z/AR/EnpjkdsjGPa9D1vwz4g1rT7vTbvTrzVLdybYgqbiIkcgKfmGRnIx9a8PB/WchqypVIOdOXVfg/Xujz6vs8fBSjK0l0PV/Emz+yJ2lx2xnsc1x9gFlvbZXUFfMUEdiCwrZ1Wx1K+uZ/vG3jc+WpIAI7YHr7mqun6TepewPLbOqq6sTkcYbmubNI18XjYzjSkorS9t7Pf/ACNcM4UqLTkr+p2n3aKDRX2x4o2lFIx20goAdmvhv48yP/wuHxUm5trTRr7D9zHzX3Jmvhn47ru+MniX5gF+0x8kkAHyY8c1rS3InseforM8W/J3YxjGcfSvpL9jsbbnxcE4/d2WeehzcV82Rjdt2ew5Hv6V9JfsdZW58Xd/3dn68c3HBrWp8LIhucv+1j83xRtv+wVbjj/rrNXjQH76JenU4xnPHHY/59K9m/auP/F1LXv/AMSqD0/56T14xHIvnr1LKpIyfb8P8+tENkKW57J+yd/yVS528L/ZU+B/21hrqf2xm/0nwc3X5Lz8DmDmuX/ZP/5KjdL/AA/2VP8An5kHP8q6f9sVd154OH+xeH9YKj7aKXwnzjnc/wAmOxycccf/AKq774DhF+Mnhb5mP7+UjPoYZPbjtXBP8m5Ux82OeG5wCf1zXefAIr/wuHwr13edJ+P7mXn+VaS2ZK3Puc0ppM0VyG4CiiigBppaGrnfiJd3Gn+AfEd5p8kkN5BYTSRSRjLI4Q4I9TmgDoWZURmfAVckk8AAdTXwh8X9Rtda+J3iHUtNmSWzmucRzZG1wiIpI9QSpwehH1qh4i8WeItbeePUta1W7gkUBree8keIgjj5N230PT3rCfc0K/35FbGVOeD2/Aj6A+2K6IQ5dTKUrleJW3rs+9nvjk5/z37V9Efsj6ja2mr65YXc6RXl7bwNbI+QZRG024A9z+8BwO30NfPNurb178jg/dIH51Yuo2heJfLQ9cDHU+pH15q5K6sSnY9Q/aa1my1L4qSf2bcidbKzhtpmjIKrIrO7DPsHXOO+e4NeSu38X+yccdB2qcBknXYpXbwByMYzjHp/nrUTR7fl2n7vBAx0x/SmlZWBu56x+y/qdlpXxRX+0J1t/ttnLaQl+FaQtGyrnoMhGx74HUgV0n7XesWF34k0HTbW5jmvLCGc3SA5EXmGPYre5CE49CpPB58FVOzcJIB2yGBI/OkYNvlbk7WOevJz6/n1qeX3uYfNpYZLtaZm6L7en0rsPg1qVro/xU8OajqDCGzjnIlc9I96MgYnsMuMn057VyDqyv2G3HpjpxQrKrqu07NwyDznj/8AX+feqZKP0iB3fMnKtyCOhFOFfAvh/wAZeJdEuootK1rU7e3j2ILdLtxCARxheVGe3H5V9r/De+uNT+H3hq/v5Gmu7nT4JppG6szICSfcmuaUOU2jK50WaKKKgsdtqjrWmwatpF5p11vFvdwvBJswGCsMHFFFAjyG7/Zy8L3E7P8A2xry9AFEkJCgADjMRPYd6j/4Zs8Lru/4nOv/ADDH37fp9PJooq+eXcnlQRfs2+FYplddY175SDhntyDjnGPJqzd/s9eGriSJ/wC1dbRo842Nb5z9fK+lFFHMx8qIX/Zw8MO+59a18t7vbkH6jyaiP7NPhTr/AGzr/p9+3/8AjVFFHPLuHKidf2cfC/3v7V149N37yD5gBgA/uuO/TFI/7N/hVppX/tfXg0jFiN9uRzk45hPqaKKOZ9xcqGyfs3+F33M2s6+zMxJJe36n/tjTI/2avCifc1jX/l6Zktz/AO0frRRS55dw5UWbf9nbwzDOsv8AbGuSbXVsO0GDtGAD+66Y4r1jw7pEGg+H9N0i0aR7ewt47aNpCC7KihQSQAM8dhRRQ5N7jskaGKKKKkZ//9k=';

// State simulasi. Terpisah total dari alertQueue/alertLocked musik asli.
var simNowPlaying = { active: false, raf: 0, timer: 0 };

// Wave icon (3 bar beranimasi) memakai warna aksen. Dibuat lokal supaya simulasi
// tidak membaca nowPlayingData (punya alert asli).
function SimWaveIcon(hex) {
	var hexStr = encodeURIComponent(hex || '#8A2BE2');
	return `data:image/svg+xml;utf8,%3Csvg%20fill%3D%22${hexStr}%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%222%22%20y%3D%229%22%20width%3D%225%22%20height%3D%226%22%20rx%3D%222%22%3E%3Canimate%20attributeName%3D%22height%22%20values%3D%226%3B16%3B6%22%20begin%3D%220s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3Canimate%20attributeName%3D%22y%22%20values%3D%229%3B4%3B9%22%20begin%3D%220s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3C%2Frect%3E%3Crect%20x%3D%229%22%20y%3D%223%22%20width%3D%225%22%20height%3D%2218%22%20rx%3D%222%22%3E%3Canimate%20attributeName%3D%22height%22%20values%3D%2218%3B8%3B18%22%20begin%3D%220.2s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3Canimate%20attributeName%3D%22y%22%20values%3D%223%3B8%3B3%22%20begin%3D%220.2s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3C%2Frect%3E%3Crect%20x%3D%2216%22%20y%3D%227%22%20width%3D%225%22%20height%3D%2210%22%20rx%3D%222%22%3E%3Canimate%20attributeName%3D%22height%22%20values%3D%2210%3B18%3B10%22%20begin%3D%220.4s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3Canimate%20attributeName%3D%22y%22%20values%3D%227%3B3%3B7%22%20begin%3D%220.4s%22%20dur%3D%221s%22%20repeatCount%3D%22indefinite%22%2F%3E%3C%2Frect%3E%3C%2Fsvg%3E`;
}

// Scrubber simulasi: berjalan dari Position data uji, TANPA drift LastUpdatedTime
// (payload statis, timestamp-nya bisa jauh di masa lalu). Hanya menulis DOM.
function StartSimScrubber(posMs, endMs) {
	var elCurr = document.getElementById('scrubberCurrent');
	var elTot = document.getElementById('scrubberTotal');
	var elFill = document.querySelector('.scrub-fill');
	var elThumb = document.querySelector('.scrub-thumb');
	if (elTot) elTot.textContent = formatTimeMs(endMs);
	var basePos = Math.max(0, posMs);
	var startedAt = performance.now();
	function tick() {
		if (!simNowPlaying.active) return;
		var cur = basePos + (performance.now() - startedAt);
		var pos = endMs > 0 ? Math.min(cur, endMs) : cur;
		if (elCurr) elCurr.textContent = formatTimeMs(pos);
		if (elFill && endMs > 0) {
			var pct = (pos / endMs) * 100;
			var visualPct = isMusicMedium ? pct : (25 + (pct * 0.75));
			var rounded = Math.round(visualPct * 100) / 100;
			elFill.style.width = rounded + '%';
			if (elThumb) elThumb.style.left = rounded + '%';
		}
		simNowPlaying.raf = requestAnimationFrame(tick);
	}
	tick();
}

// Akhiri simulasi: bersihkan kelas/kartu lalu pulihkan tampilan ambient.
function StopSimNowPlaying() {
	if (!simNowPlaying.active) return;
	simNowPlaying.active = false;
	if (simNowPlaying.raf) { cancelAnimationFrame(simNowPlaying.raf); simNowPlaying.raf = 0; }
	if (simNowPlaying.timer) { clearTimeout(simNowPlaying.timer); simNowPlaying.timer = 0; }

	dynamicIsland.classList.remove('alert-active', 'alert-pop', MUSIC_CARD_CLASS);
	var extra = document.getElementById('musicBigExtra');
	if (extra) extra.classList.add('hidden');
	if (islandSubtext) { islandSubtext.classList.add('hidden'); islandSubtext.textContent = ''; }
	if (islandIcon) islandIcon.classList.remove('rounded-icon');
	if (islandEventIcon) { islandEventIcon.classList.add('hidden'); islandEventIcon.src = ''; islandEventIcon.__gesekiRightSrc = ''; }

	// Lepas kunci tampilan; alert asli yang sempat mengantre dibiarkan tayang.
	isAlertActive = false;
	alertLocked = false;
	window.currentActiveAlertData = null;
	UpdateInfoText(true, true);
	RefreshMusicWaveIcon(true);
	StartCycleTimer();
	ProcessAlertQueue();
}

// Palet warna data uji (dari user). Aksen TIDAK statik: diambil lewat
// ResolveAccentColor() memakai opsi `accentPaletteRole` di settings, supaya
// simulasi mengikuti pilihan user (LightVibrant / Vibrant / DarkVibrant).
var NOW_PLAYING_TEST_PALETTE = {
	Vibrant: '#f7bc23',
	LightVibrant: '#edac81',
	DarkVibrant: '#c4340c',
	Muted: '#938e89',
	LightMuted: '#dacbaa',
	DarkMuted: '#4d4539'
};

// Tombol Simulate. Mengembalikan false bila ada alert asli yang sedang tayang
// (tidak menimpa) - pemanggil bisa menampilkan status.
window.testNowPlaying = function (force) {
	// Hanya saat pill bebas: jangan menabrak alert asli yang sedang/akan tayang.
	// Simulator memanggil dengan force=true supaya tombolnya selalu tampil.
	if (!force && (isAlertActive || alertLocked || alertQueue.length > 0)) return false;

	var data = NOW_PLAYING_TEST_PAYLOAD;
	var s = (data.sessions && data.sessions[0]) || null;
	if (!s) return false;
	var mp = s.media_properties || {};
	var tp = s.timeline_properties || {};

	var art = NOW_PLAYING_TEST_ART;
	var title = mp.Title || '';
	var artist = mp.Artist || '';
	var posMs = Number(tp.Position) || 0;
	var endMs = Number(tp.EndTime) || 0;
	if (endMs > 864000000) { posMs = Math.floor(posMs / 10000); endMs = Math.floor(endMs / 10000); }

	// Aksen mengikuti opsi `accentPaletteRole` (settings) memakai palet data uji.
	var accent = ResolveAccentColor(NOW_PLAYING_TEST_PALETTE);

	// Ambil alih pill untuk tes tampilan.
	simNowPlaying.active = true;
	isAlertActive = true;
	alertLocked = true;
	window.currentActiveAlertData = { type: 'music' };

	// Kiri: album art data uji (bulat, sama seperti kartu musik asli).
	if (islandAvatar) { islandAvatar.classList.add('hidden'); islandAvatar.src = ''; }
	if (islandIcon) {
		islandIcon.src = art;
		islandIcon.classList.remove('hidden');
		islandIcon.classList.add('rounded-icon');
	}
	SyncIconWrapHidden();

	// Kanan: wave icon warna aksen.
	if (islandEventIcon) {
		var wave = SimWaveIcon(accent);
		islandEventIcon.src = wave;
		islandEventIcon.__gesekiRightSrc = wave;
		islandEventIcon.classList.remove('hidden');
	}

	// Pop pill.
	dynamicIsland.classList.remove('alert-pop');
	void dynamicIsland.offsetWidth;

	if (enableDynamicStyleBig) {
		// Gaya Big/Medium: kartu - judul + artis 2 baris + scrubber.
		dynamicIsland.classList.add('alert-active', MUSIC_CARD_CLASS, 'alert-pop');
		var extraEl = document.getElementById('musicBigExtra');
		if (extraEl) extraEl.classList.remove('hidden');
		islandText.innerHTML = RenderIslandText(title, true);
		if (islandSubtext) { islandSubtext.textContent = artist; islandSubtext.classList.remove('hidden'); }
		dynamicIsland.style.setProperty('--accent-color', accent);
		var scrubFill = document.querySelector('.scrub-fill');
		if (scrubFill) { scrubFill.style.setProperty('--accent-color', accent); scrubFill.style.backgroundImage = 'none'; }
		var scrubThumb = document.querySelector('.scrub-thumb');
		if (scrubThumb) scrubThumb.style.backgroundColor = accent;
		StartSimScrubber(posMs, endMs);
	} else {
		// Gaya Small: pill SATU baris "judul • artis" - tanpa kartu, tanpa
		// scrubber, tanpa subtext. Sama seperti alert musik small di jalur asli.
		dynamicIsland.classList.add('alert-pop');
		var extraSm = document.getElementById('musicBigExtra');
		if (extraSm) extraSm.classList.add('hidden');
		if (islandSubtext) { islandSubtext.textContent = ''; islandSubtext.classList.add('hidden'); }
		var sep = (title && artist) ? ' • ' : '';
		islandText.innerHTML = RenderIslandText(title + sep + artist, true);
	}
	simNowPlaying.timer = setTimeout(StopSimNowPlaying, ComputeMusicAlertDuration({}));
	return true;
};


window.testAlert = TriggerAlert;

// ── Simulator (dashboard) ───────────────────────────────────────────────────
// Event tiruan dari halaman Simulator datang lewat kanal widget
// ({type:'callFunction', fn:'gesekiSimulate'}). Diteruskan ke jalur event ASLI
// supaya toggle di Settings tetap dihormati: event yang alert-nya dimatikan
// tidak akan tampil.
window.gesekiSimulate = function (event, data) {
	data = data || {};
	// Tanpa anti-spam: SETIAP klik diproses, termasuk spam klik pada event
	// yang sama. Filter duplikat 4 detik di TriggerAlert dilewati
	// (simAlertActive) supaya klik berulang pun selalu tampil, walau ada
	// alert lain sedang mengantre.
	simAlertActive = true;
	try {
		GesekiSimulateRun(event, data);
	} finally {
		simAlertActive = false;
	}
};

function GesekiSimulateRun(event, data) {
	if (event === 'nowPlaying') {
		// force=true: lewati penjagaan "pill sedang bebas" supaya tombol
		// Simulator selalu menampilkan kartu walau ada alert mengantre.
		if (typeof window.testNowPlaying === 'function') window.testNowPlaying(true);
		return;
	}
	// Superfan tidak ikut di payload chat: daftarkan dulu supaya peran
	// "Super Fan" pada tab Comment dikenali seperti di jalur live.
	if (data.__simSuperFan) {
		try { TrackSuperFan('superFan', data); } catch (e) { /* abaikan */ }
		delete data.__simSuperFan;
	}
	// Event Simulator: penjagaan "chatter baru" di First Chatter dilewati
	// supaya spam klik pada Comment tetap menampilkan kartu.
	simChatActive = event === 'chat';
	try {
		handleTikTokEvent(event, data, 'Simulator');
	} finally {
		simChatActive = false;
	}
}
window.ALERT_ICONS = ALERT_ICONS;

// Broadcaster receiver: test murni & live update dari jendela Pengaturan / tab lain.
// Skala & rotasi disimpan sebagai state modul supaya keduanya bisa
// diubah terpisah tanpa saling menghapus di transform.
let curWidgetScale = widgetScale;
let curWidgetRotation = widgetRotation;
function BuildBaseTransform() {
	let t = "translateX(-50%)";
	if (curWidgetScale !== 1.0) {
		t += ` scale(${curWidgetScale})`;
	}
	if (curWidgetRotation !== 0) {
		t += ` rotate(${curWidgetRotation}deg)`;
	}
	const va = (typeof verticalAlign !== 'undefined') ? verticalAlign : "top";
	if (va === "center") {
		t += " translateY(-50%)";
	}
	return t;
}
function ApplyBaseTransform() {
	const t = BuildBaseTransform();
	document.documentElement.style.setProperty('--base-transform', t);
	dynamicIsland.style.transform = t;
}
window.setWidgetScale = function(scale) {
	if (!dynamicIsland) return;
	const parsed = parseFloat(scale);
	curWidgetScale = isNaN(parsed)
		? 1.0
		: Math.min(MAX_WIDGET_SCALE, Math.max(MIN_WIDGET_SCALE, parsed));
	ApplyBaseTransform();
};
window.setWidgetRotation = function(deg) {
	if (!dynamicIsland) return;
	const parsed = parseFloat(deg);
	let r = isNaN(parsed) ? 0 : parsed % 360;
	if (r > 180) r -= 360;
	if (r <= -180) r += 360;
	curWidgetRotation = Math.round(r);
	ApplyBaseTransform();
};

if (window.BroadcastChannel) {
	const bc = new BroadcastChannel(CHANNEL_NAME);
	bc.onmessage = function(event) {
		if (!event.data) return;
		if (event.data.type === 'set_scale') {
			window.setWidgetScale(event.data.scale);
		} else if (event.data.type === 'set_rotation') {
			window.setWidgetRotation(event.data.rotation);
		} else if (event.data.type === 'reload') {
			// Save di dashboard / Controls Panel -> muat ulang source ini supaya
			// setting baru langsung berlaku. Dijalankan di background, tanpa status.
			location.reload();
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

// Status provider TikTok (dipakai panel viewer count).
const tikTokStatus = { connected: false, disconnected: false, error: false };

let bridgeWebsocket = null;

// Geseki Bridge: SATU WebSocket membawa event TikTok DAN Now Playing sekaligus.
// Menggantikan TikFinity (:21213), IndoFinity (:62024) dan polling HTTP SMTC
// Bridge (:5000). Bridge mengirim {"type":"tiktok","event":...,"data":...} dan
// {"type":"nowplaying","data":...} lewat socket yang sama.
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
	BRIDGE_WS_URL = `ws://${bridgeHost}:${await ResolveBridgePort(bridgePort)}/ws`;

	const reconnectDelay = 10000;
	let errorLogged = false;

	function connect() {
		try {
			bridgeWebsocket = new WebSocket(BRIDGE_WS_URL);
		} catch (err) {
			if (!errorLogged) {
				console.debug(`[Geseki][Bridge] Connection error:`, err);
				errorLogged = true;
			}
			setTimeout(connect, reconnectDelay);
			return null;
		}

		bridgeWebsocket.onopen = () => {
			console.debug(`[Geseki][Bridge] Connected to ${BRIDGE_WS_URL}`);
			errorLogged = false;
			tikTokStatus.connected = true;
			tikTokStatus.disconnected = false;
			tikTokStatus.error = false;
			UpdateViewerCount(); // provider terhubung -> angka penonton valid
		};

		bridgeWebsocket.onmessage = (response) => {
			let data;
			try {
				data = JSON.parse(response.data);
			} catch (e) {
				console.debug(`[Geseki][Bridge] Error parsing message:`, e);
				return;
			}
			if (!data || typeof data !== 'object') return;

			switch (data.type) {
				case 'tiktok':
					console.debug(`[Geseki][Bridge][TikTok] ${data.event}`, data);
					handleTikTokEvent(data.event, data.data, 'Geseki Bridge');
					break;
				case 'nowplaying':
					// Push, bukan poll: bridge mengirim saat berubah + heartbeat ~1s.
					ApplyNowPlayingPush(data.data);
					break;
				case 'status':
					// Sidecar TikTok berubah state -> panel viewer ikut menyesuaikan.
					if (data.tiktok && typeof data.tiktok.state === 'string') {
						const up = data.tiktok.state === 'connected';
						tikTokStatus.connected = up;
						tikTokStatus.disconnected = !up;
						tikTokStatus.error = data.tiktok.state === 'error';
						UpdateViewerCount();
					}
					break;
				default:
					// hello / pong / tipe masa depan: abaikan (protokol aditif).
					break;
			}
		};

		bridgeWebsocket.onclose = () => {
			setTimeout(connect, reconnectDelay);

			if (tikTokStatus.connected) {
				console.debug(`[Geseki][Bridge] Disconnected.`);
			}

			tikTokStatus.connected = false;
			tikTokStatus.disconnected = true;
			tikTokStatus.error = true;
			ResetNowPlayingOnDisconnect();
			UpdateViewerCount(); // provider putus -> panel kembali ke teks offline
		};

		bridgeWebsocket.onerror = (error) => {
			if (!errorLogged) {
				console.debug(`[Geseki][Bridge] Connection error:`, error);
				errorLogged = true;
			}

			if (bridgeWebsocket && bridgeWebsocket.readyState !== WebSocket.CLOSED) {
				bridgeWebsocket.close();
			}
		};

		return bridgeWebsocket;
	}

	return connect();
}

// Riwayat first chatter DIPERTAHANKAN lintas reload (localStorage). Hanya dibersihkan
// via tombol Reset (window.ResetFirstChatter) atau saat live dimulai dari aplikasi.
const FC_STORAGE_KEY = WIDGET_NS + 'first-chatters';

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

// Superfan juga tidak dibawa di payload chat: keanggotaannya diingat dari
// event superFan/superFanJoin/superFanBox, lalu dipakai oleh 'User Permissions'
// First Chatter. Disimpan lintas reload seperti riwayat first chatter, dan
// ikut dibersihkan oleh Reset.
const SF_STORAGE_KEY = WIDGET_NS + 'super-fans';
const superFanHolders = new Set();

function LoadSuperFans() {
	try {
		const raw = localStorage.getItem(SF_STORAGE_KEY);
		if (!raw) return;
		const arr = JSON.parse(raw);
		if (Array.isArray(arr)) arr.forEach(k => superFanHolders.add(String(k)));
	} catch (e) { /* abaikan: storage penuh / nonaktif */ }
}

function SaveSuperFans() {
	try {
		localStorage.setItem(SF_STORAGE_KEY, JSON.stringify([...superFanHolders]));
	} catch (e) { /* abaikan */ }
}

// Kunci identitas user, sama seperti live-qa: id dulu, nama sebagai cadangan.
function UserKey(data) {
	const id = data && data.userId;
	if (id === undefined || id === null || id === '') {
		return String((data && (data.uniqueId || data.nickname)) || '');
	}
	return String(id);
}

// Dicatat sebelum gerbang enable mana pun supaya filter peran tetap benar
// walau alert Super Fan-nya dimatikan.
function TrackSuperFan(event, data) {
	if (event !== 'superFan' && event !== 'superFanJoin' && event !== 'superFanBox') return;
	const key = UserKey(data);
	if (!key || superFanHolders.has(key)) return;
	superFanHolders.add(key);
	SaveSuperFans();
}

LoadSuperFans();

function ResetFirstChatter() {
	firstChatters.clear();
	try { localStorage.removeItem(FC_STORAGE_KEY); } catch (e) { /* abaikan */ }
	superFanHolders.clear();
	try { localStorage.removeItem(SF_STORAGE_KEY); } catch (e) { /* abaikan */ }
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
	// Catat superfan sebelum gerbang enable apa pun: 'User Permissions'
	// First Chatter membacanya dan harus tetap benar walau alert-nya mati.
	TrackSuperFan(event, tiktokData);
	// Master switch: alert TikTok dimatikan dari dashboard.
	if (!enableTikTokAlerts) return;

	const userName = SanitizeVisibleText(tiktokData.nickname || tiktokData.uniqueId || 'Someone');
	// Batas username: murni alphabet (A-Za-z0-9_) 15 karakter; kalau ada
	// emoji/huruf non-latin dipotong 10 dengan emoji dihitung terpisah.
	const displayUser = TruncateUsername(userName);
	const badges = GetUserBadges(tiktokData);
	const avatar = tiktokData.profilePictureUrl || tiktokData.profilePicture || tiktokData.avatarThumb || tiktokData.user?.profilePictureUrl || '';

	switch (event) {
		case 'chat': {
			if (!enableFirstChatter) return;
			// User Permissions: lewati bila pengirim tidak punya peran yang dipilih.
			// Ditaruh SEBELUM firstChatters.add() supaya orang yang belum memenuhi
			// syarat tidak ikut ditandai dan masih bisa disapa setelah syaratnya terpenuhi.
			if (!UserAllowedForFirstChatter(tiktokData)) return;
			const userId = tiktokData.userId;
			if (!userId) return;

			// Simulator boleh menampilkan berulang (kondisi redundan).
			if (simChatActive || !firstChatters.has(userId)) {
				firstChatters.add(userId);
				SaveFirstChatters();
				const rawMessage = tiktokData.comment || tiktokData.msg || tiktokData.text || '';
				// Potong pada kuota karakter TERLIHAT (emote = 1 slot), lalu render
				// emote dari hasil potongan itu supaya emote di dalam kuota utuh.
				const message = TruncateChatMessage(rawMessage, tiktokData.emotes, FIRST_CHATTER_EMOTE_MAX);
				const messageHtml = RenderChatMessageHtml(message, tiktokData.emotes);
				// Username dibatasi 20 karakter supaya marquee tidak berjalan terlalu jauh.
				const displayName = displayUser;

				TriggerAlert({
					icon: 'https://img.icons8.com/fluency-systems-filled/96/FFFFFF/chat.png',
					title: displayName,
					subtext: message,
					subtextHtml: messageHtml,
					text: `${displayName}: ${message}`,
					textHtml: `${EscapeBadgeText(displayName)}: ${messageHtml}`,
					avatar: avatar,
					badges: badges,
					showIcon: enableFirstChatterIcon,
					event: 'chat',
					userId: tiktokData.userId
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
				avatar: avatar,
				badges: badges,
				showIcon: enableGiftIcon,
				event: 'gift',
				userId: tiktokData.userId
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
				avatar: avatar,
				badges: badges,
				showIcon: enableSubscribeIcon,
				event: 'subscribe',
				userId: tiktokData.userId
			});
			break;
		}

		case 'superFan':
		case 'superFanJoin':
		case 'superFanBox': {
			// Super Fan family. `superFanBox` is the paid envelope and has its
			// own switch + message because it carries a diamond amount.
			const isBox = event === 'superFanBox';
			if (isBox ? !enableSuperFanBox : !enableSuperFan) return;
			const fanMsg = isBox
				? superFanBoxMessage
				: (event === 'superFanJoin' ? superFanJoinMessage : superFanMessage);
			const fanCount = isBox ? (tiktokData.diamondCount || 1) : 1;
			const fanAction = fanMsg.replaceAll('{name}', displayUser).replaceAll('{count}', fanCount);
			TriggerAlert({
				type: event,
				icon: ALERT_ICONS.superFan,
				text: `${displayUser} ${fanAction}`,
				title: displayUser,
				subtext: fanAction,
				avatar: avatar,
				badges: badges,
				showIcon: enableSuperFanIcon,
				event: event,
				userId: tiktokData.userId
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
				avatar: avatar,
				badges: badges,
				showIcon: enableFollowIcon,
				event: 'follow',
				userId: tiktokData.userId
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
				avatar: avatar,
				badges: badges,
				showIcon: enableShareIcon,
				event: 'share',
				userId: tiktokData.userId
			});
			break;
		}

		case 'like': {
			// Like event
			break;
		}
	}
}

// Connect the Geseki Bridge socket on ready
function initTikTokServices() {
	bridgeConnection();
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initTikTokServices);
} else {
	initTikTokServices();
}

console.log("Geseki dynamic-island-alert loaded");
document.body.style.backgroundColor = 'transparent';
