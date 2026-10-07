/* Simulator — mengirim event TikTok tiruan ke widget lewat kanal yang sama
   dengan Settings/Controls (BroadcastChannel -> {type:'callFunction'}).

   Generik: halaman ini tidak tahu widget apa yang dikendalikan. Ia hanya
   mengirim `gesekiSimulate(event, data)` ke kanal yang diberikan lewat query
   `?channel=geseki:<widget>:channel`. Widget yang tidak mendukung sebuah
   event cukup mengabaikannya (no-op). */

const params = new URLSearchParams(location.search);
const CHANNEL = params.get('channel') || '';
const WIDGET = params.get('widget') || '';

/* Kanal ke widget. Kalau dibuka tanpa ?channel, halaman tetap jalan tapi
   tidak mengirim apa pun (berguna untuk pratinjau tata letak). */
const bc = (CHANNEL && window.BroadcastChannel) ? new BroadcastChannel(CHANNEL) : null;

/* Satu-satunya jalur keluar: panggil fungsi `gesekiSimulate` di widget. */
function Send(event, data) {
	if (!bc) { Toast('No channel — open this from a widget dashboard.', true); return; }
	bc.postMessage({ type: 'callFunction', fn: 'gesekiSimulate', args: [event, data] });
}

/* ── Identitas penonton simulasi ───────────────────────────────────────── */
const AVATAR = new URL('../../resources/sekisungkarak_avatar.jpeg', location.href).href;
const SIM_USER = {
	userId: 'sim-viewer',
	uniqueId: 'simulated_viewer',
	nickname: 'Simulated Viewer',
	profilePictureUrl: AVATAR
};

/* URL badge: hanya perlu MEMUAT string yang dikenali (badgeSceneType /
   'fans_badge_icon') supaya UserPermissionFlags widget menyalakan perannya. */
const BADGE_SUB = 'https://p16-webcast.tiktokcdn.com/webcast-va/subscriber_badge_icon.png~tplv-obj.image';
const BADGE_FAN = 'https://p16-webcast.tiktokcdn.com/webcast-va/fans_badge_icon_lv1.png~tplv-obj.image';

/* Badge contoh — SAMA seperti Test Alert DIA yang lama: grade lv1 + Top Gifter
   No. 3. Ditambahkan ke SETIAP event Simulator supaya kartu alert tampil seperti
   live. Jalur event asli (GetUserBadges) membaca `name`, bukan `label`. */
const BADGE_GRADE = 'https://p19-webcast.tiktokcdn.com/webcast-va/grade_badge_icon_lite_lv1_v1.png~tplv-obj.image';
const BADGE_TOPGIFTER = 'https://p19-webcast.tiktokcdn.com/webcast-sg/new_top_gifter_version_2.png~tplv-obj.image';

function TestBadges() {
	return [
		{ image: BADGE_GRADE, name: '1', color: '#99789EE7' },
		{ image: BADGE_TOPGIFTER, name: 'No. 3', color: '#66FE2C55' }
	];
}

/* Identitas dasar + badge contoh, untuk event yang tak butuh peran khusus. */
function BaseUser() {
	const d = Object.assign({}, SIM_USER);
	d.userBadges = TestBadges();
	return d;
}

/* Peran pengirim -> nama tampilan + flag payload yang dibaca widget
   (sama untuk DIA & Live Q&A). Username mengikuti peran yang dipilih. */
const ROLE_USERNAME = {
	none: 'Viewer',
	follower: 'Follower',
	subscriber: 'Subscriber',
	fanclub: 'Fan Club',
	superfan: 'Super Fan'
};

function RolePayload(role) {
	const d = BaseUser();
	// Username mengikuti peran: "Follower", "Subscriber", dst.
	const uname = ROLE_USERNAME[role] || 'Viewer';
	d.nickname = uname;
	d.uniqueId = uname.toLowerCase().split(' ').join('_');
	if (role === 'follower') {
		d.followRole = 1;
	} else if (role === 'subscriber') {
		d.isSubscriber = true;
		d.userBadges.push({ badgeSceneType: 4, image: BADGE_SUB });
	} else if (role === 'fanclub') {
		// Badge fan club harus berwarna (bukan abu dorman).
		d.userBadges.push({ badgeSceneType: 10, image: BADGE_FAN, color: '#99789EE7' });
	} else if (role === 'superfan') {
		// Superfan tidak ikut di payload chat: widget mendaftarkannya dari
		// penanda ini sebelum chat diproses.
		d.__simSuperFan = true;
	}
	return d;
}

/* ── Toast ─────────────────────────────────────────────────────────────── */
let toastTimer = null;
function Toast(msg, isError) {
	const el = document.getElementById('simToast');
	if (!el) return;
	el.textContent = msg;
	el.classList.toggle('is-error', !!isError);
	el.classList.add('is-shown');
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove('is-shown'), 1800);
}

/* ── Tab ───────────────────────────────────────────────────────────────── */
const tabs = Array.from(document.querySelectorAll('.sim-tab'));
const panels = Array.from(document.querySelectorAll('.sim-panel'));
tabs.forEach(t => t.addEventListener('click', () => {
	tabs.forEach(x => x.classList.toggle('is-active', x === t));
	const name = t.dataset.tab;
	panels.forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
}));

/* ── Header ────────────────────────────────────────────────────────────── */
if (WIDGET) document.getElementById('simWidget').textContent = WIDGET;

document.getElementById('simClose').addEventListener('click', () => {
	// Tutup overlay di dashboard induk (kalau dibuka dari sana).
	try { parent.postMessage({ type: 'geseki_simulator_close' }, '*'); } catch (e) { /* abaikan */ }
});

