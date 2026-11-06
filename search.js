// ===================================================================
// Suche über das ganze Unterrichtsheft (Lupe in der Kopfzeile, Ctrl+K)
// Durchsucht Lektionen, Pinnwand, Tagesnotizen, Hausaufgaben, Anmerkungen zur Woche, Termine,
// CoWork-Besprechungen, Besprechungen am Mittag, Präsenznachmittage, Aufgaben und Jahresplanung.
// ===================================================================
const searchDlg = document.createElement('dialog');
searchDlg.className = 'search-dlg';
searchDlg.setAttribute('aria-label', 'Suche');
document.body.appendChild(searchDlg);
let searchQ = '', searchFilter = 'all';

const SEARCH_KINDS = [['all', 'Alles'], ['lesson', 'Lektionen'], ['note', 'Notizen & HA'], ['event', 'Termine'], ['cowork', 'CoWork'], ['todo', 'Aufgaben']];
const sNorm = t => String(t || '').replace(/<[^>]+>/g, ' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function searchCollect() {
  const out = [], add = (kind, date, title, text, go, color) => out.push({ kind, date: date || '', title, text: String(text || '').replace(/<[^>]+>/g, ' '), go, color });
  // Lektionen
  for (const [key, l] of Object.entries(state.lessons || {})) {
    const [di, sid] = key.split('|');
    const sub = subj(l.subjectId || state.settings.timetable[(dayIdx(di) + 1) + '-' + sid]);
    const sl = state.settings.slots.find(x => x.id === sid);
    const parts = [['', l.title], ['Lernziele', l.goals], ['Ablauf', l.flow], ['Material', l.material], ['HA', l.homework], ['Reflexion', l.reflection]];
    add('lesson', di, (sub ? (sub.short || sub.name) + ': ' : '') + (l.title || 'Lektion') + (sl ? ' · ' + sl.from : ''), parts.filter(p => p[1]).map(p => (p[0] ? p[0] + ': ' : '') + p[1]).join(' · '), { lesson: key }, sub && sub.color);
  }
  // Tagesnotizen und Hausaufgaben
  for (const [di, list] of Object.entries(state.dayTasks || {})) for (const t of list) add('note', di, 'Notiz', t.text, { week: di });
  for (const [di, list] of Object.entries(state.dayHomework || {})) for (const t of list) add('note', di, 'Hausaufgabe', t.text, { week: di });
  for (const [mk, t] of Object.entries(state.weekNotes || {})) add('note', mk, 'Anmerkungen zur Woche', t, { week: mk });
  // Termine, Präsenz
  for (const e of state.events || []) add('event', e.date, (e.time ? e.time + ' ' : '') + e.title, e.note, { agenda: true });
  for (const p of state.presence || []) add('event', p.date, 'Präsenz: ' + p.title, p.note, { pres: p.id, week: p.date }, presCat(p.cat).bg);
  // CoWork und Besprechungen am Mittag
  for (const m of state.meetings || []) {
    const g = cwGroup(m.group);
    add('cowork', m.date, g.name + (m.title ? ': ' + m.title : ''), [m.place, (m.agenda || []).map(a => a.text).join(' · '), m.notes].filter(Boolean).join(' · '), { cowork: m.id }, g.color);
  }
  for (const [k, d] of Object.entries(state.meetDetails || {})) {
    const [pid, di] = k.split('|'), p = (state.placements || []).find(x => x.id === pid);
    add('cowork', di, (p && p.meeting ? p.meeting.title : 'Besprechung'), [d.agenda, d.observe].filter(Boolean).join(' · '), { week: di });
  }
  // Pinnwand
  for (const n of state.stickies || []) if ((n.text || '').trim()) add('note', '', 'Pinnwand', n.text, { agenda: true }, n.color);
  // Aufgaben
  for (const t of state.todos || []) add('todo', t.due || t.week || '', (t.done ? '✓ ' : '') + t.text, t.meetTitle || '', { agenda: true });
  // Jahresplanung: Themen pro Woche
  for (const [mk, yp] of Object.entries(state.yearplan || {})) for (const [sid, txt] of Object.entries(yp || {})) {
    const sub = subj(sid); if (!txt) continue;
    add('note', mk, 'Jahresplanung' + (sub ? ' ' + (sub.short || sub.name) : ''), txt, { week: mk }, sub && sub.color);
  }
  return out;
}
function searchRun() {
  const words = sNorm(searchQ).split(/\s+/).filter(w => w.length > 0);
  if (!words.length || sNorm(searchQ).trim().length < 2) return null;
  return searchCollect()
    .filter(r => searchFilter === 'all' || r.kind === searchFilter)
    .filter(r => { const hay = sNorm(r.title + ' ' + r.text); return words.every(w => hay.includes(w)); });
}
function sMark(text, max) {
  // Ausschnitt um den ersten Treffer, Suchwörter hervorgehoben
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  const words = sNorm(searchQ).split(/\s+/).filter(Boolean);
  if (max && t.length > max) {
    const n = sNorm(t), i = Math.min(...words.map(w => { const k = n.indexOf(w); return k < 0 ? Infinity : k; }));
    const start = isFinite(i) ? Math.max(0, i - 40) : 0;
    t = (start > 0 ? '… ' : '') + t.slice(start, start + max) + (start + max < t.length ? ' …' : '');
  }
  let html = esc(t);
  for (const w of words) {
    if (!w) continue;
    // Treffer ohne Rücksicht auf Akzente: Zeichen für Zeichen vergleichen
    const src = html, n = sNorm(src); let res = '', pos = 0, k;
    while ((k = n.indexOf(w, pos)) >= 0) { res += src.slice(pos, k) + '<mark>' + src.slice(k, k + w.length) + '</mark>'; pos = k + w.length; }
    html = res + src.slice(pos);
  }
  return html;
}
function searchResultsHTML() {
  const res = searchRun();
  if (res === null) return '<p class="muted search-hint">Mindestens zwei Zeichen eingeben. Mehrere Wörter grenzen die Suche ein.</p>';
  if (!res.length) return '<p class="muted search-hint">Nichts gefunden.</p>';
  const today = iso(new Date());
  const up = res.filter(r => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = res.filter(r => r.date && r.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const nod = res.filter(r => !r.date);
  const kindName = Object.fromEntries(SEARCH_KINDS);
  const item = (r, i) => `<li><button type="button" class="search-hit" data-hit="${i}" style="--sc:${r.color || '#bf9000'}">
      <span class="sh-date">${r.date ? `${DAYS7[parse(r.date).getDay()]} ${fmtShort(parse(r.date))}${parse(r.date).getFullYear()}` : 'ohne Datum'}</span>
      <span class="sh-main"><b>${sMark(r.title, 120)}</b>${r.text ? `<small>${sMark(r.text, 160)}</small>` : ''}</span>
      <span class="sh-kind">${esc(kindName[r.kind] || '')}</span></button></li>`;
  searchHits = [...up, ...past, ...nod];
  let i = 0;
  const block = (h, list) => list.length ? `<h4>${h} (${list.length})</h4><ul class="search-list">${list.map(r => item(r, i++)).join('')}</ul>` : '';
  return `<p class="muted search-count">${res.length} ${res.length === 1 ? 'Treffer' : 'Treffer'}</p>`
    + block('Heute und später', up) + block('Vergangen', past) + block('Ohne Datum', nod);
}
let searchHits = [];
function searchRender(keepFocus) {
  const box = searchDlg.querySelector('.search-results');
  if (box) { box.innerHTML = searchResultsHTML(); return; }
  searchDlg.innerHTML = `<div class="search-head">
      <span class="search-ico" aria-hidden="true">${SEARCH_ICON}</span>
      <input type="text" class="search-input" enterkeyhint="search" placeholder="Suchen: Thema, Termin, Notiz, Name eines Anlasses …" value="${esc(searchQ)}" aria-label="Suchbegriff" autocomplete="off">
      <button type="button" class="icon-btn" data-sclose aria-label="Suche schliessen">✕</button>
    </div>
    <div class="search-filter">${SEARCH_KINDS.map(([k, n]) => `<button type="button" class="tag ${searchFilter === k ? 'on' : ''}" data-sfilter="${k}">${n}</button>`).join('')}</div>
    <div class="search-results">${searchResultsHTML()}</div>`;
}
const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
function searchOpen() {
  searchDlg.innerHTML = '';
  searchRender();
  if (!searchDlg.open) searchDlg.showModal();
  const inp = searchDlg.querySelector('.search-input'); inp.focus(); inp.select();
}
function searchGo(r) {
  searchDlg.close();
  const g = r.go;
  if (g.lesson) { currentView = 'week'; currentMonday = monday(parse(g.lesson.split('|')[0])); render(); window.scrollTo(0, 0); openLesson(g.lesson); return; }
  if (g.cowork) { cwOpen = g.cowork; currentView = 'cowork'; render(); window.scrollTo(0, 0); return; }
  if (g.agenda) { currentView = 'agenda'; render(); window.scrollTo(0, 0); return; }
  if (g.week) { currentView = 'week'; currentMonday = monday(parse(g.week)); render(); window.scrollTo(0, 0); if (g.pres) openPresEdit(g.pres); }
}
let searchTimer = null;
searchDlg.addEventListener('input', e => {
  if (!e.target.matches('.search-input')) return;
  searchQ = e.target.value;
  clearTimeout(searchTimer); searchTimer = setTimeout(() => searchRender(), 120);
});
searchDlg.addEventListener('click', e => {
  if (e.target === searchDlg || e.target.closest('[data-sclose]')) { searchDlg.close(); return; }
  const f = e.target.closest('[data-sfilter]');
  if (f) { searchFilter = f.dataset.sfilter; searchDlg.querySelectorAll('[data-sfilter]').forEach(b => b.classList.toggle('on', b === f)); searchRender(); searchDlg.querySelector('.search-input').focus(); return; }
  const h = e.target.closest('[data-hit]');
  if (h) searchGo(searchHits[Number(h.dataset.hit)]);
});
searchDlg.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); searchDlg.close(); return; }
  if (e.key === 'Enter' && e.target.matches('.search-input') && searchHits.length && searchRun()) { e.preventDefault(); searchGo(searchHits[0]); }
  if (e.key === 'ArrowDown' && e.target.matches('.search-input')) { e.preventDefault(); searchDlg.querySelector('[data-hit]')?.focus(); }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchOpen(); }
});
// Lupe in der Kopfzeile
(function mountSearchButton() {
  const bar = document.querySelector('.topbar .topbar-state') || document.querySelector('.topbar');
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'search-btn'; b.id = 'searchBtn';
  b.title = 'Suchen (Ctrl+K)'; b.setAttribute('aria-label', 'Suchen');
  b.innerHTML = SEARCH_ICON;
  b.addEventListener('click', searchOpen);
  bar.parentNode.insertBefore(b, bar);
})();
