## Kebutuhan

- **OBS Studio 30+** dengan **obs-websocket** bawaan yang aktif.
- **Geseki Bridge** untuk koneksi live TikTok dan Now Playing, [unduh](https://github.com/sekisungkarak/geseki-bridge/releases).

---

## Instalasi

Semua diatur dari dock **Dynamic Island Alert** yang ditambahkan Geseki Bridge
ke OBS. Buka **Docks** di menu bar lalu aktifkan.

![Aktifkan dock Dynamic Island Alert di OBS](docs/assets/enable-dock.png)

Lewati ini kalau kamu tidak memasang password di **Tools → WebSocket Server
Settings**. Di dock-nya, buka **OBS Connection**: **Server IP** sudah terisi
`127.0.0.1`, dan **Port** diisi otomatis dari pengaturan obs-websocket,
ditandai lencana **Auto**. Kalau servermu memakai password, baris **Password**
ditandai **Required**. Lalu tekan **Save**. Menekan Save otomatis menambahkan
widget ke scene yang sedang aktif, overlay langsung muncul di stream, tanpa
perlu menambah sumber Browser sendiri. Titik statusnya berubah hijau begitu
widget tersambung ke OBS.

![Pengaturan OBS Connection di dock](docs/assets/obs-websocket.png)

---

## Kustomisasi

Semua diatur dari dock **Dynamic Island Alert**, pada tab **Settings**.
Opsinya dikelompokkan ke dalam kartu (**General**, **Appearance**, **Now
Playing**, **TikTok Alerts**); header menyimpan **Save**, **Load**, dan
**Reset**, dan pil di atas menampilkan status koneksi TikTok. **Simulator**
mengirim event uji supaya kamu bisa melihat pratinjau alert tanpa chat
sungguhan, dan **Interact** membuka dialog Interact overlay di OBS.

![Tab Settings di dock](docs/assets/install-panel.png)

![](docs/assets/interact-conrol-panel.png)
