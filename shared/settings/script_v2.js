// Geseki settings-page-builder — halaman settings (Web Awesome).
// Memuat settings.json (?settingsJson=) lalu merender kartu section,
// lengkap dengan iframe pratinjau widget.
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
let settingsJson = urlParams.get("settingsJson");
let widgetURL = urlParams.get("widgetURL");

// Fallbacks if opened directly without query parameters:
if (!settingsJson) {
    settingsJson = '../../dynamic-island-alert/settings/settings.json';
}
if (!widgetURL) {
    widgetURL = '../../dynamic-island-alert/';
}
const showUnmuteIndicator = GetBooleanParam("showUnmuteIndicator", false);

// Mode DASHBOARD: halaman untuk dock OBS. Tanpa pratinjau iframe.
// Layar loading TETAP dipakai di kedua mode (tanpa kunci scroll dan tanpa
// jeda minimum di dashboard — begitu data siap, overlay langsung memudar).
const isDashboardMode = urlParams.get('dashboard') === '1';
if (isDashboardMode) {
    document.body.classList.add('dashboard-mode');
}

// ── Tahan tampilan sampai WebAwesome terdefinisi ─────────────
const WA_TAGS = [
    'wa-details', 'wa-input', 'wa-select', 'wa-option', 'wa-button',
    'wa-badge', 'wa-switch', 'wa-slider', 'wa-number-input',
    'wa-color-picker'
];

if (isDashboardMode) document.body.classList.add('wa-pending');

// Penanda settings.json selesai diproses — gerbang tampilan menunggu ini,
// bukan sekadar definisi elemen, supaya Load scene tidak memicu FOUC ulang.
let settingsReady = false;
const settingsReadyPromise = new Promise(resolve => {
    window.__markSettingsReady = () => {
        settingsReady = true;
        resolve();
    };
});

// Hanya tag yang BENAR-BENAR ada di dokumen yang ditunggu.
function WaitForWebAwesome(timeoutMs = 1200) {
    const present = WA_TAGS.filter(tag => document.getElementsByTagName(tag).length > 0);
    const definitions = present.map(tag => customElements.whenDefined(tag));
    const timeout = new Promise(resolve => setTimeout(resolve, timeoutMs));
    return Promise.race([Promise.all(definitions), timeout]);
}

// Panel tampil setelah WebAwesome terdefinisi DAN settings.json selesai.
Promise.all([WaitForWebAwesome(), settingsReadyPromise])
    .then(() => document.body.classList.remove('wa-pending'));

// Pengaman mutlak: jangan pernah biarkan panel terkunci selamanya
// bila salah satu promise di atas tak kunjung selesai.
setTimeout(() => document.body.classList.remove('wa-pending'), 8000);

// ── Namespace per-widget ─────────────────────────────────────────
// Semua kunci localStorage milik widget ini diawali 'geseki:<folder>:',
// tempat <folder> adalah folder widget (mis. 'dynamic-island-alert' atau
// 'live-qa'). Tanpa ini dua widget di origin yang sama berbagi kunci
// `geseki-scene-<scene>` dan `geseki:controls:*`, sehingga profil satu widget
// menimpa widget lain.
//
// keyPrefix = segmen terakhir widgetURL tanpa nama berkas: widgetURL
// ".../<widget-folder>/index.html" -> "<widget-folder>". Memakai segmen
// mentah akan menghasilkan "index.html" — kunci yang justru dibagi semua
// widget.
const keyPrefix = (() => {
    let segments = widgetURL.replace(/\/+$/, '').split('/').filter(Boolean);
    if (segments.length && /\.(html?|php|aspx?)$/i.test(segments[segments.length - 1])) {
        segments = segments.slice(0, -1);
    }
    return segments[segments.length - 1] || 'widget';
})();

const WIDGET_NS = 'geseki:' + keyPrefix + ':';

// Kanal pesan antar-halaman milik widget ini. Dashboard mengirim 'reload' /
// 'callFunction' ke sini, dan widget mendengarkannya. Dulu kanalnya dibagi
// semua widget, jadi dashboard satu widget ikut memuat ulang widget lain.
const CHANNEL_NAME = WIDGET_NS + 'channel';

// Profil settings per scene: `geseki:<folder>:scene-<nama scene>`.
const SCENE_SETTINGS_PREFIX = WIDGET_NS + 'scene-';

// Kunci LAMA tanpa namespace (versi sebelum namespace diperkenalkan). Hanya
// widget yang historis memakainya — dynamic-island-alert — yang membacanya
// sebagai cadangan, supaya widget baru tidak mencuri profil milik widget lama.
const LEGACY_SCENE_PREFIX = keyPrefix === 'dynamic-island-alert' ? 'geseki-scene-' : '';

const bc = window.BroadcastChannel ? new BroadcastChannel(CHANNEL_NAME) : null;

// Status hijau pada tombol aksi header, tepat saat tombol diklik.
// HANYA menyalakan kelas: ikon centang sudah ada di tombol sejak awal
// (tersembunyi lewat CSS), jadi lebar tombol tidak berubah sama sekali.
function FlashHeaderButtonOk(btn) {
    if (!btn || btn.dataset.flashing === '1') return;
    btn.dataset.flashing = '1';
    btn.classList.add('action-ok');
    setTimeout(() => {
        btn.classList.remove('action-ok');
        btn.dataset.flashing = '';
    }, 3000);
}

// Muat ulang SEMUA browser source widget di semua scene, tanpa menampilkan
// status apa pun. Setting dibaca widget sekali saat load, jadi tanpa ini source
// di scene lain tetap memakai setting lama sampai OBS di-restart.
function ReloadAllWidgetSources() {
    if (!bc) return;
    try { bc.postMessage({ type: 'reload' }); } catch (e) { /* abaikan */ }
}

// Page elements
const settingsPanel = document.getElementById('settingsPanel');
const previewContainer = document.getElementById('preview');

// Layar loading tampil minimal selama ini (ms) supaya tidak sekadar berkedip.
// Dashboard memakai 0 — overlay #loading menutupi panel, jadi menahannya
// lebih lama hanya menambah jeda yang terasa.
const MIN_LOADING_MS = isDashboardMode ? 0 : 1000;
const pageLoadStart = Date.now();

// Pratinjau pakai double-buffering: iframe baru dimuat tersembunyi dulu,
// baru diswap setelah DOM-nya siap — menghilangkan flash putih saat refresh.
let activeIframe = document.createElement('iframe');
activeIframe.id = 'widgetPreview';
if (!isDashboardMode) previewContainer.appendChild(activeIframe);

let pendingIframe = null;
let refreshDebounceTimer = null;

// Tipe yang diketik: debounce panjang agar iframe reload sekali setelah
// user berhenti mengetik. Kontrol diskrit tetap instan.
const REFRESH_DEBOUNCE_MS = {
    text: 800,
    font: 800,
    number: 800,
    slider: 250,   // drag = rentetan event, tapi nilainya berubah halus
};
const DEFAULT_REFRESH_DEBOUNCE_MS = 30;

// Panggil fungsi di dalam pratinjau. WAJIB lewat postMessage, bukan
// contentWindow[fn]?.(): referensi contentWindow basi setelah redirect
// internal widget, sehingga panggilan dilewati tanpa error. postMessage
// menembus redirect dan tetap sampai setelah buffer-swap. Fallback
// contentWindow dipertahankan untuk widget lama tanpa listener pesan.
function CallWidgetFunction(fnName, args = []) {
    if (!fnName) return;

    // 1) BroadcastChannel — satu-satunya jalur ke widget sungguhan (OBS/TTLS)
//    yang berjalan di konteks teratas, bukan iframe halaman ini.
    if (bc) {
        try {
            bc.postMessage({ type: 'callFunction', fn: fnName, args });
        } catch (e) { /* abaikan */ }
    }

    // 2) Pratinjau: postMessage ke iframe aktif + pending (redirect internal
//    membuat contentWindow basi).
    const payload = { type: 'callFunction', fn: fnName, args };
    [activeIframe, pendingIframe].forEach((frame) => {
        if (!frame || !frame.contentWindow) return;
        try { frame.contentWindow.postMessage(payload, '*'); } catch (e) {}
    });

    // 3) Fallback: widget lama tanpa listener pesan.
    try {
        if (typeof activeIframe?.contentWindow?.[fnName] === 'function') {
            activeIframe.contentWindow[fnName](...args);
        }
    } catch (e) { /* abaikan */ }
}

// Expose widgetPreview accessor so existing script functions (contentWindow calls) work smoothly
Object.defineProperty(window, 'widgetPreview', {
    get: () => activeIframe,
    configurable: true
});

const unmuteLabel = document.createElement('label');
unmuteLabel.id = 'unmute-label';
unmuteLabel.textContent = 'Click to unmute...';
unmuteLabel.style.display = 'none';
previewContainer.appendChild(unmuteLabel);
const widgetTitle = document.getElementById('widgetTitle');
// Tombol lama (Copy URL / Load Defaults / Load Settings) DIHAPUS.
// Widget kini dimasukkan ke OBS otomatis lewat tombol Save.
const loadDefaultsModal = document.getElementById('modalLoadDefaults');

// Global variables
let settingsData = null;
let settingsMap = new Map();

// Header: widget name. A `widgetName` query parameter wins (it can carry
// punctuation the folder name cannot, e.g. "Live Q&A"); otherwise the widget
// folder name is title-cased (kebab-case -> Title Case).
if (widgetTitle) {
    const explicitName = urlParams.get('widgetName');
    if (explicitName) {
        widgetTitle.textContent = explicitName;
    } else if (keyPrefix) {
        widgetTitle.textContent = keyPrefix
            .split(/[-_]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}

/* ?skin=queue — pakai gaya halaman Queue: latar rata, kartu rata bergaris
   tipis, dan baris aksi (Save / Load / Reset + status OBS) dirapikan jadi
   top bar seperti halaman Queue: judul di kiri, aksi di kanan.
   Opt-in: hanya dashboard yang meminta, widget lain tetap tema kaca. */
/* Status aksi Save / Load / Reset. Di skin=queue hasil aksi dilaporkan di
   elemen ini (di header), BUKAN di dalam tombol — supaya teks dan lebar
   tombol tidak berubah-ubah saat melaporkan hasil. Widget lain tetap
   memakai perilaku lama. */
/* Toast gaya Controls Panel: menumpuk di pojok kiri bawah, hilang sendiri.
   Wadahnya ditempel ke <body>, jadi posisinya tidak ikut alur header. */
function SetActionStatus(text, ok) {
    if (!text) return;

    let box = document.getElementById('skToasts');
    if (!box) {
        box = document.createElement('div');
        box.id = 'skToasts';
        box.className = 'sk-toasts';
        document.body.appendChild(box);
    }

    const t = document.createElement('div');
    // Gaya panel: border kiri emas untuk berhasil, merah untuk gagal.
    t.className = 'sk-toast' + (ok === false ? ' is-error' : '');
    t.textContent = text;
    box.appendChild(t);

    // Batasi tumpukan supaya tidak memenuhi layar saat pesan beruntun.
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3400);
}

const skinQueue = urlParams.get('skin') === 'queue';
if (skinQueue) {
    document.body.classList.add('skin-queue');
}

/* ?chrome=min — halaman ini dibuka di dalam dock yang SUDAH punya navbar
   sendiri, jadi header nama widget disembunyikan supaya tidak tampil dua
   kali. Diabaikan saat skin=queue: header itu justru dipakai ulang sebagai
   top bar aksi. */
if (urlParams.get('chrome') === 'min' && !skinQueue
    && widgetTitle && widgetTitle.parentElement) {
    widgetTitle.parentElement.style.display = 'none';
}

if (skinQueue) {
    const header = document.querySelector('#settings > header');
    const footerUrlBar = document.querySelector('#settings footer .url-bar');
    if (header && footerUrlBar) {
        // Kiri: ikon + nama widget + label "Settings" — seperti "Live Q&A Queue".
        const title = document.createElement('div');
        title.className = 'sk-title';
        title.innerHTML = '<i class="ri-settings-3-line" aria-hidden="true"></i>';
        header.insertBefore(title, header.firstChild);
        if (widgetTitle) title.appendChild(widgetTitle);
        const em = document.createElement('em');
        em.textContent = 'Settings';
        title.appendChild(em);

        // Kanan: pil status OBS + Save / Load / Reset. Tombolnya hanya
        // dipindah dari footer ke sini, jadi id dan pengikat JS tidak berubah.
        const actions = document.createElement('div');
        actions.className = 'sk-bar-actions';
        const pill = document.createElement('span');
        pill.id = 'statusObsNav';
        pill.className = 'sk-obs-pill';
        pill.title = 'Connection to OBS — click to open settings';
        pill.style.cursor = 'pointer';
        pill.innerHTML = '<i class="ri-plug-line" aria-hidden="true"></i><span>OBS</span>';
        pill.addEventListener('click', function () {
            window.__openSettingsPopup('OBS Connection');
        });
        actions.appendChild(pill);
        actions.appendChild(footerUrlBar);
        header.appendChild(actions);

        // Footer dikosongkan: isinya sudah pindah ke header.
        const footer = footerUrlBar.closest('footer');
        if (footer) footer.style.display = 'none';
    }
}

/* ── Popup pengaturan koneksi ─────────────────────────────────────
   Grup dengan `popup: true` di settings.json (OBS Connection, Connection)
   TIDAK dirender sebagai kartu di panel: kartunya dipindah ke dalam satu
   <wa-dialog>. Pil status di header membukanya. Id kontrol tidak berubah,
   jadi penyimpanan setting dan badge status tetap bekerja seperti biasa. */
let settingsPopupDialog = null;
let settingsPopupBody = null;
let settingsPopupTitle = null;
const settingsPopupSections = {};

function EnsureSettingsPopup() {
    if (settingsPopupDialog) return;

    settingsPopupDialog = document.createElement('wa-dialog');
    settingsPopupDialog.id = 'settingsPopup';
    settingsPopupDialog.className = 'modal centered sk-popup';
    settingsPopupDialog.setAttribute('without-header', '');

    // Head: judul + ikon tutup. Tombol "Close" di footer diganti ikon X di
    // atas supaya dialog terasa ringan, bukan formulir dengan tombol besar.
    const head = document.createElement('div');
    head.className = 'sk-popup-head';

    settingsPopupTitle = document.createElement('span');
    settingsPopupTitle.className = 'sk-popup-title';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sk-popup-close';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '<i class="ri-close-line" aria-hidden="true"></i>';
    closeBtn.addEventListener('click', function () {
        settingsPopupDialog.open = false;
    });

    head.appendChild(settingsPopupTitle);
    head.appendChild(closeBtn);

    settingsPopupBody = document.createElement('div');
    settingsPopupBody.className = 'sk-popup-body';

    settingsPopupDialog.appendChild(head);
    settingsPopupDialog.appendChild(settingsPopupBody);

    // Ditaruh DI DALAM #settings supaya aturan kartu `#settings wa-details…`
    // tetap berlaku; dialog tertutup tidak memakan ruang flex.
    const host = document.getElementById('settings') || document.body;
    host.appendChild(settingsPopupDialog);
}

/* Asal popup: 'queue' bila dipicu pil Bridge di halaman Queue. Dipakai
   untuk mengembalikan tab dashboard setelah popup ditutup. */
let settingsPopupSource = null;

/* Dialog ditutup (tombol X, ESC, atau klik latar) -> wa-dialog memancarkan
   'wa-hide'. Kalau popup dibuka dari Queue, beri tahu dashboard supaya tab
   kembali ke Queue; kalau dari pil OBS di header Settings, tab dibiarkan. */
function NotifyPopupClosed() {
    if (settingsPopupSource !== 'queue') return;
    settingsPopupSource = null;
    // Lewat BroadcastChannel yang sama dengan dashboard — dashboard memang
    // mendengarkan kanal ini, bukan event 'message' dari iframe.
    try { if (bc) bc.postMessage({ type: 'settings_popup_closed' }); } catch (e) {}
}

window.__openSettingsPopup = function (groupName, source) {
    if (!settingsPopupSections[groupName]) return false;
    EnsureSettingsPopup();
    settingsPopupSource = source || null;
    settingsPopupDialog.addEventListener('wa-hide', NotifyPopupClosed);
    // Hanya kartu yang diminta yang tampil.
    Object.keys(settingsPopupSections).forEach(function (name) {
        settingsPopupSections[name].style.display =
            (name === groupName) ? '' : 'none';
    });
    settingsPopupTitle.textContent = groupName;
    settingsPopupDialog.open = true;
    return true;
};

/* Queue page meminta popup lewat kanal yang sama (pil Bridge di header
   halaman itu ada di dokumen lain). */
if (bc) {
    bc.onmessage = function (ev) {
        const d = ev.data || {};
        if (d.type === 'open_settings_popup' && d.group) {
            window.__openSettingsPopup(d.group, d.from);
        }
    };
}

// Header logo auto-fallback for any manual replacement (jpg, png, logo.png, etc.)
const headerLogo = document.getElementById('headerLogo');
if (headerLogo) {
    const candidateLogos = [
        '../../resources/logo/sekisungkarak_logo.jpg',
        '../../resources/logo/sekisungkarak_logo.png',
        '../../resources/logo/logo.png',
        '../../resources/logo/logo.jpg',
        '../../resources/logo/sekisungkarak.png',
        '../../resources/logo/sekisungkarak.jpg'
    ];
    let candidateIndex = 0;
    headerLogo.addEventListener('error', () => {
        candidateIndex++;
        if (candidateIndex < candidateLogos.length) {
            headerLogo.src = candidateLogos[candidateIndex];
        } else {
            headerLogo.style.display = 'none';
        }
    });
}

if (showUnmuteIndicator)
    unmuteLabel.style.display = 'inline';


loadDefaultsModal.querySelector('.sk-popup-close').addEventListener('click', () => loadDefaultsModal.open = false);
loadDefaultsModal.querySelector('.button.save').addEventListener('click', () => {
    LoadDefaultSettings();
    loadDefaultsModal.open = false;
});

// Footer buttons
async function CopyToClipboard(text) {
    // 1. Modern clipboard API
    if (navigator.clipboard && window.isSecureContext !== false) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.warn('[Copy] navigator.clipboard blocked or failed, using fallback:', err);
        }
    }

    // 2. Reliable textarea + execCommand fallback (works in iframes and file:/// contexts)
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) return true;
    } catch (err) {
        console.error('[Copy] Fallback execCommand error:', err);
    }

    // 3. Fallback prompt if clipboard access is strictly restricted
    window.prompt('Copy your widget URL:', text);
    return true;
}


