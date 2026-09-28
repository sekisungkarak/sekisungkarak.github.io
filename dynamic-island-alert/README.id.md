## Kebutuhan

- **OBS Studio 30+** dengan **obs-websocket** bawaan yang aktif.
- Koneksi live TikTok lewat **TikFinity** atau **IndoFinity** — pilih yang kamu pakai untuk mengirim event.
- Now Playing lewat SMTC bridge (https://github.com/nuttylmao/smtc-bridge)

---

## Instalasi

Semua diatur dari **Controls Panel** yang terbuka di atas overlay itu sendiri.
Kamu cukup menambah satu browser source, tekan **S**, lalu atur semuanya sambil
melihat hasilnya. Tanpa dashboard terpisah, tanpa URL panjang.

### Langkah 1 — Tambah browser source

1. Di OBS, tambahkan sumber **Browser** baru ke scene tempat alert ingin ditampilkan.
2. Isi URL dengan:

   ```
   https://sekisungkarak.github.io/dynamic-island-alert/
   ```

3. Set **Width** dan **Height** sesuai ukuran canvas OBS kamu — `1920x1080` untuk
   kebanyakan orang. Matikan **Shutdown source when not visible** kalau ingin
   koneksi tetap hidup saat berpindah scene.

### Langkah 2 — Buka Controls Panel

Pilih browser source lalu klik **Interact**. Tekan **S** — atau klik tombol gear kecil yang muncul di pojok kiri atas saat kamu menggerakkan mouse. Pakai gear kalau tombol S tidak sampai ke overlay di versi OBS kamu. Tombolnya hanya muncul saat kamu sedang berinteraksi, jadi tidak akan ikut terekam di stream.

Controls Panel terbuka di atas canvas kamu. **Seret bar judulnya untuk memindahkan panel** — posisinya diingat, dan klik dua kali bar judul mengembalikannya ke pojok kiri atas. Lebar panel tetap 640px (sama seperti Better Alerts) dan latar belakangnya transparan, jadi overlay di belakangnya tetap terlihat. **Options → Panel Layout → Reset Layout** (atau klik dua kali bar judul) mengembalikan posisi bawaan. Grupnya sama persis dengan
pengaturannya: koneksi dulu, baru jenis alert.

> **Tips** — kamu juga bisa membuka overlay di tab browser biasa
> (`https://sekisungkarak.github.io/dynamic-island-alert/?controls=1`) supaya
> lebih nyaman diatur di layar besar. Pengaturan tersimpan di penyimpanan overlay
> itu sendiri, jadi apa pun yang kamu set di sana sudah terpasang saat OBS
> memuatnya.

### Langkah 3 — Isi koneksinya

Buka grup **OBS Connection** dan isi dengan nilai server OBS WebSocket **milikmu**:

| Field | Nilai |
|---|---|
| **Server IP** | `127.0.0.1` |
| **Port** | **Server Port** dari **Tools → WebSocket Server Settings** (default `4455`) |
| **Password** | password dari dialog yang sama (kosongkan kalau dimatikan) |

Titik status berubah **hijau** begitu overlay tersambung ke OBS. Kalau tetap
merah, port atau password tidak cocok — perbaiki di sini dulu sebelum lanjut.

Lakukan hal yang sama untuk **Streamer.bot Connection** dan **TikTok Connection**
sesuai fitur yang kamu pakai. **Now Playing** ada di tab **Alerts**, bersebelahan
dengan kartu-kartu alert.

### Langkah 4 — Simpan dan terapkan

Tekan **Save & Apply** di bagian bawah panel. Overlay memuat ulang dengan
pengaturanmu dan menyimpannya — URL tidak perlu disentuh lagi.

![Controls Panel dengan grup-grupnya](docs/assets/install-panel.png)

### Langkah 5 — Selesai

Sesuaikan jenis alert mana pun, lalu tekan **Save & Apply** lagi. Semua disimpan
di penyimpanan browser source itu sendiri, jadi membersihkan cache browser OBS
atau memindahkan source ke scene lain tidak mengubah apa pun.

> **Profil** — satu browser source bisa menyimpan beberapa susunan. Pakai
> dropdown di atas panel untuk berpindah, **+ Profil** untuk membuat, dan
> **Hapus** untuk menghapus. Untuk memaku satu source ke profil tertentu,
> tambahkan `?profile=Nama` di URL-nya, misalnya
> `https://sekisungkarak.github.io/dynamic-island-alert/?profile=Gameplay`.

---

## Alternatif — dock dashboard

Kalau kamu lebih suka mengatur semuanya lewat dock di dalam OBS, dashboard lama
tetap bisa dipakai dan bisa jalan berdampingan dengan panel.

### Langkah 1 — Tambah dock dashboard

1. Di OBS, buka menu atas **Docks → Custom Browser Docks**.
2. Di dialog, tambahkan satu baris:

   | Field | Nilai |
   |---|---|
   | **Dock Name** | `Dynamic Island Alert` |
   | **URL** | `https://sekisungkarak.github.io/dynamic-island-alert/dashboard/` |

3. Klik **Apply**, lalu **Close**. Dashboard muncul sebagai dock di dalam OBS.

![Menu OBS → Docks → Custom Browser Docks](docs/assets/install-1-docks-menu.png)

![Isi nama dock dan URL dashboard, lalu Apply](docs/assets/install-2-add-dock.png)

### Langkah 2 — Cek port OBS WebSocket

Dashboard berkomunikasi dengan OBS lewat **obs-websocket**, jadi portnya harus
sama di kedua sisi.

1. Di OBS, buka **Tools → WebSocket Server Settings**.
2. Pastikan **Enable WebSocket server** tercentang, lalu catat **Server Port**.
3. Klik **Apply** untuk menyimpan.

![OBS → Tools → WebSocket Server Settings](docs/assets/install-3-websocket-server-settings.png)

![Aktifkan server dan catat Server Port, lalu Apply](docs/assets/install-3-same-port.png)

### Langkah 3 — Isi OBS Connection dan tekan Save

Di dock, buka bagian **OBS Connection** dan isi dengan nilai server OBS WebSocket
**milikmu** — **Port** harus sama dengan angka yang kamu catat di Langkah 2:

| Field | Nilai |
|---|---|
| **Server IP** | `127.0.0.1` |
| **Port** | **Server Port** yang sama seperti di Langkah 2 (default `4455`) |
| **Password** | password dari dialog OBS yang sama (kosongkan kalau dimatikan) |

Titik status berubah **hijau** begitu dock tersambung ke OBS. Kalau tetap merah,
port atau password tidak cocok dengan pengaturan OBS WebSocket-mu — perbaiki di
sini dulu sebelum lanjut.

Klik **Save** di bagian bawah dock. Dashboard lalu membuat **Browser Source** di
**scene yang sedang aktif**.

![OBS Connection — Server IP, Port dan Password](docs/assets/install-3-obs-connection.png)

![Browser source muncul di scene aktif](docs/assets/install-5-overlay-result.png)

> **Tips** — pindah ke scene tempat alert ingin ditampilkan **sebelum** menekan
> Save, dan tambahkan ke setiap scene yang kamu stream.

### Langkah 4 — Muat pengaturan tersimpan

**Load** menarik kembali konfigurasi tersimpan ke dock untuk scene pilihan.

1. Klik **Load** di bagian bawah dock.
2. Di dialog **Load Saved Settings**, pilih **Scene** yang pengaturannya ingin
   dimuat.
3. Klik **Load**.

![Pilih scene lalu klik Load](docs/assets/install-6-load-saved-settings.png)

Pakai **Reset** untuk mengembalikan semua opsi ke nilai bawaan.

> Dock dan Controls Panel membaca serta menulis **profil yang sama**, jadi kamu
> bisa berpindah di antara keduanya kapan saja tanpa kehilangan apa pun.
