## Kebutuhan

- **OBS Studio 30+** dengan **obs-websocket** bawaan yang aktif.
- **Geseki Bridge** untuk koneksi live TikTok dan Now Playing — [unduh](https://github.com/sekisungkarak/geseki-bridge/releases).

---

## Instalasi

Semua diatur dari dock **Dynamic Island Alert** yang ditambahkan Geseki Bridge
ke OBS. Buka **Docks** di menu bar lalu aktifkan.

![Aktifkan dock Dynamic Island Alert di OBS](docs/assets/enable-dock.png)

Di dock-nya, isi kartu **OBS Connection**: **Server IP** dan **Port** (default
`4455`), plus **Password** kalau kamu memasangnya di **Tools → WebSocket
Server Settings**, lalu tekan **Save**. Menekan Save otomatis menambahkan widget
ke scene yang sedang aktif — overlay langsung muncul di stream, tanpa perlu
menambah sumber Browser sendiri. Titik statusnya berubah hijau begitu widget
tersambung ke OBS.

![Pengaturan OBS Connection di dock](docs/assets/obs-websocket.png)

---

## Kustomisasi

**Controls Panel** terbuka di atas overlay itu sendiri, jadi kamu mengatur
alert sambil melihat hasilnya. Pilih sumbernya, klik **Interact** dan tekan
**S**, atau klik tombol gear kecil yang muncul di pojok kiri atas saat kamu
menggerakkan mouse (tidak pernah ikut terekam di stream). Kamu bisa menyeret
panel lewat bar judulnya untuk memindahkan, dan klik dua kali bar judul untuk
mengembalikannya ke pojok kiri bawah.

![Controls Panel, tab Alerts](docs/assets/install-panel.png)
