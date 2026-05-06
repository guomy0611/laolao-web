// ─── Storage ──────────────────────────────────────────────────
const store = {
  get: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

function $(id) { return document.getElementById(id); }

// ─── Gate ─────────────────────────────────────────────────────
const GATE_KEY = 'liuyuxinnb';
(function () {
  const gate = $('gate'), input = $('gateInput'), btn = $('gateBtn'), err = $('gateError');
  if (sessionStorage.getItem('gate_ok') === '1') { gate.style.display = 'none'; showPlatformSelect(); return; }
  function tryEnter() {
    if (input.value === GATE_KEY) {
      sessionStorage.setItem('gate_ok', '1');
      gate.style.display = 'none';
      showPlatformSelect();
    } else { err.textContent = '密码错误'; input.value = ''; input.focus(); }
  }
  btn.addEventListener('click', tryEnter);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryEnter(); });
  input.focus();
})();

function showPlatformSelect() {
  const saved = store.get('platform');
  if (saved) { initPlatform(saved); return; }
  const ps = $('platformSelect');
  ps.style.display = 'flex';
}

// ─── Platform config ──────────────────────────────────────────
const PLATFORMS = {
  laolao: {
    name: '捞捞',
    base: 'https://alb.makemoneygogogo.com',
    goBase: 'https://alb.makemoneygogogo.com',
    siteUrl: 'https://h5.makemoneygogogo.com/home/index.html#/task?type=circle',
    circleId: 61,
    login: (u, p) => apiReq('POST', '/prod/user/login', { username: u, password: p, check: true }),
    getToken: (data) => data.token,
    getTasks: async (token, days) => {
      const pageSize = 50; let pageNo = 1, all = [];
      while (true) {
        const data = await apiReq('POST', '/prod/app/task/circle/pageList',
          { pageNo, pageSize, circleId: 61 }, token);
        const list = data.list || [];
        all = all.concat(list);
        const hasRecent = list.some(t => [3, 10].includes(t.optType) || isWithinDays(t.taskId, days));
        if (!hasRecent || list.length < pageSize) break;
        pageNo++;
      }
      return all.filter(t => [3, 10].includes(t.optType) || isWithinDays(t.taskId, days));
    },
    isAccepted: (t) => t.isAccept === 1,
    acceptTask: (token, taskId) =>
      apiReq('POST', '/prod/app/task/acceptTask', { taskId, circleId: 61 }, token),
    getGroups: async (token, taskId, optType) => {
      const groups = await apiReq('GET',
        `/goprod/accountgroup/info?task_id=${taskId || 0}&optType=${optType || 1}&flag=3`, null, token);
      return (groups || []).map(g => ({ id: g.id, name: g.name, accountCount: (g.accounts || []).length,
        accountIds: (g.accounts || []).filter(a => !a.is_frozen).map(a => a.id) }));
    },
    getTaskDetail: (token, taskId) =>
      apiReq('POST', '/prod/app/task/detail', { taskId, circleId: null }, token),
    execTask: (token, detail, groupIds, signInAutoVerify) => {
      const { taskId, optType, optRule, execRule } = detail;
      const base = (execRule && execRule[0]) || {};
      const payload = {
        taskId, optType,
        execRule: groupIds.map(ids => ({
          weiboAccountIds: ids,
          optCnt: base.optCnt || 1,
          optTimeInterval: base.optTimeInterval || 5,
          groupInterval: base.groupInterval || 300,
        })),
        channel: 'AUTO', isExec: 1, version: 2,
      };
      if (optType === 1) payload.outLikeTaskRuleParam = { ...optRule, autoVerify: 0 };
      else if (optType === 2) payload.repostTaskRule = { ...optRule, autoVerify: 0 };
      else if (optType === 4) payload.commentTaskRule = { ...optRule, autoVerify: 0 };
      else if (optType === 10) payload.hyperTalkOriginalTaskRule = { hyperTalkAddress: optRule.hyperTalkAddress, hyperTalkId: optRule.hyperTalkId, addressSummary: optRule.addressSummary, syncWb: null, optContent: optRule.optContent || [] };
      else if (optType === 3) payload.htSignInRuleParam = { ...optRule, autoVerify: signInAutoVerify ? 1 : 0 };
      else if (optType === 30) payload.innerLikeTaskRule = { ...optRule, autoVerify: 0 };
      else payload.taskRule = optRule;
      return apiReq('POST', '/prod/app/task/saveAndExec', payload, token);
    },
    checkDone: async (token, taskId) => {
      const lots = await apiReq('POST', '/prod/app/task/lastLot', { value: taskId }, token);
      if (!lots || lots.length === 0) return null;
      return lots[0];
    },
    showSignIn: true,
    verifyUserInfo: (token) => apiReq('GET', '/prod/user/getUserInfo', null, token),
  },
  xft: {
    name: '星粉通',
    base: 'https://ddlink-proxy.guomy0611.workers.dev',
    siteUrl: null,
    circleId: null,
    login: (u, p) => apiReq('POST', '/user/login', { username: u, password: p }, null, 'xft'),
    getToken: (data) => data.token,
    getTasks: async (token, days) => {
      const data = await apiReq('POST', '/task/pageQueryUserAcceptTask',
        { pageNo: 1, pageSize: 50 }, token, 'xft');
      return (data.list || []).filter(t => isWithinDays(t.taskId, days));
    },
    isAccepted: (t) => t.receive === true,
    acceptTask: (token, taskId) =>
      apiReq('POST', '/task/acceptTask', { taskId }, token, 'xft'),
    getGroups: async (token) => {
      const groups = await apiReq('GET', '/weibo/account/group/queryGroupList', null, token, 'xft');
      return (groups || []).map(g => ({ id: g.groupId, name: g.groupName,
        accountCount: g.weiboAccountCount || 0,
        accountIds: (g.weiboAccounts || []).map(a => a.weiboUserId) }));
    },
    getTaskDetail: (token, taskId) =>
      apiReq('POST', '/lite/taskV2/queryTaskDetail', { taskId }, token, 'xft'),
    execTask: (token, detail, groupIds) => {
      const { taskId, commentTaskRule, originalTaskRule } = detail;
      const rule = commentTaskRule || originalTaskRule || {};
      return apiReq('POST', '/lite/taskV2/executeTask', {
        taskId,
        optCnt: rule.numberTimes || 1,
        optTimeInterval: rule.intervalTime || 90,
        round: rule.round || 1,
        roundTime: rule.roundTime || 60,
        likeSort: 0,
        executeClient: rule.executeClient || 3,
        waterSticker: 0,
        failTask: null,
        channelId: null,
        verifyTaskSwitch: false,
        forwardTaskStack: false,
      }, token, 'xft');
    },
    checkDone: async (token, taskId) => {
      const data = await apiReq('POST', '/lite/taskV2/queryPendingTask',
        { taskId }, token, 'xft');
      return data;
    },
    showSignIn: false,
    verifyUserInfo: (token) => apiReq('GET', '/weibo/account/getDefaultAccount', null, token, 'xft'),
  },
};

