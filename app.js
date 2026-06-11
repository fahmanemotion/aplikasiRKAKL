/* =====================================================================
   SIPRA — Sistem Penganggaran RKA/KL · PIP Makassar
   Penyimpanan: Supabase tabel public.usulan_belanja
   (1 baris = 1 Detail Belanja per tahap PAGU; JUMLAH = VOL × HRG SAT)
   ===================================================================== */

var STAGES = [
  { key: 'kebutuhan', label: 'Kebutuhan' },
  { key: 'indikatif', label: 'Indikatif' },
  { key: 'anggaran',  label: 'Anggaran'  },
  { key: 'alokasi',   label: 'Alokasi'   },
];
var STAGE_LABEL = { kebutuhan: 'Kebutuhan', indikatif: 'Indikatif', anggaran: 'Anggaran', alokasi: 'Alokasi' };

/* ── Konfigurasi Supabase ──────────────────────────────────────────── */
var SUPA_URL  = 'https://ozwdehnqjipbzdeqpamp.supabase.co';
var SUPA_REST = SUPA_URL + '/rest/v1';
var SUPA_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96d2RlaG5xamlwYnpkZXFwYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMDA0MTYsImV4cCI6MjA5NjU3NjQxNn0.uRO3dtZaH0bAoj5K8A_eLpQRgeaJWTKXM6icDazZIwg';
var TABLE = 'usulan_belanja';
var UPSERT_KEY = 'on_conflict=ta,tahap,ba,prog,keg,kro,ro,komp,subkomp,akun,detail_belanja';
var AUTH_URL = SUPA_URL + '/auth/v1';
var SESSION_KEY = 'sipra_session';
var CACHE_KEY = 'sipra_cache_v1';   // salinan lokal data terakhir (anti-hilang saat luring)

var APP = {
  theme: 'light',
  stage: 'anggaran',
  year: String(new Date().getFullYear()),
  usulanMode: 'current',
  pie1Src: 'gabungan',
  pie2Cat: 'gabungan',
  uf: { prog: '', kro: '', ro: '', akun: '', detail: '', sd: '' },
  expanded: {},
  usulanPage: 1, dbPage: 1, PP: 12,
  satker: 'PIP MAKASSAR',
  session: null,
  editId: null,
  refData: { ba: [], program: [], kegiatan: [], kro: [], ro: [], komponen: [], akun: [] },
  kodeTab: 'ba',
  kodeEditId: null,
  records: [],
  importData: null,
};

/* ── Util ── */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function fmtRp(n) { return 'Rp ' + Math.round(+n || 0).toLocaleString('id-ID'); }
function fmtM(n) {
  n = +n || 0;
  if (Math.abs(n) >= 1e9) return 'Rp ' + (n / 1e9).toFixed(2).replace('.', ',') + ' M';
  if (Math.abs(n) >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1).replace('.', ',') + ' Jt';
  return fmtRp(n);
}
function kodeToJenis(k) {
  k = String(k || '');
  if (k.charAt(0) === '5' && k.charAt(1) === '1') return 'pegawai';
  if (k.charAt(0) === '5' && k.charAt(1) === '3') return 'modal';
  return 'barang';
}
var JENIS_LABEL = { pegawai: 'Belanja Pegawai', barang: 'Belanja Barang', modal: 'Belanja Modal' };
var JENIS_COLOR = { pegawai: '#1a56db', barang: '#0e9f6e', modal: '#c27803' };
function yearOptions() { var cy = new Date().getFullYear(); return [String(cy), String(cy - 1), String(cy - 2)]; }
function toast(type, title, msg) {
  var box = document.getElementById('toastBox'); if (!box) return;
  var ic = { success: 'check', error: 'xmark', info: 'info' }[type] || 'info';
  var el = document.createElement('div');
  el.className = 'toast t-' + type;
  el.innerHTML = '<div class="toast-ic"><i class="fas fa-' + ic + '"></i></div>' +
    '<div style="flex:1"><div class="toast-title">' + esc(title) + '</div>' +
    (msg ? '<div class="toast-msg">' + esc(msg) + '</div>' : '') + '</div>' +
    '<button class="toast-x" onclick="this.parentElement.remove()"><i class="fas fa-xmark"></i></button>';
  box.appendChild(el);
  setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 250); }, 4600);
}
function comingSoon() { toast('info', 'Segera Hadir', 'Metode input/unggah akan ditambahkan kemudian.'); }

/* ── Autentikasi (Supabase Auth) ───────────────────────────────────── */
function authToken() { return (APP.session && APP.session.access_token) || SUPA_KEY; }
function isLoggedIn() { return !!(APP.session && APP.session.access_token); }
function loadSession() { try { var s = localStorage.getItem(SESSION_KEY); if (s) APP.session = JSON.parse(s); } catch (e) { } }
function saveSession() { try { if (APP.session) localStorage.setItem(SESSION_KEY, JSON.stringify(APP.session)); else localStorage.removeItem(SESSION_KEY); } catch (e) { } }
/* Cache lokal: salinan data terakhir agar tetap tampil walau server gagal/luring */
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 1, ts: Date.now(), satker: APP.satker, records: APP.records })); }
  catch (e) { /* storage penuh / mode privat → lewati saja */ }
}
function loadCache() {
  try {
    var s = localStorage.getItem(CACHE_KEY); if (!s) return null;
    var c = JSON.parse(s);
    if (c && Array.isArray(c.records)) { APP.records = c.records; if (c.satker) APP.satker = c.satker; return c; }
  } catch (e) { }
  return null;
}
async function login(email, password) {
  var res = await fetch(AUTH_URL + '/token?grant_type=password', {
    method: 'POST', headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password }),
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error_description || data.msg || data.error || ('Login gagal (' + res.status + ')'));
  APP.session = { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user || { email: email } };
  saveSession();
}
async function refreshSession() {
  try {
    if (!APP.session || !APP.session.refresh_token) return false;
    var res = await fetch(AUTH_URL + '/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: APP.session.refresh_token }),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { APP.session = null; saveSession(); updateAuthUI(); return false; }
    APP.session = { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user || APP.session.user };
    saveSession(); return true;
  } catch (e) { return false; }
}
function logout() {
  try { fetch(AUTH_URL + '/logout', { method: 'POST', headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + authToken() } }); } catch (e) { }
  APP.session = null; saveSession(); updateAuthUI(); renderUsers(); renderKodeSection(); renderAll();
  toast('info', 'Keluar', 'Anda telah keluar. Aplikasi dalam mode hanya-baca.');
}
// Tulis dengan retry sekali bila token kedaluwarsa
async function supaWrite(method, table, opts) {
  opts = opts || {}; opts.useUserToken = true;
  try { return await supaFetch(method, table, opts); }
  catch (e) {
    if (isLoggedIn() && /(^|\D)40[13](\D|$)|jwt|expired|token/i.test(e.message)) {
      if (await refreshSession()) return await supaFetch(method, table, opts);
    }
    throw e;
  }
}
function requireLogin(aksi) {
  if (isLoggedIn()) return true;
  toast('info', 'Perlu Masuk', 'Silakan masuk dulu untuk ' + (aksi || 'menyimpan data') + '.');
  openLogin(); return false;
}
function updateAuthUI() {
  var chip = document.getElementById('authChip'); if (!chip) return;
  if (isLoggedIn()) {
    var em = (APP.session.user && APP.session.user.email) || 'pengguna';
    chip.innerHTML = '<span class="auth-email" title="' + esc(em) + '"><i class="fas fa-circle-user"></i> ' + esc(em) + '</span>' +
      '<button class="btn-sec auth-btn" onclick="logout()"><i class="fas fa-right-from-bracket"></i> Keluar</button>';
  } else {
    chip.innerHTML = '<button class="btn-primary auth-btn" onclick="openLogin()"><i class="fas fa-right-to-bracket"></i> Masuk</button>';
  }
}
function openLogin() { var m = document.getElementById('loginModal'); if (m) { m.classList.add('open'); var e = document.getElementById('lgEmail'); if (e) setTimeout(function () { e.focus(); }, 60); } }
function closeLogin() { var m = document.getElementById('loginModal'); if (m) m.classList.remove('open'); }
async function submitLogin() {
  var email = (gv('lgEmail') || '').trim(), pw = gv('lgPass') || '';
  if (!email || !pw) { toast('error', 'Lengkapi Data', 'Email dan kata sandi wajib diisi.'); return; }
  var btn = document.getElementById('lgBtn'); if (btn) btn.disabled = true;
  try {
    await login(email, pw);
    closeLogin();
    var p = document.getElementById('lgPass'); if (p) p.value = '';
    updateAuthUI(); renderUsers(); renderKodeSection(); renderAll();
    toast('success', 'Berhasil Masuk', 'Selamat datang, ' + ((APP.session.user && APP.session.user.email) || email) + '.');
  } catch (e) {
    toast('error', 'Login Gagal', e.message);
  } finally { if (btn) btn.disabled = false; }
}

