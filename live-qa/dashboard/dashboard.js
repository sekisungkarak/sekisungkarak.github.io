// Dashboard khusus dock OBS — live-qa/dashboard/
// Dua tab:
//   Settings — memuat settings-page-builder dengan ?dashboard=1, sehingga
//              builder TIDAK membuat iframe preview (hemat CPU/GPU di OBS).
//   Queue    — daftar pertanyaan yang masuk; klik satu baris untuk
//              menampilkannya di overlay. Iframe-nya baru dimuat saat tab
//              pertama kali dibuka.
//
// sourceName/sourceWidth/sourceHeight diteruskan ke builder karena
// shared/settings/obs_source.js membacanya dari query string. Ini WAJIB:
// kalau Live Q&A memakai nama source default ("Dynamic Island Alert"),
// tombol Save akan menimpa URL browser source milik widget island.

const dashFrame = document.getElementById('dashFrame');
const queueFrame = document.getElementById('queueFrame');
const tabSettings = document.getElementById('tabSettings');
const tabQueue = document.getElementById('tabQueue');
const paneSettings = document.getElementById('paneSettings');
const paneQueue = document.getElementById('paneQueue');
const queueBadge = document.getElementById('queueBadge');
const tabInteract = document.getElementById('tabInteract');

// Identitas widget. Nama ini juga dipakai sebagai nama OBS source (sourceName)
// dan judul di navbar.
const WIDGET_NAME = 'Live Q&A';

// Dari live-qa/dashboard/ -> shared/settings/ ada 2 level atas.
const settingsPageURL = '../../shared/settings/index.html';

// settings.json sejajar dengan dashboard (folder settings/ sudah dihapus).
const settingsDir = new URL('./', window.location.href).href;

// Widget yang dikendalikan: index.html di root live-qa.
const widgetURL = new URL('../index.html', window.location.href).href;

dashFrame.src =
    settingsPageURL +
    '?v=39&settingsJson=' + encodeURIComponent(settingsDir + 'settings.json?v=33') +
    '&widgetURL=' + encodeURIComponent(widgetURL) +
    '&sourceName=' + encodeURIComponent(WIDGET_NAME) +
    '&sourceWidth=1080&sourceHeight=350&sourceAlign=center' +
    '&widgetName=' + encodeURIComponent(WIDGET_NAME) +
    // Gaya halaman Queue untuk tab Settings; header halaman itu dipakai
    // ulang sebagai top bar (judul + Save / Load / Reset + status OBS),
    // jadi chrome=min tidak dipakai.
    '&skin=queue' +
    '&dashboard=1';

// Queue page dibuka dari folder queue/.
queueFrame.dataset.src = new URL('../queue/index.html', window.location.href).href;

// ── Tab ─────────────────────────────────────────────────────────────────────

let queueLoaded = false;

// Tab yang harus dibuka lagi setelah popup ditutup (null = tetap di Settings).
let popupReturnTab = null;

function SelectTab(which) {
    const isQueue = which === 'queue';

    tabSettings.classList.toggle('is-active', !isQueue);
    tabQueue.classList.toggle('is-active', isQueue);
    paneSettings.classList.toggle('is-active', !isQueue);
    paneQueue.classList.toggle('is-active', isQueue);

    if (isQueue && !queueLoaded) {
        queueFrame.src = queueFrame.dataset.src;
        queueLoaded = true;
    }
}

tabSettings.addEventListener('click', () => SelectTab('settings'));
tabQueue.addEventListener('click', () => SelectTab('queue'));

// ── Tombol Interact ─────────────────────────────────────────────────────────
// Dialog Interact adalah jendela native OBS, dibuka lewat request obs-websocket
// OpenInputInteractDialog. Koneksi OBS hidup di dalam iframe Settings, jadi
// tombol ini cuma meneruskan permintaan ke sana — bukan menyambung sendiri.
tabInteract.addEventListener('click', () => {
    if (!dashFrame.contentWindow) return;
    tabInteract.classList.add('is-busy');
    // Pastikan tab Settings aktif supaya iframe hidup dan terlihat.
    SelectTab('settings');
    try {
        dashFrame.contentWindow.postMessage({ type: 'geseki_open_interact' }, '*');
    } catch (e) { /* abaikan */ }
    // Lepas status sibuk apa pun hasilnya; dialognya sendiri muncul di OBS.
    setTimeout(() => tabInteract.classList.remove('is-busy'), 1500);
});

