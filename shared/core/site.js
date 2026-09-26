/* Konfigurasi chrome situs. Semua halaman membacanya — ubah di sini, bukan
   per halaman. Path relatif terhadap root situs; CHROME.root() menyelesaikannya,
   jadi tidak ada yang terikat pada kedalaman halaman. */
window.SITE = {
  brand: 'Geseki',
  logo: 'shared/assets/images/logo.png',

  // `soon: true` menampilkan label dengan tooltip "Segera" tanpa tautan.
  // `menu: 'catalog'` menampilkan dropdown yang dibangun dari catalog.js.
  // Tab yang menyala dihitung dari URL, tidak pernah ditulis di sini.
  nav: [
    { label: 'Widget', href: '#widgets' },
    { label: 'Dokumentasi', menu: 'catalog' },
  ],

  links: [
    { label: 'GitHub', href: 'https://github.com/sekisungkarak', icon: 'github' },
  ],

  // Tombol dukungan di hero beranda. `icon` adalah key MARK dari chrome.js.
  // Kosongkan untuk menyembunyikannya.
  support: [],

  // Ikon di footer.
  socials: [
    { label: 'GitHub', href: 'https://github.com/sekisungkarak', icon: 'github' },
  ],

  // Mengisi tombol "Butuh bantuan?" di header. null = tombol disembunyikan.
  discord: null,

  // "Edit on GitHub" disembunyikan seluruhnya selama repo null.
  repo: 'sekisungkarak/sekisungkarak.github.io',
  branch: 'master',

  // Dari mana build ini disajikan. Crawler pratinjau tautan tidak bisa
  // menyelesaikan URL relatif, jadi stamp-meta.mjs membangun og: URL absolut
  // dari sini.
  origin: 'https://sekisungkarak.github.io',
};
