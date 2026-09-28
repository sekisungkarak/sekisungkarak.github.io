// Membangkitkan dynamic-island-alert/controls/schema.js dari settings.json.
//
// Panel kontrol di dalam overlay butuh daftar setting (label, tipe, opsi,
// default) untuk merender form. Widget TIDAK boleh fetch settings.json saat
// startup: OBS membekukan halaman, dan fetch menambah satu titik gagal lagi.
// Jadi skema disalin sekali ke sebuah file JS yang dimuat sebelum script widget.
//
// Jalankan setiap kali settings.json berubah:
//   node shared/tools/build-controls-schema.mjs
//
// Kalau lupa, panel akan menampilkan skema lama — tidak error, hanya kurang
// sinkron. Karena itu skrip ini juga dipanggil dari shared/hooks/pre-commit
// (kalau hook-nya terpasang).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const SRC = resolve(root, 'dynamic-island-alert/dashboard/settings.json');
const OUT = resolve(root, 'dynamic-island-alert/controls/schema.js');

const json = JSON.parse(readFileSync(SRC, 'utf8'));

const defaults = {};
for (const s of json.settings || []) {
	if (Object.prototype.hasOwnProperty.call(s, 'defaultValue')) {
		defaults[s.id] = s.defaultValue;
	}
}

const schema = {
	groups: json.groups || {},
	categories: json.categories || {},
	settings: json.settings || [],
	defaults,
};

const body =
	'// Dibangkitkan dari dynamic-island-alert/dashboard/settings.json - jangan diedit manual.\n' +
	'// Salinan skema ini dipakai panel kontrol di dalam overlay supaya widget tidak\n' +
	'// perlu fetch apa pun saat startup (OBS bebas cache, offline tetap jalan).\n' +
	'// Bangkitkan ulang: node shared/tools/build-controls-schema.mjs\n' +
	'window.GESEKI_CONTROLS_SCHEMA = ' +
	JSON.stringify(schema, null, 1) +
	';\n';

writeFileSync(OUT, body.replace(/\n/g, '\r\n'), 'utf8');

const n = schema.settings.length;
console.log(`controls/schema.js diperbarui: ${n} setting, ${Object.keys(schema.groups).length} grup.`);
