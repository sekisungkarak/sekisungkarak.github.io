/* Site language: English (default) and Indonesian.

   The dictionary is keyed by the English source string, so a page only ever
   writes the English copy and asks I18N.t() for it — no key registry to keep
   in sync, and a string with no translation falls through unchanged.

   Switching language reloads the page. Every page is drawn by JS on load, so a
   reload re-renders the whole thing in the new language; there is no live
   re-render to keep bug-free. Load after site.js, before chrome.js. */
window.I18N = (function () {
  'use strict';

  var KEY = 'sk-lang';
  var LANGS = ['en', 'id'];

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return LANGS.indexOf(v) > -1 ? v : null;
    } catch (e) { return null; }
  }

  var lang = stored() || 'en';

  // English → Indonesian. Anything absent here is shown as-is in both.
  var DICT = {
    /* header + nav */
    'Coming Soon': 'Segera Hadir',
    'Every widget on the homepage': 'Semua widget di beranda',
    'Search': 'Cari',
    'Join the Discord': 'Gabung Discord',
    'Switch theme': 'Ganti tema',
    'Switch language': 'Ganti bahasa',
    'Widgets': 'Widget',
    'Docs': 'Dokumentasi',
    'Contact Me': 'Hubungi Saya',
    'Join my Discord': 'Gabung Discord saya',
    'Say hi, ask for help, or share feedback.': 'Sapa saya, minta bantuan, atau kirim masukan.',
    'Discord invite coming soon.': 'Undangan Discord segera hadir.',

    /* homepage */
    'WIDGET OVERLAY': 'WIDGET OVERLAY',
    'Widget Overlay For Your Stream': 'Widget Overlay Untuk Stream Kamu',
    'A collection of overlay widgets for streaming. Loaded as a browser source in OBS — easy to install.':
      'Kumpulan widget overlay untuk streaming. Dimuat sebagai browser source di OBS — mudah dipasang.',
    'Browse widgets': 'Jelajahi widget',
    'Supports': 'Mendukung',
    'Widgets & tools': 'Widget & alat',
    'Patreon-exclusive': 'Eksklusif Patreon',
    'Get PRO': 'Dapatkan PRO',
    'documentation': 'dokumentasi',

    /* 404 */
    '404': '404',
    "That page doesn't exist.": 'Halaman itu tidak ada.',
    "The link may be out of date, or the address slightly off. Everything I've built is below.":
      'Tautannya mungkin sudah usang, atau alamatnya sedikit salah. Semua yang saya buat ada di bawah.',

    /* search */
    'Search widgets and docs': 'Cari widget dan dokumentasi',
    'Nothing matches that.': 'Tidak ada yang cocok.',
    'Loading…': 'Memuat…',
    'docs': 'dokumentasi',
    'widget': 'widget',

    /* docs */
    'Install Guide': 'Panduan Instalasi',
    'Dynamic Island–style alerts for TikTok events (follow, subscribe, share, gift) and first chatter, plus a Now Playing panel for the media that is currently playing.':
      'Alert bergaya Dynamic Island untuk event TikTok (follow, subscribe, share, gift) dan first chatter, plus panel Now Playing untuk media yang sedang diputar.',
    'Updated': 'Diperbarui',
    'ON THIS PAGE': 'DI HALAMAN INI',
    'On this page': 'Di halaman ini',
    'Copy': 'Salin',
    'Copied': 'Tersalin',
    "Couldn't load these docs": 'Gagal memuat dokumentasi ini',
    'Could not read': 'Gagal membaca',
    'If you are opening this from the file system, serve the folder over http instead — fetch does not work on file:// URLs.':
      'Kalau kamu membuka ini dari file system, sajikan foldernya lewat http — fetch tidak bekerja pada URL file://.',
    'Note': 'Catatan',
    'Tip': 'Tips',
    'Important': 'Penting',
    'Warning': 'Peringatan',
    'Caution': 'Perhatian',
    'Streamer.bot import code': 'Kode impor Streamer.bot',
    'PREVIOUS': 'SEBELUMNYA',
    'NEXT': 'BERIKUTNYA',
    'Link to this section': 'Tautan ke bagian ini',
    'Close': 'Tutup'
  };

  // English → English is the identity; only the other language looks up.
  function t(s) {
    if (lang === 'en') return s;
    var d = DICT[s];
    return d === undefined ? s : d;
  }

  function set(next) {
    if (LANGS.indexOf(next) < 0 || next === lang) return;
    try { localStorage.setItem(KEY, next); } catch (e) {}
    location.reload();
  }

  document.documentElement.lang = lang === 'id' ? 'id' : 'en';

  return { lang: lang, langs: LANGS, t: t, set: set, DICT: DICT };
})();
