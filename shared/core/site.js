/* Site-wide chrome config. Every page reads this — change it here, not per page.
   Paths are relative to the site root; CHROME.root() resolves them, so nothing
   here is tied to how deep the page lives. */
window.SITE = {
  brand: 'Sekisungkarak',
  logo: 'shared/assets/images/avatar.png',

  // Wide 1200x630 card used for link previews (og:image).
  ogImage: 'shared/assets/images/og-banner.png',

  // `soon: true` renders the label with a "Coming Soon" tooltip and no link.
  // `menu: 'catalog'` renders a dropdown built from catalog.js.
  // The lit tab is worked out from the URL, never set here.
  nav: [
    { label: 'Widgets', href: '#widgets' },
    { label: 'Contact Me', contact: true },
    { label: 'Docs', menu: 'catalog' },
  ],

  links: [
    { label: 'GitHub', href: 'https://github.com/sekisungkarak', icon: 'github' },
  ],

  // Hero support buttons on the homepage. `icon` is a MARK key from chrome.js.
  // Leave empty to hide them.
  support: [],

  // Footer marks.
  socials: [
    { label: 'TikTok', href: 'https://tiktok.com/@sekisungkarak', icon: 'tiktok' },
    { label: 'GitHub', href: 'https://github.com/sekisungkarak', icon: 'github' },
  ],

  // Powers the Contact Me panel in the header and the Discord footer icon.
  // Leave null to hide both. This is the one place the invite link lives.
  discord: 'https://discord.gg/c5vDMWYhSt',

  // "Edit on GitHub" is hidden entirely while repo is null.
  repo: 'sekisungkarak/sekisungkarak.github.io',
  branch: 'master',

  // Where this build is served from. Link-preview crawlers can't resolve relative
  // URLs, so stamp-meta.mjs builds absolute og: URLs from this.
  origin: 'https://sekisungkarak.github.io',
};
