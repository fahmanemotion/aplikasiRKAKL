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
  var headers = { apikey: SUPA_KEY, Authorization: 'Bearer ' + (opts.useUserToken ? authToken() : SUPA_KEY), 'Content-Type': 'application/json' };
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
    komp: r.komp, subkomp: r.subkomp, akun: r.akun, detail_akun: r.detail_akun, detail_belanja: r.detail_belanja,
    vol: vol, sat: r.sat, hrg_sat: hrg, jumlah: (r.jumlah != null ? +r.jumlah : vol * hrg),
    sd: r.sd, kategori: r.kategori, jenis: r.jenis || kodeToJenis(r.akun),
  };
}
// Record aplikasi → baris DB (tanpa id/jumlah/jenis; ketiganya otomatis di DB)
function toDbRow(r) {
  return {
    ta: r.ta, tahap: r.tahap, ba: r.ba, prog: r.prog, prog_nama: r.prog_nama, keg: r.keg, keg_nama: r.keg_nama,
    kro: r.kro, kro_nama: r.kro_nama, ro: r.ro, ro_nama: r.ro_nama || null, komp: r.komp, subkomp: r.subkomp,
    akun: r.akun, detail_akun: r.detail_akun, detail_belanja: r.detail_belanja,
    vol: r.vol, sat: r.sat, hrg_sat: r.hrg_sat, sd: r.sd, kategori: r.kategori,
  };
}
async function loadFromSupabase() {
  try {
    var rows = await supaFetchAll(TABLE, 'select=*&order=id');
    APP.records = rows.map(mapRow);
    try {
      var meta = await supaFetch('GET', 'metadata', { query: 'select=key,value', returning: true }) || [];
      var m = {}; meta.forEach(function (x) { m[x.key] = x.value; });
      if (m.satker) APP.satker = m.satker;
    } catch (e) { /* metadata opsional */ }
    populateYears(); renderAll();
    toast('success', 'Terhubung ke Supabase', APP.records.length + ' baris dimuat dari ' + TABLE + '.');
  } catch (e) {
    APP.records = []; renderAll();
    toast('error', 'Gagal Terhubung ke Supabase', e.message);
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
function downloadKertasKerja() {
  var rows = recordsForYear(APP.year);
  if (!rows.length) { toast('error', 'Tidak Ada Data', 'Belum ada usulan untuk diunduh.'); return; }
  var head = ['Tahap', 'BA', 'Program', 'Kegiatan', 'KRO', 'RO', 'Komponen', 'Sub Komponen', 'Akun', 'Detail Akun', 'Detail Belanja', 'Vol', 'Satuan', 'Harga Satuan', 'Jumlah', 'SD', 'Kategori'];
  var lines = [head.join(';')];
  rows.forEach(function (r) {
    lines.push([STAGE_LABEL[r.tahap], r.ba, r.prog, r.keg, r.kro, r.ro, r.komp, r.subkomp, r.akun, r.detail_akun, r.detail_belanja,
      r.vol, r.sat, r.hrg_sat, amountOf(r), r.sd.toUpperCase(), (r.kategori === 'ops' ? 'OPS' : 'NON OPS')].map(csvCell).join(';'));
  });
  var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'Kertas_Kerja_RKA-KL_PIP_Makassar_TA' + APP.year + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('success', 'Kertas Kerja Diunduh', 'TA ' + APP.year + ' — ' + rows.length + ' baris (CSV, dapat dibuka di Excel).');
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
function onAkunPick() {
  var da = document.getElementById('inDetailAkun'); if (da) da.value = uraianOf('akun', gv('inAkun'));
}
function openInput(prefill) {
  if (!requireLogin('input usulan')) return;
  APP.editId = prefill ? String(prefill.id) : null;
  var ta = document.getElementById('inTa');
  if (ta) ta.innerHTML = yearOptions().map(function (y) { return '<option value="' + y + '">TA ' + y + '</option>'; }).join('');
  var th = document.getElementById('inTahap');
  if (th) th.innerHTML = STAGES.map(function (s) { return '<option value="' + s.key + '">' + s.label + '</option>'; }).join('');
  var s = prefill || { ta: APP.year, tahap: APP.stage, ba: '022', prog: '', keg: '', kro: '', ro: '', komp: '', subkomp: 'A', akun: '', detail_akun: '', detail_belanja: '', vol: 1, sat: '', hrg_sat: 0, sd: 'rm', kategori: 'ops' };
  // BA & Akun (mandiri) + Program (pangkal cascade)
  var baItems = (APP.refData.ba || []); if (!baItems.length) baItems = [{ kode: '022', uraian: 'Kementerian Perhubungan' }];
  fillRefSelect('inBa', baItems, '— pilih BA —', s.ba || '022', true);
  fillRefSelect('inProg', APP.refData.program || [], '— pilih Program —', s.prog, true);
  // Cascade berjenjang: isi tiap level sesuai jalur leluhur dari record (untuk edit)
  var p1 = s.prog, p2 = [s.prog, s.keg].join('.'), p3 = [s.prog, s.keg, s.kro].join('.'), p4 = [s.prog, s.keg, s.kro, s.ro].join('.');
  fillRefSelect('inKeg', s.prog ? childrenOf('kegiatan', p1) : [], '— pilih Kegiatan —', s.keg, true);
  fillRefSelect('inKro', s.keg ? childrenOf('kro', p2) : [], '— pilih KRO —', s.kro, true);
  fillRefSelect('inRo', s.kro ? childrenOf('ro', p3) : [], '— pilih RO —', s.ro, true);
  fillRefSelect('inKomp', s.ro ? childrenOf('komponen', p4) : [], '— pilih Komponen —', s.komp, true);
  fillRefSelect('inAkun', APP.refData.akun || [], '— pilih Akun —', s.akun, true);  // Akun mandiri
  setVal('inTa', s.ta); setVal('inTahap', s.tahap); setVal('inSubkomp', s.subkomp);
  setVal('inDetailAkun', s.detail_akun || uraianOf('akun', s.akun)); setVal('inDetailBelanja', s.detail_belanja);
  setVal('inVol', s.vol); setVal('inSat', s.sat); setVal('inHrg', s.hrg_sat);
  setVal('inSd', s.sd); setVal('inKategori', s.kategori);
  recalcJumlah();
  var ttl = document.getElementById('inModalTitle');
  if (ttl) ttl.innerHTML = '<i class="fas fa-pen-to-square" style="color:var(--blue);margin-right:8px"></i>' + (prefill ? 'Edit Usulan Belanja' : 'Input Usulan Belanja');
  var sb = document.getElementById('inSaveBtn');
  if (sb) sb.innerHTML = '<i class="fas fa-floppy-disk"></i> ' + (prefill ? 'Perbarui' : 'Simpan');
  var m = document.getElementById('inputModal'); if (m) m.classList.add('open');
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
  var rec = {
    ta: gv('inTa') || APP.year, tahap: gv('inTahap') || APP.stage,
    ba: gv('inBa').trim() || '022', prog: prog, keg: keg,
    kro: kro, ro: ro, komp: gv('inKomp').trim(), subkomp: gv('inSubkomp').trim(),
    akun: gv('inAkun').trim(), detail_akun: gv('inDetailAkun').trim() || uraianOf('akun', gv('inAkun').trim()),
    detail_belanja: gv('inDetailBelanja').trim(),
    vol: parseFloat(gv('inVol')) || 0, sat: gv('inSat').trim(), hrg_sat: parseFloat(gv('inHrg')) || 0,
    sd: gv('inSd') || 'rm', kategori: gv('inKategori') || 'ops',
    prog_nama: uraianOf('program', prog), keg_nama: uraianOf('kegiatan', keg),
    kro_nama: uraianOf('kro', kro), ro_nama: uraianOf('ro', ro),
  };
  if (!rec.akun || !rec.detail_belanja) { toast('error', 'Lengkapi Data', 'Akun dan Detail Belanja wajib diisi.'); return; }
  if (rec.vol <= 0 || rec.hrg_sat <= 0) { toast('error', 'Lengkapi Data', 'Volume dan Harga Satuan harus lebih dari 0.'); return; }
  var editId = APP.editId;
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
  { key: 'akun',     table: 'ref_akun',     label: 'Akun',     full: 'Akun (mandiri)', parent: null },
];
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
    (hasParent ? '<th style="width:160px">Induk (' + esc(refDef(def.parent).label) + ')</th>' : '') +
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
    var pdef = refDef(def.parent);
    document.getElementById('kdIndukLabel').textContent = 'Induk — ' + pdef.full;
    var opts = (APP.refData[def.parent] || []);
    sel.innerHTML = '<option value="">— pilih ' + esc(pdef.label) + ' —</option>' +
      opts.map(function (o) {
        var path = pathOf(o);
        var lbl = o.kode + (o.uraian ? ' — ' + o.uraian : '') + (o.induk ? ' [' + o.induk + ']' : '');
        return '<option value="' + esc(path) + '"' + (prefill && prefill.induk === path ? ' selected' : '') + '>' + esc(lbl) + '</option>';
      }).join('');
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
function init() {
  loadSession();
  populateYears();
  var ps = document.getElementById('paguSelect'); if (ps) ps.value = APP.stage;
  updateAuthUI(); renderUsers(); renderRefTable();
  renderAll();
  loadFromSupabase();
  loadRefTables();          // referensi kode untuk dropdown bertingkat modal Input
  if (isLoggedIn()) refreshSession().then(function () { updateAuthUI(); renderUsers(); renderKodeSection(); renderAll(); });
}
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

/* Ekspor untuk pengujian Node */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    APP: APP, kodeToJenis: kodeToJenis, buildSeed: buildSeed, GROUPS: GROUPS, STAGE_FACTOR: STAGE_FACTOR,
    computeCards: computeCards, jenisComposition: jenisComposition, stageTotals: stageTotals,
    recordsForYear: recordsForYear, recordsView: recordsView, kodeOf: kodeOf, groupByKode: groupByKode,
    csvCell: csvCell, mapRow: mapRow, toDbRow: toDbRow, amountOf: amountOf,
    authToken: authToken, isLoggedIn: isLoggedIn,
    REF_TABLES: REF_TABLES, refDef: refDef,
    CASCADE: CASCADE, childrenOf: childrenOf, uraianOf: uraianOf, pathOf: pathOf,
    fmtRp: fmtRp, fmtM: fmtM, yearOptions: yearOptions, STAGES: STAGES, UPSERT_KEY: UPSERT_KEY, TABLE: TABLE,
  };
}
