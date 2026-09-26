/* Every widget and tool on the site, declared once.
   This feeds the homepage cards, the Docs menu, the search index and each
   widget's own docs page — so adding a widget here is the whole job.

   Paths are relative to the site root; CHROME.root() resolves them.

     tier          'free' | 'freemium' | 'pro'   — 'pro' moves it to the Patreon shelf
     icon          an icones.js.org name, a full URL, or a local file
     thumb         optional; a generated placeholder shows until the file exists
     description   written once, used three times: the homepage card, the docs
                   hero, and the link-preview embed stamped into the docs shim
                   by shared/tools/stamp-meta.mjs */
window.CATALOG = [
  {
    id: 'dynamic-island-alert',
    name: 'Dynamic Island Alert',
    eyebrow: 'ALERTS',
    version: '1.0',
    description: 'Dynamic Island–style alerts for TikTok events (follow, subscribe, share, gift) and first chatter, plus a Now Playing panel for the media that is currently playing.',
    tier: 'free',
    platforms: ['tiktok'],
    accent: '#D4A843',
    icon: 'ph:device-mobile-bold',
    thumb: 'shared/assets/images/thumbs/dynamic-island-alert.png',
    docsUrl: 'dynamic-island-alert/docs/',
    widgetUrl: 'dynamic-island-alert/',
  },
];
