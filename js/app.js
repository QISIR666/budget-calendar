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

let state = { settings: null, actuals: {}, dayTypes: {}, fixedItems: null, unexpectedItems: [], cycles: [], currentCycleId: null };
let currentRows = [];
let saveTimer = null;
let selectedDs = null;
const DATA_VERSION = 4;
const CYCLE_OVERLAP_THRESHOLD = 0.5;

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
function addMonths(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}
function nextCycleRange(cur) {
  const end = parseDate(cur.end);
  const startNext = addDays(end, 1);
  const endNext = addMonths(end, 1);
  return { start: fmtDate(startNext), end: fmtDate(endNext) };
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
  return DEFAULT_FIXED_ITEMS.map((x) => normalizeFixedItem({ ...x }));
}
function normalizeFixedItem(it) {
  return {
    id: (it && it.id) || uid(),
    name: (it && it.name) || '',
    amount: it ? it.amount : '',
    paid: !!(it && it.paid)
  };
}
function cloneFixedItems(items, resetPaid) {
  return (items || []).map((it) => normalizeFixedItem({
    id: uid(),
    name: it.name,
    amount: it.amount,
    paid: resetPaid ? false : it.paid
  }));
}
function normalizeUnexpectedItem(it) {
  return {
    id: (it && it.id) || uid(),
    name: (it && it.name) || '',
    amount: it ? it.amount : ''
  };
}
function ensureUnexpectedItems() {
  ensureCycles();
  if (!Array.isArray(state.unexpectedItems)) {
    const cur = getCurrentCycle();
    if (cur && Array.isArray(cur.unexpectedItems)) {
      state.unexpectedItems = cur.unexpectedItems.map(normalizeUnexpectedItem);
    } else {
      state.unexpectedItems = [];
    }
  } else {
    state.unexpectedItems = state.unexpectedItems.map(normalizeUnexpectedItem);
  }
  const cur = getCurrentCycle();
  if (cur) cur.unexpectedItems = state.unexpectedItems;
}
function unexpectedTotal() {
  ensureUnexpectedItems();
  return cents(state.unexpectedItems.reduce((sum, it) => sum + itemAmount(it), 0));
}
function ensureCycles() {
  if (!Array.isArray(state.cycles)) state.cycles = [];
}
function ensureFixedItems() {
  ensureCycles();
  if (!Array.isArray(state.fixedItems)) {
    const cur = getCurrentCycle();
    if (cur && Array.isArray(cur.fixedItems)) {
      state.fixedItems = cur.fixedItems.map(normalizeFixedItem);
    } else if (state.settings && Array.isArray(state.settings.fixedItems)) {
      state.fixedItems = state.settings.fixedItems.map(normalizeFixedItem);
    } else {
      state.fixedItems = defaultFixedItems();
    }
  } else {
    state.fixedItems = state.fixedItems.map(normalizeFixedItem);
  }
  const cur = getCurrentCycle();
  if (cur) cur.fixedItems = state.fixedItems;
}
function getCurrentCycle() {
  ensureCycles();
  return state.cycles.find((c) => c.id === state.currentCycleId) || null;
}
function itemAmount(it) {
  return parseFloat(it && it.amount) || 0;
}
function paidFixedTotal() {
  ensureFixedItems();
  return cents(state.fixedItems.reduce((sum, it) => sum + (it.paid ? itemAmount(it) : 0), 0));
}
function unpaidFixedTotal() {
  ensureFixedItems();
  return cents(state.fixedItems.reduce((sum, it) => sum + (it.paid ? 0 : itemAmount(it)), 0));
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

function daysInclusive(startStr, endStr) {
  const a = parseDate(startStr);
  const b = parseDate(endStr);
  if (isNaN(a) || isNaN(b) || a > b) return 0;
  return Math.round((b - a) / 86400000) + 1;
}
function overlapDays(aStart, aEnd, bStart, bEnd) {
  const a1 = parseDate(aStart);
  const a2 = parseDate(aEnd);
  const b1 = parseDate(bStart);
  const b2 = parseDate(bEnd);
  if ([a1, a2, b1, b2].some((d) => isNaN(d))) return 0;
  const s = a1 > b1 ? a1 : b1;
  const e = a2 < b2 ? a2 : b2;
  if (s > e) return 0;
  return Math.round((e - s) / 86400000) + 1;
}
function scoreCycleMatch(cyc, start, end) {
  if (!cyc || !cyc.start || !cyc.end) return null;
  if (cyc.start === start) {
    return { cyc, rank: 2, overlap: overlapDays(cyc.start, cyc.end, start, end) };
  }
  const ov = overlapDays(cyc.start, cyc.end, start, end);
  const minLen = Math.min(daysInclusive(cyc.start, cyc.end), daysInclusive(start, end));
  if (minLen > 0 && ov / minLen >= CYCLE_OVERLAP_THRESHOLD) {
    return { cyc, rank: 1, overlap: ov };
  }
  return null;
}
function findMatchingCycle(start, end) {
  ensureCycles();
  const hits = state.cycles.map((c) => scoreCycleMatch(c, start, end)).filter(Boolean);
  if (!hits.length) return null;
  hits.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    if (a.cyc.id === state.currentCycleId) return -1;
    if (b.cyc.id === state.currentCycleId) return 1;
    return (b.cyc.updatedAt || 0) - (a.cyc.updatedAt || 0);
  });
  return hits[0].cyc;
}
function readFormMeta() {
  return {
    budget: parseFloat($('budget').value) || 0,
    rWork: parseFloat($('rateWork').value) || 0,
    rWeekend: parseFloat($('rateWeekend').value) || 0,
    rHoliday: parseFloat($('rateHoliday').value) || 0
  };
}
function writeFormMeta(cyc) {
  if (cyc.budget != null) $('budget').value = cyc.budget;
  if (cyc.rWork != null) $('rateWork').value = cyc.rWork;
  if (cyc.rWeekend != null) $('rateWeekend').value = cyc.rWeekend;
  if (cyc.rHoliday != null) $('rateHoliday').value = cyc.rHoliday;
}
function bindCycleItems(cyc) {
  cyc.fixedItems = (cyc.fixedItems || []).map(normalizeFixedItem);
  cyc.unexpectedItems = (cyc.unexpectedItems || []).map(normalizeUnexpectedItem);
  state.fixedItems = cyc.fixedItems;
  state.unexpectedItems = cyc.unexpectedItems;
  state.currentCycleId = cyc.id;
}
function applyWorkingToCycle(cyc, start, end) {
  const meta = readFormMeta();
  cyc.start = start;
  cyc.end = end;
  cyc.budget = meta.budget;
  cyc.rWork = meta.rWork;
  cyc.rWeekend = meta.rWeekend;
  cyc.rHoliday = meta.rHoliday;
  cyc.fixedItems = state.fixedItems.map(normalizeFixedItem);
  state.fixedItems = cyc.fixedItems;
  cyc.unexpectedItems = (state.unexpectedItems || []).map(normalizeUnexpectedItem);
  state.unexpectedItems = cyc.unexpectedItems;
  cyc.updatedAt = Date.now();
  state.currentCycleId = cyc.id;
}
function resolveCycle(start, end) {
  ensureCycles();
  ensureFixedItems();
  ensureUnexpectedItems();
  const match = findMatchingCycle(start, end);
  const current = getCurrentCycle();
  if (match && current && match.id === current.id) {
    applyWorkingToCycle(match, start, end);
    return { cycle: match, kind: 'same' };
  }
  if (match) {
    match.start = start;
    match.end = end;
    match.updatedAt = Date.now();
    writeFormMeta(match);
    bindCycleItems(match);
    return { cycle: match, kind: 'switch' };
  }
  const neu = {
    id: uid(),
    start,
    end,
    updatedAt: Date.now(),
    ...readFormMeta(),
    fixedItems: current
      ? cloneFixedItems(state.fixedItems, true)
      : (state.fixedItems || defaultFixedItems()).map(normalizeFixedItem),
    unexpectedItems: []
  };
  state.cycles.push(neu);
  bindCycleItems(neu);
  return { cycle: neu, kind: 'new' };
}
function openMask(id) {
  const m = $(id);
  if (!m) return;
  m.hidden = false;
  m.removeAttribute('hidden');
}
function closeMask(id) {
  const m = $(id);
  if (!m) return;
  m.hidden = true;
  m.setAttribute('hidden', '');
}
function openSettings() {
  updateFixedSummary();
  openMask('settingsMask');
}
function closeSettings() {
  closeMask('settingsMask');
}
function openCycleSheet() {
  renderCycleList();
  openMask('cycleMask');
}
function closeCycleSheet() {
  closeMask('cycleMask');
}
function persistCurrentCycleInPlace() {
  const cur = getCurrentCycle();
  if (!cur) return;
  const meta = readFormMeta();
  cur.budget = meta.budget;
  cur.rWork = meta.rWork;
  cur.rWeekend = meta.rWeekend;
  cur.rHoliday = meta.rHoliday;
  cur.fixedItems = (state.fixedItems || []).map(normalizeFixedItem);
  state.fixedItems = cur.fixedItems;
  cur.unexpectedItems = (state.unexpectedItems || []).map(normalizeUnexpectedItem);
  state.unexpectedItems = cur.unexpectedItems;
  cur.updatedAt = Date.now();
}
function renderCycleList() {
  const host = $('cycleList');
  if (!host) return;
  ensureCycles();
  const cycles = state.cycles
    .filter((c) => c && c.start && c.end)
    .slice()
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : String(a.end).localeCompare(String(b.end))));
  if (!cycles.length) {
    host.innerHTML = '<div class="cycle-empty">还没有已保存周期，先在设置里生成日历。</div>';
    return;
  }
  host.innerHTML = cycles.map((c) => {
    const current = c.id === state.currentCycleId;
    return '<div class="cycle-row' + (current ? ' is-current' : '') + '" data-id="' + escapeHtml(c.id) + '">' +
      '<button type="button" class="cycle-pick" data-pick>' + escapeHtml(c.start) + ' 至 ' + escapeHtml(c.end) +
      (current ? ' · 当前' : '') + '</button>' +
      '<button type="button" class="btn-danger btn-compact" data-del-cycle>删除</button>' +
      '</div>';
  }).join('');
}
function renderCycleSelect() {
  renderCycleList();
}
function dateCoveredByOtherCycle(ds, exceptId) {
  return (state.cycles || []).some((c) =>
    c && c.id !== exceptId && c.start && c.end && ds >= c.start && ds <= c.end
  );
}
function deleteCycle(id) {
  ensureCycles();
  const cyc = state.cycles.find((c) => c.id === id);
  if (!cyc) return;
  if (!confirm('删除周期 ' + cyc.start + ' 至 ' + cyc.end + '？\n将删除该周期的预算、固定消费、非预期大额，以及仅属于该周期的每天花销。')) return;
  const remaining = state.cycles.filter((c) => c.id !== id);
  if (cyc.start && cyc.end) {
    const start = parseDate(cyc.start);
    const end = parseDate(cyc.end);
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const ds = fmtDate(d);
      if (!dateCoveredByOtherCycle(ds, id)) {
        if (state.actuals) delete state.actuals[ds];
        if (state.dayTypes) delete state.dayTypes[ds];
      }
    }
  }
  state.cycles = remaining;
  const wasCurrent = state.currentCycleId === id;
  if (wasCurrent) {
    state.currentCycleId = null;
    const fallback = remaining.slice().sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
    if (fallback) {
      switchToCycle(fallback.id);
    } else {
      state.settings = null;
      state.fixedItems = defaultFixedItems();
      state.unexpectedItems = [];
      currentRows = [];
      $('summaryCard').hidden = true;
      $('fixedCard').hidden = true;
      $('spendCard').hidden = true;
      $('calCard').hidden = true;
      prefills();
      renderFixedList();
      renderUnexpectedList();
      closeCycleSheet();
      openSettings();
    }
  }
  save();
  renderCycleList();
}
function switchToCycle(id) {
  ensureCycles();
  const cyc = state.cycles.find((c) => c.id === id);
  if (!cyc) return;
  persistCurrentCycleInPlace();
  $('start').value = cyc.start;
  $('end').value = cyc.end;
  writeFormMeta(cyc);
  bindCycleItems(cyc);
  closeCycleSheet();
  build();
}
function goNextCycle() {
  const cur = getCurrentCycle();
  if (!cur || !cur.end) {
    alert('请先在设置里生成当前周期');
    return;
  }
  persistCurrentCycleInPlace();
  const next = nextCycleRange(cur);
  $('start').value = next.start;
  $('end').value = next.end;
  closeCycleSheet();
  build();
}
function updateCycleLabel() {
  renderCycleSelect();
}