// ── Tombol Save / Reset (dashboard OBS) ───────────────────────────
const saveObsButton = document.getElementById('saveObsButton');
const resetObsButton = document.getElementById('resetObsButton');

function SetFooterButtonState(btn, text, ok) {
    if (!btn) return;

    // skin=queue: hasil aksi tampil di status tersendiri di header, jadi
    // tombol Save / Load / Reset tidak berubah teks maupun lebarnya.
    if (document.body.classList.contains('skin-queue')) {
        SetActionStatus(text, ok);
        return;
    }

    // Label tombol Load dinamis, jadi selalu baca ulang dari dataset.baseLabel
// — kalau disimpan sekali, teks basi akan dikembalikan setelah scene ganti.
    const original = btn.dataset.baseLabel || btn.textContent;

    // Tulis HANYA ke span teks, supaya struktur tombol tidak berubah.
    const textSpan = btn.querySelector('.btn-text');
    const target = textSpan || btn;

    const icon = ok === true ? '<i class="ri-check-line"></i>'
        : ok === false ? '<i class="ri-close-line"></i>' : '';

    target.innerHTML = `${icon} ${text}`;
    btn.classList.toggle('copied', ok === true);
    btn.classList.toggle('obs-error', ok === false);

    setTimeout(() => {
        target.textContent = btn.dataset.baseLabel || original;
        btn.classList.remove('copied', 'obs-error');
    }, 3000);
}

if (saveObsButton) {
    saveObsButton.addEventListener('click', async () => {
        try {
            // 1) Simpan settings SEBELUM sinkron OBS: GetObsConfig() membaca dari
//    settingsMap, jadi kalau disimpan sesudahnya perubahan baru terbaca
//    pada klik Save berikutnya.
            SaveSettingsToStorage();

            // 2) Bangun URL widget terbaru
            const url = BuildWidgetURL();

            // 3) Buat / update browser source di scene aktif
            const result = await ObsSyncBrowserSource(url);

            // 4) Simpan juga sebagai profil scene, supaya bisa dimuat
            //    lagi lewat tombol Load.
            if (result.sceneName) {
                SaveSettingsForScene(result.sceneName);
                // Tandai profil ini sebagai pilihan aktif.
                SetSelectedScene(result.sceneName);
            }

            // Setting sudah tersimpan & source OBS sudah diperbarui: suruh semua
            // source widget di semua scene memuat ulang dirinya (background).
            ReloadAllWidgetSources();

            SetFooterButtonState(
                saveObsButton,
                result.created ? `Saved — source created: ${result.name}`
                    : `Saved — ${result.name} updated`,
                true
            );
        } catch (err) {
            console.error('[OBS Save]', err);
            SetFooterButtonState(saveObsButton, 'Failed: ' + err.message, false);
        }
    });
}

const loadObsButton = document.getElementById('loadObsButton');
const loadSceneModal = document.getElementById('modalLoadScene');
const sceneDropdown = document.getElementById('sceneDropdown');
const sceneToggle = document.getElementById('sceneDropdownToggle');
const sceneMenu = document.getElementById('sceneDropdownMenu');
const sceneLabel = document.getElementById('sceneDropdownLabel');

// Nilai yang sedang dipilih. Disimpan terpisah karena dropdown-nya
// kustom (bukan <wa-select>), jadi tidak ada .value bawaan.
let selectedScene = '';

// Teks penjelas di bawah dropdown (dipakai RenderSceneMenu juga).
const sceneHintEl = document.getElementById('sceneHint');

function CloseSceneMenu() {
    if (sceneMenu) sceneMenu.hidden = true;
}

// Pilihan terakhir disimpan agar hover tombol Load tetap
// menampilkan "Current: …" setelah halaman di-reload.
// `selectedScene` sendiri hanya hidup di memori.
const LAST_SCENE_KEY = WIDGET_NS + 'last-scene';

// ── Auto-follow scene OBS (dashboard) ────────────────────────────
// Dashboard harus menampilkan setting milik scene OBS yang SEDANG aktif.
// Dipicu saat scene BERGANTI (bukan sekadar berbeda dari yang terakhir
// dimuat), supaya tombol Load tetap bisa dipakai melihat profil scene
// lain tanpa langsung ditimpa.
const SCENE_FOLLOW_OBS_KEY = WIDGET_NS + 'scene-follow-obs';
let sceneFollowBusy = false;

function ReadFollowObsScene() {
    try { return sessionStorage.getItem(SCENE_FOLLOW_OBS_KEY) || ''; }
    catch (e) { return ''; }
}

function WriteFollowObsScene(name) {
    try {
        if (name) sessionStorage.setItem(SCENE_FOLLOW_OBS_KEY, name);
        else sessionStorage.removeItem(SCENE_FOLLOW_OBS_KEY);
    } catch (e) { /* abaikan */ }
}

// Scene OBS yang terakhir terlihat. Disimpan di sessionStorage supaya
// tidak menerapkan profil dua kali untuk scene yang sama.
let obsSceneLast = ReadFollowObsScene();

function ReadLastScene() {
    try {
        const v = localStorage.getItem(LAST_SCENE_KEY) || '';
        if (!v) return '';
        // Hanya pakai bila profilnya masih ada — bisa saja sudah dihapus sesi lalu.
        return ReadSceneProfileRaw(v) ? v : '';
    } catch (e) {
        return '';
    }
}

function WriteLastScene(name) {
    try {
        if (name) localStorage.setItem(LAST_SCENE_KEY, name);
        else localStorage.removeItem(LAST_SCENE_KEY);
    } catch (e) { /* abaikan */ }
}

function SetSelectedScene(name) {
    selectedScene = name || '';
    WriteLastScene(selectedScene);
    if (sceneLabel) sceneLabel.textContent = selectedScene || 'Select scene...';
    // Tombol Load mengikuti pilihan, jadi perbarui labelnya juga.
    RefreshLoadButtonLabel();
}

// Hapus profil scene. Mengembalikan true bila berhasil.
// Kunci lama (tanpa namespace) ikut dihapus: kalau tidak, profil itu muncul
// kembali di daftar scene setelah dihapus.
function DeleteSceneSettings(scene) {
    try {
        localStorage.removeItem(SceneStorageKey(scene));
        const legacy = LegacySceneStorageKey(scene);
        if (legacy) localStorage.removeItem(legacy);
        return true;
    } catch (e) {
        return false;
    }
}

function RenderSceneMenu(scenes) {
    if (!sceneMenu) return;
    sceneMenu.innerHTML = '';

    // Settings terakhir yang dimuat ditaruh paling atas supaya langsung
    // kelihatan; sisanya menyusul urutan abjad. Baca localStorage langsung
    // (bukan ListSavedScenes) — fungsi itu dideklarasikan lebih bawah dan
    // memicu ReferenceError (TDZ) bila dipanggil dari sini.
    let last = '';
    try { last = localStorage.getItem(LAST_SCENE_KEY) || ''; } catch (e) { /* abaikan */ }

    const ordered = (() => {
        const copy = scenes.slice();
        if (!last) return copy;
        const idx = copy.findIndex(s => s.scene === last);
        if (idx > 0) return [copy[idx], ...copy.slice(0, idx), ...copy.slice(idx + 1)];
        return copy;
    })();

    ordered.forEach(({ scene }) => {
        const row = document.createElement('div');
        row.className = 'scene-option';
        if (last && scene === last) row.classList.add('scene-option-last');

        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'scene-option-name';
        nameBtn.textContent = scene;
        nameBtn.addEventListener('click', () => {
            SetSelectedScene(scene);
            CloseSceneMenu();
        });

        // Tombol silang: hapus profil scene ini.
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'scene-option-delete';
        delBtn.title = `Delete settings "${scene}"`;
        delBtn.innerHTML = '<i class="ri-close-line"></i>';
        delBtn.addEventListener('click', async (ev) => {
            // Hentikan propagasi supaya baris tidak ikut terpilih.
            ev.stopPropagation();

            // DUA LANGKAH, tanpa confirm() bawaan browser: klik
            // pertama mengaktifkan, klik kedua benar-benar menghapus.
            if (delBtn.dataset.armed !== '1') {
                delBtn.dataset.armed = '1';
                delBtn.classList.add('armed');
                delBtn.title = 'Click again to delete';
                setTimeout(() => {
                    if (!delBtn.isConnected) return;
                    delBtn.dataset.armed = '';
                    delBtn.classList.remove('armed');
                    delBtn.title = `Delete source & settings "${scene}"`;
                }, 3000);
                return;
            }

            // Hapus DUA-DUANYA: source di OBS + profil tersimpan.
            let removed = [];
            let obsError = null;
            try {
                removed = await ObsDeleteSourcesForScene(scene);
            } catch (e) {
                obsError = e;
            }
            const settingsRemoved = DeleteSceneSettings(scene);

            if (obsError && !settingsRemoved) {
                SetFooterButtonState(loadObsButton, 'Failed: ' + obsError.message, false);
                return;
            }

            // Kalau yang dihapus sedang dipilih, kosongkan pilihan.
            if (selectedScene === scene) SetSelectedScene('');
            const remaining = ListSavedScenes();
            RenderSceneMenu(remaining);
            if (sceneHintEl) {
                sceneHintEl.textContent = remaining.length
                    ? ''
                    : 'No saved settings yet. Click Save in a scene first.';
            }

            const msg = removed.length
                ? `Deleted: ${removed.length} source`
                : 'Settings deleted (source not found)';
            SetFooterButtonState(
                loadObsButton,
                msg,
                !obsError
            );
        });

        row.appendChild(nameBtn);
        row.appendChild(delBtn);
        sceneMenu.appendChild(row);
    });
}

