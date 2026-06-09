/* =====================================================================
   SIPRA — Sistem Penganggaran RKA/KL · PIP Makassar
   Stack: Vanilla HTML / CSS / JS (chart: Chart.js)
   Data di bawah adalah CONTOH demonstrasi. Metode input (Input / Upload)
   dan basis data permanen menyusul.
   ===================================================================== */

var STAGES = [
  { key: 'kebutuhan', label: 'Kebutuhan' },
  { key: 'indikatif', label: 'Indikatif' },
  { key: 'anggaran',  label: 'Anggaran'  },
  { key: 'alokasi',   label: 'Alokasi'   },
];
var STAGE_LABEL = { kebutuhan: 'Kebutuhan', indikatif: 'Indikatif', anggaran: 'Anggaran', alokasi: 'Alokasi' };

var APP = {
  theme: 'light',
  stage: 'anggaran',
  year: String(new Date().getFullYear()),
  usulanMode: 'current',
  pie1Src: 'gabungan',
  pie2Cat: 'gabungan',
  uf: { prog: '', kro: '', ro: '', akun: '', detail: '', sd: '' },   // filter daftar usulan
  expanded: {},                                                       // grup yang sedang dibuka
  usulanPage: 1, dbPage: 1, PP: 12,
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
  setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 250); }, 4200);
}
function comingSoon() { toast('info', 'Segera Hadir', 'Metode input/unggah akan ditambahkan kemudian.'); }

/* ── DATA CONTOH (PIP Makassar — BA 022 Kemenhub) ──────────────────────
   Satu baris = satu "Detail Belanja" (item) di bawah sebuah Akun.
   Nilai PAGU Anggaran disetel agar total cocok dengan tampilan kartu. */
function pagu(nominal) {
  return {
    kebutuhan: Math.round(nominal * 1.15),
    indikatif: Math.round(nominal * 1.07),
    anggaran:  Math.round(nominal),          // tahap "Anggaran" = nilai kerja
    alokasi:   Math.round(nominal * 0.97),
  };
}
// [akun, detail_akun, sd, kategori, komp, [ [detail_belanja, vol, sat, hrg_sat], ... ] ]
var GROUPS = [
  ['511111', 'Belanja Gaji Pokok PNS',                'rm',  'ops',    '051', [['Gaji Pokok PNS', 12, 'BLN', 60000000]]],
  ['511121', 'Belanja Tunjangan Keluarga',            'rm',  'ops',    '051', [['Tunjangan Suami/Istri & Anak', 12, 'BLN', 11853000]]],
  ['521111', 'Belanja Keperluan Perkantoran',         'rm',  'ops',    '052', [['ATK & Keperluan Kantor', 12, 'BLN', 45000000]]],
  ['522111', 'Belanja Langganan Listrik',             'rm',  'ops',    '052', [['Langganan Listrik', 12, 'BLN', 80000000]]],
  ['525113', 'Belanja Jasa (BLU)',                    'blu', 'ops',    '053', [['Jasa Layanan BLU', 1, 'THN', 865000000]]],
  ['521211', 'Belanja Bahan',                         'rm',  'nonops', '054', [['Bahan Praktik Diklat', 8, 'KEG', 120000000], ['Konsumsi Diklat', 1, 'PKT', 247800000]]],
  ['521213', 'Belanja Honor Output Kegiatan',         'rm',  'nonops', '054', [['Honor Penguji & Pengawas Ujian', 1, 'PKT', 500000000]]],
  ['524111', 'Belanja Perjalanan Dinas Biasa',        'rm',  'nonops', '055', [['Perjalanan Dinas Instruktur', 100, 'OT', 5000000]]],
  ['525112', 'Belanja Barang (BLU)',                  'blu', 'nonops', '056', [['Kebutuhan Operasional Diklat BLU', 1, 'THN', 1000000000]]],
  ['532111', 'Belanja Modal Peralatan dan Mesin',     'rm',  'nonops', '057', [['Pengadaan Simulator', 1, 'PKT', 4500000000], ['Pengadaan Perangkat Lab Komputer', 1, 'PKT', 1213000000]]],
  ['533111', 'Belanja Modal Gedung dan Bangunan',     'rm',  'nonops', '058', [['Pembangunan Asrama Taruna', 1, 'PKT', 2000000000]]],
  ['537112', 'Belanja Modal Peralatan dan Mesin (BLU)', 'blu', 'nonops', '059', [['Peralatan Laboratorium BLU', 1, 'PKT', 500000000]]],
];
function buildSeed() {
  var ys = yearOptions(); var yf = {}; yf[ys[0]] = 1.0; yf[ys[1]] = 0.95; yf[ys[2]] = 0.90;
  var recs = [];
  ys.forEach(function (yr) {
    var f = yf[yr];
    GROUPS.forEach(function (g, gi) {
      var akun = g[0], detail_akun = g[1], sd = g[2], kat = g[3], komp = g[4], items = g[5];
      items.forEach(function (it, ii) {
        var vol = it[1], hrg = Math.round(it[3] * f), nominal = vol * hrg;
        recs.push({
          id: yr + '-' + gi + '-' + ii, ta: yr,
          ba: '022', prog: '12.DL', keg: '3996', kro: 'SAB', ro: '005',
          komp: komp, subkomp: 'A',
          prog_nama: 'Pendidikan & Pelatihan Transportasi',
          keg_nama: 'Penyelenggaraan Diklat Transportasi Laut',
          kro_nama: 'Sarana Bidang Pendidikan',
          akun: akun, detail_akun: detail_akun, detail_belanja: it[0],
          vol: vol, sat: it[2], hrg_sat: hrg,
          sd: sd, kategori: kat, jenis: kodeToJenis(akun),
          pagu: pagu(nominal),
        });
      });
    });
  });
  return recs;
}