// ─── API ──────────────────────────────────────────────────────
let currentPlatform = 'laolao';

function getBase(platform) {
  return PLATFORMS[platform || currentPlatform].base;
}

async function apiReq(method, path, body, token, platform) {
  const base = getBase(platform);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if ((platform || currentPlatform) === 'xft') {
    headers['appversionname'] = '6.6.20';
    headers['apilevel'] = '36';
    headers['platform'] = 'android';
    headers['env'] = 'online';
    headers['deviceid'] = 'web000000000001';
    headers['devicename'] = 'web';
  }
  const res = await fetch(base + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.msg || 'API error: ' + path);
  return json.data;
}

// ─── Snowflake ────────────────────────────────────────────────
const SNOWFLAKE_EPOCH = 1288834974657n;
function isWithinDays(taskId, days) {
  try {
    const ts = (BigInt(taskId) >> 22n) + SNOWFLAKE_EPOCH;
    return (Date.now() - Number(ts)) < days * 86400_000;
  } catch { return true; }
}


// ─── State ────────────────────────────────────────────────────
let token = null;
let isRunning = false;
let scheduleTimer = null;
let scheduleRunning = false;
let selectedGroupIds = [];

const els = {
  badge: $('badge'), statusDot: $('statusDot'), statusText: $('statusText'),
  btnShowLogin: $('btnShowLogin'), loginModal: $('loginModal'),
  loginModalTitle: $('loginModalTitle'),
  username: $('username'), password: $('password'),
  btnLogin: $('btnLogin'), btnCancelLogin: $('btnCancelLogin'),
  groupList: $('groupList'), btnRefreshGroups: $('btnRefreshGroups'),
  signInRow: $('signInRow'), signInAutoVerify: $('signInAutoVerify'),
  taskDays: $('taskDays'), intervalMinutes: $('intervalMinutes'),
  btnStart: $('btnStart'), btnSchedule: $('btnSchedule'),
  logContainer: $('logContainer'), btnClearLog: $('btnClearLog'),
  floatingBallToggle: $('floatingBallToggle'),
  tooltip: $('tooltip'), platformTag: $('platformTag'),
  platformSubtitle: $('platformSubtitle'), footerPlatform: $('footerPlatform'),
  openSite: $('openSite'), refreshSite: $('refreshSite'),
};