/* ── Quick: follow / subscribe / share / now playing ───────────────────── */
document.querySelectorAll('[data-quick]').forEach(btn => {
	btn.addEventListener('click', () => {
		const kind = btn.dataset.quick;
		if (kind === 'nowPlaying') {
			// Now Playing bukan event TikTok: widget menanganinya khusus.
			Send('nowPlaying', {});
		} else {
			Send(kind, BaseUser());
		}
		Toast('Sent: ' + (btn.dataset.label || kind));
	});
});

/* ── Total Likes ───────────────────────────────────────────────────────── */
let likeTotal = 0;
const likeTotalEl = document.getElementById('likeTotal');

document.getElementById('addLikes').addEventListener('click', () => {
	const n = Math.max(1, parseInt(document.getElementById('likeInput').value, 10) || 1);
	likeTotal += n;
	likeTotalEl.textContent = String(likeTotal);
	Send('like', Object.assign(BaseUser(), { likeCount: n }));
	Toast('Sent: +' + n + ' likes');
});

document.getElementById('resetLikes').addEventListener('click', () => {
	likeTotal = 0;
	likeTotalEl.textContent = '0';
	Toast('Like counter reset');
});

/* ── Comment ───────────────────────────────────────────────────────────── */
document.getElementById('sendComment').addEventListener('click', () => {
	const text = document.getElementById('commentText').value.trim();
	if (!text) { Toast('Write a comment first', true); return; }
	const role = document.getElementById('commentRole').value;
	const data = RolePayload(role);
	data.comment = text;
	Send('chat', data);
	Toast('Sent: ' + (ROLE_USERNAME[role] || 'Viewer') + ' comment');
});

/* ── Gift ──────────────────────────────────────────────────────────────── */
const giftList = document.getElementById('giftList');
let gifts = [];
let selectedGift = null;

function RenderGifts(filter) {
	const q = String(filter || '').toLowerCase();
	const rows = gifts.filter(g => !q || String(g.name || '').toLowerCase().indexOf(q) !== -1);
	giftList.innerHTML = '';
	if (!rows.length) {
		const empty = document.createElement('div');
		empty.className = 'sim-empty';
		empty.textContent = gifts.length ? 'No gift matches.' : 'Loading gifts...';
		giftList.appendChild(empty);
		return;
	}
	// Batasi render supaya daftar besar (689 gift) tetap ringan.
	rows.slice(0, 80).forEach(g => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'sim-gift' + (selectedGift && String(selectedGift.id) === String(g.id) ? ' is-selected' : '');
		const img = document.createElement('img');
		img.src = g.icon || '';
		img.alt = '';
		img.loading = 'lazy';
		img.onerror = () => { img.style.visibility = 'hidden'; };
		const name = document.createElement('span');
		name.className = 'sim-gift-name';
		name.textContent = g.name || '(unnamed)';
		const coins = document.createElement('span');
		coins.className = 'sim-gift-coins';
		coins.textContent = (g.coins != null ? g.coins : '') + '';
		b.appendChild(img);
		b.appendChild(name);
		b.appendChild(coins);
		b.addEventListener('click', () => {
			selectedGift = g;
			giftSearchEl.value = g.name || '';
			UpdateGiftClear();
			RenderGifts(g.name);
		});
		giftList.appendChild(b);
	});
}

const giftSearchEl = document.getElementById('giftSearch');
const giftClearEl = document.getElementById('giftClear');

/* Ikon close hanya tampil saat kolom ada isinya. */
function UpdateGiftClear() {
	const wrap = giftSearchEl.closest('.sim-search');
	if (wrap) wrap.classList.toggle('has-text', giftSearchEl.value.length > 0);
}

giftSearchEl.addEventListener('input', (e) => {
	RenderGifts(e.target.value);
	UpdateGiftClear();
});

/* Ikon close: kosongkan pencarian + batalkan pilihan gift. */
giftClearEl.addEventListener('click', () => {
	giftSearchEl.value = '';
	selectedGift = null;
	RenderGifts('');
	UpdateGiftClear();
	giftSearchEl.focus();
});

document.getElementById('sendGift').addEventListener('click', () => {
	if (!selectedGift) { Toast('Pick a gift first', true); return; }
	const combo = Math.max(1, parseInt(document.getElementById('giftCombo').value, 10) || 1);
	Send('gift', Object.assign(BaseUser(), {
		giftId: String(selectedGift.id),
		giftName: selectedGift.name || 'a gift',
		giftPictureUrl: selectedGift.icon || '',
		diamondCount: Number(selectedGift.coins) || 1,
		repeatCount: combo,
		giftType: 0,
		repeatEnd: true
	}));
	Toast('Sent: ' + (selectedGift.name || 'gift') + ' x' + combo);
});

/* Daftar gift bersama (dipakai semua widget). */
fetch(new URL('../gifts/gifts.json', location.href).href)
	.then(r => r.json())
	.then(doc => {
		gifts = Array.isArray(doc) ? doc : (doc.gifts || []);
		RenderGifts('');
	})
	.catch(() => {
		giftList.innerHTML = '<div class="sim-empty">Could not load gifts.json</div>';
	});

/* ── Super Fans ────────────────────────────────────────────────────────── */
document.querySelectorAll('[data-fan]').forEach(btn => {
	btn.addEventListener('click', () => {
		const kind = btn.dataset.fan;
		const data = BaseUser();
		if (kind === 'superFanBox') {
			data.diamondCount = Math.max(1, parseInt(document.getElementById('boxCount').value, 10) || 1);
		}
		Send(kind, data);
		Toast('Sent: ' + (btn.dataset.label || kind));
	});
});