// Label tombol TETAP "Load" (tanpa nama scene).
function RefreshLoadButtonLabel() {
    if (!loadObsButton) return;
    loadObsButton.dataset.baseLabel = 'Load';

    if (!loadObsButton.classList.contains('copied')
        && !loadObsButton.classList.contains('obs-error')) {
        const textSpan = loadObsButton.querySelector('.btn-text');
        if (textSpan) textSpan.textContent = 'Load';
    }
}

if (loadObsButton && loadSceneModal) {
    loadSceneModal.querySelector('.sk-popup-close')
        .addEventListener('click', () => loadSceneModal.open = false);

    loadSceneModal.querySelector('.button.save')
        .addEventListener('click', () => {
            if (!selectedScene) {
                SetFooterButtonState(loadObsButton, 'Select a scene first', false);
                return;
            }
            try {
                LoadSettingsForScene(selectedScene);
                loadSceneModal.open = false;
                SetFooterButtonState(loadObsButton, `Loaded: ${selectedScene}`, true);
                RefreshLoadButtonLabel();
            } catch (err) {
                SetFooterButtonState(loadObsButton, 'Failed: ' + err.message, false);
            }
        });

    // Buka/tutup menu dropdown.
    if (sceneToggle && sceneMenu) {
        sceneToggle.addEventListener('click', (ev) => {
            ev.stopPropagation();
            sceneMenu.hidden = !sceneMenu.hidden;
        });
        // Klik di mana pun di luar menutup menu.
        document.addEventListener('click', (ev) => {
            if (sceneDropdown && !sceneDropdown.contains(ev.target)) CloseSceneMenu();
        });
    }

    loadObsButton.addEventListener('click', async () => {
        // Isi dropdown dari profil tersimpan.
        const scenes = ListSavedScenes();
        RenderSceneMenu(scenes);
        CloseSceneMenu();

        // Pilihan default = settings terakhir yang dimuat (bila profilnya
        // masih ada). Hanya kalau belum pernah ada pilihan, fallback ke
        // scene OBS aktif lalu entri pertama.
        const last = ReadLastScene();
        const current = await ObsGetCurrentSceneName();
        SetSelectedScene(
            (last && scenes.some(s => s.scene === last))
                ? last
                : (current && scenes.some(s => s.scene === current))
                    ? current
                    : (scenes[0]?.scene || '')
        );

        if (sceneHintEl) {
            sceneHintEl.textContent = scenes.length
                ? ''
                : 'No saved settings yet. Click Save in a scene first.';
        }

        loadSceneModal.open = true;
    });

    // Pulihkan pilihan terakhir dari localStorage, supaya hover
    // langsung menampilkan "Current: …" tanpa harus buka popup dulu.
    SetSelectedScene(ReadLastScene());

    // Tidak ada lagi setInterval: label hanya berganti saat pengguna
    // memilih/memuat/menghapus, bukan karena scene OBS berganti.
}

// Pengaturan yang TIDAK boleh dihapus tombol Reset.
// Koneksi OBS adalah konfigurasi aplikasi, bukan tampilan widget —
// kalau ikut tereset, pengguna harus memasukkan ulang IP/password
// setiap kali reset, lalu Save gagal tanpa sebab yang jelas.
const RESET_PRESERVE_IDS = ['obsAddress', 'obsPort', 'obsPassword'];

function DoResetSettings() {
    // Simpan dulu nilai yang ingin dipertahankan...
    const preserved = {};
    RESET_PRESERVE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) preserved[id] = el.value;
        else if (settingsMap.has(id)) preserved[id] = settingsMap.get(id);
    });

    // ...lalu simpan kembali SETELAH localStorage dibersihkan oleh
    // LoadDefaultSettings(). Catatan: LoadDefaultSettings memuat ulang
    // halaman, jadi nilai disimpan ke localStorage secara langsung.
    try {
        localStorage.setItem(WIDGET_NS + 'preserve', JSON.stringify(preserved));
    } catch (e) { /* abaikan */ }

    LoadDefaultSettings();
}

/* Konfirmasi dua klik, sama seperti tombol hapus antrean di halaman Queue:
   klik pertama mengubah tombol jadi "Sure?", klik kedua (dalam 3 detik)
   menjalankan reset. Tidak memakai <wa-dialog> (berat untuk sekadar
   konfirmasi) dan tidak memakai confirm() bawaan browser yang bisa
   membekukan halaman di dock CEF OBS. */
function ArmConfirmTwice(btn, action) {
    const original = btn.innerHTML;
    let armed = false;
    let timer = null;

    btn.addEventListener('click', () => {
        if (!armed) {
            armed = true;
            btn.classList.add('is-armed');
            btn.innerHTML = '<i class="ri-alert-line" aria-hidden="true"></i><span>Sure?</span>';
            timer = setTimeout(() => {
                armed = false;
                btn.classList.remove('is-armed');
                btn.innerHTML = original;
            }, 3000);
            return;
        }
        clearTimeout(timer);
        armed = false;
        btn.classList.remove('is-armed');
        btn.innerHTML = original;
        action();
    });
}

if (resetObsButton) ArmConfirmTwice(resetObsButton, DoResetSettings);


/////////////////////////////
// LOAD FROM SETTINGS.JSON //
/////////////////////////////