// ─── Platform init ────────────────────────────────────────────
$('selectLaolao').addEventListener('click', () => initPlatform('laolao'));
$('selectXft').addEventListener('click', () => initPlatform('xft'));

function initPlatform(platform) {
  currentPlatform = platform;
  store.set('platform', platform);
  $('platformSelect').style.display = 'none';

  const p = PLATFORMS[platform];
  els.platformTag.textContent = p.name;
  els.platformTag.className = 'platform-tag ' + platform;
  els.platformTag.style.display = 'inline-flex';
  els.platformSubtitle.textContent = p.name + ' 任务助手';
  els.footerPlatform.textContent = p.name + ' 助手';
  els.loginModalTitle.textContent = p.name + ' 账号';
  els.signInRow.style.display = p.showSignIn ? 'flex' : 'none';

  // Platform tag click to switch
  els.platformTag.onclick = () => {
    store.set('platform', null);
    store.set('token_' + platform, null);
    token = null;
    $('platformSelect').style.display = 'flex';
  };

  token = store.get('token_' + platform);
  selectedGroupIds = store.get('selectedGroupIds_' + platform) || [];
  els.taskDays.value = store.get('taskDays_' + platform) || 3;
  els.intervalMinutes.value = store.get('intervalMinutes_' + platform) || 5;
  els.signInAutoVerify.checked = store.get('signInAutoVerify') || false;
  els.floatingBallToggle.checked = store.get('floatingBall') || false;

  const logs = store.get('logs_' + platform) || [];
  if (logs.length > 0) {
    els.logContainer.innerHTML = '';
    logs.forEach(l => appendLogLine(l.time, l.text, l.level));
  }

  if (token) {
    setStatus('已有登录状态，可直接执行', 'ok');
    loadGroups();
  } else {
    setStatus('请先登录', '');
    els.btnShowLogin.style.display = 'none';
    els.loginModal.style.display = 'flex';
  }
}

// ─── Login modal ──────────────────────────────────────────────
els.btnShowLogin.addEventListener('click', () => { els.loginModal.style.display = 'flex'; });
els.btnCancelLogin.addEventListener('click', () => { els.loginModal.style.display = 'none'; });
els.loginModal.addEventListener('click', e => { if (e.target === els.loginModal) els.loginModal.style.display = 'none'; });

els.btnLogin.addEventListener('click', async () => {
  const u = els.username.value.trim(), p = els.password.value.trim();
  if (!u || !p) { setStatus('请填写账号和密码', 'fail'); return; }
  els.btnLogin.textContent = '验证中...'; els.btnLogin.disabled = true;
  try {
    const data = await PLATFORMS[currentPlatform].login(u, p);
    token = PLATFORMS[currentPlatform].getToken(data);
    store.set('token_' + currentPlatform, token);
    store.set('username_' + currentPlatform, u);
    store.set('password_' + currentPlatform, p);
    setStatus('✓ 已登录，可以开始执行', 'ok');
    els.loginModal.style.display = 'none';
    log('登录成功', 'success');
    loadGroups();
  } catch (e) {
    setStatus('登录失败：' + e.message, 'fail');
  } finally {
    els.btnLogin.textContent = '验证登录'; els.btnLogin.disabled = false;
  }
});

async function ensureToken() {
  if (token) {
    try { await PLATFORMS[currentPlatform].verifyUserInfo(token); return token; } catch {}
  }
  const u = store.get('username_' + currentPlatform);
  const p = store.get('password_' + currentPlatform);
  if (!u || !p) throw new Error('请先登录');
  log('Token 已过期，重新登录...', 'warn');
  const data = await PLATFORMS[currentPlatform].login(u, p);
  token = PLATFORMS[currentPlatform].getToken(data);
  store.set('token_' + currentPlatform, token);
  return token;
}

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

// ─── Site buttons ─────────────────────────────────────────────
els.openSite.addEventListener('click', () => {
  const url = PLATFORMS[currentPlatform].siteUrl;
  if (url) window.open(url, '_blank');
  else alert('星粉通暂无网页版');
});
els.refreshSite.addEventListener('click', async () => {
  setTimeout(() => {
    token = null;
    ensureToken().then(() => { setStatus('✓ 已登录，可以开始执行', 'ok'); loadGroups(); }).catch(() => {});
  }, 1000);
});

