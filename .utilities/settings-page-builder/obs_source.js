// ── Sinkronisasi browser source OBS via obs-websocket v5 ──────────
// Dipakai tombol Save / Reset di footer dashboard.
// Kenapa langsung obs-websocket, bukan Streamer.bot: dashboard berjalan DI
// DALAM OBS, jadi bisa buka WebSocket ke 127.0.0.1:4455 tanpa perantara.
// Streamer.bot tidak punya API "buat source" bawaan.
//
// Alur Save:
//   1. Simpan settings ke localStorage
//   2. Bangun URL widget + query string settings terbaru
//   3. Cari source di scene aktif
//   4. Ada  -> SetInputSettings (update URL); Tiada -> CreateInput

const OBS_WS_DEFAULT_PORT = 4455;
// Ukuran browser source: dipakai CreateInput, SetInputSettings, dan
// perhitungan posisi tengah.
const OBS_SOURCE_WIDTH = 700;
const OBS_SOURCE_HEIGHT = 350;

const OBS_SOURCE_BASE_NAME = 'Dynamic Island Alert';

// Bitmask alignment scene item OBS: 1=Left, 2=Right, 4=Top, 8=Bottom.
// Top-center = 4 (bit Top saja; bit horizontal kosong -> tengah).
const OBS_ALIGN_TOP_CENTER = 4;

// Koneksi OBS dibaca dari panel "OBS Connection" bila tersedia, sehingga
// pengguna bisa mengubah IP/port/password tanpa edit kode.
function GetObsConfig() {
    const read = (id, fallback) => {
        const el = document.getElementById(id);
        if (el) return el.value;
        return (typeof settingsMap !== 'undefined' && settingsMap.has(id))
            ? settingsMap.get(id) : fallback;
    };
    return {
        address: read('obsAddress', '127.0.0.1') || '127.0.0.1',
        port: Number(read('obsPort', OBS_WS_DEFAULT_PORT)) || OBS_WS_DEFAULT_PORT,
        password: read('obsPassword', '') || ''
    };
}

let obsSocket = null;
let obsSocketEndpoint = null;
let obsRequestId = 0;
const obsPending = new Map();

// ── Koneksi ──────────────────────────────────────────────────────
function ObsConnect() {
    const cfg = GetObsConfig();
    const password = cfg.password;
    const endpoint = `ws://${cfg.address}:${cfg.port}`;

    return new Promise((resolve, reject) => {
        // Pakai ulang koneksi HANYA bila endpoint-nya sama: dulu socket dipakai
// ulang tanpa cek alamat, sehingga setelah satu Save berhasil, mengubah
// IP/port lalu Save lagi tetap memakai koneksi lama.
        if (obsSocket && obsSocketEndpoint === endpoint
            && obsSocket.readyState === WebSocket.OPEN) {
            resolve(obsSocket);
            return;
        }

        // Endpoint berbeda (atau socket mati) → tutup yang lama.
        if (obsSocket) {
            try { obsSocket.close(); } catch (e) { /* abaikan */ }
            obsSocket = null;
            obsSocketEndpoint = null;
        }

        let ws;
        try {
            ws = new WebSocket(`ws://${cfg.address}:${cfg.port}`);
        } catch (e) {
            reject(new Error('WebSocket tidak didukung'));
            return;
        }

        const timeout = setTimeout(() => {
            try { ws.close(); } catch (e) {}
            reject(new Error('Timeout: OBS WebSocket tidak merespons. Pastikan Tools > obs-websocket Settings > Enable WebSocket server aktif.'));
        }, 5000);

        ws.addEventListener('open', () => { /* tunggu Hello */ });

        ws.addEventListener('message', async (event) => {
            const msg = JSON.parse(event.data);

            // op 0 = Hello: berisi challenge untuk autentikasi
            if (msg.op === 0) {
                const auth = msg.d?.authentication;
                if (auth) {
                    // obs-websocket v5: sha256(secret + salt) -> base64, lalu
// sha256(result + challenge) -> base64
                    const secret = await ObsSha256Base64(
                        password + auth.salt
                    );
                    const authResponse = await ObsSha256Base64(
                        secret + auth.challenge
                    );
                    ws.send(JSON.stringify({
                        op: 1,
                        d: {
                            rpcVersion: 1,
                            authentication: authResponse,
                            eventSubscriptions: 0
                        }
                    }));
                } else {
                    ws.send(JSON.stringify({
                        op: 1,
                        d: { rpcVersion: 1, eventSubscriptions: 0 }
                    }));
                }
                return;
            }

            // op 2 = Identified: siap dipakai
            if (msg.op === 2) {
                clearTimeout(timeout);
                obsSocket = ws;
                obsSocketEndpoint = endpoint;
                resolve(ws);
                return;
            }

            // op 7 = RequestResponse
            if (msg.op === 7 || msg.op === 9) {
                const id = msg.d?.requestId;
                const entry = obsPending.get(id);
                if (!entry) return;
                obsPending.delete(id);
                if (msg.d?.requestStatus?.result) entry.resolve(msg.d.responseData);
                else entry.reject(new Error(msg.d?.requestStatus?.comment || 'Permintaan OBS ditolak'));
            }
        });

        ws.addEventListener('error', () => {
            clearTimeout(timeout);
            reject(new Error(`Gagal terhubung ke OBS WebSocket di ${cfg.address}:${cfg.port}`));
        });
    });
}

