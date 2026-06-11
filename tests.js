/* Pengujian unit SIPRA (RKA/KL · usulan_belanja) — jalankan: node tests.js */
var A = require('./app.js');
var pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  \u2713 ' + m); } else { fail++; console.log('  \u2717 ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' (got ' + a + ', exp ' + b + ')'); }

console.log('\n\u25B6 klasifikasi jenis dari akun');
eq(A.kodeToJenis('511111'), 'pegawai', '51x = pegawai');
eq(A.kodeToJenis('521211'), 'barang', '52x = barang');
eq(A.kodeToJenis('537112'), 'modal', '537x = modal');

console.log('\n\u25B6 seed: model per-tahap (1 baris = 1 detail belanja per tahap)');
A.APP.records = A.buildSeed();
var cy = A.yearOptions()[0];
eq(A.recordsForYear(cy).length, 56, 'satu tahun = 14 item × 4 tahap = 56 baris');
eq(A.recordsView(cy, 'anggaran').length, 14, 'tahap Anggaran = 14 baris (cocok kartu "14 baris")');

console.log('\n\u25B6 JUMLAH = VOL × HRG SAT');
var r0 = A.recordsView(cy, 'anggaran')[0];
eq(r0.jumlah, r0.vol * r0.hrg_sat, 'jumlah = vol × hrg_sat');

console.log('\n\u25B6 6 kartu pada PAGU Anggaran cocok dengan tampilan (gambar 1)');
var s = A.computeCards(cy, 'anggaran');
eq(s.total, 14648036000, 'Total Anggaran');
eq(s.ops, 3227236000, 'Total Operasional');
eq(s.nonops, 11420800000, 'Total Non Operasional');
eq(s.pegawai, 862236000, 'Total Belanja Pegawai');
eq(s.barang, 5572800000, 'Total Belanja Barang');
eq(s.modal, 8213000000, 'Total Belanja Modal');
eq(s.baris, 14, 'jumlah baris = 14');
eq(s.ops + s.nonops, s.total, 'ops + nonops = total');
eq(s.pegawai + s.barang + s.modal, s.total, 'pegawai + barang + modal = total');

console.log('\n\u25B6 tahap PAGU: Kebutuhan > Anggaran > Alokasi');
var st = A.stageTotals(cy);
eq(st.length, 4, 'empat tahap');
ok(st[0] > st[2] && st[2] > st[3], 'Kebutuhan > Anggaran > Alokasi');

console.log('\n\u25B6 daftar usulan: pengelompokan per KODE');
var groups = A.groupByKode(A.recordsView(cy, 'anggaran'));
eq(groups.length, 12, '12 grup akun (parent baris pohon)');
eq(groups.reduce(function (a, g) { return a + g.total; }, 0), s.total, 'jumlah seluruh grup = total kartu');
eq(A.kodeOf(r0), '022.12.DL.3996.SAB.005.051.A.511111', 'format KODE lengkap (BA…Akun)');

console.log('\n\u25B6 pemetaan Supabase usulan_belanja: toDbRow / mapRow');
var dbrow = A.toDbRow(r0);
ok(!('id' in dbrow) && !('jumlah' in dbrow) && !('jenis' in dbrow), 'toDbRow tidak mengirim id/jumlah/jenis (otomatis di DB)');
ok('tahap' in dbrow && dbrow.tahap === 'anggaran', 'toDbRow menyertakan tahap');
var back = A.mapRow({ id: 9, ta: cy, tahap: 'anggaran', akun: r0.akun, vol: r0.vol, hrg_sat: r0.hrg_sat });
eq(back.jumlah, r0.vol * r0.hrg_sat, 'mapRow menghitung jumlah bila DB tidak mengirim (vol×hrg)');
eq(back.jenis, A.kodeToJenis(r0.akun), 'mapRow menurunkan jenis dari akun bila kosong');
eq(A.UPSERT_KEY.indexOf('tahap') > -1, true, 'kunci upsert memuat tahap');

