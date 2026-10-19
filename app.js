/* =====================================================
   记账小助手 app.js
   记账为唯一数据源，价格对比与库存由记账数据自动汇总
   ===================================================== */
'use strict';

const LS_KEY = 'jizhang.data.v1';

/* ---------------- 基础工具 ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtMoney(n) {
  n = Number(n) || 0;
  const neg = n < 0;
  const s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-¥' : '¥') + s;
}

function fmtQty(n) {
  n = Number(n) || 0;
  return String(Math.round(n * 100) / 100);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toDateStr(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function todayStr() { return toDateStr(new Date()); }

function parseDate(s) {
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function addDaysStr(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function weekStart(s) { /* 周一作为一周开始 */
  const d = parseDate(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateStr(d);
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function round2(n) { return Math.round(n * 100) / 100; }

function isPureNumber(s) {
  return /^\d+(\.\d+)?$/.test(String(s == null ? '' : s).trim());
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function catName(of) {
  const c = (of == null ? '' : String(of)).trim();
  return c || '未分类';
}

/* ---------------- 数据存取 ---------------- */
function normalizeRecord(r) {
  return {
    id: r.id || uid(),
    date: r.date || todayStr(),
    name: String(r.name == null ? '' : r.name).trim(),
    category: r.category ? String(r.category) : '',
    price: Number(r.price) || 0,
    quantity: r.quantity == null ? '' : String(r.quantity),
    total: Number(r.total != null ? r.total : r.amount) || 0,
    usageDays: Number(r.usageDays) || 0,
    createdAt: Number(r.createdAt) || Date.now()
  };
}

/* 旧版「登记物品」转换为记账记录 */
function itemToRecord(it) {
  if (!it || !it.name) return null;
  return {
    id: uid(),
    date: it.startDate || (it.createdAt ? toDateStr(new Date(it.createdAt)) : todayStr()),
    name: String(it.name).trim(),
    category: it.category ? String(it.category) : '',
    price: Number(it.price) || 0,
    quantity: it.quantity == null ? '' : String(it.quantity),
    total: Number(it.totalAmount) || 0,
    usageDays: Number(it.usageDays) || 0,
    createdAt: Number(it.createdAt) || Date.now()
  };
}

let migrated = false;

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d) return null;
    let records = [];
    if (Array.isArray(d.records)) records = d.records.map(normalizeRecord).filter((r) => r.name);
    if (Array.isArray(d.items)) {
      d.items.forEach((it) => {
        const rec = itemToRecord(it);
        if (rec) records.push(rec);
      });
      migrated = true;
    }
    return { records };
  } catch (e) { return null; }
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); }
  catch (e) { toast('保存失败：浏览器存储不可用'); }
}

let db = load() || { records: [] };

/* 由记账记录汇总物品（同名合并） */
function buildItems() {
  const map = new Map();
  db.records.forEach((r) => {
    if (!map.has(r.name)) map.set(r.name, []);
    map.get(r.name).push(r);
  });
  const items = [];
  map.forEach((recs, name) => {
    recs.sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : a.createdAt - b.createdAt)));
    const last = recs[recs.length - 1];
    let withDays = null;
    for (let i = recs.length - 1; i >= 0; i -= 1) {
      if (recs[i].usageDays > 0) { withDays = recs[i]; break; }
    }
    let lastCat = '';
    for (let i = recs.length - 1; i >= 0; i -= 1) {
      if (recs[i].category) { lastCat = recs[i].category; break; }
    }
    items.push({
      name: name,
      category: lastCat,
      price: last.price || 0,
      quantity: last.quantity || '',
      totalAmount: last.total || 0,
      usageDays: withDays ? withDays.usageDays : 0,
      startDate: withDays ? withDays.date : '',
      createdAt: recs[0].createdAt,
      records: recs,
      priceHistory: recs.map((r) => ({ date: r.date, price: r.total || 0 }))
    });
  });
  return items;
}

function findItem(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return null;
  return buildItems().find((i) => i.name === n) || null;
}

