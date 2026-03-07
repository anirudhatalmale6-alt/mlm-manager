// MLM Manager - Renderer
let config = {};
let currentTaskId = null;
let currentWorkgroup = null;
let profiles = [];
let selectedProfileIdx = -1;
let browserDetectInterval = null;
let detectedBrowsers = [];

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
  config = await window.mlm.getConfig();
  loadConfigToUI();

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // Task buttons
  document.getElementById('refreshTasksBtn').addEventListener('click', loadTasks);
  document.getElementById('taskDetailBtn').addEventListener('click', showTaskDetail);
  document.getElementById('taskWorkBtn').addEventListener('click', startTask);

  // Profile buttons
  document.getElementById('getProfilesBtn').addEventListener('click', fetchProfiles);
  document.getElementById('openProfileBtn').addEventListener('click', openSelectedProfile);
  document.getElementById('showProfileBtn').addEventListener('click', showSelectedProfile);
  document.getElementById('closeProfileBtn').addEventListener('click', closeSelectedProfile);
  document.getElementById('closeAllBtn').addEventListener('click', closeAllBrowsers);
  document.getElementById('minimizeBtn').addEventListener('click', minimizeSelected);
  document.getElementById('minimizeAllBtn').addEventListener('click', minimizeAll);
  document.getElementById('showAllBtn').addEventListener('click', showAllBrowsers);
  document.getElementById('refreshAllBtn').addEventListener('click', refreshAllBrowsers);
  document.getElementById('navBackBtn').addEventListener('click', () => navigateProfile(-1));
  document.getElementById('navTopBtn').addEventListener('click', () => navigateProfile(0));
  document.getElementById('navFwdBtn').addEventListener('click', () => navigateProfile(1));
  document.getElementById('cancelProfileBtn').addEventListener('click', cancelProfile);
  document.getElementById('goodBtn').addEventListener('click', () => moveToGroup('Good'));
  document.getElementById('badBtn').addEventListener('click', () => moveToGroup('Bad'));
  document.getElementById('otherBtn').addEventListener('click', () => moveToGroup('Other'));
  document.getElementById('refreshStatsBtn').addEventListener('click', refreshStats);

  // Settings
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('saveHotkeysBtn').addEventListener('click', saveHotkeys);
  document.getElementById('saveServerBtn').addEventListener('click', saveServerSettings);

  // Discord
  document.getElementById('sendQueBtn').addEventListener('click', () => sendScreenshot('que'));
  document.getElementById('sendProdBtn').addEventListener('click', () => sendScreenshot('prod'));
  document.getElementById('saveDiscordBtn').addEventListener('click', saveDiscordSettings);

  // Positioner
  document.getElementById('positionBtn').addEventListener('click', positionWindows);
  document.getElementById('applyZoomBtn').addEventListener('click', applyZoom);
  document.getElementById('openUrlBtn').addEventListener('click', openUrlInBrowsers);
  document.getElementById('savePositionerBtn').addEventListener('click', savePositionerSettings);

  // Hotkey listener
  window.mlm.onHotkey((action) => {
    if (action === 'forward') navigateProfile(1);
    else if (action === 'backward') navigateProfile(-1);
    else if (action === 'top') navigateProfile(0);
    else if (action === 'sortTab') sortProfiles('tab');
    else if (action === 'sortProfile') sortProfiles('name');
  });

  // Start browser detection
  browserDetectInterval = setInterval(detectBrowsers, 2000);
  detectBrowsers();

  // Auto-load tasks if logged in
  if (config.token) {
    document.getElementById('statusText').textContent = config.username ? 'Logged in as ' + config.username : 'Logged in';
    loadTasks();
  }
});

function loadConfigToUI() {
  const hk = config.hotkeys || {};
  document.getElementById('hkForward').value = hk.forward || '';
  document.getElementById('hkBackward').value = hk.backward || '';
  document.getElementById('hkTop').value = hk.top || '';
  document.getElementById('hkSortTab').value = hk.sortTab || '';
  document.getElementById('hkSortProfile').value = hk.sortProfile || '';
  document.getElementById('autoSortingCheck').checked = config.autoSorting !== false;
  document.getElementById('serverUrl').value = config.serverUrl || '';
  document.getElementById('launcherUrl').value = config.launcherUrl || '';
  document.getElementById('discordUsername').value = config.username || '';
  document.getElementById('discordWebhookQue').value = config.discordWebhookQue || '';
  document.getElementById('discordWebhookProd').value = config.discordWebhookProd || '';
  document.getElementById('googleSheetId').value = config.googleSheetId || '';
  const pos = config.positioner || {};
  document.getElementById('posWidth').value = pos.width || 400;
  document.getElementById('posHeight').value = pos.height || 600;
  document.getElementById('posCols').value = pos.cols || 0;
  document.getElementById('posRows').value = pos.rows || 0;
  document.getElementById('posHgap').value = pos.hgap || 10;
  document.getElementById('posVgap').value = pos.vgap || 10;
  document.getElementById('posZoom').value = pos.zoom || 100;
}

