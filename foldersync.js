// ===================================================================
// Abgleich über eine Datei im OneDrive-Ordner (ohne Microsoft-Anmeldung)
// - Laptop (Edge/Chrome): die App liest und schreibt die Datei direkt, das OneDrive-Programm lädt sie hoch.
// - iPad/iPhone (Safari): «Aus OneDrive laden» und «In OneDrive speichern» über die Dateien-App.
// Zusammengeführt wird gleich wie bei der automatischen Synchronisation (mergeStates in sync.js).
// ===================================================================
const FS_NAME = 'unterrichtsheft-daten.json';
const fsLS = {
  get(k, d) { try { const v = localStorage.getItem('uh-fs-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v === undefined || v === null) localStorage.removeItem('uh-fs-' + k); else localStorage.setItem('uh-fs-' + k, JSON.stringify(v)); } catch {} }
};
const fsCanWrite = () => typeof window.showSaveFilePicker === 'function';
let fsHandle = null, fsGranted = false, fsBusy = false, fsAgain = false, fsTimer = null;
const fsHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const fsGraphOn = () => typeof syncLS !== 'undefined' && syncLS.get('on', false);

// ---------- Paket lesen und schreiben ----------
async function fsBuildPackage() {
  const images = {};
  for (const k of await idbKeys('images')) { const b = await idbGet('images', k); if (b) images[k] = await blobToDataURL(b); }
  return { app: 'unterrichtsheft', kind: 'sync', savedAt: new Date().toISOString(), state, images };
}
async function fsStoreImages(images) {
  let n = 0;
  const have = new Set((await idbKeys('images')).map(String));
  for (const [k, url] of Object.entries(images || {})) {
    if (have.has(k)) continue;
    try { await idbPut('images', k, await (await fetch(url)).blob()); n++; } catch (e) { console.warn('Bild', k, e); }
  }
  return n;
}
// Stand aus dem OneDrive mit dem Gerät zusammenführen und übernehmen
async function fsApplyRemote(pkg, opts = {}) {
  const remote = pkg && pkg.app === 'unterrichtsheft' && pkg.state ? pkg.state : null;
  if (!remote) throw new Error('Die Datei enthält keine Daten des Unterrichtshefts.');
  const base = await idbGet('kv', 'fsBase');
  const local = JSON.parse(JSON.stringify(state));
  let merged;
  if (!base && !opts.silentFirst) {
    const take = confirm('Im OneDrive liegt bereits ein Stand des Unterrichtshefts.\n\nOK: Diesen Stand übernehmen (empfohlen für ein neues Gerät; die Einträge auf diesem Gerät werden ersetzt).\nAbbrechen: Beide Stände zusammenführen.');
    merged = take ? remote : mergeStates({}, local, remote);
  } else merged = mergeStates(base || {}, local, remote);
  merged = migrate(merged);
  const imgs = await fsStoreImages(pkg.images);
  const changed = !same(merged, local);
  state = merged;
  await saveNow();
  await idbPut('kv', 'fsBase', remote);
  if (changed || imgs) {
    if (typeof buildOff === 'function') buildOff();
    if (typeof resetUndo === 'function') resetUndo();
    if (typeof userIsEditing === 'function' && userIsEditing()) syncPendingRender = true; else render();
  }
  return { changed, sameAsRemote: same(merged, remote) };
}

// ---------- Laptop: Datei direkt im OneDrive-Ordner ----------
async function fsConnect() {
  try {
    const h = await window.showSaveFilePicker({ suggestedName: FS_NAME, types: [{ description: 'Unterrichtsheft-Daten', accept: { 'application/json': ['.json'] } }] });
    fsHandle = h; fsGranted = true;
    await idbPut('kv', 'fsHandle', h);
    fsLS.set('mode', 'file'); fsLS.set('fileName', h.name); fsLS.set('lastMod', null);
    await idbDel('kv', 'fsBase').catch(() => {});
    await fsSyncFile(true);
    fsStart();
  } catch (e) { if (e.name !== 'AbortError') alert('Die Datei konnte nicht verbunden werden: ' + e.message); }
  syncMountCard();
}
async function fsGrant() {
  if (!fsHandle) return;
  try { fsGranted = (await fsHandle.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch { fsGranted = false; }
  if (fsGranted) { await fsSyncFile(); fsStart(); } else fsStatus();
}
async function fsSyncFile(first) {
  if (!fsHandle || !fsGranted) return;
  if (fsBusy) { fsAgain = true; return; }
  fsBusy = true; setSyncState('☁ Gleiche mit OneDrive-Datei ab …', 'busy');
  try {
    const startSnap = JSON.stringify(state);
    const f = await fsHandle.getFile();
    const lastMod = fsLS.get('lastMod', null);
    let needWrite = fsLS.get('dirty', false) || first;
    if (f.size > 0 && (first || f.lastModified !== lastMod)) {
      const pkg = JSON.parse(await f.text());
      const r = await fsApplyRemote(pkg, { silentFirst: false });
      needWrite = needWrite || !r.sameAsRemote;
    } else if (f.size === 0) needWrite = true;
    if (needWrite) {
      if (JSON.stringify(state) !== startSnap) { /* während des Lesens geändert: einfach den aktuellen Stand schreiben */ }
      const pkg = await fsBuildPackage();
      const w = await fsHandle.createWritable();
      await w.write(JSON.stringify(pkg)); await w.close();
      await idbPut('kv', 'fsBase', pkg.state);
      fsLS.set('lastMod', (await fsHandle.getFile()).lastModified);
    }
    fsLS.set('dirty', false);
    fsLS.set('last', fsHM());
    setSyncState('☁ OneDrive-Datei aktuell ' + fsHM(), 'ok');
  } catch (e) {
    console.error(e);
    if (e.name === 'NotAllowedError') { fsGranted = false; fsStatus(); }
    else if (e.name === 'NotFoundError') setSyncState('☁ OneDrive-Datei nicht gefunden, bitte neu verbinden', 'err');
    else setSyncState('☁ ' + e.message, 'err');
  } finally {
    fsBusy = false;
    if (fsAgain) { fsAgain = false; setTimeout(() => fsSyncFile(), 1000); }
  }
}
let fsStarted = false;
function fsStart() {
  if (fsStarted) return; fsStarted = true;
  setInterval(() => { if (document.visibilityState === 'visible') fsSyncFile(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fsSyncFile(); });
}

// ---------- iPad/iPhone: laden und speichern über die Dateien-App ----------
async function fsLoadFromFile(file) {
  try {
    const pkg = JSON.parse(await file.text());
    const r = await fsApplyRemote(pkg);
    fsLS.set('dirty', !r.sameAsRemote);
    fsLS.set('mode', 'manual'); fsLS.set('loaded', fsHM() + ', ' + new Date().toLocaleDateString('de-CH'));
    fsSessionDone = true;
    fsStatus(); fsPrepareSoon();
    setSyncState('☁ Aus OneDrive geladen ' + fsHM(), 'ok');
  } catch (e) { alert('Laden nicht möglich: ' + e.message); }
  syncMountCard();
}
// Datei für das Teilen-Menü im Voraus bereitstellen: Safari öffnet es nur direkt nach dem Tippen
let fsPrepared = null, fsPrepTimer = null;
async function fsPrepare() {
  try {
    const snap = state._mtime || 0;
    const pkg = await fsBuildPackage();
    fsPrepared = { mtime: snap, file: new File([JSON.stringify(pkg)], FS_NAME, { type: 'application/json' }) };
  } catch (e) { console.warn('Vorbereiten', e); }
}
function fsPrepareSoon() { clearTimeout(fsPrepTimer); fsPrepTimer = setTimeout(fsPrepare, 1200); }
async function fsSaveToOneDrive() {
  let file;
  if (fsPrepared && fsPrepared.mtime === (state._mtime || 0)) file = fsPrepared.file;
  else { const pkg = await fsBuildPackage(); file = new File([JSON.stringify(pkg)], FS_NAME, { type: 'application/json' }); }
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Unterrichtsheft-Daten' });
    else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = FS_NAME;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }
    fsLS.set('mode', 'manual'); fsLS.set('dirty', false); fsLS.set('saved', fsHM() + ', ' + new Date().toLocaleDateString('de-CH'));
    fsSessionDone = true;
  } catch (e) { if (e.name !== 'AbortError') alert('Speichern nicht möglich: ' + e.message); }
  fsStatus(); syncMountCard();
}

// ---------- Anzeige ----------
function fsStatus() {
  if (fsGraphOn()) return;
  const mode = fsLS.get('mode', null);
  if (mode === 'file') {
    if (!fsHandle) return;
    if (!fsGranted) setSyncState('☁ Tippen, um die OneDrive-Datei freizugeben', 'warn');
  } else if (mode === 'manual') {
    if (fsLS.get('dirty', false)) setSyncState('☁ Änderungen noch nicht im OneDrive', 'warn');
    else if (fsSessionDone) setSyncState('☁ Stand wie im OneDrive', 'ok');
    else setSyncState('');
  }
  fsQuickRender();
}
// Schnellknöpfe oben (iPad/iPhone): «Laden» zu Beginn, «Speichern» bei ungespeicherten Änderungen
let fsSessionDone = false;
function fsQuickRender() {
  const el = document.getElementById('fsQuick');
  if (!el) return;
  const manual = !fsGraphOn() && fsLS.get('mode', null) === 'manual' && !fsCanWrite();
  if (!manual) { el.innerHTML = ''; el.hidden = true; return; }
  const dirty = fsLS.get('dirty', false);
  el.hidden = false;
  el.innerHTML = (!fsSessionDone ? `<label class="btn small fsq-load" title="Neusten Stand aus dem OneDrive holen">☁ Laden<input type="file" accept="application/json,.json" hidden data-fsquickload></label>` : '')
    + (dirty ? `<button type="button" class="btn small primary fsq-save" data-fsquick="save" title="Änderungen ins OneDrive speichern">☁ Speichern</button>` : '');
}
document.addEventListener('click', e => { if (e.target.closest('[data-fsquick="save"]')) fsSaveToOneDrive(); });
document.addEventListener('change', e => { if (e.target.matches('[data-fsquickload]') && e.target.files[0]) fsLoadFromFile(e.target.files[0]); });
function folderOnSave() {
  if (fsGraphOn() || !fsLS.get('mode', null)) return;
  fsLS.set('dirty', true);
  if (fsLS.get('mode') === 'file' && fsHandle && fsGranted) { clearTimeout(fsTimer); fsTimer = setTimeout(() => fsSyncFile(), 4000); }
  else { fsStatus(); fsPrepareSoon(); }
}
function folderCardHTML() {
  if (fsGraphOn()) return '';
  const mode = fsLS.get('mode', null);
  const where = '<b>OneDrive › ClaudeCowork › Unterrichtsheft › Daten</b>';
  let body;
  if (fsCanWrite()) {
    body = mode === 'file' && fsHandle
      ? `<p class="sync-line"><span>Verbunden mit:</span> <b>${esc(fsLS.get('fileName', FS_NAME))}</b>${fsLS.get('last', '') ? ` · zuletzt abgeglichen ${esc(fsLS.get('last', ''))}` : ''}</p>
         <div class="btn-row">${fsGranted ? '<button type="button" class="btn primary" data-fsync="now">Jetzt abgleichen</button>' : '<button type="button" class="btn primary" data-fsync="grant">Zugriff auf die Datei erlauben</button>'}
         <button type="button" class="btn" data-fsync="connect">Andere Datei wählen</button><button type="button" class="btn" data-fsync="off">Trennen</button></div>`
      : `<p>Wähle einmal den Ordner ${where} und speichere dort die Datei <b>${FS_NAME}</b> (gibt es sie schon, wähle sie und bestätige «Ersetzen»; die App liest sie zuerst und führt zusammen).</p>
         <div class="btn-row"><button type="button" class="btn primary" data-fsync="connect">OneDrive-Datei verbinden</button></div>`;
  } else {
    body = `<p>Auf diesem Gerät geht der Abgleich in zwei Schritten über die Dateien-App:</p>
      <ol class="fs-steps"><li><b>Vor dem Arbeiten:</b> «Aus OneDrive laden», dann in der Dateien-App ${where} › <b>${FS_NAME}</b> wählen.</li>
      <li><b>Nach dem Arbeiten:</b> «In OneDrive speichern», im Teilen-Menü «In Dateien sichern», denselben Ordner wählen und die Datei <b>ersetzen</b>.</li></ol>
      <p class="sync-line">${fsLS.get('loaded', '') ? `<span>Zuletzt geladen:</span> ${esc(fsLS.get('loaded', ''))}` : ''}${fsLS.get('saved', '') ? ` · <span>zuletzt gespeichert:</span> ${esc(fsLS.get('saved', ''))}` : ''}${fsLS.get('dirty', false) ? ' · <b class="warn-txt">Änderungen noch nicht gespeichert</b>' : ''}</p>
      <div class="btn-row"><label class="btn primary">Aus OneDrive laden<input type="file" accept="application/json,.json" hidden data-fsload></label>
      <button type="button" class="btn primary" data-fsync="save">In OneDrive speichern</button></div>`;
  }
  return `<div class="fs-box"><h3>Abgleich über den OneDrive-Ordner</h3>
    <p class="hint">Funktioniert ohne Microsoft-Anmeldung. Bilder und Dateien sind in der Datendatei enthalten.</p>${body}</div>`;
}
function folderHandleClick(e) {
  const b = e.target.closest('[data-fsync]'); if (!b) return false;
  const a = b.dataset.fsync;
  if (a === 'connect') fsConnect();
  else if (a === 'grant') fsGrant().then(syncMountCard);
  else if (a === 'now') { fsLS.set('dirty', true); fsSyncFile().then(syncMountCard); }
  else if (a === 'save') fsSaveToOneDrive();
  else if (a === 'off') {
    if (!confirm('Verbindung zur OneDrive-Datei trennen? Die Daten bleiben auf dem Gerät und in der Datei erhalten.')) return true;
    fsHandle = null; fsGranted = false; ['mode', 'fileName', 'lastMod', 'dirty', 'last'].forEach(k => fsLS.set(k, null));
    idbDel('kv', 'fsHandle').catch(() => {}); idbDel('kv', 'fsBase').catch(() => {});
    setSyncState(''); syncMountCard();
  }
  return true;
}
function folderHandleChange(e) {
  if (!e.target.matches('[data-fsload]')) return false;
  const f = e.target.files && e.target.files[0];
  if (f) fsLoadFromFile(f);
  return true;
}
// Klick auf die Statusanzeige oben: Freigabe holen oder zu den Einstellungen
document.addEventListener('click', e => {
  if (!e.target.closest('#syncState')) return;
  if (fsLS.get('mode') === 'file' && fsHandle && !fsGranted) { fsGrant(); return; }
  currentView = 'settings'; render();
  setTimeout(() => document.getElementById('syncCard')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
});

// ---------- Start ----------
let fsInitDone = false;
async function folderInit() {
  if (fsInitDone || fsGraphOn()) return;
  fsInitDone = true;
  const mode = fsLS.get('mode', null);
  if (mode === 'file' && fsCanWrite()) {
    try { fsHandle = await idbGet('kv', 'fsHandle'); } catch { fsHandle = null; }
    if (fsHandle) {
      try { fsGranted = (await fsHandle.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch { fsGranted = false; }
      if (fsGranted) { await fsSyncFile(); fsStart(); } else fsStatus();
    }
  } else { fsStatus(); if (fsLS.get('mode', null) === 'manual') fsPrepareSoon(); }
}
if (window.__appReady) folderInit();
