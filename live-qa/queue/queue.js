/* ============================================================================
   Live Q&A — Queue page.
   ----------------------------------------------------------------------------
   The queue of questions that came in from chat. Click a row to put that
   question on screen in OBS, or take the current one back off.

   Two-way traffic over the BroadcastChannel `geseki:live-qa:channel` — the
   same channel the dashboard uses:
     - send    : { type:'qa_hello' } then qa_show / qa_hide / qa_remove / qa_clear
     - receive : { type:'qa_state', questions:[...], currentId, connected, ... }

   If no widget answers (it is not open in OBS yet) the page still works: it
   reports "widget offline" and the buttons simply send into the void.
   ========================================================================== */

const WIDGET_NS = 'geseki:live-qa:';
const CHANNEL_NAME = WIDGET_NS + 'channel';
/* How long to wait for a qa_state reply before calling it disconnected. */
const HELLO_TIMEOUT_MS = 1500;
/* Baris antrean per halaman. */
const PAGE_SIZE = 5;

const clearBtn = document.getElementById('clearBtn');
const testBtn = document.getElementById('testBtn');
const hideBtn = document.getElementById('hideBtn');
const prevOnairBtn = document.getElementById('prevOnairBtn');
const nextOnairBtn = document.getElementById('nextOnairBtn');
const onairBody = document.getElementById('onairBody');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');
const emptyState = document.getElementById('emptyState');
const prefixHint = document.getElementById('prefixHint');
const sceneTag = document.getElementById('sceneTag');
const pager = document.getElementById('pager');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageLabel = document.getElementById('pageLabel');

/* Halaman antrean yang sedang dilihat (berbasis 1). Disimpan sebagai POSISI
   pertanyaan, bukan nomor halaman yang dikunci: saat pertanyaan muncul atau
   hilang, daftar tidak melompat ke halaman lain. */
let queuePage = 1;

/* Last state reported by the widget. */
let state = {
	questions: [],
	currentId: null,
	currentQuestion: null,
	connected: false,
	ticketCount: 0,
	ticketRequired: false,
	/* Scene OBS yang antreannya sedang ditampilkan. Widget yang aktif
	   menyiarkannya, jadi halaman ini selalu mengikuti scene yang tayang. */
	scene: '',
	prefix: ''
};

/* Semua source aktif bersamaan: chat dari scene mana pun bisa datang. Hanya
   state dari scene yang SEDANG TAYANG yang boleh menampilkan; kalau tidak ada
   satu pun yang melaporkan aktif (mis. dibuka di browser biasa), state apa pun
   diterima supaya halaman tetap bisa dipakai. */
let sawActiveScene = false;

/* The widget only answers while it is alive. With no reply inside
   HELLO_TIMEOUT_MS the page reports the widget as offline. */
let helloAnswered = false;
let helloAnsweredEver = false;

/* Halaman ini mengikuti scene OBS yang SEDANG TAYANG. Semua source aktif
   bersamaan (masing-masing mengisi antrean scene-nya), jadi tiap qa_state
   membawa nama scene + penanda `active`; hanya state dari scene yang sedang
   tayang yang ditampilkan di sini. Tiap scene punya antrean sendiri. */

const bc = window.BroadcastChannel ? new BroadcastChannel(CHANNEL_NAME) : null;

function Send(msg) {
	if (!bc) return;
	try { bc.postMessage(msg); } catch (e) { /* ignore */ }
}

/* ── Render ─────────────────────────────────────────────────────────────── */

function FormatTime(ms) {
	try {
		return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	} catch (e) {
		return '';
	}
}

function BuildAvatar(q) {
	const img = document.createElement('img');
	img.className = 'avatar';
	img.alt = '';
	img.src = q.avatar || '';
	img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
	return img;
}

/* Nama scene OBS yang sedang tayang. Ditampilkan supaya jelas antrean milik
   scene mana — tiap scene punya antrean sendiri. */
function RenderScene() {
	if (!sceneTag) return;
	const s = state.scene || '';
	if (!s) { sceneTag.hidden = true; sceneTag.textContent = ''; return; }
	sceneTag.hidden = false;
	sceneTag.innerHTML = '';
	const ic = document.createElement('i');
	ic.className = 'ri-focus-3-line';
	ic.setAttribute('aria-hidden', 'true');
	const tx = document.createElement('span');
	tx.textContent = s;
	sceneTag.appendChild(ic);
	sceneTag.appendChild(tx);
}