// ============ BROWSER DETECTION ============
async function detectBrowsers() {
  try {
    detectedBrowsers = await window.mlm.getBrowsers();
    document.getElementById('runningCount').textContent = '(Running: ' + detectedBrowsers.length + ')';

    // Update profile list items with running status
    profiles.forEach((p, idx) => {
      const el = document.querySelector(`.list-item[data-idx="${idx}"]`);
      if (!el) return;
      const match = detectedBrowsers.find(b => b.title && (b.title.includes(p.profileName) || p.profileName.includes(b.title.split(' - ')[0])));
      const badge = el.querySelector('.item-badge');
      if (match && badge) {
        badge.textContent = 'Running';
        badge.className = 'item-badge badge-running';
      }
    });
  } catch {}
}

// ============ TASKS ============
async function loadTasks() {
  const container = document.getElementById('taskList');
  container.innerHTML = '<div class="empty-msg">Loading...</div>';

  const resp = await window.mlm.getTasks();
  if (!resp.data || resp.status !== 200) {
    container.innerHTML = '<div class="empty-msg">Failed to load tasks. Check login.</div>';
    return;
  }

  const tasks = resp.data.tasks || resp.data || [];
  if (!tasks.length) {
    container.innerHTML = '<div class="empty-msg">No tasks available</div>';
    return;
  }

  container.innerHTML = '';
  tasks.forEach((task, idx) => {
    const div = document.createElement('div');
    div.className = 'list-item' + (task.taskId === currentTaskId ? ' selected' : '');
    div.dataset.idx = idx;
    div.innerHTML = `
      <div>
        <div class="item-title">${task.title || task.taskName || 'Task ' + (idx + 1)}</div>
        <div class="item-sub">${task.date || ''} ${task.assignor ? '— ' + task.assignor : ''}</div>
      </div>
      <span class="item-badge">${task.profileCount || '?'} profiles</span>
    `;
    div.addEventListener('click', () => selectTask(task, div));
    container.appendChild(div);
  });

  document.getElementById('taskDetailBtn').disabled = !currentTaskId;
  document.getElementById('taskWorkBtn').disabled = !currentTaskId;
}

function selectTask(task, el) {
  document.querySelectorAll('#taskList .list-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  currentTaskId = task.taskId || task.id;
  currentWorkgroup = task.workgroup || task.folderId || '';
  document.getElementById('taskDetailBtn').disabled = false;
  document.getElementById('taskWorkBtn').disabled = false;
  document.getElementById('taskInfo').textContent = 'Selected: ' + (task.title || task.taskName) + ' (' + (task.profileCount || '?') + ' profiles)';
}

async function showTaskDetail() {
  if (!currentTaskId) return;
  const resp = await window.mlm.getTaskDetail(currentTaskId);
  alert(JSON.stringify(resp.data, null, 2));
}

function startTask() {
  if (!currentTaskId) return;
  // Switch to profiles tab
  document.querySelector('[data-tab="profiles"]').click();
  fetchProfiles();
}

// ============ PROFILES ============
async function fetchProfiles() {
  if (!currentTaskId) return;
  const amount = parseInt(document.getElementById('profileAmount').value) || 5;
  const container = document.getElementById('profileList');
  container.innerHTML = '<div class="empty-msg">Loading profiles...</div>';

  const resp = await window.mlm.getProfiles(currentTaskId, amount);
  if (!resp.data || resp.status !== 200) {
    container.innerHTML = '<div class="empty-msg">Failed to load profiles</div>';
    return;
  }

  profiles = resp.data.profiles || resp.data || [];
  renderProfiles();
  refreshStats();
}

function renderProfiles() {
  const container = document.getElementById('profileList');
  if (!profiles.length) {
    container.innerHTML = '<div class="empty-msg">No profiles</div>';
    return;
  }

  container.innerHTML = '';
  profiles.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'list-item' + (idx === selectedProfileIdx ? ' selected' : '');
    div.dataset.idx = idx;
    const browser = detectedBrowsers.find(b => b.title && b.title.includes(p.profileName));
    const typeClass = browser ? 'badge-running' : (p.browserType === 'stealthfox' ? 'badge-stealthfox' : 'badge-mimic');
    const typeText = browser ? 'Running' : (p.browserType || 'idle');

    div.innerHTML = `
      <div>
        <div class="item-title">${p.profileName || p.name || 'Profile ' + (idx + 1)}</div>
        <div class="item-sub">${p.profileId || ''}</div>
      </div>
      <span class="item-badge ${typeClass}">${typeText}</span>
    `;
    div.addEventListener('click', () => selectProfile(idx, div));
    div.addEventListener('dblclick', () => { selectProfile(idx, div); showSelectedProfile(); });
    container.appendChild(div);
  });
}

