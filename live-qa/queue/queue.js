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

/* Nama widget (folder) untuk awalan nama berkas Export: halaman ini berada
   di <widget>/queue/, jadi segmen sebelum 'queue' adalah nama widgetnya. */
const WIDGET_NAME = (function () {
	var segs = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
	if (segs.length && segs[segs.length - 1].indexOf('.') !== -1) segs.pop();
	if (segs.length && segs[segs.length - 1] === 'queue') segs.pop();
	return segs[segs.length - 1] || 'widget';
})();

const WIDGET_NS = 'geseki:live-qa:';
const CHANNEL_NAME = WIDGET_NS + 'channel';
/* How long to wait for a qa_state reply before calling it disconnected. */
const HELLO_TIMEOUT_MS = 1500;
/* Baris antrean per halaman. */
const PAGE_SIZE = 5;
/* Export hanya memuat 7 HARI TERAKHIR, sama dengan retensi arsip di widget.
   Ditegakkan lagi di sini supaya CSV tetap benar walau source OBS dibiarkan
   hidup lebih dari sepekan tanpa reload. */
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/* Auto export per sesi live: nilai disimpan di localStorage (dibagi dengan
   widget, origin sama) dan disiarkan ke widget lewat BroadcastChannel. */
const AUTOEXPORT_KEY = WIDGET_NS + 'autoexport';

function LoadAutoExport() {
	try { return localStorage.getItem(AUTOEXPORT_KEY) === '1'; }
	catch (e) { return false; }
}

function SetAutoExport(on) {
	try { localStorage.setItem(AUTOEXPORT_KEY, on ? '1' : '0'); } catch (e) { /* abaikan */ }
	Send({ type: 'qa_set_autoexport', enabled: !!on });
}

const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const testBtn = document.getElementById('testBtn');
const hideBtn = document.getElementById('hideBtn');
const prevOnairBtn = document.getElementById('prevOnairBtn');
const nextOnairBtn = document.getElementById('nextOnairBtn');
const onairBody = document.getElementById('onairBody');
const onairSection = document.getElementById('onairSection');
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
	/* Arsip lengkap dari widget (semua pertanyaan pernah masuk) — sumber Export CSV. */
	history: [],
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
	// Status "On screen" hijau hanya saat benar-benar ada pertanyaan tayang.
	if (onairSection) onairSection.classList.toggle('is-live', !!q);
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
	// innerHTML: teks di-escape di dalam renderer, emote jadi <img class="emote">.
	text.innerHTML = RenderChatMessageHtml(q.text, q.emotes);
	text.title = GesekiCsvText(q.text, q.emotes);
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
   (wrap): di ujung, tombolnya nonaktif.
   Daftar Queue ikut melompat ke halaman tempat pertanyaan tujuan berada, supaya
   barisnya langsung terlihat (bukan tetap di halaman yang sedang dibuka). */
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
	// Lompat ke halaman yang memuat baris tujuan (index berbasis 0 -> halaman 1).
	queuePage = Math.floor(target / PAGE_SIZE) + 1;
	RenderQueue();
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
	// innerHTML: teks di-escape di dalam renderer, emote jadi <img class="emote">.
	text.innerHTML = RenderChatMessageHtml(q.text, q.emotes);
	text.title = GesekiCsvText(q.text, q.emotes);

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
		history: Array.isArray(next.history) ? next.history : [],
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

/* ── Export CSV ─────────────────────────────────────────────────────────────
   Semua pertanyaan (arsip widget + antrean berjalan) dijadikan satu CSV.

   Kenapa ada kotak teks, bukan cuma unduhan: OBS memakai CEF tanpa UI unduhan
   (obs-browser tidak punya download handler), jadi tidak ada dialog "Save As"
   dan klik Export bisa terlihat seperti tidak terjadi apa-apa — padahal file
   kadang tersimpan diam-diam di folder Downloads, kadang dibuang. Karena itu
   teksnya SELALU ditampilkan di kotak yang bisa dipilih (tombol Copy atau
   Ctrl+C), dan tombol "Save file" tetap mencoba unduhan biasa di browser. */