function RenderOnAir() {
	onairBody.innerHTML = '';

	// On screen milik scene ini: selalu ada di daftar scene ini juga.
	const q = state.currentQuestion || state.questions.find(function (x) { return x.id === state.currentId; }) || null;
	if (!q) {
		const none = document.createElement('p');
		none.className = 'onair-none';
		none.textContent = 'Nothing on screen.';
		onairBody.appendChild(none);
		hideBtn.disabled = true;
		return;
	}

	const card = document.createElement('div');
	card.className = 'onair-card';
	card.appendChild(BuildAvatar(q));

	const body = document.createElement('div');
	body.className = 'onair-text';
	const name = document.createElement('span');
	name.className = 'name';
	name.textContent = q.name;
	const text = document.createElement('span');
	text.className = 'text';
	text.textContent = q.text;
	body.appendChild(name);
	body.appendChild(text);
	card.appendChild(body);

	onairBody.appendChild(card);
	hideBtn.disabled = false;
}

/* Posisi pertanyaan yang sedang On screen di dalam antrean (-1 = tidak ada). */
function OnairIndex() {
	return state.questions.findIndex(function (q) { return q.id === state.currentId; });
}

/* Pindah satu langkah di antrean lalu tampilkan. Saat belum ada yang On screen,
   Next mulai dari yang pertama dan Previous dari yang terakhir. Tidak memutar
   (wrap): di ujung, tombolnya nonaktif. */
function StepOnair(delta) {
	const n = state.questions.length;
	if (!n) return;
	const i = OnairIndex();
	let target;
	if (i < 0) target = delta > 0 ? 0 : n - 1;
	else {
		target = i + delta;
		if (target < 0 || target >= n) return;
	}
	Send({ type: 'qa_show', id: state.questions[target].id });
}

/* Aktif/nonaktif tombol navigasi sesuai posisi On screen. */
function RenderOnairNav() {
	const n = state.questions.length;
	const i = OnairIndex();
	if (i < 0) {
		prevOnairBtn.disabled = n === 0;
		nextOnairBtn.disabled = n === 0;
	} else {
		prevOnairBtn.disabled = i <= 0;
		nextOnairBtn.disabled = i >= n - 1;
	}
}

function BuildRow(q) {
	const isOnAir = q.id === state.currentId;

	const li = document.createElement('li');
	li.className = 'row';
	li.dataset.id = q.id;
	if (isOnAir) li.classList.add('is-onair');
	if (q.shown) li.classList.add('is-shown');

	// The whole row is clickable: that is the primary action.
	const main = document.createElement('button');
	main.className = 'row-main';
	main.type = 'button';
	main.title = isOnAir ? 'Already on screen' : 'Show on stream';

	main.appendChild(BuildAvatar(q));

	const body = document.createElement('div');
	body.className = 'row-body';

	const top = document.createElement('div');
	top.className = 'row-top';
	const name = document.createElement('span');
	name.className = 'name';
	name.textContent = q.name;
	const time = document.createElement('span');
	time.className = 'time';
	time.textContent = FormatTime(q.at);
	top.appendChild(name);
	top.appendChild(time);

	const text = document.createElement('span');
	text.className = 'text';
	text.textContent = q.text;

	body.appendChild(top);
	body.appendChild(text);
	main.appendChild(body);

	if (isOnAir) {
		const live = document.createElement('span');
		live.className = 'tag tag-live';
		live.textContent = 'LIVE';
		main.appendChild(live);
	} else if (q.shown) {
		const done = document.createElement('span');
		done.className = 'tag';
		done.textContent = 'shown';
		main.appendChild(done);
	}

	main.addEventListener('click', function () {
		Send({ type: 'qa_show', id: q.id });
	});

	// Delete is a secondary action: small, and only revealed on hover.
	const del = document.createElement('button');
	del.className = 'row-del';
	del.type = 'button';
	del.title = 'Remove from queue';
	del.innerHTML = '<i class="ri-close-line" aria-hidden="true"></i>';
	del.addEventListener('click', function (ev) {
		ev.stopPropagation();
		Send({ type: 'qa_remove', id: q.id });
	});

	li.appendChild(main);
	li.appendChild(del);
	return li;
}