function LoadJSON(settingsJson) {
    // Kembalikan promise supaya pemanggil bisa menunggu render selesai
    // (dibutuhkan LoadDefaultSettings sebelum me-reload halaman).
    return fetch(settingsJson)
        .then(response => response.json())
        .then(data => {
            settingsData = data;

            // Sembunyikan layar loading: fade-out (.hidden), lalu display:none setelah
// transisi selesai supaya tidak menghalangi klik.
            HideLoadingScreen();

            // Buka gerbang tampilan — settings.json sudah diproses.
            if (typeof window.__markSettingsReady === 'function') {
                window.__markSettingsReady();
            }

            // Clear the settings panel
            settingsPanel.innerHTML = '';
            
            // Clear category map so it regenerates properly on reload/reset
            window.__categoryMap = {};

            const groupedSettings = {};

            // Group settings by their 'group' property
            data.settings.forEach(setting => {
                if (!groupedSettings[setting.group]) {
                    groupedSettings[setting.group] = [];
                }
                groupedSettings[setting.group].push(setting);
            });

            let groupIndex = 0;
            const sectionIcons = ['ri-settings-4-fill', 'ri-notification-3-fill', 'ri-palette-fill', 'ri-links-fill', 'ri-slideshow-3-fill'];

            const groupIconMap = {
                'Streamer.bot Connection': '../../resources/icons/platforms/streamerbot-logo.svg',
                'Streamerbot Connection': '../../resources/icons/platforms/streamerbot-logo.svg',
                'TikTok Connection': 'ri-tiktok-fill',
                'General': 'ri-settings-4-fill',
                'Appearance': 'ri-palette-fill',
                'Alert Events': 'ri-notification-3-fill'
            };

            // Render one collapsible section card per group
            for (const groupName in groupedSettings) {
                // Grup yang SEMUA setting-nya `headerOnly` tidak dirender sebagai
                // kartu: setting-nya hanya muncul di header kategori (mis. master
                // switch "TikTok Alerts"). Tanpa ini muncul kartu duplikat.
                if (groupedSettings[groupName].every(s => s.headerOnly)) continue;

                const section = document.createElement('wa-details');
                section.classList.add('section');
                section.dataset.group = groupName;

                // Determine whether section is expanded (open) or collapsed by default
                let isOpen = false;
                if (data.groups && data.groups[groupName] && data.groups[groupName].open !== undefined) {
                    isOpen = Boolean(data.groups[groupName].open);
                } else if (data.expandedGroups && data.expandedGroups.includes(groupName)) {
                    isOpen = true;
                } else if (data.collapsedGroups && data.collapsedGroups.includes(groupName)) {
                    isOpen = false;
                } else {
                    const hasExplicitOpen = groupedSettings[groupName].some(s => s.groupOpen === true || s.groupExpanded === true);
                    const hasExplicitClosed = groupedSettings[groupName].some(s => s.groupOpen === false || s.groupCollapsed === true);
                    if (hasExplicitOpen) isOpen = true;
                    else if (hasExplicitClosed) isOpen = false;
                    else isOpen = (groupIndex === 0);
                }

                if (isOpen) section.setAttribute('open', '');

                const header = document.createElement('span');
                header.classList.add('header');
                header.setAttribute('slot', 'summary');

                const title = document.createElement('span');
                title.classList.add('title');
                const customIcon = data.groups?.[groupName]?.icon || groupIconMap[groupName] || sectionIcons[groupIndex % sectionIcons.length];

                // Ikon bisa berupa kelas Remix ("ri-…") ATAU berkas gambar
                // (".svg"/".png"). Kalau gambar, pakai <img> dengan bingkai
                // kaca yang sama (kelas .glass-icon) supaya seragam.
                const icon = IsImageIcon(customIcon)
                    ? BuildImageIcon(customIcon, groupName)
                    : BuildFontIcon(customIcon);

                title.appendChild(icon);
                title.appendChild(document.createTextNode(groupName));
                header.appendChild(title);

                // Badge status koneksi di summary section
                const badgeType = data.groups?.[groupName]?.badge;
                if (badgeType) {
                    const checkSpan = document.createElement('span');
                    checkSpan.classList.add('check');
                    const statusSpan = document.createElement('span');
                    statusSpan.classList.add('status');
                    statusSpan.id = `status-${badgeType}`;

                    const dangerBadge = document.createElement('wa-badge');
                    dangerBadge.setAttribute('variant', 'danger');
                    dangerBadge.setAttribute('pill', '');

                    const successBadge = document.createElement('wa-badge');
                    successBadge.setAttribute('variant', 'success');
                    successBadge.setAttribute('pill', '');

                    statusSpan.appendChild(dangerBadge);
                    statusSpan.appendChild(successBadge);
                    checkSpan.appendChild(statusSpan);
                    header.appendChild(checkSpan);
                }

                // Tombol aksi + switch on/off di summary header.
                //  - groups[].button  : satu tombol lama (Reset First Chatter),
                //    tetap tampil di semua tempat seperti sebelumnya, dan
                //    diletakkan PALING KIRI.
                //  - groups[].buttons : deret tombol "Simulate" — HANYA di
                //    dashboard (?dashboard=1), supaya halaman settings mandiri
                //    dan panel OBS tidak berubah.
                //  - groups[].enable  : id setting checkbox on/off alert. Di
                //    dashboard switch-nya DIPINDAH ke header (mengikuti panel
                //    kontrol), dan tombol Simulate disembunyikan saat alert mati.
                const groupMeta = data.groups?.[groupName] || {};
                const legacyButton = groupMeta.button || null;
                const simButtonsCfg = (isDashboardMode && Array.isArray(groupMeta.buttons))
                    ? groupMeta.buttons
                    : [];
                const enableId = groupMeta.enable;
                const enableSetting = (isDashboardMode && enableId)
                    ? data.settings.find(s => s.id === enableId) || null
                    : null;
                let enableControl = null;

                if (legacyButton || simButtonsCfg.length || enableSetting) {
                    const actions = document.createElement('span');
                    actions.classList.add('header-actions');
                    // Dorong ke kanan (setelah badge koneksi bila ada).
                    actions.style.marginLeft = badgeType ? '12px' : 'auto';
                    if (!badgeType) actions.style.marginRight = '-5px';

                    const mkBtn = (btnCfg) => {
                        const btn = document.createElement('wa-button');
                        btn.textContent = btnCfg.label;
                        btn.setAttribute('variant', 'default');
                        // Ukuran kecil agar pas di summary header.
                        btn.setAttribute('size', 'small');

                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            CallWidgetFunction(btnCfg.callFunction, btnCfg.args || []);
                        });
                        return btn;
                    };

                    // 1) Tombol lama (Reset First Chatter) — selalu tampil, paling kiri.
                    //    Diberi kelas sendiri supaya bisa diberi warna hover tersendiri.
                    if (legacyButton) {
                        const legacyEl = mkBtn(legacyButton);
                        legacyEl.classList.add('reset-chatter-btn');
                        legacyEl.dataset.label = legacyButton.label || 'Reset';
                        // Ikon centang selalu ada (disembunyikan CSS) supaya lebar
                        // tombol sama persis saat status hijau muncul.
                        // Label saja yang ikut alur (jadi selalu center),
                        // ikon centang ditaruh absolut supaya tidak menggeser
                        // label maupun mengubah lebar tombol saat muncul.
                        legacyEl.innerHTML = '<span class="btn-label">'
                            + legacyEl.dataset.label + '</span>'
                            + '<i class="ri-check-line"></i>';
                        // Status hijau muncul begitu tombol DIKLIK (bukan menunggu
                        // konfirmasi dari widget).
                        legacyEl.addEventListener('click', () => FlashHeaderButtonOk(legacyEl));
                        actions.appendChild(legacyEl);
                    }

                    // 2) Tombol Simulate (dashboard) — disembunyikan saat alert mati.
                    const simButtons = simButtonsCfg.map((btnCfg) => {
                        const btn = mkBtn(btnCfg);
                        actions.appendChild(btn);
                        return btn;
                    });

                    // 3) Switch on/off alert di kanan deret tombol.
                    if (enableSetting) {
                        const swWrap = document.createElement('span');
                        swWrap.classList.add('header-switch');
                        // BuildInput dipakai ulang supaya id + penyimpanan
                        // setting tetap identik dengan baris biasa.
                        enableControl = BuildInput(enableSetting);
                        swWrap.appendChild(enableControl);
                        actions.appendChild(swWrap);

                        // Alert yang dimatikan tidak bisa diuji: sembunyikan
                        // tombol Simulate selama switch-nya mati.
                        const syncActions = () => {
                            const on = !!enableControl.checked;
                            simButtons.forEach(b => { b.style.display = on ? '' : 'none'; });
                        };
                        enableControl.addEventListener('change', syncActions);
                        enableControl.addEventListener('wa-change', syncActions);
                        syncActions();
                    }

                    header.appendChild(actions);
                }

                section.appendChild(header);

                const categoryEnableId = data.categories?.[groupName]?.enable;

                groupedSettings[groupName].forEach(setting => {
                    // Setting yang dirender di header (switch kartu / master
                    // kategori) tidak diulang sebagai baris di body.
                    if (enableSetting && setting.id === enableId) return;
                    if (isDashboardMode && categoryEnableId && setting.id === categoryEnableId) return;

                    const configRow = document.createElement('div');
                    configRow.classList.add('config');
                    if (setting.full) {
                        configRow.classList.add('full');
                    }
                    configRow.id = `item-${setting.id}`;

                    const infoDiv = document.createElement('div');
                    infoDiv.classList.add('info');

                    if (setting.label) {
                        const label = document.createElement('div');
                        label.classList.add('title');
                        label.textContent = setting.label;
                        infoDiv.appendChild(label);
                    }

                    if (setting.description) {
                        const description = document.createElement('div');
                        description.classList.add('description');
                        description.innerHTML = `<small>${setting.description}</small>`;
                        infoDiv.appendChild(description);
                    }

                    configRow.appendChild(infoDiv);

                    // Masukkan kontrol (input/tombol) ke bagian sisi kanan
                    const elementDiv = document.createElement('div');
                    elementDiv.classList.add('element');
                    elementDiv.appendChild(BuildInput(setting));
                    configRow.appendChild(elementDiv);

                    section.appendChild(configRow);
                });

                // Grup `popup: true`: barisnya masuk ke dialog sebagai daftar
                // polos — TANPA kartu wa-details. Baris .config diambil dari
                // section sementara lalu section-nya dibuang, jadi id kontrol,
                // penyimpanan, dan showIf tetap identik dengan panel biasa.
                if (data.groups?.[groupName]?.popup === true) {
                    EnsureSettingsPopup();
                    const wrap = document.createElement('div');
                    wrap.className = 'sk-popup-group';
                    wrap.dataset.group = groupName;
                    Array.from(section.querySelectorAll('.config')).forEach(function (row) {
                        wrap.appendChild(row);
                    });
                    settingsPopupBody.appendChild(wrap);
                    settingsPopupSections[groupName] = wrap;
                    groupIndex++;
                    continue;
                }

                // Check category of this group
                const firstSetting = groupedSettings[groupName][0];
                const categoryName = firstSetting.category;

                if (categoryName) {
                    if (!window.__categoryMap) window.__categoryMap = {};

                    if (!window.__categoryMap[categoryName]) {
                        const catSection = document.createElement('wa-details');
                        catSection.classList.add('section', 'category-section');
                        
                        // Is category expanded?
                        let catIsOpen = false;
                        if (data.categories && data.categories[categoryName] && data.categories[categoryName].open !== undefined) {
                            catIsOpen = Boolean(data.categories[categoryName].open);
                        } else {
                            catIsOpen = true;
                        }
                        if (catIsOpen) catSection.setAttribute('open', '');

                        const catHeader = document.createElement('span');
                        catHeader.classList.add('header');
                        catHeader.setAttribute('slot', 'summary');

                        const catTitle = document.createElement('span');
                        catTitle.classList.add('title');
                        const catIcon = document.createElement('i');
                        catIcon.className = data.categories?.[categoryName]?.icon || 'ri-folder-3-fill';
                        catTitle.appendChild(catIcon);
                        catTitle.appendChild(document.createTextNode(categoryName));
                        catHeader.appendChild(catTitle);

                        // Master switch kategori (mis. "TikTok Alerts"): nyalakan
                        // /matikan SEMUA alert di kategori ini sekaligus.
                        const catEnableId = data.categories?.[categoryName]?.enable;
                        const catEnableSetting = (isDashboardMode && catEnableId)
                            ? data.settings.find(s => s.id === catEnableId) || null
                            : null;
                        if (catEnableSetting) {
                            const catActions = document.createElement('span');
                            catActions.classList.add('header-actions');
                            catActions.style.marginLeft = 'auto';
                            const catSwitchWrap = document.createElement('span');
                            catSwitchWrap.classList.add('header-switch');
                            catSwitchWrap.appendChild(BuildInput(catEnableSetting));
                            catActions.appendChild(catSwitchWrap);
                            catHeader.appendChild(catActions);
                        }

                        catSection.appendChild(catHeader);

                        // Cat: liquid glass via CSS (.category-section) — tanpa inline override
                        settingsPanel.appendChild(catSection);
                        window.__categoryMap[categoryName] = catSection;
                    }

                    // Nested group: padding horizontal disamakan dgn kartu luar
                    section.classList.add('nested-section');
                    window.__categoryMap[categoryName].appendChild(section);
                } else {
                    settingsPanel.appendChild(section);
                }

                groupIndex++;
            }

            ApplyShowIfVisibility();
            InitConnectionBadges();
            InitSceneAutoFollow();
            RefreshWidgetPreview();
            SaveSettingsToStorage();
        })
        .catch(error => {
            console.error('Error loading settings:', error);
            // Layar loading wajib ditutup juga saat GAGAL — kalau tidak,
            // overlay fixed z-index 1111 menutupi pesan error sehingga
            // tombol "Try Again" tidak bisa diklik.
            HideLoadingScreen();
            // Gagal pun wajib membuka gerbang, atau panel terkunci
            // sampai pengaman 8 detik. Pesan error harus tetap terlihat.
            if (typeof window.__markSettingsReady === 'function') {
                window.__markSettingsReady();
            }
            settingsPanel.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #f87171;">
                    <i class="ri-error-warning-line" style="font-size: 32px; margin-bottom: 12px; display: block;"></i>
                    <div style="font-weight: bold; margin-bottom: 8px;">Failed to Load Settings JSON</div>
                    <small style="color: #948e9f; display: block; margin-bottom: 16px;">${error.message || error}<br><br>Target: ${settingsJson}</small>
                    <button onclick="location.reload()" style="background: #26232f; color: #f5f3f7; border: 1px solid rgba(255,255,255,0.14); padding: 6px 16px; border-radius: 6px; cursor: pointer;">Try Again</button>
                </div>
            `;
        });
}

// ── Urutan tag Info Rotation ───────────────────────────────────────
// `value` <wa-select multiple> mengikuti urutan <wa-option> di light DOM,
// bukan urutan tag di layar, sehingga urutan pilihan user hilang saat
// reload. ReadTagOrder = baca urutan nyata; ApplyTagOrder = samakan DOM.
function ReadTagOrder(selectEl) {
    const sr = selectEl && selectEl.shadowRoot;
    if (!sr) return null;
    const vals = Array.from(sr.querySelectorAll('wa-tag'))
        .map(t => t.getAttribute('data-value'))
        .filter(Boolean);
    return vals.length ? vals : null;
}


// Ganti total <wa-select multiple>: komponen hanya membaca <wa-option> saat
// konstruksi, jadi mutasi elemen hidup (reorder, `selected`, `value`) tidak
// mengubah tag tampil. Bangun elemen baru dengan urutan & `selected` benar.
function RebuildTagSelect(oldSelect, allValues, valueLabels, selectedOrder) {
    if (!oldSelect) return null;
    const order = [...selectedOrder, ...allValues.filter(v => !selectedOrder.includes(v))];
    const next = document.createElement('wa-select');
    next.setAttribute('multiple', '');
    next.setAttribute('with-remove', '');
    next.setAttribute('with-clear', '');
    next.setAttribute('placeholder', oldSelect.getAttribute('placeholder') || 'No options');
    if (oldSelect.id) next.id = oldSelect.id;
    if (oldSelect.dataset.setting) next.dataset.setting = oldSelect.dataset.setting;
    next.maxOptionsVisible = allValues.length;
    order.forEach(v => {
        const opt = document.createElement('wa-option');
        opt.value = v;
        opt.textContent = (valueLabels && valueLabels[v]) || v;
        if (selectedOrder.includes(v)) opt.setAttribute('selected', '');
        next.appendChild(opt);
    });
    oldSelect.replaceWith(next);
    return next;
}

function ApplyTagOrder(selectEl, order) {
    if (!selectEl || !Array.isArray(order) || order.length === 0) return;
    const opts = Array.from(selectEl.querySelectorAll('wa-option'));
    // appendChild memindahkan node ke akhir; dilakukan berurutan sehingga
    // urutan akhir DOM persis sama dengan `order`.
    order.forEach(v => {
        const opt = opts.find(o => o.value === v);
        if (opt) selectEl.appendChild(opt);
    });
}

function BuildInput(setting) {
    const savedValue = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
    let inputElement;

    switch (setting.type) {
        case 'text':
            inputElement = document.createElement('wa-input');
            inputElement.value = savedValue ?? '';
            inputElement.setAttribute('autocomplete', 'off');
            break;

        case 'password':
            inputElement = document.createElement('wa-input');
            inputElement.type = 'password';
            inputElement.value = savedValue ?? '';
            inputElement.setAttribute('autocomplete', 'off');
            break;

        case 'slider':
                    inputElement = document.createElement('wa-slider');
                    inputElement.setAttribute('with-tooltip', '');
                    inputElement.value = savedValue ?? '';
                    if (setting.min !== undefined) inputElement.min = setting.min;
                    if (setting.max !== undefined) inputElement.max = setting.max;
                    if (setting.step !== undefined) inputElement.step = setting.step;
                    break;

        case 'number':
            inputElement = document.createElement('wa-number-input');
            inputElement.value = savedValue ?? '';
            if (setting.min !== undefined) inputElement.min = setting.min;
            if (setting.max !== undefined) inputElement.max = setting.max;
            if (setting.step !== undefined) inputElement.step = setting.step;
            break;

        case 'checkbox':
            inputElement = document.createElement('wa-switch');
            inputElement.setAttribute('size', 'l');
            inputElement.checked = Boolean(savedValue);
            break;

        case 'select':
            inputElement = document.createElement('wa-select');
            setting.options.forEach(option => {
                const optionElement = document.createElement('wa-option');
                optionElement.value = option.value;
                optionElement.textContent = option.label;
                inputElement.appendChild(optionElement);
            });
            inputElement.value = savedValue ?? '';
            break;

        case 'tags': {
            // Multi-select berupa <wa-tag> yang bisa dihapus
            inputElement = document.createElement('wa-select');
            inputElement.setAttribute('multiple', '');
            inputElement.setAttribute('with-remove', '');
            // Tombol bersihkan bawaan wa-select: hanya muncul bila ada pilihan.
            inputElement.setAttribute('with-clear', '');
            // Teks pengganti saat semua tag dihapus (Close / clear all).
            inputElement.setAttribute('placeholder', setting.placeholder || 'No options');
            // Tampilkan SEMUA tag (tanpa "+N") agar tiap tag bisa dihapus satu-satu.
// CATATAN: propertinya `maxOptionsVisible` — atributnya tidak ada.
            inputElement.maxOptionsVisible = setting.options.length;
            setting.options.forEach(option => {
                const optionElement = document.createElement('wa-option');
                optionElement.value = option.value;
                optionElement.textContent = option.label;
                inputElement.appendChild(optionElement);
            });
            const tagValue = Array.isArray(savedValue)
                ? savedValue
                : (Array.isArray(setting.defaultValue)
                    ? setting.defaultValue
                    : String(setting.defaultValue ?? '').split(',').map(v => v.trim()).filter(Boolean));

            // Susun dulu <wa-option> sesuai urutan tersimpan: wa-select
            // merender tag mengikuti urutan opsi di DOM.
            ApplyTagOrder(inputElement, tagValue);

            // Tandai lewat atribut `selected`, BUKAN `value`: `value` baru diterima
// setelah komponen upgrade, sedangkan atribut dibaca saat upgrade sehingga
// tag langsung muncul tanpa retry/rAF/reload.
            Array.from(inputElement.querySelectorAll('wa-option')).forEach(opt => {
                if (tagValue.includes(opt.value)) opt.setAttribute('selected', '');
                else opt.removeAttribute('selected');
            });
            // Sinkronkan juga properti komponen (aman, bukan sumber utama).
            inputElement.value = tagValue;

            // Tandai ada/tidaknya tag supaya CSS bisa menyusutkan form
            // saat kosong (lihat :not([data-has-tags]) di style.css).
            const syncHasTags = () => {
                const n = Array.isArray(inputElement.value) ? inputElement.value.length : 0;
                if (n) inputElement.setAttribute('data-has-tags', '');
                else inputElement.removeAttribute('data-has-tags');
            };
            inputElement.addEventListener('input', syncHasTags);
            inputElement.addEventListener('wa-change', syncHasTags);
            setTimeout(syncHasTags, 0);

            // wa-select baru menerima `value` setelah upgrade DAN terhubung ke DOM.
// Menyetel sebelum terpasang membuat tag tersimpan hilang, jadi ulangi
// beberapa tick (rAF terlalu cepat).
            const wrap = document.createElement('div');
            wrap.className = 'tags-row';
            wrap.appendChild(inputElement);


            inputElement._wrapWith = wrap;
            break;
        }

        case 'gift': {
            // Dropdown gift: ikon + nama + id + harga koin. Nilai yang disimpan
            // adalah ID gift (string) — satu-satunya yang stabil lintas bahasa.
            // Kosong = tidak ada gift tiket (penonton boleh langsung bertanya).
            inputElement = document.createElement('div');
            inputElement.className = 'gift-select';

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'gift-toggle';

            const toggleBody = document.createElement('span');
            toggleBody.className = 'gift-toggle-body';
            const toggleIcon = document.createElement('img');
            toggleIcon.className = 'gift-icon';
            toggleIcon.alt = '';
            const toggleText = document.createElement('span');
            toggleText.className = 'gift-toggle-text';
            toggleBody.appendChild(toggleIcon);
            toggleBody.appendChild(toggleText);
            toggle.appendChild(toggleBody);
            const caret = document.createElement('i');
            caret.className = 'ri-arrow-down-s-line';
            toggle.appendChild(caret);
            inputElement.appendChild(toggle);

            const menu = document.createElement('div');
            menu.className = 'gift-menu';
            menu.hidden = true;

            const search = document.createElement('input');
            search.type = 'search';
            search.className = 'gift-search';
            search.placeholder = 'Search gift...';
            menu.appendChild(search);

            const list = document.createElement('div');
            list.className = 'gift-list';
            menu.appendChild(list);

            const note = document.createElement('div');
            note.className = 'gift-note';
            menu.appendChild(note);
            inputElement.appendChild(menu);

            let gifts = null;   // cache daftar gift setelah dimuat
            let loading = false;
            let current = savedValue == null ? '' : String(savedValue);

            const NONE_LABEL = 'No gift - anyone can ask';

            const SetValue = (id, name, icon) => {
                current = id == null ? '' : String(id);
                // Handler umum membaca .value dari elemen ini.
                inputElement.value = current;
                if (current) {
                    toggleIcon.src = icon || '';
                    toggleIcon.style.display = icon ? '' : 'none';
                    toggleText.textContent = name ? (name + ' \u00b7 #' + current) : ('#' + current);
                    inputElement.classList.add('has-gift');
                } else {
                    toggleIcon.removeAttribute('src');
                    toggleIcon.style.display = 'none';
                    toggleText.textContent = NONE_LABEL;
                    inputElement.classList.remove('has-gift');
                }
            };

            const MakeRow = (icon, name, sub, selected, onPick) => {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'gift-row';
                if (selected) row.classList.add('is-selected');
                if (icon !== null) {
                    const img = document.createElement('img');
                    img.className = 'gift-icon';
                    img.alt = '';
                    img.loading = 'lazy';
                    if (icon) img.src = icon;
                    row.appendChild(img);
                }
                const meta = document.createElement('span');
                meta.className = 'gift-meta';
                const nm = document.createElement('span');
                nm.className = 'gift-name';
                nm.textContent = name;
                meta.appendChild(nm);
                if (sub) {
                    const sb = document.createElement('span');
                    sb.className = 'gift-sub';
                    sb.textContent = sub;
                    meta.appendChild(sb);
                }
                row.appendChild(meta);
                row.addEventListener('click', onPick);
                return row;
            };

            const RenderList = (filter) => {
                list.innerHTML = '';
                // Baris pertama selalu "tanpa gift" supaya pilihan kosong bisa
                // dikembalikan tanpa tombol tambahan.
                list.appendChild(MakeRow(null, NONE_LABEL, '', !current, () => {
                    SetValue('', '', '');
                    menu.hidden = true;
                    inputElement.dispatchEvent(new Event('input'));
                }));

                if (!gifts) {
                    note.textContent = loading ? 'Loading gifts...' : '';
                    return;
                }
                const f = (filter || '').trim().toLowerCase();
                const rows = gifts.filter(g => !f
                    || g.name.toLowerCase().includes(f)
                    || String(g.id).includes(f));
                rows.forEach(g => {
                    list.appendChild(MakeRow(g.icon, g.name,
                        '#' + g.id + ' \u00b7 ' + g.coins + ' coins',
                        String(g.id) === current, () => {
                            SetValue(g.id, g.name, g.icon);
                            menu.hidden = true;
                            inputElement.dispatchEvent(new Event('input'));
                        }));
                });
                note.textContent = rows.length + ' of ' + gifts.length + ' gifts';
            };

            const LoadGifts = () => {
                if (gifts || loading) return;
                loading = true;
                note.textContent = 'Loading gifts...';
                // gifts.json sejajar dengan settings.json (buang query string).
                const base = String(settingsJson || '').split('?')[0];
                const url = base.replace(/[^/]*$/, '') + 'gifts.json';
                fetch(url)
                    .then(r => r.json())
                    .then(doc => {
                        gifts = Array.isArray(doc) ? doc : (doc.gifts || []);
                        loading = false;
                        RenderList(search.value);
                        // Nama + ikon untuk nilai tersimpan baru diketahui sekarang.
                        if (current) {
                            const hit = gifts.find(g => String(g.id) === current);
                            if (hit) SetValue(hit.id, hit.name, hit.icon);
                        }
                    })
                    .catch(err => {
                        loading = false;
                        console.error('Failed to load gifts.json', err);
                        note.textContent = 'Could not load gifts.json.';
                    });
            };

            toggle.addEventListener('click', () => {
                menu.hidden = !menu.hidden;
                if (!menu.hidden) {
                    LoadGifts();
                    search.focus();
                }
            });
            // stopPropagation: kotak pencarian ada DI DALAM elemen setting, dan
            // handleInput dipasang pada elemen itu. Tanpa ini, tiap huruf yang
            // diketik ikut tersimpan + memicu refresh pratinjau.
            search.addEventListener('input', (e) => {
                e.stopPropagation();
                RenderList(search.value);
            });
            search.addEventListener('keydown', (e) => e.stopPropagation());
            // Klik di luar menutup menu (toggle sendiri ada di dalam, jadi aman).
            document.addEventListener('click', (e) => {
                if (!inputElement.contains(e.target)) menu.hidden = true;
            });

            // Ganti scene / impor menulis nilai langsung ke elemen (bukan lewat
            // klik menu), jadi tampilan toggle perlu disinkronkan terpisah.
            inputElement.__syncGift = (v) => {
                const next = v == null ? '' : String(v);
                if (next === current) return;
                const hit = gifts ? gifts.find(g => String(g.id) === next) : null;
                SetValue(next, hit ? hit.name : '', hit ? hit.icon : '');
                if (next && !hit) LoadGifts(); // nama menyusul setelah daftar dimuat
            };
            // Jalur impor menyiarkan Event('input') setelah menulis .value.
            inputElement.addEventListener('input', () => inputElement.__syncGift(inputElement.value));

            SetValue(current, '', '');
            if (current) setTimeout(LoadGifts, 0);
            break;
        }

        case 'color':
            inputElement = document.createElement('wa-color-picker');
            inputElement.value = savedValue ?? '#ffffff';
            break;
        case 'font':
            inputElement = document.createElement('wa-input');
            inputElement.value = savedValue ?? '';
            inputElement.placeholder = 'Type font name';
            inputElement.setAttribute('autocomplete', 'off');
            inputElement.setAttribute('clearable', '');
            inputElement.setAttribute('list', 'fonts');

            const wireFontDatalist = () => {
                inputElement.setAttribute('list', 'fonts');
                if (inputElement.shadowRoot) {
                    const innerInput = inputElement.shadowRoot.querySelector('input');
                    if (innerInput) innerInput.setAttribute('list', 'fonts');
                    const globalDatalist = document.getElementById('fonts');
                    if (globalDatalist && !inputElement.shadowRoot.getElementById('fonts')) {
                        inputElement.shadowRoot.appendChild(globalDatalist.cloneNode(true));
                    }
                }
            };

            inputElement.addEventListener('focus', async function loadOnce() {
                inputElement.removeEventListener('focus', loadOnce);
                await PopulateFontDatalist();
                wireFontDatalist();
            }, { once: true });

            setTimeout(wireFontDatalist, 50);
            break;

        case 'button':
            inputElement = document.createElement('wa-button');
            inputElement.textContent = setting.buttonText || setting.label;
            inputElement.setAttribute('variant', 'brand');
            inputElement.addEventListener('click', () => {
                CallWidgetFunction(setting.callFunction);
            });
            return inputElement;

        default:
            inputElement = document.createElement('wa-input');
            inputElement.value = savedValue ?? '';
    }

    // Common: remember the setting id, persist + refresh on change
    inputElement.id = setting.id;
    // ── Strategi refresh: jangan reload iframe per ketikan. ──
    // Nilai TETAP disimpan setiap event (localStorage) — yang ditunda hanya
    // reload iframe-nya. Reload hanya diperlukan agar widget membaca ulang
    // query param; menyimpan nilainya sendiri tidak butuh reload.
    const typedType = REFRESH_DEBOUNCE_MS[setting.type] !== undefined;
    // 'input' & 'wa-input' = SEDANG mengetik/menggeser.
    // 'change' & 'wa-change' = user sudah selesai (blur / pilih / lepas drag).
    // Import mengirim Event('input') synthetic → nilainya sudah final.
    const pendingEvents = new Set(['input', 'wa-input']);

    const handleInput = (event) => {
        // Import mengirim event 'input' synthetic bertanda `committed`
        // → nilainya sudah final, jangan dianggap sedang mengetik.
        const isTyping = !event?.committed && pendingEvents.has(event?.type);
        let value;
        if (setting.type === 'checkbox')
            value = inputElement.checked;
        else if (setting.type === 'number' || setting.type === 'slider')
            value = Number(inputElement.value);
        else if (setting.type === 'tags') {
            // Ambil urutan dari tag yang tampil, lalu sinkronkan urutan
            // <wa-option> supaya halaman berikutnya merender sama.
            value = ReadTagOrder(inputElement) ||
                (Array.isArray(inputElement.value) ? inputElement.value : []);
            ApplyTagOrder(inputElement, value);
        }
        else
            value = inputElement.value;

        // Custom override for Auto Test Dropdown: trigger instantly without reload
        if (setting.id === 'testAlertType') {
            if (value && value !== 'none') {
                // Cukup CallWidgetFunction: ia SUDAH menyiarkan lewat BroadcastChannel
                // (menjangkau browser source OBS) sekaligus postMessage ke iframe pratinjau.
                // Dulu ada bc.postMessage({type:'trigger_test'}) tambahan di sini; akibatnya
                // widget dipanggil DUA kali tiap pilihan -> alert test ikut dobel.
                CallWidgetFunction('testWidgetSelect', [value]);
            }
            return; // Skip save & refresh
        }

        // ── Validasi minimal 3 tag (Info Rotation) ──
// Simpan nilainya, tapi jangan refresh pratinjau sebelum syarat terpenuhi.
        if (setting.type === 'tags' && setting.minTags) {
            const n = Array.isArray(value) ? value.length : 0;
            const enough = n >= setting.minTags;
            inputElement.parentElement?.classList.toggle('tags-invalid', n > 0 && !enough);
            if (n > 0 && !enough) return; // jangan simpan & jangan refresh
        }

        settingsMap.set(setting.id, value);
        SaveSettingsToStorage();
        ApplyShowIfVisibility();

        // ── Pengecualian: Widget Scale (Zoom) ──
// Nilai tetap disimpan, tapi diterapkan langsung lewat JS: widget sudah
// punya window.setWidgetScale() dan listener 'set_scale'. Reload justru
// mengulang animasi masuk dan mengganggu saat drag.
        if (setting.id === 'widgetScale') {
            try {
                widgetPreview.contentWindow.setWidgetScale(value);
                if (bc) bc.postMessage({ type: 'set_scale', scale: value });
            } catch (e) {
                console.error("Widget scale apply failed", e);
            }
            return; // Skip refresh
        }

        // Sedang mengetik & tipe rawan ketikan → tunda reload iframe.
        // Selain itu (switch, select, blur, import) → refresh segera.
        if (typedType && isTyping)
            RefreshWidgetPreview(false, REFRESH_DEBOUNCE_MS[setting.type]);
        else
            RefreshWidgetPreview(false, true);
    };
    inputElement.addEventListener('input', handleInput);
    inputElement.addEventListener('wa-input', handleInput);
    inputElement.addEventListener('wa-change', handleInput);

    // Tipe 'tags' dibungkus bersama tombol shuffle (lihat case 'tags').
    return inputElement._wrapWith || inputElement;
}

function ApplyShowIfVisibility() {
    if (!settingsData) return;

    settingsData.settings.forEach(setting => {
        if (setting.showIf) {
            const itemElement = document.getElementById(`item-${setting.id}`);
            const parentInput = document.getElementById(setting.showIf);
            let shouldShow = true;

            // Walk up the chain of showIf dependencies
            let currentSetting = setting;
            while (currentSetting.showIf) {
                const parentElement = document.getElementById(currentSetting.showIf);
                if (!parentElement) {
                    shouldShow = false;
                    break;
                }
                // showIfValue: bandingkan dengan .value (untuk select).
                // Tanpa showIfValue: perilaku lama, checkbox memakai .checked.
                if (currentSetting.showIfValue !== undefined) {
                    if (String(parentElement.value) !== String(currentSetting.showIfValue)) {
                        shouldShow = false;
                        break;
                    }
                } else if (!parentElement.checked) {
                    shouldShow = false;
                    break;
                }
                currentSetting = settingsData.settings.find(s => s.id === currentSetting.showIf) || {};
            }

            if (itemElement)
                itemElement.style.display = shouldShow ? 'flex' : 'none';
        }
    });
}


////////////////////////////
// SETTINGS PERSISTENCE   //
////////////////////////////

function SaveSettingsToStorage() {
    const settingsArray = Array.from(settingsMap.entries());
    const settingsArrayString = JSON.stringify(settingsArray);
    localStorage.setItem(`${keyPrefix}-settings`, settingsArrayString);
}

function LoadSettingsFromStorage() {
    const settingsMapString = localStorage.getItem(`${keyPrefix}-settings`);
    if (settingsMapString) {
        const settingsMapArray = JSON.parse(settingsMapString);
        settingsMap = new Map(settingsMapArray);
    }

    // Pulihkan pengaturan yang dilindungi dari Reset (koneksi OBS).
    // Nilainya ditulis sesaat sebelum LoadDefaultSettings() membersihkan
    // localStorage dan memuat ulang halaman.
    try {
        const raw = localStorage.getItem(WIDGET_NS + 'preserve');
        if (raw) {
            const preserved = JSON.parse(raw);
            Object.entries(preserved).forEach(([id, value]) => {
                settingsMap.set(id, value);
            });
            localStorage.removeItem(WIDGET_NS + 'preserve');
            SaveSettingsToStorage();
        }
    } catch (e) { /* abaikan */ }
}

// ── Penyimpanan settings per scene ───────────────────────────────
// Satu scene = satu profil settings, disimpan di localStorage dengan kunci
// ber-namespace `geseki:<folder>:scene-<nama scene>`. Jadi "Live" dan "BRB"
// bisa punya tampilan widget berbeda, dan dua widget berbeda tidak saling
// menimpa.

function SceneStorageKey(sceneName) {
    return SCENE_SETTINGS_PREFIX + sceneName;
}

// Kunci profil scene versi LAMA (tanpa namespace). Hanya widget yang historis
// memakainya yang mengisi ini; widget baru mengabaikannya supaya tidak
// mencuri profil milik widget lama.
function LegacySceneStorageKey(sceneName) {
    return LEGACY_SCENE_PREFIX ? LEGACY_SCENE_PREFIX + sceneName : '';
}

// Baca profil scene mentah: kunci ber-namespace dulu, lalu kunci lama.
function ReadSceneProfileRaw(sceneName) {
    try {
        const raw = localStorage.getItem(SceneStorageKey(sceneName));
        if (raw) return raw;
        const legacy = LegacySceneStorageKey(sceneName);
        return legacy ? localStorage.getItem(legacy) : null;
    } catch (e) { return null; }
}

function SaveSettingsForScene(sceneName) {
    if (!sceneName) return;
    try {
        localStorage.setItem(SceneStorageKey(sceneName), JSON.stringify({
            savedAt: Date.now(),
            settings: Array.from(settingsMap.entries())
        }));
    } catch (e) { /* abaikan */ }
}

function ListSavedScenes() {
    const byScene = new Map();

    // Pass 1: kunci ber-namespace milik widget ini. Pass 2: kunci lama yang
    // belum sempat ditulis ulang (hanya untuk widget historis). Scene yang
    // sudah ada dari pass 1 tidak ditimpa.
    const collect = (prefix) => {
        if (!prefix) return;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(prefix)) continue;
            const scene = key.slice(prefix.length);
            if (byScene.has(scene)) continue;
            let savedAt = 0;
            try {
                savedAt = JSON.parse(localStorage.getItem(key))?.savedAt || 0;
            } catch (e) { /* abaikan */ }
            byScene.set(scene, savedAt);
        }
    };
    collect(SCENE_SETTINGS_PREFIX);
    collect(LEGACY_SCENE_PREFIX);

    return [...byScene.entries()]
        .map(([scene, savedAt]) => ({ scene, savedAt }))
        .sort((a, b) => b.savedAt - a.savedAt);
}

// Terapkan settingsMap ke SELURUH kontrol yang sudah dirender, DI TEMPAT.
// Dulu fungsi ini memanggil location.reload() — cara paling andal, tapi
// halaman berkedip setiap ganti scene. Sekarang nilainya ditulis langsung
// ke tiap kontrol (tanpa reload), jadi pergantian scene tak terasa.
function SetControlValueFromMap(setting) {
    const el = document.getElementById(setting.id);
    if (!el) return;
    const value = settingsMap.has(setting.id)
        ? settingsMap.get(setting.id)
        : setting.defaultValue;

    switch (setting.type) {
        case 'checkbox':
            el.checked = Boolean(value);
            break;
        case 'gift':
            // Dropdown kustom: .value saja tidak memperbarui ikon/teks.
            if (typeof el.__syncGift === 'function') el.__syncGift(value);
            else el.value = value ?? '';
            break;
        case 'number':
        case 'slider':
            el.value = value ?? '';
            break;
        case 'tags': {
            const list = Array.isArray(value)
                ? value
                : String(value ?? '').split(',').map(v => v.trim()).filter(Boolean);
            // Urutan <wa-option> menentukan urutan tag yang dirender.
            ApplyTagOrder(el, list);
            Array.from(el.querySelectorAll('wa-option')).forEach(opt => {
                if (list.includes(opt.value)) opt.setAttribute('selected', '');
                else opt.removeAttribute('selected');
            });
            el.value = list;
            const n = Array.isArray(el.value) ? el.value.length : 0;
            if (n) el.setAttribute('data-has-tags', '');
            else el.removeAttribute('data-has-tags');
            break;
        }
        default:
            el.value = value ?? '';
    }
}

function ApplySettingsMapToForm() {
    (settingsData?.settings || []).forEach(SetControlValueFromMap);
    ApplyShowIfVisibility();
    // Widget di pratinjau (non-dashboard) ikut diperbarui tanpa reload.
    RefreshWidgetPreview();
}

function LoadSettingsForScene(sceneName) {
    const raw = ReadSceneProfileRaw(sceneName);
    if (!raw) throw new Error('No saved settings for this scene');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.settings))
        throw new Error('Settings file is corrupted');

    settingsMap = new Map(parsed.settings);
    SaveSettingsToStorage();
    ApplySettingsMapToForm();
}

// ── Ikuti scene OBS yang sedang aktif (DASHBOARD saja) ───────────
// Halaman settings mandiri (Chrome) TIDAK ikut reload saat scene OBS
// berganti — hanya dashboard di dock OBS yang perlu selalu selaras
// dengan scene aktif.
const SCENE_FOLLOW_INTERVAL = 2000;

function SceneHasProfile(sceneName) {
    if (!sceneName) return false;
    try { return !!ReadSceneProfileRaw(sceneName); }
    catch (e) { return false; }
}

async function SceneFollowTick() {
    // Jangan sentuh apa pun sebelum settings.json selesai dirender:
    // kalau tidak, scene ditandai "sudah diterapkan" padahal belum ada
    // kontrol yang bisa ditulis.
    if (!settingsData) return;
    // Satu pengecekan saja pada satu waktu; kalau OBS lambat, jangan
    // menumpuk request tiap interval.
    if (sceneFollowBusy) return;
    sceneFollowBusy = true;
    try {
        const scene = await ObsGetCurrentSceneName();
        if (!scene || scene === obsSceneLast) return;
        // Scene OBS BERGANTI: catat lebih dulu (bertahan melewati reload)
        // supaya pergantian yang sama tidak diproses dua kali.
        obsSceneLast = scene;
        WriteFollowObsScene(scene);
        // Scene ini belum pernah di-Save: tidak ada setting untuk diikuti,
        // jadi biarkan form apa adanya (jangan reset diam-diam).
        if (!SceneHasProfile(scene)) return;
        SetSelectedScene(scene);
        LoadSettingsForScene(scene); // terapkan profil scene ini DI TEMPAT
    } catch (e) { /* OBS belum terhubung / profil rusak — abaikan */ }
    finally { sceneFollowBusy = false; }
}

function InitSceneAutoFollow() {
    if (!isDashboardMode) return;
    SceneFollowTick();
    setInterval(SceneFollowTick, SCENE_FOLLOW_INTERVAL);
}

function LoadDefaultSettings() {
    localStorage.removeItem(`${keyPrefix}-settings`);
    settingsMap = new Map();
    // Reload SETELAH render selesai. Dulu reload berbarengan dengan LoadJSON()
// yang async, sehingga fetch terpotong dan form tag kosong sampai F5 manual.
    try { sessionStorage.removeItem(WIDGET_NS + 'reload-once'); } catch (e) {}
    const done = LoadJSON(settingsJson);
    const reload = () => location.reload();
    if (done && typeof done.then === 'function') {
        done.then(() => setTimeout(reload, 0)).catch(reload);
    } else {
        setTimeout(reload, 0);
    }
}


///////////////////////////
// URL BUILDER + PREVIEW //
///////////////////////////

// ── Pembuat ikon header kartu ───────────────────────────────────────
// Ikon judul section selama ini SELALU <i> berisi kelas Remix Icon.
// Beberapa grup (mis. Streamer.bot) lebih tepat memakai logo resminya,
// jadi ditambahkan dukungan berkas gambar. Keduanya tetap memakai
// bingkai kaca yang sama lewat kelas `glass-icon` di style.css.

// ── Layar loading layar-penuh (#loading) ──────────────────────────
// Fade-out via kelas .hidden, lalu display:none setelah transisi
// selesai. Kalau elemen #loading tidak ada, fungsi ini diam saja —
// aman kalau markupnya kelak dihapus.

// Kunci scroll halaman SELAMA loading berlangsung.
// Mode dashboard tidak punya layar loading, jadi jangan pernah kunci.
if (!isDashboardMode) document.body.style.overflow = 'hidden';

function HideLoadingScreen() {
    const loadingScreen = document.getElementById('loading');

    const finish = () => {
        if (loadingScreen) loadingScreen.style.display = 'none';
        // Lepaskan kunci scroll SETELAH layar loading tertutup penuh
        document.body.style.overflow = '';
    };

    if (!loadingScreen) {
        finish();
        return;
    }
    if (loadingScreen.dataset.dismissed === 'true') return; // idempotent
    loadingScreen.dataset.dismissed = 'true';

    const elapsed = Date.now() - pageLoadStart;
    const wait = Math.max(0, MIN_LOADING_MS - elapsed);

    setTimeout(() => {
        // Pengaman utama: apa pun yang terjadi, overlay PASTI hilang.
        // `transitionend` bisa terlewat (transisi dibatalkan, tab di
        // background, reduced-motion) dan dulu itu membuat layar loading
        // nyangkut menutupi panel. Karena itu display:none dipasang lewat
        // timer, bukan lewat event.
        setTimeout(finish, 400);

        loadingScreen.classList.add('hidden');
    }, wait);
}

function IsImageIcon(value) {
    return typeof value === 'string' && /\.(svg|png|jpe?g|webp|avif)(\?.*)?$/i.test(value.trim());
}

function BuildFontIcon(className) {
    const i = document.createElement('i');
    i.className = className;
    return i;
}

function BuildImageIcon(src, label) {
    const img = document.createElement('img');
    img.className = 'glass-icon';
    img.src = src;
    img.alt = (label || 'icon') + ' icon';
    img.draggable = false;
    // Kalau berkas gagal dimuat, ganti ke ikon cadangan (bukan kotak rusak).
    img.addEventListener('error', () => {
        img.replaceWith(BuildFontIcon('ri-settings-4-fill'));
    }, { once: true });
    return img;
}

function BuildWidgetURL(options = {}) {
    // `previewOnly` hanya untuk URL pratinjau; `dragPreview` tidak pernah ikut
// ke URL yang dipakai browser source OBS.
    const previewOnly = options.previewOnly === true;

    const settings = {};

    settingsData.settings.forEach(setting => {
        if (setting.type === 'button') return; // Skip buttons

        const inputElement = document.getElementById(setting.id);
        if (!inputElement) return;

        if (setting.type === 'checkbox')
            settings[setting.id] = inputElement.checked;
        else
            settings[setting.id] = inputElement.value;
    });

    // Penanda khusus PRATINJAU — bukan pengaturan widget. Ditambahkan di sini
// (bukan settings.json) supaya tidak tampil sebagai opsi, tidak tersimpan,
// dan tidak pernah ada di URL OBS.
    if (previewOnly) settings.dragPreview = '1';

    const paramString = Object.entries(settings)
        .map(([key, value]) => {
            // Nilai array (tipe 'tags' / multi-select) digabung jadi satu
            // string berpemisah koma. Widget mem-parse-nya lagi saat startup.
            const flat = Array.isArray(value) ? value.join(',') : value;
            return `${encodeURIComponent(key)}=${encodeURIComponent(flat)}`;
        })
        .join('&');

    let cleanWidgetURL = widgetURL || '../../dynamic-island-alert/';

    // Convert relative URL to full absolute URL based on window location
    try {
        cleanWidgetURL = new URL(cleanWidgetURL, window.location.href).href;
    } catch (e) {}

    // Ensure it explicitly points to index.html for OBS Studio CEF compatibility
    if (cleanWidgetURL.endsWith('/')) {
        cleanWidgetURL += 'index.html';
    } else if (!cleanWidgetURL.endsWith('index.html')) {
        cleanWidgetURL += '/index.html';
    }

    return cleanWidgetURL + (paramString ? "?" + paramString : "");
}

function RefreshWidgetPreview(immediate = false, waitMs = null) {
    // Mode dashboard: tidak ada preview yang perlu dimuat ulang.
    if (isDashboardMode) return;
    const executeRefresh = () => {
        // previewOnly → URL ini hanya untuk iframe pratinjau, jadi boleh
        // menyertakan dragPreview.
        const url = BuildWidgetURL({ previewOnly: true });

        // If this is the initial load (activeIframe has no src yet), load directly
        if (!activeIframe.src || activeIframe.src === 'about:blank') {
            activeIframe.src = url;
            return;
        }

        // Clean up any earlier pending iframe that didn't finish loading
        if (pendingIframe) {
            try { previewContainer.removeChild(pendingIframe); } catch (e) {}
            pendingIframe = null;
        }

        // Iframe kedua dibuat tanpa id 'widgetPreview', jadi selector `#preview
// iframe` tetap melingkupinya. Saat diswap id dipindah — geometri harus
// identik agar tidak ada lompatan posisi.
        const next = document.createElement('iframe');
        next.style.opacity = '0';
        next.style.pointerEvents = 'none';
        next.style.visibility = 'hidden';
        next.src = url;
        pendingIframe = next;
        previewContainer.appendChild(next);

        let swapped = false;
        const doSwap = () => {
            if (swapped || pendingIframe !== next) return;
            swapped = true;

            const old = activeIframe;

            // ── Swap ATOMIK: iframe lama & baru tidak boleh tampak bersamaan. ──
// Keduanya position:fixed di titik sama dengan box-shadow 30px; kalau
// overlap, bayangannya menumpuk lalu kembali normal ("denyut"). Maka
// transisi dimatikan dan lama disembunyikan pada frame yang sama.
            next.style.transition = 'none';
            old.style.transition = 'none';

            next.id = 'widgetPreview';
            next.style.visibility = 'visible';
            next.style.pointerEvents = 'auto';

            activeIframe = next;
            pendingIframe = null;

            // Tunggu 2 frame: iframe baru sudah benar-benar menggambar
            // isinya (rAF 1 = susun frame, rAF 2 = frame dipresentasikan).
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Lama disembunyikan & baru ditampilkan di FRAME YANG
                    // SAMA → tidak pernah ada tumpang-tindih bayangan.
                    try {
                        old.style.visibility = 'hidden';
                        old.style.opacity = '0';
                    } catch (e) {}
                    next.style.opacity = '1';

                    // Lepas iframe lama setelah frame ini benar-benar tampil.
                    requestAnimationFrame(() => {
                        try {
                            if (old && old.parentNode) old.parentNode.removeChild(old);
                        } catch (e) {}
                    });
                });
            });
        };

        next.addEventListener('load', doSwap, { once: true });

        // Safety fallback timeout in case load event fails or stalls
        setTimeout(() => {
            if (!swapped && pendingIframe === next) doSwap();
        }, 1200);
    };

    if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);

    if (immediate) {
        executeRefresh();
        return;
    }

    // waitMs: angka = debounce khusus tipe input; true = frame berikutnya;
