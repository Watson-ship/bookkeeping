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

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- 数据存取 ---------------- */
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.items) && Array.isArray(d.records)) return d;
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
  register: '📋 采购登记',
  records: '📝 每日记账',
  stock: '📦 剩余天数',
  stats: '📊 花费占比'
};

function switchTab(page) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  $('#page-title').textContent = TAB_TITLES[page] || '';
  if (page === 'register') renderItems();
  if (page === 'records') { refreshSuggestions(); renderRecords(); }
  if (page === 'stock') renderStock();
  if (page === 'stats') renderStats();
  window.scrollTo(0, 0);
}

/* =====================================================
   页1：采购登记
   ===================================================== */
let editingId = null;

function refreshTotal() {
  const p = parseFloat($('#f-price').value) || 0;
  const q = parseFloat($('#f-qty').value) || 0;
  $('#f-total').value = (p > 0 && q > 0) ? String(Math.round(p * q * 100) / 100) : '';
}

$('#item-form').addEventListener('input', (e) => {
  if (e.target.id === 'f-price' || e.target.id === 'f-qty') refreshTotal();
});

$('#item-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  const price = parseFloat($('#f-price').value);
  const qty = parseFloat($('#f-qty').value);
  const total = Math.round(price * qty * 100) / 100;
  const usageDays = parseInt($('#f-days').value, 10) || 0;
  const startDate = $('#f-start').value || '';
  if (!name) { toast('请填写物品名称'); return; }
  if (!(price > 0)) { toast('请填写正确的单价'); return; }
  if (!(qty > 0)) { toast('请填写正确的数量'); return; }

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
  $('#f-qty').value = '1';
  $('#f-start').value = todayStr();
  refreshTotal();
}

function exitEdit() {
  editingId = null;
  $('#item-form h2').textContent = '🛒 登记要买的物品';
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
  $('#f-days').value = it.usageDays || '';
  $('#f-start').value = it.startDate || todayStr();
  refreshTotal();
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
  const estQty = it.quantity * clamp(remain, 0, it.usageDays) / it.usageDays;
  return { start, elapsed, remain, pct, estQty };
}

