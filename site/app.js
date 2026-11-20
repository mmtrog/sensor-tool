const $ = (s) => document.querySelector(s);
const nf = new Intl.NumberFormat('vi-VN');
const cf = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const GLOBAL_TOP = 200;

const state = { store: 'ios', region: 'global', chart: 'free', view: 'top', genre: '', q: '' };
let index, apps, current, histChart;
const cache = new Map();

// ---------------------------------------------------------------- data
async function getJson(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    }));
  }
  return cache.get(url);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k of Object.keys(state)) if (p.has(k)) state[k] = p.get(k);
}
function writeHash() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v) p.set(k, v);
  history.replaceState(null, '', `#${p}`);
}

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const appOf = (id) => apps[state.store][id] ?? {};
const storeUrl = (id, cc) => state.store === 'ios'
  ? `https://apps.apple.com/${cc === 'global' ? 'us' : cc}/app/id${id}`
  : `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const metricName = () => (state.store === 'ios' ? 'đánh giá' : 'lượt cài');
const countryName = (cc) => index.countries.find((c) => c.cc === cc)?.name ?? cc.toUpperCase();

function deltaHtml(d, isEntry) {
  if (isEntry) return '<span class="up" title="Không có trong top kỳ trước">▲ mới</span>';
  if (d == null) return '<span class="flat">—</span>';
  if (d > 0) return `<span class="up">▲ ${d}</span>`;
  if (d < 0) return `<span class="down">▼ ${-d}</span>`;
  return '<span class="flat">=</span>';
}
const growthHtml = (g) => (g == null ? '<span class="flat">—</span>' : g > 0 ? `<span class="up">+${cf.format(g)}</span>` : cf.format(g));

function sparkline(hist, max) {
  const pts = hist.map((r, i) => [i, r]).filter(([, r]) => r != null);
  if (pts.length < 2) return '<span class="flat">—</span>';
  const w = 90, h = 24, n = Math.max(hist.length - 1, 1);
  const d = pts.map(([i, r], k) => `${k ? 'L' : 'M'}${((i / n) * w).toFixed(1)},${(((r - 1) / (max - 1)) * (h - 2) + 1).toFixed(1)}`).join('');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/></svg>`;
}

// ---------------------------------------------------------------- views
function chartLimit() { return state.region === 'global' ? GLOBAL_TOP : index.limit; }