// null = debounce bawaan 30ms.
    const delay = typeof waitMs === 'number'
        ? waitMs
        : (waitMs === true ? 0 : DEFAULT_REFRESH_DEBOUNCE_MS);

    refreshDebounceTimer = setTimeout(executeRefresh, delay);
}


///////////////////////////
// IMPORT SETTINGS (URL) //
///////////////////////////

function ImportSettings(urlString) {
    try {
        const url = new URL(urlString);

        url.searchParams.forEach((value, key) => {
            // `let`, bukan `const`: cabang tags mengganti elemen select
            // (rebuild) dan perlu menugaskan ulang. Dengan const itu
            // melempar TypeError, ditangkap catch luar -> import berhenti
            // di field ini dan sisa parameter URL tidak pernah diproses.
            let inputElement = document.getElementById(key);
            if (inputElement != null) {
                if (inputElement.tagName === 'WA-SWITCH')
                    inputElement.checked = value.toLocaleLowerCase() == 'true';
                else if (inputElement.tagName === 'WA-SELECT' && inputElement.multiple) {
                    // WA-SELECT multiple butuh ARRAY. String dibuang.
                    const vals = String(value).split(',').map(v => v.trim()).filter(Boolean);
                    const labels = {};
                    Array.from(inputElement.querySelectorAll('wa-option')).forEach(o => {
                        labels[o.value] = o.textContent;
                    });
                    const allVals = Object.keys(labels);
                    const next = RebuildTagSelect(inputElement, allVals, labels, vals);
                    if (next) {
                        inputElement = next;
                        // Import membangkitkan 'input' synthetic saat `value` masih [] (komponen
// belum upgrade) dan sync() akan menghapus penanda — kunci dulu satu tick.
                        let tagsLocked = true;
                        const sync = () => {
                            if (tagsLocked) return;
                            const n = Array.isArray(next.value) ? next.value.length : 0;
                            if (n) next.setAttribute('data-has-tags', '');
                            else next.removeAttribute('data-has-tags');
                        };
                        setTimeout(() => { tagsLocked = false; }, 0);
                        // Penanda CSS dipasang dari jumlah tag yang diminta, bukan dari `value`:
// tepat setelah replaceWith `value` masih kosong, jadi sync() akan menghapus
// penanda walau tag sudah tampil -> form menyusut.
                        if (vals.length) next.setAttribute('data-has-tags', '');
                        else next.removeAttribute('data-has-tags');
                        next.addEventListener('input', evt => { sync(); handleInput(evt); });
                        next.addEventListener('wa-change', evt => { sync(); handleInput(evt); });
                    }
                }
                else
                    inputElement.value = value;

                // Event 'input' synthetic ditandai `committed` supaya tidak dianggap
// "sedang mengetik" -> refresh langsung (ter-coalesce jadi satu reload).
                const evt = new Event('input');
                evt.committed = true;
                inputElement.dispatchEvent(evt);
            }
        });
    }
    catch (error) {
        console.error('[Settings] Invalid URL passed to ImportSettings:', error);
    }
}