// ─── Groups ───────────────────────────────────────────────────
async function loadGroups() {
  els.groupList.innerHTML = '<div class="group-loading">加载中...</div>';
  try {
    const tk = await ensureToken();
    const p = PLATFORMS[currentPlatform];
    const groups = await p.getGroups(tk);
    renderGroups(groups);
  } catch (e) {
    els.groupList.innerHTML = '<div class="group-loading">加载失败，请先登录</div>';
  }
}

function renderGroups(groups) {
  if (!groups || groups.length === 0) { els.groupList.innerHTML = '<div class="group-loading">暂无分组</div>'; return; }
  els.groupList.innerHTML = '';
  for (const g of groups) {
    const selected = selectedGroupIds.length === 0 || selectedGroupIds.includes(String(g.id));
    const item = document.createElement('div');
    item.className = 'group-item' + (selected ? ' selected' : '');
    item.dataset.id = g.id;
    item.innerHTML = `<div class="group-check"></div><span class="group-name">${esc(g.name)}</span><span class="group-count">${g.accountCount} 个账号</span>`;
    item.addEventListener('click', () => {
      item.classList.toggle('selected');
      const all = [...els.groupList.querySelectorAll('.group-item')];
      const sel = all.filter(el => el.classList.contains('selected')).map(el => el.dataset.id);
      selectedGroupIds = sel.length === all.length ? [] : sel;
      store.set('selectedGroupIds_' + currentPlatform, selectedGroupIds);
    });
    els.groupList.appendChild(item);
  }
}

els.btnRefreshGroups.addEventListener('click', loadGroups);

// ─── Automation ───────────────────────────────────────────────
async function runAutomation() {
  const p = PLATFORMS[currentPlatform];
  const maxDays = parseInt(els.taskDays.value) || 3;
  const signInAutoVerify = els.signInAutoVerify.checked;
  log(`=== 开始执行 [${p.name}]（${maxDays}天内任务）===`, 'info');

  try {
    const tk = await ensureToken();

    // 1. 获取任务列表
    log('获取任务列表...', 'info');
    const tasks = await p.getTasks(tk, maxDays);
    log(`共 ${tasks.length} 个任务`, 'info');

    // 2. 领取未领取的
    const unaccepted = tasks.filter(t => !p.isAccepted(t));
    for (const task of unaccepted) {
      if (!isRunning) break;
      try {
        await p.acceptTask(tk, task.taskId);
        log(`已领取: ${task.taskName || task.taskId}`, 'info');
        await sleep(500);
      } catch (e) { log(`领取失败 ${task.taskId}: ${e.message}`, 'error'); }
    }

    // 3. 重新获取，过滤已成功的
    const allTasks = await p.getTasks(tk, maxDays);
    const toExec = allTasks.filter(t => p.isAccepted(t));

    // 对捞捞，检查 lastLot 去重
    let toExecNew = toExec;
    if (currentPlatform === 'laolao') {
      const lotResults = await Promise.allSettled(toExec.map(t => p.checkDone(tk, t.taskId)));
      toExecNew = toExec.filter((t, i) => {
        const r = lotResults[i];
        if (r.status === 'rejected') return true;
        const lots = r.value;
        if (!lots || lots.length === 0) return true;
        const lot = lots[0];
        if (lot.status === 1) return false;
        if (lot.status === 2 && lot.successCount > 0) return false;
        return true;
      });
    }

    log(`待执行: ${toExecNew.length} 个（跳过: ${toExec.length - toExecNew.length} 个）`, 'info');
    if (toExecNew.length === 0) { log('本轮无新任务', 'info'); return; }

    // 4. 获取分组
    let groups = [];
    try {
      const allGroups = await p.getGroups(tk, toExecNew[0].taskId, toExecNew[0].optType);
      const selectedSet = new Set(selectedGroupIds.map(String));
      groups = allGroups.filter(g => selectedSet.size === 0 || selectedSet.has(String(g.id)));
      log(`可用分组: ${groups.length} 个`, 'info');
    } catch (e) { log(`获取账号失败: ${e.message}`, 'warn'); }

    if (groups.length === 0) { log('无可用分组', 'warn'); return; }
    const groupAccountIds = groups.map(g => g.accountIds);

    // 5. 并发拉详情，串行执行
    const detailResults = await Promise.allSettled(
      toExecNew.map(t => p.getTaskDetail(tk, t.taskId))
    );
    const details = detailResults.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);

    log(`提交 ${details.length} 个任务...`, 'info');
    let successCount = 0;
    for (const detail of details) {
      if (!isRunning) break;
      try {
        await p.execTask(tk, detail, groupAccountIds, signInAutoVerify);
        successCount++;
        log(`✓ 提交: ${detail.taskName || detail.taskId}`, 'success');
      } catch (e) { log(`✗ ${detail.taskName || detail.taskId}: ${e.message}`, 'error'); }
      await sleep(1000);
    }
    log(`提交完成 ${successCount}/${details.length}`, successCount > 0 ? 'success' : 'warn');

  } catch (e) {
    log(`出错: ${e.message}`, 'error');
  }
}

