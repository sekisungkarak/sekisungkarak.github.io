# Dynamic Island Alert

Alert bergaya Dynamic Island untuk event TikTok — **follow**, **subscribe**, **share**,
**gift** — dan **first chatter**, plus panel **Now Playing** dari media yang sedang
diputar. Widget berupa HTML/CSS/JS polos: tanpa build step, tanpa framework.

## Fitur

- **Antrean alert** dengan flag lock, sehingga animasi tidak tumpang-tindih.
- **Rotasi ambient** — panel info (jam, tanggal, Now Playing, cuaca) berputar terus,
  dan tetap mengikuti rotasi walau sempat terpotong antrean alert.
- **Badge penonton** di kanan username (maksimal 2, 16px).
- **Ikon per event** — tiap jenis event TikTok bisa dinyalakan/dimatikan ikonnya.
- **Ukuran username** dibatasi 15 graphemes agar island tidak melebar.
- **Gaya visual** — Liquid Glass dan Solid Black, dengan warna aksen yang bisa diatur.

## Sumber event

- Event TikTok via websocket **TikFinity** (`ws://localhost:21213/`) dan
  **IndoFinity** (`ws://localhost:62024/`) — reconnect tiap 5 detik.
- Event **Streamer.Bot** via `@streamerbot/client` (host/port dari URL param).
- **Now Playing** via SMTC bridge (https://github.com/nuttylmao/smtc-bridge).

## 1. Buka dashboard

```
https://sekisungkarak.github.io/dynamic-island-alert/dashboard/index.html
```

Dashboard adalah satu-satunya halaman kontrol — untuk browser biasa maupun dock OBS.
Jadikan **dock OBS** lewat *View → Docks → Custom Browser Docks*.

## 2. Pasang widget di OBS

Isi **OBS Connection** (Server IP / Port / Password) bila beda dari default
`127.0.0.1:4455`. Lalu klik **Save** — source otomatis dibuat atau diperbarui di scene
aktif OBS lewat obs-websocket.

| Tombol | Fungsi |
| --- | --- |
| **Save** | Simpan settings, lalu buat/perbarui browser source di scene aktif |
| **Load** | Muat settings tersimpan per scene |
| **Reset** | Kembalikan ke default (koneksi OBS tidak ikut tereset) |

> [!TIP]
> Kalau ingin memasang manual, arahkan Browser Source OBS ke URL widget di bawah dan
> atur ukurannya `1080 × 500`.

## 3. URL Browser Source

```
https://sekisungkarak.github.io/dynamic-island-alert/
```

Tiap param punya default, jadi widget tetap jalan walau dibuka tanpa param.

## Pengembangan lokal

Halaman bisa dibuka langsung dari berkas, tetapi beberapa fitur butuh HTTP:

```bash
python -m http.server 3000
```

Lalu buka `http://127.0.0.1:3000/dynamic-island-alert/dashboard/index.html`.

> [!WARNING]
> Pages disajikan lewat HTTPS, sementara TikFinity, IndoFinity, Streamer.Bot, dan SMTC
> bridge berjalan di `localhost` mesin streaming. Koneksi ke `ws://localhost` dari
> halaman HTTPS bisa diblokir browser. Bila websocket gagal tersambung, jalankan widget
> lewat server HTTP lokal dan arahkan Browser Source OBS ke
> `http://127.0.0.1:3000/dynamic-island-alert/`.

## Catatan teknis

- **Koneksi lokal tetap di mesin sendiri** — halaman yang di-deploy di Pages menghubungi
  layanan `localhost` lewat browser, jadi layanan harus hidup di komputer yang sama
  dengan yang membuka widget. Ini bukan koneksi server-ke-server.
- **Settings tersimpan di localStorage** — kunci utama `<widget>-settings`, dan
  `geseki-scene-<nama scene>` untuk profil per scene. Settings menempel pada browser dan
  origin tertentu: pindah dari `127.0.0.1:3000` ke Pages berarti pengaturan tidak ikut
  pindah.
- **Reset via BroadcastChannel** — kanal `geseki_island_channel` menjangkau widget di OBS
  sungguhan. Halaman dashboard harus hidup (di-dock atau terbuka) sebagai pengirim, dan
  harus satu origin + satu browser profile dengan widget.
- **Suara notifikasi** — checkbox *Notification Sound* per overlay (default aktif).
  Matikan di overlay yang tidak perlu berbunyi supaya suara tidak dobel saat widget
  dipasang di beberapa scene.