console.log('\n\u25B6 CSV & format rupiah');
eq(A.csvCell('a;b'), '"a;b"', 'cell ber-; dibungkus kutip');
eq(A.fmtRp(14648036000), 'Rp 14.648.036.000', 'fmtRp pemisah id-ID');

console.log('\n\u25B6 autentikasi: fallback token & status login');
A.APP.session = null;
ok(A.isLoggedIn() === false, 'tanpa sesi: belum login');
ok(A.authToken().indexOf('eyJ') === 0, 'tanpa login: Authorization pakai anon key');
A.APP.session = { access_token: 'TOKEN_LOGIN_XYZ', refresh_token: 'r', user: { email: 'a@b.go.id' } };
ok(A.isLoggedIn() === true, 'dengan sesi: sudah login');
eq(A.authToken(), 'TOKEN_LOGIN_XYZ', 'dengan login: Authorization pakai access_token user');
A.APP.session = null;

console.log('\n\u25B6 basis data KODE: 7 tabel referensi');
eq(A.REF_TABLES.length, 7, '7 tabel referensi terdaftar');
eq(A.REF_TABLES.map(function (t) { return t.table; }).join(','), 'ref_ba,ref_program,ref_kegiatan,ref_kro,ref_ro,ref_komponen,ref_akun', 'nama tabel sesuai');
eq(A.refDef('akun').table, 'ref_akun', 'refDef memetakan key → tabel');
eq(A.CASCADE.join('>'), 'program>kegiatan>kro>ro>komponen', 'rantai cascade real (5 tingkat)');
eq(A.refDef('kegiatan').parent, 'program', 'parent Kegiatan = program');
eq(A.refDef('kro').parent, 'kegiatan', 'parent KRO = kegiatan');
eq(A.refDef('akun').parent, '@sd', 'Akun difilter Sumber Dana (@sd)');
// pathOf: jalur penuh = induk + '.' + kode
eq(A.pathOf({ kode: '12.DL', induk: '' }), '12.DL', 'pathOf top-level = kode');
eq(A.pathOf({ kode: 'DCB', induk: '12.DL.3996' }), '12.DL.3996.DCB', 'pathOf gabung induk+kode');
// childrenOf pakai jalur penuh → DCB di 1975 vs 3996 TIDAK tercampur
A.APP.refData.kro = [
  { kode: 'DAB', uraian: 'Pendidikan Vokasi', induk: '12.DL.1975' },
  { kode: 'DCB', uraian: 'Pelatihan', induk: '12.DL.1975' },
  { kode: 'DCB', uraian: 'Pelatihan', induk: '12.DL.3996' },
  { kode: 'BMA', uraian: 'Data', induk: '12.DL.3996' },
];
eq(A.childrenOf('kro', '12.DL.1975').length, 2, 'childrenOf jalur 1975 → 2 KRO');
eq(A.childrenOf('kro', '12.DL.3996').length, 2, 'childrenOf jalur 3996 → 2 KRO (DCB terpisah)');
eq(A.uraianOf('kro', 'BMA'), 'Data', 'uraianOf mengambil uraian by kode');
// Akun difilter sumber dana (induk = rm/blu)
A.APP.refData.akun = [
  { kode: '521111', uraian: 'Keperluan', induk: 'rm' },
  { kode: '524111', uraian: 'Perjalanan', induk: 'rm' },
  { kode: '525112', uraian: 'Barang BLU', induk: 'blu' },
];
eq(A.childrenOf('akun', 'rm').length, 2, 'Akun RM → 2');
eq(A.childrenOf('akun', 'blu').length, 1, 'Akun BLU → 1');
eq(A.kodeToJenis('511111'), 'pegawai', 'akun 51xxxx → Pegawai');
eq(A.kodeToJenis('521211'), 'barang', 'akun 52xxxx → Barang');
eq(A.kodeToJenis('525112'), 'barang', 'akun 525xxx (BLU) → Barang');
eq(A.kodeToJenis('533111'), 'modal', 'akun 53xxxx → Modal');
console.log('\n\u25B6 kertas kerja: pemetaan kolom matriks');
eq(A.kkColOf({ akun: '511111', kategori: 'ops', sd: 'rm' }), 'W', 'Pegawai → W (Oper Pegawai RM)');
eq(A.kkColOf({ akun: '521111', kategori: 'ops', sd: 'rm' }), 'X', 'Barang ops RM → X');
eq(A.kkColOf({ akun: '525112', kategori: 'ops', sd: 'blu' }), 'Y', 'Barang ops BLU → Y');
eq(A.kkColOf({ akun: '521111', kategori: 'nonops', sd: 'rm' }), 'Z', 'Barang non-op RM → Z');
eq(A.kkColOf({ akun: '525112', kategori: 'nonops', sd: 'blu' }), 'AA', 'Barang non-op BLU → AA');
eq(A.kkColOf({ akun: '532111', kategori: 'nonops', sd: 'rm' }), 'AB', 'Modal → AB');