/* ── Lapisan Supabase (REST) ── */
async function supaFetch(method, table, opts) {
  opts = opts || {};
  var url = SUPA_REST + '/' + table + (opts.query ? '?' + opts.query : '');
  var headers = { apikey: SUPA_KEY, Authorization: 'Bearer ' + ((opts.useUserToken || isLoggedIn()) ? authToken() : SUPA_KEY), 'Content-Type': 'application/json' };
  var prefer = [];
  if (opts.returning) prefer.push('return=representation');
  if (opts.upsert) prefer.push('resolution=merge-duplicates');
  if (prefer.length) headers['Prefer'] = prefer.join(',');
  var res = await fetch(url, { method: method, headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!res.ok) { var t = await res.text(); throw new Error(method + ' ' + table + ' → ' + res.status + ' ' + t); }
  if (method === 'DELETE' || !opts.returning) return null;
  var txt = await res.text(); return txt ? JSON.parse(txt) : null;
}
async function supaFetchAll(table, baseQuery) {
  var all = [], pageSize = 1000;
  for (var off = 0; ; off += pageSize) {
    var rows = await supaFetch('GET', table, { query: baseQuery + '&limit=' + pageSize + '&offset=' + off, returning: true }) || [];
    all = all.concat(rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
// Baris DB → record aplikasi
function mapRow(r) {
  var vol = +r.vol || 0, hrg = +r.hrg_sat || 0;
  return {
    id: r.id, ta: String(r.ta), tahap: r.tahap || 'anggaran',
    ba: r.ba, prog: r.prog, prog_nama: r.prog_nama, keg: r.keg, keg_nama: r.keg_nama,
    kro: r.kro, kro_nama: r.kro_nama, ro: r.ro, ro_nama: r.ro_nama,
    komp: r.komp, subkomp: r.subkomp, subkomp_nama: r.subkomp_nama || '', akun: r.akun, detail_akun: r.detail_akun, detail_belanja: r.detail_belanja,
    vol: vol, sat: r.sat, hrg_sat: hrg, jumlah: (r.jumlah != null ? +r.jumlah : vol * hrg),
    sd: r.sd, kategori: r.kategori, jenis: r.jenis || kodeToJenis(r.akun),
  };
}
// Record aplikasi → baris DB (tanpa id/jumlah/jenis; ketiganya otomatis di DB)
function toDbRow(r) {
  return {
    ta: r.ta, tahap: r.tahap, ba: r.ba, prog: r.prog, prog_nama: r.prog_nama, keg: r.keg, keg_nama: r.keg_nama,
    kro: r.kro, kro_nama: r.kro_nama, ro: r.ro, ro_nama: r.ro_nama || null, komp: r.komp, subkomp: r.subkomp, subkomp_nama: r.subkomp_nama || '',
    akun: r.akun, detail_akun: r.detail_akun, detail_belanja: r.detail_belanja,
    vol: r.vol, sat: r.sat, hrg_sat: r.hrg_sat, sd: r.sd, kategori: r.kategori,
  };
}
async function loadFromSupabase(retry) {
  try {
    var rows = await supaFetchAll(TABLE, 'select=*&order=id');
    APP.records = rows.map(mapRow);
    try {
      var meta = await supaFetch('GET', 'metadata', { query: 'select=key,value', returning: true }) || [];
      var m = {}; meta.forEach(function (x) { m[x.key] = x.value; });
      if (m.satker) APP.satker = m.satker;
    } catch (e) { /* metadata opsional */ }
    saveCache();                       // simpan salinan lokal agar aman saat luring
    populateYears(); renderAll();
    toast('success', 'Terhubung ke Supabase', APP.records.length + ' baris dimuat dari ' + TABLE + '.');
  } catch (e) {
    // Token kedaluwarsa → perbarui sekali lalu coba lagi
    if (!retry && isLoggedIn() && /(^|\D)40[13](\D|$)|jwt|expired|token/i.test(e.message) && await refreshSession()) {
      return loadFromSupabase(true);
    }
    // Gagal koneksi: JANGAN kosongkan layar — tampilkan data dari cache lokal
    var hadData = APP.records && APP.records.length;
    var cached = loadCache();
    populateYears(); renderAll();
    if (cached || hadData) {
      toast('info', 'Mode Luring', 'Gagal menghubungi server — menampilkan ' + APP.records.length + ' baris tersimpan lokal. Data akan tersinkron otomatis saat koneksi pulih.');
    } else {
      APP.records = []; renderAll();
      toast('error', 'Gagal Terhubung ke Supabase', e.message);
    }
    console.error('[SIPRA] load error:', e);
  }
}
async function seedToSupabase() {
  if (!requireLogin('mengisi data contoh')) return;
  if (!confirm('Isi database dengan DATA CONTOH (3 tahun × 4 tahap PAGU) untuk uji coba?\nBaris dengan kunci sama akan diperbarui (tidak menggandakan).')) return;
  try {
    var rows = buildSeed().map(toDbRow);
    for (var i = 0; i < rows.length; i += 200) {
      await supaWrite('POST', TABLE, { query: UPSERT_KEY, body: rows.slice(i, i + 200), upsert: true });
    }
    toast('success', 'Data Contoh Tersimpan', rows.length + ' baris dikirim ke Supabase. Memuat ulang…');
    await loadFromSupabase();
  } catch (e) {
    toast('error', 'Gagal Menyimpan', e.message);
    console.error('[SIPRA] seed error:', e);
  }
}

/* ── DATA CONTOH ──────────────────────────────────────────────────────
   Nilai tahap "Anggaran" TA berjalan disetel agar cocok dengan kartu. */
var STAGE_FACTOR = { kebutuhan: 1.15, indikatif: 1.07, anggaran: 1.0, alokasi: 0.97 };
// [akun, detail_akun, sd, kategori, komp, [ [detail_belanja, vol, sat, hrg_sat_anggaran], ... ] ]
var GROUPS = [
  ['511111', 'Belanja Gaji Pokok PNS',                  'rm',  'ops',    '051', [['Gaji Pokok PNS', 12, 'BLN', 60000000]]],
  ['511121', 'Belanja Tunjangan Keluarga',              'rm',  'ops',    '051', [['Tunjangan Suami/Istri & Anak', 12, 'BLN', 11853000]]],
  ['521111', 'Belanja Keperluan Perkantoran',           'rm',  'ops',    '052', [['ATK & Keperluan Kantor', 12, 'BLN', 45000000]]],
  ['522111', 'Belanja Langganan Listrik',               'rm',  'ops',    '052', [['Langganan Listrik', 12, 'BLN', 80000000]]],
  ['525113', 'Belanja Jasa (BLU)',                      'blu', 'ops',    '053', [['Jasa Layanan BLU', 1, 'THN', 865000000]]],
  ['521211', 'Belanja Bahan',                           'rm',  'nonops', '054', [['Bahan Praktik Diklat', 8, 'KEG', 120000000], ['Konsumsi Diklat', 1, 'PKT', 247800000]]],
  ['521213', 'Belanja Honor Output Kegiatan',           'rm',  'nonops', '054', [['Honor Penguji & Pengawas Ujian', 1, 'PKT', 500000000]]],
  ['524111', 'Belanja Perjalanan Dinas Biasa',          'rm',  'nonops', '055', [['Perjalanan Dinas Instruktur', 100, 'OT', 5000000]]],
  ['525112', 'Belanja Barang (BLU)',                    'blu', 'nonops', '056', [['Kebutuhan Operasional Diklat BLU', 1, 'THN', 1000000000]]],
  ['532111', 'Belanja Modal Peralatan dan Mesin',       'rm',  'nonops', '057', [['Pengadaan Simulator', 1, 'PKT', 4500000000], ['Pengadaan Perangkat Lab Komputer', 1, 'PKT', 1213000000]]],
  ['533111', 'Belanja Modal Gedung dan Bangunan',       'rm',  'nonops', '058', [['Pembangunan Asrama Taruna', 1, 'PKT', 2000000000]]],
  ['537112', 'Belanja Modal Peralatan dan Mesin (BLU)', 'blu', 'nonops', '059', [['Peralatan Laboratorium BLU', 1, 'PKT', 500000000]]],
];
function buildSeed() {
  var ys = yearOptions(); var yf = {}; yf[ys[0]] = 1.0; yf[ys[1]] = 0.95; yf[ys[2]] = 0.90;
  var recs = [];
  ys.forEach(function (yr) {
    var f = yf[yr];
    STAGES.forEach(function (stg) {
      var sf = STAGE_FACTOR[stg.key];
      GROUPS.forEach(function (g, gi) {
        var akun = g[0], detail_akun = g[1], sd = g[2], kat = g[3], komp = g[4], items = g[5];
        items.forEach(function (it, ii) {
          var vol = it[1], hrg = Math.round(it[3] * f * sf), jumlah = vol * hrg;
          recs.push({
            id: yr + '-' + stg.key + '-' + gi + '-' + ii, ta: yr, tahap: stg.key,
            ba: '022', prog: '12.DL', keg: '3996', kro: 'SAB', ro: '005', komp: komp, subkomp: 'A',
            prog_nama: 'Pendidikan & Pelatihan Transportasi',
            keg_nama: 'Penyelenggaraan Diklat Transportasi Laut',
            kro_nama: 'Sarana Bidang Pendidikan', ro_nama: '',
            akun: akun, detail_akun: detail_akun, detail_belanja: it[0],
            vol: vol, sat: it[2], hrg_sat: hrg, jumlah: jumlah,
            sd: sd, kategori: kat, jenis: kodeToJenis(akun),
          });
        });
      });
    });
  });
  return recs;
}

/* ── Akses data ── */
function recordsForYear(yr) { return APP.records.filter(function (r) { return r.ta === String(yr); }); }
function recordsView(yr, stage) { return APP.records.filter(function (r) { return r.ta === String(yr) && r.tahap === stage; }); }
function amountOf(r) { return +r.jumlah || 0; }
function kodeOf(r) { return [r.ba, r.prog, r.keg, r.kro, r.ro, r.komp, r.subkomp, r.akun].join('.'); }

/* ── 6 Kartu ── */
function computeCards(yr, stage) {
  var s = { total: 0, ops: 0, nonops: 0, pegawai: 0, barang: 0, modal: 0, baris: 0 };
  recordsView(yr, stage).forEach(function (r) {
    var a = amountOf(r); s.baris++;
    s.total += a; (r.kategori === 'ops' ? s.ops += a : s.nonops += a); s[r.jenis] += a;
  });
  return s;
}
function cardHtml(cls, ic, icon, lbl, val, sub, pct, fill, mL, mR) {
  return '<div class="kpi ' + cls + '">' +
    '<div class="kpi-hdr"><span class="kpi-lbl">' + lbl + '</span>' +
    '<div class="kpi-ic ' + ic + '"><i class="fas fa-' + icon + '"></i></div></div>' +
    '<div class="kpi-val">' + val + '</div><div class="kpi-sub">' + sub + '</div>' +
    '<div class="kpi-bar-wrap"><div class="kpi-track">' +
    '<div class="kpi-fill ' + fill + '" style="width:' + Math.min(pct, 100) + '%"></div></div>' +
    '<div class="kpi-meta"><span>' + mL + '</span><span>' + mR + '</span></div></div></div>';
}
function cardsMarkup(yr, stage) {
  var s = computeCards(yr, stage), st = STAGE_LABEL[stage];
  function p(x) { return s.total > 0 ? (x / s.total * 100) : 0; }
  return (
    cardHtml('k-tot', 'g', 'sack-dollar', 'Total Anggaran (Ops + Non Ops)', fmtRp(s.total), 'PAGU ' + st + ' · TA ' + yr, 100, 'b', 'Keseluruhan usulan', s.baris + ' baris') +
    cardHtml('k-ops', 't', 'gear', 'Total Belanja Operasional', fmtRp(s.ops), p(s.ops).toFixed(1) + '% dari total', p(s.ops), 't', 'Operasional / Total', p(s.ops).toFixed(1) + '%') +
    cardHtml('k-nonops', 'v', 'diagram-project', 'Total Belanja Non Operasional', fmtRp(s.nonops), p(s.nonops).toFixed(1) + '% dari total', p(s.nonops), 't', 'Non Ops / Total', p(s.nonops).toFixed(1) + '%') +
    cardHtml('k-peg', 'b', 'user-tie', 'Total Belanja Pegawai', fmtRp(s.pegawai), p(s.pegawai).toFixed(1) + '% dari total', p(s.pegawai), 'b', 'Pegawai / Total', p(s.pegawai).toFixed(1) + '%') +
    cardHtml('k-brg', 't', 'boxes-stacked', 'Total Belanja Barang', fmtRp(s.barang), p(s.barang).toFixed(1) + '% dari total', p(s.barang), 't', 'Barang / Total', p(s.barang).toFixed(1) + '%') +
    cardHtml('k-mod', 'a', 'building', 'Total Belanja Modal', fmtRp(s.modal), p(s.modal).toFixed(1) + '% dari total', p(s.modal), 'a', 'Modal / Total', p(s.modal).toFixed(1) + '%')
  );
}
function renderCards() {
  var html = cardsMarkup(APP.year, APP.stage);
  var a = document.getElementById('kpiRow'); if (a) a.innerHTML = html;
  var b = document.getElementById('pengKpiRow'); if (b) b.innerHTML = html;
  var sub = document.getElementById('dashSub'); if (sub) sub.textContent = APP.satker + ' — TA ' + APP.year + ' · PAGU ' + STAGE_LABEL[APP.stage];
  var ps = document.getElementById('pengSub'); if (ps) ps.textContent = 'Data tersimpan — TA ' + APP.year + ' · PAGU ' + STAGE_LABEL[APP.stage];
}

/* ── Chart Usulan ── */
var CHARTS = { usulan: null, pie1: null, pie2: null };
function chartReady() { return typeof Chart !== 'undefined'; }
function gridColor() { return getComputedStyle(document.body).getPropertyValue('--bd') || '#e2e8f0'; }
function tickColor() { return getComputedStyle(document.body).getPropertyValue('--t3') || '#8896a7'; }
function stageTotals(yr) { return STAGES.map(function (s) { var t = 0; recordsView(yr, s.key).forEach(function (r) { t += amountOf(r); }); return t; }); }
function renderUsulanChart() {
  if (!chartReady()) return;
  var ctx = document.getElementById('usulanChart'); if (!ctx) return;
  if (CHARTS.usulan) { CHARTS.usulan.destroy(); CHARTS.usulan = null; }
  var labels = STAGES.map(function (s) { return s.label; }), datasets, sub;
  if (APP.usulanMode === 'compare') {
    var ys = yearOptions(), pal = ['#1a56db', '#0e9f6e', '#c27803'];
    datasets = ys.map(function (yr, i) { return { label: 'TA ' + yr, data: stageTotals(yr).map(function (v) { return v / 1e6; }), backgroundColor: pal[i], borderRadius: 5, maxBarThickness: 30 }; });
    sub = 'Perbandingan 3 tahun per tahap PAGU (Juta Rupiah)';
  } else {
    datasets = [{ label: 'TA ' + APP.year, data: stageTotals(APP.year).map(function (v) { return v / 1e6; }), backgroundColor: ['#93b4f5', '#6f9bf0', '#1a56db', '#0e9f6e'], borderRadius: 6, maxBarThickness: 70 }];
    sub = 'Nilai usulan per tahap PAGU — TA ' + APP.year + ' (Juta Rupiah)';
  }
  var se = document.getElementById('usulanSub'); if (se) se.textContent = sub;
  CHARTS.usulan = new Chart(ctx, {
    type: 'bar', data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: APP.usulanMode === 'compare', labels: { color: tickColor(), boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmtM(c.parsed.y * 1e6); } } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor(), font: { size: 11, weight: '600' } } },
        y: { grid: { color: gridColor() }, ticks: { color: tickColor(), callback: function (v) { return v.toLocaleString('id-ID') + ' Jt'; } } },
      },
    },
  });
}

/* ── Pie ── */
function jenisComposition(rows) { var c = { pegawai: 0, barang: 0, modal: 0 }; rows.forEach(function (r) { c[r.jenis] += amountOf(r); }); return c; }
function renderPie(canvasId, legendId, comp) {
  if (!chartReady()) return null;
  var ctx = document.getElementById(canvasId); if (!ctx) return null;
  var order = ['pegawai', 'barang', 'modal'], total = order.reduce(function (a, k) { return a + comp[k]; }, 0);
  var chart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: order.map(function (k) { return JENIS_LABEL[k]; }), datasets: [{ data: order.map(function (k) { return comp[k]; }), backgroundColor: order.map(function (k) { return JENIS_COLOR[k]; }), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (cx) { var p = total > 0 ? (cx.parsed / total * 100).toFixed(1) : '0'; return cx.label + ': ' + fmtM(cx.parsed) + ' (' + p + '%)'; } } } } },
  });
  var leg = document.getElementById(legendId);
  if (leg) leg.innerHTML = order.map(function (k) { var p = total > 0 ? (comp[k] / total * 100).toFixed(1) : '0.0'; return '<div class="leg-row"><span class="leg-dot" style="background:' + JENIS_COLOR[k] + '"></span>' + JENIS_LABEL[k] + '<span class="leg-pct">' + p + '%</span></div>'; }).join('');
  return chart;
}
function renderPie1() { if (CHARTS.pie1) { CHARTS.pie1.destroy(); CHARTS.pie1 = null; } var rows = recordsView(APP.year, APP.stage).filter(function (r) { return APP.pie1Src === 'gabungan' ? true : r.sd === APP.pie1Src; }); CHARTS.pie1 = renderPie('pie1Chart', 'pie1Legend', jenisComposition(rows)); }
function renderPie2() { if (CHARTS.pie2) { CHARTS.pie2.destroy(); CHARTS.pie2 = null; } var rows = recordsView(APP.year, APP.stage).filter(function (r) { return APP.pie2Cat === 'gabungan' ? true : r.kategori === APP.pie2Cat; }); CHARTS.pie2 = renderPie('pie2Chart', 'pie2Legend', jenisComposition(rows)); }

