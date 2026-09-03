# Geseki

Koleksi widget overlay OBS untuk streaming. Widget berupa HTML/CSS/JS polos yang dimuat
sebagai browser source di OBS — tanpa build step, tanpa framework.

## Akses

Widget di-deploy otomatis ke **GitHub Pages** lewat GitHub Actions. Setiap push ke
`master` memicu deploy ulang.

```
https://sekisungkarak.github.io/Geseki/
```

Ganti `<username>` dengan nama akun GitHub pemilik repo. Halaman ini juga bisa dibuka
langsung di browser untuk pratinjau.

> **Catatan:** jalur folder bersifat case-sensitive di GitHub Pages. `resources/`,
> `dynamic-island-alert/`, dan `dashboard/` harus tetap huruf kecil seperti di repo.

## Struktur

```
Geseki/
├── .github/workflows/          # workflow GitHub Actions (deploy Pages)
├── .utilities/
│   └── settings-page-builder/  # builder settings bersama (jangan dibuat ulang)
├── <widget>/                   # satu folder per widget
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   ├── dashboard/              # halaman kontrol (browser biasa + dock OBS)
│   │   ├── index.html
│   │   ├── dashboard.js
│   │   └── settings.json
│   └── obs/                    # varian widget untuk OBS
└── resources/                  # aset bersama, level root (bukan per-widget)
    ├── icons/platforms/        # kick, kofi, obs, patreon, streamerbot, tiktok, twitch, youtube
    ├── icons/badges/
    ├── sfx/notification.mp3
    └── logo/
```

## Widget

### `dynamic-island-alert`

Alert bergaya Dynamic Island untuk event TikTok (follow, subscribe, share, gift) dan
first chatter, plus panel Now Playing dari media yang sedang diputar.

- Event TikTok via websocket **TikFinity** (`ws://localhost:21213/`) dan **IndoFinity**
  (`ws://localhost:62024/`) — reconnect tiap 5 detik.
- Event Streamer.Bot via `@streamerbot/client` (host/port dari URL param).
- Now Playing via SMTC bridge (`http://127.0.0.1:5000/now-playing`) di mesin lokal.
- Antrean alert dengan flag lock, sehingga animasi tidak tumpang-tindih.
- 37 setting dalam 12 grup: koneksi (Streamer.bot, TikTok, SMTC, OBS, Live Detection),
  General, dan konfigurasi tiap jenis alert.


## Cara pakai

### 1. Buka dashboard (Jadikan dock OBS)

```
https://sekisungkarak.github.io/Geseki/dynamic-island-alert/dashboard/index.html
```

Dashboard adalah satu-satunya halaman kontrol — untuk browser biasa maupun dock OBS.

### 2. Pasang widget di OBS

Isi **OBS Connection** (Server IP / Port / Password) bila beda dari default
`127.0.0.1:4455`. Lalu klik **Save** — source otomatis dibuat atau diperbarui di scene
aktif OBS lewat obs-websocket.

- **Load** — memuat settings tersimpan per scene
- **Reset** — mengembalikan ke default (koneksi OBS tidak ikut tereset)


## Pengembangan lokal

Halaman bisa dibuka langsung dari berkas, tetapi beberapa fitur butuh HTTP. Untuk
pengembangan:

```bash
python -m http.server 3000
```

Lalu buka `http://127.0.0.1:3000/dynamic-island-alert/dashboard/index.html`.

## Catatan teknis

- **Koneksi lokal tetap di mesin sendiri** — TikFinity, IndoFinity, Streamer.Bot, dan
  SMTC bridge berjalan di `localhost` mesin streaming. Halaman yang di-deploy di Pages
  menghubungi layanan itu lewat browser, jadi layanan harus hidup di komputer yang sama
  dengan yang membuka widget. Ini bukan koneksi server-ke-server.
- **Mixed content** — Pages disajikan lewat HTTPS. Koneksi ke `ws://localhost` dari
  halaman HTTPS bisa diblokir browser. Bila websocket gagal tersambung, jalankan widget
  lewat server HTTP lokal (lihat "Pengembangan lokal") dan arahkan Browser Source OBS ke
  `http://127.0.0.1:3000/...`.
- **Konfigurasi lewat URL param** — tiap param punya default, jadi widget tetap jalan
  walau dibuka tanpa param.
- **Settings tersimpan di localStorage** — kunci utama `<widget>-settings`, dan
  `geseki-scene-<nama scene>` untuk profil per scene. Settings menempel pada browser dan
  origin tertentu: pindah dari `127.0.0.1:3000` ke Pages berarti pengaturan tidak ikut
  pindah, dan profil harus disimpan ulang.
- **Reset via BroadcastChannel** — kanal `geseki_island_channel` menjangkau widget di OBS
  sungguhan. Halaman dashboard harus hidup (di-dock atau terbuka) sebagai pengirim, dan
  harus satu origin + satu browser profile dengan widget.
- **Transparansi** — browser source OBS itu transparan. Saat dibuka langsung di browser,
  widget mendeteksi tidak adanya `window.obsstudio` lalu memasang latar gelap agar tidak
  silau; di OBS tetap transparan.

