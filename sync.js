// ===================================================================
// Synchronisation mit OneDrive (Microsoft Graph)
// - Anmeldung mit dem Schulkonto (OAuth 2.0 mit PKCE, ohne Zusatzbibliothek)
// - Daten: <Ordner>/unterrichtsheft-daten.json, Bilder und Dateien: <Ordner>/bilder/<id>
// - Offline wird lokal weitergearbeitet; sobald wieder Internet da ist, werden
//   der Stand im OneDrive und der Stand auf dem Gerät zusammengeführt (Drei-Wege-Abgleich).
// ===================================================================
const SYNC_FILE = 'unterrichtsheft-daten.json';
const SYNC_SCOPES = 'offline_access User.Read Files.ReadWrite';
const syncLS = {
  get(k, d) { try { const v = localStorage.getItem('uh-sync-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v === undefined || v === null) localStorage.removeItem('uh-sync-' + k); else localStorage.setItem('uh-sync-' + k, JSON.stringify(v)); } catch {} }
};
const syncCfg = () => {
  const base = typeof SYNC_CONFIG !== 'undefined' ? SYNC_CONFIG : {};
  const own = syncLS.get('cfg', {});
  return { clientId: own.clientId || base.clientId || '', tenant: own.tenant || base.tenant || 'organizations', folder: (own.folder || base.folder || 'ClaudeCowork/Unterrichtsheft/Daten').replace(/^\/+|\/+$/g, '') };
};
const syncAvailable = () => location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const syncRedirect = () => location.origin + location.pathname.replace(/index\.html$/, '');
let syncStatus = { text: '', cls: '' };
let syncBusy = false, syncAgain = false, syncTimer = null;

function setSyncState(text, cls = '') {
  syncStatus = { text, cls };
  const el = document.getElementById('syncState');
  if (el) { el.textContent = text; el.className = 'sync-state ' + cls; el.hidden = !text; }
  const st = document.getElementById('syncStatusText');
  if (st) st.textContent = text || 'Nicht verbunden';
}

// ---------- Anmeldung ----------
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function randomStr(n = 48) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
async function syncLogin(prompt) {
  const cfg = syncCfg();
  if (!cfg.clientId) { alert('Trage zuerst die Client-ID der App-Registrierung ein.'); return; }
  const verifier = randomStr(48), st = randomStr(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem('uh-pkce', JSON.stringify({ verifier, st }));
  const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: syncRedirect(), response_mode: 'query', scope: SYNC_SCOPES, code_challenge: challenge, code_challenge_method: 'S256', state: st });
  if (prompt) q.set('prompt', prompt);
  location.assign(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/authorize?${q}`);
}
async function tokenRequest(params) {
  const cfg = syncCfg();
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, scope: SYNC_SCOPES, ...params })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || 'Anmeldung fehlgeschlagen'), { code: j.error });
  syncLS.set('tok', { access: j.access_token, refresh: j.refresh_token || (syncLS.get('tok', {}) || {}).refresh, exp: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}
async function syncHandleRedirect() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return;
  const saved = JSON.parse(sessionStorage.getItem('uh-pkce') || 'null');
  history.replaceState(null, '', syncRedirect() + location.hash);
  sessionStorage.removeItem('uh-pkce');
  if (p.has('error')) {
    const msg = p.get('error_description') || p.get('error');
    if (p.get('error') !== 'login_required' && p.get('error') !== 'interaction_required') alert('Anmeldung bei Microsoft nicht möglich:\n' + msg);
    setSyncState('☁ Anmeldung nötig', 'warn');
    return;
  }
  if (!saved || saved.st !== p.get('state')) return;
  try {
    await tokenRequest({ grant_type: 'authorization_code', code: p.get('code'), redirect_uri: syncRedirect(), code_verifier: saved.verifier });
    const me = await graph('https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName').then(r => r.json());
    syncLS.set('account', { name: me.displayName, upn: me.userPrincipalName });
    syncLS.set('on', true);
  } catch (e) { console.error(e); alert('Anmeldung fehlgeschlagen: ' + e.message); }
}
async function syncToken() {
  const t = syncLS.get('tok', null);
  if (!t) throw Object.assign(new Error('nicht angemeldet'), { code: 'login' });
  if (t.access && t.exp > Date.now()) return t.access;
  if (!t.refresh) throw Object.assign(new Error('nicht angemeldet'), { code: 'login' });
  try { return await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }); }
  catch (e) { if (navigator.onLine) syncLS.set('tok', null); throw Object.assign(e, { code: e.code || 'login' }); }
}
function syncLogout() {
  if (!confirm('Synchronisation auf diesem Gerät beenden? Die Daten bleiben auf dem Gerät und im OneDrive erhalten.')) return;
  ['tok', 'account', 'on', 'etag'].forEach(k => syncLS.set(k, null));
  idbDel('kv', 'syncBase').catch(() => {});
  setSyncState('');
  render();
}

// ---------- Microsoft Graph ----------
async function graph(url, opts = {}) {
  const token = await syncToken();
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  if (r.status === 401) { syncLS.set('tok', { ...syncLS.get('tok', {}), exp: 0 }); }
  return r;
}
const gPath = rel => 'https://graph.microsoft.com/v1.0/me/drive/root:/' + encodeURI(syncCfg().folder + '/' + rel);

// ---------- Zusammenführen ----------
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const idList = a => Array.isArray(a) && a.length > 0 && a.every(x => isObj(x) && typeof x.id === 'string');
// b = gemeinsamer Stand der letzten Synchronisation, l = Gerät, r = OneDrive; localWins bei echtem Konflikt
function merge3(b, l, r, localWins) {
  if (same(l, r)) return l;
  if (same(l, b)) return r;
  if (same(r, b)) return l;
  if (l === undefined || r === undefined) {
    // eine Seite hat gelöscht, die andere geändert: Änderung behalten
    return l === undefined ? r : l;
  }
  if (isObj(l) && isObj(r)) {
    const out = {}, bb = isObj(b) ? b : {};
    for (const k of new Set([...Object.keys(r), ...Object.keys(l)])) {
      const v = merge3(bb[k], l[k], r[k], localWins);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if ((idList(l) || Array.isArray(l) && !l.length) && (idList(r) || Array.isArray(r) && !r.length) && (idList(l) || idList(r))) {
    const bm = new Map((Array.isArray(b) ? b : []).filter(isObj).map(x => [x.id, x]));
    const lm = new Map(l.map(x => [x.id, x])), rm = new Map(r.map(x => [x.id, x]));
    const order = [...r.map(x => x.id)];
    l.forEach((x, i) => { if (!rm.has(x.id)) { const prev = i > 0 ? order.indexOf(l[i - 1].id) : -1; order.splice(prev + 1, 0, x.id); } });
    const out = [];
    for (const id of order) {
      const v = merge3(bm.get(id), lm.get(id), rm.get(id), localWins);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  if (Array.isArray(l) && Array.isArray(r) && l.every(x => typeof x !== 'object') && r.every(x => typeof x !== 'object')) {
    // Listen einfacher Werte (z. B. übersprungene Wochen): Hinzugefügtes beider Seiten behalten, Entferntes entfernen
    const bs = new Set(Array.isArray(b) ? b : []);
    const removed = new Set([...bs].filter(x => !l.includes(x) || !r.includes(x)));
    return [...new Set([...r, ...l])].filter(x => !removed.has(x) || (!bs.has(x)));
  }
  return localWins ? l : r;
}
function mergeStates(base, local, remote) {
  const localWins = (local._mtime || 0) >= (remote._mtime || 0);
  const m = merge3(base || undefined, local, remote, localWins);
  m._mtime = Math.max(local._mtime || 0, remote._mtime || 0);
  return m;
}

// ---------- Ablauf ----------
function syncSchedule(delay = 4000) {
  if (!syncLS.get('on', false)) return;
  syncLS.set('dirty', true);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), delay);
}
const userIsEditing = () => {
  const a = document.activeElement;
  return (a && a.closest && a.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) || document.querySelector('dialog[open]') || (typeof ink !== 'undefined' && ink.on);
};
let syncPendingRender = false;
document.addEventListener('focusout', () => setTimeout(() => { if (syncPendingRender && !userIsEditing()) { syncPendingRender = false; render(); } }, 50));

async function syncNow(manual) {
  if (!syncAvailable() || !syncLS.get('on', false)) return;
  if (!navigator.onLine) { setSyncState('☁ Offline, wird später abgeglichen', 'warn'); return; }
  if (syncBusy) { syncAgain = true; return; }
  syncBusy = true; setSyncState('☁ Gleiche ab …', 'busy');
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const startSnap = JSON.stringify(state);
      const local = JSON.parse(startSnap);
      const base = await idbGet('kv', 'syncBase');
      // Stand im OneDrive holen
      const meta = await graph(gPath(SYNC_FILE) + '?$select=eTag,size,lastModifiedDateTime,@microsoft.graph.downloadUrl');
      let remote = null, etag = null;
      if (meta.ok) {
        const mj = await meta.json();
        etag = mj.eTag;
        const unchanged = etag === syncLS.get('etag', null) && base;
        if (unchanged && !syncLS.get('dirty', false)) { await syncImages(); setSyncState('☁ Synchronisiert ' + nowHM(), 'ok'); return; }
        if (unchanged) remote = base; // OneDrive unverändert seit dem letzten Abgleich, nicht neu herunterladen
        else {
          const dl = mj['@microsoft.graph.downloadUrl'];
          const rr = dl ? await fetch(dl) : await graph(gPath(SYNC_FILE) + ':/content');
          const pkg = await rr.json();
          remote = pkg && pkg.app === 'unterrichtsheft' ? pkg.state : null;
        }
      } else if (meta.status !== 404) throw new Error('OneDrive antwortet mit ' + meta.status);

      let merged;
      if (!remote) merged = local;
      else if (!base) {
        // erstes Mal auf diesem Gerät, im OneDrive liegen schon Daten
        const take = confirm('Im OneDrive gibt es bereits Daten des Unterrichtshefts.\n\nOK: Die Daten aus dem OneDrive übernehmen (empfohlen für ein neues Gerät; die Einträge auf diesem Gerät werden ersetzt).\nAbbrechen: Beide Stände zusammenführen.');
        merged = take ? remote : mergeStates({}, local, remote);
      } else merged = mergeStates(base, local, remote);
      merged = migrate(merged);

      // hochladen, wenn das OneDrive nicht schon genau diesen Stand hat
      let newTag = etag;
      if (!remote || !same(merged, remote)) {
        const body = JSON.stringify({ app: 'unterrichtsheft', version: 1, savedAt: new Date().toISOString(), device: navigator.userAgent.slice(0, 120), state: merged });
        const up = await graph(gPath(SYNC_FILE) + ':/content?@microsoft.graph.conflictBehavior=replace', {
          method: 'PUT', headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) }, body
        });
        if (up.status === 412 || up.status === 409) continue; // inzwischen von einem anderen Gerät geändert: nochmals abgleichen
        if (!up.ok) throw new Error('Hochladen fehlgeschlagen (' + up.status + ')');
        newTag = (await up.json()).eTag;
      }

      // während des Abgleichs Getipptes nicht verlieren
      const nowSnap = JSON.stringify(state);
      const changedRemote = !same(merged, local);
      if (nowSnap !== startSnap) { state = mergeStates(local, JSON.parse(nowSnap), merged); syncLS.set('dirty', true); }
      else { state = merged; syncLS.set('dirty', false); }
      await idbPut('kv', 'syncBase', merged);
      syncLS.set('etag', newTag);
      await saveNow();
      if (changedRemote) {
        if (typeof buildOff === 'function') buildOff();
        if (typeof resetUndo === 'function') resetUndo();
        if (userIsEditing()) syncPendingRender = true; else render();
      }
      await syncImages();
      setSyncState('☁ Synchronisiert ' + nowHM(), 'ok');
      if (syncLS.get('dirty', false)) syncAgain = true;
      return;
    }
    throw new Error('Zu viele gleichzeitige Änderungen, später nochmals versuchen');
  } catch (e) {
    console.error(e);
    if (e.code === 'login' || e.code === 'invalid_grant' || e.code === 'interaction_required') setSyncState('☁ Bitte neu anmelden', 'warn');
    else if (!navigator.onLine) setSyncState('☁ Offline, wird später abgeglichen', 'warn');
    else setSyncState('☁ ' + e.message, 'err');
    if (manual) alert('Synchronisation: ' + e.message);
  } finally {
    syncBusy = false;
    if (syncAgain) { syncAgain = false; setTimeout(() => syncNow(), 1500); }
  }
}
const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// Bilder und Dateien: fehlende hochladen und fehlende herunterladen
async function syncImages() {
  try {
    const remote = new Set();
    let url = gPath('bilder') + ':/children?$select=name&$top=999';
    for (;;) {
      const r = await graph(url);
      if (r.status === 404) break;
      if (!r.ok) return;
      const j = await r.json();
      (j.value || []).forEach(x => remote.add(x.name));
      if (!j['@odata.nextLink']) break;
      url = j['@odata.nextLink'];
    }
    const local = new Set((await idbKeys('images')).map(String));
    for (const id of local) {
      if (remote.has(id)) continue;
      const blob = await idbGet('images', id);
      if (!blob) continue;
      const up = await graph(gPath('bilder/' + id) + ':/content', { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
      if (!up.ok) console.warn('Bild nicht hochgeladen', id, up.status);
    }
    let got = 0;
    for (const id of remote) {
      if (local.has(id)) continue;
      const r = await graph(gPath('bilder/' + id) + ':/content');
      if (r.ok) { await idbPut('images', id, await r.blob()); got++; }
    }
    if (got && !userIsEditing()) render();
  } catch (e) { console.warn('Bilder-Abgleich', e); }
}

// ---------- Einstellungen: Abschnitt «Synchronisation» ----------
function syncCardHTML() {
  const cfg = syncCfg(), acc = syncLS.get('account', null), on = syncLS.get('on', false);
  if (!syncAvailable()) return '';
  return `<div class="fs-box"><h3>Automatisch mit Microsoft-Anmeldung</h3>
    <p class="hint">Braucht eine App-Registrierung im Microsoft-Konto der Schule (siehe ANLEITUNG-Synchronisation.md).</p>
    <p>Die Daten liegen im OneDrive im Ordner <b>${esc(cfg.folder)}</b> und werden auf allen angemeldeten Geräten abgeglichen. Ohne Internet arbeitest du normal weiter, der Abgleich folgt, sobald die Verbindung wieder da ist.</p>
    <p class="sync-line"><span>Status:</span> <b id="syncStatusText">${esc(syncStatus.text || (on ? 'Verbunden' : 'Nicht verbunden'))}</b>${acc ? ` · angemeldet als ${esc(acc.name || '')} (${esc(acc.upn || '')})` : ''}</p>
    <div class="btn-row">
      ${on ? `<button type="button" class="btn primary" data-sync="now">Jetzt synchronisieren</button><button type="button" class="btn" data-sync="logout">Abmelden</button>`
        : `<button type="button" class="btn primary" data-sync="login" ${cfg.clientId ? '' : 'disabled'}>Mit Microsoft-Schulkonto anmelden</button>`}
    </div>
    <details class="sync-adv" ${cfg.clientId || on ? '' : ''}><summary>Verbindung einrichten</summary>
      <div class="form-row two">
        <label class="field"><span>Anwendungs-ID (Client-ID)</span><input data-synccfg="clientId" value="${esc(cfg.clientId)}" placeholder="aus der App-Registrierung"></label>
        <label class="field"><span>Verzeichnis-ID (Mandant)</span><input data-synccfg="tenant" value="${esc(cfg.tenant)}" placeholder="organizations"></label>
      </div>
      <label class="field"><span>Ordner im OneDrive</span><input data-synccfg="folder" value="${esc(cfg.folder)}"></label>
      <p class="hint">Umleitungs-URI für die App-Registrierung (Plattform «Single-Page-Anwendung»): <code>${esc(syncRedirect())}</code></p>
    </details></div>`;
}
function syncMountCard() {
  const el = document.getElementById('syncCard');
  if (!el) return;
  el.innerHTML = '<h2>Synchronisation mit OneDrive</h2><p>Damit Laptop, iPad und iPhone mit denselben Daten arbeiten, liegt ein Stand im OneDrive. Änderungen von mehreren Geräten werden zusammengeführt, auch wenn ein Gerät offline war.</p>'
    + (typeof folderCardHTML === 'function' ? folderCardHTML() : '') + syncCardHTML();
  el.onclick = e => {
    if (typeof folderHandleClick === 'function' && folderHandleClick(e)) return;
    const b = e.target.closest('[data-sync]'); if (!b) return;
    if (b.dataset.sync === 'login') syncLogin();
    else if (b.dataset.sync === 'logout') syncLogout();
    else if (b.dataset.sync === 'now') { syncLS.set('dirty', true); syncNow(true); }
  };
  el.onchange = e => {
    if (typeof folderHandleChange === 'function' && folderHandleChange(e)) return;
    const k = e.target.dataset.synccfg; if (!k) return;
    const own = syncLS.get('cfg', {}); own[k] = e.target.value.trim(); syncLS.set('cfg', own);
    syncMountCard();
  };
}

// ---------- Start ----------
let syncStarted = false;
async function syncInit() {
  if (!syncAvailable() || syncStarted) return;
  syncStarted = true;
  await syncHandleRedirect();
  if (!syncLS.get('on', false)) return;
  setSyncState(navigator.onLine ? '☁ Verbunden' : '☁ Offline, wird später abgeglichen', navigator.onLine ? '' : 'warn');
  syncNow();
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setSyncState('☁ Offline, wird später abgeglichen', 'warn'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
}

if (window.__appReady) syncInit();

// App offline verfügbar machen (Service Worker), nur über https
if ('serviceWorker' in navigator && syncAvailable()) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service Worker', e));