/* ── DAFTAR USULAN (pohon, gaya gambar 2) ── */
function ufApply(rows) {
  var f = APP.uf, q = ((document.getElementById('ufQ') || {}).value || '').toLowerCase().trim();
  return rows.filter(function (r) {
    if (f.prog && r.prog !== f.prog) return false;
    if (f.kro && r.kro !== f.kro) return false;
    if (f.ro && r.ro !== f.ro) return false;
    if (f.akun && r.akun !== f.akun) return false;
    if (f.detail && r.detail_belanja !== f.detail) return false;
    if (f.sd && r.sd !== f.sd) return false;
    if (q) { var hay = [kodeOf(r), r.detail_akun, r.detail_belanja, r.akun, r.prog, r.kro, r.ro].join(' ').toLowerCase(); if (hay.indexOf(q) === -1) return false; }
    return true;
  });
}
function groupByKode(rows) {
  var map = {}, order = [];
  rows.forEach(function (r) {
    var k = kodeOf(r);
    if (!map[k]) { map[k] = { kode: k, akun: r.akun, detail_akun: r.detail_akun, sd: r.sd, prog: r.prog, keg_nama: r.keg_nama, ro: r.ro, items: [], total: 0 }; order.push(k); }
    map[k].items.push(r); map[k].total += amountOf(r);
    if (map[k].sd !== r.sd) map[k].sd = 'mix';
  });
  return order.map(function (k) { return map[k]; });
}
function sdChip(sd) { return sd === 'mix' ? '<span class="src-rm">RM/BLU</span>' : '<span class="' + (sd === 'blu' ? 'src-blu' : 'src-rm') + '">' + (sd === 'blu' ? 'BLU' : 'RM') + '</span>'; }
function catChip(kat) { return '<span class="' + (kat === 'ops' ? 'cat-ops' : 'cat-nonops') + '">' + (kat === 'ops' ? 'OPS' : 'NON OPS') + '</span>'; }
function populateUsulanFilters() {
  var rows = recordsView(APP.year, APP.stage);
  function uniq(key) { var s = {}; rows.forEach(function (r) { s[r[key]] = true; }); return Object.keys(s).sort(); }
  var defs = [['ufProg', 'prog', 'Semua Program', uniq('prog')], ['ufKro', 'kro', 'Semua KRO', uniq('kro')], ['ufRo', 'ro', 'Semua RO', uniq('ro')], ['ufAkun', 'akun', 'Semua Akun', uniq('akun')], ['ufDetail', 'detail', 'Semua Detail', uniq('detail_belanja')]];
  defs.forEach(function (d) {
    var sel = document.getElementById(d[0]); if (!sel) return;
    var cur = APP.uf[d[1]];
    sel.innerHTML = '<option value="">' + d[2] + '</option>' + d[3].map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  });
}
function renderUsulanList() {
  var headEl = document.getElementById('usulanHead');
  if (headEl) headEl.innerHTML = ['KODE', 'URAIAN / AKUN', 'SUMBER', 'NILAI USULAN'].map(function (c, i) { return '<th' + (i === 3 ? ' style="text-align:right"' : '') + '>' + c + '</th>'; }).join('');
  var groups = groupByKode(ufApply(recordsView(APP.year, APP.stage)));
  var totalGroups = groups.length, from = (APP.usulanPage - 1) * APP.PP, slice = groups.slice(from, from + APP.PP);
  var grand = 0; groups.forEach(function (g) { grand += g.total; });
  var badge = document.getElementById('usulanBadge'); if (badge) badge.textContent = totalGroups + ' Kegiatan';
  var info = document.getElementById('usulanInfo'); if (info) info.textContent = totalGroups === 0 ? 'Tidak ada usulan' : ('Menampilkan ' + (from + 1) + '–' + Math.min(from + APP.PP, totalGroups) + ' dari ' + totalGroups + ' · Total ' + fmtRp(grand));
  var body = document.getElementById('usulanBody');
  if (body) {
    if (!slice.length) {
      body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:34px;color:var(--t3)"><i class="fas fa-inbox" style="font-size:22px;display:block;margin-bottom:8px"></i>Belum ada usulan pada PAGU ' + STAGE_LABEL[APP.stage] + '</td></tr>';
    } else {
      var html = '';
      slice.forEach(function (g) {
        var open = !!APP.expanded[g.kode];
        html += '<tr class="detail-parent ' + (open ? 'expanded' : '') + '" onclick="toggleUsulan(\'' + g.kode + '\')">' +
          '<td class="mono">' + esc(g.kode) + '</td>' +
          '<td><div class="uraian-cell">' + esc(g.detail_akun) + '<small>' + esc(g.prog) + ' · ' + esc(g.keg_nama) + ' — RO ' + esc(g.ro) + '</small></div></td>' +
          '<td>' + sdChip(g.sd) + '</td>' +
          '<td class="mono" style="text-align:right;font-weight:700;color:var(--t1)">' + fmtRp(g.total) + '</td></tr>';
        if (open) g.items.forEach(function (r) {
          html += '<tr class="detail-row"><td></td>' +
            '<td>' + esc(r.detail_belanja) + ' <span style="color:var(--t3)">(' + r.vol + ' ' + esc(r.sat) + ' × ' + fmtRp(r.hrg_sat) + ')</span></td><td></td>' +
            '<td class="mono" style="text-align:right">' + fmtRp(amountOf(r)) + '</td></tr>';
        });
      });
      body.innerHTML = html;
    }
  }
  renderPagin('usulanPagin', totalGroups, APP.usulanPage, APP.PP, 'goUsulan');
}
function toggleUsulan(kode) { APP.expanded[kode] = !APP.expanded[kode]; renderUsulanList(); }
function goUsulan(p) { APP.usulanPage = p; renderUsulanList(); }
function onUf(key, val) { APP.uf[key] = val; APP.usulanPage = 1; renderUsulanList(); }
function onUfSearch() { APP.usulanPage = 1; renderUsulanList(); }

function renderPagin(elId, total, page, pp, cb) {
  var el = document.getElementById(elId); if (!el) return;
  var pages = Math.max(1, Math.ceil(total / pp));
  if (pages <= 1) { el.innerHTML = ''; return; }
  var h = '<button class="pg" ' + (page <= 1 ? 'disabled' : '') + ' onclick="' + cb + '(' + (page - 1) + ')">‹</button>';
  for (var p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) h += '<button class="pg ' + (p === page ? 'act' : '') + '" onclick="' + cb + '(' + p + ')">' + p + '</button>';
    else if (Math.abs(p - page) === 2) h += '<span class="pg" style="border:none;background:none">…</span>';
  }
  h += '<button class="pg" ' + (page >= pages ? 'disabled' : '') + ' onclick="' + cb + '(' + (page + 1) + ')">›</button>';
  el.innerHTML = h;
}

/* ── DATABASE (gaya gambar: 16 kolom) di Modul Penganggaran ── */
function renderDatabase() {
  var head = document.getElementById('dbHead');
  var cols = ['KODE', 'DETAIL AKUN', 'DETAIL BELANJA', 'VOL', 'SAT', 'HRG SAT', 'JUMLAH', 'SD', 'KATGR', 'AKSI'];
  if (head) head.innerHTML = cols.map(function (c) {
    var right = (c === 'VOL' || c === 'HRG SAT' || c === 'JUMLAH') ? ' style="text-align:right"' : '';
    var center = (c === 'KATGR' || c === 'AKSI') ? ' style="text-align:center"' : '';
    return '<th' + right + center + '>' + c + '</th>';
  }).join('');
  var rows = recordsView(APP.year, APP.stage);
  var from = (APP.dbPage - 1) * APP.PP, slice = rows.slice(from, from + APP.PP);
  var badge = document.getElementById('dbBadge'); if (badge) badge.textContent = rows.length + ' Baris';
  var info = document.getElementById('dbInfo'); if (info) info.textContent = rows.length === 0 ? 'Belum ada data tersimpan pada PAGU ' + STAGE_LABEL[APP.stage] : ('PAGU ' + STAGE_LABEL[APP.stage] + ' · ' + (from + 1) + '–' + Math.min(from + APP.PP, rows.length) + ' dari ' + rows.length);
  var body = document.getElementById('dbBody');
  if (body) body.innerHTML = slice.length ? slice.map(function (r) {
    var aksi = isLoggedIn()
      ? '<div class="row-act">' +
        '<button class="ra-edit" title="Edit" onclick="editRow(\'' + r.id + '\')"><i class="fas fa-pen"></i></button>' +
        '<button class="ra-del" title="Hapus" onclick="deleteRow(\'' + r.id + '\')"><i class="fas fa-trash"></i></button></div>'
      : '<span style="color:var(--t3)">—</span>';
    return '<tr>' +
      '<td class="mono">' + esc(kodeOf(r)) + '</td>' +
      '<td>' + esc(r.detail_akun) + '</td><td>' + esc(r.detail_belanja) + '</td>' +
      '<td class="mono" style="text-align:right">' + r.vol + '</td><td>' + esc(r.sat) + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtRp(r.hrg_sat) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:600;color:var(--t1)">' + fmtRp(amountOf(r)) + '</td>' +
      '<td>' + sdChip(r.sd) + '</td>' +
      '<td style="text-align:center">' + catChip(r.kategori) + '</td>' +
      '<td style="text-align:center">' + aksi + '</td></tr>';
  }).join('') : '<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--t3)">Belum ada data tersimpan</td></tr>';
  renderPagin('dbPagin', rows.length, APP.dbPage, APP.PP, 'goDb');
}
function goDb(p) { APP.dbPage = p; renderDatabase(); }