function migrateLegacyCycle() {
  ensureCycles();
  if (state.cycles.length) {
    state.cycles.forEach((c) => {
      c.fixedItems = (c.fixedItems || []).map(normalizeFixedItem);
      c.unexpectedItems = (c.unexpectedItems || []).map(normalizeUnexpectedItem);
    });
    const cur = getCurrentCycle() || state.cycles[state.cycles.length - 1];
    if (cur) bindCycleItems(cur);
    return;
  }
  const s = state.settings;
  if (s && s.start && s.end) {
    const items = (state.fixedItems || s.fixedItems || defaultFixedItems()).map(normalizeFixedItem);
    const cyc = {
      id: uid(),
      start: s.start,
      end: s.end,
      budget: s.budget || 0,
      rWork: s.rWork,
      rWeekend: s.rWeekend,
      rHoliday: s.rHoliday,
      fixedItems: items,
      unexpectedItems: [],
      updatedAt: Date.now()
    };
    state.cycles.push(cyc);
    bindCycleItems(cyc);
  }
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
  migrateLegacyCycle();
  ensureFixedItems();
  ensureUnexpectedItems();
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

function build(options) {
  const silent = !!(options && options.silent);
  const startEl = $('start').value;
  const endEl = $('end').value;
  const start = parseDate(startEl);
  const end = parseDate(endEl);
  if (isNaN(start) || isNaN(end) || start > end) {
    if (!silent) alert('请检查周期日期是否填写正确');
    return;
  }
  resolveCycle(startEl, endEl);
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
    makeup: DEFAULT_MAKEUP_2026.join(','),
    currentCycleId: state.currentCycleId
  };
  if (!state.actuals) state.actuals = {};
  if (!state.dayTypes) state.dayTypes = {};
  save();
  if (!silent) renderFixedList();
  updateCycleLabel();
  render();
  if (!silent) closeSettings();
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
  $('fixedCard').hidden = false;
  $('spendCard').hidden = false;
  $('calCard').hidden = false;
  $('summaryCard').hidden = false;
  renderSummary();
  renderUnexpectedList();
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
      '<div class="label">📌 截至今日累积灵活结余</div>' +
      '<div class="big" style="color:#94a3b8;">—</div>' +
      '<div class="sub">今天不在当前记账周期内</div>';
    return;
  }
  const flexCls = info.bal >= 0 ? 'pos' : 'neg';
  const typeTxt = info.inCycle ? typeInfo(info.last.type)[1] : '周期已过完';
  const asOf = info.inCycle ? info.todayStr : info.last.ds;
  box.innerHTML =
    '<div class="label">📌 截至今日累积灵活结余（' + asOf + ' · ' + typeTxt + '）</div>' +
    '<div class="big ' + flexCls + '">' + signed(info.bal) + '</div>' +
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
  const paid = paidFixedTotal();
  const unexpected = unexpectedTotal();
  const fixedNow = fixedTotal();
  const flex = cents((s.budget || 0) - fixedNow);
  const totalSpend = cents(cumActualAll + paid + unexpected);
  const actualBal = cents((s.budget || 0) - cumActualAll - paid);
  const flexLeftPct = flex > 0 ? Math.round(balance / flex * 100) : null;
  $('summary').innerHTML =
    '<div class="stat"><div class="label">当月预算</div><div class="value">' + money(s.budget) + '</div></div>' +
    '<div class="stat"><div class="label">灵活预算</div><div class="value">' + money(flex) + '</div></div>' +
    '<div class="stat"><div class="label">总支出</div><div class="value exp">' + money(totalSpend) + '</div></div>' +
    '<div class="stat"><div class="label">灵活支出</div><div class="value exp">' + money(cumActualAll) + '</div></div>' +
    '<div class="stat"><div class="label">实际结余</div><div class="value ' + (actualBal >= 0 ? 'pos' : 'neg') + '">' + signed(actualBal) + '</div></div>' +
    '<div class="stat"><div class="label">灵活结余</div><div class="value ' + (balance >= 0 ? 'pos' : 'neg') + '">' + signed(balance) + '</div></div>' +
    '<div class="stat"><div class="label">进度</div><div class="value">' + elapsed + '/' + currentRows.length + ' 天</div></div>' +
    '<div class="stat"><div class="label">灵活剩余%</div><div class="value ' + (flexLeftPct == null ? '' : flexLeftPct >= 0 ? 'pos' : 'neg') + '">' + (flexLeftPct == null ? '—' : flexLeftPct + '%') + '</div></div>';
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

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportBackup() {
  persistCurrentCycleInPlace();
  save();
  const payload = {
    app: 'budget-calendar',
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    state: {
      settings: state.settings,
      actuals: state.actuals || {},
      dayTypes: state.dayTypes || {},
      cycles: state.cycles || [],
      currentCycleId: state.currentCycleId,
      fixedItems: state.fixedItems,
      unexpectedItems: state.unexpectedItems || []
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
  downloadBlob('预算记账备份_' + fmtDate(new Date()) + '.json', blob);
}

function normalizeImportedState(raw) {
  const incoming = raw && raw.state ? raw.state : raw;
  if (!incoming || typeof incoming !== 'object') return null;
  const hasData = incoming.actuals || incoming.cycles || incoming.settings || incoming.fixedItems || incoming.unexpectedItems;
  if (!hasData) return null;
  return {
    settings: incoming.settings || null,
    actuals: incoming.actuals || {},
    dayTypes: incoming.dayTypes || {},
    cycles: Array.isArray(incoming.cycles) ? incoming.cycles : [],
    currentCycleId: incoming.currentCycleId || null,
    fixedItems: incoming.fixedItems || null,
    unexpectedItems: Array.isArray(incoming.unexpectedItems) ? incoming.unexpectedItems : []
  };
}

function importBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || ''));
      const next = normalizeImportedState(parsed);
      if (!next) {
        alert('不是有效的备份文件');
        return;
      }
      if (!confirm('导入会覆盖本机当前全部数据，确定继续？')) return;
      localStorage.setItem(KEY, JSON.stringify(next));
      location.reload();
    } catch (err) {
      alert('无法解析该文件，请选择由本应用导出的 JSON 备份');
    }
  };
  reader.readAsText(file);
}

