// ─── Gate ─────────────────────────────────────────────────────
const GATE_KEY = 'liuyuxinnb';
(function() {
  const gate = document.getElementById('gate');
  const input = document.getElementById('gateInput');
  const btn = document.getElementById('gateBtn');
  const err = document.getElementById('gateError');

  if (sessionStorage.getItem('gate_ok') === '1') { gate.style.display = 'none'; return; }

  function tryEnter() {
    if (input.value === GATE_KEY) {
      sessionStorage.setItem('gate_ok', '1');
      gate.style.display = 'none';
    } else {
      err.textContent = '密码错误，请重试';
      input.value = '';
      input.focus();
    }
  }
  btn.addEventListener('click', tryEnter);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryEnter(); });
  input.focus();
})();

const BASE = 'https://alb.makemoneygogogo.com';
const CIRCLE_ID = 61;
const SNOWFLAKE_EPOCH = 1288834974657n;

// ─── Storage ──────────────────────────────────────────────────
const store = {
  get: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

// ─── API ──────────────────────────────────────────────────────
async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.msg || `API error: ${path}`);
  return json.data;
}

// ─── Snowflake ────────────────────────────────────────────────
function isWithinDays(taskId, days) {
  try {
    const ts = (BigInt(taskId) >> 22n) + SNOWFLAKE_EPOCH;
    return (Date.now() - Number(ts)) < days * 86400_000;
  } catch { return true; }
}

// ─── State ────────────────────────────────────────────────────
let token = store.get('token');
let isRunning = false;
let scheduleTimer = null;
let selectedGroupIds = store.get('selectedGroupIds') || [];

// ─── DOM ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const els = {
  badge: $('badge'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  btnShowLogin: $('btnShowLogin'),
  loginModal: $('loginModal'),
  btnCancelLogin: $('btnCancelLogin'),
  username: $('username'),
  password: $('password'),
  btnLogin: $('btnLogin'),
  groupList: $('groupList'),
  btnRefreshGroups: $('btnRefreshGroups'),
  signInAutoVerify: $('signInAutoVerify'),
  taskDays: $('taskDays'),
  btnStart: $('btnStart'),
  btnSchedule: $('btnSchedule'),
  intervalMinutes: $('intervalMinutes'),
  logContainer: $('logContainer'),
  btnClearLog: $('btnClearLog'),
};