function groupByCategory(items) {
  const m = new Map();
  items.forEach((it) => {
    const c = catName(it.category);
    if (!m.has(c)) m.set(c, []);
    m.get(c).push(it);
  });
  const arr = Array.from(m.entries()).map(([category, list]) => ({ category: category, list: list }));
  arr.sort((a, b) => {
    if (a.category === '未分类') return 1;
    if (b.category === '未分类') return -1;
    return a.category.localeCompare(b.category, 'zh');
  });
  return arr;
}

/* 剩余使用天数（连续时间，进度随时间动态变化） */
function remainingOf(it) {
  if (!(it.usageDays > 0)) return null;
  const start = it.startDate || toDateStr(new Date(it.createdAt));
  const startMs = parseDate(start).getTime();
  const elapsedDays = Math.max(0, (Date.now() - startMs) / 86400000);
  const remainDays = it.usageDays - elapsedDays;
  const pct = clamp((elapsedDays / it.usageDays) * 100, 0, 100);
  const remainPct = 100 - pct;
  let estQty = null;
  if (isPureNumber(it.quantity)) {
    estQty = parseFloat(it.quantity) * clamp(remainDays, 0, it.usageDays) / it.usageDays;
  }
  return { start: start, elapsedDays: elapsedDays, remainDays: remainDays, pct: pct, remainPct: remainPct, estQty: estQty };
}

/* ---------------- 提示条 ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- 弹窗 ---------------- */
function openModal(title, bodyHtml, buttons) {
  $('#modal-title').textContent = title || '';
  $('#modal-body').innerHTML = bodyHtml;
  const foot = $('#modal-foot');
  foot.innerHTML = '';
  (buttons || [{ label: '关闭', cls: 'ghost', fn: closeModal }]).forEach((b) => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || 'primary');
    el.textContent = b.label;
    el.onclick = () => { try { b.fn(); } catch (err) { console.error(err); } };
    foot.appendChild(el);
  });
  $('#modal-backdrop').classList.add('show');
  document.body.classList.add('modal-open');
}

function closeModal() {
  $('#modal-backdrop').classList.remove('show');
  document.body.classList.remove('modal-open');
}

$('#modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});

/* ---------------- 页面切换 ---------------- */
const TAB_TITLES = {
  records: '📝 每日记账',
  price: '💹 价格对比',
  stock: '📦 剩余天数'
};

function switchTab(page) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  $('#page-title').textContent = TAB_TITLES[page] || '';
  if (page === 'records') { refreshSuggestions(); renderRecords(); }
  if (page === 'price') renderPrice();
  if (page === 'stock') renderStock();
  window.scrollTo(0, 0);
}

/* =====================================================
   页1：每日记账
   ===================================================== */
function autoFromPrice() {
  const p = parseFloat($('#r-price').value);
  const q = $('#r-qty').value.trim();
  const totalEl = $('#r-total');
  if (p > 0 && isPureNumber(q)) {
    const auto = String(round2(p * parseFloat(q)));
    if (totalEl.value === '' || totalEl.value === (totalEl.dataset.auto || '')) {
      totalEl.value = auto;
      totalEl.dataset.auto = auto;
    }
  }
}

function autoFromTotal() {
  const t = parseFloat($('#r-total').value);
  const q = $('#r-qty').value.trim();
  const priceEl = $('#r-price');
  if (t > 0 && isPureNumber(q)) {
    const auto = String(round2(t / parseFloat(q)));
    if (priceEl.value === '' || priceEl.value === (priceEl.dataset.auto || '')) {
      priceEl.value = auto;
      priceEl.dataset.auto = auto;
    }
  }
}

/* 换算等数量确认（change）后再进行 */
$('#r-price').addEventListener('change', () => {
  $('#r-price').dataset.auto = '';
  autoFromPrice();
});

$('#r-total').addEventListener('change', () => {
  $('#r-total').dataset.auto = '';
  autoFromTotal();
});

$('#r-qty').addEventListener('change', () => {
  const q = $('#r-qty').value.trim();
  if (!isPureNumber(q)) return;
  if (parseFloat($('#r-price').value) > 0) autoFromPrice();
  else if (parseFloat($('#r-total').value) > 0) autoFromTotal();
});