//////////////////////
// HELPER FUNCTIONS //
//////////////////////

function GetBooleanParam(paramName, defaultValue) {
    const urlParams = new URLSearchParams(window.location.search);
    const paramValue = urlParams.get(paramName);

    if (paramValue === null) {
        return defaultValue; // Parameter not found
    }

    const lowercaseValue = paramValue.toLowerCase(); // Handle case-insensitivity

    if (lowercaseValue === 'true') {
        return true;
    } else if (lowercaseValue === 'false') {
        return false;
    } else {
        return paramValue; // Return original string if not 'true' or 'false'
    }
}

function GetIntParam(paramName, defaultValue) {
    const urlParams = new URLSearchParams(window.location.search);
    const paramValue = urlParams.get(paramName);

    if (paramValue === null) {
        return defaultValue; // Parameter not found
    }

    const intValue = parseInt(paramValue, 10); // Parse as base 10 integer

    if (isNaN(intValue)) {
        return null;
    }

    return intValue;
}


/////////////////////////////
// LOCAL & WEB FONTS       //
/////////////////////////////

async function PopulateFontDatalist() {
    let datalistElement = document.getElementById('fonts');
    if (!datalistElement) {
        datalistElement = document.createElement('datalist');
        datalistElement.id = 'fonts';
        document.body.appendChild(datalistElement);
    }

    const defaultFonts = [
        'Arial', 'Arial Black', 'Bebas Neue', 'Calibri', 'Century Gothic', 'Comic Sans MS',
        'Archivo', 'Consolas', 'Courier New', 'Franklin Gothic Medium', 'Futura', 'Georgia',
        'Helvetica', 'Impact', 'Inter', 'Lato', 'Lucida Sans', 'Metropolis', 'Montserrat',
        'Noto Sans', 'Open Sans', 'Oswald', 'Outfit', 'Playfair Display', 'Poppins',
        'PT Sans', 'Raleway', 'Roboto', 'Rubik', 'Segoe UI', 'Tahoma', 'Times New Roman',
        'Trebuchet MS', 'Ubuntu', 'Verdana'
    ];

    let fontFamilies = [...defaultFonts];

    if ('queryLocalFonts' in window) {
        try {
            const availableFonts = await window.queryLocalFonts();
            const localFamilies = [...new Set(availableFonts.map(font => font.family))];
            fontFamilies = [...new Set([...defaultFonts, ...localFamilies])].sort();
        } catch (err) {
            console.debug("Local Font Access API unavailable or denied, using curated font list:", err);
        }
    }

    datalistElement.innerHTML = '';
    fontFamilies.forEach(family => {
        const option = document.createElement('option');
        option.value = family;
        datalistElement.appendChild(option);
    });

    // Also attach into any wa-input shadow roots
    document.querySelectorAll('wa-input[list="fonts"]').forEach(waInput => {
        if (waInput.shadowRoot) {
            const existing = waInput.shadowRoot.getElementById('fonts');
            if (existing) existing.remove();
            waInput.shadowRoot.appendChild(datalistElement.cloneNode(true));
            const innerInput = waInput.shadowRoot.querySelector('input');
            if (innerInput) innerInput.setAttribute('list', 'fonts');
        }
    });

    console.debug(`Loaded ${fontFamilies.length} fonts into auto-suggest.`);
}


