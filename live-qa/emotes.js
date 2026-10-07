/* ============================================================================
   Renderer emote bersama untuk Live Q&A.

   Dipakai oleh tiga tampilan supaya emote terlihat SAMA di mana-mana:
     - overlay pertanyaan   (live-qa/script.js)
     - kartu "On screen"    (live-qa/queue/queue.js)
     - daftar antrean       (live-qa/queue/queue.js)

   Dua sumber emote di komentar:
     1. Shortcode yang DIKETIK viewer, mis. "[laugh]" -> PNG di
        resources/emotes/ (atau emoji, bila nilainya bukan nama berkas .png).
     2. Emote bawaan TikTok yang dikirim PAYLOAD. Ini yang dipakai emote khusus
        subscriber/fan club: tidak punya shortcode, jadi hanya bisa dirender
        dari payload. Tiap emote menempati satu karakter placeholder di dalam
        komentar (placeInComment, 0-based).

   Teks chat datang dari pemirsa, jadi dianggap tidak tepercaya: setiap
   potongan teks di-escape sebelum masuk innerHTML.
   ========================================================================== */

/* Akar folder widget, dihitung dari src file ini sendiri, supaya URL emote
   tetap benar dari halaman mana pun yang memuatnya (index.html, obs/index.html,
   atau queue/index.html). */
const EMOTE_SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
const EMOTE_WIDGET_ROOT = EMOTE_SCRIPT_SRC
	? EMOTE_SCRIPT_SRC.replace(/[^/]*$/, '')
	: new URL('./', window.location.href).href;
const EMOTE_BASE = new URL('../resources/emotes/', EMOTE_WIDGET_ROOT).href;

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

function EscapeBadgeText(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	}[c]));
}

/* Terima URL gambar dari payload, buang bungkus `@url:`...``, dan tolak URL
   yang tidak aman (bisa keluar dari atribut src saat disuntik via innerHTML). */
function CleanBadgeUrl(raw) {
	if (!raw || typeof raw !== 'string') return '';
	let s = raw.trim();
	const m = s.match(/^@url:`([^`]+)`$/);
	if (m) s = m[1];
	else if (s.startsWith('@url:')) s = s.slice(4).replace(/^`|`$/g, '');
	if (!/^https?:\/\//i.test(s) && !s.startsWith('data:')) return '';
	if (/["'<>\s]/.test(s)) return '';
	return s;
}

function EmoteImageUrl(emote) {
	const raw = emote.emoteImageUrl || emote.emoteUrl || emote.imageUrl || emote.url || '';
	return CleanBadgeUrl(raw);
}

/* Karakter TAK TERLIHAT yang bisa merusak bentuk tampilan. Teks datang dari
   pemirsa, jadi harus dianggap tidak tepercaya:
     - kontrol C0/C1 (termasuk baris baru & tab) -> memecah tata letak
     - zero-width (U+200B, U+2060, U+FEFF)      -> teks tampak kosong
     - bidi (U+200E/200F, U+202A-202E, U+2066-2069) -> MEMBALIK arah seluruh
       teks, sehingga isi kartu kacau tanpa terlihat sebabnya
     - U+00AD (soft hyphen) dan U+180E
   ZWJ (U+200D) dan ZWNJ (U+200C) SENGAJA tidak dibuang: keduanya bagian sah
   dari emoji majemuk dan penulisan beberapa bahasa. */
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

// Segmen teks biasa tetap bisa memuat shortcode yang DIKETIK, mis. "[laugh]".
// Setiap potongan di-escape; hanya shortcode yang dikenal yang jadi <img>.
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

// Emote dari payload membawa `emoteImageUrl` + `placeInComment`: SATU emote
// menggantikan SATU karakter placeholder di dalam komentar. Karena itu
// penyisipan harus memakai indeks itu, bukan rentang start/end.
function RenderChatMessageHtml(rawMessage, emotes) {
	const text = String(rawMessage == null ? '' : rawMessage);
	const list = Array.isArray(emotes) ? emotes.filter(Boolean).slice() : [];
	if (list.length === 0) return RenderChatTextHtml(text);

	list.sort((a, b) => (Number(a.placeInComment) || 0) - (Number(b.placeInComment) || 0));

	let html = '';
	let cursor = 0;
	for (const emote of list) {
		const at = Number(emote.placeInComment);
		// Indeks tidak sah, sudah dilewati emote sebelumnya, atau placeholder-nya
		// berada di luar teks -> lewati. Tanpa cek terakhir, emote yang seharusnya
		// terbuang tetap tersisip di ujung pesan.
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

/* ── Helper khusus Live Q&A ─────────────────────────────────────────────── */

/* Live Q&A membuang prefix pertanyaan (mis. "!q") dari komentar SEBELUM
   menyimpan teks, sedangkan placeInComment menunjuk indeks di komentar ASLI.
   Fungsi ini menggeser indeks ke teks yang sudah dipotong prefix, dan membuang
   emote yang jatuh di luar teks (mis. placeholder-nya ikut terpotong). */
function GesekiRebaseEmotes(emotes, startOffset, text) {
	const out = [];
	if (!Array.isArray(emotes)) return out;
	const len = String(text == null ? '' : text).length;
	for (const e of emotes) {
		if (!e || typeof e !== 'object') continue;
		const at = Number(e.placeInComment);
		if (!isFinite(at)) continue;
		const shifted = at - startOffset;
		if (shifted < 0 || shifted >= len) continue;
		out.push({
			emoteId: e.emoteId,
			emoteImageUrl: e.emoteImageUrl,
			placeInComment: shifted,
			emoteType: e.emoteType,
			emotePrivateType: e.emotePrivateType
		});
	}
	return out;
}

/* Teks pertanyaan untuk CSV / tooltip: placeholder emote dibuang (satu
   placeholder = satu emote), lalu sisa teks dibersihkan dari karakter tak
   terlihat supaya kolom Question bersih. */
function GesekiCsvText(raw, emotes) {
	const src = String(raw == null ? '' : raw);
	const drop = new Set();
	if (Array.isArray(emotes)) {
		for (const e of emotes) {
			if (!e || typeof e !== 'object') continue;
			const at = Number(e.placeInComment);
			if (isFinite(at) && at >= 0 && at < src.length) drop.add(at);
		}
	}
	let kept = '';
	for (let i = 0; i < src.length; i++) {
		if (drop.has(i)) continue;
		kept += src[i];
	}
	return SanitizeVisibleText(kept);
}