async function ObsSha256Base64(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    let binary = '';
    const view = new Uint8Array(digest);
    for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
    return btoa(binary);
}

// ── Kirim request ────────────────────────────────────────────────
function ObsRequest(type, data = {}) {
    return new Promise((resolve, reject) => {
        if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN) {
            reject(new Error('Belum terhubung ke OBS'));
            return;
        }
        const requestId = 'req-' + (++obsRequestId);
        obsPending.set(requestId, { resolve, reject });
        obsSocket.send(JSON.stringify({
            op: 6,
            d: { requestType: type, requestId, requestData: data }
        }));
        setTimeout(() => {
            if (obsPending.has(requestId)) {
                obsPending.delete(requestId);
                reject(new Error('Timeout menunggu OBS: ' + type));
            }
        }, 8000);
    });
}

// ── Nama source berformat "{scene} | Dynamic Island Alert" ───────
// Tiap scene boleh punya widget-nya sendiri, jadi nama menyertakan scene
// agar unik lintas scene ("Live | …", "BRB | …"). Bila satu scene butuh
// lebih dari satu widget, tambah akhiran " 2", " 3" — otomatis.
function BuildSourceName(sceneName, existingNames) {
    const base = `${sceneName} | ${OBS_SOURCE_BASE_NAME}`;
    let name = base;
    let n = 1;
    while (existingNames.includes(name)) {
        n += 1;
        name = `${base} ${n}`;
    }
    return name;
}

// Daftar calon nama untuk scene tertentu — dipakai untuk mencari source
// yang SUDAH ada di scene itu.
function SourceNameCandidates(sceneName) {
    const base = `${sceneName} | ${OBS_SOURCE_BASE_NAME}`;
    const list = [base];
    for (let i = 2; i <= 20; i++) list.push(`${base} ${i}`);
    return list;
}

// Nama source lama (tanpa awalan scene) — kompatibilitas dengan source
// yang dibuat sebelum format ini diterapkan.
function LegacySourceNameCandidates() {
    const list = [OBS_SOURCE_BASE_NAME];
    for (let i = 2; i <= 20; i++) list.push(`${OBS_SOURCE_BASE_NAME} ${i}`);
    return list;
}

// ── Nama scene aktif ─────────────────────────────────────────────
// Dipakai tombol Load untuk menampilkan "Load (Current: <scene>)".
// Mengembalikan null bila OBS belum terhubung — pemanggil wajib
// menangani itu dan tidak mengubah label.
async function ObsGetCurrentSceneName() {
    try {
        await ObsConnect();
        const scene = await ObsRequest('GetCurrentProgramScene');
        return scene?.currentProgramSceneName || null;
    } catch (e) {
        return null;
    }
}

