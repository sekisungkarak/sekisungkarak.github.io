## Kebutuhan

- **OBS Studio 30+** dengan **obs-websocket** bawaan dalam keadaan aktif.
- **Geseki Bridge** untuk koneksi live TikTok, [unduh](https://github.com/sekisungkarak/geseki-bridge/releases).

---

## Pemasangan

Semua diatur dari dock **Live Q&A** yang ditambahkan Geseki Bridge ke OBS. Buka
**Docks** di menu bar lalu aktifkan.

![Aktifkan dock Live Q&A di OBS](docs/Assets/enable-dock.png)

Di dock-nya, buka **OBS Connection**, isi **Server IP** dan **Port** (default
`4455`), plus **Password** kalau kamu memasangnya di **Tools → WebSocket Server
Settings**, lalu tekan **Save**. Menekan Save otomatis menambahkan widget ke
scene yang sedang aktif, overlay langsung muncul di stream, tanpa perlu
menambah sumber Browser sendiri. Titik statusnya berubah hijau begitu widget
tersambung ke OBS.

![Pengaturan OBS Connection di dock](docs/Assets/obs-websocket.png)

---

## Queue

Penonton bertanya lewat chat; kamu mengatur pertanyaannya dari tab **Queue**.

![Tab Queue di dock](docs/Assets/queue.png)

Tentukan **Question Prefix** (bawaan `!q`) di bagian **Questions** pada dock:
pesan chat yang diawali prefix ini masuk ke antrean, belum ada yang tampil di
layar. Klik satu pertanyaan untuk menampilkannya, lalu pakai **Next** /
**Previous** atau **Hide**. Lencana **Queue** menghitung pertanyaan yang
menunggu, pertanyaan yang sudah tampil tetap bertanda `shown`, dan **Sample**
menambah pertanyaan uji.

Kamu juga bisa mewajibkan **Ticket** lebih dulu (gift, follower, likes, dan
lainnya), jadi hanya penonton yang memenuhinya boleh bertanya. Biarkan kosong
dan siapa pun boleh bertanya hanya dengan prefix.
