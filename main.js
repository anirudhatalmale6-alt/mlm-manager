const { app, BrowserWindow, ipcMain, globalShortcut, screen, desktopCapturer, dialog } = require('electron');
const path = require('path');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');

const CONFIG_FILE = path.join(app.getPath('userData'), 'mlm-config.json');

let mainWindow;
let config = loadConfig();

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {}
  return {
    serverUrl: 'http://3.131.54.37:3000',
    launcherUrl: 'https://launcher.mlx.yt:45001',
    token: '',
    username: '',
    discordWebhookQue: '',
    discordWebhookProd: '',
    googleSheetId: '',
    hotkeys: {
      forward: 'CommandOrControl+Shift+Right',
      backward: 'CommandOrControl+Shift+Left',
      top: 'CommandOrControl+Shift+Up',
      sortTab: 'CommandOrControl+Shift+T',
      sortProfile: 'CommandOrControl+Shift+P'
    },
    positioner: { width: 400, height: 600, cols: 0, rows: 0, hgap: 10, vgap: 10, zoom: 100 },
    autoSorting: true,
    injectControls: false,
    windowBounds: { width: 420, height: 750 }
  };
}

function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) {}
}

function createWindow() {
  const bounds = config.windowBounds || { width: 420, height: 750 };
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 400,
    minHeight: 600,
    title: 'MLM Manager',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.on('resize', () => {
    const [w, h] = mainWindow.getSize();
    config.windowBounds = { width: w, height: h };
    saveConfig();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  registerHotkeys();
});
app.on('window-all-closed', () => app.quit());

// ============ HOTKEYS ============
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = config.hotkeys || {};
  try {
    if (hk.forward) globalShortcut.register(hk.forward, () => mainWindow?.webContents.send('hotkey', 'forward'));
    if (hk.backward) globalShortcut.register(hk.backward, () => mainWindow?.webContents.send('hotkey', 'backward'));
    if (hk.top) globalShortcut.register(hk.top, () => mainWindow?.webContents.send('hotkey', 'top'));
    if (hk.sortTab) globalShortcut.register(hk.sortTab, () => mainWindow?.webContents.send('hotkey', 'sortTab'));
    if (hk.sortProfile) globalShortcut.register(hk.sortProfile, () => mainWindow?.webContents.send('hotkey', 'sortProfile'));
  } catch (e) {
    console.log('Hotkey registration error:', e.message);
  }
}

// ============ IPC HANDLERS ============

ipcMain.handle('get-config', () => config);
ipcMain.handle('save-config', (_, newConfig) => { Object.assign(config, newConfig); saveConfig(); registerHotkeys(); return true; });

