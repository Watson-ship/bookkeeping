/* =====================================================
   记账小助手 app.js
   纯前端应用，数据保存在手机浏览器 localStorage 中
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

function diffDays(fromStr, toStr) {
  return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
}

function weekStart(s) { /* 周一作为一周开始 */
  const d = parseDate(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateStr(d);
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function isPureNumber(s) {
  return /^\d+(\.\d+)?$/.test(String(s == null ? '' : s).trim());
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- 数据存取 ---------------- */
function normalize(d) {
  (d.items || []).forEach((it) => {
    it.quantity = it.quantity == null ? '' : String(it.quantity);
    it.priceHistory = (it.priceHistory || []).map((h) => ({ date: h.date, price: Number(h.price) || 0 }));
  });
  (d.records || []).forEach((r) => {
    r.amount = Number(r.amount) || 0;
    r.price = Number(r.price) || 0;
    r.quantity = Number(r.quantity) || 0;
  });
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.items) && Array.isArray(d.records)) return normalize(d);
    return null;
  } catch (e) { return null; }
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); }
  catch (e) { toast('保存失败：浏览器存储不可用'); }
}

let db = load() || { items: [], records: [] };

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
  register: '📋 登记已买物品',
  records: '📝 每日记账',
  price: '💹 价格对比',
  stock: '📦 剩余天数'
};

function switchTab(page) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  $('#page-title').textContent = TAB_TITLES[page] || '';
  if (page === 'register') renderItems();
  if (page === 'records') { refreshSuggestions(); renderRecords(); }
  if (page === 'price') renderPrice();
  if (page === 'stock') renderStock();
  window.scrollTo(0, 0);
}

/* =====================================================
   页1：登记已买物品
   ===================================================== */
let editingId = null;

function round2(n) { return Math.round(n * 100) / 100; }

/* 单价 → 总金额 */
function autoFromPrice() {
  const p = parseFloat($('#f-price').value);
  const q = $('#f-qty').value.trim();
  const totalEl = $('#f-total');
  if (p > 0 && isPureNumber(q)) {
    const auto = String(round2(p * parseFloat(q)));
    if (totalEl.value === '' || totalEl.value === (totalEl.dataset.auto || '')) {
      totalEl.value = auto;
      totalEl.dataset.auto = auto;
    }
  }
}

/* 总金额 → 单价 */
function autoFromTotal() {
  const t = parseFloat($('#f-total').value);
  const q = $('#f-qty').value.trim();
  const priceEl = $('#f-price');
  if (t > 0 && isPureNumber(q)) {
    const auto = String(round2(t / parseFloat(q)));
    if (priceEl.value === '' || priceEl.value === (priceEl.dataset.auto || '')) {
      priceEl.value = auto;
      priceEl.dataset.auto = auto;
    }
  }
}

$('#f-price').addEventListener('input', () => {
  $('#f-price').dataset.auto = ''; /* 手动改单价 */
  autoFromPrice();
});

$('#f-total').addEventListener('input', () => {
  $('#f-total').dataset.auto = ''; /* 手动改总金额 */
  autoFromTotal();
});

$('#f-qty').addEventListener('input', () => {
  const q = $('#f-qty').value.trim();
  if (!isPureNumber(q)) return;
  if (parseFloat($('#f-price').value) > 0) autoFromPrice();
  else if (parseFloat($('#f-total').value) > 0) autoFromTotal();
});

$('#item-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  const price = parseFloat($('#f-price').value);
  const qty = $('#f-qty').value.trim();
  const usageDays = parseInt($('#f-days').value, 10) || 0;
  const startDate = $('#f-start').value || '';
  let total = parseFloat($('#f-total').value);
  if (!name) { toast('请填写物品名称'); return; }
  if (!(price > 0)) { toast('请填写正确的单价'); return; }
  if (qty === '') { toast('请填写数量'); return; }
  if (!(total > 0)) {
    if (isPureNumber(qty)) {
      total = Math.round(price * parseFloat(qty) * 100) / 100;
    } else {
      toast('请填写总金额'); return;
    }
  }

  if (editingId) {
    const it = db.items.find((i) => i.id === editingId);
    if (it) {
      Object.assign(it, {
        name, price, quantity: qty, totalAmount: total,
        usageDays, startDate: startDate || it.startDate
      });
      toast('已保存修改');
    }
    exitEdit();
  } else {
    db.items.unshift({
      id: uid(), name, price, quantity: qty, totalAmount: total,
      usageDays, startDate, priceHistory: [], createdAt: Date.now()
    });
    toast('已登记：' + name);
  }
  save();
  resetItemForm();
  renderItems();
});