/* ── Download Kertas Kerja (CSV, semua tahap tahun aktif) ── */
function csvCell(v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
/* Kolom matriks untuk satu record: Operasional/Non-Op × jenis × sumber dana */
function kkColOf(r) {
  var j = kodeToJenis(r.akun);
  if (j === 'modal') return 'AB';
  if (j === 'pegawai') return 'W';
  if (r.kategori === 'ops') return r.sd === 'blu' ? 'Y' : 'X';
  return r.sd === 'blu' ? 'AA' : 'Z';
}
/* Uraian dari refData berdasarkan kode + jalur induk (akurat utk kode berulang) */
function refUraian(level, kode, parentPath) {
  var arr = APP.refData[level] || [], i;
  for (i = 0; i < arr.length; i++) if (arr[i].kode === kode && (parentPath == null || (arr[i].induk || '') === parentPath)) return arr[i].uraian || '';
  for (i = 0; i < arr.length; i++) if (arr[i].kode === kode) return arr[i].uraian || '';
  return '';
}
function downloadKertasKerja() {
  var rows = recordsView(APP.year, APP.stage);
  if (!rows.length) { toast('error', 'Tidak Ada Data', 'Belum ada usulan pada TA ' + APP.year + ' tahap ' + (STAGE_LABEL[APP.stage] || APP.stage) + '.'); return; }

  function node(kode, uraian, level) { return { kode: kode, uraian: uraian, level: level, total: 0, b: { W: 0, X: 0, Y: 0, Z: 0, AA: 0, AB: 0 }, sd: { rm: 0, blu: 0, sbsn: 0 }, order: [], map: {}, details: [], sdLabel: '' }; }
  function child(p, kode, uraian, level) { if (!p.map[kode]) { p.map[kode] = node(kode, uraian, level); p.order.push(kode); } return p.map[kode]; }
  function add(n, col, amt, sd) { n.total += amt; n.b[col] += amt; n.sd[sd] = (n.sd[sd] || 0) + amt; }

  var unit = (rows[0].prog || '').split('.')[0] || '12';
  var root = node('022.' + unit, 'POLITEKNIK ILMU PELAYARAN MAKASSAR', 'unit');
  rows.forEach(function (r) {
    var col = kkColOf(r), amt = amountOf(r), sd = r.sd;
    var pPath = r.prog, kPath = r.prog + '.' + r.keg, krPath = kPath + '.' + r.kro, roPath = krPath + '.' + r.ro;
    add(root, col, amt, sd);
    var nP = child(root, '022.' + r.prog, refUraian('program', r.prog, '') || r.prog_nama || '', 'program'); add(nP, col, amt, sd);
    var nK = child(nP, r.keg, refUraian('kegiatan', r.keg, pPath) || r.keg_nama || '', 'kegiatan'); add(nK, col, amt, sd);
    var nR = child(nK, r.keg + '.' + r.kro, refUraian('kro', r.kro, kPath) || r.kro_nama || '', 'kro'); add(nR, col, amt, sd);
    var nO = child(nR, r.keg + '.' + r.kro + '.' + r.ro, refUraian('ro', r.ro, krPath) || r.ro_nama || '', 'ro'); add(nO, col, amt, sd);
    var nC = child(nO, r.komp, refUraian('komponen', r.komp, roPath), 'komponen'); add(nC, col, amt, sd);
    var nS = child(nC, r.subkomp || '-', r.subkomp_nama || '', 'subkomp'); add(nS, col, amt, sd);
    var nA = child(nS, r.akun, refUraian('akun', r.akun, r.sd) || 'Belanja', 'akun'); nA.sdLabel = r.sd; add(nA, col, amt, sd);
    nA.details.push(r);
  });

  var NCOL = 31;
  function n(v) { return (v || v === 0) ? '<td class="num">' + Math.round(v) + '</td>' : '<td></td>'; }
  function e() { return '<td></td>'; }
  function structRow(nd) {
    var pad = ({ unit: 0, program: 1, kegiatan: 2, kro: 3, ro: 4, komponen: 5, subkomp: 6, akun: 7 })[nd.level] * 11;
    var cls = (nd.level === 'unit' || nd.level === 'program' || nd.level === 'kegiatan') ? 'lv-top' : 'lv-st';
    var html = '<tr class="' + cls + '">';
    html += '<td class="k">' + esc(nd.kode) + '</td>';
    html += '<td style="padding-left:' + (4 + pad) + 'px">' + esc(nd.uraian) + '</td>';
    for (var i = 0; i < 14; i++) html += e();           // Rincian volume (kosong di baris struktur)
    html += e() + e() + e();                            // Vol, Satuan, Harga
    html += n(nd.total);                                // Jumlah
    html += n(nd.b.W) + n(nd.b.X) + n(nd.b.Y);          // Operasional: Pegawai-RM, Barang-RM, Barang-BLU
    html += n(nd.b.Z) + n(nd.b.AA) + n(nd.b.AB);        // Non-Op: Barang-RM, Barang-BLU, Modal
    html += n(nd.sd.rm) + n(nd.sd.blu) + n(nd.sd.sbsn); // Sumber Dana RM/BLU/SBSN
    html += n(nd.total);                                // Jumlah Raya
    html += '<td class="ctr">' + (nd.level === 'akun' && nd.sdLabel ? esc(nd.sdLabel.toUpperCase()) : '') + '</td>';
    return html + '</tr>';
  }
  function detailRow(d) {
    var html = '<tr>';
    html += e();                                        // KODE kosong
    html += '<td style="padding-left:90px">- ' + esc(d.detail_belanja || d.detail_akun || '') + '</td>';
    html += n(d.vol) + '<td>' + esc(d.sat || '') + '</td>' + e(); // grup1: vol1, sat1, x
    for (var i = 0; i < 11; i++) html += e();           // grup 2-5 kosong
    html += n(d.vol) + '<td>' + esc(d.sat || '') + '</td>' + n(d.hrg_sat); // Vol, Satuan, Harga
    html += n(amountOf(d));                             // Jumlah
    for (var k = 0; k < 11; k++) html += e();           // matriks + SD + JumlahRaya + SD-label kosong
    return html + '</tr>';
  }
  var body = [];
  (function emit(nd) {
    body.push(structRow(nd));
    if (nd.level === 'akun') nd.details.forEach(function (d) { body.push(detailRow(d)); });
    else nd.order.forEach(function (k) { emit(nd.map[k]); });
  })(root);

  var H = '<tr>'
    + '<th class="hd" rowspan="2">KODE</th><th class="hd" rowspan="2">URAIAN</th>'
    + '<th class="hd" colspan="14">Rincian Perhitungan Volume</th>'
    + '<th class="hd" rowspan="2">Vol</th><th class="hd" rowspan="2">Satuan</th><th class="hd" rowspan="2">Harga</th><th class="hd" rowspan="2">Jumlah</th>'
    + '<th class="hd" colspan="3">Belanja Operasional</th><th class="hd" colspan="3">Belanja Non Operasional</th>'
    + '<th class="hd" colspan="3">Sumber Dana</th><th class="hd" rowspan="2">Jumlah Raya</th><th class="hd" rowspan="2">SD</th></tr>';
  H += '<tr>';
  for (var g = 1; g <= 5; g++) { H += '<th class="hd2">Vol' + g + '</th><th class="hd2">Sat' + g + '</th>' + (g < 5 ? '<th class="hd2">×</th>' : ''); }
  H += '<th class="hd2">Pegawai<br>RM</th><th class="hd2">Barang<br>RM</th><th class="hd2">Barang<br>BLU</th>';
  H += '<th class="hd2">Barang<br>RM</th><th class="hd2">Barang<br>BLU</th><th class="hd2">Modal<br>SBSN</th>';
  H += '<th class="hd2">RM</th><th class="hd2">BLU</th><th class="hd2">SBSN</th></tr>';

  var style = 'table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11px}'
    + 'td,th{border:0.5pt solid #9aa7b6;padding:2px 6px;vertical-align:middle}'
    + '.hd{background:#1F3A5F;color:#fff;font-weight:bold;text-align:center}'
    + '.hd2{background:#33507A;color:#fff;font-weight:bold;text-align:center}'
    + '.k{font-family:Consolas,monospace}.ctr{text-align:center}'
    + '.num{text-align:right;mso-number-format:"\\#\\,\\#\\#0"}'
    + '.tt{font-weight:bold;border:none;text-align:left}'
    + '.lv-top{background:#dbe5f3;font-weight:bold}.lv-st{background:#eef3fb;font-weight:bold}';
  var title = '<tr><td class="tt" colspan="' + NCOL + '" style="font-size:14px">KOMPOSISI ANGGARAN</td></tr>'
    + '<tr><td class="tt" colspan="' + NCOL + '">POLITEKNIK ILMU PELAYARAN MAKASSAR</td></tr>'
    + '<tr><td class="tt" colspan="' + NCOL + '">Kertas Kerja T.A ' + APP.year + ' — Tahap ' + (STAGE_LABEL[APP.stage] || APP.stage) + '</td></tr>'
    + '<tr><td colspan="' + NCOL + '" style="border:none">&nbsp;</td></tr>';
  var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">'
    + '<head><meta charset="utf-8"><style>' + style + '</style></head><body><table>'
    + title + H + body.join('') + '</table></body></html>';

  var blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  var url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'Kertas_Kerja_PIP_Makassar_TA' + APP.year + '_' + (STAGE_LABEL[APP.stage] || APP.stage) + '.xls';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('success', 'Kertas Kerja Diunduh', 'Format Komposisi Anggaran · TA ' + APP.year + ' tahap ' + (STAGE_LABEL[APP.stage] || APP.stage) + ' · ' + rows.length + ' detail.');
}

/* ── Download Kertas Kerja (XLSX dgn RUMUS hidup + TABEL berformat) ──
   Output .xlsx asli, tampilan tabel (garis, warna header, shading bertingkat)
   meniru fitur "Download Kertas Kerja" — TETAPI angkanya rumus hidup:
   Jumlah detail = =Vol*Harga, Jumlah baris struktur (akun→unit) = SUM ke atas,
   kolom matriks & Sumber Dana juga rumus. Memakai xlsx-js-style (global XLSX). */
function downloadKertasKerjaXLSX() {
  if (typeof XLSX === 'undefined') { toast('error', 'Pustaka Tidak Siap', 'Pustaka penulis Excel belum dimuat.'); return; }
  var rows = recordsView(APP.year, APP.stage);
  if (!rows.length) { toast('error', 'Tidak Ada Data', 'Belum ada usulan pada TA ' + APP.year + ' tahap ' + (STAGE_LABEL[APP.stage] || APP.stage) + '.'); return; }

  /* Bangun pohon agregasi (sama logikanya dgn downloadKertasKerja) */
  function node(kode, uraian, level) { return { kode: kode, uraian: uraian, level: level, total: 0, b: { W: 0, X: 0, Y: 0, Z: 0, AA: 0, AB: 0 }, sd: { rm: 0, blu: 0, sbsn: 0 }, order: [], map: {}, details: [], sdLabel: '', _row: 0 }; }
  function child(p, kode, uraian, level) { if (!p.map[kode]) { p.map[kode] = node(kode, uraian, level); p.order.push(kode); } return p.map[kode]; }
  function add(n, col, amt, sd) { n.total += amt; n.b[col] += amt; n.sd[sd] = (n.sd[sd] || 0) + amt; }

  var unit = (rows[0].prog || '').split('.')[0] || '12';
  var root = node('022.' + unit, 'POLITEKNIK ILMU PELAYARAN MAKASSAR', 'unit');
  rows.forEach(function (r) {
    var col = kkColOf(r), amt = amountOf(r), sd = r.sd;
    var pPath = r.prog, kPath = r.prog + '.' + r.keg, krPath = kPath + '.' + r.kro, roPath = krPath + '.' + r.ro;
    add(root, col, amt, sd);
    var nP = child(root, '022.' + r.prog, refUraian('program', r.prog, '') || r.prog_nama || '', 'program'); add(nP, col, amt, sd);
    var nK = child(nP, r.keg, refUraian('kegiatan', r.keg, pPath) || r.keg_nama || '', 'kegiatan'); add(nK, col, amt, sd);
    var nR = child(nK, r.keg + '.' + r.kro, refUraian('kro', r.kro, kPath) || r.kro_nama || '', 'kro'); add(nR, col, amt, sd);
    var nO = child(nR, r.keg + '.' + r.kro + '.' + r.ro, refUraian('ro', r.ro, krPath) || r.ro_nama || '', 'ro'); add(nO, col, amt, sd);
    var nC = child(nO, r.komp, refUraian('komponen', r.komp, roPath), 'komponen'); add(nC, col, amt, sd);
    var nS = child(nC, r.subkomp || '-', r.subkomp_nama || '', 'subkomp'); add(nS, col, amt, sd);
    var nA = child(nS, r.akun, refUraian('akun', r.akun, r.sd) || 'Belanja', 'akun'); nA.sdLabel = r.sd; add(nA, col, amt, sd);
    nA.details.push(r);
  });

  /* Tata letak kolom (0-indeks) — sama dgn versi HTML, NCOL = 31 */
  var C = { KODE: 0, URAIAN: 1, RV0: 2, VOL: 16, SAT: 17, HRG: 18, JML: 19, RAYA: 29, SDLBL: 30 };
  var MX = { W: 20, X: 21, Y: 22, Z: 23, AA: 24, AB: 25 };           // kolom matriks (Operasional/Non-Op/Modal)
  var SDC = { rm: 26, blu: 27, sbsn: 28 };                            // kolom Sumber Dana
  var MONEY = '#,##0';
  var lastCol = 30;

  var ws = {}, rowMeta = {};                                          // rowMeta[r] = { kind, ind }
  function L(c) { return XLSX.utils.encode_col(c); }                  // indeks kolom → huruf
  function A1(c, r0) { return L(c) + (r0 + 1); }                      // alamat A1 (r0 = 0-indeks)
  function put(r0, c, cell) { ws[XLSX.utils.encode_cell({ r: r0, c: c })] = cell; }
  function numCell(v) { return { t: 'n', v: v, z: MONEY }; }
  function moneyF(f) { return { t: 'n', f: f, z: MONEY }; }
  function txt(v) { return { t: 's', v: String(v == null ? '' : v) }; }
  function padOf(level) { return { unit: 0, program: 1, kegiatan: 2, kro: 3, ro: 4, komponen: 5, subkomp: 6, akun: 7 }[level] || 0; }

  /* Header & judul */
  var r0 = 0;
  put(r0, 0, txt('KOMPOSISI ANGGARAN')); rowMeta[r0] = { kind: 'title', sz: 14 }; r0++;
  put(r0, 0, txt('POLITEKNIK ILMU PELAYARAN MAKASSAR')); rowMeta[r0] = { kind: 'title', sz: 11 }; r0++;
  put(r0, 0, txt('Kertas Kerja T.A ' + APP.year + ' — Tahap ' + (STAGE_LABEL[APP.stage] || APP.stage))); rowMeta[r0] = { kind: 'title', sz: 11 }; r0++;
  rowMeta[r0] = { kind: 'blank' }; r0++; // baris kosong
  var HR1 = r0, HR2 = r0 + 1;
  rowMeta[HR1] = { kind: 'h1' }; rowMeta[HR2] = { kind: 'h2' };
  put(HR1, C.KODE, txt('KODE')); put(HR1, C.URAIAN, txt('URAIAN'));
  put(HR1, C.RV0, txt('Rincian Perhitungan Volume'));
  put(HR1, C.VOL, txt('Vol')); put(HR1, C.SAT, txt('Satuan')); put(HR1, C.HRG, txt('Harga')); put(HR1, C.JML, txt('Jumlah'));
  put(HR1, MX.W, txt('Belanja Operasional')); put(HR1, MX.Z, txt('Belanja Non Operasional'));
  put(HR1, SDC.rm, txt('Sumber Dana')); put(HR1, C.RAYA, txt('Jumlah Raya')); put(HR1, C.SDLBL, txt('SD'));
  // sub-header baris-2: grup Vol1..Sat5 + label matriks + RM/BLU/SBSN
  var sub = ['Vol1', 'Sat1', '×', 'Vol2', 'Sat2', '×', 'Vol3', 'Sat3', '×', 'Vol4', 'Sat4', '×', 'Vol5', 'Sat5'];
  for (var s = 0; s < sub.length; s++) put(HR2, C.RV0 + s, txt(sub[s]));
  put(HR2, MX.W, txt('Pegawai RM')); put(HR2, MX.X, txt('Barang RM')); put(HR2, MX.Y, txt('Barang BLU'));
  put(HR2, MX.Z, txt('Barang RM')); put(HR2, MX.AA, txt('Barang BLU')); put(HR2, MX.AB, txt('Modal SBSN'));
  put(HR2, SDC.rm, txt('RM')); put(HR2, SDC.blu, txt('BLU')); put(HR2, SDC.sbsn, txt('SBSN'));
  r0 = HR2 + 1; // baris data pertama

  /* Sum dari daftar alamat A1 (kosong → ''); range bila kontigu */
  function sumRefs(refs) { return refs.length ? 'SUM(' + refs.join(',') + ')' : ''; }

  var cursor = { r: r0 };
  /* Emit rekursif. Mengembalikan baris (0-indeks) tempat node ditulis. */
  function emit(nd) {
    var my = cursor.r++; nd._row = my;
    var topLv = (nd.level === 'unit' || nd.level === 'program' || nd.level === 'kegiatan');
    rowMeta[my] = { kind: topLv ? 'top' : 'sub', ind: padOf(nd.level) };
    put(my, C.KODE, txt(nd.kode));
    put(my, C.URAIAN, txt(nd.uraian));

    if (nd.level === 'akun') {
      var detRows = [];                     // {row, col(MX key), sd}
      nd.details.forEach(function (d) {
        var dr = cursor.r++;
        rowMeta[dr] = { kind: 'detail', ind: 8 };
        put(dr, C.URAIAN, txt('- ' + (d.detail_belanja || d.detail_akun || '')));
        put(dr, C.RV0, numCell(+d.vol || 0)); put(dr, C.RV0 + 1, txt(d.sat || ''));
        put(dr, C.VOL, numCell(+d.vol || 0)); put(dr, C.SAT, txt(d.sat || ''));
        put(dr, C.HRG, numCell(+d.hrg_sat || 0));
        put(dr, C.JML, moneyF(A1(C.VOL, dr) + '*' + A1(C.HRG, dr)));   // RUMUS PERKALIAN
        detRows.push({ row: dr, col: kkColOf(d), sd: d.sd });
      });
      // Jumlah akun = SUM seluruh detail (rentang kontigu)
      if (detRows.length) {
        var f = A1(C.JML, detRows[0].row) + ':' + A1(C.JML, detRows[detRows.length - 1].row);
        put(my, C.JML, moneyF('SUM(' + f + ')'));
      }
      // Kolom matriks = SUM Jumlah detail per kolom
      Object.keys(MX).forEach(function (k) {
        var refs = detRows.filter(function (x) { return x.col === k; }).map(function (x) { return A1(C.JML, x.row); });
        if (refs.length) put(my, MX[k], moneyF(sumRefs(refs)));
      });
      // Kolom Sumber Dana = SUM Jumlah detail per sumber dana
      Object.keys(SDC).forEach(function (sdk) {
        var refs = detRows.filter(function (x) { return x.sd === sdk; }).map(function (x) { return A1(C.JML, x.row); });
        if (refs.length) put(my, SDC[sdk], moneyF(sumRefs(refs)));
      });
      put(my, C.RAYA, moneyF(A1(C.JML, my)));
      if (nd.sdLabel) put(my, C.SDLBL, txt(String(nd.sdLabel).toUpperCase()));
    } else {
      var childRows = nd.order.map(function (k) { return emit(nd.map[k]); });
      var jmlRefs = childRows.map(function (cr) { return A1(C.JML, cr); });
      if (jmlRefs.length) put(my, C.JML, moneyF(sumRefs(jmlRefs)));
      // Matriks & Sumber Dana = SUM anak (hanya tulis bila totalnya tak nol → tetap blanko spt versi HTML)
      Object.keys(MX).forEach(function (k) {
        if (nd.b[k]) put(my, MX[k], moneyF(sumRefs(childRows.map(function (cr) { return A1(MX[k], cr); }))));
      });
      Object.keys(SDC).forEach(function (sdk) {
        if (nd.sd[sdk]) put(my, SDC[sdk], moneyF(sumRefs(childRows.map(function (cr) { return A1(SDC[sdk], cr); }))));
      });
      put(my, C.RAYA, moneyF(A1(C.JML, my)));
    }
    return my;
  }
  emit(root);
  var lastRow = cursor.r - 1;

  /* ── STYLING: garis tabel, warna header, shading bertingkat ── */
  var THIN = { style: 'thin', color: { rgb: 'FF9AA7B6' } };
  var BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  function isNumCol(c) { return c === C.RV0 || c === C.VOL || c === C.HRG || c === C.JML || (c >= MX.W && c <= C.RAYA); }
  function ensure(r, c) { var a = XLSX.utils.encode_cell({ r: r, c: c }); if (!ws[a]) ws[a] = { t: 's', v: '' }; return ws[a]; }
  for (var rr = 0; rr <= lastRow; rr++) {
    var m = rowMeta[rr] || { kind: 'blank' };
    if (m.kind === 'blank') continue;
    if (m.kind === 'title') {                                          // judul: tebal, tanpa garis
      ws[XLSX.utils.encode_cell({ r: rr, c: 0 })].s = { font: { bold: true, sz: m.sz || 11, color: { rgb: 'FF1B2A3A' } }, alignment: { horizontal: 'left', vertical: 'center' } };
      continue;
    }
    for (var cc = 0; cc <= lastCol; cc++) {
      var cell = ensure(rr, cc), st = { border: BORDER, alignment: { vertical: 'center' } };
      if (m.kind === 'h1' || m.kind === 'h2') {                        // header biru, teks putih
        st.fill = { patternType: 'solid', fgColor: { rgb: m.kind === 'h1' ? 'FF1F3A5F' : 'FF33507A' } };
        st.font = { bold: true, sz: m.kind === 'h1' ? 11 : 9, color: { rgb: 'FFFFFFFF' } };
        st.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
      } else {                                                         // baris data
        var bold = (m.kind === 'top' || m.kind === 'sub');
        if (m.kind === 'top') st.fill = { patternType: 'solid', fgColor: { rgb: 'FFDBE5F3' } };
        else if (m.kind === 'sub') st.fill = { patternType: 'solid', fgColor: { rgb: 'FFEEF3FB' } };
        st.font = { bold: bold, sz: 10, color: { rgb: 'FF1B2A3A' } };
        if (cc === C.KODE) st.font = { bold: bold, sz: 10, name: 'Consolas', color: { rgb: 'FF1B2A3A' } };
        if (cc === C.URAIAN) st.alignment = { vertical: 'center', indent: (m.ind || 0) };
        else if (cc === C.SDLBL) st.alignment = { horizontal: 'center', vertical: 'center' };
        else if (isNumCol(cc)) { st.alignment = { horizontal: 'right', vertical: 'center' }; st.numFmt = MONEY; }
      }
      cell.s = st;
    }
  }

  /* Range, merge sel header, lebar kolom */
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
    { s: { r: HR1, c: C.KODE }, e: { r: HR2, c: C.KODE } },
    { s: { r: HR1, c: C.URAIAN }, e: { r: HR2, c: C.URAIAN } },
    { s: { r: HR1, c: C.RV0 }, e: { r: HR1, c: C.RV0 + 13 } },
    { s: { r: HR1, c: C.VOL }, e: { r: HR2, c: C.VOL } },
    { s: { r: HR1, c: C.SAT }, e: { r: HR2, c: C.SAT } },
    { s: { r: HR1, c: C.HRG }, e: { r: HR2, c: C.HRG } },
    { s: { r: HR1, c: C.JML }, e: { r: HR2, c: C.JML } },
    { s: { r: HR1, c: MX.W }, e: { r: HR1, c: MX.Y } },
    { s: { r: HR1, c: MX.Z }, e: { r: HR1, c: MX.AB } },
    { s: { r: HR1, c: SDC.rm }, e: { r: HR1, c: SDC.sbsn } },
    { s: { r: HR1, c: C.RAYA }, e: { r: HR2, c: C.RAYA } },
    { s: { r: HR1, c: C.SDLBL }, e: { r: HR2, c: C.SDLBL } }
  ];
  ws['!rows'] = []; ws['!rows'][HR1] = { hpt: 18 }; ws['!rows'][HR2] = { hpt: 26 };
  var cols = []; for (var ci = 0; ci <= lastCol; ci++) cols.push({ wch: ci === C.URAIAN ? 50 : (ci === C.KODE ? 16 : (ci >= MX.W && ci <= C.RAYA ? 12 : (ci >= C.RV0 && ci <= C.RV0 + 13 ? 6 : 9))) });
  ws['!cols'] = cols;

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DETAIL');
  var fname = 'Kertas_Kerja_PIP_Makassar_TA' + APP.year + '_' + (STAGE_LABEL[APP.stage] || APP.stage) + '.xlsx';
  XLSX.writeFile(wb, fname, { bookType: 'xlsx' });
  toast('success', 'Kertas Kerja Diunduh', 'Excel berformat + rumus hidup · TA ' + APP.year + ' tahap ' + (STAGE_LABEL[APP.stage] || APP.stage) + ' · ' + rows.length + ' detail.');
}