console.log('\n\u25B6 uraian sub komponen (subkomp_nama)');
eq(A.mapRow({ id: 1, ta: '2027', tahap: 'anggaran', akun: '525112', vol: 2, hrg_sat: 1000, subkomp: 'A', subkomp_nama: 'Kerja Sama Pelayaran' }).subkomp_nama, 'Kerja Sama Pelayaran', 'mapRow membawa subkomp_nama');
eq(A.mapRow({ id: 2, ta: '2027', tahap: 'anggaran', akun: '525112', vol: 1, hrg_sat: 1, subkomp: 'A' }).subkomp_nama, '', 'mapRow default subkomp_nama = ""');
eq(A.toDbRow({ subkomp: 'A', subkomp_nama: 'Sosialisasi' }).subkomp_nama, 'Sosialisasi', 'toDbRow menyertakan subkomp_nama');
ok(!('jenis' in A.toDbRow({ akun: '511111' })), 'toDbRow tidak mengirim jenis (otomatis di DB)');

console.log('\n\u25B6 ekspor kertas kerja (Komposisi Anggaran)');
(function () {
  var captured = '';
  global.document = { getElementById: function () { return null; }, createElement: function () { return { click: function () {}, remove: function () {}, set href(v) {}, set download(v) {} }; }, body: { appendChild: function () {} }, addEventListener: function () {} };
  global.URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} };
  global.Blob = function (parts) { captured = parts.join(''); };
  A.APP.year = '2027'; A.APP.stage = 'anggaran';
  A.APP.refData = {
    ba: [], program: [{ kode: '12.DL', uraian: 'Program Pendidikan', induk: '' }],
    kegiatan: [{ kode: '3996', uraian: 'Pendidikan Transportasi', induk: '12.DL' }],
    kro: [{ kode: 'AEC', uraian: 'Kerja sama', induk: '12.DL.3996' }],
    ro: [{ kode: '002', uraian: 'Kerjasama Antar Instansi', induk: '12.DL.3996.AEC' }],
    komponen: [{ kode: '051', uraian: 'Kerjasama Antar Instansi', induk: '12.DL.3996.AEC.002' }],
    akun: [{ kode: '525112', uraian: 'Belanja Barang', induk: 'blu' }],
  };
  function rec(detail, vol, hrg) { return { id: detail, ta: '2027', tahap: 'anggaran', ba: '022', prog: '12.DL', keg: '3996', kro: 'AEC', ro: '002', komp: '051', subkomp: 'A', subkomp_nama: 'Kerja Sama Pelayaran', akun: '525112', detail_belanja: detail, vol: vol, sat: 'Paket', hrg_sat: hrg, jumlah: vol * hrg, sd: 'blu', kategori: 'nonops' }; }
  A.APP.records = [rec('Belanja Kebutuhan', 9, 500000), rec('Konsumsi Snack', 135, 26000)];
  A.downloadKertasKerja();
  function has(x) { return captured.indexOf(x) >= 0; }
  ok(has('KOMPOSISI ANGGARAN'), 'judul KOMPOSISI ANGGARAN');
  ok(has('022.12.DL'), 'kode Program 022.12.DL');
  ok(has('>3996.AEC<'), 'kode KRO 3996.AEC');
  ok(has('3996.AEC.002'), 'kode RO 3996.AEC.002');
  ok(has('525112'), 'kode Akun 525112');
  ok(has('Kerja Sama Pelayaran'), 'uraian Sub Komponen tampil di kertas kerja');
  ok(has('- Belanja Kebutuhan') && has('- Konsumsi Snack'), 'dua baris detail belanja');
  ok(has('8010000'), 'subtotal akun = 4.500.000 + 3.510.000 = 8.010.000');
  ok(has('>BLU</td>'), 'label Sumber Dana BLU pada baris akun');
  ok(has('Belanja Operasional') && has('Belanja Non Operasional') && has('Jumlah Raya'), 'header matriks lengkap');
})();