function resetItemForm() {
  $('#item-form').reset();
  $('#f-qty').value = '';
  $('#f-start').value = todayStr();
  $('#f-price').dataset.auto = '';
  $('#f-total').dataset.auto = '';
}

function exitEdit() {
  editingId = null;
  $('#item-form h2').textContent = '🛒 登记已买物品';
  $('#item-submit').textContent = '添加登记';
  const cancel = $('#edit-cancel');
  if (cancel) cancel.remove();
  resetItemForm();
}

function editItem(id) {
  const it = db.items.find((i) => i.id === id);
  if (!it) return;
  editingId = id;
  $('#f-name').value = it.name;
  $('#f-price').value = it.price;
  $('#f-qty').value = it.quantity;
  $('#f-total').value = it.totalAmount;
  $('#f-price').dataset.auto = '';
  $('#f-total').dataset.auto = '';
  $('#f-days').value = it.usageDays || '';
  $('#f-start').value = it.startDate || todayStr();
  $('#item-form h2').textContent = '✏️ 修改：' + it.name;
  $('#item-submit').textContent = '保存修改';
  if (!$('#edit-cancel')) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.id = 'edit-cancel';
    cancel.className = 'btn ghost';
    cancel.style.marginTop = '10px';
    cancel.textContent = '取消编辑';
    cancel.addEventListener('click', exitEdit);
    $('#item-submit').insertAdjacentElement('afterend', cancel);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* 计算剩余使用天数 */
function remainingOf(it) {
  if (!(it.usageDays > 0)) return null;
  const start = it.startDate || toDateStr(new Date(it.createdAt));
  const elapsed = Math.max(0, diffDays(start, todayStr()));
  const remain = it.usageDays - elapsed;
  const pct = clamp((elapsed / it.usageDays) * 100, 0, 100);
  let estQty = null;
  if (isPureNumber(it.quantity)) {
    estQty = parseFloat(it.quantity) * clamp(remain, 0, it.usageDays) / it.usageDays;
  }
  return { start, elapsed, remain, pct, estQty };
}

/* 价格涨跌指示：只显示比之前多了还是少了 */
function priceTrend(it) {
  const hist = (it.priceHistory || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (hist.length < 2) return '';
  const d = hist[hist.length - 1].price - hist[hist.length - 2].price;
  if (d > 0) return '<span class="diff up">▲</span>';
  if (d < 0) return '<span class="diff down">▼</span>';
  return '<span class="diff flat">—</span>';
}

function renderItems() {
  const box = $('#item-list');
  if (!db.items.length) {
    box.innerHTML = '<div class="empty">还没有登记物品<br>在上方表单登记已买的物品吧 🛍️</div>';
    return;
  }
  box.innerHTML = db.items.map((it) => {
    const ro = remainingOf(it);
    const trend = priceTrend(it);
    let remainBadge = '';
    if (ro) {
      const cls = ro.remain <= 0 ? 'badge danger' : (ro.remain <= 3 ? 'badge warn' : 'badge ok');
      remainBadge = `<span class="${cls}">剩 ${ro.remain} 天</span>`;
    }
    return `
    <div class="card item-card">
      <div class="item-head">
        <div class="item-name">${esc(it.name)} ${remainBadge}</div>
        <div class="item-total">${fmtMoney(it.totalAmount)}</div>
      </div>
      <div class="item-meta">单价 ${fmtMoney(it.price)} ${trend} · 数量 ${esc(it.quantity)}${it.usageDays ? ` · 可用 ${it.usageDays} 天` : ''}${it.startDate ? ` · 起 ${it.startDate}` : ''}</div>
      <div class="item-actions">
        <button class="mini" data-act="record" data-id="${it.id}">记账</button>
        <button class="mini" data-act="edit" data-id="${it.id}">编辑</button>
        <button class="mini danger" data-act="del" data-id="${it.id}">删除</button>
      </div>
    </div>`;
  }).join('');
  renderQuickChips();
}

$('#item-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if (act === 'edit') editItem(id);
  else if (act === 'del') deleteItem(id);
  else if (act === 'record') {
    const it = db.items.find((i) => i.id === id);
    if (it) prefillRecord(it.name, it.price);
  }
});

/* 删除登记（登记页 / 库存页共用） */
function deleteItem(id) {
  const it = db.items.find((i) => i.id === id);
  openModal('删除登记', `确定删除「${esc(it ? it.name : '')}」吗？<br><span class="muted" style="font-size:13px">仅删除登记，不影响已记的账目</span>`, [
    { label: '取消', cls: 'ghost', fn: closeModal },
    { label: '删除', cls: 'danger', fn: () => {
      db.items = db.items.filter((i) => i.id !== id);
      save(); closeModal(); renderItems(); renderPrice(); renderStock(); refreshSuggestions(); toast('已删除');
    } }
  ]);
}

/* 从登记直接录入记账 */
function prefillRecord(name, price) {
  $('#r-name').value = name;
  $('#r-price').value = (price != null && price > 0) ? price : '';
  switchTab('records');
  $('#r-qty').focus();
}

/* =====================================================
   页3：价格对比
   ===================================================== */
function renderPrice() {
  const box = $('#price-list');
  if (!db.items.length) {
    box.innerHTML = '<div class="empty">还没有登记物品<br>先在「登记」页登记已买物品</div>';
    return;
  }
  box.innerHTML = db.items.map((it) => {
    const hist = (it.priceHistory || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const rows = hist.length
      ? hist.map((h) => `<li><span class="d">${h.date}</span><span>${fmtMoney(h.price)}</span></li>`).join('')
      : '<li><span class="d muted">暂无价格记录</span></li>';
    return `
    <div class="card price-card">
      <div class="item-head">
        <div class="item-name">${esc(it.name)}</div>
        <div class="latest-price">${fmtMoney(it.price)}</div>
      </div>
      <ul class="price-list">${rows}</ul>
      <div class="item-actions">
        <button class="mini" data-act="price" data-id="${it.id}">记录价格</button>
      </div>
    </div>`;
  }).join('');
}

$('#price-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="price"]');
  if (btn) openPriceModal(btn.dataset.id);
});