function CsvCell(v) {
	const s = (v === null || v === undefined) ? '' : String(v);
	// Kutip bila mengandung koma, kutip, atau baris baru (aturan CSV).
	return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function FormatDateTime(ms) {
	try { return new Date(ms).toLocaleString(); } catch (e) { return ''; }
}

/* Pertanyaan sample tidak ikut Export: dikenali dari penanda `sample` atau
   dari avatar sample (menangkap sample lama yang belum ber-penanda). */
function IsSample(q) {
	if (!q) return false;
	if (q.sample === true) return true;
	return /sekisungkarak_avatar\.jpe?g/i.test(String(q.avatar || ''));
}

function BuildCsv() {
	// Gabung arsip + antrean berjalan, buang duplikat berdasarkan id, urut waktu.
	// Pertanyaan sample (tombol Sample) tidak ikut CSV: hanya untuk menguji
	// tampilan, bukan chat sungguhan. Disaring dari ANTREAN maupun ARSIP,
	// dan tetap tertangkap walau sample itu tersimpan sebelum ada penanda.
	const byId = new Map();
	(state.history || []).forEach(function (q) { if (q && q.id && !IsSample(q)) byId.set(q.id, q); });
	(state.questions || []).forEach(function (q) { if (q && q.id && !IsSample(q) && !byId.has(q.id)) byId.set(q.id, q); });
	const cutoff = Date.now() - HISTORY_RETENTION_MS;
	const rows = Array.from(byId.values())
		.filter(function (q) { return typeof q.at !== 'number' || q.at >= cutoff; })
		.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });

	const lines = ['Time,Name,Question,Status'];
	rows.forEach(function (q) {
		const status = q.id === state.currentId ? 'on screen' : (q.shown ? 'shown' : 'queued');
		lines.push([
			CsvCell(FormatDateTime(q.at)),
			CsvCell(q.name),
			CsvCell(GesekiCsvText(q.text, q.emotes)),
			CsvCell(status)
		].join(','));
	});
	// BOM supaya Excel membaca UTF-8 dengan benar.
	return '\uFEFF' + lines.join('\r\n');
}

/* Simpan lewat bridge supaya berkas benar-benar sampai ke folder Downloads.
   Di dalam OBS, obs-browser tidak punya CEF download handler, jadi <a download>
   dengan blob dibatalkan diam-diam. Bridge (plugin) yang menulis berkasnya.
   Mengembalikan path lengkap kalau berhasil, atau null (bridge tidak jalan). */
async function SaveViaBridge(text, name) {
	try {
		const ctl = new AbortController();
		const t = setTimeout(function () { ctl.abort(); }, 4000);
		const r = await fetch('http://127.0.0.1:47800/save?name=' + encodeURIComponent(name || (WIDGET_NAME + '-questions.csv')), {
			method: 'POST',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: text,
			signal: ctl.signal
		});
		clearTimeout(t);
		if (!r.ok) return null;
		const d = await r.json();
		return (d && d.ok && d.path) ? d.path : null;
	} catch (e) {
		return null;
	}
}

/* Unduhan blob biasa — cadangan saat bridge tidak tersedia (mis. halaman
   dibuka di browser normal). Di dalam OBS ini sering dibatalkan diam-diam. */
function DownloadCsv(text, name) {
	try {
		const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name || (WIDGET_NAME + '-questions.csv');
		a.style.display = 'none';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
		return true;
	} catch (e) {
		return false;
	}
}

/* Export dialog: shows the CSV so it can always be copied by hand, with a
   "Save file" button for a normal browser. Built with DOM APIs (no innerHTML
   for data), so a question containing markup can never break the page. */
let exportDialog = null;

function OnExportKey(e) {
	if (e.key === 'Escape') {
		e.stopPropagation();
		CloseExportDialog();
	}
}

function CloseExportDialog() {
	if (!exportDialog) return;
	if (exportDialog.parentNode) exportDialog.parentNode.removeChild(exportDialog);
	document.removeEventListener('keydown', OnExportKey, true);
	exportDialog = null;
}

/* execCommand('copy') masih dipakai sebagai cadangan: di CEF lama Clipboard
   API bisa tidak tersedia, dan execCommand jalan selama ada gestur klik. */