console.log('\n\u25B6 impor kertas kerja: angka, penanda detail, deteksi kolom');
eq(A.kkNum('1.234.567'), 1234567, 'kkNum format id (titik ribuan)');
eq(A.kkNum('12.510.000'), 12510000, 'kkNum 12.510.000');
eq(A.kkNum(5000), 5000, 'kkNum number apa adanya');
eq(A.kkNum(''), 0, 'kkNum kosong = 0');
ok(A.kkIsDetail('- Belanja Kebutuhan') === true, 'penanda "- " = detail');
ok(A.kkIsDetail('-Konsumsi Snack') === true, 'penanda "-" tanpa spasi = detail');
ok(A.kkIsDetail('> Perlengkapan Diklat') === true, 'penanda ">" = detail');
ok(A.kkIsDetail('Belanja Barang') === false, 'baris akun (tanpa penanda) bukan detail');
eq(A.kkCleanName(' -Konsumsi Snack'), 'Konsumsi Snack', 'cleanName buang "-" & spasi');
eq(A.kkCleanName('> Perlengkapan Diklat'), 'Perlengkapan Diklat', 'cleanName buang ">"');

console.log('\n\u25B6 impor kertas kerja: meta tahap & TA dari judul');
(function () {
  function R(m) { var a = []; for (var i = 0; i < 33; i++) a.push(''); for (var k in m) a[k] = m[k]; return a; }
  var fx = [
    R({ 1: 'KOMPOSISI ANGGARAN PAGU KEBUTUHAN' }),
    R({ 1: 'POLITEKNIK ILMU PELAYARAN MAKASSAR' }),
    R({ 1: 'T.A 2027' }),
    R({ 1: 'KODE', 2: 'URAIAN', 18: 'Vol', 19: 'Satuan', 20: 'Harga', 21: 'Jumlah', 32: 'Sumber Dana' }),
    R({ 1: '022.12' }),
    R({ 1: '022.12.DL', 2: 'Program Pendidikan' }),
    R({ 1: '3996', 2: 'Pendidikan Transportasi' }),
    R({ 1: '3996.AEC', 2: 'Kerja sama' }),
    R({ 1: '3996.AEC.002', 2: 'Kerjasama Antar Instansi' }),
    R({ 1: '051', 2: 'Kerjasama' }),
    R({ 1: 'A', 2: 'Kerja Sama Pelayaran' }),
    R({ 1: '525112', 2: 'Belanja Barang', 21: 5500000, 26: 5500000, 32: 'BLU' }), // AA (idx26) nonop barang BLU
    R({ 2: '- Belanja Kebutuhan', 18: 9, 19: 'Paket', 20: 500000, 21: 4500000 }),
    R({ 2: '> Perlengkapan', 18: 10, 19: 'Paket', 20: 100000, 21: 1000000 }),
    R({ 3: '1) Goodie Bag (rincian)', 18: 1, 19: 'bh', 20: 55000 }),               // sub di kolom D → diabaikan
    R({ 1: '511111', 2: 'Belanja Gaji Pokok', 21: 12000000, 22: 12000000, 32: 'RM' }), // W (idx22) ops pegawai RM
    R({ 2: '- Gaji Pokok PNS', 18: 12, 19: 'BLN', 20: 1000000, 21: 12000000 }),
    R({ 1: '532111', 2: 'Belanja Modal', 21: 2000000, 27: 2000000, 32: 'RM' }),    // AB (idx27) modal
    R({ 2: '- Pengadaan Alat', 18: 1, 19: 'PKT', 20: 2000000, 21: 2000000 }),
  ];
  var cols = A.kkDetectCols(fx);
  eq(cols.kode, 1, 'deteksi kolom KODE = indeks 1');
  eq(cols.uraian, 2, 'deteksi kolom URAIAN = indeks 2');
  eq(cols.jumlah, 21, 'deteksi kolom Jumlah = indeks 21');
  eq(cols.sd, 32, 'deteksi kolom Sumber Dana (terakhir) = indeks 32');
  var meta = A.kkMeta(fx, cols);
  eq(meta.tahap, 'kebutuhan', 'tahap = kebutuhan (bukan "anggaran" dari judul KOMPOSISI ANGGARAN)');
  eq(meta.ta, '2027', 'TA = 2027 dari "T.A 2027"');

  var out = A.kkParseMatrix(fx, {});
  eq(out.records.length, 4, '4 Detail Belanja (sub kolom D diabaikan)');
  eq(out.meta.total, 19500000, 'total = 4.5jt + 1jt + 12jt + 2jt');
  var r0 = out.records[0];
  eq(r0.detail_belanja, 'Belanja Kebutuhan', 'detail 1 nama bersih');
  eq(r0.prog, '12.DL', 'prog dari "022.12.DL"');
  eq(r0.keg, '3996', 'keg');
  eq(r0.kro, 'AEC', 'kro dari "3996.AEC"');
  eq(r0.ro, '002', 'ro dari "3996.AEC.002"');
  eq(r0.komp, '051', 'komponen');
  eq(r0.subkomp, 'A', 'sub komponen');
  eq(r0.subkomp_nama, 'Kerja Sama Pelayaran', 'uraian sub komponen terbawa');
  eq(r0.akun, '525112', 'akun');
  eq(r0.jumlah, 4500000, 'jumlah = vol × harga');
  eq(r0.sd, 'blu', 'sumber dana BLU dari label AG');
  eq(r0.kategori, 'nonops', 'kategori non-op (nilai di kolom AA)');
  eq(r0.jenis, 'barang', 'jenis barang (akun 52x)');
  eq(out.records[1].detail_belanja, 'Perlengkapan', 'detail ">" ikut terbaca');
  eq(out.records[2].jenis, 'pegawai', 'akun 511111 → pegawai');
  eq(out.records[2].kategori, 'ops', 'pegawai di kolom W → ops');
  eq(out.records[2].sd, 'rm', 'sumber dana RM');
  eq(out.records[3].jenis, 'modal', 'akun 532111 → modal');
  eq(out.records[3].kategori, 'nonops', 'modal di kolom AB → non-op');

  // override TA & tahap (tujuan dipilih user di modal)
  var ov = A.kkParseMatrix(fx, { ta: '2026', tahap: 'alokasi' });
  eq(ov.records[0].ta, '2026', 'override TA tujuan');
  eq(ov.records[0].tahap, 'alokasi', 'override tahap tujuan');

  // round-trip: hasil impor bisa diunduh ulang sebagai kertas kerja
  var captured = '';
  global.document = { getElementById: function () { return null; }, createElement: function () { return { click: function () {}, remove: function () {}, set href(v) {}, set download(v) {} }; }, body: { appendChild: function () {} }, addEventListener: function () {} };
  global.URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} };
  global.Blob = function (parts) { captured = parts.join(''); };
  A.APP.records = out.records; A.APP.year = '2027'; A.APP.stage = 'kebutuhan';
  A.APP.refData = { ba: [], program: [], kegiatan: [], kro: [], ro: [], komponen: [], akun: [] };
  A.downloadKertasKerja();
  ok(captured.indexOf('KOMPOSISI ANGGARAN') >= 0, 'round-trip: unduhan memuat judul kertas kerja');
  ok(captured.indexOf('022.12.DL') >= 0 && captured.indexOf('525112') >= 0, 'round-trip: kode hierarki & akun tampil');
  ok(captured.indexOf('19500000') >= 0, 'round-trip: Jumlah Raya = total impor 19.500.000');
})();