/* 记录价格变化：只写日期和价格 */
function openPriceModal(id) {
  const it = db.items.find((i) => i.id === id);
  if (!it) return;
  openModal('记录价格 · ' + it.name, `
    <label class="field">日期
      <input type="date" id="ph-date" value="${todayStr()}">
    </label>
    <label class="field">价格（元）
      <input type="number" id="ph-price" step="0.01" min="0" inputmode="decimal" value="${it.price}">
    </label>
  `, [
    { label: '取消', cls: 'ghost', fn: closeModal },
    { label: '保存', cls: 'primary', fn: () => {
      const date = $('#ph-date').value || todayStr();
      const price = parseFloat($('#ph-price').value);
      if (!(price > 0)) { toast('请填写正确的价格'); return; }
      it.priceHistory = it.priceHistory || [];
      it.priceHistory.push({ date, price });
      it.priceHistory.sort((a, b) => (a.date < b.date ? -1 : 1));
      it.price = price; /* 最新价格 */
      save(); closeModal(); renderItems(); renderPrice(); toast('价格记录已保存');
    } }
  ]);
}

/* =====================================================
   页2：每日记账（含统计占比）
   ===================================================== */
function refreshSuggestions() {
  const names = new Set();
  db.items.forEach((i) => names.add(i.name));
  db.records.forEach((r) => names.add(r.name));
  $('#item-suggestions').innerHTML = Array.from(names)
    .map((n) => `<option value="${esc(n)}"></option>`).join('');
  renderQuickChips();
}

/* 记账页快捷录入：已登记物品芯片 */
function renderQuickChips() {
  const wrap = $('#quick-rec');
  const box = $('#rec-chips');
  if (!db.items.length) { wrap.classList.add('hidden'); box.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  box.innerHTML = db.items.map((it) => `<button type="button" class="chip" data-name="${esc(it.name)}" data-price="${it.price}">${esc(it.name)}</button>`).join('');
}

$('#rec-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $('#r-name').value = chip.dataset.name;
  $('#r-price').value = chip.dataset.price;
  $('#r-qty').focus();
});