function renderItems() {
  const box = $('#item-list');
  if (!db.items.length) {
    box.innerHTML = '<div class="empty">还没有登记物品<br>在上方表单登记要买的东西吧 🛍️</div>';
    return;
  }
  box.innerHTML = db.items.map((it) => {
    const ro = remainingOf(it);
    const hist = (it.priceHistory || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = hist[hist.length - 1];
    const prev = hist[hist.length - 2];
    let diffHtml = '';
    if (last && prev) {
      const d = last.price - prev.price;
      const cls = d > 0 ? 'up' : (d < 0 ? 'down' : 'flat');
      const arrow = d > 0 ? '▲' : (d < 0 ? '▼' : '—');
      diffHtml = `<span class="diff ${cls}">${arrow} ${fmtMoney(Math.abs(d))}</span>`;
    }
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
      <div class="item-meta">单价 ${fmtMoney(it.price)} × ${fmtQty(it.quantity)}${it.usageDays ? ` · 可用 ${it.usageDays} 天` : ''}${it.startDate ? ` · 起 ${it.startDate}` : ''}</div>
      <div class="price-line">
        <span>价格对比：${last ? `${fmtMoney(last.price)} <span class="muted">(${last.date})</span> ${diffHtml}` : '暂无记录'}</span>
        <button class="mini" data-act="price" data-id="${it.id}">记录价格</button>
      </div>
      ${hist.length > 1 ? `<details class="hist"><summary>查看 ${hist.length} 次价格记录</summary><ul>${hist.map((h) => `<li>${h.date} · ${fmtMoney(h.price)}${h.note ? ' · ' + esc(h.note) : ''}</li>`).join('')}</ul></details>` : ''}
      <div class="item-actions">
        <button class="mini" data-act="edit" data-id="${it.id}">编辑</button>
        <button class="mini danger" data-act="del" data-id="${it.id}">删除</button>
      </div>
    </div>`;
  }).join('');
}

$('#item-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if (act === 'edit') {
    editItem(id);
  } else if (act === 'del') {
    const it = db.items.find((i) => i.id === id);
    openModal('删除登记', `确定删除「${esc(it ? it.name : '')}」吗？<br><span class="muted" style="font-size:13px">仅删除登记，不影响已记的账目</span>`, [
      { label: '取消', cls: 'ghost', fn: closeModal },
      { label: '删除', cls: 'danger', fn: () => {
        db.items = db.items.filter((i) => i.id !== id);
        save(); closeModal(); renderItems(); toast('已删除');
      } }
    ]);
  } else if (act === 'price') {
    openPriceModal(id);
  }
});

/* 记录价格变化（价格对比） */
function openPriceModal(id) {
  const it = db.items.find((i) => i.id === id);
  if (!it) return;
  const hist = (it.priceHistory || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = hist[hist.length - 1];
  openModal('记录价格变化 · ' + it.name, `
    <label class="field">日期
      <input type="date" id="ph-date" value="${todayStr()}">
    </label>
    <label class="field">新价格（元）
      <input type="number" id="ph-price" step="0.01" min="0" inputmode="decimal" value="${latest ? latest.price : it.price}">
    </label>
    <label class="field">说明（可选）
      <input type="text" id="ph-note" placeholder="如：促销价、涨价">
    </label>
    <label class="check"><input type="checkbox" id="ph-update" checked> 同时更新物品当前单价</label>
  `, [
    { label: '取消', cls: 'ghost', fn: closeModal },
    { label: '保存', cls: 'primary', fn: () => {
      const date = $('#ph-date').value || todayStr();
      const price = parseFloat($('#ph-price').value);
      if (!(price > 0)) { toast('请填写正确的价格'); return; }
      const note = $('#ph-note').value.trim();
      it.priceHistory = it.priceHistory || [];
      it.priceHistory.push({ date, price, note });
      it.priceHistory.sort((a, b) => (a.date < b.date ? -1 : 1));
      if ($('#ph-update').checked) {
        it.price = price;
        it.totalAmount = Math.round(price * it.quantity * 100) / 100;
      }
      save(); closeModal(); renderItems(); toast('价格记录已保存');
    } }
  ]);
}

/* =====================================================
   页2：每日记账
   ===================================================== */
function refreshSuggestions() {
  const names = new Set();
  db.items.forEach((i) => names.add(i.name));
  db.records.forEach((r) => names.add(r.name));
  $('#item-suggestions').innerHTML = Array.from(names)
    .map((n) => `<option value="${esc(n)}"></option>`).join('');
}

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
  const date = $('#r-date').value || todayStr();
  const recs = recordsForDate(date);
  const daySum = recs.reduce((s, r) => s + r.amount, 0);
  const ws = weekStart(date);
  const weekSum = db.records
    .filter((r) => r.date >= ws && r.date < addDaysStr(ws, 7))
    .reduce((s, r) => s + r.amount, 0);
  const monthSum = db.records
    .filter((r) => r.date.slice(0, 7) === date.slice(0, 7))
    .reduce((s, r) => s + r.amount, 0);

  $('#sum-day').textContent = fmtMoney(daySum);
  $('#sum-week').textContent = fmtMoney(weekSum);
  $('#sum-month').textContent = fmtMoney(monthSum);

  const groups = groupRecords(recs);
  $('#day-total').innerHTML = `${date} 合计 <b>${fmtMoney(daySum)}</b> · ${recs.length} 笔`;

  const box = $('#record-list');
  if (!groups.length) {
    box.innerHTML = '<div class="empty">这一天还没有记账记录</div>';
    return;
  }
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

/* =====================================================
   页3：剩余使用天数（库存）
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
      box.innerHTML += `<div class="card muted-card">未设置使用天数的物品：${others.map((o) => esc(o.name)).join('、')}</div>`;
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
    return `
    <div class="card stock-card">
      <div class="item-head">
        <div class="item-name">${esc(it.name)}</div>
        <span class="${cls}">${status}</span>
      </div>
      <div class="stock-days">已用 ${ro.elapsed} 天 / 共 ${it.usageDays} 天 · <b>剩余 ${Math.max(ro.remain, 0)} 天</b></div>
      <div class="progress"><div class="${barCls}" style="width:${ro.pct}%"></div></div>
      <div class="item-meta">预计剩余数量：${fmtQty(ro.estQty)} / ${fmtQty(it.quantity)}${it.startDate ? ' · 开始日期 ' + it.startDate : ''}</div>
    </div>`;
  }).join('');

  if (others.length) {
    box.innerHTML += `<div class="card muted-card">未设置使用天数的物品：${others.map((o) => esc(o.name)).join('、')}</div>`;
  }
}

/* =====================================================
   页4：花费占比统计
   ===================================================== */
let statRange = 'month';

$$('.period-tab').forEach((b) => b.addEventListener('click', () => {
  statRange = b.dataset.range;
  $$('.period-tab').forEach((x) => x.classList.toggle('active', x === b));
  renderStats();
}));

function inRange(range) {
  const t = todayStr();
  if (range === 'today') return (r) => r.date === t;
  if (range === 'week') {
    const s = weekStart(t);
    return (r) => r.date >= s && r.date < addDaysStr(s, 7);
  }
  if (range === 'month') {
    const m = t.slice(0, 7);
    return (r) => r.date.slice(0, 7) === m;
  }
  return () => true; /* all */
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

function renderStats() {
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
  $('#top-card').innerHTML = `👑 消费大头：<b>${esc(top.name)}</b> ${fmtMoney(top.amount)}，占本区间 ${(top.amount / total * 100).toFixed(1)}%`;
}

window.addEventListener('resize', () => {
  if ($('#page-stats').classList.contains('active')) renderStats();
});

/* =====================================================
   设置：导出 / 导入 / 清空
   ===================================================== */
$('#settings-btn').addEventListener('click', () => {
  openModal('⚙️ 设置', `
    <div class="settings-note">数据保存在手机浏览器本地（不联网、不上传）。卸载浏览器或清除数据会丢失，请定期导出备份。<br>当前数据：${db.items.length} 件登记物品，${db.records.length} 条记账记录。</div>
  `, [
    { label: '导出数据', cls: 'primary', fn: exportData },
    { label: '导入数据', cls: 'ghost', fn: () => $('#import-file').click() },
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
      db = { items: d.items, records: d.records };
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
  renderStock();
  renderStats();
}

/* ---------------- 初始化 ---------------- */
function init() {
  $('#r-date').value = todayStr();
  $('#f-start').value = todayStr();
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.page)));
  switchTab('register');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
