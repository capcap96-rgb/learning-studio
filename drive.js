/* Learning Studio 1.1.0. Tokens remain in memory; cloud records are append-only. */
(function (root) {
  'use strict';
  const CLIENT_ID = '879820634707-nic0kh5l52nuefj3rlag7crun7j8aqsv.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const APP = 'learning-studio-v1';
  const copy = value => JSON.parse(JSON.stringify(value));
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  async function fingerprint(data) {
    const content = copy(data);
    delete content.active; // Selecting a plan is local navigation, not a cloud edit.
    const bytes = new TextEncoder().encode(canonical(content));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }
  function heads(files) {
    const unique = [...new Map(files.map(f => [f.id, f])).values()];
    const ancestors = new Set(unique.flatMap(f => Object.entries(f.appProperties || {}).filter(([k]) => /^parent\d+$/.test(k)).map(([, v]) => v)));
    return unique.filter(f => !ancestors.has(f.id)).sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || '') || a.id.localeCompare(b.id));
  }
  class DriveAPI {
    constructor(token) { this.token = token; }
    async request(url, options = {}) {
      const response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + this.token }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        const error = new Error(response.status === 401 ? 'Google 授權已到期，請重新連接。' : response.status === 403 ? 'Google 拒絕存取。請確認帳號、組織政策、Drive API 與 drive.appdata 權限。' : response.status === 429 ? '同步請求過於頻繁，請稍後重試。' : '雲端連線失敗，請稍後重試；本機紀錄仍保留。');
        error.status = response.status;
        throw error;
      }
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 12 * 1024 * 1024) throw Error('雲端資料超過支援大小，請先保留備份。');
      const text = await response.text();
      if (new TextEncoder().encode(text).length > 12 * 1024 * 1024) throw Error('雲端資料超過支援大小。');
      return JSON.parse(text);
    }
    async account() {
      const result = await this.request('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName)');
      if (!result.user?.permissionId) throw Error('無法確認 Google 帳號，尚未同步任何資料。');
      return result.user;
    }
    async list() {
      let pageToken = '', files = [], seen = new Set();
      do {
        const query = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,incompleteSearch,files(id,createdTime,appProperties,size)', q: "trashed = false and appProperties has { key='app' and value='" + APP + "' } and appProperties has { key='kind' and value='snapshot' }" });
        if (pageToken) query.set('pageToken', pageToken);
        const response = await this.request('https://www.googleapis.com/drive/v3/files?' + query);
        if (response.incompleteSearch) throw Error('雲端版本清單尚未完整，請稍後重試。');
        files.push(...(response.files || []));
        pageToken = response.nextPageToken || '';
        if (pageToken && seen.has(pageToken)) throw Error('雲端清單分頁異常，尚未變更資料。');
        seen.add(pageToken);
      } while (pageToken);
      return files;
    }
    async read(file) {
      if (Number(file.size || 0) > 10 * 1024 * 1024) throw Error('這份雲端紀錄過大，請先匯出備份。');
      const result = await this.request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media');
      if (result.format !== 'learning-studio-drive' || result.schemaVersion !== 1 || !Array.isArray(result.parents)) throw Error('這份雲端資料的格式不相容，未覆蓋本機資料。');
      const expected = Object.entries(file.appProperties || {}).filter(([k]) => /^parent\d+$/.test(k)).map(([, v]) => v).sort();
      if (canonical([...result.parents].sort()) !== canonical(expected)) throw Error('雲端版本資訊不一致，未覆蓋本機資料。');
      return result.data;
    }
    async create(data, parents) {
      if (parents.length > 24) throw Error('同時修改的版本過多，請先下載備份再聯絡協助。');
      const properties = { app: APP, kind: 'snapshot' };
      parents.forEach((value, n) => { properties['parent' + n] = value; });
      const stamp = new Date().toISOString();
      const metadata = { name: 'learning-studio-' + stamp.replace(/[:.]/g, '-') + '.json', mimeType: 'application/json', parents: ['appDataFolder'], appProperties: properties };
      const content = JSON.stringify({ format: 'learning-studio-drive', schemaVersion: 1, appVersion: '1.2.1', createdAt: stamp, parents, data });
      if (new TextEncoder().encode(content).length > 10 * 1024 * 1024) throw Error('資料超過 10MB，請先匯出備份。');
      const boundary = 'learning_' + crypto.randomUUID().replaceAll('-', '');
      const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + content + '\r\n--' + boundary + '--\r\n';
      return this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,createdTime,appProperties,size', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
    }
  }
  class SyncEngine {
    constructor(adapter, api, meta = {}) {
      this.adapter = adapter; this.api = api;
      this.meta = { baseId: '', baseHash: '', lastSync: '', ...meta };
      this.busy = false; this.conflict = null; this.remoteHeads = [];
    }
    async local() { return { data: copy(this.adapter.get()), hash: await fingerprint(this.adapter.get()) }; }
    async acknowledge(file, hash) {
      this.meta = { ...this.meta, baseId: file?.id || '', baseHash: hash, lastSync: new Date().toISOString() };
      await this.adapter.meta(this.meta);
    }
    async discover() {
      const all = await this.api.list();
      const current = heads(all);
      if (all.length && !current.length) throw Error('雲端版本關係異常，未變更任何資料。');
      this.remoteHeads = current;
      return current;
    }
    async run() {
      if (this.busy) return 'busy';
      this.busy = true;
      try {
        this.adapter.guard();
        const local = await this.local(), remote = await this.discover();
        this.conflict = null;
        if (remote.length > 1) return this.stop(remote, '雲端有多個並行版本，請先檢視並選擇。');
        if (!remote.length) {
          if (local.data.plans.length || local.data.tasks.length || Object.keys(local.data.works).length || local.data.sessions.length || local.data.cards.length || local.data.reviews.length) return this.stop(remote, '雲端尚無資料。確認將本機紀錄儲存到目前帳號？');
          return 'empty';
        }
        const file = remote[0], cloud = this.adapter.validate(await this.api.read(file)), cloudHash = await fingerprint(cloud);
        this.adapter.guard();
        if ((await this.local()).hash !== local.hash) throw Error('讀取期間本機有新修改，請再按一次同步。');
        if (cloudHash === local.hash) { await this.acknowledge(file, local.hash); return 'equal'; }
        if (!this.meta.baseId) {
          const empty = !local.data.plans.length && !local.data.tasks.length && !local.data.sessions.length && !local.data.cards.length && !local.data.reviews.length && !Object.keys(local.data.works).length;
          if (empty) return this.pull(file, cloud, local.hash);
          return this.stop(remote, '本機與雲端都有紀錄，請選擇要繼續使用的版本。');
        }
        const localChanged = local.hash !== this.meta.baseHash;
        if (!localChanged) return this.pull(file, cloud, local.hash);
        if (file.id === this.meta.baseId && cloudHash === this.meta.baseHash) return this.push(local.data, local.hash, remote);
        return this.stop(remote, '本機與其他裝置都有修改，已暫停同步，沒有覆蓋資料。');
      } finally { this.busy = false; }
    }
    stop(remote, reason) { this.conflict = { ids: remote.map(f => f.id), reason }; return 'conflict'; }
    async pull(file, cloud, expectedHash) {
      this.adapter.guard();
      if ((await this.local()).hash !== expectedHash) throw Error('讀取期間本機有新修改，請再按一次同步。');
      // adapter.replace backs up and writes synchronously before redrawing.
      this.adapter.replace(copy(cloud));
      await this.acknowledge(file, await fingerprint(cloud));
      return 'pulled';
    }
    async push(data, hash, remote) {
      this.adapter.guard();
      const created = await this.api.create(copy(data), remote.map(f => f.id));
      if (!created?.id) throw Error('雲端未回傳版本 ID，請重新檢查同步狀態。');
      await this.acknowledge(created, hash);
      const current = await this.discover();
      if (current.length !== 1 || current[0].id !== created.id) return this.stop(current, '同步期間另一台裝置也有更新，兩份版本都已保留，請選擇。');
      this.conflict = null;
      return (await this.local()).hash === hash ? 'pushed' : 'pending';
    }
    async resolve(choice) {
      if (this.busy) return 'busy';
      if (!this.conflict) throw Error('請先檢查同步狀態。');
      this.busy = true;
      try {
        this.adapter.guard();
        const original = this.conflict.ids.slice().sort(), current = await this.discover();
        if (canonical(current.map(f => f.id).sort()) !== canonical(original)) return this.stop(current, '雲端又有新版本，請重新檢視後選擇。');
        let local = await this.local();
        if (choice !== 'local') {
          const file = current.find(f => f.id === choice);
          if (!file) throw Error('找不到所選雲端版本。');
          const data = this.adapter.validate(await this.api.read(file));
          this.adapter.guard();
          if ((await this.local()).hash !== local.hash) throw Error('本機有新修改，請重新選擇。');
          this.adapter.replace(copy(data));
          local = await this.local();
        }
        return this.push(local.data, local.hash, current);
      } finally { this.busy = false; }
    }
  }
  const exports = { DriveAPI, SyncEngine, heads, fingerprint, canonical, CLIENT_ID, SCOPE };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.LearningDrive = exports;
})(typeof window === 'undefined' ? globalThis : window);