$('#r-name').addEventListener('change', () => {
  const n = $('#r-name').value.trim();
  const it = db.items.find((i) => i.name === n);
  if (it) $('#r-price').value = it.price;
});

$('#record-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const date = $('#r-date').value || todayStr();
  const name = $('#r-name').value.trim();
  const price = parseFloat($('#r-price').value);
  const qty = parseFloat($('#r-qty').value);
  if (!name) { toast('请填写物品名称'); return; }
  if (!(price > 0)) { toast('请填写正确的单价'); return; }
  if (!(qty > 0)) { toast('请填写正确的数量'); return; }
  db.records.push({
    id: uid(), date, name, price, quantity: qty,
    amount: Math.round(price * qty * 100) / 100, createdAt: Date.now()
  });
  save();
  $('#record-form').reset();
  $('#r-date').value = date;
  $('#r-qty').value = '1';
  refreshSuggestions();
  renderRecords();
  toast('已记一笔');
});

function recordsForDate(date) {
  return db.records.filter((r) => r.date === date).sort((a, b) => a.createdAt - b.createdAt);
}

function groupRecords(recs) {
  const m = new Map();
  recs.forEach((r) => {
    if (!m.has(r.name)) m.set(r.name, { name: r.name, qty: 0, amount: 0, entries: [] });
    const g = m.get(r.name);
    g.qty += r.quantity;
    g.amount += r.amount;
    g.entries.push(r);
  });
  return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
}