// Balasan dari iframe Settings (berhasil / gagal) — hanya untuk melepas status.
window.addEventListener('message', (ev) => {
    const d = ev.data || {};
    if (d.type === 'geseki_interact_result') {
        tabInteract.classList.remove('is-busy');
    }
});

// ── Badge jumlah antrean ────────────────────────────────────────────────────
// Dashboard ikut mendengarkan kanal widget supaya jumlah pertanyaan terlihat
// bahkan saat tab Settings yang terbuka.

const WIDGET_NS = 'geseki:live-qa:';

// Semua source aktif bersamaan: badge hanya mengikuti scene yang SEDANG
// TAYANG supaya angkanya tidak berubah-ubah antar scene.
let sawActiveScene = false;

if (window.BroadcastChannel) {
    try {
        const bc = new BroadcastChannel(WIDGET_NS + 'channel');
        bc.onmessage = (ev) => {
            const d = ev.data || {};
            // Permintaan popup dari Queue: tab Settings harus terlihat dulu,
            // kalau tidak dialognya terbuka di iframe yang tersembunyi.
            if (d.type === 'open_settings_popup') {
                // Popup dari pil Bridge (halaman Queue) -> setelah ditutup
                // harus kembali ke Queue. Popup dari pil OBS di header
                // Settings tidak mengubah tab.
                popupReturnTab = d.from === 'queue' ? 'queue' : null;
                SelectTab('settings');
                return;
            }
            // Dikirim halaman Settings saat popup ditutup.
            if (d.type === 'settings_popup_closed') {
                if (popupReturnTab === 'queue') SelectTab('queue');
                popupReturnTab = null;
                return;
            }
            if (d.type !== 'qa_state') return;
            if (!d.active && sawActiveScene) return;
            if (d.active) sawActiveScene = true;
            const n = Array.isArray(d.questions) ? d.questions.length : 0;
            queueBadge.textContent = String(n);
            queueBadge.hidden = n === 0;
        };
    } catch (e) { /* abaikan */ }
}

// ── Pil status TikTok di navbar ─────────────────────────────────────────────
// Bridge mengirim pesan 'status' dengan { tiktok: { state, username } }.
// Dashboard membuka WebSocket sendiri supaya pil tetap hidup walau tab
// Settings/Queue sedang tidak aktif.

const liveStatus = document.getElementById('liveStatus');
const liveUser = document.getElementById('liveUser');
const liveState = document.getElementById('liveState');
const liveAvatar = document.getElementById('liveAvatar');

// Foto streamer terakhir yang ditampilkan, supaya URL yang sama tidak
// dipasang ulang (dan tidak memicu muat ulang gambar).
let liveAvatarUrl = '';
// Toast hanya untuk PERUBAHAN status. Saat dashboard dimuat, bridge
// mengirim keadaan saat ini (atau koneksinya gagal) — itu snapshot, bukan
// perubahan. Jadi toast baru "diaktifkan" setelah status pertama selesai
// diproses; sebelumnya semua pembaruan dianggap snapshot.
let liveToastState = null;
let liveToastsArmed = false;

function SetLiveAvatar(url) {
	if (!liveAvatar) return;
	if (!url) {
		// Belum ada foto: placeholder SVG yang tampil.
		liveAvatar.classList.remove('is-shown');
		liveAvatar.removeAttribute('src');
		liveAvatarUrl = '';
		return;
	}
	if (url === liveAvatarUrl) return;
	liveAvatarUrl = url;
	// Foto hanya menutupi placeholder setelah benar-benar termuat, jadi
	// tidak pernah ada kotak kosong menggantikan placeholder.
	liveAvatar.classList.remove('is-shown');
	liveAvatar.onerror = function () {
		// Foto gagal dimuat (mis. URL kedaluwarsa): kembali ke placeholder.
		liveAvatar.classList.remove('is-shown');
		liveAvatarUrl = '';
	};
	liveAvatar.onload = function () { liveAvatar.classList.add('is-shown'); };
	liveAvatar.src = url;
}

/* Toast status: hanya perubahan yang berarti. 'connecting' dilewati karena
   muncul lagi di setiap percobaan ulang, jadi akan jadi kebisingan. */