/* ═══════════════════════════════════════════════════════════════════
   UPLOAD / IMPOR KERTAS KERJA  →  records aplikasi
   Membaca file Excel "Komposisi Anggaran" (format DETAIL) lalu
   mengubah tiap baris Detail Belanja menjadi 1 record usulan_belanja.
   Mendukung file kertas kerja asli (.xlsx) maupun hasil unduhan app (.xls).
   Fungsi inti (kkParseMatrix) bekerja atas array-of-arrays agar bisa diuji.
   ═══════════════════════════════════════════════════════════════════ */

// Angka toleran: "1.234.567" (id) / "1,234,567" (en) / number → Number
function kkNum(x) {
  if (x == null || x === '') return 0;
  if (typeof x === 'number') return isFinite(x) ? x : 0;
  var s = String(x).trim().replace(/\s/g, '');
  if (!s) return 0;
  // buang pemisah ribuan titik & koma, sisakan digit dan minus
  s = s.replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]/g, '');
  var n = parseFloat(s.replace(/[^0-9-]/g, ''));
  return isFinite(n) ? n : 0;
}
function kkText(row, i) { return (i != null && i >= 0 && row[i] != null) ? String(row[i]).trim() : ''; }

// Deteksi indeks kolom dari baris header (cari "KODE" & "URAIAN")
function kkDetectCols(aoa) {
  for (var r = 0; r < Math.min(aoa.length, 15); r++) {
    var row = aoa[r] || [], txt = row.map(function (c) { return String(c == null ? '' : c).trim(); });
    if (txt.indexOf('KODE') === -1 || txt.indexOf('URAIAN') === -1) continue;
    function first(name) { return txt.indexOf(name); }
    function last(names) { var idx = -1; txt.forEach(function (t, i) { if (names.indexOf(t) > -1) idx = i; }); return idx; }
    var c = {
      headerRow: r,
      kode: first('KODE'), uraian: first('URAIAN'),
      vol: first('Vol'), sat: first('Satuan'), harga: first('Harga'), jumlah: first('Jumlah'),
      sd: last(['Sumber Dana', 'SD']),
    };
    if (c.sat < 0) c.sat = first('Sat');
    return c;
  }
  // fallback: tata letak kertas kerja PIP (KODE=B … Jumlah=V … SD=AG)
  return { headerRow: 7, kode: 1, uraian: 2, vol: 18, sat: 19, harga: 20, jumlah: 21, sd: 32 };
}

// Penanda baris Detail Belanja pada kolom URAIAN ("- ..." atau "> ...")
function kkIsDetail(u) { u = (u || '').trim(); return u.length > 0 && (u.charAt(0) === '-' || u.charAt(0) === '>'); }
function kkCleanName(u) { return (u || '').trim().replace(/^[->\s]+/, '').trim(); }

// Tahap & TA dari baris judul (default mengikuti selektor dashboard)
function kkMeta(aoa, cols) {
  var head = '';
  for (var r = 0; r < Math.min(aoa.length, (cols.headerRow || 8)); r++) head += ' ' + (aoa[r] || []).join(' ');
  head = head.toUpperCase();
  var tahap = null;
  // Prioritas: label "PAGU <TAHAP>" (judul memuat kata "ANGGARAN" pada "KOMPOSISI ANGGARAN")
  var pm = head.match(/PAGU\s+(KEBUTUHAN|INDIKATIF|ANGGARAN|ALOKASI)/);
  if (pm) tahap = pm[1].toLowerCase();
  else ['kebutuhan', 'indikatif', 'alokasi', 'anggaran'].forEach(function (k) { if (tahap == null && head.indexOf(k.toUpperCase()) > -1) tahap = k; });
  var my = head.match(/T\.?A\.?\s*(\d{4})/) || head.match(/(20\d{2})/);
  var satker = '';
  (aoa.slice(0, cols.headerRow || 8)).forEach(function (row) {
    (row || []).forEach(function (v) { var s = String(v == null ? '' : v); if (/POLITEKNIK|PIP|SATKER|KEMENTERIAN/i.test(s) && s.length > satker.length) satker = s.trim(); });
  });
  return { tahap: tahap, ta: my ? my[1] : null, satker: satker };
}

/* Inti parser — array baris (kolom 0-indeks) → { records, meta } */
function kkParseMatrix(aoa, override) {
  override = override || {};
  var cols = kkDetectCols(aoa);
  var meta = kkMeta(aoa, cols);
  var ta = String(override.ta || meta.ta || APP.year);
  var tahap = override.tahap || meta.tahap || APP.stage;

  var ctx = { ba: '022', unit: '', prog: '', keg: '', kro: '', ro: '', komp: '', subkomp: '', subkomp_nama: '', akun: '', detail_akun: '', sd: 'rm', kategori: 'nonops', jenis: 'barang', prog_nama: '', keg_nama: '', kro_nama: '', ro_nama: '' };
  var recs = [], started = false;

  function reset() { for (var i = 0; i < arguments.length; i++) ctx[arguments[i]] = ''; }

  for (var i = 0; i < aoa.length; i++) {
    var row = aoa[i] || [];
    var k = kkText(row, cols.kode), u = kkText(row, cols.uraian);

    if (!started) { if (/^\d{3}\.\d+$/.test(k)) started = true; else continue; }

    if (k === '') {
      if (kkIsDetail(u)) {
        var vol = kkNum(row[cols.vol]), sat = kkText(row, cols.sat), hrg = kkNum(row[cols.harga]), jv = kkNum(row[cols.jumlah]);
        recs.push({
          ta: ta, tahap: tahap, ba: ctx.ba, prog: ctx.prog, prog_nama: ctx.prog_nama,
          keg: ctx.keg, keg_nama: ctx.keg_nama, kro: ctx.kro, kro_nama: ctx.kro_nama, ro: ctx.ro, ro_nama: ctx.ro_nama,
          komp: ctx.komp, subkomp: ctx.subkomp || 'A', subkomp_nama: ctx.subkomp_nama,
          akun: ctx.akun, detail_akun: ctx.detail_akun, detail_belanja: kkCleanName(u),
          vol: vol, sat: sat, hrg_sat: hrg, jumlah: (jv > 0 ? jv : vol * hrg),
          sd: ctx.sd, kategori: ctx.kategori, jenis: ctx.jenis,
        });
      }
      continue;
    }
    if (/^\d{3}\.\d+$/.test(k)) { var p = k.split('.'); ctx.ba = p[0]; ctx.unit = p[1]; continue; }              // Unit/Satker
    if (/^\d{3}\.\d+\..*[A-Za-z].*$/.test(k)) { ctx.prog = k.slice(ctx.ba.length + 1); ctx.prog_nama = u; reset('keg', 'kro', 'ro', 'komp', 'subkomp', 'akun'); continue; } // Program
    if (/^\d{4}$/.test(k)) { ctx.keg = k; ctx.keg_nama = u; reset('kro', 'ro', 'komp', 'subkomp', 'akun'); continue; }     // Kegiatan
    if (/^\d{4}\.[A-Za-z]{2,5}$/.test(k)) { ctx.kro = k.split('.').pop(); ctx.kro_nama = u; reset('ro', 'komp', 'subkomp', 'akun'); continue; } // KRO
    if (/^\d{4}\.[A-Za-z]{2,5}\.\d{3}$/.test(k)) { ctx.ro = k.split('.').pop(); ctx.ro_nama = u; reset('komp', 'subkomp', 'akun'); continue; }    // RO
    if (/^\d{3}$/.test(k)) { ctx.komp = k; reset('subkomp', 'akun'); continue; }                                 // Komponen
    if (/^[A-Za-z]\d?$/.test(k)) { ctx.subkomp = k; ctx.subkomp_nama = u; ctx.akun = ''; continue; }             // Sub Komponen
    if (/^\d{6}$/.test(k)) {                                                                                     // Akun
      ctx.akun = k; ctx.detail_akun = u; ctx.jenis = kodeToJenis(k);
      var sdl = kkText(row, cols.sd).toLowerCase();
      ctx.sd = sdl === 'blu' ? 'blu' : (sdl === 'rm' ? 'rm' : ctx.sd);
      var ops = 0, non = 0, j = cols.jumlah;
      if (j >= 0) { ops = kkNum(row[j + 1]) + kkNum(row[j + 2]) + kkNum(row[j + 3]); non = kkNum(row[j + 4]) + kkNum(row[j + 5]) + kkNum(row[j + 6]); }
      ctx.kategori = ops > non ? 'ops' : (non > 0 ? 'nonops' : (ctx.jenis === 'pegawai' ? 'ops' : 'nonops'));
      continue;
    }
  }
  return { records: recs, meta: { ta: ta, tahap: tahap, satker: meta.satker, count: recs.length, total: recs.reduce(function (a, r) { return a + (+r.jumlah || 0); }, 0) } };
}