function renderRecords() {
  const t = todayStr();
  const date = $('#r-date').value || t;

  /* 四个汇总：均按今天计算 */
  const todaySum = recordsForDate(t).reduce((s, r) => s + r.amount, 0);
  const ws = weekStart(t);
  const weekSum = db.records
    .filter((r) => r.date >= ws && r.date < addDaysStr(ws, 7))
    .reduce((s, r) => s + r.amount, 0);
  const monthSum = db.records
    .filter((r) => r.date.slice(0, 7) === t.slice(0, 7))
    .reduce((s, r) => s + r.amount, 0);
  const yearSum = db.records
    .filter((r) => r.date.slice(0, 4) === t.slice(0, 4))
    .reduce((s, r) => s + r.amount, 0);

  $('#sum-day').textContent = fmtMoney(todaySum);
  $('#sum-week').textContent = fmtMoney(weekSum);
  $('#sum-month').textContent = fmtMoney(monthSum);
  $('#sum-year').textContent = fmtMoney(yearSum);

  /* 选中日期的明细 */
  const recs = recordsForDate(date);
  const daySum = recs.reduce((s, r) => s + r.amount, 0);
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
        <div class="item-meta">共 ${fmtQty(g.qty)} 件 · ${g.entries.length} 笔<span class="chev">▾</span></div>
        <div class="rec-detail hidden">
          ${g.entries.map((en) => `<div class="rec-entry">单价 ${fmtMoney(en.price)} × ${fmtQty(en.quantity)} = ${fmtMoney(en.amount)}<button class="mini danger" data-del="${en.id}">删</button></div>`).join('')}
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
    save(); renderRecords(); toast('已删除一笔');
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
  const total = recs.reduce((s, r) => s + r.amount, 0);
  $('#stat-total').textContent = fmtMoney(total);
  $('#stat-count').textContent = recs.length + ' 笔';
  const m = new Map();
  recs.forEach((r) => m.set(r.name, (m.get(r.name) || 0) + r.amount));
  const data = Array.from(m.entries())
    .map(([name, amount]) => ({ name, amount }))
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
   页4：剩余使用天数（库存）
   ===================================================== */
function renderStock() {
  const withDays = db.items.filter((i) => i.usageDays > 0);
  const others = db.items.filter((i) => !(i.usageDays > 0));
  const sorted = withDays
    .map((i) => ({ it: i, ro: remainingOf(i) }))
    .sort((a, b) => a.ro.remain - b.ro.remain);
  const lowCount = sorted.filter((s) => s.ro.remain <= 3).length;
  const totalValue = db.items.reduce((s, i) => s + i.totalAmount, 0);

  $('#stock-sum').innerHTML = `
    <div class="tile"><div class="num">${db.items.length}</div><div class="lbl">登记物品</div></div>
    <div class="tile"><div class="num">${fmtMoney(totalValue)}</div><div class="lbl">物资总值</div></div>
    <div class="tile"><div class="num">${lowCount}</div><div class="lbl">需补货</div></div>`;

  const box = $('#stock-list');
  if (!sorted.length) {
    box.innerHTML = '<div class="empty">暂无设置「使用天数」的物品<br>在登记时填写使用天数，即可查看剩余天数与进度条</div>';
    if (others.length) {
      box.innerHTML += others.map((o) => `
        <div class="card muted-card stock-card">
          <div class="item-head">
            <div class="item-name">${esc(o.name)}</div>
            <button class="mini danger" data-del="${o.id}">删除</button>
          </div>
          <div class="item-meta">未设置使用天数</div>
        </div>`).join('');
    }
    return;
  }

  box.innerHTML = sorted.map(({ it, ro }) => {
    let status, cls;
    if (ro.remain <= 0) { status = '已用完'; cls = 'badge danger'; }
    else if (ro.remain <= 3) { status = '即将用完'; cls = 'badge warn'; }
    else if (ro.pct >= 70) { status = '注意'; cls = 'badge warn'; }
    else { status = '充足'; cls = 'badge ok'; }
    const barCls = (ro.remain <= 3) ? 'bar warn' : 'bar';
    const qtyInfo = ro.estQty != null
      ? `预计剩余数量：${fmtQty(ro.estQty)} / ${esc(it.quantity)}`
      : `数量：${esc(it.quantity)}`;
    return `
    <div class="card stock-card">
      <div class="item-head">
        <div class="item-name">${esc(it.name)}</div>
        <span class="${cls}">${status}</span>
      </div>
      <div class="stock-days">已用 ${ro.elapsed} 天 / 共 ${it.usageDays} 天 · <b>剩余 ${Math.max(ro.remain, 0)} 天</b></div>
      <div class="progress"><div class="${barCls}" style="width:${ro.pct}%"></div></div>
      <div class="item-meta">${qtyInfo}${it.startDate ? ' · 开始日期 ' + it.startDate : ''}</div>
      <div class="item-actions"><button class="mini danger" data-del="${it.id}">删除</button></div>
    </div>`;
  }).join('');

  if (others.length) {
    box.innerHTML += others.map((o) => `
      <div class="card muted-card stock-card">
        <div class="item-head">
          <div class="item-name">${esc(o.name)}</div>
          <button class="mini danger" data-del="${o.id}">删除</button>
        </div>
        <div class="item-meta">未设置使用天数</div>
      </div>`).join('');
  }
}

$('#stock-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-del]');
  if (btn) deleteItem(btn.dataset.del);
});

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
    <div class="settings-note">数据保存在手机浏览器本地（不联网、不上传）。卸载浏览器或清除数据会丢失，请定期导出备份。<br>当前数据：${db.items.length} 件登记物品，${db.records.length} 条记账记录。</div>
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
      if (!d || !Array.isArray(d.items) || !Array.isArray(d.records)) throw new Error('bad');
      db = normalize({ items: d.items, records: d.records });
      save(); renderAll(); closeModal(); toast('导入成功');
    } catch (err) {
      toast('导入失败：文件格式不正确');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

function clearAll() {
  openModal('⚠️ 清空数据', '<p class="muted" style="margin:0">将删除全部登记与记账数据，且无法恢复。建议先导出备份。</p>', [
    { label: '取消', cls: 'ghost', fn: closeModal },
    { label: '确认清空', cls: 'danger', fn: () => {
      db = { items: [], records: [] };
      try { localStorage.removeItem(LS_KEY); } catch (err) {}
      renderAll(); closeModal(); toast('已清空全部数据');
    } }
  ]);
}

function renderAll() {
  refreshSuggestions();
  renderItems();
  renderRecords();
  renderPrice();
  renderStock();
}

/* ---------------- 初始化 ---------------- */
function init() {
  $('#r-date').value = todayStr();
  $('#f-start').value = todayStr();
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.page)));
  switchTab('register');
  installBannerState();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