// ─── Log ──────────────────────────────────────────────────────
function log(text, level = 'info') {
  const empty = els.logContainer.querySelector('.log-empty');
  if (empty) empty.remove();
  const time = new Date().toTimeString().slice(0, 8);
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${time}</span><span class="log-msg log-${level}">${escapeHtml(text)}</span>`;
  els.logContainer.insertBefore(line, els.logContainer.firstChild);
  while (els.logContainer.children.length > 200) els.logContainer.removeChild(els.logContainer.lastChild);

  const logs = store.get('logs') || [];
  logs.unshift({ time, text, level });
  if (logs.length > 200) logs.length = 200;
  store.set('logs', logs);
}

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

els.btnClearLog.addEventListener('click', () => {
  store.set('logs', []);
  els.logContainer.innerHTML = '<div class="log-empty">暂无日志</div>';
});

// ─── Status ───────────────────────────────────────────────────
function setStatus(text, state) {
  els.statusText.textContent = text;
  els.statusDot.className = 'status-dot' + (state === 'ok' ? ' ok' : state === 'fail' ? ' fail' : '');
  els.btnShowLogin.style.display = state === 'ok' ? 'inline' : 'none';
}

function setBadge(running) {
  els.badge.textContent = running ? '运行中' : '待机';
  els.badge.className = 'badge ' + (running ? 'badge-running' : 'badge-idle');
}

// ─── Login modal ──────────────────────────────────────────────
els.btnShowLogin.addEventListener('click', () => {
  els.loginModal.style.display = 'flex';
});
els.btnCancelLogin.addEventListener('click', () => {
  els.loginModal.style.display = 'none';
});
els.loginModal.addEventListener('click', (e) => {
  if (e.target === els.loginModal) els.loginModal.style.display = 'none';
});

// ─── Login ────────────────────────────────────────────────────
els.btnLogin.addEventListener('click', async () => {
  const username = els.username.value.trim();
  const password = els.password.value.trim();
  if (!username || !password) { setStatus('请填写账号和密码', 'fail'); return; }
  els.btnLogin.textContent = '验证中...';
  els.btnLogin.disabled = true;
  try {
    const data = await api('POST', '/prod/user/login', { username, password, check: true });
    token = data.token;
    store.set('token', token);
    store.set('username', username);
    store.set('password', password);
    setStatus('✓ 已登录，可以开始执行', 'ok');
    els.loginModal.style.display = 'none';
    log('登录成功', 'success');
    loadGroups();
  } catch (e) {
    setStatus('登录失败：' + e.message, 'fail');
    log('登录失败：' + e.message, 'error');
  } finally {
    els.btnLogin.textContent = '验证登录';
    els.btnLogin.disabled = false;
  }
});

async function ensureToken() {
  if (token) {
    try { await api('GET', '/prod/user/getUserInfo', null, token); return token; } catch {}
  }
  const username = store.get('username');
  const password = store.get('password');
  if (!username || !password) throw new Error('请先验证登录');
  log('Token 已过期，重新登录...', 'warn');
  const data = await api('POST', '/prod/user/login', { username, password, check: true });
  token = data.token;
  store.set('token', token);
  return token;
}

// ─── Groups ───────────────────────────────────────────────────
async function loadGroups() {
  els.groupList.innerHTML = '<div class="group-loading">加载中...</div>';
  try {
    const tk = await ensureToken();
    const groups = await api('GET', `/goprod/accountgroup/info?task_id=0&optType=1&flag=3`, null, tk);
    const simplified = (groups || []).map(g => ({ id: g.id, name: g.name, accountCount: (g.accounts || []).length }));
    renderGroups(simplified);
  } catch (e) {
    els.groupList.innerHTML = '<div class="group-loading">加载失败，请先登录</div>';
  }
}

function renderGroups(groups) {
  if (!groups || groups.length === 0) {
    els.groupList.innerHTML = '<div class="group-loading">暂无分组</div>';
    return;
  }
  els.groupList.innerHTML = '';
  for (const g of groups) {
    const selected = selectedGroupIds.length === 0 || selectedGroupIds.includes(String(g.id));
    const item = document.createElement('div');
    item.className = 'group-item' + (selected ? ' selected' : '');
    item.dataset.id = g.id;
    item.innerHTML = `<div class="group-check"></div><span class="group-name">${escapeHtml(g.name)}</span><span class="group-count">${g.accountCount} 个账号</span>`;
    item.addEventListener('click', () => {
      item.classList.toggle('selected');
      const all = [...els.groupList.querySelectorAll('.group-item')];
      const sel = all.filter(el => el.classList.contains('selected')).map(el => el.dataset.id);
      selectedGroupIds = sel.length === all.length ? [] : sel;
      store.set('selectedGroupIds', selectedGroupIds);
    });
    els.groupList.appendChild(item);
  }
}

els.btnRefreshGroups.addEventListener('click', loadGroups);

// ─── Task helpers ─────────────────────────────────────────────
async function fetchCircleTasks(tk, maxDays) {
  const pageSize = 50;
  let pageNo = 1, all = [];
  while (true) {
    const data = await api('POST', '/prod/app/task/circle/pageList', { pageNo, pageSize, circleId: CIRCLE_ID }, tk);
    const list = data.list || [];
    all = all.concat(list);
    const hasRecent = list.some(t => [3, 10].includes(t.optType) || isWithinDays(t.taskId, maxDays));
    if (!hasRecent || list.length < pageSize) break;
    pageNo++;
  }
  return all.filter(t => [3, 10].includes(t.optType) || isWithinDays(t.taskId, maxDays));
}

async function getAccountGroups(tk, taskId, optType) {
  const groups = await api('GET', `/goprod/accountgroup/info?task_id=${taskId}&optType=${optType}&flag=3`, null, tk);
  const selectedSet = new Set(selectedGroupIds.map(String));
  const result = [];
  for (const g of groups) {
    if (selectedSet.size > 0 && !selectedSet.has(String(g.id))) continue;
    const accounts = (g.accounts || []).filter(a => !a.is_frozen);
    if (accounts.length > 0) result.push({ groupId: g.id, accountIds: accounts.map(a => a.id) });
  }
  return result;
}

async function execTask(tk, detail, accountGroups, signInAutoVerify) {
  const { taskId, optType, optRule, execRule } = detail;
  const baseRule = (execRule && execRule[0]) || {};
  const payload = {
    taskId, optType,
    execRule: accountGroups.map(g => ({
      weiboAccountIds: g.accountIds,
      optCnt: baseRule.optCnt || 1,
      optTimeInterval: baseRule.optTimeInterval || 5,
      groupInterval: baseRule.groupInterval || 300,
    })),
    channel: 'AUTO', isExec: 1, version: 2,
  };

  if (optType === 1) {
    payload.outLikeTaskRuleParam = { ...optRule, autoVerify: 0 };
  } else if (optType === 2) {
    payload.repostTaskRule = { ...optRule, autoVerify: 0 };
  } else if (optType === 4) {
    payload.commentTaskRule = { ...optRule, autoVerify: 0 };
  } else if (optType === 10) {
    payload.hyperTalkOriginalTaskRule = { hyperTalkAddress: optRule.hyperTalkAddress, hyperTalkId: optRule.hyperTalkId, addressSummary: optRule.addressSummary, syncWb: optRule.syncWb ?? null, optContent: optRule.optContent || [] };
  } else if (optType === 3) {
    payload.htSignInRuleParam = { ...optRule, autoVerify: signInAutoVerify ? 1 : 0 };
  } else if (optType === 30) {
    payload.innerLikeTaskRule = { ...optRule, autoVerify: 0 };
  } else {
    payload.taskRule = optRule;
  }

  return api('POST', '/prod/app/task/saveAndExec', payload, tk);
}

// ─── Main automation ──────────────────────────────────────────
async function runAutomation() {
  const maxDays = parseInt(els.taskDays.value) || 3;
  const signInAutoVerify = els.signInAutoVerify.checked;

  log(`=== 开始执行（${maxDays}天内任务）===`, 'info');
  try {
    const tk = await ensureToken();

    // 1. 获取任务列表
    log('获取圈子任务列表...', 'info');
    const tasks = await fetchCircleTasks(tk, maxDays);
    log(`共 ${tasks.length} 个任务`, 'info');

    // 2. 领取未领取的
    const unaccepted = tasks.filter(t => t.isAccept !== 1);
    for (const task of unaccepted) {
      if (!isRunning) break;
      try {
        await api('POST', '/prod/app/task/acceptTask', { taskId: task.taskId, circleId: CIRCLE_ID }, tk);
        log(`已领取: ${task.taskName || task.taskId}`, 'info');
        await sleep(500);
      } catch (e) { log(`领取失败 ${task.taskId}: ${e.message}`, 'error'); }
    }

    // 3. 过滤已执行成功的
    const allTasks = await fetchCircleTasks(tk, maxDays);
    const toExec = allTasks.filter(t => t.isAccept === 1);
    const lotResults = await Promise.allSettled(
      toExec.map(t => api('POST', '/prod/app/task/lastLot', { value: t.taskId }, tk))
    );
    const toExecNew = toExec.filter((t, i) => {
      const r = lotResults[i];
      if (r.status === 'rejected') return true;
      const lots = r.value;
      if (!lots || lots.length === 0) return true;
      const lot = lots[0];
      if (lot.status === 1) return false;
      if (lot.status === 2 && lot.successCount > 0) return false;
      return true;
    });

    log(`待执行: ${toExecNew.length} 个（跳过已成功: ${toExec.length - toExecNew.length} 个）`, 'info');
    if (toExecNew.length === 0) { log('本轮无新任务', 'info'); return; }

    // 4. 获取账号分组
    let accountGroups = [];
    try {
      accountGroups = await getAccountGroups(tk, toExecNew[0].taskId, toExecNew[0].optType);
      log(`可用分组: ${accountGroups.length} 个`, 'info');
    } catch (e) { log(`获取账号失败: ${e.message}`, 'warn'); }

    if (accountGroups.length === 0) { log('无可用账号', 'warn'); return; }

    // 5. 并发拉详情，串行提交
    const detailResults = await Promise.allSettled(toExecNew.map(t =>
      api('POST', '/prod/app/task/detail', { taskId: t.taskId, circleId: null }, tk)
    ));
    const details = detailResults.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);

    log(`提交 ${details.length} 个任务...`, 'info');
    let successCount = 0;
    for (const detail of details) {
      if (!isRunning) break;
      try {
        await execTask(tk, detail, accountGroups, signInAutoVerify);
        successCount++;
      } catch (e) { log(`✗ ${detail.taskName || detail.taskId}: ${e.message}`, 'error'); }
      await sleep(1000);
    }
    log(`提交完成，成功 ${successCount}/${details.length}`, successCount > 0 ? 'success' : 'warn');

    // 6. 追踪结果
    await trackResults(tk, details.slice(0, successCount));

  } catch (e) {
    log(`出错: ${e.message}`, 'error');
  }
}

async function trackResults(tk, details) {
  if (details.length === 0) return;
  const tasks = details.map(d => ({ taskId: d.taskId, taskName: d.taskName || d.taskId, done: false, lastProgress: null }));
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    const pending = tasks.filter(t => !t.done);
    if (pending.length === 0) break;
    const results = await Promise.allSettled(
      pending.map(t => api('POST', '/prod/app/task/lastLot', { value: t.taskId }, tk))
    );
    for (let i = 0; i < results.length; i++) {
      const task = pending[i];
      const r = results[i];
      if (r.status === 'rejected') continue;
      const lots = r.value;
      if (!lots || lots.length === 0) continue;
      const lot = lots[0];
      if (lot.status === 2 || lot.status === 3) {
        task.done = true;
        const icon = lot.successCount > 0 ? '✓' : '✗';
        const label = lot.status === 2 ? '完成' : '终止';
        log(`${icon} ${task.taskName} ${label} 成功${lot.successCount}/${lot.planCount}`, lot.successCount > 0 ? 'success' : 'warn');
        try {
          const accts = await api('POST', '/prod/app/task/account/execDetail', { value: lot.lotNo }, tk);
          for (const a of (accts || [])) {
            if (a.failCount > 0 && a.errorMsg?.length) log(`  └ ${a.accountName} 失败: ${a.errorMsg[0].substring(0, 80)}`, 'error');
            else if (a.successCount > 0) log(`  └ ${a.accountName} 成功 ${a.successCount} 条`, 'success');
          }
        } catch {}
      } else if (lot.status === 1) {
        const prog = `${lot.successCount}/${lot.planCount}`;
        if (task.lastProgress !== prog) { task.lastProgress = prog; log(`⋯ ${task.taskName} 执行中 ${prog}`, 'info'); }
      }
    }
    if (tasks.every(t => t.done)) break;
    await sleep(3000);
  }
}

// ─── One-shot ─────────────────────────────────────────────────
els.btnStart.addEventListener('click', async () => {
  if (isRunning) return;
  isRunning = true;
  setBadge(true);
  els.btnStart.textContent = '执行中...';
  els.btnStart.disabled = true;
  els.btnStart.classList.add('running');
  await runAutomation();
  isRunning = false;
  setBadge(false);
  els.btnStart.textContent = '开始';
  els.btnStart.disabled = false;
  els.btnStart.classList.remove('running');
  log('=== 执行完毕 ===', 'success');
});

// ─── Schedule ─────────────────────────────────────────────────
let scheduleRunning = false;

els.btnSchedule.addEventListener('click', async () => {
  if (scheduleRunning) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
    scheduleRunning = false;
    els.btnSchedule.textContent = '开始';
    els.btnSchedule.classList.remove('running');
    els.intervalMinutes.disabled = false;
    setBadge(false);
    log('定期执行已停止', 'warn');
  } else {
    const minutes = parseInt(els.intervalMinutes.value) || 30;
    scheduleRunning = true;
    els.btnSchedule.textContent = '停止';
    els.btnSchedule.classList.add('running');
    els.intervalMinutes.disabled = true;
    setBadge(true);
    log(`定期执行已开启，每 ${minutes} 分钟执行一次`, 'success');

    // 立即跑一次
    if (!isRunning) {
      isRunning = true;
      await runAutomation();
      isRunning = false;
      if (!scheduleRunning) { setBadge(false); return; }
    }

    scheduleTimer = setInterval(async () => {
      if (isRunning) return;
      isRunning = true;
      setBadge(true);
      await runAutomation();
      isRunning = false;
      if (scheduleRunning) setBadge(true);
    }, minutes * 60 * 1000);
  }
});

// ─── Init ─────────────────────────────────────────────────────
function init() {
  const username = store.get('username');
  const password = store.get('password');
  if (username) els.username.value = username;
  if (password) els.password.value = password;

  const taskDays = store.get('taskDays');
  if (taskDays) els.taskDays.value = taskDays;

  const intervalMinutes = store.get('intervalMinutes');
  if (intervalMinutes) els.intervalMinutes.value = intervalMinutes;

  els.signInAutoVerify.checked = store.get('signInAutoVerify') || false;
  els.signInAutoVerify.addEventListener('change', () => store.set('signInAutoVerify', els.signInAutoVerify.checked));
  els.taskDays.addEventListener('change', () => store.set('taskDays', els.taskDays.value));
  els.intervalMinutes.addEventListener('change', () => store.set('intervalMinutes', els.intervalMinutes.value));

  const logs = store.get('logs') || [];
  if (logs.length > 0) {
    els.logContainer.innerHTML = '';
    logs.forEach(l => {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.innerHTML = `<span class="log-time">${l.time}</span><span class="log-msg log-${l.level}">${escapeHtml(l.text)}</span>`;
      els.logContainer.appendChild(line);
    });
  }

  if (token) {
    setStatus('已有登录状态，可直接执行', 'ok');
    loadGroups();
  } else {
    setStatus('请先登录捞捞账号', '');
    els.btnShowLogin.style.display = 'none';
    els.loginModal.style.display = 'flex';
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

init();