/* ── Hindari galat upsert 21000 (ON CONFLICT dua kali pada baris sama) ──
   Kunci unik DB = ta,tahap,ba,prog,keg,kro,ro,komp,subkomp,akun,detail_belanja.
   Bila satu file memuat >1 Detail Belanja dengan kunci identik (mis. "Honor
   Mengajar" muncul dua kali pada akun yang sama), upsert satu perintah akan
   menolak. Solusi tanpa kehilangan data: beri akhiran " (2)", " (3)" … pada
   nama detail yang bertabrakan sehingga setiap baris memiliki kunci unik. */
var KK_KEYS = ['ta', 'tahap', 'ba', 'prog', 'keg', 'kro', 'ro', 'komp', 'subkomp', 'akun', 'detail_belanja'];
function kkUpsertKeyOf(r) { return KK_KEYS.map(function (k) { return r[k] == null ? '' : String(r[k]); }).join('\u0001'); }
function kkDedupeForUpsert(records) {
  var seen = {}, rows = [], renamed = 0;
  records.forEach(function (r) {
    var base = kkUpsertKeyOf(r);
    if (!seen[base]) { seen[base] = true; rows.push(r); return; }
    var copy = {}; for (var k in r) copy[k] = r[k];
    var n = 1;
    do { n++; copy.detail_belanja = r.detail_belanja + ' (' + n + ')'; } while (seen[kkUpsertKeyOf(copy)]);
    seen[kkUpsertKeyOf(copy)] = true; rows.push(copy); renamed++;
  });
  return { rows: rows, renamed: renamed };
}

/* ── Glue browser: baca File → array-of-arrays via SheetJS ── */
function kkReadFile(file) {
  return new Promise(function (resolve, reject) {
    if (typeof XLSX === 'undefined') { reject(new Error('Pustaka pembaca Excel (SheetJS) belum dimuat.')); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var sheet = wb.Sheets['DETAIL'] || wb.Sheets[wb.SheetNames[0]];
        var aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
        resolve(aoa);
      } catch (err) { reject(err); }
    };
    reader.onerror = function () { reject(new Error('Gagal membaca file.')); };
    reader.readAsArrayBuffer(file);
  });
}

function openImport() {
  if (!requireLogin('mengunggah kertas kerja')) return;
  APP.importData = null;
  var inp = document.getElementById('impFile'); if (inp) inp.value = '';
  var pv = document.getElementById('impPreview'); if (pv) pv.innerHTML = '';
  var info = document.getElementById('impInfo');
  if (info) info.innerHTML = '<i class="fas fa-circle-info"></i> Unggah file Excel kertas kerja (sheet <strong>DETAIL</strong>, format Komposisi Anggaran). Sistem akan membaca tiap baris Detail Belanja menjadi usulan.';
  // default tujuan TA & Tahap mengikuti dashboard
  var ty = document.getElementById('impTa'); if (ty) ty.innerHTML = yearOptions().map(function (y) { return '<option value="' + y + '"' + (y === APP.year ? ' selected' : '') + '>TA ' + y + '</option>'; }).join('');
  var tp = document.getElementById('impTahap'); if (tp) tp.innerHTML = STAGES.map(function (s) { return '<option value="' + s.key + '"' + (s.key === APP.stage ? ' selected' : '') + '>' + s.label + '</option>'; }).join('');
  var cb = document.getElementById('impConfirmBtn'); if (cb) { cb.disabled = true; cb.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Simpan ke Database'; }
  var m = document.getElementById('importModal'); if (m) m.classList.add('open');
}
function closeImport() { var m = document.getElementById('importModal'); if (m) m.classList.remove('open'); APP.importData = null; }

async function handleImportFile(input) {
  var file = input && input.files && input.files[0]; if (!file) return;
  var pv = document.getElementById('impPreview');
  if (pv) pv.innerHTML = '<div class="imp-loading"><i class="fas fa-spinner fa-spin"></i> Membaca ' + esc(file.name) + ' …</div>';
  try {
    var aoa = await kkReadFile(file);
    var parsed = kkParseMatrix(aoa, {});
    // sinkron pilihan TA/Tahap dengan yang terdeteksi (bila ada)
    if (parsed.meta.ta) { var ty = document.getElementById('impTa'); if (ty) ty.value = parsed.meta.ta; }
    if (parsed.meta.tahap) { var tp = document.getElementById('impTahap'); if (tp) tp.value = parsed.meta.tahap; }
    APP.importData = { records: parsed.records, meta: parsed.meta, fileName: file.name };
    renderImportPreview();
  } catch (e) {
    APP.importData = null;
    if (pv) pv.innerHTML = '<div class="imp-err"><i class="fas fa-triangle-exclamation"></i> ' + esc(e.message) + '</div>';
    var cb = document.getElementById('impConfirmBtn'); if (cb) cb.disabled = true;
    console.error('[SIPRA] import parse', e);
  }
}

function renderImportPreview() {
  var d = APP.importData, pv = document.getElementById('impPreview'); if (!d || !pv) return;
  var recs = d.records;
  if (!recs.length) {
    pv.innerHTML = '<div class="imp-err"><i class="fas fa-triangle-exclamation"></i> Tidak ada baris Detail Belanja terbaca. Pastikan sheet DETAIL & format kertas kerja sesuai.</div>';
    var cb0 = document.getElementById('impConfirmBtn'); if (cb0) cb0.disabled = true; return;
  }
  var total = recs.reduce(function (a, r) { return a + (+r.jumlah || 0); }, 0);
  var akun = {}, kat = { ops: 0, nonops: 0 }, sd = { rm: 0, blu: 0 };
  recs.forEach(function (r) { akun[r.akun] = 1; kat[r.kategori] = (kat[r.kategori] || 0) + r.jumlah; sd[r.sd] = (sd[r.sd] || 0) + r.jumlah; });
  var kegSet = {}; recs.forEach(function (r) { kegSet[kodeOf(r)] = 1; });
  var dupN = kkDedupeForUpsert(recs).renamed;
  var sample = recs.slice(0, 8).map(function (r) {
    return '<tr><td class="mono">' + esc(r.akun) + '</td><td>' + esc(r.detail_belanja) + '</td>' +
      '<td class="mono" style="text-align:right">' + r.vol + '</td><td>' + esc(r.sat) + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtRp(r.hrg_sat) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:600">' + fmtRp(r.jumlah) + '</td>' +
      '<td>' + sdChip(r.sd) + '</td><td style="text-align:center">' + catChip(r.kategori) + '</td></tr>';
  }).join('');
  pv.innerHTML =
    '<div class="imp-stats">' +
    '<div class="imp-stat"><span>' + recs.length + '</span>Detail Belanja</div>' +
    '<div class="imp-stat"><span>' + Object.keys(akun).length + '</span>Akun</div>' +
    '<div class="imp-stat"><span>' + Object.keys(kegSet).length + '</span>Baris Akun</div>' +
    '<div class="imp-stat tot"><span>' + fmtM(total) + '</span>Total Nilai</div>' +
    '</div>' +
    '<div class="imp-note"><i class="fas fa-circle-info"></i> Operasional ' + fmtRp(kat.ops) + ' · Non-Operasional ' + fmtRp(kat.nonops) + ' · RM ' + fmtRp(sd.rm) + ' · BLU ' + fmtRp(sd.blu) + '. Total dihitung dari Volume × Harga tiap baris, sehingga dapat sedikit berbeda dari pagu resmi bila ada baris bernilai nol pada file.' +
    (dupN ? ' <strong>' + dupN + ' baris</strong> memiliki nama Detail Belanja ganda pada akun yang sama — namanya otomatis diberi akhiran (2), (3), … agar tidak saling menimpa saat disimpan.' : '') + '</div>' +
    '<div class="imp-tbl-wrap"><table class="imp-tbl"><thead><tr><th>AKUN</th><th>DETAIL BELANJA</th><th style="text-align:right">VOL</th><th>SAT</th><th style="text-align:right">HRG SAT</th><th style="text-align:right">JUMLAH</th><th>SD</th><th>KAT</th></tr></thead><tbody>' + sample + '</tbody></table>' +
    (recs.length > 8 ? '<div class="imp-more">… dan ' + (recs.length - 8) + ' baris lainnya</div>' : '') + '</div>';
  var cb = document.getElementById('impConfirmBtn'); if (cb) cb.disabled = false;
}

async function confirmImport() {
  if (!APP.importData || !APP.importData.records.length) { toast('error', 'Tidak Ada Data', 'Unggah file kertas kerja dulu.'); return; }
  if (!requireLogin('menyimpan hasil unggahan')) return;
  var ta = gv('impTa') || APP.year, tahap = gv('impTahap') || APP.stage;
  var recs = APP.importData.records.map(function (r) { var c = {}; for (var k in r) c[k] = r[k]; c.ta = String(ta); c.tahap = tahap; return c; });
  var replace = (document.getElementById('impReplace') || {}).checked;
  if (!confirm('Simpan ' + recs.length + ' Detail Belanja ke database untuk TA ' + ta + ' tahap ' + (STAGE_LABEL[tahap] || tahap) + '?\n' +
    (replace ? '⚠ Data lama pada TA & tahap ini akan DIHAPUS lebih dulu.' : 'Baris dengan kunci sama akan diperbarui (upsert).'))) return;
  var btn = document.getElementById('impConfirmBtn'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan…'; }
  try {
    if (replace) {
      await supaWrite('DELETE', TABLE, { query: 'ta=eq.' + encodeURIComponent(ta) + '&tahap=eq.' + encodeURIComponent(tahap) });
    }
    var dd = kkDedupeForUpsert(recs);
    var rows = dd.rows.map(toDbRow);
    for (var i = 0; i < rows.length; i += 200) {
      await supaWrite('POST', TABLE, { query: UPSERT_KEY, body: rows.slice(i, i + 200), upsert: true });
    }
    toast('success', 'Kertas Kerja Diunggah', rows.length + ' Detail Belanja tersimpan · TA ' + ta + ' tahap ' + (STAGE_LABEL[tahap] || tahap) +
      (dd.renamed ? ' · ' + dd.renamed + ' nama detail ganda disesuaikan' : '') + '. Memuat ulang…');
    closeImport();
    APP.year = String(ta); APP.stage = tahap;
    var ts = document.getElementById('taSelect'); if (ts) ts.value = String(ta);
    var psel = document.getElementById('paguSelect'); if (psel) psel.value = tahap;
    await loadFromSupabase();
  } catch (e) {
    toast('error', 'Gagal Menyimpan', e.message); console.error('[SIPRA] import save', e);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Simpan ke Database'; }
  }
}

/* ── Form Input Usulan (modal) ─────────────────────────────────────── */
function gv(id) { var el = document.getElementById(id); return el ? el.value : ''; }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); }
// Helper referensi/cascade
function childrenOf(level, parentPath) {
  return (APP.refData[level] || []).filter(function (r) { return (r.induk || '') === (parentPath || ''); });
}
function uraianOf(level, kode) {
  var r = (APP.refData[level] || []).filter(function (x) { return x.kode === kode; })[0];
  return r ? (r.uraian || '') : '';
}
function fillRefSelect(id, items, placeholder, selected, withUraian) {
  var sel = document.getElementById(id); if (!sel) return;
  sel.innerHTML = '<option value="">' + placeholder + '</option>' + items.map(function (o) {
    var label = withUraian ? (o.kode + (o.uraian ? ' — ' + o.uraian : '')) : o.kode;
    return '<option value="' + esc(o.kode) + '"' + (o.kode === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }).join('');
}
// Jalur leluhur (gabungan kode terpilih) untuk mengisi level pada indeks idxChild
function pathAbove(idxChild) {
  var parts = [];
  for (var i = 0; i < idxChild; i++) { var v = gv(CASCADE_INPUT[CASCADE[i]]); if (!v) return null; parts.push(v); }
  return parts.join('.');
}
// Dipanggil saat sebuah dropdown cascade berubah → isi anak (pakai jalur), kosongkan cucu
function onCascade(level) {
  var idx = CASCADE.indexOf(level);
  if (idx < 0 || idx >= CASCADE.length - 1) return; // komponen = level terakhir
  var child = CASCADE[idx + 1];
  var pp = pathAbove(idx + 1); // jalur leluhur untuk 'child' = gabungan kode s.d. level ini
  fillRefSelect(CASCADE_INPUT[child], pp ? childrenOf(child, pp) : [], '— pilih ' + refDef(child).label + ' —', '', true);
  for (var i = idx + 2; i < CASCADE.length; i++) {
    fillRefSelect(CASCADE_INPUT[CASCADE[i]], [], '— pilih ' + refDef(CASCADE[i]).label + ' —', '', true);
  }
}
// Akun bersifat mandiri: hanya isi Detail Akun otomatis
/* Combobox Akun — ketik untuk menyaring (daftar akun panjang) */
function akunOpts() { return childrenOf('akun', gv('inSd')); }
var akunHi = -1;
function akunRender(list) {
  var p = document.getElementById('akunPanel'); if (!p) return;
  if (!list.length) { p.innerHTML = '<div class="combo-empty">Tidak ada akun untuk sumber dana ini</div>'; }
  else {
    p.innerHTML = list.map(function (o, i) {
      return '<div class="combo-item' + (i === akunHi ? ' hi' : '') + '" data-kode="' + esc(o.kode) + '" onmousedown="akunPick(\'' + esc(o.kode) + '\')">' +
        '<span class="ci-kode">' + esc(o.kode) + '</span>' + esc(o.uraian || '') + '</div>';
    }).join('');
  }
  p.classList.add('open');
}
function akunFilter() {
  var q = (gv('inAkunSearch') || '').toLowerCase().trim();
  var list = akunOpts().filter(function (o) {
    return !q || o.kode.toLowerCase().indexOf(q) >= 0 || (o.uraian || '').toLowerCase().indexOf(q) >= 0;
  });
  akunHi = -1; akunRender(list);
}
function akunPick(kode) {
  setVal('inAkun', kode);
  var o = akunOpts().filter(function (x) { return x.kode === kode; })[0];
  setVal('inAkunSearch', o ? (o.kode + (o.uraian ? ' — ' + o.uraian : '')) : kode);
  akunClose();
}
function akunClose() { var p = document.getElementById('akunPanel'); if (p) p.classList.remove('open'); }
function akunKey(e) {
  var p = document.getElementById('akunPanel'); if (!p) return;
  var items = p.querySelectorAll('.combo-item');
  if (e.key === 'ArrowDown') { akunHi = Math.min(akunHi + 1, items.length - 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { akunHi = Math.max(akunHi - 1, 0); e.preventDefault(); }
  else if (e.key === 'Enter') { if (akunHi >= 0 && items[akunHi]) { akunPick(items[akunHi].getAttribute('data-kode')); e.preventDefault(); } return; }
  else if (e.key === 'Escape') { akunClose(); return; }
  else return;
  for (var i = 0; i < items.length; i++) items[i].classList.toggle('hi', i === akunHi);
  if (items[akunHi]) items[akunHi].scrollIntoView({ block: 'nearest' });
}
function setAkunValue(kode) {
  setVal('inAkun', kode || '');
  setVal('inAkunSearch', kode ? (kode + ' — ' + uraianOf('akun', kode)) : '');
}
function openInput(prefill) {
  if (!requireLogin('input usulan')) return;
  APP.editId = prefill ? String(prefill.id) : null;
  var s = prefill || { ta: APP.year, tahap: APP.stage, ba: '022', prog: '', keg: '', kro: '', ro: '', komp: '', subkomp: 'A', akun: '', detail_akun: '', detail_belanja: '', vol: 1, sat: '', hrg_sat: 0, sd: 'rm', kategori: 'ops' };
  // TA & Tahap diambil otomatis dari selektor dashboard (tidak ada di modal)
  var ctxTa = prefill ? s.ta : APP.year, ctxTahap = prefill ? s.tahap : APP.stage;
  var ctx = document.getElementById('inCtx');
  if (ctx) ctx.innerHTML = '<i class="fas fa-circle-info"></i> Periode mengikuti selektor dashboard: <strong>TA ' + ctxTa + '</strong> · Tahap <strong>' + (STAGE_LABEL[ctxTahap] || ctxTahap) + '</strong>';
  // BA & Program (pangkal cascade)
  var baItems = (APP.refData.ba || []); if (!baItems.length) baItems = [{ kode: '022', uraian: 'Kementerian Perhubungan' }];
  fillRefSelect('inBa', baItems, '— pilih BA —', s.ba || '022', true);
  fillRefSelect('inProg', APP.refData.program || [], '— pilih Program —', s.prog, true);
  // Cascade berjenjang: isi tiap level sesuai jalur leluhur dari record (untuk edit)
  var p1 = s.prog, p2 = [s.prog, s.keg].join('.'), p3 = [s.prog, s.keg, s.kro].join('.'), p4 = [s.prog, s.keg, s.kro, s.ro].join('.');
  fillRefSelect('inKeg', s.prog ? childrenOf('kegiatan', p1) : [], '— pilih Kegiatan —', s.keg, true);
  fillRefSelect('inKro', s.keg ? childrenOf('kro', p2) : [], '— pilih KRO —', s.kro, true);
  fillRefSelect('inRo', s.kro ? childrenOf('ro', p3) : [], '— pilih RO —', s.ro, true);
  fillRefSelect('inKomp', s.ro ? childrenOf('komponen', p4) : [], '— pilih Komponen —', s.komp, true);
  // Sumber Dana → memfilter Akun
  setVal('inSd', s.sd || 'rm'); setVal('inKategori', s.kategori);
  setAkunValue(s.akun); akunClose();
  setVal('inSubkomp', s.subkomp); setVal('inSubUraian', s.subkomp_nama || '');
  setVal('inDetailBelanja', s.detail_belanja);
  setVal('inVol', s.vol); setVal('inSat', s.sat); setVal('inHrg', s.hrg_sat);
  recalcJumlah();
  var ttl = document.getElementById('inModalTitle');
  if (ttl) ttl.innerHTML = '<i class="fas fa-pen-to-square" style="color:var(--blue);margin-right:8px"></i>' + (prefill ? 'Edit Usulan Belanja' : 'Input Usulan Belanja');
  var sb = document.getElementById('inSaveBtn');
  if (sb) sb.innerHTML = '<i class="fas fa-floppy-disk"></i> ' + (prefill ? 'Perbarui' : 'Simpan');
  var m = document.getElementById('inputModal'); if (m) m.classList.add('open');
}
// Sumber Dana berubah → Akun mengikuti (filter), kosongkan pilihan akun & detail
function onSdChange() {
  setAkunValue(''); akunClose();
}
function closeInput() { var m = document.getElementById('inputModal'); if (m) m.classList.remove('open'); APP.editId = null; }
function recalcJumlah() {
  var v = parseFloat(gv('inVol')) || 0, h = parseFloat(gv('inHrg')) || 0;
  var j = document.getElementById('inJumlah'); if (j) j.value = fmtRp(v * h);
}
function editRow(id) {
  if (!requireLogin('mengubah data')) return;
  var rec = APP.records.filter(function (r) { return String(r.id) === String(id); })[0];
  if (!rec) { toast('error', 'Tidak Ditemukan', 'Baris tidak ditemukan.'); return; }
  openInput(rec);
}
async function deleteRow(id) {
  if (!requireLogin('menghapus data')) return;
  var rec = APP.records.filter(function (r) { return String(r.id) === String(id); })[0];
  if (!rec) { toast('error', 'Tidak Ditemukan', 'Baris tidak ditemukan.'); return; }
  if (!confirm('Hapus usulan "' + rec.detail_belanja + '" (' + fmtRp(amountOf(rec)) + ')?\nTindakan ini tidak dapat dibatalkan.')) return;
  try {
    await supaWrite('DELETE', TABLE, { query: 'id=eq.' + encodeURIComponent(id) });
    toast('success', 'Terhapus', 'Usulan "' + rec.detail_belanja + '" dihapus.');
    await loadFromSupabase();
  } catch (e) { toast('error', 'Gagal Menghapus', e.message); console.error('[SIPRA] delete error:', e); }
}
async function submitInput() {
  var prog = gv('inProg').trim(), keg = gv('inKeg').trim(), kro = gv('inKro').trim(), ro = gv('inRo').trim();
  var editId = APP.editId;
  var orig = editId ? APP.records.filter(function (r) { return String(r.id) === String(editId); })[0] : null;
  var rec = {
    ta: orig ? orig.ta : APP.year, tahap: orig ? orig.tahap : APP.stage,
    ba: gv('inBa').trim() || '022', prog: prog, keg: keg,
    kro: kro, ro: ro, komp: gv('inKomp').trim(), subkomp: gv('inSubkomp').trim(), subkomp_nama: gv('inSubUraian').trim(),
    akun: gv('inAkun').trim(), detail_akun: uraianOf('akun', gv('inAkun').trim()),
    detail_belanja: gv('inDetailBelanja').trim(),
    vol: parseFloat(gv('inVol')) || 0, sat: gv('inSat').trim(), hrg_sat: parseFloat(gv('inHrg')) || 0,
    sd: gv('inSd') || 'rm', kategori: gv('inKategori') || 'ops',
    prog_nama: uraianOf('program', prog), keg_nama: uraianOf('kegiatan', keg),
    kro_nama: uraianOf('kro', kro), ro_nama: uraianOf('ro', ro),
  };
  if (!rec.akun || !rec.detail_belanja) { toast('error', 'Lengkapi Data', 'Akun dan Detail Belanja wajib diisi.'); return; }
  if (rec.vol <= 0 || rec.hrg_sat <= 0) { toast('error', 'Lengkapi Data', 'Volume dan Harga Satuan harus lebih dari 0.'); return; }
  var btn = document.getElementById('inSaveBtn'); if (btn) btn.disabled = true;
  try {
    if (editId) {
      await supaWrite('PATCH', TABLE, { query: 'id=eq.' + encodeURIComponent(editId), body: toDbRow(rec) });
    } else {
      await supaWrite('POST', TABLE, { query: UPSERT_KEY, body: [toDbRow(rec)], upsert: true });
    }
    toast('success', editId ? 'Diperbarui' : 'Tersimpan', 'Usulan "' + rec.detail_belanja + '" (' + fmtRp(rec.vol * rec.hrg_sat) + ') ' + (editId ? 'diperbarui' : 'disimpan') + '.');
    closeInput();
    APP.year = rec.ta; APP.stage = rec.tahap;
    var ts = document.getElementById('taSelect'); if (ts) ts.value = rec.ta;
    var psel = document.getElementById('paguSelect'); if (psel) psel.value = rec.tahap;
    await loadFromSupabase();
  } catch (e) {
    toast('error', editId ? 'Gagal Memperbarui' : 'Gagal Menyimpan', e.message); console.error('[SIPRA] input error:', e);
  } finally { if (btn) btn.disabled = false; }
}

/* ── Pengaturan Data: referensi kode ── */
var REF_COLS = ['BA', 'Program', 'Kegiatan', 'KRO', 'RO', 'Komponen', 'Sub Komponen', 'Akun', 'Detail Akun', 'Detail Belanja'];
var REF_ROWS = [
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '525112', 'Belanja Barang', ''],
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '525111', 'Belanja Gaji dan Tunjangan', ''],
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '525113', 'Belanja Jasa', ''],
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '521111', 'Belanja Keperluan Perkantoran', ''],
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '521211', 'Belanja Bahan', ''],
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '522111', 'Belanja Langganan Listrik', ''],
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '524111', 'Belanja Perjalanan Dinas Biasa', ''],
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '511111', 'Belanja Gaji Pokok PNS', ''],
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '532111', 'Belanja Modal Peralatan dan Mesin', ''],
  ['022', '12.DL', '3996', 'SAB', '005', '051', 'A', '533111', 'Belanja Modal Gedung dan Bangunan', ''],
];
function renderRefTable() {
  var head = document.getElementById('codeHead');
  if (head) head.innerHTML = REF_COLS.map(function (c) { return '<th>' + c + '</th>'; }).join('');
  var body = document.getElementById('codeBody');
  if (body) body.innerHTML = REF_ROWS.map(function (r) {
    return '<tr>' + r.map(function (c, i) { var val = (i === 9 && !c) ? '<span style="color:var(--t3)">—</span>' : esc(c); return '<td class="' + (i <= 7 ? 'mono' : '') + '">' + val + '</td>'; }).join('') + '</tr>';
  }).join('');
}