function exportCSV() {
  if (!currentRows.length) {
    alert('请先生成预算日历');
    return;
  }
  const head = ['日期', '星期', '类型', '当日预算', '累计应花', '实际花销', '当日结余', '累计结余'];
  const lines = [head.join(',')];
  lines.unshift('固定消费,' + state.fixedItems.map((it) =>
    '"' + String(it.name || '').replace(/"/g, '""') + '",' + money(itemAmount(it)) + ',' + (it.paid ? '已付' : '未付')
  ).join(','));
  if ((state.unexpectedItems || []).length) {
    lines.unshift('非预期大额,' + state.unexpectedItems.map((it) =>
      '"' + String(it.name || '').replace(/"/g, '""') + '",' + money(itemAmount(it))
    ).join(','));
  }
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
  downloadBlob('预算记账_' + state.settings.start + '_至_' + state.settings.end + '.csv', blob);
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
  const paid = paidFixedTotal();
  const unpaid = unpaidFixedTotal();
  const flex = cents(total - fixed);
  const flexCls = flex < 0 ? 'neg' : '';
  $('fixedSummary').innerHTML =
    '应付 ¥' + money(fixed) +
    '（已付 ¥' + money(paid) + ' / 未付 ¥' + money(unpaid) + '）' +
    ' ｜ 灵活 <span class="' + flexCls + '">¥' + money(flex) + '</span>' +
    (flex < 0 ? '（已超预算）' : '');
}

function renderFixedList() {
  ensureFixedItems();
  const host = $('fixedList');
  host.innerHTML = state.fixedItems.map((it) => {
    const amountVal = it.amount === 0 || it.amount ? it.amount : '';
    const paidCls = it.paid ? ' is-paid' : '';
    const paidTxt = it.paid ? '已付' : '未付';
    return '<div class="fixed-item" data-id="' + escapeHtml(it.id) + '">' +
      '<input class="fixed-name" type="text" maxlength="20" value="' + escapeHtml(it.name) + '" placeholder="项目名称" aria-label="项目名称">' +
      '<input class="fixed-amount" type="number" inputmode="decimal" step="0.01" min="0" value="' + escapeHtml(amountVal) + '" placeholder="金额" aria-label="金额">' +
      '<button class="btn-paid' + paidCls + '" type="button" data-paid aria-label="' + paidTxt + '">' + paidTxt + '</button>' +
      '<button class="btn-icon-del" type="button" data-del aria-label="删除">×</button>' +
      '</div>';
  }).join('');
  updateFixedSummary();
  updateCycleLabel();
}

function addFixedItem() {
  ensureFixedItems();
  state.fixedItems.push(normalizeFixedItem({ id: uid(), name: '', amount: '', paid: false }));
  const cur = getCurrentCycle();
  if (cur) cur.fixedItems = state.fixedItems;
  scheduleSave();
  renderFixedList();
  const names = document.querySelectorAll('#fixedList .fixed-name');
  if (names.length) names[names.length - 1].focus();
}

function updateUnexpectedSummary() {
  const box = $('unexpectedSummary');
  if (!box) return;
  ensureUnexpectedItems();
  const items = state.unexpectedItems || [];
  if (!items.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const total = unexpectedTotal();
  box.hidden = false;
  box.innerHTML = '已记 ¥' + money(total) + '（不计入灵活/固定，只进总支出）';
}

function renderUnexpectedList() {
  ensureUnexpectedItems();
  const host = $('unexpectedList');
  if (!host) return;
  host.innerHTML = state.unexpectedItems.map((it) => {
    const amountVal = it.amount === 0 || it.amount ? it.amount : '';
    return '<div class="unexpected-item" data-id="' + escapeHtml(it.id) + '">' +
      '<input class="unexpected-name" type="text" maxlength="20" value="' + escapeHtml(it.name) + '" placeholder="项目，如医疗/修车" aria-label="项目名称">' +
      '<input class="unexpected-amount" type="number" inputmode="decimal" step="0.01" min="0" value="' + escapeHtml(amountVal) + '" placeholder="金额" aria-label="金额">' +
      '<button class="btn-icon-del" type="button" data-del aria-label="删除">×</button>' +
      '</div>';
  }).join('');
  updateUnexpectedSummary();
}

function addUnexpectedItem() {
  ensureUnexpectedItems();
  state.unexpectedItems.push(normalizeUnexpectedItem({ id: uid(), name: '', amount: '' }));
  const cur = getCurrentCycle();
  if (cur) cur.unexpectedItems = state.unexpectedItems;
  scheduleSave();
  renderUnexpectedList();
  const names = document.querySelectorAll('#unexpectedList .unexpected-name');
  if (names.length) names[names.length - 1].focus();
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
  const cur = getCurrentCycle();
  const s = cur || state.settings;
  if (!s || !s.start || !s.end) return false;
  $('start').value = s.start;
  $('end').value = s.end;
  $('budget').value = s.budget;
  $('rateWork').value = s.rWork;
  $('rateWeekend').value = s.rWeekend;
  $('rateHoliday').value = s.rHoliday;
  if (cur) bindCycleItems(cur);
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
  if (e.key !== 'Escape') return;
  if (!$('sheetMask').hidden) closeSheet();
  else if (!$('cycleMask').hidden) closeCycleSheet();
  else if (!$('settingsMask').hidden) closeSettings();
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
  const cur = getCurrentCycle();
  if (cur) cur.fixedItems = state.fixedItems;
  scheduleSave();
  updateFixedSummary();
  if (!currentRows.length) return;
  if (e.target.classList.contains('fixed-amount')) build({ silent: true });
  else renderSummary();
});

$('fixedList').addEventListener('click', (e) => {
  const paidBtn = e.target.closest('[data-paid]');
  if (paidBtn) {
    const row = paidBtn.closest('.fixed-item');
    if (!row) return;
    const item = state.fixedItems.find((x) => x.id === row.dataset.id);
    if (!item) return;
    item.paid = !item.paid;
    const cur = getCurrentCycle();
    if (cur) cur.fixedItems = state.fixedItems;
    scheduleSave();
    renderFixedList();
    if (currentRows.length) renderSummary();
    return;
  }
  const del = e.target.closest('[data-del]');
  if (!del) return;
  const row = del.closest('.fixed-item');
  if (!row) return;
  state.fixedItems = state.fixedItems.filter((x) => x.id !== row.dataset.id);
  const cur = getCurrentCycle();
  if (cur) cur.fixedItems = state.fixedItems;
  scheduleSave();
  renderFixedList();
  if (currentRows.length) build({ silent: true });
});

$('fixedAdd').addEventListener('click', addFixedItem);
$('budget').addEventListener('input', updateFixedSummary);

$('unexpectedList').addEventListener('input', (e) => {
  const row = e.target.closest('.unexpected-item');
  if (!row) return;
  const item = state.unexpectedItems.find((x) => x.id === row.dataset.id);
  if (!item) return;
  if (e.target.classList.contains('unexpected-name')) item.name = e.target.value;
  if (e.target.classList.contains('unexpected-amount')) item.amount = e.target.value;
  const cur = getCurrentCycle();
  if (cur) cur.unexpectedItems = state.unexpectedItems;
  scheduleSave();
  updateUnexpectedSummary();
  if (currentRows.length) renderSummary();
});

$('unexpectedList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (!del) return;
  const row = del.closest('.unexpected-item');
  if (!row) return;
  state.unexpectedItems = state.unexpectedItems.filter((x) => x.id !== row.dataset.id);
  const cur = getCurrentCycle();
  if (cur) cur.unexpectedItems = state.unexpectedItems;
  scheduleSave();
  renderUnexpectedList();
  if (currentRows.length) renderSummary();
});

$('unexpectedAdd').addEventListener('click', addUnexpectedItem);

$('sheetTypes').addEventListener('click', (e) => {
  const btn = e.target.closest('.type-btn');
  if (!btn || !selectedDs) return;
  e.preventDefault();
  setDayType(selectedDs, btn.dataset.type);
});

window.addEventListener('DOMContentLoaded', () => {
  load();
  renderFixedList();
  renderUnexpectedList();
  renderTodaySpend();
  if (restoreSettings()) build();
  else {
    prefills();
    openSettings();
  }
  updateCycleLabel();
  updateFixedSummary();
  $('gen').addEventListener('click', () => build());
  $('openSettings').addEventListener('click', openSettings);
  $('settingsDone').addEventListener('click', closeSettings);
  $('settingsMask').addEventListener('click', (e) => {
    if (e.target === $('settingsMask')) closeSettings();
  });
  $('openCycle').addEventListener('click', openCycleSheet);
  $('cycleDone').addEventListener('click', closeCycleSheet);
  $('cycleMask').addEventListener('click', (e) => {
    if (e.target === $('cycleMask')) closeCycleSheet();
  });
  $('nextCycle').addEventListener('click', goNextCycle);
  $('cycleList').addEventListener('click', (e) => {
    const row = e.target.closest('.cycle-row');
    if (!row) return;
    if (e.target.closest('[data-del-cycle]')) {
      deleteCycle(row.dataset.id);
      return;
    }
    if (e.target.closest('[data-pick]')) switchToCycle(row.dataset.id);
  });
  $('export').addEventListener('click', exportCSV);
  $('exportData').addEventListener('click', exportBackup);
  $('importData').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    importBackupFile(file);
    e.target.value = '';
  });
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