///////////////////////
// INITIALISATION    //
///////////////////////

LoadSettingsFromStorage();
PopulateFontDatalist();
LoadJSON(settingsJson);

///////////////////////////////////////
// BADGE STATUS KONEKSI    //
///////////////////////////////////////

function InitConnectionBadges() {
    InitStreamerBotBadge();
    InitTikTokBadge();
    InitOBSBadge();
    InitNowPlayingRelay();
}

function InitStreamerBotBadge() {
    const status = document.getElementById('status-streamerbot');
    if (!status) return;

    let sbClient = null;

    function isStreamerbotEnabled() {
        const enableInput = document.getElementById('enableStreamerbot');
        if (enableInput) return enableInput.checked;
        if (settingsMap.has('enableStreamerbot')) return Boolean(settingsMap.get('enableStreamerbot'));
        return true;
    }

    function checkConnect() {
        if (!isStreamerbotEnabled()) {
            if (sbClient) {
                try { sbClient.disconnect?.(); } catch (e) {}
                sbClient = null;
            }
            status.classList.remove('connected');
            return;
        }

        const addressInput = document.getElementById('address');
        const portInput = document.getElementById('port');
        const host = addressInput?.value || settingsMap.get('address') || '127.0.0.1';
        const port = portInput?.value || settingsMap.get('port') || 8080;

        if (typeof StreamerbotClient === 'undefined') return;

        try {
            if (sbClient) {
                try { sbClient.disconnect?.(); } catch (e) {}
                sbClient = null;
            }

            sbClient = new StreamerbotClient({
                host,
                port,
                autoReconnect: false,
                onConnect: () => {
                    if (isStreamerbotEnabled()) {
                        status.classList.add('connected');
                    }
                },
                onDisconnect: () => {
                    status.classList.remove('connected');
                },
                onError: () => {
                    status.classList.remove('connected');
                }
            });
        } catch (e) {
            status.classList.remove('connected');
        }
    }

    checkConnect();
    setInterval(checkConnect, 15000);

    const enableInput = document.getElementById('enableStreamerbot');
    if (enableInput) enableInput.addEventListener('change', checkConnect);
    const addressInput = document.getElementById('address');
    if (addressInput) addressInput.addEventListener('change', checkConnect);
    const portInput = document.getElementById('port');
    if (portInput) portInput.addEventListener('change', checkConnect);
}

function InitTikTokBadge() {
    const status = document.getElementById('status-tiktok');
    if (!status) return;

    let ws = null;

    function isTikTokEnabled() {
        const showTiktokInput = document.getElementById('showTiktok');
        if (showTiktokInput) return showTiktokInput.checked;
        if (settingsMap.has('showTiktok')) return Boolean(settingsMap.get('showTiktok'));
        return true;
    }

    function getBridgePort() {
        const portInput = document.getElementById('bridgePort');
        return portInput?.value || settingsMap.get('bridgePort') || 47800;
    }

    // Satu socket ke Geseki Bridge menggantikan TikFinity + IndoFinity.
    function checkTikTok() {
        if (!isTikTokEnabled()) {
            if (ws) { try { ws.close(); } catch (e) {} ws = null; }
            status.classList.remove('connected');
            return;
        }

        // Sudah terbuka / sedang menyambung: jangan buka socket baru.
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const port = getBridgePort();
        try {
            ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
            ws.onopen = () => status.classList.add('connected');
            ws.onclose = () => { ws = null; status.classList.remove('connected'); };
            ws.onerror = () => {
                if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
                ws = null;
                status.classList.remove('connected');
            };
        } catch (e) {
            ws = null;
            status.classList.remove('connected');
        }
    }

    checkTikTok();
    setInterval(checkTikTok, 10000);

    const showTiktokInput = document.getElementById('showTiktok');
    if (showTiktokInput) showTiktokInput.addEventListener('change', checkTikTok);

    const portInput = document.getElementById('bridgePort');
    if (portInput) portInput.addEventListener('change', checkTikTok);
}

/* ============================================================================
   RELAY NOW PLAYING
   Halaman settings menjadi SATU-SATUNYA pengumpul data SMTC; widget (OBS/
   TTLS/pratinjau) menerima hasilnya lewat BroadcastChannel
   `CHANNEL_NAME`. Tiap instance yang fetch sendiri tiap 2s memicu
   parse + filter + TriggerAlert di proses yang GPU-nya rebutan encoder.
   Konsekuensi: halaman settings harus terbuka agar now playing jalan.
   ============================================================================ */
const NP_RELAY_INTERVAL = 1000;   // FetchNowPlaying = 1000ms sesuai permintaan
const NP_RELAY_STALE = 4000;      // widget anggap relay mati setelah 4s tanpa pesan

// ── Relay song change ke Streamer.bot ─────────────────────────
// Dashboard mem-poll SMTC sendiri, jadi deteksi ganti lagu dilakukan di sini
// dan widget tidak disentuh sama sekali. Pemilihan sesi meniru logika widget:
// included/excluded apps -> priority PLAYING -> current_session_id.
const RELAY_PLAYING = 4;        // PlaybackStatus.PLAYING (konstanta SMTC)
let relaySb = null;             // klien Streamer.bot khusus relay
let relayLastSongId = null;     // kunci lagu terakhir (anti-dobel)
let relayBusy = false;          // cegah tumpang tindih saat ekstraksi palet

// ── Tunggu artwork benar-benar berganti ──────────────────────────
// Bridge menulis artwork ke file per-app dan URL-nya memuat ?v=<mtime>, jadi
// URL hanya berubah saat byte gambar berubah. Saat ganti lagu, metadata SMTC
// sering mendahului artwork 1-2 detik: URL masih menunjuk gambar LAGU SEBELUMNYA.
// Widget menoleransi ini karena ia mengekstrak palet ulang tiap tick, tapi relay
// hanya menembak SEKALI per lagu (relayLastSongId) — tanpa penjagaan ini relay
// terkunci memakai warna lagu lama.
let relayLastArtUrl = null;     // artwork lagu terakhir yang BENAR-BENAR terkirim
let relayArtWaitSongId = null;  // lagu yang sedang ditunggu artwork barunya
let relayArtWaitSince = 0;      // waktu mulai menunggu (untuk batas waktu)
// Batas tunggu: dua lagu berurutan bisa punya artwork identik (satu album) sehingga
// URL-nya memang tidak berubah — tanpa batas ini relay tidak akan pernah menembak.
const RELAY_ART_SETTLE_TIMEOUT = 4000;