/* ── Manajemen Akun ── */
function renderUsers() {
  var body = document.getElementById('userBody'); if (!body) return;
  if (isLoggedIn()) {
    var em = (APP.session.user && APP.session.user.email) || 'pengguna';
    body.innerHTML = '<tr><td class="mono">' + esc(em) + '</td><td>Pengguna Login</td>' +
      '<td><span class="pct-badge pct-m">Authenticated</span></td><td><span class="pct-badge pct-h">Aktif</span></td></tr>';
  } else {
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:26px;color:var(--t3)">' +
      'Belum masuk — aplikasi dalam mode <strong>hanya-baca</strong>. Klik <strong>Masuk</strong> untuk menulis data.</td></tr>';
  }
  var note = document.getElementById('userNote');
  if (note) note.innerHTML = isLoggedIn()
    ? '<i class="fas fa-shield-halved" style="color:var(--teal)"></i> Anda masuk sebagai <strong>' + esc((APP.session.user && APP.session.user.email) || '') + '</strong>. Semua aksi tulis memakai akun ini.'
    : '<i class="fas fa-lock" style="color:var(--t3)"></i> Akun login dikelola di Supabase → Authentication → Users. Untuk pemakaian internal, matikan pendaftaran mandiri (sign-up).';
}

/* ── Basis Data KODE (7 tabel referensi) ───────────────────────────── */
var REF_TABLES = [
  { key: 'ba',       table: 'ref_ba',       label: 'BA',       full: 'BA (Bagian Anggaran)', parent: null },
  { key: 'program',  table: 'ref_program',  label: 'Program',  full: 'Program',  parent: null },
  { key: 'kegiatan', table: 'ref_kegiatan', label: 'Kegiatan', full: 'Kegiatan', parent: 'program' },
  { key: 'kro',      table: 'ref_kro',      label: 'KRO',      full: 'KRO',      parent: 'kegiatan' },
  { key: 'ro',       table: 'ref_ro',       label: 'RO',       full: 'RO',       parent: 'kro' },
  { key: 'komponen', table: 'ref_komponen', label: 'Komponen', full: 'Komponen', parent: 'ro' },
  { key: 'akun',     table: 'ref_akun',     label: 'Akun',     full: 'Akun (per Sumber Dana)', parent: '@sd' },
];
// Pilihan Sumber Dana (induk untuk Akun)
var SD_OPTS = [{ kode: 'rm', uraian: 'Rupiah Murni (RM)' }, { kode: 'blu', uraian: 'BLU' }];
function parentLabel(def) { return def.parent === '@sd' ? 'Sumber Dana' : refDef(def.parent).label; }
// Rantai cascade modal Input (Akun mandiri, di luar cascade). induk = JALUR kode leluhur.
var CASCADE = ['program', 'kegiatan', 'kro', 'ro', 'komponen'];
var CASCADE_INPUT = { program: 'inProg', kegiatan: 'inKeg', kro: 'inKro', ro: 'inRo', komponen: 'inKomp' };
// Jalur penuh sebuah baris ref = induk + '.' + kode
function pathOf(row) { return row.induk ? (row.induk + '.' + row.kode) : row.kode; }
function refDef(key) { return REF_TABLES.filter(function (t) { return t.key === key; })[0] || REF_TABLES[0]; }
async function loadRefTables() {
  for (var i = 0; i < REF_TABLES.length; i++) {
    var t = REF_TABLES[i];
    try {
      var rows = await supaFetchAll(t.table, 'select=*&order=kode');
      APP.refData[t.key] = rows || [];
    } catch (e) { APP.refData[t.key] = []; console.error('[SIPRA] load ' + t.table, e); }
  }
  renderKodeSection();
}
function renderKodeTabs() {
  var el = document.getElementById('kodeTabs'); if (!el) return;
  el.innerHTML = REF_TABLES.map(function (t) {
    var n = (APP.refData[t.key] || []).length;
    return '<div class="code-tab ' + (t.key === APP.kodeTab ? 'active' : '') + '" onclick="onKodeTab(\'' + t.key + '\')">' +
      esc(t.label) + ' <span style="opacity:.6">(' + n + ')</span></div>';
  }).join('');
}
function renderKodeSection() {
  renderKodeTabs();
  var def = refDef(APP.kodeTab);
  var ttl = document.getElementById('kodeTitle'); if (ttl) ttl.textContent = 'Tabel ' + def.full;
  var head = document.getElementById('kodeHead');
  var hasParent = !!def.parent;
  if (head) head.innerHTML = '<th style="width:150px">Kode ' + esc(def.label) + '</th><th>Uraian ' + esc(def.label) + '</th>' +
    (hasParent ? '<th style="width:160px">Induk (' + esc(parentLabel(def)) + ')</th>' : '') +
    '<th style="width:90px;text-align:center">Aksi</th>';
  var rows = APP.refData[APP.kodeTab] || [];
  var colspan = hasParent ? 4 : 3;
  var body = document.getElementById('kodeBody');
  if (body) body.innerHTML = rows.length ? rows.map(function (r) {
    var aksi = isLoggedIn()
      ? '<div class="row-act">' +
        '<button class="ra-edit" title="Edit" onclick="editKode(\'' + r.id + '\')"><i class="fas fa-pen"></i></button>' +
        '<button class="ra-del" title="Hapus" onclick="deleteKode(\'' + r.id + '\')"><i class="fas fa-trash"></i></button></div>'
      : '<span style="color:var(--t3)">—</span>';
    return '<tr><td class="mono">' + esc(r.kode) + '</td><td>' + esc(r.uraian || '') + '</td>' +
      (hasParent ? '<td class="mono">' + (r.induk ? esc(r.induk) : '<span style="color:var(--t3)">—</span>') + '</td>' : '') +
      '<td style="text-align:center">' + aksi + '</td></tr>';
  }).join('') : '<tr><td colspan="' + colspan + '" style="text-align:center;padding:28px;color:var(--t3)">Belum ada data — klik "Tambah Kode"</td></tr>';
}
function onKodeTab(key) { APP.kodeTab = key; renderKodeSection(); }

