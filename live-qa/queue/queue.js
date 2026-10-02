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

const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const ticketPill = document.getElementById('ticketPill');
const ticketText = document.getElementById('ticketText');
const clearTicketsBtn = document.getElementById('clearTicketsBtn');
const clearBtn = document.getElementById('clearBtn');
const testBtn = document.getElementById('testBtn');
const hideBtn = document.getElementById('hideBtn');
const onairBody = document.getElementById('onairBody');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');
const emptyState = document.getElementById('emptyState');
const prefixHint = document.getElementById('prefixHint');
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
	connected: false,
	ticketCount: 0,
	ticketRequired: false
};

/* The widget only answers while it is alive. With no reply inside
   HELLO_TIMEOUT_MS the page reports the widget as offline. */
let helloAnswered = false;
let helloAnsweredEver = false;

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

function RenderOnAir() {
	onairBody.innerHTML = '';

	const q = state.questions.find(function (x) { return x.id === state.currentId; });
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

function BuildRow(q) {
	const li = document.createElement('li');
	li.className = 'row';
	li.dataset.id = q.id;
	if (q.id === state.currentId) li.classList.add('is-onair');
	if (q.shown) li.classList.add('is-shown');

	// The whole row is clickable: that is the primary action.
	const main = document.createElement('button');
	main.className = 'row-main';
	main.type = 'button';
	main.title = q.id === state.currentId ? 'Already on screen' : 'Show on stream';

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

	if (q.id === state.currentId) {
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

function RenderStatus() {
	if (state.connected) {
		statusPill.className = 'pill pill-on';
		statusText.textContent = 'Bridge online';
	} else if (helloAnsweredEver) {
		statusPill.className = 'pill pill-warn';
		statusText.textContent = 'Bridge offline';
	} else {
		statusPill.className = 'pill pill-off';
		statusText.textContent = 'Widget offline';
	}

	if (state.ticketRequired) {
		ticketPill.style.display = '';
		ticketText.textContent = state.ticketCount + (state.ticketCount === 1 ? ' ticket' : ' tickets');
		clearTicketsBtn.style.display = '';
	} else {
		// With no ticket gift set there are no tickets to show.
		ticketPill.style.display = 'none';
		clearTicketsBtn.style.display = 'none';
	}
}

function Render() {
	RenderStatus();
	RenderOnAir();
	RenderQueue();
}

/* ── Messages from the widget ───────────────────────────────────────────── */

function OnState(next) {
	helloAnswered = true;
	helloAnsweredEver = true;
	state = {
		questions: Array.isArray(next.questions) ? next.questions : [],
		currentId: next.currentId === undefined ? null : next.currentId,
		connected: Boolean(next.connected),
		ticketCount: Number(next.ticketCount) || 0,
		ticketRequired: Boolean(next.ticketRequired)
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

/* Pil Bridge di header: klik membuka pengaturan koneksinya di tab Settings.
   Kartunya sendiri sudah tidak tampil di panel settings. */
statusPill.style.cursor = 'pointer';
statusPill.title = 'Connection to Geseki Bridge — click to open settings';
statusPill.addEventListener('click', function () {
	Send({ type: 'open_settings_popup', group: 'Connection', from: 'queue' });
});

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
ConfirmTwice(clearTicketsBtn, function () { Send({ type: 'qa_clearTickets' }); });

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
			// No reply: report offline, but KEEP the list — the widget may
			// simply be reloading.
			state.connected = false;
			RenderStatus();
		}
	}, HELLO_TIMEOUT_MS);
}, 5000);
