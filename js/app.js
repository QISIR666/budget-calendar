const $ = (id) => document.getElementById(id);
const KEY = 'budgetBook_pwa_v2';
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/** 2026 国务院放假安排：放假日（按节假日比例） */
const DEFAULT_HOLIDAYS_2026 = [
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'
];

/** 2026 调休上班日（按工作日比例） */
const DEFAULT_MAKEUP_2026 = [
  '2026-01-04',
  '2026-02-14', '2026-02-28',
  '2026-05-09',
  '2026-09-20', '2026-10-10'
];

const DEFAULT_FIXED_ITEMS = [
  { id: 'utilities', name: '水电费', amount: '' },
  { id: 'gym', name: '健身房月卡', amount: '' },
  { id: 'phone', name: '话费', amount: '' },
  { id: 'food', name: '伙食费', amount: '' },
  { id: 'parking', name: '停车费', amount: '' }
];

let state = { settings: null, actuals: {}, dayTypes: {}, fixedItems: null };
let currentRows = [];
let saveTimer = null;
let selectedDs = null;

function fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseDate(s) {
  const a = s.split('-').map(Number);
  return new Date(a[0], a[1] - 1, a[2]);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function weekdayCN(d) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}
function mondayIndex(d) {
  return (d.getDay() + 6) % 7;
}
function typeInfo(t) {
  return { work: ['work', '工作日'], weekend: ['weekend', '周末'], holiday: ['holiday', '节假日'] }[t];
}
function uid() {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function cents(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function defaultFixedItems() {
  return DEFAULT_FIXED_ITEMS.map((x) => ({ ...x }));
}
function ensureFixedItems() {
  if (!Array.isArray(state.fixedItems)) {
    if (state.settings && Array.isArray(state.settings.fixedItems)) {
      state.fixedItems = state.settings.fixedItems.map((x) => ({
        id: x.id || uid(),
        name: x.name || '',
        amount: x.amount
      }));
    } else {
      state.fixedItems = defaultFixedItems();
    }
  }
}
function itemAmount(it) {
  return parseFloat(it && it.amount) || 0;
}
function fixedTotal() {
  ensureFixedItems();
  return cents(state.fixedItems.reduce((sum, it) => sum + itemAmount(it), 0));
}
function monthlyBudgetValue() {
  const raw = $('budget') ? $('budget').value : '';
  if (raw !== '' && !isNaN(parseFloat(raw))) return parseFloat(raw) || 0;
  return (state.settings && Number(state.settings.budget)) || 0;
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) {
      state = s;
      if (!state.actuals) state.actuals = {};
      if (!state.dayTypes) state.dayTypes = {};
    }
  } catch (e) { /* ignore corrupt cache */ }
  ensureFixedItems();
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}
function money(n) {
  return (Number(n) || 0).toFixed(2);
}
function signed(n) {
  const v = Number(n) || 0;
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

function scheduleSave() {
  $('saveStatus').textContent = '保存中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    save();
    $('saveStatus').textContent = '✓ 已保存';
    setTimeout(() => {
      if ($('saveStatus').textContent === '✓ 已保存') $('saveStatus').textContent = '';
    }, 2000);
  }, 500);
}

function prefills() {
  const now = new Date();
  if (!$('start').value) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    $('start').value = fmtDate(start);
  }
  if (!$('end').value) {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    $('end').value = fmtDate(end);
  }
  if (!$('rateWork').value) $('rateWork').value = '30';
  if (!$('rateWeekend').value) $('rateWeekend').value = '100';
  if (!$('rateHoliday').value) $('rateHoliday').value = '200';
}

function classifyDay(ds, date, holidaySet, makeupSet) {
  if (state.dayTypes && state.dayTypes[ds]) return state.dayTypes[ds];
  if (holidaySet.has(ds)) return 'holiday';
  if (makeupSet.has(ds)) return 'work'; // 调休按工作日
  if (date.getDay() === 0 || date.getDay() === 6) return 'weekend';
  return 'work';
}