function openKode(prefill) {
  if (!requireLogin('mengisi data kode')) return;
  APP.kodeEditId = prefill ? String(prefill.id) : null;
  var def = refDef(APP.kodeTab);
  setVal('kdKode', prefill ? prefill.kode : '');
  setVal('kdUraian', prefill ? (prefill.uraian || '') : '');
  // Induk (parent) — hanya untuk tabel turunan
  var wrap = document.getElementById('kdIndukWrap');
  var sel = document.getElementById('kdInduk');
  if (def.parent && wrap && sel) {
    wrap.style.display = '';
    document.getElementById('kdIndukLabel').textContent = 'Induk — ' + parentLabel(def);
    if (def.parent === '@sd') {
      sel.innerHTML = '<option value="">— pilih Sumber Dana —</option>' +
        SD_OPTS.map(function (o) { return '<option value="' + o.kode + '"' + (prefill && prefill.induk === o.kode ? ' selected' : '') + '>' + esc(o.uraian) + '</option>'; }).join('');
    } else {
      var pdef = refDef(def.parent);
      var opts = (APP.refData[def.parent] || []);
      sel.innerHTML = '<option value="">— pilih ' + esc(pdef.label) + ' —</option>' +
        opts.map(function (o) {
          var path = pathOf(o);
          var lbl = o.kode + (o.uraian ? ' — ' + o.uraian : '') + (o.induk ? ' [' + o.induk + ']' : '');
          return '<option value="' + esc(path) + '"' + (prefill && prefill.induk === path ? ' selected' : '') + '>' + esc(lbl) + '</option>';
        }).join('');
    }
  } else if (wrap) { wrap.style.display = 'none'; }
  var ttl = document.getElementById('kodeModalTitle');
  if (ttl) ttl.innerHTML = '<i class="fas fa-database" style="color:var(--blue);margin-right:8px"></i>' + (prefill ? 'Edit' : 'Tambah') + ' Kode — ' + esc(def.full);
  var sb = document.getElementById('kdSaveBtn');
  if (sb) sb.innerHTML = '<i class="fas fa-floppy-disk"></i> ' + (prefill ? 'Perbarui' : 'Simpan');
  var m = document.getElementById('kodeModal'); if (m) { m.classList.add('open'); var k = document.getElementById('kdKode'); if (k) setTimeout(function () { k.focus(); }, 60); }
}
function closeKode() { var m = document.getElementById('kodeModal'); if (m) m.classList.remove('open'); APP.kodeEditId = null; }
async function submitKode() {
  var def = refDef(APP.kodeTab);
  var kode = (gv('kdKode') || '').trim(), uraian = (gv('kdUraian') || '').trim();
  var induk = def.parent ? (gv('kdInduk') || '').trim() : '';
  if (!kode) { toast('error', 'Lengkapi Data', 'Kode wajib diisi.'); return; }
  if (def.parent && !induk) { toast('error', 'Lengkapi Data', 'Induk (' + refDef(def.parent).label + ') wajib dipilih.'); return; }
  var editId = APP.kodeEditId;
  var btn = document.getElementById('kdSaveBtn'); if (btn) btn.disabled = true;
  try {
    if (editId) {
      await supaWrite('PATCH', def.table, { query: 'id=eq.' + encodeURIComponent(editId), body: { kode: kode, uraian: uraian, induk: induk } });
    } else {
      await supaWrite('POST', def.table, { query: 'on_conflict=induk,kode', body: [{ kode: kode, uraian: uraian, induk: induk }], upsert: true });
    }
    toast('success', editId ? 'Diperbarui' : 'Tersimpan', def.label + ' ' + kode + ' ' + (editId ? 'diperbarui' : 'disimpan') + '.');
    closeKode();
    var rows = await supaFetchAll(def.table, 'select=*&order=kode');
    APP.refData[def.key] = rows || [];
    renderKodeSection();
  } catch (e) {
    toast('error', 'Gagal Menyimpan', e.message); console.error('[SIPRA] kode save', e);
  } finally { if (btn) btn.disabled = false; }
}
function editKode(id) {
  if (!requireLogin('mengubah data kode')) return;
  var rec = (APP.refData[APP.kodeTab] || []).filter(function (r) { return String(r.id) === String(id); })[0];
  if (!rec) { toast('error', 'Tidak Ditemukan', 'Baris tidak ditemukan.'); return; }
  openKode(rec);
}
async function deleteKode(id) {
  if (!requireLogin('menghapus data kode')) return;
  var def = refDef(APP.kodeTab);
  var rec = (APP.refData[APP.kodeTab] || []).filter(function (r) { return String(r.id) === String(id); })[0];
  if (!rec) return;
  if (!confirm('Hapus kode "' + rec.kode + '" (' + (rec.uraian || '') + ')?')) return;
  try {
    await supaWrite('DELETE', def.table, { query: 'id=eq.' + encodeURIComponent(id) });
    toast('success', 'Terhapus', def.label + ' ' + rec.kode + ' dihapus.');
    var rows = await supaFetchAll(def.table, 'select=*&order=kode');
    APP.refData[def.key] = rows || [];
    renderKodeSection();
  } catch (e) { toast('error', 'Gagal Menghapus', e.message); console.error('[SIPRA] kode del', e); }
}

/* ── Render all ── */
function renderAll() {
  renderCards(); renderUsulanChart(); renderPie1(); renderPie2();
  populateUsulanFilters(); renderUsulanList(); renderDatabase();
}

/* ── Handlers ── */
function onPaguChange(v) { APP.stage = v; APP.usulanPage = 1; APP.dbPage = 1; APP.expanded = {}; APP.uf = { prog: '', kro: '', ro: '', akun: '', detail: '', sd: '' }; renderAll(); }
function onYearChange(v) { APP.year = v; APP.usulanPage = 1; APP.dbPage = 1; APP.expanded = {}; APP.uf = { prog: '', kro: '', ro: '', akun: '', detail: '', sd: '' }; renderAll(); }
function onUsulanMode(mode, el) { APP.usulanMode = mode; document.querySelectorAll('#usulanModePills .pill').forEach(function (p) { p.classList.remove('active'); }); if (el) el.classList.add('active'); renderUsulanChart(); }
function onPie1Src(src, el) { APP.pie1Src = src; document.querySelectorAll('#pie1Tabs .src-tab').forEach(function (t) { t.classList.remove('active'); }); if (el) el.classList.add('active'); renderPie1(); }
function onPie2Cat(cat, el) { APP.pie2Cat = cat; document.querySelectorAll('#pie2Tabs .src-tab').forEach(function (t) { t.classList.remove('active'); }); if (el) el.classList.add('active'); renderPie2(); }
function switchPage(pageId, navEl) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  var pg = document.getElementById('page-' + pageId); if (pg) pg.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
  if (navEl) navEl.classList.add('active'); else { var f = document.getElementById('nav-' + pageId); if (f) f.classList.add('active'); }
  var icons = { dashboard: 'fa-gauge-high', penganggaran: 'fa-coins', pengaturan: 'fa-database', manajemen: 'fa-users-gear' };
  var labels = { dashboard: 'Dashboard', penganggaran: 'Modul Penganggaran', pengaturan: 'Pengaturan Data', manajemen: 'Manajemen Akun' };
  var bci = document.getElementById('bcIcon'); if (bci) bci.className = 'fas ' + (icons[pageId] || 'fa-circle');
  var bct = document.getElementById('bcText'); if (bct) bct.textContent = labels[pageId] || pageId;
  if (pageId === 'penganggaran') { renderCards(); renderDatabase(); }
  if (pageId === 'pengaturan') renderRefTable();
  if (pageId === 'manajemen') { renderUsers(); renderKodeSection(); loadRefTables(); }
  if (pageId === 'dashboard') setTimeout(function () { Object.keys(CHARTS).forEach(function (k) { if (CHARTS[k]) CHARTS[k].resize(); }); }, 60);
  if (window.innerWidth <= 680) toggleSidebar(true);
}
function toggleSidebar(forceClose) {
  var sb = document.getElementById('sidebar'), ov = document.getElementById('sbOverlay');
  if (forceClose) { sb.classList.remove('mob-open'); ov.classList.remove('mob-open'); return; }
  sb.classList.toggle('mob-open'); ov.classList.toggle('mob-open');
}
function toggleTheme() {
  APP.theme = APP.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', APP.theme);
  var ic = document.getElementById('themeIcon'); if (ic) ic.className = APP.theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  renderUsulanChart(); renderPie1(); renderPie2();
}

/* ── Init ── */
function populateYears() {
  var sel = document.getElementById('taSelect'); if (!sel) return;
  sel.innerHTML = yearOptions().map(function (y) { return '<option value="' + y + '"' + (y === APP.year ? ' selected' : '') + '>TA ' + y + '</option>'; }).join('');
}
async function init() {
  loadSession();
  loadCache();              // tampilkan data tersimpan lokal lebih dulu (instan, tahan luring)
  populateYears();
  var ps = document.getElementById('paguSelect'); if (ps) ps.value = APP.stage;
  updateAuthUI(); renderUsers(); renderRefTable();
  renderAll();
  // Perbarui token dulu (bila login) agar baca data pakai sesi valid, baru muat dari server
  if (isLoggedIn()) { try { await refreshSession(); } catch (e) { } updateAuthUI(); renderUsers(); renderKodeSection(); }
  await loadFromSupabase();
  loadRefTables();          // referensi kode untuk dropdown bertingkat modal Input
  document.addEventListener('click', function (e) {
    var c = document.getElementById('akunCombo');
    if (c && !c.contains(e.target)) akunClose();
  });
}
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

/* Ekspor untuk pengujian Node */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    APP: APP, kodeToJenis: kodeToJenis, buildSeed: buildSeed, GROUPS: GROUPS, STAGE_FACTOR: STAGE_FACTOR,
    computeCards: computeCards, jenisComposition: jenisComposition, stageTotals: stageTotals,
    recordsForYear: recordsForYear, recordsView: recordsView, kodeOf: kodeOf, groupByKode: groupByKode,
    csvCell: csvCell, mapRow: mapRow, toDbRow: toDbRow, amountOf: amountOf,
    authToken: authToken, isLoggedIn: isLoggedIn, saveCache: saveCache, loadCache: loadCache, loadFromSupabase: loadFromSupabase,
    REF_TABLES: REF_TABLES, refDef: refDef,
    CASCADE: CASCADE, childrenOf: childrenOf, uraianOf: uraianOf, pathOf: pathOf,
    kkColOf: kkColOf, refUraian: refUraian, downloadKertasKerja: downloadKertasKerja, downloadKertasKerjaXLSX: downloadKertasKerjaXLSX,
    kkNum: kkNum, kkDetectCols: kkDetectCols, kkIsDetail: kkIsDetail, kkCleanName: kkCleanName,
    kkMeta: kkMeta, kkParseMatrix: kkParseMatrix,
    kkUpsertKeyOf: kkUpsertKeyOf, kkDedupeForUpsert: kkDedupeForUpsert,
    fmtRp: fmtRp, fmtM: fmtM, yearOptions: yearOptions, STAGES: STAGES, UPSERT_KEY: UPSERT_KEY, TABLE: TABLE,
  };
}