/* 输入已有物品名时，自动带出分类/单价/使用天数（仅填空字段） */
$('#r-name').addEventListener('change', () => {
  const it = findItem($('#r-name').value);
  if (!it) return;
  if (!$('#r-cat').value.trim()) $('#r-cat').value = it.category || '';
  if (!$('#r-price').value) $('#r-price').value = it.price || '';
  if (!$('#r-days').value) $('#r-days').value = it.usageDays || '';
});

$('#record-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const date = $('#r-date').value || todayStr();
  const name = $('#r-name').value.trim();
  const category = $('#r-cat').value.trim();
  const price = parseFloat($('#r-price').value) || 0;
  const qty = $('#r-qty').value.trim();
  const days = parseInt($('#r-days').value, 10) || 0;
  let total = parseFloat($('#r-total').value);
  if (!name) { toast('请填写物品名称'); return; }
  if (!(total > 0)) {
    if (price > 0 && isPureNumber(qty)) {
      total = round2(price * parseFloat(qty));
    } else {
      toast('请填写总价'); return;
    }
  }
  db.records.push({
    id: uid(), date: date, name: name, category: category, price: price,
    quantity: qty, total: round2(total), usageDays: days, createdAt: Date.now()
  });
  save();
  $('#record-form').reset();
  $('#r-date').value = date;
  $('#r-price').dataset.auto = '';
  $('#r-total').dataset.auto = '';
  refreshSuggestions();
  refreshCategories();
  renderRecords();
  renderPrice();
  renderStock();
  toast('已记一笔');
});

function recordsForDate(date) {
  return db.records.filter((r) => r.date === date).sort((a, b) => a.createdAt - b.createdAt);
}

function groupRecords(recs) {
  const m = new Map();
  recs.forEach((r) => {
    if (!m.has(r.name)) m.set(r.name, { name: r.name, amount: 0, entries: [] });
    const g = m.get(r.name);
    g.amount += r.total;
    g.entries.push(r);
  });
  return Array.from(m.values()).map((g) => ({
    name: g.name,
    amount: g.amount,
    entries: g.entries,
    qtyText: g.entries.map((en) => en.quantity).filter(Boolean).join('、')
  })).sort((a, b) => b.amount - a.amount);
}

function renderRecords() {
  const t = todayStr();
  const date = $('#r-date').value || t;

  /* 四个汇总：均按今天计算 */
  const todaySum = recordsForDate(t).reduce((s, r) => s + r.total, 0);
  const ws = weekStart(t);
  const weekSum = db.records
    .filter((r) => r.date >= ws && r.date < addDaysStr(ws, 7))
    .reduce((s, r) => s + r.total, 0);
  const monthSum = db.records
    .filter((r) => r.date.slice(0, 7) === t.slice(0, 7))
    .reduce((s, r) => s + r.total, 0);
  const yearSum = db.records
    .filter((r) => r.date.slice(0, 4) === t.slice(0, 4))
    .reduce((s, r) => s + r.total, 0);

  $('#sum-day').textContent = fmtMoney(todaySum);
  $('#sum-week').textContent = fmtMoney(weekSum);
  $('#sum-month').textContent = fmtMoney(monthSum);
  $('#sum-year').textContent = fmtMoney(yearSum);

  /* 选中日期的明细 */
  const recs = recordsForDate(date);
  const daySum = recs.reduce((s, r) => s + r.total, 0);
  $('#day-total').innerHTML = `${date} 合计 <b>${fmtMoney(daySum)}</b> · ${recs.length} 笔`;

  const groups = groupRecords(recs);
  const box = $('#record-list');
  if (!groups.length) {
    box.innerHTML = '<div class="empty">这一天还没有记账记录</div>';
  } else {
    box.innerHTML = groups.map((g) => `
      <div class="card rec-group">
        <div class="item-head">
          <div class="item-name">${esc(g.name)}</div>
          <div class="item-total">${fmtMoney(g.amount)}</div>
        </div>
        <div class="item-meta">${g.entries.length} 笔${g.qtyText ? ' · 数量 ' + esc(g.qtyText) : ''}<span class="chev">▾</span></div>
        <div class="rec-detail hidden">
          ${g.entries.map((en) => `<div class="rec-entry">${en.quantity ? esc(en.quantity) : '—'} · ${fmtMoney(en.total)}<button class="mini danger" data-del="${en.id}">删</button></div>`).join('')}
        </div>
      </div>`).join('');
  }

  renderChart();
}

