// Dashboard khusus dock OBS — dynamic-island-alert/dashboard/
// Memuat settings-page-builder dengan ?dashboard=1, sehingga builder:
//   1. TIDAK membuat iframe preview  → hemat CPU/GPU di OBS
//   2. TIDAK menampilkan layar loading → langsung tampil
// Catatan: mode ini TIDAK mengubah cara kerja tombol Reset —
// BroadcastChannel tetap butuh pengirim, yaitu halaman ini.

const dashFrame = document.getElementById('dashFrame');

// Dari dynamic-island-alert/dashboard/ -> .utilities/ ada 2 level atas.
const settingsPageURL = '../../.utilities/settings-page-builder/index.html';

// settings.json sejajar dengan dashboard (folder settings/ sudah dihapus).
const settingsDir = new URL('./', window.location.href).href;

// Widget yang dikendalikan: index.html di root dynamic-island-alert.
const widgetURL = new URL('../index.html', window.location.href).href;

dashFrame.src =
    settingsPageURL +
    '?v=1&settingsJson=' + encodeURIComponent(settingsDir + 'settings.json') +
    '&widgetURL=' + encodeURIComponent(widgetURL) +
    '&dashboard=1';