function selectProfile(idx, el) {
  document.querySelectorAll('#profileList .list-item').forEach(i => i.classList.remove('selected'));
  if (el) el.classList.add('selected');
  selectedProfileIdx = idx;
}

async function openSelectedProfile() {
  if (selectedProfileIdx < 0 || !profiles[selectedProfileIdx]) return;
  const p = profiles[selectedProfileIdx];
  const resp = await window.mlm.startProfile(currentWorkgroup, p.profileId);
  if (resp.status === 200) {
    showStatus('profileList', 'Profile launched');
  } else {
    alert('Failed to start profile: ' + JSON.stringify(resp.data));
  }
}

function showSelectedProfile() {
  if (selectedProfileIdx < 0) return;
  const p = profiles[selectedProfileIdx];
  const browser = detectedBrowsers.find(b => b.title && b.title.includes(p.profileName));
  if (browser) window.mlm.focusWindow(browser.id, browser.title);
}

function closeSelectedProfile() {
  if (selectedProfileIdx < 0) return;
  const p = profiles[selectedProfileIdx];
  const browser = detectedBrowsers.find(b => b.title && b.title.includes(p.profileName));
  if (browser) window.mlm.closeWindow(browser.id, browser.title);
}

async function closeAllBrowsers() {
  if (!confirm('Close all browser windows?')) return;
  for (const b of detectedBrowsers) {
    await window.mlm.closeWindow(b.id, b.title);
  }
}

function minimizeSelected() {
  if (selectedProfileIdx < 0) return;
  const p = profiles[selectedProfileIdx];
  const browser = detectedBrowsers.find(b => b.title && b.title.includes(p.profileName));
  if (browser) window.mlm.minimizeWindow(browser.id);
}

async function minimizeAll() {
  for (const b of detectedBrowsers) {
    await window.mlm.minimizeWindow(b.id);
  }
}

async function showAllBrowsers() {
  for (const b of detectedBrowsers) {
    await window.mlm.focusWindow(b.id, b.title);
  }
}

function refreshAllBrowsers() {
  // F5 refresh via hotkey sending would need platform-specific impl
  alert('Refresh All: Use F5 in each browser window');
}