if (typeof window !== 'undefined') window.createDriveUI = function (bridge) {
  'use strict';
  const { DriveAPI, SyncEngine, CLIENT_ID, SCOPE } = window.LearningDrive;
  const el = selector => document.querySelector(selector), escape = bridge.escape;
  const PREFIX = 'learning-studio-drive-';
  let token = '', expires = 0, user = null, engine = null, status = '尚未連接 Google Drive', error = false;
  let authBusy = false, operation = false, auto = false, timer, expiryTimer, googleReady = false, backups = [];
  let draft = false, accountNotice = '', lastAccount = '';
  try { lastAccount = localStorage.getItem(PREFIX + 'account') || ''; auto = localStorage.getItem(PREFIX + 'auto') === 'true'; } catch {}
  const active = () => token && Date.now() < expires && user && engine;
  const summarize = d => `${d.plans.length} 個計畫 · ${d.tasks.length} 個任務 · ${d.sessions.length} 次練習 · ${d.cards.length} 張卡片 · ${(d.speaking?.logs||[]).filter(l=>!l.deletedAt).length} 次口說打卡`;
  const time = value => value ? new Date(value).toLocaleString('zh-TW') : '尚未同步';
  function guard() {
    bridge.guard();
    if (draft) throw Error('有尚未送出的表單。請先按儲存／新增，或離開該表單後再同步。');
    if (!token || Date.now() >= expires) throw Error('Google 授權已到期，請重新連接。');
  }
  function persistMeta(meta) { localStorage.setItem(PREFIX + user.permissionId, JSON.stringify(meta)); }
  function backupLocal() {
    const list = JSON.parse(localStorage.getItem(PREFIX + 'backups') || '[]');
    list.unshift({ date: new Date().toISOString(), data: bridge.get() });
    localStorage.setItem(PREFIX + 'backups', JSON.stringify(list.slice(0, 3)));
  }
  function notify(message, failed = false) { status = message; error = failed; draw(); }
  function download(data, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function note(result) {
    const messages = { equal: '本機與雲端一致', pulled: '已讀取最新雲端紀錄', pushed: '已同步到 Google Drive', pending: '已上傳；另有新修改待同步', empty: '雲端尚無紀錄，建立計畫後再同步', conflict: engine?.conflict?.reason || '請選擇要繼續使用的版本' };
    notify(messages[result] || '正在同步');
    if (result === 'pending') schedule();
  }
  async function act(callback) {
    if (operation) return;
    operation = true; error = false; status = '正在檢查雲端版本…'; draw();
    try { guard(); const result = await callback(); note(result); }
    catch (e) {
      if (e.status === 401) { token = ''; expires = 0; }
      notify(e.name === 'TimeoutError' || e.name === 'AbortError' ? '雲端連線逾時，本機紀錄仍保留，請稍後重試。' : e.message === 'Failed to fetch' ? '無法連線到 Google，請確認網路後重試。' : e.message, true);
    } finally { operation = false; draw(); }
  }
  async function sync() { if (!engine) return; await act(() => engine.run()); }
  function schedule() {
    clearTimeout(timer);
    if (auto && active() && engine.meta.baseId && !engine.conflict) timer = setTimeout(() => { if (!draft && document.visibilityState === 'visible') sync(); }, 1800);
  }
  function connect() {
    if (authBusy || operation) return;
    if (!googleReady || !window.google?.accounts?.oauth2) return notify('Google 連線元件尚未載入。請確認網路後重新整理。', true);
    if (location.hostname !== 'capcap96-rgb.github.io') return notify('請在 GitHub Pages 正式網站連接 Google Drive；目前網址尚未加入 Google 授權來源。', true);
    if (draft) return notify('請先儲存目前表單，再連接 Google Drive。', true);
    clearTimeout(timer); clearTimeout(expiryTimer);
    token = ''; expires = 0; user = null; engine = null;
    authBusy = true; notify('請在 Google 視窗選擇你的帳號並授權…');
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE, include_granted_scopes: false,
      error_callback: () => { authBusy = false; notify('Google 登入視窗未完成。請允許彈出視窗後再試。', true); },
      callback: async response => {
        authBusy = false;
        if (response.error || !response.access_token || !google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) return notify('尚未授予學習資料空間的權限，本機紀錄沒有變更。', true);
        token = response.access_token; expires = Date.now() + Math.max(0, Number(response.expires_in) - 60) * 1000;
        const api = new DriveAPI(token);
        operation = true; notify('正在確認 Google 帳號…');
        try {
          user = await api.account();
          accountNotice = lastAccount && lastAccount !== user.permissionId ? '這次連接的帳號與上次不同。請確認信箱後，再選擇本機或雲端紀錄。' : '';
          let meta = {};
          try { meta = JSON.parse(localStorage.getItem(PREFIX + user.permissionId) || '{}'); } catch {}
          if (!meta || typeof meta !== 'object' || typeof meta.baseId !== 'string' || typeof meta.baseHash !== 'string') meta = {};
          if (accountNotice) meta = {};
          engine = new SyncEngine({
            get: bridge.get, validate: bridge.validate, guard,
            replace: data => { guard(); backupLocal(); bridge.replace(data); draft = false; },
            meta: persistMeta
          }, api, meta);
          lastAccount = user.permissionId;
          localStorage.setItem(PREFIX + 'account', lastAccount);
          clearTimeout(expiryTimer);
          expiryTimer = setTimeout(() => { token = ''; expires = 0; notify('Google 授權已到期，請重新連接；本機紀錄仍保留。'); }, Math.max(0, expires - Date.now()));
          status = '已連接，正在讀取雲端紀錄…';
        } catch (e) { token = ''; user = null; engine = null; notify(e.message, true); }
        finally { operation = false; draw(); }
        if (active()) await sync();
      }
    });
    client.requestAccessToken({ prompt: 'select_account' });
  }
  function disconnect() {
    if (operation) return;
    clearTimeout(timer); clearTimeout(expiryTimer);
    token = ''; expires = 0; user = null; engine = null; accountNotice = '';
    notify('已中斷本頁連線；本機與雲端紀錄都保留。');
  }
  function panel() {
    const connected = active(), conflict = engine?.conflict, disabled = operation || authBusy;
    return `<div class="row"><div><span class="badge">GOOGLE DRIVE / V1.2.1</span><h2 style="margin-top:12px">跨裝置學習紀錄</h2></div><span class="sync-light ${error ? 'failed' : connected ? 'connected' : ''}">${connected ? '已連接' : '未連接'}</span></div>
      <p class="sync-message ${error ? 'error' : ''}" role="status">${escape(status)}</p>
      ${user ? `<p class="caption">目前帳號：${escape(user.emailAddress || user.displayName)}<br>最後成功同步：${escape(time(engine?.meta.lastSync))}</p>` : '<p class="caption">在每台裝置開啟同一個網站，連接同一個 Google 帳號，即可讀取學習紀錄。重新整理後需再次按「連接 Google Drive」。</p>'}
      ${accountNotice ? `<p class="hint">${escape(accountNotice)}</p>` : ''}
      <div class="toolbar"><button id="drive-connect" class="primary" ${disabled ? 'disabled' : ''}>${connected ? '重新連接／更換帳號' : '連接 Google Drive'}</button><button id="drive-sync" ${!connected || disabled ? 'disabled' : ''}>立即同步</button>${user ? `<button id="drive-disconnect" ${disabled ? 'disabled' : ''}>中斷連線</button>` : ''}</div>
      <label class="sync-auto"><input type="checkbox" id="drive-auto" ${auto ? 'checked' : ''}> 已連線時，儲存後自動同步</label>
      <p class="caption">未勾選時，請在換裝置前按「立即同步」。勾選後只會在本頁開啟且授權有效時同步；不會在關閉網站後執行。</p>
      ${conflict ? `<div class="sync-conflict"><h3>選擇要繼續使用的完整版本</h3><p class="caption">這次不自動合併。選雲端會先保留本機還原備份；選本機會建立新的雲端版本，既有雲端版本仍保留。</p><div class="record"><b>本機版本</b><p class="caption">${escape(summarize(bridge.get()))}</p><button data-resolve="local" ${disabled ? 'disabled' : ''}>${conflict.ids.length ? '以本機版本繼續' : '首次上傳本機紀錄'}</button></div>${engine.remoteHeads.map((f, i) => `<div class="record"><b>雲端版本 ${i + 1}</b><p class="caption">${escape(time(f.createdTime))} · ${escape(f.id.slice(-8))}</p><div class="toolbar"><button data-preview="${escape(f.id)}" ${disabled ? 'disabled' : ''}>下載備份先檢視</button><button data-resolve="${escape(f.id)}" ${disabled ? 'disabled' : ''}>使用這份雲端版本</button></div></div>`).join('')}</div>` : ''}
      <details><summary>同步與資料保存方式</summary><p class="caption">只使用 drive.appdata 權限。資料存入此應用程式專屬的隱藏資料夾，一般 Google Drive 清單不會顯示。每次上傳會保留新版本，暫不自動刪除歷史版本；請持續保留 JSON 備份。存取權杖僅保留在本頁記憶體，不寫入 GitHub 或備份檔。</p><p class="caption">此版本採完整資料快照，適合個人學習。兩台裝置同時修改時，可能需要手動選擇版本；先下載各份備份即可保留內容。</p></details>
      <details id="drive-history"><summary>雲端歷史與本機還原備份</summary><div class="toolbar"><button id="load-history" ${!connected || disabled ? 'disabled' : ''}>讀取雲端歷史</button><button id="local-recovery">下載最近的本機還原備份</button></div><div id="history-items"></div></details>`;
  }
  function draw() {
    const banner = el('#cloud-banner');
    if (banner) { banner.innerHTML = `<span class="${error ? 'error' : ''}">${escape(status)}</span><button type="button">雲端同步 →</button>`; banner.querySelector('button').onclick = () => { location.hash = 'data'; }; }
    const box = el('#drive-panel');
    if (!box) return;
    box.innerHTML = panel();
    el('#drive-connect').onclick = connect;
    el('#drive-sync').onclick = sync;
    el('#drive-disconnect')?.addEventListener('click', disconnect);
    el('#drive-auto').onchange = e => { auto = e.target.checked; try { localStorage.setItem(PREFIX + 'auto', String(auto)); } catch {} if (auto) schedule(); else clearTimeout(timer); };
    box.querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
      const isLocal = b.dataset.resolve === 'local';
      if (!confirm(isLocal ? '確認以目前本機完整資料繼續？既有雲端版本會保留。' : '確認使用這份雲端完整資料？會先保留本機還原備份；尚未合併的內容可從備份取回。')) return;
      await act(() => engine.resolve(b.dataset.resolve));
    });
    box.querySelectorAll('[data-preview]').forEach(b => b.onclick = () => downloadVersion(b.dataset.preview));
    el('#local-recovery').onclick = () => {
      try {
        const list = JSON.parse(localStorage.getItem(PREFIX + 'backups') || '[]');
        if (!list.length) return bridge.toast('目前沒有本機還原備份。');
        const item = list[0]; download(item.data, '學習練習台-還原備份-' + item.date.slice(0, 10) + '.json');
      } catch { bridge.toast('無法讀取本機還原備份。'); }
    };
    el('#load-history').onclick = async () => {
      try {
        guard(); const files = await engine.api.list();
        backups = files.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
        el('#history-items').innerHTML = backups.slice(0, 20).map(f => `<div class="record"><span class="caption">${escape(time(f.createdTime))} · ${escape(f.id.slice(-8))}</span><button data-history="${escape(f.id)}">下載 JSON</button></div>`).join('') || '<p class="caption">尚無雲端歷史。</p>';
        el('#history-items').querySelectorAll('[data-history]').forEach(b => b.onclick = () => downloadVersion(b.dataset.history));
      } catch (e) { bridge.toast(e.message); }
    };
  }
  async function downloadVersion(fileId) {
    try {
      guard(); const file = [...(engine?.remoteHeads || []), ...backups].find(f => f.id === fileId);
      if (!file) throw Error('請重新讀取雲端清單。');
      const data = bridge.validate(await engine.api.read(file));
      download(data, '學習練習台-雲端備份-' + file.id.slice(-8) + '.json');
    } catch (e) { bridge.toast(e.message); }
  }
  const googleScript = document.createElement('script');
  googleScript.src = 'https://accounts.google.com/gsi/client'; googleScript.async = true; googleScript.defer = true;
  googleScript.onload = () => { googleReady = true; draw(); };
  googleScript.onerror = () => notify('Google 連線元件無法載入，仍可使用本機練習與備份。', true);
  document.head.appendChild(googleScript);
  document.addEventListener('input', event => {
    const form = event.target.closest('form');
    if (form && form.id !== 'worksheet') draft = true;
  });
  window.addEventListener('hashchange', () => { draft = false; draw(); });
  window.addEventListener('beforeunload', event => { if (draft) { event.preventDefault(); event.returnValue = ''; } });
  // Poll only while authorized and visible. No token refresh or upload after closing.
  setInterval(() => { if (auto && active() && !operation && !draft && !engine.conflict && document.visibilityState === 'visible') sync(); }, 60000);
  window.addEventListener('online', schedule);
  draw();
  return {
    draw, saved() { const form = document.activeElement?.closest('form'); if (form && form.id !== 'worksheet') draft = false; if (!operation) notify(active() ? '本機已儲存，有變更待同步' : '本機已儲存；連接 Google Drive 後可同步'); schedule(); },
    dirty() { return draft; }, clearDraft() { draft = false; }
  };
};