console.log('\n\u25B6 impor kertas kerja: cegah galat upsert 21000 (kunci ganda)');
(function () {
  function rec(detail, vol, hrg) {
    return { ta: '2027', tahap: 'kebutuhan', ba: '022', prog: '12.DL', keg: '3996', kro: 'SAB', ro: '005', komp: '051', subkomp: 'B', akun: '525172', detail_belanja: detail, vol: vol, sat: 'OK', hrg_sat: hrg, jumlah: vol * hrg, sd: 'rm', kategori: 'nonops', jenis: 'barang' };
  }
  var a = rec('Honor Mengajar', 1144, 175000);
  var b = rec('Honor Mengajar', 1204, 175000); // kunci sama, nilai beda
  var c = rec('Honor Mengajar', 1144, 175000); // duplikat persis dari a (kunci sama)
  var d = rec('Seminar Hasil', 0, 0);
  eq(A.kkUpsertKeyOf(a), A.kkUpsertKeyOf(b), 'kunci upsert sama untuk detail_belanja identik pada akun sama');
  ok(A.kkUpsertKeyOf(a) !== A.kkUpsertKeyOf(d), 'kunci berbeda bila detail_belanja berbeda');

  var input = [a, b, c, d];
  var totalIn = input.reduce(function (s, r) { return s + r.jumlah; }, 0);
  var dd = A.kkDedupeForUpsert(input);
  eq(dd.rows.length, 4, 'tanpa kehilangan baris (4 → 4)');
  eq(dd.renamed, 2, '2 baris bertabrakan diberi akhiran');
  eq(dd.rows.reduce(function (s, r) { return s + r.jumlah; }, 0), totalIn, 'total nilai tetap (tidak ada yang hilang)');
  // semua kunci unik
  var keys = {}, dups = 0; dd.rows.forEach(function (r) { var k = A.kkUpsertKeyOf(r); if (keys[k]) dups++; keys[k] = 1; });
  eq(dups, 0, 'semua kunci upsert menjadi unik (penyebab 21000 hilang)');
  eq(dd.rows[0].detail_belanja, 'Honor Mengajar', 'kemunculan pertama nama asli');
  eq(dd.rows[1].detail_belanja, 'Honor Mengajar (2)', 'tabrakan ke-2 → " (2)"');
  eq(dd.rows[2].detail_belanja, 'Honor Mengajar (3)', 'tabrakan ke-3 → " (3)"');
  // simulasi batch upsert: tidak boleh ada kunci ganda dalam satu batch
  var bad = 0, s2 = {}; dd.rows.forEach(function (r) { var k = A.kkUpsertKeyOf(r); if (s2[k]) bad++; s2[k] = 1; });
  eq(bad, 0, 'tidak ada kunci ganda dalam batch (perintah ON CONFLICT aman)');
})();

console.log('\n' + '='.repeat(50));
console.log('HASIL: ' + pass + ' lulus, ' + fail + ' gagal');
console.log(fail === 0 ? 'Semua pengujian LULUS \u2705' : 'ADA YANG GAGAL \u274C');
process.exit(fail === 0 ? 0 : 1);