function recordsForYear(yr) { return APP.records.filter(function (r) { return r.ta === String(yr); }); }
function amountOf(r, stageKey) { return (r.pagu && r.pagu[stageKey]) || 0; }
function kodeOf(r) { return r.keg + '.' + r.kro + '.' + r.ro + '.' + r.akun; }

/* ── 6 Kartu ── */
function computeCards(yr, stageKey) {
  var s = { total: 0, ops: 0, nonops: 0, pegawai: 0, barang: 0, modal: 0 };
  recordsForYear(yr).forEach(function (r) {
    var a = amountOf(r, stageKey);
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
function cardsMarkup(yr, stageKey) {
  var s = computeCards(yr, stageKey), st = STAGE_LABEL[stageKey];
  function p(x) { return s.total > 0 ? (x / s.total * 100) : 0; }
  return (
    cardHtml('k-tot', 'g', 'sack-dollar', 'Total Anggaran (Ops + Non Ops)', fmtRp(s.total), 'PAGU ' + st + ' · TA ' + yr, 100, 'b', 'Keseluruhan usulan', recordsForYear(yr).length + ' baris') +
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
  var sub = document.getElementById('dashSub'); if (sub) sub.textContent = 'PIP MAKASSAR — TA ' + APP.year + ' · PAGU ' + STAGE_LABEL[APP.stage];
  var ps = document.getElementById('pengSub'); if (ps) ps.textContent = 'Informasi anggaran yang telah diinput — TA ' + APP.year + ' · PAGU ' + STAGE_LABEL[APP.stage];
}

/* ── Chart Usulan Anggaran ── */
var CHARTS = { usulan: null, pie1: null, pie2: null };
function chartReady() { return typeof Chart !== 'undefined'; }
function gridColor() { return getComputedStyle(document.body).getPropertyValue('--bd') || '#e2e8f0'; }
function tickColor() { return getComputedStyle(document.body).getPropertyValue('--t3') || '#8896a7'; }
function stageTotals(yr) { return STAGES.map(function (s) { var t = 0; recordsForYear(yr).forEach(function (r) { t += amountOf(r, s.key); }); return t; }); }
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
function jenisComposition(rows, stageKey) { var c = { pegawai: 0, barang: 0, modal: 0 }; rows.forEach(function (r) { c[r.jenis] += amountOf(r, stageKey); }); return c; }
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
function renderPie1() { if (CHARTS.pie1) { CHARTS.pie1.destroy(); CHARTS.pie1 = null; } var rows = recordsForYear(APP.year).filter(function (r) { return APP.pie1Src === 'gabungan' ? true : r.sd === APP.pie1Src; }); CHARTS.pie1 = renderPie('pie1Chart', 'pie1Legend', jenisComposition(rows, APP.stage)); }
function renderPie2() { if (CHARTS.pie2) { CHARTS.pie2.destroy(); CHARTS.pie2 = null; } var rows = recordsForYear(APP.year).filter(function (r) { return APP.pie2Cat === 'gabungan' ? true : r.kategori === APP.pie2Cat; }); CHARTS.pie2 = renderPie('pie2Chart', 'pie2Legend', jenisComposition(rows, APP.stage)); }

/* ── DAFTAR USULAN (pohon, gaya gambar 2) ───────────────────────────── */
function ufApply(rows) {
  var f = APP.uf, q = ((document.getElementById('ufQ') || {}).value || '').toLowerCase().trim();
  return rows.filter(function (r) {
    if (f.prog && r.prog !== f.prog) return false;
    if (f.kro && r.kro !== f.kro) return false;
    if (f.ro && r.ro !== f.ro) return false;
    if (f.akun && r.akun !== f.akun) return false;
    if (f.detail && r.detail_belanja !== f.detail) return false;
    if (f.sd && r.sd !== f.sd) return false;
    if (q) {
      var hay = [kodeOf(r), r.detail_akun, r.detail_belanja, r.akun, r.prog, r.kro, r.ro].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}
function groupByKode(rows) {
  var map = {}, order = [];
  rows.forEach(function (r) {
    var k = kodeOf(r);
    if (!map[k]) { map[k] = { kode: k, akun: r.akun, detail_akun: r.detail_akun, sd: r.sd, prog: r.prog, keg_nama: r.keg_nama, ro: r.ro, items: [], total: 0 }; order.push(k); }
    map[k].items.push(r); map[k].total += amountOf(r, APP.stage);
    if (map[k].sd !== r.sd) map[k].sd = 'mix';
  });
  return order.map(function (k) { return map[k]; });
}
function sdChip(sd) { return sd === 'mix' ? '<span class="src-rm">RM/BLU</span>' : '<span class="' + (sd === 'blu' ? 'src-blu' : 'src-rm') + '">' + (sd === 'blu' ? 'BLU' : 'RM') + '</span>'; }
function populateUsulanFilters() {
  var rows = recordsForYear(APP.year);
  function uniq(key) { var s = {}; rows.forEach(function (r) { s[r[key]] = true; }); return Object.keys(s).sort(); }
  var defs = [
    ['ufProg', 'prog', 'Semua Program', uniq('prog')],
    ['ufKro', 'kro', 'Semua KRO', uniq('kro')],
    ['ufRo', 'ro', 'Semua RO', uniq('ro')],
    ['ufAkun', 'akun', 'Semua Akun', uniq('akun')],
    ['ufDetail', 'detail', 'Semua Detail', uniq('detail_belanja')],
  ];
  defs.forEach(function (d) {
    var sel = document.getElementById(d[0]); if (!sel) return;
    var cur = APP.uf[d[1]];
    sel.innerHTML = '<option value="">' + d[2] + '</option>' + d[3].map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  });
}
function renderUsulanList() {
  var headEl = document.getElementById('usulanHead');
  if (headEl) headEl.innerHTML = ['KODE', 'URAIAN / AKUN', 'SUMBER', 'NILAI USULAN'].map(function (c, i) { return '<th' + (i === 3 ? ' style="text-align:right"' : '') + '>' + c + '</th>'; }).join('');
  var groups = groupByKode(ufApply(recordsForYear(APP.year)));
  var totalGroups = groups.length;
  var from = (APP.usulanPage - 1) * APP.PP, slice = groups.slice(from, from + APP.PP);
  var grand = 0; groups.forEach(function (g) { grand += g.total; });
  var badge = document.getElementById('usulanBadge'); if (badge) badge.textContent = totalGroups + ' Kegiatan';
  var info = document.getElementById('usulanInfo');
  if (info) info.textContent = totalGroups === 0 ? 'Tidak ada usulan' : ('Menampilkan ' + (from + 1) + '–' + Math.min(from + APP.PP, totalGroups) + ' dari ' + totalGroups + ' · Total ' + fmtRp(grand));
  var body = document.getElementById('usulanBody');
  if (body) {
    if (!slice.length) {
      body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:34px;color:var(--t3)"><i class="fas fa-inbox" style="font-size:22px;display:block;margin-bottom:8px"></i>Belum ada usulan</td></tr>';
    } else {
      var html = '';
      slice.forEach(function (g) {
        var open = !!APP.expanded[g.kode];
        html += '<tr class="detail-parent ' + (open ? 'expanded' : '') + '" onclick="toggleUsulan(\'' + g.kode + '\')">' +
          '<td class="mono">' + esc(g.kode) + '</td>' +
          '<td><div class="uraian-cell">' + esc(g.detail_akun) + '<small>' + esc(g.prog) + ' · ' + esc(g.keg_nama) + ' — RO ' + esc(g.ro) + '</small></div></td>' +
          '<td>' + sdChip(g.sd) + '</td>' +
          '<td class="mono" style="text-align:right;font-weight:700;color:var(--t1)">' + fmtRp(g.total) + '</td></tr>';
        if (open) {
          g.items.forEach(function (r) {
            html += '<tr class="detail-row"><td></td>' +
              '<td>' + esc(r.detail_belanja) + ' <span style="color:var(--t3)">(' + r.vol + ' ' + esc(r.sat) + ' × ' + fmtRp(r.hrg_sat) + ')</span></td>' +
              '<td></td>' +
              '<td class="mono" style="text-align:right">' + fmtRp(amountOf(r, APP.stage)) + '</td></tr>';
          });
        }
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

/* ── DATABASE (gaya gambar 3) di Modul Penganggaran ─────────────────── */
var DB_COLS = ['BA', 'Prog', 'Keg', 'KRO', 'RO', 'Komp', 'S.Komp', 'Akun', 'Detail Akun', 'Detail Belanja', 'SD', 'KATEG', 'Nilai (PAGU ' + '·)'];
function renderDatabase() {
  var head = document.getElementById('dbHead');
  var cols = ['BA', 'Prog', 'Keg', 'KRO', 'RO', 'Komp', 'S.Komp', 'Akun', 'Detail Akun', 'Detail Belanja', 'SD', 'KATEG', 'Nilai (PAGU ' + STAGE_LABEL[APP.stage] + ')'];
  if (head) head.innerHTML = cols.map(function (c, i) { return '<th' + (i === 12 ? ' style="text-align:right"' : '') + '>' + c + '</th>'; }).join('');
  var rows = recordsForYear(APP.year);
  var from = (APP.dbPage - 1) * APP.PP, slice = rows.slice(from, from + APP.PP);
  var badge = document.getElementById('dbBadge'); if (badge) badge.textContent = rows.length + ' Baris';
  var info = document.getElementById('dbInfo'); if (info) info.textContent = rows.length === 0 ? 'Belum ada data' : ('Menampilkan ' + (from + 1) + '–' + Math.min(from + APP.PP, rows.length) + ' dari ' + rows.length);
  var body = document.getElementById('dbBody');
  if (body) body.innerHTML = slice.length ? slice.map(function (r) {
    return '<tr>' +
      '<td class="mono">' + r.ba + '</td><td class="mono">' + r.prog + '</td><td class="mono">' + r.keg + '</td>' +
      '<td class="mono">' + r.kro + '</td><td class="mono">' + r.ro + '</td><td class="mono">' + r.komp + '</td>' +
      '<td class="mono">' + r.subkomp + '</td><td class="mono">' + r.akun + '</td>' +
      '<td>' + esc(r.detail_akun) + '</td><td>' + esc(r.detail_belanja) + '</td>' +
      '<td>' + sdChip(r.sd) + '</td>' +
      '<td><span class="' + (r.kategori === 'ops' ? 'cat-ops' : 'cat-nonops') + '">' + (r.kategori === 'ops' ? 'OPS' : 'NON OPS') + '</span></td>' +
      '<td class="mono" style="text-align:right;font-weight:600;color:var(--t1)">' + fmtRp(amountOf(r, APP.stage)) + '</td></tr>';
  }).join('') : '<tr><td colspan="13" style="text-align:center;padding:32px;color:var(--t3)">Belum ada data tersimpan</td></tr>';
  renderPagin('dbPagin', rows.length, APP.dbPage, APP.PP, 'goDb');
}
function goDb(p) { APP.dbPage = p; renderDatabase(); }

/* ── Download Kertas Kerja (CSV) ── */
function csvCell(v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function downloadKertasKerja() {
  var rows = recordsForYear(APP.year);
  if (!rows.length) { toast('error', 'Tidak Ada Data', 'Belum ada usulan untuk diunduh.'); return; }
  var head = ['BA', 'Program', 'Kegiatan', 'KRO', 'RO', 'Komponen', 'Sub Komponen', 'Akun', 'Detail Akun', 'Detail Belanja', 'SD', 'Kategori', 'Vol', 'Satuan', 'Harga Satuan', 'PAGU Kebutuhan', 'PAGU Indikatif', 'PAGU Anggaran', 'PAGU Alokasi'];
  var lines = [head.join(';')];
  rows.forEach(function (r) {
    lines.push([r.ba, r.prog, r.keg, r.kro, r.ro, r.komp, r.subkomp, r.akun, r.detail_akun, r.detail_belanja,
      r.sd.toUpperCase(), (r.kategori === 'ops' ? 'OPS' : 'NON OPS'), r.vol, r.sat, r.hrg_sat,
      r.pagu.kebutuhan, r.pagu.indikatif, r.pagu.anggaran, r.pagu.alokasi].map(csvCell).join(';'));
  });
  var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'Kertas_Kerja_RKA-KL_PIP_Makassar_TA' + APP.year + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('success', 'Kertas Kerja Diunduh', 'TA ' + APP.year + ' — ' + rows.length + ' baris (CSV, dapat dibuka di Excel).');
}

/* ── Pengaturan Data: referensi kode (BA..Detail Belanja) ── */
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
    return '<tr>' + r.map(function (c, i) {
      var val = (i === 9 && !c) ? '<span style="color:var(--t3)">—</span>' : esc(c);
      return '<td class="' + (i <= 7 ? 'mono' : '') + '">' + val + '</td>';
    }).join('') + '</tr>';
  }).join('');
}

/* ── Manajemen Akun ── */
function renderUsers() {
  var body = document.getElementById('userBody'); if (!body) return;
  body.innerHTML = '<tr><td class="mono">admin</td><td>Administrator</td>' +
    '<td><span class="pct-badge pct-m">Admin</span></td><td><span class="pct-badge pct-h">Aktif</span></td></tr>';
}

/* ── Render all ── */
function renderAll() {
  renderCards(); renderUsulanChart(); renderPie1(); renderPie2();
  populateUsulanFilters(); renderUsulanList(); renderDatabase();
}

/* ── Handlers ── */
function onPaguChange(v) { APP.stage = v; renderAll(); }
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
  if (pageId === 'manajemen') renderUsers();
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
  APP.records = buildSeed();
  populateYears();
  var ps = document.getElementById('paguSelect'); if (ps) ps.value = APP.stage;
  renderAll(); renderUsers(); renderRefTable();
}
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

/* Ekspor untuk pengujian Node */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    APP: APP, kodeToJenis: kodeToJenis, pagu: pagu, buildSeed: buildSeed, GROUPS: GROUPS,
    computeCards: computeCards, jenisComposition: jenisComposition, stageTotals: stageTotals,
    recordsForYear: recordsForYear, kodeOf: kodeOf, groupByKode: groupByKode, csvCell: csvCell,
    fmtRp: fmtRp, fmtM: fmtM, yearOptions: yearOptions, STAGES: STAGES,
  };
}
