/* Setiap widget dan tool di situs ini, dideklarasikan sekali.
   Ini yang mengisi kartu beranda, menu Dokumentasi, indeks pencarian, dan
   halaman docs tiap widget — jadi menambah widget cukup di sini.

   Path relatif terhadap root situs; CHROME.root() yang menyelesaikannya.

     tier          'free' | 'freemium' | 'pro'   — 'pro' pindah ke rak Patreon
     icon          nama icones.js.org, URL penuh, atau file lokal
     thumb         opsional; placeholder dibuat otomatis sampai file ada
     description   ditulis sekali, dipakai tiga kali: kartu beranda, hero docs,
                   dan embed pratinjau tautan yang distempel ke shim docs oleh
                   shared/tools/stamp-meta.mjs */
window.CATALOG = [
  {
    id: 'dynamic-island-alert',
    name: 'Dynamic Island Alert',
    eyebrow: 'ALERTS',
    version: '1.0',
    description: 'Alert bergaya Dynamic Island untuk event TikTok (follow, subscribe, share, gift) dan first chatter, plus panel Now Playing dari media yang sedang diputar.',
    tier: 'free',
    platforms: ['tiktok'],
    accent: '#8A2BE2',
    icon: 'ph:device-mobile-bold',
    docsUrl: 'dynamic-island-alert/docs/',
    widgetUrl: 'dynamic-island-alert/',
    settingsUrl: 'dynamic-island-alert/dashboard/',
  },
];