function RenderQueue() {
	queueList.innerHTML = '';

	const total = state.questions.length;
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	// Halaman bisa jadi tidak ada lagi setelah antrean menyusut.
	if (queuePage > pageCount) queuePage = pageCount;
	if (queuePage < 1) queuePage = 1;

	const start = (queuePage - 1) * PAGE_SIZE;
	state.questions.slice(start, start + PAGE_SIZE).forEach(function (q) {
		queueList.appendChild(BuildRow(q));
	});

	queueCount.textContent = String(total);
	emptyState.style.display = total ? 'none' : 'flex';

	pager.hidden = pageCount <= 1;
	pageLabel.textContent = queuePage + ' / ' + pageCount;
	prevPageBtn.disabled = queuePage <= 1;
	nextPageBtn.disabled = queuePage >= pageCount;
}

/* Bridge status and the ticket counter are no longer shown here; this page
   only draws the on-screen question and the queue itself. */
function Render() {
	RenderScene();
	RenderOnAir();
	RenderOnairNav();
	RenderQueue();
	// Prefix ikut scene: scene lain bisa memakai prefix berbeda.
	if (state.prefix) prefixHint.textContent = state.prefix;
}

/* ── Messages from the widget ───────────────────────────────────────────── */

function OnState(next) {
	helloAnswered = true;
	helloAnsweredEver = true;
	// Abaikan state dari scene yang TIDAK sedang tayang (semua source aktif),
	// supaya daftar tidak bergantian saat chat masuk dari scene lain.
	if (!next.active && sawActiveScene) return;
	if (next.active) sawActiveScene = true;
	state = {
		questions: Array.isArray(next.questions) ? next.questions : [],
		currentId: next.currentId === undefined ? null : next.currentId,
		currentQuestion: next.currentQuestion || null,
		connected: Boolean(next.connected),
		ticketCount: Number(next.ticketCount) || 0,
		ticketRequired: Boolean(next.ticketRequired),
		scene: next.scene || '',
		prefix: next.prefix || ''
	};
	Render();
}

if (bc) {
	bc.onmessage = function (ev) {
		const d = ev.data || {};
		if (d.type === 'qa_state') OnState(d);
	};
}

/* ── Actions ────────────────────────────────────────────────────────────── */

hideBtn.addEventListener('click', function () { Send({ type: 'qa_hide' }); });
prevOnairBtn.addEventListener('click', function () { StepOnair(-1); });
nextOnairBtn.addEventListener('click', function () { StepOnair(1); });

/* Two-click confirmation, NOT window.confirm: the native modal dialog is not
   reliable inside the OBS CEF dock and can freeze the page. The first click
   turns the button into "Sure?", the second within 3s runs the action. */
function ConfirmTwice(btn, action) {
	const original = btn.innerHTML;
	let armed = false;
	let timer = null;

	btn.addEventListener('click', function () {
		if (!armed) {
			armed = true;
			btn.classList.add('is-armed');
			btn.innerHTML = '<i class="ri-alert-line" aria-hidden="true"></i><span>Sure?</span>';
			timer = setTimeout(function () {
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

ConfirmTwice(clearBtn, function () { Send({ type: 'qa_clear' }); });

/* Sample question: handy for testing the flow without a real chat. */
testBtn.addEventListener('click', function () { Send({ type: 'qa_test' }); });

/* Pager. Setelah pindah halaman, RenderQueue() menggambar ulang daftarnya. */
prevPageBtn.addEventListener('click', function () {
	queuePage -= 1;
	RenderQueue();
});

nextPageBtn.addEventListener('click', function () {
	queuePage += 1;
	RenderQueue();
});

/* ── Init ───────────────────────────────────────────────────────────────── */

/* The prefix can arrive as ?prefix=!q so this page can show the same hint the
   widget does. */
const prefixFromURL = new URLSearchParams(location.search).get('prefix');
if (prefixFromURL) prefixHint.textContent = prefixFromURL;

Render();

/* Ask for the current state. A live widget replies with qa_state at once. */
Send({ type: 'qa_hello' });

/* Repeat the hello: if the widget opens AFTER this page, it has no way of
   knowing this page exists. Periodic hellos let the two meet without a
   reload on either side. */
setInterval(function () {
	helloAnswered = false;
	Send({ type: 'qa_hello' });
	setTimeout(function () {
		if (!helloAnswered) {
			// No reply: mark offline, but KEEP the list — the widget may
			// simply be reloading.
			state.connected = false;
		}
	}, HELLO_TIMEOUT_MS);
}, 5000);