function navigateProfile(direction) {
  if (!profiles.length) return;
  if (direction === 0) {
    selectedProfileIdx = 0;
  } else {
    selectedProfileIdx += direction;
    if (selectedProfileIdx >= profiles.length) selectedProfileIdx = 0;
    if (selectedProfileIdx < 0) selectedProfileIdx = profiles.length - 1;
  }
  renderProfiles();
  showSelectedProfile();
  // Scroll into view
  const el = document.querySelector(`#profileList .list-item[data-idx="${selectedProfileIdx}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function sortProfiles(by) {
  if (by === 'name') {
    profiles.sort((a, b) => (a.profileName || '').localeCompare(b.profileName || ''));
  } else if (by === 'tab') {
    // Sort by browser title
    profiles.sort((a, b) => {
      const ba = detectedBrowsers.find(br => br.title && br.title.includes(a.profileName));
      const bb = detectedBrowsers.find(br => br.title && br.title.includes(b.profileName));
      return (ba?.title || '').localeCompare(bb?.title || '');
    });
  }
  renderProfiles();
}

async function cancelProfile() {
  if (selectedProfileIdx < 0) return;
  const p = profiles[selectedProfileIdx];
  if (!confirm('Remove profile ' + p.profileName + ' from work list?')) return;
  await window.mlm.cancelProfile(currentTaskId, p.profileId);
  profiles.splice(selectedProfileIdx, 1);
  selectedProfileIdx = Math.min(selectedProfileIdx, profiles.length - 1);
  renderProfiles();
}

async function moveToGroup(group) {
  if (selectedProfileIdx < 0) return;
  const p = profiles[selectedProfileIdx];
  await window.mlm.moveToGroup(currentTaskId, [p.profileId], group);
  profiles.splice(selectedProfileIdx, 1);
  selectedProfileIdx = Math.min(selectedProfileIdx, profiles.length - 1);
  renderProfiles();
}

async function refreshStats() {
  if (!currentTaskId) return;
  const resp = await window.mlm.getStatistics(currentTaskId);
  if (resp.data) {
    document.getElementById('statAvailable').textContent = resp.data.available ?? '—';
    document.getElementById('statDone').textContent = resp.data.done ?? '—';
    document.getElementById('statPulled').textContent = resp.data.pulled ?? '—';
  }
}

// ============ SETTINGS ============
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { setStatus('loginStatus', 'Enter email and password', 'error'); return; }

  setStatus('loginStatus', 'Logging in...', '');
  const resp = await window.mlm.login(email, password);
  if (resp.data && resp.data.token) {
    config = await window.mlm.getConfig();
    document.getElementById('statusText').textContent = 'Logged in as ' + (config.username || email);
    setStatus('loginStatus', 'Login successful!', 'success');
    loadTasks();
  } else {
    setStatus('loginStatus', 'Login failed: ' + JSON.stringify(resp.data?.error || resp.data), 'error');
  }
}

async function saveHotkeys() {
  config.hotkeys = {
    forward: document.getElementById('hkForward').value.trim(),
    backward: document.getElementById('hkBackward').value.trim(),
    top: document.getElementById('hkTop').value.trim(),
    sortTab: document.getElementById('hkSortTab').value.trim(),
    sortProfile: document.getElementById('hkSortProfile').value.trim()
  };
  config.autoSorting = document.getElementById('autoSortingCheck').checked;
  await window.mlm.saveConfig(config);
  setStatus('loginStatus', 'Hotkeys saved!', 'success');
}

async function saveServerSettings() {
  config.serverUrl = document.getElementById('serverUrl').value.trim();
  config.launcherUrl = document.getElementById('launcherUrl').value.trim();
  await window.mlm.saveConfig(config);
  setStatus('loginStatus', 'Server settings saved!', 'success');
}

// ============ DISCORD ============
async function sendScreenshot(channel) {
  const statusEl = document.getElementById('discordStatus');
  setStatus('discordStatus', 'Capturing & sending...', '');
  const resp = await window.mlm.sendDiscordScreenshot(channel);
  if (resp.error) {
    setStatus('discordStatus', 'Error: ' + resp.error, 'error');
  } else if (resp.success) {
    setStatus('discordStatus', 'Screenshot sent to ' + channel.toUpperCase() + '!', 'success');
  } else {
    setStatus('discordStatus', 'Failed (status ' + resp.status + ')', 'error');
  }
}

async function saveDiscordSettings() {
  config.username = document.getElementById('discordUsername').value.trim();
  config.discordWebhookQue = document.getElementById('discordWebhookQue').value.trim();
  config.discordWebhookProd = document.getElementById('discordWebhookProd').value.trim();
  config.googleSheetId = document.getElementById('googleSheetId').value.trim();
  await window.mlm.saveConfig(config);
  setStatus('discordStatus', 'Discord settings saved!', 'success');
}

// ============ POSITIONER ============
async function positionWindows() {
  const opts = {
    width: parseInt(document.getElementById('posWidth').value) || 400,
    height: parseInt(document.getElementById('posHeight').value) || 600,
    cols: parseInt(document.getElementById('posCols').value) || 0,
    rows: parseInt(document.getElementById('posRows').value) || 0,
    hgap: parseInt(document.getElementById('posHgap').value) || 10,
    vgap: parseInt(document.getElementById('posVgap').value) || 10
  };
  setStatus('positionerStatus', 'Positioning...', '');
  const result = await window.mlm.positionWindows(opts);
  if (result.error) {
    setStatus('positionerStatus', 'Error: ' + result.error, 'error');
  } else {
    setStatus('positionerStatus', 'Positioned ' + result.count + ' windows (' + result.cols + 'x' + result.rows + ')', 'success');
  }
}

function applyZoom() {
  const zoom = parseInt(document.getElementById('posZoom').value) || 100;
  setStatus('positionerStatus', 'Zoom not yet supported in cross-platform mode', '');
}

async function openUrlInBrowsers() {
  const url = document.getElementById('posUrl').value.trim();
  if (!url) { setStatus('positionerStatus', 'Enter a URL first', 'error'); return; }
  setStatus('positionerStatus', 'Opening URL...', '');
  const result = await window.mlm.openUrlInBrowsers(url);
  if (result.error) {
    setStatus('positionerStatus', 'Error: ' + result.error, 'error');
  } else {
    setStatus('positionerStatus', 'Opened URL in ' + result.count + ' windows', 'success');
  }
}

async function savePositionerSettings() {
  config.positioner = {
    width: parseInt(document.getElementById('posWidth').value) || 400,
    height: parseInt(document.getElementById('posHeight').value) || 600,
    cols: parseInt(document.getElementById('posCols').value) || 0,
    rows: parseInt(document.getElementById('posRows').value) || 0,
    hgap: parseInt(document.getElementById('posHgap').value) || 10,
    vgap: parseInt(document.getElementById('posVgap').value) || 10,
    zoom: parseInt(document.getElementById('posZoom').value) || 100
  };
  await window.mlm.saveConfig(config);
  setStatus('positionerStatus', 'Positioner settings saved!', 'success');
}

// ============ HELPERS ============
function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

function showStatus(containerId, msg) {
  // Brief toast-like status
  console.log(msg);
}