function build() {
  const startEl = $('start').value;
  const endEl = $('end').value;
  const start = parseDate(startEl);
  const end = parseDate(endEl);
  if (isNaN(start) || isNaN(end) || start > end) {
    alert('请检查周期日期是否填写正确');
    return;
  }
  ensureFixedItems();
  const totalBudget = parseFloat($('budget').value) || 0;
  const fixed = fixedTotal();
  const flex = cents(totalBudget - fixed);
  const budget = Math.max(0, flex);
  const rWork = parseFloat($('rateWork').value) || 0;
  const rWeekend = parseFloat($('rateWeekend').value) || 0;
  const rHoliday = parseFloat($('rateHoliday').value) || 0;
  const holidaySet = new Set(DEFAULT_HOLIDAYS_2026);
  const makeupSet = new Set(DEFAULT_MAKEUP_2026);

  const days = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const ds = fmtDate(d);
    const type = classifyDay(ds, d, holidaySet, makeupSet);
    days.push({ ds, date: new Date(d), type });
  }

  const count = { work: 0, weekend: 0, holiday: 0 };
  days.forEach((x) => count[x.type]++);
  const weightSum = count.work * rWork + count.weekend * rWeekend + count.holiday * rHoliday;
  const db = { work: 0, weekend: 0, holiday: 0 };
  if (weightSum > 0) {
    db.work = budget * rWork / weightSum;
    db.weekend = budget * rWeekend / weightSum;
    db.holiday = budget * rHoliday / weightSum;
  }

  let cumShould = 0;
  currentRows = days.map((x) => {
    cumShould += db[x.type];
    return { ds: x.ds, date: x.date, type: x.type, db: db[x.type], cumShould };
  });

  state.settings = {
    start: startEl,
    end: endEl,
    budget: totalBudget,
    flexibleBudget: budget,
    fixedTotal: fixed,
    fixedItems: state.fixedItems,
    rWork,
    rWeekend,
    rHoliday,
    holidays: DEFAULT_HOLIDAYS_2026.join(','),
    makeup: DEFAULT_MAKEUP_2026.join(',')
  };
  if (!state.actuals) state.actuals = {};
  if (!state.dayTypes) state.dayTypes = {};
  save();
  render();
}

function rowByDs(ds) {
  return currentRows.find((r) => r.ds === ds);
}

function actualOf(ds) {
  return parseFloat(state.actuals[ds]) || 0;
}

function cumActualUntil(ds) {
  let sum = 0;
  for (const r of currentRows) {
    if (r.ds > ds) break;
    sum += actualOf(r.ds);
  }
  return sum;
}

function render() {
  if (!currentRows.length) return;
  const s = state.settings;
  const w = currentRows.reduce((sum, r) => sum + { work: s.rWork, weekend: s.rWeekend, holiday: s.rHoliday }[r.type], 0);
  const alloc = s.flexibleBudget != null ? s.flexibleBudget : s.budget;
  const per = (rate) => (rate === 0 || w === 0 ? 0 : alloc * rate / w);
  const overFixed = (s.budget || 0) < (s.fixedTotal || 0);
  $('rateInfo').textContent =
    '📐 灵活预算 ¥' + money(alloc) +
    '（当月预算 ¥' + money(s.budget) + ' − 固定消费 ¥' + money(s.fixedTotal || 0) + '）' +
    (overFixed ? '；固定消费已超过当月预算，每日预算按 0 计算。' : '') +
    ' 按比例折算后：工作日每天 ¥' + money(per(s.rWork)) +
    ' ｜ 周末每天 ¥' + money(per(s.rWeekend)) +
    ' ｜ 节假日每天 ¥' + money(per(s.rHoliday)) +
    '（调休上班按工作日）';

  renderCalendars();
  $('spendCard').hidden = false;
  $('calCard').hidden = false;
  $('summaryCard').hidden = false;
  renderSummary();
}

function monthsInRange(start, end) {
  const months = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    months.push({ y, m });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return months;
}