$('#r-date').addEventListener('change', renderRecords);

$('#record-list').addEventListener('click', (e) => {
  const del = e.target.closest('button[data-del]');
  if (del) {
    db.records = db.records.filter((r) => r.id !== del.dataset.del);
    save(); renderAll(); toast('已删除一笔');
    return;
  }
  const head = e.target.closest('.item-head, .item-meta');
  if (head) {
    const card = head.closest('.rec-group');
    const detail = card.querySelector('.rec-detail');
    detail.classList.toggle('hidden');
    const chev = card.querySelector('.chev');
    if (chev) chev.textContent = detail.classList.contains('hidden') ? '▾' : '▴';
  }
});

/* ---------------- 花费占比图 ---------------- */
let statRange = 'month';

$$('.period-tab').forEach((b) => b.addEventListener('click', () => {
  statRange = b.dataset.range;
  $$('.period-tab').forEach((x) => x.classList.toggle('active', x === b));
  renderChart();
}));

function inRange(range) {
  const t = todayStr();
  if (range === 'today') return (r) => r.date === t;
  if (range === 'week') {
    const s = weekStart(t);
    return (r) => r.date >= s && r.date < addDaysStr(s, 7);
  }
  if (range === 'month') return (r) => r.date.slice(0, 7) === t.slice(0, 7);
  return (r) => r.date.slice(0, 4) === t.slice(0, 4); /* year */
}

const PALETTE = ['#4f7cff', '#22c55e', '#f59e0b', '#ff5b8a', '#8b5cf6', '#06b6d4',
  '#f97316', '#84cc16', '#ec4899', '#6366f1', '#14b8a6', '#eab308'];