// ── Palet relay: samakan persis dengan widget ────────────────────
// Widget memakai role pilihan user (settings accentPaletteRole) lewat
// ResolveAccentColor(). Relay wajib memakai aturan yang sama, kalau tidak
// warna event Streamer.bot berbeda dari warna overlay untuk lagu yang sama.
const RELAY_ACCENT_ROLE_MAP = {
    lightvibrant: 'LightVibrant',
    vibrant: 'Vibrant',
    darkvibrant: 'DarkVibrant'
};

// Warna/palet terakhir yang BERHASIL diekstrak. Dipakai untuk menirukan widget:
// bila Vibrant gagal dimuat, widget mempertahankan warna lamanya (bukan jatuh ke
// ungu), jadi relay pun harus begitu supaya keduanya tetap sama.
let relayLastPalette = null;
let relayLastColor = null;

function GetRelayAccentRole() {
    const v = document.getElementById('accentPaletteRole')?.value
        || settingsMap.get('accentPaletteRole') || 'lightvibrant';
    return String(v).toLowerCase();
}

// Fallback: role pilihan -> LightVibrant -> Vibrant -> ungu default.
// Identik dengan ResolveAccentColor() di widget.
function ResolveRelayAccentColor(hexPalette, role) {
    const preferred = RELAY_ACCENT_ROLE_MAP[role || 'lightvibrant'];
    return (preferred && hexPalette[preferred])
        || hexPalette.LightVibrant
        || hexPalette.Vibrant
        || '#8A2BE2';
}

function GetRelaySb() {
    if (typeof StreamerbotClient === 'undefined') return null;
    const host = document.getElementById('address')?.value
        || settingsMap.get('address') || '127.0.0.1';
    const port = document.getElementById('port')?.value
        || settingsMap.get('port') || 8080;

    // Buat ulang bila alamat atau port berubah.
    if (relaySb && relaySb.__host === host && String(relaySb.__port) === String(port)) {
        return relaySb;
    }
    try { relaySb?.disconnect?.(); } catch (e) { /* abaikan */ }
    try {
        relaySb = new StreamerbotClient({ host, port, autoReconnect: true });
        relaySb.__host = host;
        relaySb.__port = port;
    } catch (e) {
        relaySb = null;
    }
    return relaySb;
}

// Pilih sesi SMTC yang dipakai, sama seperti widget.
function PickRelaySession(data) {
    const sessions = data.sessions || [];
    if (!sessions.length) return null;

    const list = (v) => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const included = list(document.getElementById('includedApplications')?.value
        || settingsMap.get('includedApplications'));
    const excluded = list(document.getElementById('excludedApplications')?.value
        || settingsMap.get('excludedApplications'));

    const valid = sessions.filter(s =>
        !excluded.some(ex => (s.source_app_id || '').toLowerCase().includes(ex)));
    if (!valid.length) return null;

    if (included.length) {
        for (const app of included) {
            const hit = valid.find(s => (s.source_app_id || '').toLowerCase().includes(app)
                && s.playback_info?.PlaybackStatus === RELAY_PLAYING);
            if (hit) return hit;
        }
        for (const app of included) {
            const hit = valid.find(s => (s.source_app_id || '').toLowerCase().includes(app));
            if (hit) return hit;
        }
        return null;
    }

    const cur = valid.find(s => s.source_app_id === data.current_session_id);
    if (cur && cur.playback_info?.PlaybackStatus === RELAY_PLAYING) return cur;

    const playing = valid.find(s => s.playback_info?.PlaybackStatus === RELAY_PLAYING);
    return playing || valid[0];
}

// base64 mentah dari SMTC -> data URL. Identik dengan widget: tanpa cek
// panjang, cukup bukan http dan bukan data:. Warna Vibrant bergantung byte
// gambar yang didekode, jadi input harus menghasilkan URL yang sama persis.
function NormalizeRelayArt(raw) {
    if (!raw) return '';
    if (raw.startsWith('http') || raw.startsWith('data:')) return raw;
    return 'data:image/jpeg;base64,' + raw;
}

// Ekstrak palet dari artwork. Identik dengan GetAccentPalette() di widget:
// versi Vibrant, API callback, getHex(), dan urutan fallback harus sama
// persis supaya warna relay = warna overlay.
async function GetRelayPalette(artUrl) {
    // Fallback widget bila Vibrant gagal.
    const errPalette = { Vibrant: '#ffffff', Muted: '#cccccc', DarkVibrant: '#000000' };
    if (!artUrl) return { color: '#8A2BE2', palette: {} };

    if (typeof Vibrant === 'undefined') {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/node-vibrant/3.1.6/vibrant.min.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        }).catch(() => {});
    }
    // Library gagal dimuat (CDN offline/diblokir). Widget di posisi ini akan
    // melempar error lalu MEMPERTAHANKAN warna lamanya, jadi relay menirukan:
    // pakai palet terakhir yang berhasil supaya event tetap terkirim dengan
    // warna yang sama seperti yang sedang tampil di overlay.
    if (typeof Vibrant === 'undefined') {
        if (relayLastPalette) return { color: relayLastColor, palette: relayLastPalette };
        return { color: '#8A2BE2', palette: {} };
    }

    const hexPalette = await new Promise((resolve) => {
        Vibrant.from(artUrl).getPalette((err, palette) => {
            if (err) return resolve(errPalette);
            const out = {};
            for (const role in palette) {
                if (palette[role]) out[role] = palette[role].getHex();
            }
            resolve(out);
        });
    });

    // Warna accent mengikuti role pilihan user (settings: accentPaletteRole),
    // sama seperti ResolveAccentColor() di widget.
    const color = ResolveRelayAccentColor(hexPalette, GetRelayAccentRole());
    relayLastPalette = hexPalette;
    relayLastColor = color;
    return { color, palette: hexPalette };
}

// Tunggu artwork benar-benar bisa digambar, sama seperti widget. Palet hanya
// valid bila gambar sukses didekode; kalau gagal, simpan niat dan coba tick
// berikutnya supaya warna tidak jatuh ke fallback.
async function RelayWaitArtwork(artUrl) {
    if (!artUrl) return false;
    return await new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        const timer = setTimeout(() => finish(false), 3000);
        img.onload = () => { clearTimeout(timer); finish(img.naturalWidth > 0 && img.naturalHeight > 0); };
        img.onerror = () => { clearTimeout(timer); finish(false); };
        img.src = artUrl;
    });
}

// Deteksi ganti lagu lalu tembak trigger 'spotify.songchange'.
async function RelaySongChange(data) {
    if (relayBusy) return;
    const s = PickRelaySession(data);
    if (!s) return;

    const mp = s.media_properties || {};
    // Timeline SMTC (satuan milidetik, sama seperti yang dikirim bridge). Dipakai
    // hanya sebagai snapshot saat ganti lagu: EndTime = durasi, Position = posisi
    // saat deteksi, LastUpdatedTime = anchor waktu UTC dari Windows.
    const tp = s.timeline_properties || {};
    const title = mp.Title || '';
    const artist = mp.Artist || '';
    // Metadata "Unknown" belum final; jangan dipakai sebagai kunci lagu.
    if (!title || !artist || title === 'Unknown' || artist === 'Unknown') return;

    const songId = (title + '|' + artist).toLowerCase();
    if (songId === relayLastSongId) return;

    // Artwork harus ada DULU: tanpa artwork palet jatuh ke fallback.
    const rawArt = mp.Thumbnail || mp.ThumbnailBase64 || '';
    if (!rawArt) return;                      // tunggu tick berikutnya
    const artUrl = NormalizeRelayArt(rawArt);

    // Artwork masih milik lagu SEBELUMNYA -> tunda dulu. Widget akan menyusul
    // sendiri di tick berikutnya, tapi relay sudah terkunci setelah menembak.
    if (relayLastArtUrl && artUrl === relayLastArtUrl) {
        if (relayArtWaitSongId !== songId) {
            relayArtWaitSongId = songId;
            relayArtWaitSince = Date.now();
        }
        if (Date.now() - relayArtWaitSince < RELAY_ART_SETTLE_TIMEOUT) return;
        // Lewat batas waktu (artwork identik / bridge tidak pernah mengirim baru):
        // lanjutkan dengan artwork yang ada daripada tidak mengirim sama sekali.
    }

    const artReady = await RelayWaitArtwork(artUrl);
    if (!artReady) return;                    // artwork belum valid, coba lagi nanti

    relayBusy = true;
    try {
        const { color, palette } = await GetRelayPalette(artUrl);

        const sb = GetRelaySb();
        if (!sb || typeof sb.executeCodeTrigger !== 'function') return;

        sb.executeCodeTrigger('spotify.songchange', {
            title,
            artist,
            album: mp.AlbumTitle || '',
            thumbnail: artUrl,
            color,
            palette,
			source: s.source_app_id || '',
            playbackStatus: s.playback_info?.PlaybackStatus ?? 0,
            // Timeline SMTC — snapshot saat ganti lagu, satuan milidetik.
            EndTime: Number(tp.EndTime) || 0,
            Position: Number(tp.Position) || 0,
            LastUpdatedTime: tp.LastUpdatedTime || ''
        });
        relayLastSongId = songId;
        // Artwork yang benar-benar terkirim -> penjaga perbandingan lagu berikutnya.
        relayLastArtUrl = artUrl;
        relayArtWaitSongId = null;
        relayArtWaitSince = 0;
        console.log('[Geseki][Relay] songchange terkirim:', title, '-', artist);
    } catch (e) {
        console.warn('[Geseki][Relay] Gagal kirim songchange:', e);
    } finally {
        relayBusy = false;
    }
}

function InitNowPlayingRelay() {
    if (!window.BroadcastChannel) return;

    const relay = new BroadcastChannel(CHANNEL_NAME);

    // Widget memberi tahu relay bahwa ia hidup, supaya relay langsung kirim
    // snapshot terakhir (tanpa menunggu 1s berikutnya).
    relay.onmessage = function (event) {
        if (event.data && event.data.type === 'np_hello' && lastNowPlayingPayload) {
            relay.postMessage({ type: 'now_playing', payload: lastNowPlayingPayload });
        }
    };

    let lastNowPlayingPayload = null;

    async function pollOnce() {
        // Hanya relay bila Now Playing diaktifkan di settings.
        let enabled = true;
        const enableInput = document.getElementById('enableNowPlaying');
        if (enableInput) enabled = enableInput.checked;
        else if (settingsMap.has('enableNowPlaying')) enabled = Boolean(settingsMap.get('enableNowPlaying'));

        if (!enabled) {
            lastNowPlayingPayload = { enabled: false, ok: false, sessions: [], current_session_id: null };
            relay.postMessage({ type: 'now_playing', payload: lastNowPlayingPayload });
            return;
        }

        const portInput = document.getElementById('bridgePort');
        const port = portInput?.value || settingsMap.get('bridgePort') || 47800;
        const url = `http://127.0.0.1:${port}/now-playing`;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('bridge offline');
            const data = await response.json();
            lastNowPlayingPayload = {
                enabled: true,
                ok: true,
                sessions: data.sessions || [],
                current_session_id: data.current_session_id || null
            };
            // Deteksi ganti lagu + kirim ke Streamer.bot (relay berdiri sendiri,
            // tidak lewat widget).
            RelaySongChange(lastNowPlayingPayload);
        } catch (e) {
            lastNowPlayingPayload = { enabled: true, ok: false, sessions: [], current_session_id: null };
        }

        relay.postMessage({ type: 'now_playing', payload: lastNowPlayingPayload });
    }

    pollOnce();
    setInterval(pollOnce, NP_RELAY_INTERVAL);
}

// ── Badge status koneksi OBS ──────────────────────────────────────
// obs-websocket memakai WebSocket, jadi
// status diuji dengan membuka koneksi sebentar lalu langsung menutupnya —
// kalau dibiarkan terbuka, tiap pengecekan menambah koneksi ke OBS.
function InitOBSBadge() {
    const status = document.getElementById('status-obs');
    // Pil di bar atas (skin=queue) memakai elemen terpisah; keduanya
    // dinyalakan bersama supaya tidak perlu dua probe WebSocket.
    const statusNav = document.getElementById('statusObsNav');
    if (!status && !statusNav) return;

    let probe = null;

    function setConnected(ok) {
        if (status) status.classList.toggle('connected', ok === true);
        if (statusNav) statusNav.classList.toggle('connected', ok === true);
    }

    function checkOBS() {
        const cfg = (typeof GetObsConfig === 'function')
            ? GetObsConfig()
            : { address: '127.0.0.1', port: 4455, password: '' };

        // Tutup probe sebelumnya yang belum sempat selesai.
        if (probe) {
            try { probe.onopen = probe.onerror = probe.onclose = null; probe.close(); } catch (e) {}
            probe = null;
        }

        try {
            probe = new WebSocket(`ws://${cfg.address}:${cfg.port}`);
        } catch (e) {
            setConnected(false);
            return;
        }

        // Pengaman: kalau OBS menerima koneksi tapi tidak pernah
        // mengirim Hello, anggap gagal.
        const timer = setTimeout(() => {
            setConnected(false);
            try { probe?.close(); } catch (e) {}
        }, 3000);

        probe.onopen = () => {
            // Terhubung di level TCP — artinya server obs-websocket
            // hidup. Tidak perlu autentikasi untuk sekadar cek status.
            clearTimeout(timer);
            setConnected(true);
            try { probe.close(); } catch (e) {}
        };
        probe.onerror = () => {
            clearTimeout(timer);
            setConnected(false);
        };
        probe.onclose = () => { clearTimeout(timer); };
    }

    checkOBS();
    setInterval(checkOBS, 10000);

    // Perubahan IP/port/password langsung memicu pengecekan ulang.
    ['obsAddress', 'obsPort', 'obsPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', checkOBS);
    });
}