function renderCalendars() {
  const host = $('calendars');
  host.innerHTML = '';
  const start = currentRows[0].date;
  const end = currentRows[currentRows.length - 1].date;
  const todayStr = fmtDate(new Date());

  monthsInRange(start, end).forEach(({ y, m }) => {
    const block = document.createElement('div');
    block.className = 'month-block';
    const title = document.createElement('h2');
    title.className = 'month-title';
    title.textContent = y + '年' + (m + 1) + '月';
    block.appendChild(title);

    const head = document.createElement('div');
    head.className = 'cal-weekdays';
    WEEKDAYS.forEach((w) => {
      const span = document.createElement('span');
      span.textContent = w;
      head.appendChild(span);
    });
    block.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    const first = new Date(y, m, 1);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let i = 0; i < mondayIndex(first); i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-cell empty';
      grid.appendChild(empty);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(y, m, day);
      const ds = fmtDate(date);
      const row = rowByDs(ds);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell';
      if (!row) {
        cell.classList.add('empty');
        cell.disabled = true;
        cell.innerHTML = '<span class="num" style="color:#d1d5db">' + day + '</span>';
        grid.appendChild(cell);
        continue;
      }
      const [cls, txt] = typeInfo(row.type);
      const act = actualOf(ds);
      const dayBal = row.db - act;
      cell.classList.add(cls);
      if (ds === todayStr) cell.classList.add('today');
      if (ds === selectedDs) cell.classList.add('selected');
      if (act > 0 && dayBal < 0) cell.classList.add('over');
      else if (act > 0 && dayBal >= 0) cell.classList.add('under');
      cell.dataset.ds = ds;
      cell.innerHTML =
        '<span class="num">' + day + '</span>' +
        '<span class="tag ' + cls + '">' + txt + '</span>' +
        '<span class="amt">预算 ' + money(row.db) + '</span>' +
        '<span class="act">' + (act ? '已花 ' + money(act) : '记一笔') + '</span>';
      grid.appendChild(cell);
    }
    block.appendChild(grid);
    host.appendChild(block);
  });
}

function asOfToday() {
  const todayStr = fmtDate(new Date());
  const elapsed = currentRows.filter((r) => r.ds <= todayStr);
  if (!elapsed.length) return null;
  const last = elapsed[elapsed.length - 1];
  const cumShould = last.cumShould;
  const cumActual = cumActualUntil(last.ds);
  return {
    todayStr,
    last,
    inCycle: Boolean(rowByDs(todayStr)),
    cumShould,
    cumActual,
    bal: cumShould - cumActual
  };
}

function renderTodayBalance() {
  const box = $('todayBalanceBox');
  const info = asOfToday();
  if (!info) {
    box.innerHTML =
      '<div class="label">📌 截至今日累积结余</div>' +
      '<div class="big" style="color:#94a3b8;">—</div>' +
      '<div class="sub">今天不在当前记账周期内</div>';
    return;
  }
  const cls = info.bal >= 0 ? 'pos' : 'neg';
  const typeTxt = info.inCycle ? typeInfo(info.last.type)[1] : '周期已过完';
  const asOf = info.inCycle ? info.todayStr : info.last.ds;
  box.innerHTML =
    '<div class="label">📌 截至今日累积结余（' + asOf + ' · ' + typeTxt + '）</div>' +
    '<div class="big ' + cls + '">' + signed(info.bal) + '</div>' +
    '<div class="sub">截至今日应花 ¥' + money(info.cumShould) + '，已花 ¥' + money(info.cumActual) + '</div>';
}

function renderSummary() {
  const s = state.settings;
  const totalShould = currentRows.length ? currentRows[currentRows.length - 1].cumShould : 0;
  const cumActualAll = cumActualUntil(currentRows[currentRows.length - 1].ds);
  const balance = totalShould - cumActualAll;
  const todayStr = fmtDate(new Date());
  const elapsed = currentRows.filter((r) => r.ds <= todayStr).length;
  renderTodayBalance();
  renderTodaySpend();
  const flex = s.flexibleBudget != null ? s.flexibleBudget : s.budget;
  $('summary').innerHTML =
    '<div class="stat"><div class="label">当月预算</div><div class="value">' + money(s.budget) + '</div></div>' +
    '<div class="stat"><div class="label">固定消费</div><div class="value">' + money(s.fixedTotal || 0) + '</div></div>' +
    '<div class="stat"><div class="label">灵活预算</div><div class="value">' + money(flex) + '</div></div>' +
    '<div class="stat"><div class="label">累计应花</div><div class="value">' + money(totalShould) + '</div></div>' +
    '<div class="stat"><div class="label">累计实花</div><div class="value">' + money(cumActualAll) + '</div></div>' +
    '<div class="stat"><div class="label">灵活结余</div><div class="value ' + (balance >= 0 ? 'pos' : 'neg') + '">' + signed(balance) + '</div></div>' +
    '<div class="stat"><div class="label">进度</div><div class="value">' + elapsed + '/' + currentRows.length + ' 天</div></div>';
}

