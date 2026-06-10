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

console.log('\n' + '='.repeat(50));
console.log('HASIL: ' + pass + ' lulus, ' + fail + ' gagal');
console.log(fail === 0 ? 'Semua pengujian LULUS \u2705' : 'ADA YANG GAGAL \u274C');
process.exit(fail === 0 ? 0 : 1);