function selectRows() {
  let rows = current.rows;
  const q = state.q.trim().toLowerCase();
  if (state.genre) rows = rows.filter((r) => appOf(r.id).g === state.genre);
  if (q) rows = rows.filter((r) => { const a = appOf(r.id); return `${a.n} ${a.d} ${r.id}`.toLowerCase().includes(q); });

  const L = chartLimit();
  switch (state.view) {
    case 'rising':
      return rows
        .filter((r) => r.n7 || r.d7 > 0)
        .map((r) => ({ r, s: r.n7 ? L + 1 - r.rank : r.d7 }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r);
    case 'new':
      return rows.filter((r) => r.isNew);
    case 'growth':
      return rows.filter((r) => (r.g7 ?? r.g1) != null).sort((a, b) => (b.g7 ?? b.g1) - (a.g7 ?? a.g1));
    default:
      return rows;
  }
}

function hintText() {
  const days = index.days;
  const need = (n) => (days < n ? ` Cần ít nhất ${n} ngày dữ liệu (hiện có ${days}) để so sánh.` : '');
  const where = state.region === 'global' ? 'toàn cầu (gộp điểm các quốc gia theo trọng số)' : countryName(state.region);
  return {
    top: `Top ${chartLimit()} ${where}.${need(2)}`,
    rising: `Game tăng hạng nhiều nhất so với 7 ngày trước, gồm cả game mới lọt vào top.${need(8)}`,
    new: `Game có mặt hôm nay nhưng không xuất hiện trong top ở bất kỳ ngày nào trong 7 ngày trước.${need(2)}`,
    growth: `Sắp theo số ${metricName()} tăng thêm trong 7 ngày (hoặc 1 ngày nếu chưa đủ 7).${need(2)}`,
  }[state.view];
}

function render() {
  const isGlobal = state.region === 'global';
  const growthLabel = state.store === 'ios' ? 'Đánh giá +7n' : 'Lượt cài +7n';
  $('#growthTab').textContent = state.store === 'ios' ? 'Tăng đánh giá' : 'Tăng lượt cài';

  $('#tbl thead').innerHTML = `<tr>
    <th class="num">#</th>
    <th class="num hide-sm">1 ngày</th>
    <th class="num">7 ngày</th>
    <th>Game</th>
    <th class="hide-sm">Thể loại</th>
    ${isGlobal ? '<th>Quốc gia lọt top</th>' : ''}
    <th class="num">${growthLabel}</th>
    <th class="num hide-sm">Tổng ${metricName()}</th>
    <th class="hide-sm">Hạng ${index.days} ngày</th>
  </tr>`;

  const rows = selectRows();
  const L = chartLimit();
  $('#tbl tbody').innerHTML = rows.map((r) => {
    const a = appOf(r.id);
    const hot = !r.isNew && r.d7 >= 20 && r.rank <= 50;
    const ccs = isGlobal
      ? `<td><div class="ccs"><span class="cc"><b>${r.countries.length}</b> nước</span>${r.countries.slice(0, 6).map(([cc, k]) => `<span class="cc" title="${esc(countryName(cc))}">${cc.toUpperCase()} <b>#${k}</b></span>`).join('')}</div></td>`
      : '';
    return `<tr data-id="${esc(r.id)}">
      <td class="num rank">${r.rank}</td>
      <td class="num hide-sm">${deltaHtml(r.d1, false)}</td>
      <td class="num">${deltaHtml(r.d7, r.n7)}</td>
      <td><div class="game"><img loading="lazy" src="${esc(a.i)}" alt=""><div>
        <div class="t">${esc(a.n ?? r.id)}${r.isNew ? '<span class="badge">MỚI</span>' : ''}${hot ? '<span class="badge hot">HOT</span>' : ''}</div>
        <div class="d">${esc(a.d)}</div></div></div></td>
      <td class="genre hide-sm">${esc(a.g ?? '—')}</td>
      ${ccs}
      <td class="num">${growthHtml(r.g7 ?? r.g1)}</td>
      <td class="num hide-sm">${r.m == null ? '—' : cf.format(r.m)}</td>
      <td class="hide-sm">${sparkline(r.hist, L)}</td>
    </tr>`;
  }).join('');
  $('#empty').hidden = rows.length > 0;
  $('#hint').textContent = hintText();
}

// ---------------------------------------------------------------- detail
function openDetail(id) {
  const r = current.rows.find((x) => x.id === id);
  if (!r) return;
  const a = appOf(id);
  const isGlobal = state.region === 'global';
  $('#detailBody').innerHTML = `
    <div class="d-head">
      <img src="${esc(a.i)}" alt="">
      <div>
        <h2>${esc(a.n ?? id)}</h2>
        <div>${esc(a.d)} · ${esc(a.g ?? '—')}${a.rd ? ` · phát hành ${esc(a.rd)}` : ''}</div>
        <a href="${storeUrl(id, state.region)}" target="_blank" rel="noopener">Mở trên ${state.store === 'ios' ? 'App Store' : 'Google Play'} ↗</a>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Hạng ${isGlobal ? 'toàn cầu' : countryName(state.region)}</div><div class="v">#${r.rank}</div></div>
      <div class="stat"><div class="k">So với 7 ngày</div><div class="v">${deltaHtml(r.d7, r.n7)}</div></div>
      <div class="stat"><div class="k">Tổng ${metricName()}</div><div class="v">${r.m == null ? '—' : nf.format(r.m)}</div></div>
      <div class="stat"><div class="k">${cap(metricName())} +1 ngày</div><div class="v">${growthHtml(r.g1)}</div></div>
      <div class="stat"><div class="k">${cap(metricName())} +7 ngày</div><div class="v">${growthHtml(r.g7)}</div></div>
    </div>
    ${isGlobal ? `<div class="ccs d-ccs">${r.countries.map(([cc, k]) => `<span class="cc">${esc(countryName(cc))} <b>#${k}</b></span>`).join('')}</div>` : ''}`;

  const dlg = $('#detail');
  dlg.showModal();
  if (!window.Chart) return;
  histChart?.destroy();
  const css = getComputedStyle(document.documentElement);
  histChart = new Chart($('#histChart'), {
    type: 'line',
    data: {
      labels: current.dates,
      datasets: [{
        label: 'Hạng', data: r.hist, spanGaps: false, tension: 0.25, pointRadius: 2,
        borderColor: css.getPropertyValue('--accent').trim(), backgroundColor: css.getPropertyValue('--accent').trim(),
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { reverse: true, min: 1, suggestedMax: Math.min(chartLimit(), Math.max(...r.hist.filter(Boolean)) + 5), ticks: { precision: 0, color: css.getPropertyValue('--muted').trim() }, grid: { color: css.getPropertyValue('--line').trim() } },
        x: { ticks: { color: css.getPropertyValue('--muted').trim(), maxRotation: 0, autoSkip: true }, grid: { display: false } },
      },
    },
  });
}

// ---------------------------------------------------------------- controls
function syncControls() {
  for (const k of ['store', 'chart', 'view']) {
    document.querySelectorAll(`#${k} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === state[k]));
  }
  const regions = [{ cc: 'global', name: '🌍 Toàn cầu' }, ...index.countries.filter((c) => c.stores.includes(state.store))];
  if (!regions.some((r) => r.cc === state.region)) state.region = 'global';
  $('#region').innerHTML = regions.map((r) => `<option value="${r.cc}" ${r.cc === state.region ? 'selected' : ''}>${esc(r.name)}${r.cc === 'global' ? '' : ` (${r.cc.toUpperCase()})`}</option>`).join('');

  const genres = [...new Set(Object.values(apps[state.store]).map((a) => a.g).filter(Boolean))].sort();
  if (state.genre && !genres.includes(state.genre)) state.genre = '';
  $('#genre').innerHTML = `<option value="">Mọi thể loại</option>${genres.map((g) => `<option ${g === state.genre ? 'selected' : ''}>${esc(g)}</option>`).join('')}`;
  $('#q').value = state.q;
}

async function load() {
  syncControls();
  writeHash();
  try {
    current = await getJson(`data/${state.store}/${state.region}_${state.chart}.json`);
    render();
  } catch (e) {
    $('#tbl tbody').innerHTML = '';
    $('#empty').hidden = false;
    $('#empty').textContent = `Không có dữ liệu cho lựa chọn này (${e.message}).`;
  }
}

function bindSeg(id) {
  $(`#${id}`).addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v || v === state[id]) return;
    state[id] = v;
    if (id === 'view') { syncControls(); writeHash(); render(); } else load();
  });
}

async function init() {
  readHash();
  [index, apps] = await Promise.all([getJson('data/index.json'), getJson('data/apps.json')]);
  $('#meta').textContent = `Cập nhật ${index.date} · ${index.days} ngày lịch sử${index.errors.length ? ` · ${index.errors.length} lỗi lần thu thập gần nhất` : ''}`;
  if (index.errors.length) $('#meta').title = index.errors.join('\n');

  ['store', 'chart', 'view'].forEach(bindSeg);
  $('#region').addEventListener('change', (e) => { state.region = e.target.value; load(); });
  $('#genre').addEventListener('change', (e) => { state.genre = e.target.value; writeHash(); render(); });
  let t;
  $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; writeHash(); render(); }, 150); });
  $('#tbl tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openDetail(tr.dataset.id); });
  $('#detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  window.addEventListener('hashchange', () => { readHash(); load(); });
  await load();
}

init().catch((e) => { $('#meta').textContent = `Lỗi tải dữ liệu: ${e.message}`; });