function syncTypeButtons(type) {
  document.querySelectorAll('.type-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
}

function openSheet(ds) {
  const row = rowByDs(ds);
  if (!row) return;
  selectedDs = ds;
  renderCalendars();
  const act = actualOf(ds);
  const dayBal = row.db - act;
  const cumBal = row.cumShould - cumActualUntil(ds);
  $('sheetTitle').textContent = row.ds + ' · ' + weekdayCN(row.date);
  $('sheetSub').textContent = '可改当天类型，并填写实际花销';
  syncTypeButtons(row.type);
  $('sheetActual').value = act || '';
  $('sheetStats').innerHTML =
    '<div class="stat"><div class="label">当日预算</div><div class="value">' + money(row.db) + '</div></div>' +
    '<div class="stat"><div class="label">当日结余</div><div class="value ' + (dayBal >= 0 ? 'pos' : 'neg') + '">' + signed(dayBal) + '</div></div>' +
    '<div class="stat"><div class="label">截至该日应花</div><div class="value">' + money(row.cumShould) + '</div></div>' +
    '<div class="stat"><div class="label">截至该日累积结余</div><div class="value ' + (cumBal >= 0 ? 'pos' : 'neg') + '">' + signed(cumBal) + '</div></div>';
  $('sheetMask').hidden = false;
  $('sheetMask').removeAttribute('hidden');
}

function closeSheet() {
  selectedDs = null;
  const mask = $('sheetMask');
  mask.hidden = true;
  mask.setAttribute('hidden', '');
  $('sheetActual').blur();
  renderCalendars();
}

function refreshSheetStats() {
  if (!selectedDs) return;
  const row = rowByDs(selectedDs);
  if (!row) return;
  const act = actualOf(selectedDs);
  const dayBal = row.db - act;
  const cumBal = row.cumShould - cumActualUntil(selectedDs);
  syncTypeButtons(row.type);
  $('sheetStats').innerHTML =
    '<div class="stat"><div class="label">当日预算</div><div class="value">' + money(row.db) + '</div></div>' +
    '<div class="stat"><div class="label">当日结余</div><div class="value ' + (dayBal >= 0 ? 'pos' : 'neg') + '">' + signed(dayBal) + '</div></div>' +
    '<div class="stat"><div class="label">截至该日应花</div><div class="value">' + money(row.cumShould) + '</div></div>' +
    '<div class="stat"><div class="label">截至该日累积结余</div><div class="value ' + (cumBal >= 0 ? 'pos' : 'neg') + '">' + signed(cumBal) + '</div></div>';
}

function setDayType(ds, type) {
  if (!state.dayTypes) state.dayTypes = {};
  state.dayTypes[ds] = type;
  scheduleSave();
  const keep = ds;
  build();
  openSheet(keep);
}

function exportCSV() {
  if (!currentRows.length) {
    alert('请先生成预算日历');
    return;
  }
  const head = ['日期', '星期', '类型', '当日预算', '累计应花', '实际花销', '当日结余', '累计结余'];
  const lines = [head.join(',')];
  let cumActual = 0;
  currentRows.forEach((r) => {
    const act = actualOf(r.ds);
    cumActual += act;
    const bal = r.cumShould - cumActual;
    lines.push([
      r.ds,
      weekdayCN(r.date),
      typeInfo(r.type)[1],
      money(r.db),
      money(r.cumShould),
      money(act),
      money(r.db - act),
      money(bal)
    ].join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '预算记账_' + state.settings.start + '_至_' + state.settings.end + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTodaySpend() {
  const todayStr = fmtDate(new Date());
  const act = actualOf(todayStr);
  if ($('todaySpendTotal')) $('todaySpendTotal').textContent = '今天已花 ¥' + money(act);
  if ($('todaySpendHint')) $('todaySpendHint').textContent = '记到 ' + todayStr + '，确定后累加到当天消费';
}

function updateFixedSummary() {
  const total = monthlyBudgetValue();
  const fixed = fixedTotal();
  const flex = cents(total - fixed);
  const flexCls = flex < 0 ? 'neg' : '';
  $('fixedSummary').innerHTML =
    '当月预算 ¥' + money(total) +
    ' − 固定消费 ¥' + money(fixed) +
    ' ＝ 灵活预算 <span class="' + flexCls + '">¥' + money(flex) + '</span>' +
    (flex < 0 ? '（已超预算，生成日历时每日预算按 0）' : '（用于计算每日预算）');
}

function renderFixedList() {
  ensureFixedItems();
  const host = $('fixedList');
  if (!state.fixedItems.length) {
    host.innerHTML = '<div class="fixed-empty">暂无固定消费项，可在下方添加</div>';
    updateFixedSummary();
    return;
  }
  host.innerHTML = state.fixedItems.map((it) => {
    const amountVal = it.amount === 0 || it.amount ? it.amount : '';
    return '<div class="fixed-item" data-id="' + escapeHtml(it.id) + '">' +
      '<input class="fixed-name" type="text" maxlength="20" value="' + escapeHtml(it.name) + '" aria-label="项目名称">' +
      '<input class="fixed-amount" type="number" inputmode="decimal" step="0.01" min="0" value="' + escapeHtml(amountVal) + '" placeholder="金额" aria-label="金额">' +
      '<button class="btn-icon-del" type="button" data-del aria-label="删除">×</button>' +
      '</div>';
  }).join('');
  updateFixedSummary();
}

function addFixedItem() {
  const name = $('fixedNewName').value.trim();
  const amount = $('fixedNewAmount').value;
  if (!name) {
    alert('请填写固定消费项目名称');
    $('fixedNewName').focus();
    return;
  }
  ensureFixedItems();
  state.fixedItems.push({ id: uid(), name, amount });
  $('fixedNewName').value = '';
  $('fixedNewAmount').value = '';
  scheduleSave();
  renderFixedList();
  $('fixedNewName').focus();
}

function addQuickSpend() {
  const raw = $('quickAmount').value;
  const n = cents(raw);
  if (!String(raw).trim() || isNaN(parseFloat(raw)) || n <= 0) {
    alert('请输入大于 0 的金额');
    $('quickAmount').focus();
    return;
  }
  const todayStr = fmtDate(new Date());
  if (currentRows.length && !rowByDs(todayStr)) {
    alert('今天不在当前记账周期内，无法记入当天消费');
    return;
  }
  state.actuals[todayStr] = cents(actualOf(todayStr) + n);
  $('quickAmount').value = '';
  scheduleSave();
  if (selectedDs === todayStr) {
    $('sheetActual').value = state.actuals[todayStr];
    refreshSheetStats();
  }
  if (currentRows.length) render();
  else renderTodaySpend();
}

function restoreSettings() {
  const s = state.settings;
  if (!s) return false;
  $('start').value = s.start;
  $('end').value = s.end;
  $('budget').value = s.budget;
  $('rateWork').value = s.rWork;
  $('rateWeekend').value = s.rWeekend;
  $('rateHoliday').value = s.rHoliday;
  return true;
}

$('calendars').addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-cell[data-ds]');
  if (!cell) return;
  openSheet(cell.dataset.ds);
});

$('sheetMask').addEventListener('click', (e) => {
  if (e.target === $('sheetMask')) closeSheet();
});

$('sheetDone').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeSheet();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('sheetMask').hidden) closeSheet();
});