function drawPie(data, total) {
  const canvas = $('#pie-chart');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = 240;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!data.length || total <= 0) {
    ctx.fillStyle = '#b6bece';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('该区间暂无消费数据', w / 2, h / 2);
    return;
  }
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 14;
  const r = R * 0.6;
  let ang = -Math.PI / 2;
  data.forEach((d, i) => {
    const a2 = ang + (d.amount / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, ang, a2);
    ctx.closePath();
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.fill();
    ang = a2;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8a94a6';
  ctx.font = '13px sans-serif';
  ctx.fillText('总支出', cx, cy - 2);
  ctx.fillStyle = '#1d2433';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(fmtMoney(total), cx, cy + 18);
}

function renderChart() {
  const recs = db.records.filter(inRange(statRange));
  const total = recs.reduce((s, r) => s + r.total, 0);
  $('#stat-total').textContent = fmtMoney(total);
  $('#stat-count').textContent = recs.length + ' 笔';
  const m = new Map();
  recs.forEach((r) => m.set(r.name, (m.get(r.name) || 0) + r.total));
  const data = Array.from(m.entries())
    .map(([name, amount]) => ({ name: name, amount: amount }))
    .sort((a, b) => b.amount - a.amount);

  drawPie(data, total);

  const legend = $('#chart-legend');
  if (!data.length) {
    legend.innerHTML = '';
    $('#top-card').classList.add('hidden');
    return;
  }
  legend.innerHTML = data.map((d, i) => `
    <div class="legend-row">
      <span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <span class="lname">${esc(d.name)}</span>
      <span class="lpct">${(d.amount / total * 100).toFixed(1)}%</span>
      <span class="lamt">${fmtMoney(d.amount)}</span>
    </div>`).join('');
  const top = data[0];
  $('#top-card').classList.remove('hidden');
  $('#top-card').innerHTML = `👑 消费大头：<b>${esc(top.name)}</b> ${fmtMoney(top.amount)}，占 ${(top.amount / total * 100).toFixed(1)}%`;
}

window.addEventListener('resize', () => {
  if ($('#page-records').classList.contains('active')) renderChart();
});

/* =====================================================
   页2：价格对比（同名合并，价格变化）
   ===================================================== */
/* 最新价格涨跌：贵了绿色上标 ▲，降了红色下标 ▼ */
function trendMark(latest, prev) {
  if (prev == null) return '';
  const d = latest - prev;
  if (d > 0) return '<sup class="up">▲</sup>';
  if (d < 0) return '<sub class="down">▼</sub>';
  return '<span class="muted" style="font-size:11px">持平</span>';
}

function priceCard(it) {
  const hist = it.priceHistory;
  const latest = hist.length ? hist[hist.length - 1].price : it.totalAmount;
  const prev = hist.length >= 2 ? hist[hist.length - 2].price : null;
  const rows = hist.length
    ? hist.map((h) => `<li><span class="d">${h.date}</span><span>${fmtMoney(h.price)}</span></li>`).join('')
    : '<li><span class="d muted">暂无价格记录</span></li>';
  return `
  <div class="card price-card">
    <div class="item-head">
      <div class="item-name">${esc(it.name)}</div>
      <div class="item-total">${fmtMoney(latest)}${trendMark(latest, prev)}</div>
    </div>
    <div class="item-meta">数量 ${esc(it.quantity || '—')}${it.usageDays ? ` · 使用 ${it.usageDays} 天` : ''}</div>
    <details class="hist">
      <summary>价格记录（${hist.length}）</summary>
      <ul class="price-list">${rows}</ul>
    </details>
  </div>`;
}

function renderPrice() {
  const box = $('#price-list');
  const items = buildItems();
  if (!items.length) {
    box.innerHTML = '<div class="empty">还没有记账记录<br>在「记账」页记一笔后，这里会自动汇总价格变化</div>';
    return;
  }
  items.sort((a, b) => {
    const da = a.priceHistory.length ? a.priceHistory[a.priceHistory.length - 1].date : '';
    const dbd = b.priceHistory.length ? b.priceHistory[b.priceHistory.length - 1].date : '';
    return da < dbd ? 1 : (da > dbd ? -1 : 0);
  });
  box.innerHTML = items.map((it) => priceCard(it)).join('');
}

/* =====================================================
   页3：剩余使用天数（库存）
   ===================================================== */
function stockCard(it) {
  const ro = remainingOf(it);
  if (!ro) {
    return `
    <div class="card stock-card">
      <div class="item-head">
        <div class="item-name">${esc(it.name)}</div>
        <span class="badge muted-badge">未设置</span>
      </div>
      <div class="item-meta">数量 ${esc(it.quantity || '—')} · 总价 ${fmtMoney(it.totalAmount)} · 未设置使用天数</div>
      <div class="item-actions"><button class="mini danger" data-del="${esc(it.name)}">删除</button></div>
    </div>`;
  }
  const remainDays = Math.max(0, Math.ceil(ro.remainDays));
  let status, cls;
  if (ro.remainDays <= 0) { status = '已用完'; cls = 'badge danger'; }
  else if (ro.remainDays <= 3) { status = '即将用完'; cls = 'badge warn'; }
  else if (ro.pct >= 70) { status = '注意'; cls = 'badge warn'; }
  else { status = '充足'; cls = 'badge ok'; }
  const qtyInfo = ro.estQty != null
    ? `预计剩余数量：${fmtQty(ro.estQty)} / ${esc(it.quantity)}`
    : `数量：${esc(it.quantity || '—')}`;
  return `
  <div class="card stock-card">
    <div class="item-head">
      <div class="item-name">${esc(it.name)}</div>
      <span class="${cls}">${status}</span>
    </div>
    <div class="stock-days">已用 ${Math.floor(ro.elapsedDays)} 天 / 共 ${it.usageDays} 天 · <b>剩余 ${remainDays} 天</b></div>
    <div class="progress"><div class="bar" style="width:${ro.remainPct.toFixed(2)}%"></div></div>
    <div class="item-meta">${qtyInfo} · 总价 ${fmtMoney(it.totalAmount)}${it.startDate ? ' · 开始 ' + it.startDate : ''}</div>
    <div class="item-actions"><button class="mini danger" data-del="${esc(it.name)}">删除</button></div>
  </div>`;
}

function deleteItem(name) {
  const n = db.records.filter((r) => r.name === name).length;
  openModal('删除物品', `确定删除「${esc(name)}」吗？<br><span class="muted" style="font-size:13px">将同时删除该物品的 ${n} 条记账记录</span>`, [
    { label: '取消', cls: 'ghost', fn: closeModal },
    { label: '删除', cls: 'danger', fn: () => {
      db.records = db.records.filter((r) => r.name !== name);
      save(); renderAll(); closeModal(); toast('已删除');
    } }
  ]);
}

function renderStock() {
  const items = buildItems();
  const totalValue = items.reduce((s, i) => s + i.totalAmount, 0);
  const lowCount = items.filter((i) => {
    const ro = remainingOf(i);
    return ro && ro.remainDays <= 3;
  }).length;

  $('#stock-sum').innerHTML = `
    <div class="tile"><div class="num">${items.length}</div><div class="lbl">物品数</div></div>
    <div class="tile"><div class="num">${fmtMoney(totalValue)}</div><div class="lbl">物资总值</div></div>
    <div class="tile"><div class="num">${lowCount}</div><div class="lbl">需补货</div></div>`;

  const box = $('#stock-list');
  if (!items.length) {
    box.innerHTML = '<div class="empty">还没有物品<br>在「记账」页记一笔并填写使用天数后，这里会自动显示剩余天数</div>';
    return;
  }
  const groups = groupByCategory(items);
  groups.forEach((g) => {
    g.list.sort((a, b) => {
      const ra = remainingOf(a);
      const rb = remainingOf(b);
      if (ra && rb) return ra.remainDays - rb.remainDays;
      if (ra) return -1;
      if (rb) return 1;
      return 0;
    });
  });
  box.innerHTML = groups.map((g) => `
    <div class="cat-group">
      <div class="cat-head">📁 ${esc(g.category)} <span class="cat-count">${g.list.length}</span></div>
      ${g.list.map((it) => stockCard(it)).join('')}
    </div>`).join('');
}

$('#stock-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-del]');
  if (btn) deleteItem(btn.dataset.del);
});

