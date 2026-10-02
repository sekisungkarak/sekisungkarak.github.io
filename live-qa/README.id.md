## Kebutuhan

- **OBS Studio 30+** dengan **obs-websocket** bawaan dalam keadaan aktif.
- Koneksi TikTok live dari **Geseki Bridge** — widget ini membaca event `gift`
  dan `chat` yang sama seperti widget alert, jadi tidak perlu bridge tambahan.

---

## Cara kerja

Penonton mengetik **prefix pertanyaan** (`!q` secara bawaan) diikuti
pertanyaannya di chat. Pertanyaan itu masuk ke **antrean** — belum ada yang
tampil di layar.

Buka tab **Queue** di dashboard untuk melihat antreannya, lalu klik salah satu
pertanyaan untuk menampilkannya. Overlay hanya menampilkan **satu** pertanyaan
dan membiarkannya di sana sampai kamu memilih yang lain atau menekan
**Sembunyikan**. Pertanyaan yang sudah pernah tampil tetap ada di daftar dengan
tanda `sudah`, jadi kamu bisa menampilkannya lagi kapan saja.

Kalau kamu memilih **Ticket Gift** di dashboard, tiket jadi wajib: penonton harus
mengirim gift itu dulu, dan satu gift berlaku untuk satu pertanyaan. Biarkan gift
kosong (bawaan) dan siapa pun boleh bertanya hanya dengan prefix.

> [!NOTE]
> Widget ini **tidak** memakai fitur Q&A bawaan TikTok. Fitur itu harus
> diaktifkan oleh streamer dan event-nya belum tentu terkirim, jadi alurnya
> dibangun sepenuhnya dari `gift` dan `chat`.

---

## Pemasangan

Semua pengaturan ada di **Dashboard** di dalam OBS. Tambahkan sumber
**Browser** ke scene yang kamu inginkan, lalu pakai URL ini:

| Kolom | Nilai |
|---|---|
| URL | https://sekisungkarak.web.id/live-qa/ |

Setelah itu atur posisinya sendiri di OBS — widget tidak menggambar apa pun
sampai kamu menampilkan sebuah pertanyaan, jadi sumber yang terlihat kosong itu
normal.

---

## Dock dashboard

Tambahkan lewat **Docks → Custom Browser Docks** dengan URL ini:

| Kolom | Nilai |
|---|---|
| URL | https://sekisungkarak.web.id/live-qa/dashboard/ |

Dock-nya punya dua tab:

- **Settings** — semua yang ada di tabel bawah.
- **Queue** — antrean pertanyaan. Klik satu pertanyaan untuk menampilkannya,
  tekan **Sembunyikan** untuk mengangkatnya dari layar, dan pakai **Contoh**
  untuk menambah pertanyaan uji tanpa perlu chat sungguhan.

Lencana di tab **Queue** menunjukkan berapa pertanyaan yang sedang menunggu.

---

## Pengaturan

| Pengaturan | Bawaan | Keterangan |
|---|---|---|
| Server IP / Port / Password | `127.0.0.1` / `4455` | OBS WebSocket, dipakai dock. |
| Bridge Host / Port | `127.0.0.1` / `47800` | Alamat Geseki Bridge. |
| Ticket Gift | kosong | Gift yang wajib dikirim sebelum bertanya. Dropdown-nya memuat semua gift TikTok lengkap dengan gambar, harga koin, dan id, serta bisa dicari. Kosong = tanpa tiket. |
| Question Prefix | `!q` | Chat yang diawali ini dianggap pertanyaan. |
| Show Avatar | aktif | Tampilkan foto profil penanya. |
| Show Ticket Hint | aktif | Tampilkan baris petunjuk di bawah kartu pertanyaan. |
| Hint Text | `Send {gift}, then type {prefix} your question` | Dipakai hanya bila gift tiket diisi. `{gift}` dan `{prefix}` diisi otomatis. Tanpa gift, widget menulis `Type !q to ask a question`. |

### Soal daftar gift

Dropdown-nya membaca `gifts.json`, salinan katalog gift TikTok (id, nama, harga
koin, gambar) yang disimpan di sebelah `settings.json`. Pencocokan memakai
**id**, bukan nama, karena TikTok melokalkan nama gift — Galaxy tampil sebagai
**Galaksi** di Indonesia. Jalankan ulang `_tools/make_gifts_json.py` kalau TikTok
menambah gift baru.