function ShowLiveToast(state, message) {
	if (state === 'connecting') return;
	if (state === liveToastState) return;
	liveToastState = state;

	let box = document.getElementById('skToasts');
	if (!box) {
		box = document.createElement('div');
		box.id = 'skToasts';
		box.className = 'sk-toasts';
		document.body.appendChild(box);
	}

	const t = document.createElement('div');
	const cls = state === 'error' ? ' is-error'
		: state === 'off' ? ' is-offline' : '';
	t.className = 'sk-toast' + cls;
	// Saat gagal, alasan dari bridge lebih berguna daripada kata "Error".
	const label = LIVE_STATE_LABEL[state] || state;
	t.textContent = (state === 'error' && message)
		? 'TikTok: ' + message
		: 'TikTok: ' + label;
	box.appendChild(t);

	while (box.children.length > 4) box.removeChild(box.firstChild);
	setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3400);
}

const LIVE_STATE_LABEL = {
	connected: 'Live',
	connecting: 'Connecting\u2026',
	off: 'Offline',
	error: 'Error'
};

/* `suppressToast` dipakai untuk status pertama: pil tetap diperbarui, tapi
   tidak ada toast karena itu keadaan awal, bukan perubahan. */
function SetLiveStatus(state, username, message, avatar, suppressToast) {
	if (!liveStatus) return;
	SetLiveAvatar(avatar);
	if (!suppressToast) ShowLiveToast(state, message);
	const s = LIVE_STATE_LABEL[state] ? state : 'off';
	const cls = s === 'connected' ? 'is-live'
		: s === 'connecting' ? 'is-connecting'
		: s === 'error' ? 'is-error'
		: 'is-offline';
	liveStatus.classList.remove('is-connecting', 'is-live', 'is-offline', 'is-error');
	liveStatus.classList.add(cls);
	// Saat gagal, bridge menyertakan alasannya (mis. sign server lokal
	// tidak tersedia). Pesan itu yang bisa ditindaklanjuti, jadi tampilkan
	// apa adanya, bukan sekadar kata "Error".
	const detail = (s === 'error' && message) ? message : '';
	if (liveState) {
		liveState.textContent = detail || LIVE_STATE_LABEL[s];
		liveState.classList.toggle('is-message', !!detail);
	}
	if (liveUser) liveUser.textContent = username ? ('@' + username) : '@\u2014';
	liveStatus.title = 'TikTok: ' + LIVE_STATE_LABEL[s] +
		(username ? ' (@' + username + ')' : '') +
		(detail ? ' \u2014 ' + detail : '');
}

let liveWs = null;

function ConnectLiveStatus() {
	try {
		liveWs = new WebSocket('ws://127.0.0.1:47800/ws');
		// Bridge mengirim status awal begitu tersambung, jadi tidak perlu
		// meminta apa pun di sini.
		liveWs.onmessage = (ev) => {
			let d;
			try { d = JSON.parse(ev.data); } catch (e) { return; }
			if (d && d.type === 'status' && d.tiktok) {
				// Status pertama setelah halaman dimuat = keadaan sekarang,
				// bukan perubahan: perbarui pil tanpa toast.
				const first = !liveToastsArmed;
				liveToastsArmed = true;
				SetLiveStatus(d.tiktok.state, d.tiktok.username, d.tiktok.message,
					d.tiktok.avatar, first);
			}
		};
		liveWs.onclose = () => {
			liveWs = null;
			// Bridge tidak terjangkau saat halaman dimuat: itu juga snapshot.
			const first = !liveToastsArmed;
			liveToastsArmed = true;
			SetLiveStatus('off', '', '', '', first);
			setTimeout(ConnectLiveStatus, 5000);
		};
		liveWs.onerror = () => {
			if (liveWs && liveWs.readyState !== WebSocket.CLOSED) liveWs.close();
		};
	} catch (e) {
		liveWs = null;
		const first = !liveToastsArmed;
		liveToastsArmed = true;
		SetLiveStatus('off', '', '', '', first);
		setTimeout(ConnectLiveStatus, 5000);
	}
}

SetLiveStatus('connecting', '', '', '', true);
ConnectLiveStatus();

// ── Tab awal ────────────────────────────────────────────────────────────────
// Settings adalah tab default. Iframe-nya sudah dimuat di atas; iframe Queue
// baru dimuat saat tab-nya pertama kali dibuka.
SelectTab('settings');