/* 时间推进：剩余天数/进度条随时间动态变化 */
function refreshTimeSensitive() {
  if (document.hidden) return;
  if ($('#page-stock').classList.contains('active')) renderStock();
}
setInterval(refreshTimeSensitive, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTimeSensitive(); });

/* =====================================================
   记账辅助：快捷填写 / 候选
   ===================================================== */
function renderQuickChips() {
  const wrap = $('#quick-rec');
  const box = $('#rec-chips');
  const items = buildItems();
  if (!items.length) { wrap.classList.add('hidden'); box.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  box.innerHTML = items.map((it) => `<button type="button" class="chip" data-name="${esc(it.name)}" data-cat="${esc(it.category)}" data-price="${it.price}" data-days="${it.usageDays || ''}">${esc(it.name)}</button>`).join('');
}

$('#rec-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $('#r-name').value = chip.dataset.name;
  $('#r-cat').value = chip.dataset.cat || '';
  $('#r-price').value = parseFloat(chip.dataset.price) > 0 ? chip.dataset.price : '';
  $('#r-days').value = chip.dataset.days || '';
  $('#r-total').focus();
});

function refreshSuggestions() {
  const names = new Set();
  db.records.forEach((r) => names.add(r.name));
  $('#item-suggestions').innerHTML = Array.from(names)
    .map((n) => `<option value="${esc(n)}"></option>`).join('');
  renderQuickChips();
}

function refreshCategories() {
  const set = new Set();
  db.records.forEach((r) => {
    if (r.category && String(r.category).trim()) set.add(String(r.category).trim());
  });
  $('#category-suggestions').innerHTML = Array.from(set)
    .map((c) => `<option value="${esc(c)}"></option>`).join('');
}

/* =====================================================
   安装到桌面（PWA 安装引导）
   ===================================================== */
let installPromptEvt = null;

function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

function isStandalone() {
  return window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
}

function hideInstallBanner() { $('#install-banner').classList.add('hidden'); }

function installBannerState() {
  if (isStandalone()) { hideInstallBanner(); return; }
  const btn = $('#install-btn');
  if (installPromptEvt) {
    $('#install-text').textContent = '可安装到手机桌面，像 App 一样使用';
    btn.textContent = '📲 安装';
    btn.onclick = () => { installPromptEvt.prompt(); installPromptEvt.userChoice.then(() => { installPromptEvt = null; hideInstallBanner(); }); };
    $('#install-banner').classList.remove('hidden');
  } else if (isIOS()) {
    $('#install-text').textContent = 'iPhone：点「分享」→「添加到主屏幕」';
    btn.textContent = '知道了';
    btn.onclick = hideInstallBanner;
    $('#install-banner').classList.remove('hidden');
  } else {
    hideInstallBanner();
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPromptEvt = e;
  installBannerState();
});

