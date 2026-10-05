// Dashboard khusus dock OBS — dynamic-island-alert/dashboard/
// Susunannya sengaja disamakan dengan dashboard Live Q&A supaya halaman
// Settings seluruh widget terlihat seragam: navbar berisi pil status TikTok,
// tab Settings, dan tombol Interact.
//
// Memuat settings-page-builder dengan ?dashboard=1, sehingga builder:
//   1. TIDAK membuat iframe preview → hemat CPU/GPU di OBS
//   2. Tetap memakai layar loading #loading (overlay layar-penuh) sampai
//      settings.json selesai, lalu memudar tanpa jeda minimum
// Catatan: mode ini TIDAK mengubah cara kerja tombol Reset —
// BroadcastChannel tetap butuh pengirim, yaitu halaman ini.
//
// ?skin=queue dipakai supaya halaman Settings memakai top bar yang sama
// dengan Live Q&A (judul + Save / Load / Reset + status OBS). Widget ini
// tidak punya halaman Queue, jadi tidak ada tab Queue di navbar.

const dashFrame = document.getElementById('dashFrame');
const tabInteract = document.getElementById('tabInteract');

// Identitas widget. Nama ini juga dipakai sebagai judul di top bar Settings.
const WIDGET_NAME = 'Dynamic Island Alert';

// Dari dynamic-island-alert/dashboard/ -> shared/settings/ ada 2 level atas.
const settingsPageURL = '../../shared/settings/index.html';

// settings.json sejajar dengan dashboard (folder settings/ sudah dihapus).
const settingsDir = new URL('./', window.location.href).href;

// Widget yang dikendalikan: index.html di root dynamic-island-alert.
const widgetURL = new URL('../index.html', window.location.href).href;

dashFrame.src =
    settingsPageURL +
    '?v=40&settingsJson=' + encodeURIComponent(settingsDir + 'settings.json?v=18') +
    '&widgetURL=' + encodeURIComponent(widgetURL) +
    // sourceName sengaja TIDAK dikirim: default-nya "Dynamic Island Alert",
    // yang memang nama source widget ini. Mengirimnya eksplisit tidak
    // mengubah perilaku.
    '&sourceWidth=1080&sourceHeight=700&sourceAlign=center' +
    '&widgetName=' + encodeURIComponent(WIDGET_NAME) +
    // Gaya halaman Queue untuk tab Settings; header halaman itu dipakai
    // ulang sebagai top bar (judul + Save / Load / Reset + status OBS),
    // jadi chrome=min tidak dipakai.
    '&skin=queue' +
    '&dashboard=1';

// ── Tombol Interact ─────────────────────────────────────────────────────────
// Dialog Interact adalah jendela native OBS, dibuka lewat request obs-websocket
// OpenInputInteractDialog. Koneksi OBS hidup di dalam iframe Settings, jadi
// tombol ini cuma meneruskan permintaan ke sana — bukan menyambung sendiri.
tabInteract.addEventListener('click', () => {
    if (!dashFrame.contentWindow) return;
    tabInteract.classList.add('is-busy');
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

// ── Pil status TikTok di navbar ─────────────────────────────────────────────
// Bridge mengirim pesan 'status' dengan { tiktok: { state, username, avatar } }.
// Dashboard membuka WebSocket sendiri supaya pil tetap hidup walau fokus ada
// di dalam iframe Settings.

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