// ── Hapus source OBS untuk satu scene ────────────────────────────
// Menghapus input bernama "{scene} | Dynamic Island Alert" (atau nama lama
// "Dynamic Island Alert"), plus semua varian "… 2", "… 3". Mengembalikan
// daftar nama yang dihapus. Catatan: RemoveInput menghapus input secara
// GLOBAL di OBS, jadi source hilang dari semua scene yang memakainya —
// itu memang yang diminta tombol hapus.
async function ObsDeleteSourcesForScene(sceneName) {
    await ObsConnect();

    const inputs = await ObsRequest('GetInputList', { inputKind: 'browser_source' });
    const existing = (inputs?.inputs || []).map(i => i.inputName);

    const candidates = [
        ...SourceNameCandidates(sceneName),
        ...LegacySourceNameCandidates()
    ];

    const removed = [];
    for (const name of candidates) {
        if (!existing.includes(name)) continue;
        try {
            await ObsRequest('RemoveInput', { inputName: name });
            removed.push(name);
        } catch (e) {
            // Lanjut ke kandidat lain; kegagalan satu tidak menghentikan sisanya.
            console.warn('[OBS] Gagal hapus source ' + name, e);
        }
    }
    return removed;
}
// ── Pusatkan source secara horizontal ────────────────────────────
// Dipanggil HANYA saat source pertama kali dibuat — bukan saat update URL,
// supaya posisi yang sudah disesuaikan manual tidak terus ditimpa.
// alignment itu bitmask (1=Left, 2=Right, 4=Top, 8=Bottom); Top-center = 4,
// jadi positionX = setengah lebar canvas, positionY = tepi atas.
// positionY WAJIB di-set eksplisit: CreateInput memberi Y=0, dan dengan
// jangkar tengah (0) Y=0 berarti "pusat source di tepi atas canvas" ->
// separuh source terpotong ke atas.
async function ObsCenterSourceHorizontally(sceneName, sourceName) {
    try {
        const idRes = await ObsRequest('GetSceneItemId', {
            sceneName,
            sourceName
        });
        const sceneItemId = idRes?.sceneItemId;
        if (sceneItemId == null) return false;

        const video = await ObsRequest('GetVideoSettings');
        const canvasWidth = video?.baseWidth;
        if (!canvasWidth) return false;

        // Jangkar top-center: X = setengah canvas, Y = 0 (tepi atas).
        const positionX = Math.round(canvasWidth / 2);

        await ObsRequest('SetSceneItemTransform', {
            sceneName,
            sceneItemId,
            sceneItemTransform: {
                positionX,
                positionY: 0,
                alignment: OBS_ALIGN_TOP_CENTER
            }
        });
        return true;
    } catch (e) {
        // Pusatkan itu opsional — kegagalan tidak boleh menggagalkan Save yang
// sudah berhasil membuat source.
        console.warn('[OBS] Gagal memusatkan source', e);
        return false;
    }
}

// Mengembalikan { created: bool, name: string }
async function ObsSyncBrowserSource(widgetUrl) {
    await ObsConnect();

    const scene = await ObsRequest('GetCurrentProgramScene');
    const sceneName = scene?.currentProgramSceneName;
    if (!sceneName) throw new Error('Tidak ada scene aktif di OBS');

    const sceneItems = await ObsRequest('GetSceneItemList', { sceneName });
    const names = (sceneItems?.sceneItems || []).map(it => it.sourceName);

    // Cari source kita yang SUDAH ada di scene aktif. Prioritas: "{scene} | …",
// lalu "… 2", dst. Terakhir cek nama lama tanpa awalan scene.
    let target = null;
    const candidates = [
        ...SourceNameCandidates(sceneName),
        ...LegacySourceNameCandidates()
    ];
    for (const cand of candidates) {
        if (names.includes(cand)) { target = cand; break; }
    }

    if (target) {
        // Sudah ada -> update URL-nya saja. SetInputSettings hanya mengubah `url`;
// untuk memaksa widget memuat ulang, `reroute` tidak cukup — OBS butuh
// RefreshNoCache atau perubahan URL. Karena URL berisi ?v= baru tiap save,
// browser akan memuat ulang dengan sendirinya.
        await ObsRequest('SetInputSettings', {
            inputName: target,
            inputSettings: {
                url: widgetUrl,
                width: OBS_SOURCE_WIDTH,
                height: OBS_SOURCE_HEIGHT,
                reroute_audio: false
            },
            overlay: true
        });
        return { created: false, name: target, sceneName };
    }

    // Belum ada -> buat baru dengan nama berformat "{scene} | …".
    const newName = BuildSourceName(sceneName, names);
    await ObsRequest('CreateInput', {
        sceneName,
        inputName: newName,
        inputKind: 'browser_source',
        inputSettings: {
            url: widgetUrl,
            width: OBS_SOURCE_WIDTH,
            height: OBS_SOURCE_HEIGHT,
            reroute_audio: false,
            is_local_file: false
        },
        sceneItemEnabled: true
    });

    // HANYA saat pertama kali dibuat: pusatkan horizontal. Tidak pada update,
// supaya posisi susunan manual pengguna tidak ditimpa tiap kali Save.
    await ObsCenterSourceHorizontally(sceneName, newName);

    return { created: true, name: newName, sceneName };
}