$('sheetActual').addEventListener('input', (e) => {
  if (!selectedDs) return;
  state.actuals[selectedDs] = e.target.value;
  scheduleSave();
  refreshSheetStats();
  renderSummary();
  renderTodaySpend();
});

$('quickAdd').addEventListener('click', addQuickSpend);
$('quickAmount').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addQuickSpend();
  }
});

$('fixedList').addEventListener('input', (e) => {
  const row = e.target.closest('.fixed-item');
  if (!row) return;
  const item = state.fixedItems.find((x) => x.id === row.dataset.id);
  if (!item) return;
  if (e.target.classList.contains('fixed-name')) item.name = e.target.value;
  if (e.target.classList.contains('fixed-amount')) item.amount = e.target.value;
  scheduleSave();
  updateFixedSummary();
});

$('fixedList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (!del) return;
  const row = del.closest('.fixed-item');
  if (!row) return;
  state.fixedItems = state.fixedItems.filter((x) => x.id !== row.dataset.id);
  scheduleSave();
  renderFixedList();
});

$('fixedAdd').addEventListener('click', addFixedItem);
$('fixedNewName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addFixedItem();
  }
});
$('fixedNewAmount').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addFixedItem();
  }
});
$('budget').addEventListener('input', updateFixedSummary);

$('sheetTypes').addEventListener('click', (e) => {
  const btn = e.target.closest('.type-btn');
  if (!btn || !selectedDs) return;
  e.preventDefault();
  setDayType(selectedDs, btn.dataset.type);
});

window.addEventListener('DOMContentLoaded', () => {
  load();
  renderFixedList();
  renderTodaySpend();
  if (restoreSettings()) build();
  else prefills();
  updateFixedSummary();
  $('gen').addEventListener('click', build);
  $('export').addEventListener('click', exportCSV);
  $('reset').addEventListener('click', () => {
    if (confirm('确定清空所有记录？')) {
      localStorage.removeItem(KEY);
      location.reload();
    }
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