// HTTP request helper
function apiRequest(url, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : http;
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      rejectUnauthorized: false,
      timeout: 15000
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Auth
ipcMain.handle('api-login', async (_, email, password) => {
  try {
    const resp = await apiRequest(config.serverUrl + '/api/auth/login', 'POST', { email, password });
    if (resp.data && resp.data.token) {
      config.token = resp.data.token;
      config.username = resp.data.firstName || '';
      saveConfig();
    }
    return resp;
  } catch (e) { return { status: 0, data: { error: e.message } }; }
});

// Tasks
ipcMain.handle('api-get-tasks', async () => {
  try {
    return await apiRequest(config.serverUrl + '/api/tasks/getTaskList', 'GET', null, { Authorization: 'Bearer ' + config.token });
  } catch (e) { return { status: 0, data: { error: e.message } }; }
});

ipcMain.handle('api-get-task-detail', async (_, taskId) => {
  try {
    return await apiRequest(config.serverUrl + '/api/tasks/getTaskDetail?taskId=' + taskId, 'GET', null, { Authorization: 'Bearer ' + config.token });
  } catch (e) { return { status: 0, data: { error: e.message } }; }
});

// Profiles
ipcMain.handle('api-get-profiles', async (_, taskId, amount) => {
  try {
    return await apiRequest(config.serverUrl + '/api/tasks/getProfileList?taskId=' + taskId + '&amount=' + amount, 'GET', null, { Authorization: 'Bearer ' + config.token });
  } catch (e) { return { status: 0, data: { error: e.message } }; }
});

ipcMain.handle('api-get-statistics', async (_, taskId) => {
  try {
    return await apiRequest(config.serverUrl + '/api/tasks/getStatistics?taskId=' + taskId, 'GET', null, { Authorization: 'Bearer ' + config.token });
  } catch (e) { return { status: 0, data: { error: e.message } }; }
});

ipcMain.handle('api-start-profile', async (_, workgroup, profileId) => {
  try {
    // Get access token for launcher
    const tokenResp = await apiRequest(config.serverUrl + '/api/browsers/getAccessToken', 'GET', null, { Authorization: 'Bearer ' + config.token });
    const accessToken = tokenResp.data?.token || config.token;

    // Check agent readiness
    try {
      await apiRequest(config.launcherUrl + '/api/v1/version');
    } catch {
      return { status: 0, data: { error: 'Multilogin Agent not running. Start the agent first.' } };
    }

    // Start profile
    const resp = await apiRequest(
      config.launcherUrl + '/api/v1/profile/f/' + workgroup + '/p/' + profileId + '/start?automation_type=selenium&headless_mode=false',
      'GET', null, { Authorization: 'Bearer ' + accessToken }
    );
    return resp;
  } catch (e) { return { status: 0, data: { error: e.message } }; }
});

ipcMain.handle('api-cancel-profile', async (_, taskId, profileId) => {
  try {
    return await apiRequest(config.serverUrl + '/api/tasks/cancelProfile', 'POST', { taskId, profileId }, { Authorization: 'Bearer ' + config.token });
  } catch (e) { return { status: 0, data: { error: e.message } }; }
});

ipcMain.handle('api-move-to-group', async (_, taskId, profileIds, group) => {
  try {
    return await apiRequest(config.serverUrl + '/api/browsers/moveToGroup', 'POST', { taskId, profileIds, group }, { Authorization: 'Bearer ' + config.token });
  } catch (e) { return { status: 0, data: { error: e.message } }; }
});

// ============ WINDOW MANAGEMENT (cross-platform) ============

function getOpenBrowsers() {
  const platform = process.platform;
  const browsers = [];

  try {
    if (platform === 'darwin') {
      // macOS — use AppleScript
      const script = `
        tell application "System Events"
          set windowList to {}
          repeat with proc in (every process whose background only is false)
            set procName to name of proc
            if procName contains "Stealthfox" or procName contains "Mimic" or procName contains "Multilogin" then
              repeat with win in (every window of proc)
                set winTitle to name of win
                set winPos to position of win
                set winSize to size of win
                set end of windowList to procName & "|||" & winTitle & "|||" & (item 1 of winPos as text) & "," & (item 2 of winPos as text) & "|||" & (item 1 of winSize as text) & "," & (item 2 of winSize as text)
              end repeat
            end if
          end repeat
          return windowList as text
        end tell`;
      const output = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf8', timeout: 5000 }).trim();
      if (output) {
        output.split(', ').forEach((line, idx) => {
          const parts = line.split('|||');
          if (parts.length >= 2) {
            const pos = parts[2] ? parts[2].split(',') : ['0', '0'];
            const size = parts[3] ? parts[3].split(',') : ['0', '0'];
            browsers.push({
              id: idx,
              process: parts[0],
              title: parts[1],
              type: parts[0].toLowerCase().includes('stealthfox') ? 'stealthfox' : 'mimic',
              x: parseInt(pos[0]) || 0,
              y: parseInt(pos[1]) || 0,
              width: parseInt(size[0]) || 0,
              height: parseInt(size[1]) || 0
            });
          }
        });
      }
    } else {
      // Windows — use PowerShell
      const ps = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.Text;
          public class WinAPI {
            [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
            [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
            [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
            [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
            [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
            public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
            public struct RECT { public int Left, Top, Right, Bottom; }
          }
"@
        $results = @()
        [WinAPI]::EnumWindows({
          param($hwnd, $lParam)
          if ([WinAPI]::IsWindowVisible($hwnd)) {
            $title = New-Object System.Text.StringBuilder 256
            $class = New-Object System.Text.StringBuilder 256
            [WinAPI]::GetWindowText($hwnd, $title, 256)
            [WinAPI]::GetClassName($hwnd, $class, 256)
            $t = $title.ToString(); $c = $class.ToString()
            if (($t -match "Stealthfox$" -and $c -eq "MozillaWindowClass") -or ($t -match "Mimic$" -and $c -eq "Chrome_WidgetWin_1")) {
              $rect = New-Object WinAPI+RECT
              [WinAPI]::GetWindowRect($hwnd, [ref]$rect)
              $script:results += "$hwnd|||$t|||$c|||$($rect.Left),$($rect.Top)|||$($rect.Right - $rect.Left),$($rect.Bottom - $rect.Top)"
            }
          }
          return $true
        }, [IntPtr]::Zero)
        $results -join ":::"`;
      const output = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { encoding: 'utf8', timeout: 8000 }).trim();
      if (output) {
        output.split(':::').forEach(line => {
          const parts = line.split('|||');
          if (parts.length >= 3) {
            const pos = parts[3] ? parts[3].split(',') : ['0', '0'];
            const size = parts[4] ? parts[4].split(',') : ['0', '0'];
            browsers.push({
              id: parts[0],
              title: parts[1],
              className: parts[2],
              type: parts[2] === 'MozillaWindowClass' ? 'stealthfox' : 'mimic',
              x: parseInt(pos[0]) || 0,
              y: parseInt(pos[1]) || 0,
              width: parseInt(size[0]) || 0,
              height: parseInt(size[1]) || 0
            });
          }
        });
      }
    }
  } catch (e) {
    console.log('Browser detection error:', e.message);
  }

  return browsers;
}

ipcMain.handle('get-browsers', () => getOpenBrowsers());

ipcMain.handle('focus-window', (_, browserId, title) => {
  try {
    if (process.platform === 'darwin') {
      const safeTitle = title.replace(/"/g, '\\"');
      execSync(`osascript -e 'tell application "System Events" to set frontmost of (first process whose name contains "Stealthfox" or name contains "Mimic") to true'`, { timeout: 3000 });
    } else {
      execSync(`powershell -NoProfile -Command "[void][System.Runtime.InteropServices.Marshal]::GetObjectForIUnknown((New-Object -ComObject Shell.Application).Windows().Item(0).HWND); Add-Type -Name WA -Namespace Win -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'; [Win.WA]::SetForegroundWindow([IntPtr]${browserId})"`, { timeout: 3000 });
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('minimize-window', (_, browserId) => {
  try {
    if (process.platform === 'darwin') {
      execSync(`osascript -e 'tell application "System Events" to set miniaturized of window 1 of (first process whose name contains "Stealthfox" or name contains "Mimic") to true'`, { timeout: 3000 });
    } else {
      execSync(`powershell -NoProfile -Command "Add-Type -Name WM -Namespace Win -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'; [Win.WM]::ShowWindow([IntPtr]${browserId}, 6)"`, { timeout: 3000 });
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('close-window', (_, browserId, title) => {
  try {
    if (process.platform === 'darwin') {
      const safeTitle = (title || '').replace(/'/g, "'\"'\"'");
      execSync(`osascript -e 'tell application "System Events" to close (first window of (first process whose name contains "Stealthfox" or name contains "Mimic") whose name is "${safeTitle}")'`, { timeout: 3000 });
    } else {
      execSync(`powershell -NoProfile -Command "Add-Type -Name WC -Namespace Win -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);'; [Win.WC]::SendMessage([IntPtr]${browserId}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)"`, { timeout: 3000 });
    }
    return true;
  } catch { return false; }
});

// Position all browser windows in grid
ipcMain.handle('position-windows', (_, opts) => {
  try {
    const browsers = getOpenBrowsers();
    if (browsers.length === 0) return { count: 0 };

    const w = opts.width || 400;
    const h = opts.height || 600;
    const hgap = opts.hgap || 10;
    const vgap = opts.vgap || 10;
    let cols = opts.cols || 0;
    let rows = opts.rows || 0;

    if (cols === 0 && rows === 0) {
      cols = Math.ceil(Math.sqrt(browsers.length));
      rows = Math.ceil(browsers.length / cols);
    } else if (cols === 0) {
      cols = Math.ceil(browsers.length / rows);
    } else if (rows === 0) {
      rows = Math.ceil(browsers.length / cols);
    }

    browsers.forEach((browser, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = col * (w + hgap);
      const y = row * (h + vgap);

      if (process.platform === 'darwin') {
        const safeTitle = (browser.title || '').replace(/'/g, "'\"'\"'");
        try {
          execSync(`osascript -e '
            tell application "System Events"
              repeat with proc in (every process whose background only is false)
                if name of proc contains "Stealthfox" or name of proc contains "Mimic" then
                  repeat with win in (every window of proc)
                    if name of win is "${safeTitle}" then
                      set position of win to {${x}, ${y}}
                      set size of win to {${w}, ${h}}
                    end if
                  end repeat
                end if
              end repeat
            end tell'`, { timeout: 3000 });
        } catch {}
      } else {
        try {
          execSync(`powershell -NoProfile -Command "Add-Type -Name WP -Namespace Win -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);'; [Win.WP]::MoveWindow([IntPtr]${browser.id}, ${x}, ${y}, ${w}, ${h}, $true)"`, { timeout: 3000 });
        } catch {}
      }
    });

    return { count: browsers.length, cols, rows };
  } catch (e) { return { error: e.message }; }
});

// Discord screenshot
ipcMain.handle('send-discord-screenshot', async (_, channel) => {
  try {
    const webhook = channel === 'que' ? config.discordWebhookQue : config.discordWebhookProd;
    if (!webhook) return { error: 'No Discord webhook configured for ' + channel };

    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    if (!sources.length) return { error: 'No screen source found' };

    const screenshot = sources[0].thumbnail.toPNG();
    const boundary = '----FormBoundary' + Date.now();
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n${config.username || 'MLM'} - Screenshot ${new Date().toLocaleString()}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="screenshot.png"\r\nContent-Type: image/png\r\n\r\n`),
      screenshot,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const urlObj = new URL(webhook);
    return new Promise((resolve) => {
      const req = https.request({
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': payload.length }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, success: res.statusCode < 300 }));
      });
      req.on('error', e => resolve({ error: e.message }));
      req.write(payload);
      req.end();
    });
  } catch (e) { return { error: e.message }; }
});

// Open URL in all browsers (sends keyboard shortcut)
ipcMain.handle('open-url-in-browsers', (_, url) => {
  try {
    const browsers = getOpenBrowsers();
    browsers.forEach(browser => {
      if (process.platform === 'darwin') {
        try {
          execSync(`osascript -e '
            tell application "System Events"
              repeat with proc in (every process whose background only is false)
                if name of proc contains "Stealthfox" or name of proc contains "Mimic" then
                  repeat with win in (every window of proc)
                    if name of win is "${(browser.title || '').replace(/"/g, '\\"')}" then
                      set frontmost of proc to true
                      keystroke "l" using command down
                      delay 0.2
                      keystroke "a" using command down
                      keystroke "${url.replace(/"/g, '\\"')}"
                      key code 36
                    end if
                  end repeat
                end if
              end repeat
            end tell'`, { timeout: 5000 });
        } catch {}
      } else {
        try {
          execSync(`powershell -NoProfile -Command "
            Add-Type -Name WU -Namespace Win -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern bool SetForegroundWindow(IntPtr hWnd);';
            [Win.WU]::SetForegroundWindow([IntPtr]${browser.id});
            Start-Sleep -Milliseconds 200;
            Add-Type -AssemblyName System.Windows.Forms;
            [System.Windows.Forms.SendKeys]::SendWait('^l');
            Start-Sleep -Milliseconds 200;
            [System.Windows.Forms.SendKeys]::SendWait('^a');
            [System.Windows.Forms.SendKeys]::SendWait('${url.replace(/'/g, "''")}');
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');"`, { timeout: 5000 });
        } catch {}
      }
    });
    return { count: browsers.length };
  } catch (e) { return { error: e.message }; }
});