function LegacyCopy(area) {
	area.focus();
	area.select();
	try { return document.execCommand('copy'); } catch (e) { return false; }
}

function ShowExportDialog(text, name) {
	CloseExportDialog();

	const back = document.createElement('div');
	back.className = 'modal-back';

	const box = document.createElement('div');
	box.className = 'modal';

	const title = document.createElement('div');
	title.className = 'modal-title';
	title.textContent = 'Export questions';

	const msg = document.createElement('div');
	msg.className = 'modal-msg';
	msg.textContent = 'Click Save file to write it into your Downloads folder (through the bridge), or Copy to paste it into Excel.';

	const area = document.createElement('textarea');
	area.className = 'export-text';
	area.readOnly = true;
	area.spellcheck = false;
	area.value = text;

	// Baris auto-export: tulis CSV sendiri tiap sesi live berakhir.
	const autoRow = document.createElement('label');
	autoRow.className = 'export-auto';
	const autoBox = document.createElement('input');
	autoBox.type = 'checkbox';
	autoBox.checked = LoadAutoExport();
	const autoText = document.createElement('span');
	autoText.textContent = 'Auto export a CSV at the end of every live session';
	autoRow.appendChild(autoBox);
	autoRow.appendChild(autoText);
	autoBox.addEventListener('change', function () { SetAutoExport(autoBox.checked); });

	const row = document.createElement('div');
	row.className = 'modal-row';

	const copyBtn = document.createElement('button');
	copyBtn.type = 'button';
	copyBtn.className = 'btn';
	copyBtn.innerHTML = '<i class="ri-file-copy-line" aria-hidden="true"></i><span>Copy</span>';

	const saveBtn = document.createElement('button');
	saveBtn.type = 'button';
	saveBtn.className = 'btn';
	saveBtn.innerHTML = '<i class="ri-download-2-line" aria-hidden="true"></i><span>Save file</span>';

	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'btn';
	closeBtn.textContent = 'Close';

	row.appendChild(copyBtn);
	row.appendChild(saveBtn);
	row.appendChild(closeBtn);
	box.appendChild(title);
	box.appendChild(msg);
	box.appendChild(area);
	box.appendChild(autoRow);
	box.appendChild(row);
	back.appendChild(box);
	document.body.appendChild(back);
	back.classList.add('is-open');

	copyBtn.addEventListener('click', function () {
		area.focus();
		area.select();

		const span = copyBtn.querySelector('span');
		function Mark(ok) {
			if (!span) return;
			span.textContent = ok ? 'Copied' : 'Press Ctrl+C';
			setTimeout(function () { span.textContent = 'Copy'; }, 1800);
		}
		// Clipboard API dulu (butuh izin clipboard-write di iframe), lalu
		// execCommand sebagai cadangan untuk CEF lama.
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(
				function () { Mark(true); },
				function () { Mark(LegacyCopy(area)); }
			);
		} else {
			Mark(LegacyCopy(area));
		}
	});

	saveBtn.addEventListener('click', function () {
		const span = saveBtn.querySelector('span');
		SaveViaBridge(text, name).then(function (path) {
			if (path) {
				msg.textContent = 'Saved to ' + path;
				if (span) { span.textContent = 'Saved'; setTimeout(function () { span.textContent = 'Save file'; }, 2200); }
				return;
			}
			const ok = DownloadCsv(text, name);
			msg.textContent = ok
				? 'Bridge not running \u2014 saved through the browser download instead.'
				: 'Could not save the file \u2014 click Copy and paste it instead.';
		});
	});
	closeBtn.addEventListener('click', CloseExportDialog);
	back.addEventListener('click', function (e) { if (e.target === back) CloseExportDialog(); });
	document.addEventListener('keydown', OnExportKey, true);

	exportDialog = back;
	area.focus();
	area.select();
}

function ExportCsv() {
	const csv = BuildCsv();
	const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
	ShowExportDialog(csv, WIDGET_NAME + '-questions-' + stamp + '.csv');
}

/* ── Actions ────────────────────────────────────────────────────────────── */

if (exportBtn) exportBtn.addEventListener('click', ExportCsv);
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