window.addEventListener('appinstalled', () => {
  installPromptEvt = null;
  hideInstallBanner();
  toast('已安装到桌面 🎉');
});

$('#install-close').addEventListener('click', hideInstallBanner);

function openInstallGuide() {
  if (isStandalone()) { closeModal(); toast('已在独立窗口中运行'); return; }
  if (installPromptEvt) { installPromptEvt.prompt(); installPromptEvt.userChoice.then(() => { installPromptEvt = null; }); closeModal(); return; }
  if (isIOS()) {
    openModal('📲 iPhone 安装方法', `
      <ol class="guide-list">
        <li>用 <b>Safari</b> 打开本网页（从微信打开请点右上角「···」→「在 Safari 中打开」）；</li>
        <li>点屏幕底部的<b>分享按钮</b>；</li>
        <li>选择<b>「添加到主屏幕」</b> → 点「添加」。</li>
      </ol>`, [{ label: '知道了', cls: 'primary', fn: closeModal }]);
  } else {
    openModal('📲 安装到桌面', `
      <ul class="guide-list">
        <li><b>安卓 Chrome / Edge</b>：点浏览器菜单 ⋮ → 「安装应用」；</li>
        <li>找不到选项时，等页面打开后<b>刷新一次</b>再试；</li>
        <li>必须通过 <b>https 网址</b>（GitHub Pages 网址）访问，本地打开的文件不支持安装；</li>
        <li>微信 / QQ 内置浏览器不支持安装，请复制链接到 Chrome 打开。</li>
      </ul>`, [{ label: '知道了', cls: 'primary', fn: closeModal }]);
  }
}

/* =====================================================
   设置：导出 / 导入 / 清空
   ===================================================== */
$('#settings-btn').addEventListener('click', () => {
  openModal('⚙️ 设置', `
    <div class="settings-note">数据保存在手机浏览器本地（不联网、不上传）。卸载浏览器或清除数据会丢失，请定期导出备份。<br>当前数据：${db.records.length} 条记账记录。</div>
  `, [
    { label: '导出数据', cls: 'primary', fn: exportData },
    { label: '导入数据', cls: 'ghost', fn: () => $('#import-file').click() },
    { label: '📲 安装说明', cls: 'ghost', fn: openInstallGuide },
    { label: '清空数据', cls: 'danger', fn: clearAll },
    { label: '关闭', cls: 'ghost', fn: closeModal }
  ]);
});

function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '记账备份_' + todayStr() + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出备份文件');
}

$('#import-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d) throw new Error('bad');
      let records = [];
      if (Array.isArray(d.records)) records = d.records.map(normalizeRecord).filter((r) => r.name);
      if (Array.isArray(d.items)) {
        d.items.forEach((it) => {
          const rec = itemToRecord(it);
          if (rec) records.push(rec);
        });
      }
      db = { records: records };
      save(); renderAll(); closeModal(); toast('导入成功');
    } catch (err) {
      toast('导入失败：文件格式不正确');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

function clearAll() {
  openModal('⚠️ 清空数据', '<p class="muted" style="margin:0">将删除全部记账数据，且无法恢复。建议先导出备份。</p>', [
    { label: '取消', cls: 'ghost', fn: closeModal },
    { label: '确认清空', cls: 'danger', fn: () => {
      db = { records: [] };
      try { localStorage.removeItem(LS_KEY); } catch (err) {}
      renderAll(); closeModal(); toast('已清空全部数据');
    } }
  ]);
}

function renderAll() {
  refreshSuggestions();
  refreshCategories();
  renderRecords();
  renderPrice();
  renderStock();
}

/* ---------------- 初始化 ---------------- */
function init() {
  $('#r-date').value = todayStr();
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.page)));
  switchTab('records');
  refreshCategories();
  installBannerState();
  if (migrated) save();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