// ─── Start button ─────────────────────────────────────────────
els.btnStart.addEventListener('click', async () => {
  if (isRunning) return;
  isRunning = true; setBadge(true);
  els.btnStart.textContent = '执行中...'; els.btnStart.disabled = true;
  els.btnStart.classList.add('running');
  await runAutomation();
  isRunning = false;
  if (!scheduleRunning) setBadge(false);
  els.btnStart.textContent = '开始'; els.btnStart.disabled = false;
  els.btnStart.classList.remove('running');
  log('=== 执行完毕 ===', 'success');
});

// ─── Schedule ─────────────────────────────────────────────────
els.btnSchedule.addEventListener('click', async () => {
  if (scheduleRunning) {
    clearInterval(scheduleTimer); scheduleTimer = null; scheduleRunning = false;
    els.btnSchedule.textContent = '开始'; els.btnSchedule.classList.remove('running');
    els.intervalMinutes.disabled = false;
    if (!isRunning) setBadge(false);
    log('定期执行已停止', 'warn');
  } else {
    const minutes = parseInt(els.intervalMinutes.value) || 5;
    scheduleRunning = true;
    els.btnSchedule.textContent = '停止'; els.btnSchedule.classList.add('running');
    els.intervalMinutes.disabled = true;
    setBadge(true);
    log(`定期执行已开启，每 ${minutes} 分钟一次`, 'success');
    if (!isRunning) { isRunning = true; await runAutomation(); isRunning = false; if (!scheduleRunning) { setBadge(false); return; } }
    scheduleTimer = setInterval(async () => {
      if (isRunning) return;
      isRunning = true; setBadge(true);
      await runAutomation();
      isRunning = false;
      if (scheduleRunning) setBadge(true);
    }, minutes * 60 * 1000);
  }
});

// ─── Log ──────────────────────────────────────────────────────
function log(text, level = 'info') {
  const time = new Date().toTimeString().slice(0, 8);
  appendLogLine(time, text, level);
  const logs = store.get('logs_' + currentPlatform) || [];
  logs.unshift({ time, text, level });
  if (logs.length > 200) logs.length = 200;
  store.set('logs_' + currentPlatform, logs);
}

function appendLogLine(time, text, level) {
  const empty = els.logContainer.querySelector('.log-empty');
  if (empty) empty.remove();
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${time}</span><span class="log-msg log-${level}">${esc(text)}</span>`;
  els.logContainer.insertBefore(line, els.logContainer.firstChild);
  while (els.logContainer.children.length > 200) els.logContainer.removeChild(els.logContainer.lastChild);
}

els.btnClearLog.addEventListener('click', () => {
  store.set('logs_' + currentPlatform, []);
  els.logContainer.innerHTML = '<div class="log-empty">暂无日志</div>';
});

// ─── Tooltip ──────────────────────────────────────────────────
document.querySelectorAll('.action-tip').forEach(el => {
  el.addEventListener('mouseenter', e => {
    els.tooltip.textContent = e.target.dataset.tip;
    els.tooltip.style.display = 'block';
    const rect = e.target.getBoundingClientRect();
    els.tooltip.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';
    els.tooltip.style.top = (rect.bottom + 6) + 'px';
  });
  el.addEventListener('mouseleave', () => { els.tooltip.style.display = 'none'; });
});

// ─── Settings ─────────────────────────────────────────────────
els.taskDays.addEventListener('change', () => store.set('taskDays_' + currentPlatform, els.taskDays.value));
els.intervalMinutes.addEventListener('change', () => store.set('intervalMinutes_' + currentPlatform, els.intervalMinutes.value));
els.signInAutoVerify.addEventListener('change', () => store.set('signInAutoVerify', els.signInAutoVerify.checked));
els.floatingBallToggle.addEventListener('change', () => store.set('floatingBall', els.floatingBallToggle.checked));

// ─── Utils ────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
