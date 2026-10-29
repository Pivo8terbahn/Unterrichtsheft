'use strict';
/* Unterrichtsheft – Prototyp
   Alle Daten liegen lokal im Browser (IndexedDB). Keine Internetverbindung nötig. */

// ---------- Speicher (IndexedDB) ----------
const DB_NAME = 'unterrichtsheft';
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images'); // Bilder und Dateien
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbReq(store, mode, op) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = op(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
const idbGet = (s, k) => idbReq(s, 'readonly', st => st.get(k));
const idbPut = (s, k, v) => idbReq(s, 'readwrite', st => st.put(v, k));
const idbDel = (s, k) => idbReq(s, 'readwrite', st => st.delete(k));
const idbClear = s => idbReq(s, 'readwrite', st => st.clear());
const idbKeys = s => idbReq(s, 'readonly', st => st.getAllKeys());

// ---------- Hilfsfunktionen ----------
const $ = sel => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); };
const fmtShort = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
const mins = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const dayIdx = di => (parse(di).getDay() + 6) % 7; // 0 = Montag
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
const DAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DAYS7 = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}
const byDateTime = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
function autosize(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
const autosizeAll = root => root.querySelectorAll('textarea').forEach(autosize);

// ---------- Datenmodell ----------
const DEFAULT_HOLIDAYS = {
  '2026-10-05': 'Herbstferien', '2026-10-12': 'Herbstferien',
  '2026-12-21': 'Weihnachtsferien', '2026-12-28': 'Weihnachtsferien',
  '2027-02-08': 'Sportferien', '2027-02-15': 'Sportferien',
  '2027-04-19': 'Frühlingsferien', '2027-04-26': 'Frühlingsferien'
};
function defaultBadges() {
  return [
    ['Pausenaufsicht', 'bilder/pausenaufsicht.jpg'], ['Meeting U-Team', 'bilder/meeting-u-team.jpg'],
    ['Meeting Herti-Team', 'bilder/meeting-herti-team.jpg'], ['Schwimmunterricht', 'bilder/schwimmunterricht.jpg'],
    ['ZAZ/IP', 'bilder/zaz-ip.jpg']
  ].map(([name, src]) => ({ id: uid(), name, src }));
}
const SHORTS = { 'Deutsch': 'D', 'Mathematik': 'M', 'NMG': 'NMG', 'Englisch': 'E', 'TTG': 'TG', 'TG': 'TG', 'Musik': 'MU', 'Medien und Informatik': 'MI', 'Bildnerisches Gestalten': 'BG', 'Bewegung und Sport': 'BS' };
const shortFor = name => SHORTS[name] || String(name || '').slice(0, 3);
// Fach am Anfang einer Hausaufgabe erkennen, z. B. «E: Wörter lernen» → Englisch
const HA_ALIASES = { MA: 'Mathematik', DE: 'Deutsch', EN: 'Englisch', ENG: 'Englisch', MU: 'Musik', TTG: 'TTG', TG: 'TTG', MI: 'Medien und Informatik' };
function haSubject(text) {
  const m = /^\s*([A-Za-zÄÖÜäöü&]{1,12})\s*:/.exec(text || '');
  if (!m) return null;
  const k = m[1].toLowerCase(), subs = state.settings.subjects;
  return subs.find(x => (x.short || '').toLowerCase() === k) || subs.find(x => x.name.toLowerCase() === k)
    || subs.find(x => x.name === HA_ALIASES[m[1].toUpperCase()]) || null;
}
const haStyle = text => { const sb = haSubject(text); return sb ? `style="--hac:${sb.color}"` : ''; };
const DEFAULT_SLOTS = [
  ['08:00', '08:30'], ['08:30', '09:15'], ['09:15', '10:00'], ['10:30', '11:15'],
  ['11:15', '12:00'], ['14:00', '14:45'], ['14:45', '15:30']
];
function defaults() {
  const subjects = [
    ['Deutsch', '#d93b3b'], ['Mathematik', '#2f6fd6'], ['NMG', '#2e9b57'], ['Englisch', '#d6a300'],
    ['TTG', '#e57c23'], ['Musik', '#159e9e'], ['Medien und Informatik', '#7b5cd6'],
    ['Bildnerisches Gestalten', '#d14f9b'], ['Bewegung und Sport', '#56708f']
  ].map(([name, color]) => ({ id: uid(), name, short: shortFor(name), color }));
  const slots = DEFAULT_SLOTS.map(([from, to]) => ({ id: uid(), from, to }));
  return {
    version: 4,
    settings: {
      className: '4. Klasse', start: '2026-08-17', end: '2027-07-02', subjects, slots, timetable: {},
      calendarYear: '2026/27', holidays: {}, schoolForced: [], extraOff: { '2026-09-29': 'Michaelstag' },
      cowork: defaultCowork(), badges: defaultBadges(), birthdays: [],
      me: { name: '' }, partner: { name: '', email: '', phone: '', note: '', color: '#8e6bd8' }, who: {}
    },
    yearplan: {}, weekNotes: {}, weekMeta: {}, daySpecial: {}, dayTasks: {}, dayHomework: {}, shopping: [], gameRoll: {}, meetDetails: {}, ink: {}, lessons: {}, placements: [], events: [], todos: [],
    presence: typeof PRESENCE_2627 !== 'undefined' ? PRESENCE_2627.map(x => ({ ...x })) : [],
    meetings: [],
    fixed: typeof SWIM_2627 !== 'undefined' ? SWIM_2627.map(x => ({ ...x })) : [],
    _seedMeeting: true
  };
}
function migrate(s) {
  const d = defaults();
  const out = Object.assign({}, d, s);
  out.settings = Object.assign({}, d.settings, s.settings || {});
  const st = out.settings;
  if (Array.isArray(st.holidays)) st.holidays = st.holidays.length ? Object.fromEntries(st.holidays.map(k => [k, 'Ferien'])) : { ...DEFAULT_HOLIDAYS };
  if (!s.version || s.version < 2) {
    if (!s.settings || s.settings.end === '2027-07-09') st.end = '2027-07-02';
  }
  if (!s.version || s.version < 3) {
    st.subjects.forEach(x => { if (!x.short) x.short = shortFor(x.name); });
    // alte Standardzeiten durch die Zeiten aus dem OneNote-Heft ersetzen, solange noch kein Stundenplan existiert
    const oldDefault = st.slots.length === 7 && st.slots[0].to === '08:45' && st.slots[1].from === '08:50';
    if (oldDefault && !Object.keys(st.timetable).length) st.slots = d.settings.slots;
    // früheres Wochen-Special auf den Montag übertragen
    for (const [mk, m] of Object.entries(out.weekMeta || {})) {
      if (m.special) { out.daySpecial[mk] = out.daySpecial[mk] || m.special; delete m.special; }
    }
  }
  for (const [mk, m] of Object.entries(out.weekMeta || {})) {
    const extra = [m.subtitle, m.category].filter(x => x && x.trim()).join(' · ');
    if (extra && !(out.weekNotes[mk] || '').includes(extra)) out.weekNotes[mk] = [extra, out.weekNotes[mk]].filter(Boolean).join('\n');
  }
  out.weekMeta = {};
  // frühere, aus OneNote abgeleitete Ferienwochen durch den kantonalen Ferienplan ersetzen
  if (!st.calendarYear) {
    st.calendarYear = '2026/27';
    const same = Object.keys(st.holidays || {}).every(k => k in DEFAULT_HOLIDAYS);
    if (same) st.holidays = {};
  }
  st.schoolForced = st.schoolForced || [];
  if (!st.extraOff) st.extraOff = { '2026-09-29': 'Michaelstag' };
  if (!s.presence) out.presence = typeof PRESENCE_2627 !== 'undefined' ? PRESENCE_2627.map(x => ({ ...x })) : [];
  if (!st.cowork) st.cowork = defaultCowork();
  if (!out.meetings) out.meetings = [];
  if (!out.dayHomework) out.dayHomework = {};
  if (!out.shopping) out.shopping = [];
  if (!out.gameRoll) out.gameRoll = {};
  if (!out.meetDetails) out.meetDetails = {};
  if (!out.ink) out.ink = {};
  // Fächer BG und BS einmalig ergänzen (danach in den Einstellungen frei änderbar oder löschbar)
  out.imports = out.imports || {};
  if (!out.imports.subjBGBS && out.settings && out.settings.subjects) {
    for (const [name, color] of [['Bildnerisches Gestalten', '#d14f9b'], ['Bewegung und Sport', '#56708f']])
      if (!out.settings.subjects.some(x => x.name === name || x.short === SHORTS[name])) out.settings.subjects.push({ id: uid(), name, short: SHORTS[name], color });
    out.imports.subjBGBS = true;
  }
  if (!out.fixed) out.fixed = typeof SWIM_2627 !== 'undefined' ? SWIM_2627.map(x => ({ ...x })) : [];
  st.me = Object.assign({ name: '' }, st.me || {});
  st.partner = Object.assign({}, d.settings.partner, st.partner || {});
  st.who = st.who || {};
  if (!s.version || s.version < 4) {
    // fehlende Lektion 11.15–12.00 ergänzen (Mittag beginnt erst um 12.00)
    const i = st.slots.findIndex(x => x.to === '11:15');
    if (i >= 0 && !st.slots.some(x => x.from === '11:15')) st.slots.splice(i + 1, 0, { id: uid(), from: '11:15', to: '12:00' });
    // wöchentliche Besprechung mit der SHP am Dienstagmittag
    if (!(out.placements || []).some(p => p.meeting)) {
      const noon = st.slots.find(x => x.to === '12:00');
      if (noon) out.placements.push({ id: uid(), meeting: { title: 'Besprechung SHP', time: '' }, pos: 'p:' + noon.id, repeat: true, day: 2, from: iso(monday(parse(st.start))), skip: [] });
    }
  }
  delete out._seedMeeting;
  out.version = 4;
  return out;
}
let state;
const thisPlanningWeek = () => { const t = new Date(); return monday([0, 6].includes(t.getDay()) ? addDays(t, 2) : t); };
let currentView = 'week';
let currentMonday = thisPlanningWeek();
let openLessonKey = null;
let scrollYearToNow = false;
let ttFilter = 'all';
const subj = id => state.settings.subjects.find(x => x.id === id);
const badge = id => state.settings.badges.find(x => x.id === id);
const sjLabel = () => `SJ${state.settings.start.slice(2, 4)}/${state.settings.end.slice(2, 4)}`;

function schoolWeeks() {
  const out = [];
  const end = parse(state.settings.end);
  for (let m = monday(parse(state.settings.start)); m <= end; m = addDays(m, 7)) out.push(m);
  return out;
}
function schoolWeekNumber(mk) {
  let n = 0;
  for (const m of schoolWeeks()) {
    const k = iso(m);
    const hol = !!weekHoliday(k);
    if (!hol) n++;
    if (k === mk) return hol ? 0 : n;
  }
  return 0;
}
// Reihenfolge im Wochenraster: Lektionen und automatisch erkannte Pausen
function weekRows() {
  const out = [], sl = state.settings.slots;
  sl.forEach((s, i) => {
    out.push({ type: 'slot', slot: s });
    const n = sl[i + 1];
    if (n && s.to && n.from) {
      const gap = mins(n.from) - mins(s.to);
      if (gap >= 50) out.push({ type: 'break', kind: 'mittag', pos: 'p:' + s.id });
      else if (gap >= 10) out.push({ type: 'break', kind: 'pause', pos: 'p:' + s.id });
    }
  });
  return out;
}
function posLabel(pos) {
  if (pos === 'tag') return 'ganzer Tag';
  if (pos.startsWith('pres:')) return 'Präsenz ' + (PRES_BLOCKS[pos.slice(5)] || '');
  if (pos.startsWith('p:')) {
    const r = weekRows().find(x => x.pos === pos);
    return r && r.kind === 'mittag' ? 'Mittag' : 'Pause';
  }
  const sl = state.settings.slots.find(x => x.id === pos);
  return sl ? `Lektion ${sl.from}` : '';
}



// ---------- Feste Zeitfenster (z. B. Schwimmunterricht) ----------
// Einträge mit eigener Zeit, die unabhängig vom Lektionsraster über die Zeilen gelegt werden
// Position im Tag: Abstand ab Beginn der ersten Lektion und Höhe, in Einheiten von Lektion, Pause und Pixel
function timeOffset(t) {
  const rows = weekRows(), m = mins(t);
  let cell = 0, brk = 0, px = 0;
  for (const r of rows) {
    if (r.type === 'slot') {
      const a = mins(r.slot.from), b = mins(r.slot.to), f = Number(slotFactor(r.slot));
      if (m <= a) break;
      if (m < b) { cell += f * (m - a) / (b - a); break; }
      cell += f; px += 1;
    } else {
      const prev = state.settings.slots.find(x => 'p:' + x.id === r.pos), next = rows[rows.indexOf(r) + 1];
      if (next && next.type === 'slot' && m < mins(next.slot.from)) { brk += Math.max(0, Math.min(1, (m - mins(prev.to)) / (mins(next.slot.from) - mins(prev.to)))); break; }
      brk += 1; px += 1;
    }
  }
  return { cell, brk, px };
}
function fixedHTML(di) {
  return (state.fixed || []).filter(x => x.date === di).map(x => {
    const a = timeOffset(x.from), b = timeOffset(x.to);
    const top = `calc(var(--headh) + var(--tasksh) + var(--hwh) + var(--cellh) * ${a.cell.toFixed(3)} + var(--brkh) * ${a.brk.toFixed(3)} + ${a.px}px)`;
    const h = `calc(var(--cellh) * ${(b.cell - a.cell).toFixed(3)} + var(--brkh) * ${(b.brk - a.brk).toFixed(3)} + ${b.px - a.px}px)`;
    return `<div class="fixed-ev" role="button" tabindex="0" data-fixed="${x.id}" style="top:${top};height:${h};--fx:${x.color || '#cfe8fa'}" title="${x.from.replace(':', '.')}–${x.to.replace(':', '.')} Uhr ${esc(x.title)}"><b>${x.from.replace(':', '.')}–${x.to.replace(':', '.')}</b> ${esc(x.title)}${x.note ? `<small>${esc(x.note)}</small>` : ''}</div>`;
  }).join('');
}
function openFixedEdit(id) {
  const x = state.fixed.find(f => f.id === id);
  if (!x) return;
  pickCtx = { fixedId: id };
  pick.innerHTML = `<form method="dialog" class="pick">
    <h2>${esc(x.title)}</h2>
    <div class="form-row col" style="margin-top:12px">
      <label class="field"><span>Bezeichnung</span><input name="ftitle" value="${esc(x.title)}"></label>
      <div class="form-row">
        <label class="field"><span>Datum</span><input type="date" name="fdate" value="${x.date}"></label>
        <label class="field narrow"><span>von</span><input type="time" name="ffrom" value="${x.from}"></label>
        <label class="field narrow"><span>bis</span><input type="time" name="fto" value="${x.to}"></label>
      </div>
      <label class="field"><span>Ergänzung</span><input name="fnote" value="${esc(x.note || '')}" placeholder="z. B. Badesachen mitnehmen"></label>
    </div>
    <div class="pick-foot">
      <span class="btn-row"><button type="button" class="btn danger small" data-fxdel="one">Löschen</button><button type="button" class="btn danger small" data-fxdel="all">Alle «${esc(x.title)}» löschen</button></span>
      <span class="btn-row"><button class="btn" value="cancel">Abbrechen</button><button type="button" class="btn primary" data-fxsave>Speichern</button></span>
    </div>
  </form>`;
  pick.showModal();
}


// ---------- CoWork: Zusammenarbeit ----------
const defaultCowork = () => ({ utMembers: '', shp: { name: '', email: '' }, groups: [{ id: uid(), name: 'Team-Event', members: '' }, { id: uid(), name: 'ELO (Erweiterte Lernorte)', members: '' }] });
const GROUP_COLORS = ['#c05621', '#2f855a', '#b7791f', '#2b6cb0', '#97266d', '#285e61'];
function cwGroups() {
  const c = state.settings.cowork;
  return [
    { id: 'ut', name: 'U-Team', long: 'Unterrichtsteam', color: '#0070c0', emails: c.utMembers },
    { id: 'partner', name: partnerName(), long: 'Pensenpartnerin', color: state.settings.partner.color || '#8e6bd8', emails: state.settings.partner.email },
    { id: 'shp', name: 'SHP' + (c.shp.name ? ' ' + c.shp.name : ''), long: 'Schulische Heilpädagogin', color: '#7030a0', emails: c.shp.email },
    ...c.groups.map((g, i) => ({ id: g.id, name: g.name, long: 'Arbeitsgruppe', color: GROUP_COLORS[i % GROUP_COLORS.length], emails: g.members }))
  ];
}
const cwGroup = id => cwGroups().find(g => g.id === id) || { id, name: 'Gruppe', long: '', color: '#888', emails: '' };
// Farbiges Label einer Aufgabe: selbst gewählt, sonst die Gruppe der CoWork-Besprechung, aus der sie stammt
function todoGroupId(t) {
  if (t.group !== undefined) return t.group;
  const m = t.meeting && state.meetings.find(x => x.id === t.meeting);
  return m ? m.group : '';
}
function todoLabelSelect(t, gs) {
  const gid = todoGroupId(t), g = gid ? gs.find(x => x.id === gid) : null;
  return `<select class="tag lbl-select ${g ? 'cw' : ''}" data-todogroup="${t.id}" ${g ? `style="--gc:${g.color}"` : ''} aria-label="Label der Aufgabe" title="Label wählen">
    <option value="">${g ? 'kein Label' : '+ Label'}</option>
    ${gs.map(x => `<option value="${x.id}" ${x.id === gid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
  </select>`;
}
// U-Team-Sitzungen kommen aus den Präsenznachmittagen (Art «Unterrichtsteam»)
function syncUtMeetings() {
  const ms = state.meetings;
  for (const p of state.presence || []) {
    if (p.cat !== 'ut') continue;
    let m = ms.find(x => x.presId === p.id);
    if (!m) { m = { id: uid(), group: 'ut', presId: p.id, place: '', agenda: [], notes: '' }; ms.push(m); }
    m.date = p.date; m.time = PRES_BLOCKS[p.block]; m.title = p.title;
  }
  state.meetings = ms.filter(m => !m.presId || (state.presence || []).some(p => p.id === m.presId && p.cat === 'ut') || (m.agenda.length || m.notes) && (delete m.presId, true));
}
const fmtLong = d => `${DAYS_LONG[(parse(d).getDay() + 6) % 7]}, ${fmtShort(parse(d))}${parse(d).getFullYear()}`;
function meetingTime(m) { return m.end ? `${m.time}–${m.end}` : (m.time || ''); }

// ---------- Präsenznachmittage Schule Herti ----------
// Quelle: «Planung Präsenznachmittage Herti, Schuljahr 26-27», Schulleitung Herti, 05.06.2026 (Seiten 1 und 2)
const PRES_BLOCKS = { A: '13.30–15.00', B: '15.05–16.30', AB: '13.30–16.30' };
const PRES_CATS = {
  ut: { name: 'Unterrichtsteam', bg: '#0070c0', fg: '#fff' },
  ht: { name: 'Hertiteam', bg: '#ff0000', fg: '#fff' },
  zaz: { name: 'ZAZ / IP', bg: '#00b050', fg: '#fff' },
  team: { name: 'Teamsitzung / Fachteam', bg: '#7030a0', fg: '#fff' },
  srt: { name: 'Stufenrundtisch', bg: '#002060', fg: '#fff' },
  wit: { name: 'WiT (Weiterbildung)', bg: '#f8cbad', fg: '#222' },
  other: { name: 'Gespräche / Weiteres', bg: '#ffffff', fg: '#222' },
  frei: { name: 'unterrichtsfrei', bg: '#ffffff', fg: '#222' }
};
const presCat = c => PRES_CATS[c] || PRES_CATS.frei;
const PRES_ICONS = { ut: 'bilder/meeting-u-team.jpg', ht: 'bilder/meeting-herti-team.jpg', zaz: 'bilder/zaz-ip.jpg' };
const presItem = p => `<span class="pres-item" role="button" tabindex="0" data-pres="${p.id}" style="--pb:${presCat(p.cat).bg};--pf:${presCat(p.cat).fg}" title="${esc(PRES_BLOCKS[p.block])} ${esc(p.title)}${p.note ? ' – ' + esc(p.note) : ''}">${PRES_ICONS[p.cat] ? `<img class="pres-icon" src="${PRES_ICONS[p.cat]}" alt="">` : ''}<span class="pres-txt"><b class="pres-t">${PRES_BLOCKS[p.block]} Uhr</b>${esc(p.title)}${p.note ? `<small>${esc(p.note)}</small>` : ''}</span>${p.cat === 'ut' && meetingFor(p) && meetingFor(p).agenda.length ? `<em>${meetingFor(p).agenda.length} Traktanden</em>` : ''}</span>`;
const meetingFor = p => (state.meetings || []).find(m => m.presId === p.id);

// ---------- Ferienplan Kanton Zug ----------
// Quelle: «Schulferien 2026/27 bis 2030/31», Amt für gemeindliche Schulen Kanton Zug, 28. Mai 2026 (zg.ch/schulferien)
// Ferien: erster und letzter Ferientag. Feiertage: zusätzlich schulfreie Tage im ganzen Kanton.
const ZG_CALENDAR = {
  '2026/27': { start: '2026-08-17', summer: '2027-07-03',
    ferien: [['Herbstferien', '2026-10-03', '2026-10-18'], ['Weihnachtsferien', '2026-12-19', '2027-01-03'], ['Sportferien', '2027-02-06', '2027-02-21'], ['Frühlingsferien', '2027-04-17', '2027-05-02'], ['Auffahrtsferien', '2027-05-06', '2027-05-09']],
    feiertage: [['Mariä Empfängnis', '2026-12-08'], ['Karfreitag', '2027-03-26'], ['Ostermontag', '2027-03-29'], ['Pfingstmontag', '2027-05-17'], ['Fronleichnam', '2027-05-27']] },
  '2027/28': { start: '2027-08-16', summer: '2028-07-08',
    ferien: [['Herbstferien', '2027-10-02', '2027-10-17'], ['Weihnachtsferien', '2027-12-23', '2028-01-05'], ['Sportferien', '2028-02-05', '2028-02-20'], ['Frühlingsferien', '2028-04-15', '2028-04-30'], ['Auffahrtsferien', '2028-05-25', '2028-05-28']],
    feiertage: [['Allerheiligen', '2027-11-01'], ['Mariä Empfängnis', '2027-12-08'], ['Karfreitag', '2028-04-14'], ['Pfingstmontag', '2028-06-05'], ['Fronleichnam', '2028-06-15']] },
  '2028/29': { start: '2028-08-21', summer: '2029-07-07',
    ferien: [['Herbstferien', '2028-10-07', '2028-10-22'], ['Weihnachtsferien', '2028-12-23', '2029-01-07'], ['Sportferien', '2029-02-03', '2029-02-18'], ['Frühlingsferien', '2029-04-14', '2029-04-29'], ['Auffahrtsferien', '2029-05-10', '2029-05-13']],
    feiertage: [['Allerheiligen', '2028-11-01'], ['Mariä Empfängnis', '2028-12-08'], ['Karfreitag', '2029-03-30'], ['Ostermontag', '2029-04-02'], ['Pfingstmontag', '2029-05-21'], ['Fronleichnam', '2029-05-31']] },
  '2029/30': { start: '2029-08-20', summer: '2030-07-06',
    ferien: [['Herbstferien', '2029-10-06', '2029-10-21'], ['Weihnachtsferien', '2029-12-22', '2030-01-06'], ['Sportferien', '2030-02-02', '2030-02-17'], ['Frühlingsferien', '2030-04-13', '2030-04-28'], ['Auffahrtsferien', '2030-05-30', '2030-06-02']],
    feiertage: [['Allerheiligen', '2029-11-01'], ['Pfingstmontag', '2030-06-10'], ['Fronleichnam', '2030-06-20']] },
  '2030/31': { start: '2030-08-19', summer: '2031-07-05',
    ferien: [['Herbstferien', '2030-10-05', '2030-10-20'], ['Weihnachtsferien', '2030-12-21', '2031-01-05'], ['Sportferien', '2031-02-01', '2031-02-16'], ['Frühlingsferien', '2031-04-12', '2031-04-27'], ['Auffahrtsferien', '2031-05-22', '2031-05-25']],
    feiertage: [['Allerheiligen', '2030-11-01'], ['Karfreitag', '2031-04-11'], ['Pfingstmontag', '2031-06-02'], ['Fronleichnam', '2031-06-12']] }
};
const calYear = () => ZG_CALENDAR[state.settings.calendarYear];
// Alle schulfreien Tage: { 'JJJJ-MM-TT': { type: 'ferien' | 'feiertag', name, manual } }
let OFF = {};
function buildOff() {
  const m = {}, c = calYear(), st = state.settings;
  if (c) {
    for (const [n, a, b] of c.ferien) for (let d = parse(a); d <= parse(b); d = addDays(d, 1)) m[iso(d)] = { type: 'ferien', name: n };
    for (const [n, d] of c.feiertage) m[d] = { type: 'feiertag', name: n };
  }
  for (const [d, n] of Object.entries(st.extraOff || {})) if (d >= st.start && d <= st.end) m[d] = { type: 'feiertag', name: n, local: true };
  for (const mk of st.schoolForced || []) for (let i = 0; i < 5; i++) { const k = iso(addDays(parse(mk), i)); if (m[k] && m[k].type === 'ferien') delete m[k]; }
  for (const [mk, name] of Object.entries(st.holidays || {})) for (let i = 0; i < 5; i++) { const k = iso(addDays(parse(mk), i)); if (!m[k]) m[k] = { type: 'ferien', name: name || 'Ferien', manual: true }; }
  OFF = m;
}
const offDay = di => OFF[di];
// Name der Ferien, wenn alle fünf Schultage einer Woche Ferien sind
function weekHoliday(mk) {
  const days = [0, 1, 2, 3, 4].map(i => OFF[iso(addDays(parse(mk), i))]);
  if (days.every(x => x)) return (days.find(x => x.type === 'ferien') || days[0]).name;
  return undefined;
}
// Teilweise schulfreie Tage einer Woche als kurze Hinweise
function weekOffNotes(mk) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const o = OFF[iso(addDays(parse(mk), i))];
    if (!o) continue;
    const last = out[out.length - 1];
    if (last && last.type === o.type && last.name === o.name && last.to === i - 1) last.to = i;
    else out.push({ type: o.type, name: o.name, from: i, to: i });
  }
  return out.map(x => ({ ...x, label: (x.from === x.to ? DAYS[x.from] : DAYS[x.from] + '–' + DAYS[x.to]) + ' ' + x.name }));
}

// ---------- Stellenteilung ----------
// Wer unterrichtet eine Lektion: 'me', 'partner' oder 'both'. Ausnahmen pro Lektion gehen vor dem Stundenplan.
const whoPlan = (d, slotId) => state.settings.who[d + '-' + slotId] || 'me';
const whoAt = (di, slotId) => { const l = state.lessons[di + '|' + slotId]; return (l && l.who) || whoPlan(dayIdx(di) + 1, slotId); };
const partnerName = () => (state.settings.partner.name || '').trim() || 'Stellenpartnerin';
const myName = () => (state.settings.me.name || '').trim() || 'Ich';
const initials = n => n.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
const WHO_LABEL = w => w === 'partner' ? partnerName() : w === 'both' ? 'Beide' : myName();
// Unterrichte ich an diesem Wochentag (1 = Montag) mindestens eine Lektion?
function iTeachOn(d) {
  const s = state.settings;
  return s.slots.some(sl => s.timetable[d + '-' + sl.id] && whoPlan(d, sl.id) !== 'partner');
}
function dayOwner(d) {
  // ganzer Tag bei der Stellenpartnerin, wenn alle Lektionen mit Fach bei ihr liegen
  const s = state.settings;
  const used = s.slots.filter(sl => s.timetable[d + '-' + sl.id]);
  if (!used.length) return '';
  const ws = used.map(sl => whoPlan(d, sl.id));
  return ws.every(w => w === 'partner') ? 'partner' : '';
}

// ---------- Kennzeichen (Bilder im Raster) ----------
function badgesAt(di, pos) {
  const d = dayIdx(di) + 1, mk = iso(monday(parse(di)));
  return state.placements.filter(p => p.pos === pos && (
    (p.repeat && p.day === d && di >= (p.from || '') && !(p.skip || []).includes(mk) && !OFF[di]) ||
    (!p.repeat && p.date === di)));
}
function birthdaysOn(di) {
  const date = parse(di), list = [iso(date).slice(5)];
  if (date.getDay() === 5) list.push(iso(addDays(date, 1)).slice(5), iso(addDays(date, 2)).slice(5));
  return state.settings.birthdays.filter(b => list.includes(b.date));
}
const bImg = b => b.imageId ? `<img data-imgid="${b.imageId}" alt="">`
  : b.src ? `<img src="${esc(b.src)}" alt="">`
  : `<span class="bdg-txt">${esc((b.name || '?').slice(0, 2))}</span>`;
function badgeHTML(di, pos) {
  let h = badgesAt(di, pos).map(p => {
    if (p.meeting) { const md = state.meetDetails[p.id + '|' + di]; const nt = state.todos.filter(t => t.meetPlace === p.id + '|' + di && !t.done).length; return `<span class="bdg meet" data-place="${p.id}" data-date="${di}" title="${esc(p.meeting.title)}${p.repeat ? ' (jede Woche)' : ''}${md || nt ? ': Notizen vorhanden' : ''}">${p.meeting.time ? esc(p.meeting.time) + ' ' : ''}${esc(p.meeting.title)}${md || nt ? ' ✎' : ''}</span>`; }
    const b = badge(p.badgeId);
    return b ? `<span class="bdg" data-place="${p.id}" data-date="${di}" title="${esc(b.name)}${p.repeat ? ' (jede Woche)' : ''}">${bImg(b)}</span>` : '';
  }).join('');
  if (pos === 'tag') h += birthdaysOn(di).map(x => `<span class="bdg bday" title="Geburtstag ${esc(x.name)}"><img src="bilder/geburtstag.jpg" alt=""><em>${esc(x.name.split(' ')[0])}</em></span>`).join('');
  return h;
}

// ---------- Speichern ----------
let saveTimer;
function setSaveState(text, cls = '') { const el = $('#saveState'); el.textContent = text; el.className = 'save-state ' + cls; }
// Rückgängig: vor jeder Änderung den vorherigen Stand merken; schnelle Folgeänderungen (Tippen) zählen als ein Schritt
const UNDO_MAX = 50;
let undoStack = [], lastSnap = null, lastSaveAt = 0;
function resetUndo() { undoStack = []; lastSnap = JSON.stringify(state); updateUndoBtn(); }
function updateUndoBtn() {
  document.querySelectorAll('[data-undo]').forEach(b => { b.disabled = !undoStack.length; });
}
function save(step) {
  // step = true: immer ein eigener Rückgängig-Schritt (z. B. ein Strich mit dem Stift)
  const cur = JSON.stringify(state), now = Date.now();
  if (lastSnap !== null && cur !== lastSnap) {
    if (step === true || now - lastSaveAt > 1200 || !undoStack.length) { undoStack.push(lastSnap); if (undoStack.length > UNDO_MAX) undoStack.shift(); }
    lastSaveAt = now;
  }
  if (cur !== lastSnap) { state._mtime = now; lastSnap = JSON.stringify(state); if (typeof syncSchedule === 'function') syncSchedule(); if (typeof folderOnSave === 'function') folderOnSave(); }
  updateUndoBtn();
  setSaveState('Speichert …'); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400);
}
function undo() {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  state = migrate(JSON.parse(prev));
  state._mtime = Date.now(); lastSnap = JSON.stringify(state); lastSaveAt = 0;
  if (typeof syncSchedule === 'function') syncSchedule();
  if (typeof folderOnSave === 'function') folderOnSave();
  if (pick.open) pick.close();
  if (dlg.open) dlg.close();
  clearTimeout(saveTimer); saveNow().then(() => setSaveState('Rückgängig gemacht'));
  render(); updateUndoBtn();
}
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
  const t = e.target;
  if (t.closest && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
  e.preventDefault(); undo();
});
async function saveNow() {
  try { await idbPut('kv', 'state', state); setSaveState('Gespeichert'); }
  catch (e) { console.error(e); setSaveState('Fehler beim Speichern', 'err'); }
}

// ---------- Bilder und Dateien ----------
const urlCache = new Map();
async function blobURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await idbGet('images', id);
  if (!blob) return '';
  const u = URL.createObjectURL(blob);
  urlCache.set(id, u);
  return u;
}
async function fillImgs(root) {
  for (const img of root.querySelectorAll('img[data-imgid]')) if (!img.src) img.src = await blobURL(img.dataset.imgid);
}
async function downscale(file, max = 1600) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (sc === 1 && file.size < 800000) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.85));
}
const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });

// ---------- Darstellung ----------
function render() {
  if (state.meetings) syncUtMeetings();
  buildOff();
  document.documentElement.style.setProperty('--partner', state.settings.partner.color || '#8e6bd8');
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  $('#brandClass').textContent = `${state.settings.className} · ${sjLabel()}`;
  const v = $('#view');
  v.onclick = v.oninput = v.onchange = v.onsubmit = v.onkeydown = v.ondragstart = v.ondragover = v.ondragleave = v.ondrop = v.ondragend = null;
  ({ week: renderWeek, cowork: renderCowork, year: renderYear, agenda: renderAgenda, settings: renderSettings })[currentView](v);
  fillImgs(v);
}

// ----- Woche -----
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
// Zeilenhöhe im Verhältnis zur Lektionsdauer (45 Minuten = volle Höhe)
const slotBase = sl => { const m = mins(sl.to) - mins(sl.from); return m > 0 && m < 45 ? Math.max(0.5, m / 45) : 1; };
// Zeilenhöhe pro Lektion: am unteren Rand ziehen vergrössert die ganze Zeile (pro Gerät gemerkt)
let rowScale = (() => { try { return JSON.parse(localStorage.getItem('uh-rowscale') || '{}'); } catch { return {}; } })();
function setRowScale(id, v) {
  if (!v || v <= 1.02) delete rowScale[id]; else rowScale[id] = Math.min(6, +v.toFixed(2));
  try { localStorage.setItem('uh-rowscale', JSON.stringify(rowScale)); } catch {}
}
const slotFactor = sl => (slotBase(sl) * (rowScale[sl.id] || 1)).toFixed(3);
const slotIndex = id => state.settings.slots.findIndex(x => x.id === id);
function lessonPlansIn(mk) {
  const end = iso(addDays(parse(mk), 6));
  return Object.entries(state.lessons)
    .filter(([k, l]) => { const di = k.split('|')[0]; return di >= mk && di <= end && (l.title || '').trim() && ((l.flow || '').trim() || (l.goals || '').trim() || (l.files || []).length || (l.images || []).length); })
    .sort(([a], [b]) => { const [da, sa] = a.split('|'), [db, sb] = b.split('|'); return da.localeCompare(db) || slotIndex(sa) - slotIndex(sb); })
    .map(([key, l]) => ({ key, title: l.title }));
}
// Seitenliste wie in OneNote: Wochen, Ferienblöcke und Lektionsplanungen als Unterseiten
// Seitenliste: Lektionsplanungen pro Woche ein- und ausblenden (pro Gerät gemerkt)
const pagesOpen = new Set((() => { try { return JSON.parse(localStorage.getItem('uh-pages-open') || '[]'); } catch { return []; } })());
function pagesToggle(mk, force) {
  const on = force === undefined ? !pagesOpen.has(mk) : force;
  if (on) pagesOpen.add(mk); else pagesOpen.delete(mk);
  try { localStorage.setItem('uh-pages-open', JSON.stringify([...pagesOpen])); } catch {}
}
function pagesHTML() {
  const s = state.settings, cur = iso(currentMonday), blocks = [];
  let n = 0;
  for (const mon of schoolWeeks()) {
    const mk = iso(mon), hol = weekHoliday(mk);
    if (hol !== undefined) {
      const last = blocks[blocks.length - 1];
      if (last && last.hol === hol) last.weeks.push(mk); else blocks.push({ hol, weeks: [mk] });
    } else { n++; blocks.push({ n, weeks: [mk] }); }
  }
  return blocks.map(b => {
    const active = b.weeks.includes(cur);
    if (b.hol !== undefined) return `<button type="button" class="page hol ${active ? 'active' : ''}" data-gotoweek="${b.weeks[0]}">${esc(b.hol || 'Ferien')}</button>`;
    const mk = b.weeks[0], plans = lessonPlansIn(mk), open = pagesOpen.has(mk);
    if (!plans.length) return `<button type="button" class="page ${active ? 'active' : ''}" data-gotoweek="${mk}">${sjLabel()} W-${b.n}</button>`;
    return `<div class="page-row ${active ? 'active' : ''}"><button type="button" class="page ${active ? 'active' : ''}" data-gotoweek="${mk}" data-pageweek="${mk}" title="Lektionsplanungen ${open ? 'ausblenden' : 'einblenden'}">${sjLabel()} W-${b.n}<span class="page-count">${plans.length}</span></button><button type="button" class="page-caret" data-pagetoggle="${mk}" aria-expanded="${open}" aria-label="Lektionsplanungen ${open ? 'ausblenden' : 'einblenden'}">${open ? '▾' : '▸'}</button></div>`
      + (open ? plans.map(x => `<button type="button" class="page sub" data-openplan="${x.key}">${esc(x.title)}</button>`).join('') : '');
  }).join('');
}

// Termine, die einen Präsenznachmittag belegen: { from, to (Minuten), title, sub, color, id }
function presOverrides(di) {
  const out = [], hm = x => /^\d{1,2}:\d{2}/.test(x || '') ? mins(x.slice(0, 5)) : null;
  for (const m of state.meetings || []) {
    if (m.presId || m.date !== di) continue;
    const g = cwGroup(m.group), f = hm(m.time), t = hm(m.end);
    const from = f ?? mins('13:30'), to = t ?? (f !== null ? f + 60 : mins('16:30'));
    out.push({ from, to, title: g.name, sub: m.title || '', color: g.color, meeting: m.id, label: f !== null ? `${m.time.slice(0, 5).replace(':', '.')}${m.end ? '–' + m.end.slice(0, 5).replace(':', '.') : ''} Uhr` : 'Nachmittag' });
  }
  for (const e of state.events || []) {
    if (e.date !== di) continue;
    const f = hm(e.time); if (f === null) continue;
    out.push({ from: f, to: f + 60, title: e.title, sub: e.note || '', color: '#5a6270', label: e.time.slice(0, 5).replace(':', '.') + ' Uhr' });
  }
  return out;
}
const hhmm = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
const presOverItem = o => `<span class="pres-item pres-over" ${o.meeting ? `role="button" tabindex="0" data-cwopen="${o.meeting}"` : ''} style="--pb:${o.color};--pf:#fff" title="${esc(o.title)}${o.sub ? ': ' + esc(o.sub) : ''} (ersetzt ZAZ / IP)"><span class="pres-txt"><b class="pres-t">${esc(o.label)}</b>${esc(o.title)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span></span>`;
function presAfternoon(list, afterRows, di) {
  // gleiche Höhe wie die ersetzten Nachmittagszeilen (Lektionen, Pausen und Trennlinien)
  const f = afterRows.filter(r => r.type === 'slot').reduce((t, r) => t + Number(slotFactor(r.slot)), 0);
  const nb = afterRows.filter(r => r.type === 'break').length;
  const h = `calc(var(--cellh) * ${f} + var(--brkh) * ${nb})`;
  const ab = list.filter(p => p.block === 'AB'), a = list.filter(p => p.block === 'A'), b = list.filter(p => p.block === 'B');
  // Eigene Termine (CoWork-Besprechungen, Termine mit Uhrzeit) haben Vorrang vor ZAZ / IP im selben Block
  const over = presOverrides(di);
  if (over.length) {
    const blk = { A: [mins('13:30'), mins('15:00')], B: [mins('15:05'), mins('16:30')] };
    const hits = k => over.filter(o => o.from < blk[k][1] && o.to > blk[k][0]);
    const col = k => {
      const h = hits(k);
      const keep = [...ab, ...(k === 'A' ? a : b)].filter(p => !(h.length && p.cat === 'zaz'));
      return [...keep.map(presItem), ...h.map(presOverItem)].join('');
    };
    const fl = k => mins(PRES_BLOCKS[k].split('–')[1].replace('.', ':')) - mins(PRES_BLOCKS[k].split('–')[0].replace('.', ':'));
    return `<div class="pres-afternoon" style="height:${h}" title="Präsenzzeit"><div class="pres-block" style="flex:${fl('A')}">${col('A')}</div><div class="pres-block" style="flex:${fl('B')}">${col('B')}</div></div>`;
  }
  const block = (key, items) => `<div class="pres-block" style="flex:${mins(PRES_BLOCKS[key].split('–')[1].replace('.', ':')) - mins(PRES_BLOCKS[key].split('–')[0].replace('.', ':'))}">
      ${items.map(presItem).join('')}</div>`;
  // ganzer Nachmittag zuerst, darunter die Blöcke A und B; leere Blöcke bleiben als Platzhalter für die Zeit
  const inner = ab.length && !a.length && !b.length ? block('AB', ab)
    : (ab.length ? `<div class="pres-block pres-ab">${ab.map(presItem).join('')}</div>` : '') + block('A', a) + block('B', b);
  return `<div class="pres-afternoon" style="height:${h}" title="Präsenzzeit">${inner}</div>`;
}

// ----- Doppel- und Dreifachlektionen -----
// lesson.mergeNext = true verbindet eine Lektion mit der direkt folgenden (ohne Pause dazwischen)
const effSubject = (di, slotId) => { const l = state.lessons[di + '|' + slotId]; return (l && l.subjectId) || state.settings.timetable[(dayIdx(di) + 1) + '-' + slotId] || ''; };
function slotChain(di, slotId) {
  // alle Lektionen, die mit dieser Lektion verbunden sind; die erste ist die Hauptlektion
  const rows = weekRows();
  let i = rows.findIndex(r => r.type === 'slot' && r.slot.id === slotId);
  if (i < 0) return [];
  while (i > 0 && rows[i - 1].type === 'slot' && (state.lessons[di + '|' + rows[i - 1].slot.id] || {}).mergeNext) i--;
  const chain = [rows[i].slot];
  while (i + 1 < rows.length && rows[i + 1].type === 'slot' && (state.lessons[di + '|' + rows[i].slot.id] || {}).mergeNext) { i++; chain.push(rows[i].slot); }
  return chain;
}
function canMerge(di, a, b) {
  const sa = effSubject(di, a.id);
  return !!sa && sa === effSubject(di, b.id) && !offDay(di);
}
function mergeLessons(di, upperId, lowerId) {
  const up = di + '|' + upperId, lo = di + '|' + lowerId;
  const A = state.lessons[up] = state.lessons[up] || { images: [], files: [] };
  const B = state.lessons[lo];
  const empty = l => !l || !LESSON_FIELDS.some(f => (l[f] || '').trim()) && !(l.images || []).length && !(l.files || []).length;
  if (empty(A) && !empty(B)) { const keep = A.mergeNext; Object.assign(A, B); delete A.mergeNext; if (B.mergeNext) A.mergeNext = true; if (keep) A.mergeNext = true; }
  A.mergeNext = true;
  if (B && B.mergeNext) { /* Dreifachlektion: Verbindung nach unten bleibt bestehen */ }
}

// ----- Lektion kopieren und an anderer Stelle einfügen (Zwischenablage) -----
let lessonClip = (() => { try { return JSON.parse(sessionStorage.getItem('uh-clip') || 'null'); } catch { return null; } })();
function clipSave() { try { if (lessonClip) sessionStorage.setItem('uh-clip', JSON.stringify(lessonClip)); else sessionStorage.removeItem('uh-clip'); } catch {} }
function copyLesson(key) {
  const src = state.lessons[key];
  if (!src) return;
  const [di, sl] = key.split('|');
  const data = JSON.parse(JSON.stringify(src));
  delete data.mergeNext; delete data.who;
  if (!data.subjectId) { const sid = state.settings.timetable[(dayIdx(di) + 1) + '-' + sl]; if (sid) data.subjectId = sid; }
  const sub = subj(data.subjectId);
  lessonClip = { from: key, data, label: (sub ? (sub.short || sub.name) + ': ' : '') + (data.title || 'Lektion') + ` (${DAYS[dayIdx(di)]} ${fmtShort(parse(di))})` };
  clipSave();
}
function pasteClip(to) {
  if (!lessonClip) return;
  if (to === lessonClip.from) { openLesson(to); return; }
  const cur = state.lessons[to];
  if (cur && (cur.title || cur.flow || cur.goals || (cur.images || []).length || (cur.files || []).length)
    && !confirm(`Diese Lektion enthält schon «${cur.title || 'Einträge'}». Mit «${lessonClip.label}» ersetzen?`)) return;
  const data = JSON.parse(JSON.stringify(lessonClip.data));
  if (cur && cur.mergeNext) data.mergeNext = true; // eine Doppellektion am Ziel bleibt verbunden
  state.lessons[to] = data;
  save(true); render();
  const el = document.querySelector(`.cell[data-lesson="${CSS.escape(to)}"]`);
  if (el) { el.classList.add('pasted'); setTimeout(() => el.classList.remove('pasted'), 900); }
}
// ----- Schnellvorschau einer Lektion: Maus darüber oder lange drücken (iPad) -----
let peekEl = null, peekTimer = null, peekKey = null, peekSuppressClick = false;
function peekHTML(key) {
  const l = state.lessons[key];
  if (!l) return '';
  const [di, sid] = key.split('|');
  const chain = slotChain(di, sid), sl0 = chain[0], sl1 = chain[chain.length - 1];
  const sub = subj(l.subjectId || state.settings.timetable[(dayIdx(di) + 1) + '-' + sid]);
  const sec = (h, t) => (t || '').trim() ? `<h5>${h}</h5><div class="peek-txt">${esc(t.replace(/<[^>]+>/g, ' ').trim())}</div>` : '';
  const nAtt = (l.images || []).length + (l.files || []).length;
  if (!(l.title || l.flow || l.goals || l.material || l.homework || nAtt)) return '';
  return `<div class="peek-head" style="--c:${sub ? sub.color : '#999'}">${sub ? `<b>${esc(sub.short || sub.name)}</b> ` : ''}${esc(l.title || 'Lektion')}</div>
    <div class="peek-meta">${DAYS_LONG[dayIdx(di)]} ${fmtShort(parse(di))} · ${sl0 ? sl0.from : ''}–${sl1 ? sl1.to : ''}${chain.length > 1 ? ' · ' + (chain.length === 2 ? 'Doppellektion' : chain.length + '-fach') : ''}${l.lk ? ' · <span class="lk-tag">LK</span>' : ''}${l.cancelled ? ' · fällt aus' : ''}</div>
    ${sec('Lernziele', l.goals)}${sec('Ablauf', l.flow)}${sec('Material', l.material)}${sec('Hausaufgaben', l.homework)}
    ${nAtt ? `<div class="peek-meta">📎 ${nAtt} ${nAtt === 1 ? 'Anhang' : 'Anhänge'}</div>` : ''}`;
}
function peekShow(cell) {
  const key = cell.dataset.lesson, html = peekHTML(key);
  if (!html) return;
  if (!peekEl) { peekEl = document.createElement('div'); peekEl.className = 'peek'; peekEl.setAttribute('role', 'tooltip'); document.body.appendChild(peekEl); }
  peekEl.innerHTML = html; peekEl.hidden = false; peekKey = key;
  const r = cell.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  const pw = Math.min(380, W - 24); peekEl.style.width = pw + 'px';
  const ph = peekEl.offsetHeight;
  let x = r.right + 10; if (x + pw > W - 12) x = r.left - pw - 10; if (x < 12) x = Math.max(12, Math.min(W - pw - 12, r.left));
  let y = r.top; if (y + ph > H - 12) y = Math.max(12, H - ph - 12);
  if (x === r.left || (x < r.right && x + pw > r.left)) { y = r.bottom + 8; if (y + ph > H - 12) y = Math.max(12, r.top - ph - 8); }
  peekEl.style.left = x + 'px'; peekEl.style.top = y + 'px';
}
function peekHide() { clearTimeout(peekTimer); peekTimer = null; peekKey = null; if (peekEl) peekEl.hidden = true; }
function peekSetup(v) {
  peekHide();
  if (v.__peekBound) return; // #view bleibt bestehen, Listener nur einmal setzen
  v.__peekBound = true;
  const cellOf = e => { const c = e.target.closest && e.target.closest('.cell[data-lesson]'); return c && v.contains(c) ? c : null; };
  v.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse' || ink.on || rowDrag) return;
    const c = cellOf(e); if (!c || c.dataset.lesson === peekKey) return;
    clearTimeout(peekTimer); peekTimer = setTimeout(() => peekShow(c), 450);
  });
  v.addEventListener('pointerout', e => {
    if (e.pointerType !== 'mouse') return;
    const c = cellOf(e); if (c && e.relatedTarget && c.contains(e.relatedTarget)) return;
    peekHide();
  });
  // iPad: lange drücken zeigt die Vorschau, loslassen öffnet dann nicht die Lektion
  let lp = null;
  v.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || ink.on) { if (e.pointerType === 'mouse') peekHide(); return; }
    const c = cellOf(e); if (!c) { peekHide(); return; }
    if (peekKey && peekKey !== c.dataset.lesson) peekHide();
    lp = { x: e.clientX, y: e.clientY, t: setTimeout(() => { peekShow(c); peekSuppressClick = !!peekKey; lp = null; }, 500) };
  });
  v.addEventListener('pointermove', e => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) { clearTimeout(lp.t); lp = null; } });
  v.addEventListener('pointerup', () => { if (lp) { clearTimeout(lp.t); lp = null; } });
  v.addEventListener('click', e => { if (peekSuppressClick) { peekSuppressClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
  v.addEventListener('contextmenu', e => { if (cellOf(e) && e.pointerType !== 'mouse' && peekKey) e.preventDefault(); });
}
window.addEventListener('scroll', () => { if (peekKey) peekHide(); }, { passive: true });
document.addEventListener('pointerdown', e => { if (peekKey && !e.target.closest('.cell[data-lesson]') && !e.target.closest('.peek')) peekHide(); });

// ----- Zeilenhöhe mit der Maus oder dem Finger ziehen -----
let rowDrag = null;
function rowGripSetup(v) {
  v.querySelectorAll('[data-rowgrip]').forEach(g => {
    g.addEventListener('dblclick', e => { e.stopPropagation(); setRowScale(g.dataset.rowgrip, 1); render(); });
    g.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const id = g.dataset.rowgrip, sl = state.settings.slots.find(x => x.id === id);
      if (!sl) return;
      const grid = v.querySelector('.week-grid'), cellh = parseFloat(getComputedStyle(grid).getPropertyValue('--cellh')) || 92;
      const line = document.createElement('div'); line.className = 'row-guide';
      grid.appendChild(line);
      const gTop = grid.getBoundingClientRect().top;
      rowDrag = { id, y0: e.clientY, s0: rowScale[id] || 1, base: slotBase(sl) * cellh, line, gTop };
      line.style.top = (e.clientY - gTop) + 'px';
      const move = ev => {
        if (!rowDrag) return;
        line.style.top = (ev.clientY - grid.getBoundingClientRect().top) + 'px';
      };
      const up = ev => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        if (!rowDrag) return;
        const d = rowDrag; rowDrag = null; d.line.remove();
        const dy = ev.clientY - d.y0;
        if (Math.abs(dy) > 3) { setRowScale(d.id, Math.max(1, d.s0 + dy / (d.base * d.s0 / d.s0))); render(); }
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
  });
}

function moveLesson(from, to) {
  const src = state.lessons[from];
  if (!src) return;
  const [fdi, fsl] = from.split('|');
  const moved = { ...src, images: [...(src.images || [])], files: (src.files || []).map(x => ({ ...x })) };
  delete moved.mergeNext;
  // Fach aus dem Stundenplan mitnehmen, wenn es in der Lektion nicht eigens gesetzt ist
  if (!moved.subjectId) { const sid = state.settings.timetable[(dayIdx(fdi) + 1) + '-' + fsl]; if (sid) moved.subjectId = sid; }
  // Die Penseneinteilung (wer unterrichtet) richtet sich nach dem Zielplatz und wird nicht mitkopiert
  delete moved.who;
  state.lessons[to] = moved; // Kopie: die ursprüngliche Lektion bleibt erhalten
}

// ----- Auflockerung der Woche: pro Art ein Spiel, über das Schuljahr ohne Wiederholung gemischt -----
function strSeed(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function seededShuffle(arr, seed) {
  const a = arr.slice(); let x = seed || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function weekGames(mk, n) {
  if (typeof GAMES === 'undefined') return [];
  const outdoor = !!state.settings.gamesOutdoor;
  const roll = state.gameRoll[mk] || {};
  const idx = n > 0 ? n - 1 : Math.floor(parse(mk).getTime() / 6048e5);
  return Object.keys(GAME_KINDS).map(k => {
    const pool = GAMES.filter(g => g.k === k && (outdoor || g.r === 'zimmer'));
    if (!pool.length) return null;
    const perm = seededShuffle(pool, strSeed((state.settings.start || '') + k + (outdoor ? 'h' : '')));
    return perm[(idx + (roll[k] || 0) * 5) % perm.length];
  }).filter(Boolean);
}
function gamesHTML(mk, n) {
  const list = weekGames(mk, n);
  if (!list.length) return '';
  return `<section class="games card">
    <div class="games-head">
      <h3>Auflockerung der Woche</h3>
      <span class="muted">Vier Vorschläge, um die Lektionen zu rhythmisieren</span>
      <span class="games-tools no-print">
        <label class="lg-toggle"><input type="checkbox" data-gamesout ${state.settings.gamesOutdoor ? 'checked' : ''}> auch Turnhalle und Pausenplatz</label>
        <button type="button" class="btn small" data-gameroll="all">Andere Vorschläge</button>
      </span>
    </div>
    <div class="games-grid">${list.map(g => { const K = GAME_KINDS[g.k]; return `<article class="game" style="--gc:${K.color}">
      <div class="game-top"><span class="game-kind">${K.label}</span>${g.r === 'halle' ? '<span class="game-room">Turnhalle/Pausenplatz</span>' : ''}<button type="button" class="icon-btn no-print" data-gameroll="${g.k}" title="Anderes Spiel dieser Art" aria-label="Anderes Spiel dieser Art">↻</button></div>
      <h4>${esc(g.t)}</h4>
      <p>${esc(g.d)}</p>
      <p class="game-meta"><b>Material:</b> ${esc(g.m)}</p>
      <p class="game-src">${esc(GAME_SOURCES[g.s] || '')}</p>
    </article>`; }).join('')}</div>
  </section>`;
}

// Ablauf in der Lektion: nur so viele ganze Zeilen zeigen, wie Platz hat
function fitFlows(root) {
  root.querySelectorAll('.cell-flow').forEach(el => {
    el.style.maxHeight = ''; el.style.webkitLineClamp = ''; el.hidden = false;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 15;
    const n = Math.floor((el.clientHeight + 1) / lh);
    if (n < 1) { el.hidden = true; return; }
    el.style.maxHeight = (n * lh) + 'px';
    el.style.webkitLineClamp = n;
  });
}
let fitTimer;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { fitFlows(document); inkRedraw && inkRedraw(); }, 120); });

// ----- Handschrift mit dem Stift (Apple Pencil, Maus oder anderer Stift) -----
// Striche pro Woche in state.ink[Wochenmontag]: { di, c: Farbe, w: Dicke, p: [[x-Anteil der Tagesspalte, y in px, Druck]] }
const INK_COLORS = [['#1b1b1b', 'Schwarz'], ['#1f4fd1', 'Blau'], ['#d62828', 'Rot'], ['#1e8a3e', 'Grün'], ['#8e5cc2', 'Violett'], ['#e07b00', 'Orange']];
const INK_WIDTHS = [[2, 'dünn'], [4, 'mittel'], [8, 'dick']];
// Leuchtstift: drei Pastelltöne, die sich vom cremefarbenen Raster abheben
const INK_HL = [['#ff8fc8', 'Rosa'], ['#7fe0a0', 'Mintgrün'], ['#8fc8ff', 'Hellblau']];
const INK_HL_WIDTH = 16, INK_HL_ALPHA = 0.6;
const ink = { on: false, tool: 'pen', color: '#1f4fd1', width: 4, hl: '#ff8fc8' };
try { Object.assign(ink, JSON.parse(localStorage.getItem('uh-ink') || '{}'), { on: false }); } catch {}
function inkPrefsSave() { try { localStorage.setItem('uh-ink', JSON.stringify({ tool: ink.tool, color: ink.color, width: ink.width, hl: ink.hl })); } catch {} }
let inkRedraw = null;
function inkBarHTML(mk) {
  return `<div class="ink-bar no-print" role="toolbar" aria-label="Stiftwerkzeuge">
    <button type="button" class="btn ${ink.tool === 'pen' ? 'on' : ''}" data-inkbtn="pen" aria-pressed="${ink.tool === 'pen'}">✎ Stift</button>
    <button type="button" class="btn ${ink.tool === 'marker' ? 'on' : ''}" data-inkbtn="marker" aria-pressed="${ink.tool === 'marker'}">🖍 Leuchtstift</button>
    <button type="button" class="btn ${ink.tool === 'erase' ? 'on' : ''}" data-inkbtn="erase" aria-pressed="${ink.tool === 'erase'}">⌫ Radierer</button>
    <span class="ink-sep"></span>
    ${INK_COLORS.map(([c, n]) => `<button type="button" class="ink-color ${ink.color === c && ink.tool === 'pen' ? 'on' : ''}" style="--ic:${c}" data-inkcolor="${c}" title="${n}" aria-label="Farbe ${n}"></button>`).join('')}
    <span class="ink-sep"></span>
    ${INK_WIDTHS.map(([w, n]) => `<button type="button" class="ink-width ${ink.width === w && ink.tool === 'pen' ? 'on' : ''}" data-inkw="${w}" title="${n}" aria-label="Dicke ${n}"><i style="height:${w}px;background:${ink.color}"></i></button>`).join('')}
    <span class="ink-sep"></span>
    ${INK_HL.map(([c, n]) => `<button type="button" class="ink-color ink-hl ${ink.hl === c && ink.tool === 'marker' ? 'on' : ''}" style="--ic:${c}" data-inkhl="${c}" title="Leuchtstift ${n}" aria-label="Leuchtstift ${n}"></button>`).join('')}
    <span class="ink-hint muted">Mit dem Stift schreiben, mit dem Finger scrollen</span>
    <button type="button" class="btn small" data-inkbtn="clear" ${(state.ink[mk] || []).length ? '' : 'disabled'}>Seite leeren</button>
    <button type="button" class="btn primary small" data-inkbtn="toggle">Fertig</button>
  </div>`;
}
function inkSetup(root, mk) {
  const grid = root.querySelector('.week-grid');
  if (!grid) { inkRedraw = null; return; }
  const cv = document.createElement('canvas');
  cv.className = 'ink-layer' + (ink.on ? ' active' : '') + (ink.on && ink.tool === 'erase' ? ' erase' : '') + (ink.on && ink.tool === 'marker' ? ' marker' : '');
  grid.appendChild(cv);
  const ctx = cv.getContext('2d');
  const cols = () => {
    const g = grid.getBoundingClientRect(), m = {};
    grid.querySelectorAll('.day[data-di]').forEach(d => { const r = d.getBoundingClientRect(); m[d.dataset.di] = { x: r.left - g.left, w: r.width }; });
    return m;
  };
  let C = {};
  const seg = (s, a, b) => {
    ctx.strokeStyle = s.c; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = s.w * (0.55 + 0.9 * (b[2] ?? 0.5));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  };
  const toPx = (s, q) => { const col = C[s.di]; return col ? [col.x + q[0] * col.w, q[1], q[2]] : null; };
  const drawStroke = s => {
    if (!C[s.di]) return;
    const pts = s.p.map(q => toPx(s, q));
    if (s.t === 'm') {
      // Leuchtstift: ein durchgehender, halbtransparenter Strich ohne dunkle Überlappungen
      ctx.save(); ctx.globalAlpha = INK_HL_ALPHA; ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]); else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke(); ctx.restore(); return;
    }
    if (pts.length === 1) { ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], s.w / 2, 0, 7); ctx.fill(); return; }
    for (let i = 1; i < pts.length; i++) seg(s, pts[i - 1], pts[i]);
  };
  const redraw = () => {
    const dpr = window.devicePixelRatio || 1, W = grid.scrollWidth, H = grid.scrollHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    C = cols();
    paint();
  };
  // Leuchtstift zuerst, damit die Schrift darüber liegt
  const paint = extra => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    const list = (state.ink[mk] || []).concat(extra ? [extra] : []);
    list.filter(s => s.t === 'm').forEach(drawStroke);
    list.filter(s => s.t !== 'm').forEach(drawStroke);
  };
  inkRedraw = redraw;
  redraw();
  if (!ink.on) return;
  // Apple Pencil soll nicht scrollen, der Finger schon
  cv.addEventListener('touchstart', e => { if ([...e.touches].some(t => t.touchType === 'stylus')) e.preventDefault(); }, { passive: false });
  cv.addEventListener('touchmove', e => { if ([...e.touches].some(t => t.touchType === 'stylus')) e.preventDefault(); }, { passive: false });
  let cur = null, erasing = false, changed = false;
  const pos = e => { const g = grid.getBoundingClientRect(); return [e.clientX - g.left, e.clientY - g.top, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5]; };
  const colAt = x => {
    let best = null, bd = Infinity;
    for (const [di, c] of Object.entries(C)) { const d = x < c.x ? c.x - x : x > c.x + c.w ? x - c.x - c.w : 0; if (d < bd) { bd = d; best = di; } }
    return best;
  };
  const eraseAt = (x, y) => {
    const list = state.ink[mk] || [], r = 10;
    const keep = list.filter(s => !s.p.some(q => { const P = toPx(s, q); return P && Math.hypot(P[0] - x, P[1] - y) <= r + s.w / 2; }));
    if (keep.length !== list.length) { state.ink[mk] = keep; changed = true; redraw(); }
  };
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    C = cols();
    const [x, y, pr] = pos(e);
    if (ink.tool === 'erase') { erasing = true; changed = false; eraseAt(x, y); return; }
    const di = colAt(x); if (!di) return;
    const col = C[di];
    cur = ink.tool === 'marker'
      ? { di, t: 'm', c: ink.hl, w: INK_HL_WIDTH, p: [[+((x - col.x) / col.w).toFixed(4), +y.toFixed(1), 0.5]] }
      : { di, c: ink.color, w: ink.width, p: [[+((x - col.x) / col.w).toFixed(4), +y.toFixed(1), +pr.toFixed(2)]] };
  });
  cv.addEventListener('pointermove', e => {
    if (!cur && !erasing) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y, pr] = pos(ev);
      if (erasing) { eraseAt(x, y); continue; }
      const col = C[cur.di], q = [+((x - col.x) / col.w).toFixed(4), +y.toFixed(1), +pr.toFixed(2)];
      const prev = toPx(cur, cur.p[cur.p.length - 1]);
      if (Math.hypot(prev[0] - x, prev[1] - y) < 1.2) continue;
      cur.p.push(q);
      if (cur.t !== 'm') seg(cur, prev, toPx(cur, q));
    }
    if (cur && cur.t === 'm') paint(cur);
  });
  const end = () => {
    if (cur) { (state.ink[mk] = state.ink[mk] || []).push(cur); cur = null; save(true); redraw(); const cb = document.querySelector('[data-inkbtn="clear"]'); if (cb) cb.disabled = false; }
    if (erasing) { erasing = false; if (changed) { if (!(state.ink[mk] || []).length) delete state.ink[mk]; save(true); } }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

function renderWeek(v) {
  const s = state.settings;
  const mon = currentMonday, mk = iso(mon), fri = addDays(mon, 4);
  const holName = weekHoliday(mk);
  const offNotes = holName ? [] : weekOffNotes(mk);
  const n = schoolWeekNumber(mk);
  const meta = state.weekMeta[mk] || {};
  const plans = lessonPlansIn(mk);
  const todayIso = iso(new Date());
  const ttEmpty = Object.values(s.timetable).every(x => !x);
  const rows = weekRows();
  const title = holName ? esc(holName) : n ? `${sjLabel()} W-${n}` : 'ausserhalb Schuljahr';

  const timesCol = rows.map(r => {
    if (r.type === 'slot') return `<div class="time" style="--f:${slotFactor(r.slot)}">${r.slot.from}<span class="row-grip no-print" data-rowgrip="${r.slot.id}" title="Ziehen, um die Zeile zu vergrössern; Doppelklick: zurücksetzen"></span></div>`;
    const prev = s.slots.find(x => 'p:' + x.id === r.pos);
    return `<div class="brk-time">${prev ? prev.to : ''}</div>`;
  }).join('');

  let cols = '';
  let headExtra = 0, chipRow = false, maxTasks = 0, maxHw = 0; // Höhe von Kopf- und Notizzeile nach Inhalt
  const myDays = [0, 1, 2, 3, 4].filter(d => iTeachOn(d + 1));
  const hideOther = !!state.settings.hideOtherDays && myDays.length > 0;
  const shownDays = hideOther ? myDays : [0, 1, 2, 3, 4];
  const midDay = shownDays[Math.floor(shownDays.length / 2)];
  for (const d of shownDays) {
    const date = addDays(mon, d), di = iso(date);
    const dayEvs = state.events.filter(e => e.date === di);
    const dt = state.dayTasks[di] || [];
    const rowHTML = (r, span) => {
      if (r.type === 'break') {
        return `<div class="brk ${r.kind}"><span class="bdg-row">${badgeHTML(di, r.pos)}</span><span class="brk-name ${d === midDay ? 'mid' : ''}">${r.kind === 'mittag' ? 'MITTAG' : 'PAUSE'}</span><button type="button" class="add-bdg" data-addbdg="${di}|${r.pos}" aria-label="Kennzeichen hinzufügen">+</button></div>`;
      }
      const sl = r.slot, key = di + '|' + sl.id;
      const les = state.lessons[key];
      const sub = subj((les && les.subjectId) || s.timetable[(d + 1) + '-' + sl.id]);
      const who = whoAt(di, sl.id);
      const nAtt = (les && les.images ? les.images.length : 0) + (les && les.files ? les.files.length : 0);
      const isPlan = plans.some(p => p.key === key);
      const offD = offDay(di);
      const line = (les && les.title) ? esc(les.title) : offD ? `<i class="cell-hint">${esc(offD.name)}</i>` : (sub ? '<i class="cell-hint">offen</i>' : '');
      // Wird die Lektion oben von einem festen Zeitfenster (z. B. Schwimmen) überdeckt, beginnt ihr Inhalt erst darunter
      const a0 = mins(sl.from), a1 = mins(sl.to);
      const cover = (state.fixed || []).filter(x => x.date === di && mins(x.from) <= a0 && mins(x.to) > a0).reduce((m, x) => Math.max(m, Math.min(mins(x.to), a1) - a0), 0);
      const coverPad = cover > 0 && cover < a1 - a0 ? `padding-top:calc(var(--cellh) * ${(Number(slotFactor(sl)) * cover / (a1 - a0)).toFixed(3)} + 6px);` : '';
      const chain = span && span.length > 1 ? span : null;
      const fSum = chain ? chain.reduce((t, x) => t + Number(slotFactor(x)), 0) : Number(slotFactor(sl));
      const lastTo = chain ? chain[chain.length - 1].to : sl.to;
      let joints = '', acc = 0;
      if (chain) chain.slice(0, -1).forEach((x, k) => { acc += Number(slotFactor(x)); joints += `<button type="button" class="split-btn" data-split="${di}|${x.id}" style="top:calc(var(--cellh) * ${acc.toFixed(3)})" title="Lektionen wieder trennen" aria-label="Lektionen trennen">✂</button>`; });
      const movable = les && LESSON_FIELDS.concat(['subjectId']).some(f => (les[f] || '').toString().trim()) || (les && ((les.images || []).length || (les.files || []).length));
      return `<div role="button" tabindex="0" ${movable ? 'draggable="true" title="Ziehen, um die Lektion an einen anderen Platz zu kopieren"' : ''} class="cell ${movable ? 'movable' : ''} ${sub || (les && les.title) ? 'has-sub' : 'empty'} ${les && les.cancelled ? 'cancelled' : ''} ${les && les.lk ? 'lk' : ''} who-${who}" data-lesson="${key}" style="--f:${fSum.toFixed(3)};${coverPad}${sub ? `--c:${sub.color}` : ''}" ${who !== 'me' ? `title="${esc(WHO_LABEL(who))}"` : ''}>
        <span class="cell-bdgs ${!(les && les.title) && badgesAt(di, sl.id).length ? 'solo' : ''}">${badgeHTML(di, sl.id)}</span>
        <span class="cell-time">${sl.from}${chain ? '–' + lastTo : ''}</span>${joints}
        ${sub || line ? `<span class="cell-line">${sub && !(offD && !(les && les.title)) ? `<b>${esc(sub.short || sub.name)}:</b> ` : ''}${line}</span>` : '<span class="cell-plus" aria-label="Lektion hinzufügen">+</span>'}
        ${les && (les.flow || '').trim() && !les.cancelled ? `<span class="cell-flow">${esc(les.flow.replace(/<[^>]+>/g, ' ').replace(/\n{2,}/g, '\n').trim())}</span>` : ''}
        ${les && les.homework ? `<span class="cell-ha">HA: ${esc(les.homework.split('\n')[0])}</span>` : ''}
        <span class="cell-icons">${chain ? `<span class="dbl-tag">${chain.length === 2 ? 'Doppellektion' : chain.length === 3 ? 'Dreifachlektion' : chain.length + '-fach'}</span>` : ''}${les && les.lk ? '<span class="lk-tag">LK</span>' : ''}${who !== 'me' && (sub || (les && les.title)) ? `<span class="who-tag">${who === 'both' ? 'Team' : esc(initials(partnerName()))}</span>` : ''}${isPlan ? '<span title="Lektionsplanung vorhanden">📝 Planung</span>' : ''}${nAtt ? `<span title="Anhänge">📎 ${nAtt}</span>` : ''}${les && les.reflection ? '<span title="Reflexion vorhanden">✎</span>' : ''}${les && les.cancelled ? '<span>fällt aus</span>' : ''}</span>
        <span class="row-grip no-print" data-rowgrip="${(chain ? chain[chain.length - 1] : sl).id}" title="Ziehen, um die Zeile zu vergrössern; Doppelklick: zurücksetzen"></span>
      </div>`;
    };
    // Präsenzzeit direkt im Nachmittag des Tages: ersetzt die Nachmittagszeilen, Höhe bleibt gleich
    const presList = (state.presence || []).filter(p => p.date === di && p.cat !== 'frei');
    const mi = rows.findIndex(r => r.type === 'break' && r.kind === 'mittag');
    const buildRows = list => {
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r.type !== 'slot') { out.push(rowHTML(r)); continue; }
        const span = [r.slot];
        let j = i;
        while (j + 1 < list.length && list[j + 1].type === 'slot' && (state.lessons[di + '|' + list[j].slot.id] || {}).mergeNext) { j++; span.push(list[j].slot); }
        out.push(rowHTML(r, span));
        if (j + 1 < list.length && list[j + 1].type === 'slot' && canMerge(di, list[j].slot, list[j + 1].slot))
          out.push(`<div class="merge-joint"><button type="button" class="merge-btn" data-merge="${di}|${list[j].slot.id}|${list[j + 1].slot.id}" title="Zu ${span.length === 1 ? 'Doppellektion' : 'Dreifachlektion'} verbinden" aria-label="Lektionen verbinden">⇕</button></div>`);
        i = j;
      }
      return out.join('');
    };
    const body = presList.length && mi >= 0 && mi < rows.length - 1
      ? buildRows(rows.slice(0, mi + 1)) + presAfternoon(presList, rows.slice(mi + 1), di)
      : buildRows(rows);
    const owner = dayOwner(d + 1);
    const off = offDay(di);
    const dayMeet = (state.meetings || []).filter(m => m.date === di && !m.presId);
    const dayBadges = badgeHTML(di, 'tag') + dayEvs.map(e => `<span class="day-ev" title="${esc(e.title)}">${e.time ? e.time + ' ' : ''}${esc(e.title)}</span>`).join('')
      + dayMeet.map(m => `<span class="day-ev cw" role="button" data-cwopen="${m.id}" style="--gc:${cwGroup(m.group).color}" title="${esc(cwGroup(m.group).name)}: ${esc(m.title || '')}">${m.time ? esc(m.time) + ' ' : ''}${esc(cwGroup(m.group).name)}</span>`).join('');
    if (dayBadges) headExtra = 1;
    if (off || owner === 'partner') chipRow = true;
    maxTasks = Math.max(maxTasks, (state.dayTasks[di] || []).length);
    const hw = state.dayHomework[di] || [];
    maxHw = Math.max(maxHw, hw.length);
    const fixedEv = fixedHTML(di);
    cols += `<div data-di="${di}" class="day ${fixedEv ? 'has-fixed' : ''} ${di === todayIso ? 'today' : ''} ${owner === 'partner' && !off ? 'partner-day' : ''} ${off ? 'off off-' + off.type : ''}">
      <div class="day-head">
        <div class="dh-name">${DAYS_LONG[d]}</div>
        <div class="dh-date">${date.getDate()}. ${MONTHS[date.getMonth()]}</div>
        ${off ? `<div class="dh-off">${off.type === 'feiertag' ? 'Feiertag: ' : ''}${esc(off.name)}</div>` : owner === 'partner' ? `<div class="dh-owner">${esc(partnerName())}</div>` : ''}
        ${dayBadges ? `<div class="dh-badges"><span class="bdg-row">${dayBadges}</span></div>` : ''}
      </div>
      <div class="dtasks">
        ${dt.map(t => `<label class="dtask ${t.done ? 'done' : ''} ${/besuchstag/i.test(t.text) ? 'visit' : ''}" ${/besuchstag/i.test(t.text) ? 'title="Besuchstag"' : ''}><input type="checkbox" data-dtaskdone="${di}|${t.id}" ${t.done ? 'checked' : ''} aria-label="erledigt"><input class="dtask-text" data-dtask="${di}|${t.id}" value="${esc(t.text)}" aria-label="Notiz"></label>`).join('')}
        <label class="dtask new"><input type="checkbox" disabled aria-hidden="true"><input class="dtask-text" data-dtasknew="${di}" placeholder="${dt.length ? '' : 'Notiz für den Tag'}" aria-label="Neue Notiz für ${DAYS_LONG[d]}"></label>
      </div>
      <div class="dtasks dhw">
        ${hw.map(t => `<label class="dtask ${t.done ? 'done' : ''}"><input type="checkbox" data-list="dayHomework" data-dtaskdone="${di}|${t.id}" ${t.done ? 'checked' : ''} aria-label="kontrolliert"><input class="dtask-text ${haSubject(t.text) ? 'ha-sub' : ''}" ${haStyle(t.text)} data-list="dayHomework" data-dtask="${di}|${t.id}" value="${esc(t.text)}" aria-label="Hausaufgabe" title="${esc(haSubject(t.text)?.name || '')}"></label>`).join('')}
        <label class="dtask new"><input type="checkbox" disabled aria-hidden="true"><input class="dtask-text" data-list="dayHomework" data-dtasknew="${di}" placeholder="${hw.length ? '' : 'HA auf diesen Tag'}" aria-label="Neue Hausaufgabe auf ${DAYS_LONG[d]}"></label>
      </div>
      ${fixedEv}
      ${body}</div>`;
  }

  v.innerHTML = `
  <div class="week-layout">
  <div class="week-main">
  <section class="week-head">
    <div class="wh-title">
      <div>
        <h1>${title}</h1>
        <div class="wh-date">KW ${isoWeek(mon)} · ${fmtShort(mon)}–${fmtShort(fri)}${fri.getFullYear()}</div>
      </div>
      <div class="wt-right no-print">
        <button type="button" class="btn ink-toggle ${ink.on ? 'on' : ''}" data-inkbtn="toggle" title="Handschrift mit dem Stift" aria-pressed="${ink.on}" aria-label="Handschrift">✍</button>
        <button type="button" class="btn undo-btn" data-undo title="Letzte Änderung rückgängig machen (Ctrl+Z)" aria-label="Letzte Änderung rückgängig machen" ${undoStack.length ? '' : 'disabled'}>↶</button>
        <button type="button" class="btn" data-week="-1" aria-label="Vorherige Woche">‹</button>
        <button type="button" class="btn" data-week="0">Aktuelle Woche</button>
        <button type="button" class="btn" data-week="1" aria-label="Nächste Woche">›</button>
        <input type="date" class="btn" data-jump value="${mk}" aria-label="Zu Datum springen">
        <button type="button" class="btn" data-print>Drucken</button>
      </div>
    </div>
    <div class="wh-band">
      <label class="wh-notes"><span>Anmerkungen zur Woche:</span><textarea data-weeknote="${mk}" rows="1" placeholder="z. B. Schulreise am Donnerstag, Elterngespräche">${esc(state.weekNotes[mk] || '')}</textarea></label>
      <div class="wh-legend">
        <label class="lg-toggle no-print" title="${myDays.length ? 'Blendet die Tage aus, an denen du laut Stundenplan nicht unterrichtest' : 'Lege zuerst im Stundenplan fest, wer wann unterrichtet'}"><input type="checkbox" data-hideother ${state.settings.hideOtherDays ? 'checked' : ''} ${myDays.length ? '' : 'disabled'}> Nur meine Tage</label>
        <span><i class="lg me"></i>${esc(myName())}</span>
        <span><i class="lg partner"></i>${esc(partnerName())}</span>
        <span><i class="lg both"></i>Beide</span>
        ${state.settings.partner.email ? `<a href="mailto:${esc(state.settings.partner.email)}" class="lg-link no-print">✉</a>` : ''}${state.settings.partner.phone ? `<a href="tel:${esc(state.settings.partner.phone.replace(/\s+/g, ''))}" class="lg-link no-print">☎</a>` : ''}
      </div>
    </div>
  </section>
  ${ink.on ? inkBarHTML(mk) : ''}
  ${lessonClip ? `<div class="clip-bar no-print" role="status"><span>📋 <b>${esc(lessonClip.label)}</b> kopiert. Tippe auf eine Lektion, um sie dort einzufügen, auch in einer anderen Woche.</span><button type="button" class="btn small primary" data-clipclear>Fertig</button></div>` : ''}
  ${ttEmpty ? `<div class="notice no-print">Lege zuerst in den <button type="button" class="link" data-go="settings">Einstellungen</button> deinen Stundenplan fest. Danach erscheinen die Fächer automatisch in jeder Woche. Du kannst aber auch direkt in eine Lektion klicken und etwas eintragen.</div>` : ''}
  ${holName ? `<div class="notice holiday">${esc(holName)}: Diese Woche ist unterrichtsfrei.</div>` : ''}
  ${offNotes.length ? `<div class="off-notes">${offNotes.map(x => `<span class="off-chip ${x.type}">${x.type === 'feiertag' ? 'Feiertag ' : 'schulfrei '}${esc(x.label)}</span>`).join('')}</div>` : ''}
  ${Object.keys(rowScale).length ? '<p class="row-reset no-print"><button type="button" class="link" data-rowreset>Zeilenhöhen zurücksetzen</button></p>' : ''}
  <section class="week-grid ${lessonClip ? 'clip-mode' : ''}" style="--ndays:${shownDays.length};--headh:${52 + (chipRow ? 20 : 0) + (headExtra ? 40 : 0)}px;--tasksh:${(maxTasks + 1) * 26 + 8}px;--hwh:${(maxHw + 1) * 26 + 8}px">
    <div class="times">
      <div class="day-head corner"></div>
      <div class="dtasks label" title="Notizen und Erledigungen pro Tag">🕘</div>
      <div class="dtasks dhw label" title="Hausaufgaben, die auf diesen Tag zu lösen sind">HA</div>
      ${timesCol}
    </div>
    ${cols}
  </section>
  ${gamesHTML(mk, n)}
  </div>
  <aside class="pages no-print" aria-label="Seiten">
    <div class="pages-head">Seiten</div>
    <div class="pages-list">${pagesHTML()}</div>
  </aside>
  </div>`;
  autosizeAll(v);
  fitFlows(v);
  inkSetup(v, mk);
  rowGripSetup(v);
  peekSetup(v);
  const pl = v.querySelector('.pages-list'), act = pl && pl.querySelector('.active');
  if (act) pl.scrollTop = act.offsetTop - pl.clientHeight / 3;

  v.onclick = e => {
    const t = e.target.closest('[data-rowgrip],[data-rowreset],[data-clipclear],[data-pagetoggle],[data-inkbtn],[data-inkcolor],[data-inkw],[data-inkhl],[data-undo],[data-gameroll],[data-merge],[data-split],[data-fixed],[data-pres],[data-cwopen],[data-place],[data-addbdg],[data-openplan],[data-gotoweek],[data-lesson],[data-week],[data-print],[data-go],[data-deltodo]');
    if (!t) return;
    const ds = t.dataset;
    if (ds.rowgrip) return;
    if ('rowreset' in ds) { rowScale = {}; try { localStorage.removeItem('uh-rowscale'); } catch {} render(); return; }
    if ('clipclear' in ds) { lessonClip = null; clipSave(); render(); return; }
    if (ds.pagetoggle) { pagesToggle(ds.pagetoggle); const pl = v.querySelector('.pages-list'), y = pl ? pl.scrollTop : 0; render(); const pl2 = v.querySelector('.pages-list'); if (pl2) pl2.scrollTop = y; return; }
    if (ds.pageweek) {
      // aktuelle Woche: Planungen ein- oder ausblenden; andere Woche: dorthin wechseln und Planungen zeigen
      if (ds.pageweek === mk) { pagesToggle(mk); const pl = v.querySelector('.pages-list'), y = pl ? pl.scrollTop : 0; render(); const pl2 = v.querySelector('.pages-list'); if (pl2) pl2.scrollTop = y; return; }
      pagesToggle(ds.pageweek, true);
    }
    if (ds.inkbtn || ds.inkcolor || ds.inkw || ds.inkhl) {
      if (ds.inkbtn === 'toggle') ink.on = !ink.on;
      else if (ds.inkbtn === 'pen' || ds.inkbtn === 'erase' || ds.inkbtn === 'marker') ink.tool = ds.inkbtn;
      if (ds.inkhl) { ink.hl = ds.inkhl; ink.tool = 'marker'; }
      else if (ds.inkbtn === 'clear') { if (!(state.ink[mk] || []).length || !confirm('Alle Handschrift auf dieser Wochenseite löschen?')) return; delete state.ink[mk]; save(); }
      if (ds.inkcolor) { ink.color = ds.inkcolor; ink.tool = 'pen'; }
      if (ds.inkw) { ink.width = Number(ds.inkw); ink.tool = 'pen'; }
      inkPrefsSave(); render(); return;
    }
    if ('undo' in ds) { undo(); return; }
    if (ds.gameroll) {
      const r = state.gameRoll[mk] || (state.gameRoll[mk] = {});
      (ds.gameroll === 'all' ? Object.keys(GAME_KINDS) : [ds.gameroll]).forEach(k => { r[k] = (r[k] || 0) + 1; });
      save(); render(); return;
    }
    if (ds.pres) { openPresEdit(ds.pres); return; }
    if (ds.fixed) { openFixedEdit(ds.fixed); return; }
    if (ds.merge) { const [di, a, b] = ds.merge.split('|'); mergeLessons(di, a, b); save(); render(); return; }
    if (ds.split) { const l = state.lessons[ds.split]; if (l) delete l.mergeNext; save(); render(); return; }
    if (ds.cwopen) { cwOpen = ds.cwopen; currentView = 'cowork'; render(); window.scrollTo(0, 0); return; }
    if (ds.place) openPlaced(ds.place, ds.date);
    else if (ds.addbdg) { const [di, pos] = ds.addbdg.split('|'); openPicker(di, pos); }
    else if (ds.openplan) { currentMonday = monday(parse(ds.openplan.split('|')[0])); render(); openLesson(ds.openplan); }
    else if (ds.gotoweek) { currentMonday = parse(ds.gotoweek); render(); window.scrollTo(0, 0); }
    else if (ds.lesson) { peekHide(); if (lessonClip) pasteClip(ds.lesson); else openLesson(ds.lesson); }
    else if (ds.week !== undefined) {
      const k = Number(ds.week);
      currentMonday = k === 0 ? thisPlanningWeek() : addDays(currentMonday, 7 * k);
      render();
    } else if ('print' in ds) window.print();
    else if (ds.go) { currentView = ds.go; scrollYearToNow = true; render(); }
    else if (ds.deltodo) { state.todos = state.todos.filter(x => x.id !== ds.deltodo); save(); render(); }
  };
  // Lektion per Drag-and-drop kopieren: Ziel wird überschrieben, Quelle bleibt
  let dragKey = null;
  v.ondragstart = e => {
    if (rowDrag) { e.preventDefault(); return; }
    peekHide();
    const c = e.target.closest('.cell[draggable="true"]');
    if (!c) return;
    dragKey = c.dataset.lesson;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', dragKey);
    c.classList.add('dragging');
  };
  v.ondragover = e => {
    const c = e.target.closest('.cell[data-lesson]');
    if (!c || !dragKey || c.dataset.lesson === dragKey) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    v.querySelectorAll('.cell.drop-target').forEach(x => x !== c && x.classList.remove('drop-target'));
    c.classList.add('drop-target');
  };
  v.ondragleave = e => { const c = e.target.closest('.cell'); if (c && !c.contains(e.relatedTarget)) c.classList.remove('drop-target'); };
  v.ondragend = () => { dragKey = null; v.querySelectorAll('.dragging,.drop-target').forEach(x => x.classList.remove('dragging', 'drop-target')); };
  v.ondrop = e => {
    const c = e.target.closest('.cell[data-lesson]');
    const from = dragKey || e.dataTransfer.getData('text/plain');
    if (!c || !from || c.dataset.lesson === from) return;
    e.preventDefault();
    moveLesson(from, c.dataset.lesson);
    dragKey = null; save(); render();
  };
  v.onkeydown = e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-fixed]')) { e.preventDefault(); openFixedEdit(e.target.dataset.fixed); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-pres]')) { e.preventDefault(); openPresEdit(e.target.dataset.pres); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-lesson]')) { e.preventDefault(); if (lessonClip) pasteClip(e.target.dataset.lesson); else openLesson(e.target.dataset.lesson); }
    if (e.key === 'Escape' && lessonClip) { lessonClip = null; clipSave(); render(); }
    if (e.key === 'Enter' && e.target.matches('[data-dtasknew],[data-dtask]')) { e.preventDefault(); e.target.blur(); }
  };
  v.onchange = e => {
    const ds = e.target.dataset;
    if (e.target.matches('[data-gamesout]')) { state.settings.gamesOutdoor = e.target.checked; save(); render(); return; }
    if (e.target.matches('[data-hideother]')) { state.settings.hideOtherDays = e.target.checked; save(); render(); return; }
    if (e.target.matches('[data-jump]') && e.target.value) { currentMonday = monday(parse(e.target.value)); render(); }
    else if (ds.todo) { const t = state.todos.find(x => x.id === ds.todo); if (t) { t.done = e.target.checked; save(); render(); } }
    else if (ds.dtaskdone) {
      const L = state[ds.list || 'dayTasks'];
      const [di, id] = ds.dtaskdone.split('|'); const t = (L[di] || []).find(x => x.id === id);
      if (t) { t.done = e.target.checked; e.target.closest('.dtask').classList.toggle('done', t.done); save(); }
    } else if (ds.dtasknew) {
      const text = e.target.value.trim();
      const L = state[ds.list || 'dayTasks'];
      if (text) { (L[ds.dtasknew] = L[ds.dtasknew] || []).push({ id: uid(), text, done: false }); save(); render(); }
    } else if (ds.dtask) {
      const [di, id] = ds.dtask.split('|');
      const L = state[ds.list || 'dayTasks'];
      if (!e.target.value.trim()) { L[di] = (L[di] || []).filter(x => x.id !== id); if (!L[di].length) delete L[di]; save(); render(); }
    }
  };
  v.oninput = e => {
    const ds = e.target.dataset;
    if (ds.weeknote) {
      if (e.target.value.trim()) state.weekNotes[ds.weeknote] = e.target.value; else delete state.weekNotes[ds.weeknote];
      autosize(e.target); save();
    } else if (ds.meta) {
      const m = state.weekMeta[mk] || (state.weekMeta[mk] = {});
      m[ds.meta] = e.target.value; save();
    } else if (ds.dspecial) {
      if (e.target.value.trim()) state.daySpecial[ds.dspecial] = e.target.value; else delete state.daySpecial[ds.dspecial];
      save();
    } else if (ds.dtask) {
      const [di, id] = ds.dtask.split('|'); const t = (state[ds.list || 'dayTasks'][di] || []).find(x => x.id === id);
      if (t) {
        t.text = e.target.value; save();
        if (ds.list === 'dayHomework') { const sb = haSubject(t.text); e.target.classList.toggle('ha-sub', !!sb); if (sb) e.target.style.setProperty('--hac', sb.color); else e.target.style.removeProperty('--hac'); }
      }
    }
  };

}

// ----- Kennzeichen setzen und entfernen -----
const pick = $('#pickDlg');
let pickCtx = null;
function openPicker(di, pos) {
  pickCtx = { di, pos };
  const date = parse(di);
  const bs = state.settings.badges;
  const isMittag = (weekRows().find(x => x.pos === pos) || {}).kind === 'mittag';
  pick.innerHTML = `<form method="dialog" class="pick">
    <h2>Kennzeichen hinzufügen</h2>
    <p class="muted">${DAYS_LONG[dayIdx(di)]} ${fmtShort(date)} · ${posLabel(pos)}</p>
    ${bs.length ? `<div class="pick-grid">${bs.map(b => `<button type="button" class="pick-item" data-pickb="${b.id}">${bImg(b)}<span>${esc(b.name)}</span></button>`).join('')}</div>`
      : '<p>Noch keine Kennzeichen vorhanden.</p>'}
    ${isMittag ? `<div class="meet-form">
      <h3>Besprechung</h3>
      <div class="add-inline"><input name="mtitle" placeholder="z. B. Besprechung SHP, Elterngespräch" aria-label="Besprechung"><input type="time" name="mtime" aria-label="Zeit"><button type="button" class="btn small primary" data-addmeet>Hinzufügen</button></div>
    </div>` : ''}
    <fieldset class="seg"><legend class="sr">Wiederholung</legend>
      <label><input type="radio" name="rep" value="once" checked> Nur diese Woche</label>
      <label><input type="radio" name="rep" value="weekly"> Jede Woche</label>
    </fieldset>
    <div class="pick-foot"><button type="button" class="link" data-managebadges>Kennzeichen verwalten</button><button class="btn" value="cancel">Abbrechen</button></div>
  </form>`;
  fillImgs(pick);
  pick.showModal();
}
function openPresEdit(id) {
  const p = state.presence.find(x => x.id === id);
  if (!p) return;
  pickCtx = { presId: id };
  pick.innerHTML = `<form method="dialog" class="pick">
    <h2>Präsenz-Eintrag</h2>
    <div class="form-row col" style="margin-top:12px">
      <label class="field"><span>Bezeichnung</span><input name="ptitle" value="${esc(p.title)}"></label>
      <div class="form-row">
        <label class="field"><span>Datum</span><input type="date" name="pdate" value="${p.date}"></label>
        <label class="field"><span>Zeit</span><select name="pblock">${Object.entries(PRES_BLOCKS).map(([k, t]) => `<option value="${k}" ${p.block === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Art (Farbe)</span><select name="pcat">${Object.entries(PRES_CATS).map(([k, x]) => `<option value="${k}" ${p.cat === k ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Ergänzung</span><textarea name="pnote" rows="2" placeholder="z. B. Raum, Vorbereitung, Leitung">${esc(p.note || '')}</textarea></label>
    </div>
    ${p.cat === 'ut' ? `<p><button type="button" class="btn small" data-presagenda>Traktanden im CoWork bearbeiten</button></p>` : ''}
    <div class="pick-foot">
      <button type="button" class="btn danger small" data-presdel>Löschen</button>
      <span class="btn-row"><button class="btn" value="cancel">Abbrechen</button><button type="button" class="btn primary" data-pressave>Speichern</button></span>
    </div>
  </form>`;
  pick.showModal();
  pick.querySelector('[name=ptitle]').focus();
}

function openPlaced(placeId, di) {
  const p = state.placements.find(x => x.id === placeId);
  const b = p && (p.meeting ? { name: p.meeting.title } : badge(p.badgeId));
  if (!p || !b) return;
  pickCtx = { placeId, di };
  pick.innerHTML = `<form method="dialog" class="pick">
    <div class="placed">${p.meeting ? '<span class="meet-icon">👥</span>' : bImg(b)}<div><h2>${esc(b.name)}</h2>${p.meeting && p.meeting.time ? `<p>${esc(p.meeting.time)} Uhr</p>` : ''}<p class="muted">${DAYS_LONG[dayIdx(di)]} ${fmtShort(parse(di))} · ${posLabel(p.pos)}${p.repeat ? ' · jede Woche' : ''}</p></div></div>
    ${p.meeting ? meetDetailsHTML(p, di) : ''}
    <div class="pick-foot">
      ${p.repeat ? `<button type="button" class="btn danger small" data-rm="week">Nur diese Woche entfernen</button><button type="button" class="btn danger small" data-rm="all">Ab jetzt nicht mehr</button>`
        : '<button type="button" class="btn danger small" data-rm="all">Entfernen</button>'}
      <button class="btn" value="cancel">Schliessen</button>
    </div>
  </form>`;
  fillImgs(pick);
  pick.classList.toggle('wide', !!p.meeting);
  if (!pick.open) pick.showModal();
  autosizeAll(pick);
}
// Details zu einer Besprechung am Mittag: Teilnehmende gelten für die ganze Serie, der Rest pro Termin
function meetDetailsHTML(p, di) {
  const dk = p.id + '|' + di, d = state.meetDetails[dk] || {};
  const tasks = state.todos.filter(t => t.meetPlace === dk);
  return `<div class="meet-details">
    <label class="field"><span>Teilnehmende Personen${p.repeat ? ' <small class="muted">(gilt für jede Woche)</small>' : ''}</span><input data-md="people" value="${esc(p.meeting.people || '')}" placeholder="z. B. SHP, Klassenlehrperson, Schulleitung"></label>
    <label class="field"><span>Traktanden</span><textarea data-md="agenda" rows="3" placeholder="Ein Traktandum pro Zeile">${esc(d.agenda || '')}</textarea></label>
    <div class="field"><span>Aufgaben <small class="muted">(erscheinen auch unter Termine &amp; To-dos)</small></span>
      <ul class="todo-list compact">${tasks.map(t => `<li class="${t.done ? 'done' : ''}"><label><input type="checkbox" data-mdtodo="${t.id}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label><button type="button" class="icon-btn" data-mddel="${t.id}" aria-label="Aufgabe löschen">✕</button></li>`).join('')}</ul>
      <div class="add-inline"><input data-mdnew placeholder="Neue Aufgabe" aria-label="Neue Aufgabe"><button type="button" class="btn small" data-mdadd>+</button></div>
    </div>
    <label class="field"><span>Beobachtungspunkte</span><textarea data-md="observe" rows="3" placeholder="Was beobachten wir bis zur nächsten Besprechung?">${esc(d.observe || '')}</textarea></label>
  </div>`;
}
function meetAddTask() {
  const inp = pick.querySelector('[data-mdnew]'), text = inp && inp.value.trim();
  if (!text || !pickCtx) return;
  const p = state.placements.find(x => x.id === pickCtx.placeId);
  state.todos.push({ id: uid(), text, due: '', done: false, meetPlace: p.id + '|' + pickCtx.di, meetTitle: p.meeting.title + ' ' + fmtShort(parse(pickCtx.di)) });
  save(); openPlaced(pickCtx.placeId, pickCtx.di);
  pick.querySelector('[data-mdnew]')?.focus();
}
pick.addEventListener('input', e => {
  const f = e.target.dataset.md;
  if (!f || !pickCtx || !pickCtx.placeId) return;
  const p = state.placements.find(x => x.id === pickCtx.placeId);
  if (f === 'people') p.meeting.people = e.target.value;
  else {
    const dk = p.id + '|' + pickCtx.di, d = state.meetDetails[dk] || (state.meetDetails[dk] = {});
    d[f] = e.target.value;
    if (!Object.values(d).some(v => (v || '').trim())) delete state.meetDetails[dk];
    autosize(e.target);
  }
  save();
});
pick.addEventListener('change', e => {
  const id = e.target.dataset.mdtodo; if (!id) return;
  const t = state.todos.find(x => x.id === id);
  if (t) { t.done = e.target.checked; e.target.closest('li').classList.toggle('done', t.done); save(); }
});
pick.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('[data-mdnew]')) { e.preventDefault(); meetAddTask(); }
  else if (e.key === 'Enter' && e.target.matches('[data-md="people"]')) e.preventDefault();
});
pick.addEventListener('click', e => {
  if (e.target === pick) { pick.close(); return; }
  if (pickCtx && pickCtx.placeId) {
    if (e.target.closest('[data-mdadd]')) { meetAddTask(); return; }
    const del = e.target.closest('[data-mddel]');
    if (del) { state.todos = state.todos.filter(x => x.id !== del.dataset.mddel); save(); openPlaced(pickCtx.placeId, pickCtx.di); return; }
  }
  if (pickCtx && pickCtx.fixedId) {
    const x = state.fixed.find(f => f.id === pickCtx.fixedId);
    const q = n => pick.querySelector(`[name=${n}]`).value;
    if (e.target.closest('[data-fxsave]')) {
      Object.assign(x, { title: q('ftitle').trim() || x.title, date: q('fdate') || x.date, from: q('ffrom') || x.from, to: q('fto') || x.to, note: q('fnote').trim() });
      save(); pick.close(); return;
    }
    const del = e.target.closest('[data-fxdel]');
    if (del) {
      if (del.dataset.fxdel === 'all') { if (!confirm(`Alle Einträge «${x.title}» löschen?`)) return; state.fixed = state.fixed.filter(f => f.title !== x.title); }
      else state.fixed = state.fixed.filter(f => f.id !== x.id);
      save(); pick.close(); return;
    }
  }
  if (pickCtx && pickCtx.presId) {
    const p = state.presence.find(x => x.id === pickCtx.presId);
    const q = n => pick.querySelector(`[name=${n}]`).value;
    if (e.target.closest('[data-pressave]') || e.target.closest('[data-presagenda]')) {
      Object.assign(p, { title: q('ptitle').trim() || p.title, date: q('pdate') || p.date, block: q('pblock'), cat: q('pcat'), note: q('pnote').trim() });
      save();
      if (e.target.closest('[data-presagenda]')) { syncUtMeetings(); const m = state.meetings.find(x => x.presId === p.id); cwOpen = m ? m.id : null; currentView = 'cowork'; }
      pick.close(); return;
    }
    if (e.target.closest('[data-presdel]')) {
      if (!confirm('Diesen Präsenz-Eintrag löschen?')) return;
      state.presence = state.presence.filter(x => x.id !== p.id); save(); pick.close(); return;
    }
  }
  if (e.target.closest('[data-addmeet]') && pickCtx) {
    const title = pick.querySelector('[name=mtitle]').value.trim();
    if (!title) { pick.querySelector('[name=mtitle]').focus(); return; }
    const time = pick.querySelector('[name=mtime]').value;
    const { di, pos } = pickCtx;
    const weekly = pick.querySelector('input[name=rep]:checked')?.value === 'weekly';
    state.placements.push(weekly
      ? { id: uid(), meeting: { title, time }, pos, repeat: true, day: dayIdx(di) + 1, from: iso(monday(parse(di))), skip: [] }
      : { id: uid(), meeting: { title, time }, pos, repeat: false, date: di });
    save(); pick.close(); return;
  }
  const pb = e.target.closest('[data-pickb]');
  if (pb && pickCtx) {
    const { di, pos } = pickCtx;
    const weekly = pick.querySelector('input[name=rep]:checked')?.value === 'weekly';
    state.placements.push(weekly
      ? { id: uid(), badgeId: pb.dataset.pickb, pos, repeat: true, day: dayIdx(di) + 1, from: iso(monday(parse(di))), skip: [] }
      : { id: uid(), badgeId: pb.dataset.pickb, pos, repeat: false, date: di });
    save(); pick.close(); return;
  }
  const rm = e.target.closest('[data-rm]');
  if (rm && pickCtx) {
    const p = state.placements.find(x => x.id === pickCtx.placeId);
    const mk = iso(monday(parse(pickCtx.di)));
    if (rm.dataset.rm === 'week') (p.skip = p.skip || []).push(mk);
    else if (p.repeat && p.from < mk) {
      // ab dieser Woche beenden, frühere Wochen bleiben erhalten
      p.skip = p.skip || [];
      endRepeat(p, mk);
    } else state.placements = state.placements.filter(x => x.id !== p.id);
    save(); pick.close(); return;
  }
  if (e.target.closest('[data-managebadges]')) {
    pick.close(); if (dlg.open) dlg.close();
    currentView = 'settings'; render();
    setTimeout(() => $('#badgeSettings')?.scrollIntoView({ block: 'start' }), 50);
  }
});
function endRepeat(p, mk) {
  // Wiederholung endet vor Woche mk: alle späteren Wochen überspringen
  const end = parse(state.settings.end);
  for (let m = parse(mk); m <= end; m = addDays(m, 7)) if (!p.skip.includes(iso(m))) p.skip.push(iso(m));
}
pick.addEventListener('close', () => {
  pickCtx = null; pick.classList.remove('wide');
  if (dlg.open && openLessonKey) openLesson(openLessonKey); else render();
});

// ----- Lektion (Seitenpanel) -----
const dlg = $('#lessonDlg');
const LESSON_FIELDS = ['title', 'goals', 'lp21', 'flow', 'material', 'homework', 'reflection'];
const REPEAT_FIELDS = ['subjectId', 'title', 'goals', 'lp21', 'flow', 'material', 'homework'];
// Ende des 1. Semesters: letzter Schultag vor den Sportferien; danach Schuljahresende
function semesterEnd(di) {
  const c = calYear(), sport = c && c.ferien.find(f => /Sport/.test(f[0]));
  if (sport && di < sport[1]) return iso(addDays(parse(sport[1]), -1));
  return state.settings.end;
}
// Bild oder Datei nur löschen, wenn keine andere Lektion sie noch verwendet
async function releaseBlob(id, exceptKey) {
  const inClip = lessonClip && ((lessonClip.data.images || []).includes(id) || (lessonClip.data.files || []).some(f => f.id === id));
  const used = inClip || Object.entries(state.lessons).some(([k, l]) => k !== exceptKey && ((l.images || []).includes(id) || (l.files || []).some(f => f.id === id)));
  if (!used) await idbDel('images', id);
}
function repeatLesson(key, mode) {
  const [di, slotId] = key.split('|');
  const src = state.lessons[key] || {};
  const until = mode === 'next' ? iso(addDays(parse(di), 7)) : mode === 'sem' ? semesterEnd(di) : state.settings.end;
  const targets = [];
  for (let d = addDays(parse(di), 7); iso(d) <= until; d = addDays(d, 7)) if (!offDay(iso(d))) targets.push(iso(d) + '|' + slotId);
  if (!targets.length) return 'Keine weitere Schulwoche im gewählten Zeitraum.';
  const filled = targets.filter(k => { const l = state.lessons[k]; return l && LESSON_FIELDS.some(f => (l[f] || '').trim()); });
  if (filled.length && !confirm(`${filled.length} von ${targets.length} Lektionen haben schon Einträge. Überschreiben?`)) return 'Abgebrochen.';
  const chainR = slotChain(di, slotId);
  for (const k of targets) {
    const tdi = k.split('|')[0];
    if (chainR.length > 1) chainR.slice(0, -1).forEach(x => { const kk = tdi + '|' + x.id; (state.lessons[kk] = state.lessons[kk] || { images: [], files: [] }).mergeNext = true; });
    const l = state.lessons[k] = state.lessons[k] || { images: [], files: [] };
    for (const f of REPEAT_FIELDS) { if (src[f]) l[f] = src[f]; else delete l[f]; }
    l.images = [...new Set([...(l.images || []), ...(src.images || [])])];
    const fids = new Set((l.files || []).map(x => x.id));
    l.files = [...(l.files || []), ...(src.files || []).filter(x => !fids.has(x.id)).map(x => ({ ...x }))];
  }
  save();
  return `In ${targets.length} Lektion${targets.length === 1 ? '' : 'en'} übernommen, bis ${fmtShort(parse(targets[targets.length - 1].split('|')[0]))}${targets[targets.length - 1].slice(0, 4)}.`;
}
function ensureLesson(key) { return state.lessons[key] || (state.lessons[key] = { images: [], files: [] }); }
function pruneLesson(key) {
  const l = state.lessons[key];
  if (!l) return;
  const empty = LESSON_FIELDS.every(f => !(l[f] || '').trim()) && !(l.images || []).length && !(l.files || []).length && !l.cancelled && !l.lk && !l.subjectId && !l.who && !l.mergeNext;
  if (empty) delete state.lessons[key];
}

function openLesson(key) {
  openLessonKey = key;
  const [di, slotId] = key.split('|');
  const date = parse(di), d = dayIdx(di);
  const s = state.settings;
  const sl0 = s.slots.find(x => x.id === slotId) || { from: '', to: '' };
  const chainL = slotChain(di, slotId);
  const sl = chainL.length > 1 ? { from: chainL[0].from, to: chainL[chainL.length - 1].to } : sl0;
  const les = state.lessons[key] || {};
  const ttSid = s.timetable[(d + 1) + '-' + slotId];
  const sub = subj(les.subjectId || ttSid);
  const scrollTop = dlg.querySelector('.panel-body')?.scrollTop || 0;
  const field = (f, label, ph, rows = 2) =>
    `<label class="field"><span>${label}</span><textarea data-f="${f}" rows="${rows}" placeholder="${ph}">${esc(les[f] || '')}</textarea></label>`;

  dlg.innerHTML = `
  <form method="dialog" class="panel-inner" style="--c:${sub ? sub.color : '#8a8f98'}">
    <header class="panel-head">
      <div>
        <small>Lektionsplanung · ${whoAt(di, slotId) !== 'me' ? esc(WHO_LABEL(whoAt(di, slotId))) + ' · ' : ''}${DAYS_LONG[d]} ${fmtShort(date)}${date.getFullYear()} · ${sl.from}–${sl.to}</small>
        <h2>${sub ? esc(sub.name) : 'Lektion'}${chainL.length > 1 ? ` <small class="dbl-h">${chainL.length === 2 ? 'Doppellektion' : 'Dreifachlektion'}</small>` : ''}</h2>
      </div>
      <button class="icon-btn" value="close" aria-label="Schliessen">✕</button>
    </header>
    <div class="panel-body">
      <div class="form-row">
        <label class="field"><span>Fach</span>
          <select data-f="subjectId">
            <option value="">${ttSid ? 'wie Stundenplan (' + esc(subj(ttSid)?.name || '') + ')' : '– kein Fach –'}</option>
            ${s.subjects.map(x => `<option value="${x.id}" ${les.subjectId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Wer unterrichtet</span>
          <select data-f="who">
            <option value="">wie Stundenplan (${esc(WHO_LABEL(whoPlan(d + 1, slotId)))})</option>
            ${['me', 'partner', 'both'].map(w => `<option value="${w}" ${les.who === w ? 'selected' : ''}>${esc(WHO_LABEL(w))}</option>`).join('')}
          </select>
        </label>
        <label class="check lk-check"><input type="checkbox" data-f="lk" ${les.lk ? 'checked' : ''}> Lernkontrolle</label>
        <label class="check"><input type="checkbox" data-f="cancelled" ${les.cancelled ? 'checked' : ''}> Lektion fällt aus</label>
      </div>
      <label class="field"><span>Thema der Lektion</span><input data-f="title" value="${esc(les.title || '')}" placeholder="z. B. Einstieg Perfekt"></label>
      ${field('flow', 'Ablauf', 'Einstieg, Erarbeitung, Übung, Abschluss …', 6)}
      <div class="form-row two">
        ${field('material', 'Material', 'Arbeitsblätter, Lehrmittel, Seiten …')}
        ${field('homework', 'Hausaufgaben', '–')}
      </div>
      ${field('goals', 'Lernziele', 'Ich kann …')}
      <section class="imgs" id="imgDrop">
        <div class="imgs-head">
          <h3>Bilder und Dateien</h3>
          <label class="btn small">Hinzufügen<input type="file" multiple hidden data-addfiles></label>
        </div>
        <div class="img-grid" id="imgGrid"></div>
        <ul class="file-list" id="fileList"></ul>
        <p class="hint">Bilder bleiben im Raster und verschieben nichts. PDF- und Word-Dateien erscheinen als Liste. Du kannst Bilder auch mit Ctrl+V einfügen oder Dateien hierher ziehen.</p>
      </section>
      ${field('reflection', 'Reflexion nach der Lektion', 'Was hat funktioniert? Was passe ich an?', 3)}
      <section class="imgs repeat-box">
        <div class="imgs-head"><h3>Wiederholen</h3></div>
        <p class="hint" style="margin:0 0 8px">Übernimmt Fach, Thema, Lernziele, Ablauf, Material, Hausaufgaben, Bilder und Dateien in die gleiche Lektion der folgenden Wochen. Ferien und Feiertage werden übersprungen.</p>
        <div class="btn-row">
          <button type="button" class="btn small" data-repeat="next">Nächste Woche</button>
          <button type="button" class="btn small" data-repeat="sem">Bis Semesterende${semesterEnd(di) ? ' (' + fmtShort(parse(semesterEnd(di))) + ')' : ''}</button>
          <button type="button" class="btn small" data-repeat="year">Bis Schuljahresende (${fmtShort(parse(state.settings.end))})</button>
        </div>
        <p class="hint repeat-msg" aria-live="polite"></p>
      </section>
      <div class="panel-foot">
        <span class="btn-row"><button type="button" class="btn small" data-copylesson title="Lektion kopieren und an einer anderen Stelle einfügen">📋 Kopieren</button><button type="button" class="btn danger small" data-clearlesson>Lektion leeren</button>${chainL.length > 1 ? '<button type="button" class="btn small" data-unmerge>Lektionen trennen</button>' : ''}</span>
        <button class="btn primary" value="close">Fertig</button>
      </div>
    </div>
  </form>`;
  if (!dlg.open) dlg.showModal();
  autosizeAll(dlg);
  fillImgs(dlg);
  renderAttachments();
  dlg.querySelector('.panel-body').scrollTop = scrollTop;
}

async function renderAttachments() {
  const grid = $('#imgGrid'), list = $('#fileList');
  if (!grid || !openLessonKey) return;
  const les = state.lessons[openLessonKey] || {};
  const ids = les.images || [], files = les.files || [];
  grid.innerHTML = ids.map(id => `<figure class="thumb"><img data-img="${id}" alt="Bild zur Lektion"><button type="button" class="thumb-del" data-delimg="${id}" aria-label="Bild entfernen">✕</button></figure>`).join('');
  grid.hidden = !ids.length;
  list.innerHTML = files.map(f => `<li><button type="button" class="link file-open" data-openfile="${f.id}">${/pdf/.test(f.type) ? '📕' : /word|docx?$/.test(f.type + f.name) ? '📘' : '📄'} ${esc(f.name)}</button><small class="muted">${fmtSize(f.size)}</small><button type="button" class="icon-btn" data-delfile="${f.id}" aria-label="Datei entfernen">✕</button></li>`).join('');
  if (!ids.length && !files.length) list.innerHTML = '<li class="muted">Noch nichts angehängt.</li>';
  for (const img of grid.querySelectorAll('img[data-img]')) img.src = await blobURL(img.dataset.img);
}

async function addFiles(files) {
  if (!openLessonKey) return;
  const les = ensureLesson(openLessonKey);
  les.images = les.images || []; les.files = les.files || [];
  for (const f of files) {
    const id = uid();
    if (f.type && f.type.startsWith('image/')) {
      await idbPut('images', id, await downscale(f));
      les.images.push(id);
    } else {
      await idbPut('images', id, f);
      les.files.push({ id, name: f.name || 'Datei', type: f.type || '', size: f.size || 0 });
    }
  }
  save();
  renderAttachments();
}

dlg.addEventListener('input', e => {
  const f = e.target.dataset.f;
  if (!f || !openLessonKey) return;
  const les = ensureLesson(openLessonKey);
  les[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (e.target.tagName === 'TEXTAREA') autosize(e.target);
  save();
  if (f === 'subjectId' || f === 'who') openLesson(openLessonKey);
});
dlg.addEventListener('change', e => {
  if (e.target.matches('[data-addfiles]')) { addFiles([...e.target.files]); e.target.value = ''; }
});
dlg.addEventListener('click', async e => {
  if (e.target === dlg) { dlg.close(); return; }
  if (e.target.closest('[data-copylesson]') && openLessonKey) {
    const k = openLessonKey; dlg.close(); copyLesson(k); render(); return;
  }
  if (e.target.closest('[data-unmerge]') && openLessonKey) {
    const [di, sid] = openLessonKey.split('|');
    for (const x of slotChain(di, sid)) { const l = state.lessons[di + '|' + x.id]; if (l) delete l.mergeNext; }
    save(); dlg.close(); return;
  }
  const rp = e.target.closest('[data-repeat]');
  if (rp && openLessonKey) {
    const msg = repeatLesson(openLessonKey, rp.dataset.repeat);
    const el = dlg.querySelector('.repeat-msg'); if (el) el.textContent = msg;
    return;
  }
  const t = e.target.closest('[data-delimg],[data-delfile],[data-openfile],img[data-img],[data-clearlesson],[data-addbdg],[data-place]');
  if (!t) return;
  const ds = t.dataset;
  const les = state.lessons[openLessonKey];
  if (ds.delimg) {
    les.images = les.images.filter(x => x !== ds.delimg);
    await releaseBlob(ds.delimg, openLessonKey); save(); renderAttachments();
  } else if (ds.delfile) {
    if (!confirm('Datei aus der Lektion entfernen?')) return;
    les.files = les.files.filter(x => x.id !== ds.delfile);
    await releaseBlob(ds.delfile, openLessonKey); save(); renderAttachments();
  } else if (ds.openfile) {
    const f = les.files.find(x => x.id === ds.openfile);
    const url = await blobURL(ds.openfile);
    if (/pdf|image|text/.test(f.type)) window.open(url, '_blank');
    else { const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
  } else if (ds.img) {
    const lb = $('#lightbox'); lb.querySelector('img').src = t.src; lb.showModal();
  } else if (ds.addbdg) {
    const [di, pos] = ds.addbdg.split('|'); openPicker(di, pos);
  } else if (ds.place) {
    openPlaced(ds.place, ds.date);
  } else if ('clearlesson' in ds) {
    if (!confirm('Alle Einträge dieser Lektion löschen?')) return;
    if (les) {
      for (const id of [...(les.images || []), ...(les.files || []).map(x => x.id)]) await releaseBlob(id, openLessonKey);
      delete state.lessons[openLessonKey];
    }
    save(); openLesson(openLessonKey);
  }
});
dlg.addEventListener('dragover', e => { e.preventDefault(); $('#imgDrop')?.classList.add('drag'); });
dlg.addEventListener('dragleave', () => $('#imgDrop')?.classList.remove('drag'));
dlg.addEventListener('drop', e => {
  e.preventDefault(); $('#imgDrop')?.classList.remove('drag');
  if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
});
document.addEventListener('paste', e => {
  if (!dlg.open || pick.open) return;
  const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); addFiles(files); }
});
dlg.addEventListener('close', () => {
  if (openLessonKey) pruneLesson(openLessonKey);
  openLessonKey = null;
  save(); render();
});
$('#lightbox').addEventListener('click', () => $('#lightbox').close());


// ----- CoWork -----
let cwOpen = null, cwFilter = 'all';
function inviteText(m) {
  const g = cwGroup(m.group);
  const subject = `Einladung ${g.id === 'ut' ? 'Sitzung Unterrichtsteam' : g.name} – ${fmtLong(m.date)}`;
  const lines = [
    g.id === 'partner' ? 'Liebe ' + (state.settings.partner.name || 'Pensenpartnerin').split(' ')[0] : g.id === 'shp' && state.settings.cowork.shp.name ? 'Liebe ' + state.settings.cowork.shp.name.split(' ')[0] : 'Liebe Kolleginnen und Kollegen',
    '',
    g.id === 'ut' ? 'Ich lade euch herzlich zur nächsten Sitzung des Unterrichtsteams ein.' : `Ich lade herzlich zu unserem Termin${m.title ? ' «' + m.title + '»' : ''} ein.`,
    '',
    `Datum: ${fmtLong(m.date)}`,
    meetingTime(m) ? `Zeit: ${meetingTime(m)} Uhr` : '',
    m.place ? `Ort: ${m.place}` : '',
    '',
    m.agenda.length ? 'Traktanden' : '',
    ...m.agenda.map((a, i) => `${i + 1}. ${a.text}`),
    m.agenda.length ? '' : '',
    'Weitere Anliegen nehme ich gerne bis am Vortag entgegen.',
    '',
    'Freundliche Grüsse',
    state.settings.me.name || ''
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === ''));
  return { to: (g.emails || '').split(/[;,\s]+/).filter(Boolean).join(';'), subject, body: lines.join('\n') };
}
function meetingCard(m) {
  const g = cwGroup(m.group), open = cwOpen === m.id, today = iso(new Date());
  const tasks = state.todos.filter(t => t.meeting === m.id);
  const head = `<button type="button" class="cw-head" data-cwtoggle="${m.id}">
      <span class="cw-date"><b>${m.date ? DAYS7[parse(m.date).getDay()] + ' ' + fmtShort(parse(m.date)) + parse(m.date).getFullYear() : 'ohne Datum'}</b><small>${esc(meetingTime(m))}</small></span>
      <span class="cw-chip" style="--gc:${g.color}">${esc(g.name)}</span>
      <span class="cw-title">${esc(m.title || '')}${m.place ? `<small> · ${esc(m.place)}</small>` : ''}</span>
      <span class="cw-meta">${m.agenda.length ? `${m.agenda.length} Trakt.` : ''}${tasks.length ? ` · ${tasks.filter(t => !t.done).length}/${tasks.length} Aufg.` : ''}</span>
      <span class="cw-caret">${open ? '▾' : '▸'}</span></button>`;
  if (!open) return `<li class="cw-card ${m.date && m.date < today ? 'past' : ''}" style="--gc:${g.color}">${head}</li>`;
  const pres = m.presId ? state.presence.find(p => p.id === m.presId) : null;
  return `<li class="cw-card open" style="--gc:${g.color}">${head}
    <div class="cw-body">
      <div class="form-row">
        ${pres ? `<p class="hint" style="margin:0">Aus den Präsenznachmittagen: ${esc(pres.title)}, ${esc(PRES_BLOCKS[pres.block])} Uhr. <button type="button" class="link" data-pres="${pres.id}">Präsenz-Eintrag bearbeiten</button></p>` : `
        <label class="field"><span>Gruppe</span><select data-mf="group">${cwGroups().map(x => `<option value="${x.id}" ${x.id === m.group ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Datum</span><input type="date" data-mf="date" value="${m.date || ''}"></label>
        <label class="field narrow"><span>von</span><input type="time" data-mf="time" value="${esc(m.time || '')}"></label>
        <label class="field narrow"><span>bis</span><input type="time" data-mf="end" value="${esc(m.end || '')}"></label>`}
      </div>
      <div class="form-row">
        ${pres ? '' : `<label class="field"><span>Thema</span><input data-mf="title" value="${esc(m.title || '')}" placeholder="z. B. Planung Projektwoche"></label>`}
        <label class="field"><span>Ort</span><input data-mf="place" value="${esc(m.place || '')}" placeholder="z. B. Lehrerzimmer"></label>
      </div>
      <div class="cw-cols">
        <section>
          <h3>Traktanden</h3>
          <ol class="cw-agenda">${m.agenda.map(a => `<li>
            <input data-agtext="${a.id}" value="${esc(a.text)}" aria-label="Traktandum">
            <button type="button" class="btn small" data-agtodo="${a.id}" title="Als Aufgabe in die To-do-Liste">→ To-do</button>
            <button type="button" class="icon-btn" data-agdel="${a.id}" aria-label="Traktandum entfernen">✕</button></li>`).join('')}</ol>
          <form class="add-inline" data-addag><input name="text" placeholder="Neues Traktandum" required aria-label="Neues Traktandum"><button class="btn small">+</button></form>
        </section>
        <section>
          <h3>Notizen</h3>
          <textarea data-mf="notes" rows="5" placeholder="Beschlüsse, Absprachen, offene Punkte …">${esc(m.notes || '')}</textarea>
          <h3 style="margin-top:12px">Aufgaben aus diesem Termin</h3>
          <ul class="todo-list compact">${tasks.map(t => `<li class="${t.done ? 'done' : ''}"><label><input type="checkbox" data-todo="${t.id}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label>${t.due ? `<small>bis ${fmtShort(parse(t.due))}</small>` : ''}<button type="button" class="icon-btn" data-deltodo="${t.id}" aria-label="Aufgabe löschen">✕</button></li>`).join('')}</ul>
          <form class="add-inline" data-addtask><input name="text" placeholder="Neue Aufgabe, z. B. aus den Notizen" required aria-label="Neue Aufgabe"><input type="date" name="due" aria-label="Fällig am"><button class="btn small">+</button></form>
          <p class="hint">Aufgaben erscheinen auch unter Termine &amp; To-dos.</p>
        </section>
      </div>
      <div class="cw-actions">
        <button type="button" class="btn primary small" data-invite>✉ Einladung per Mail</button>
        <button type="button" class="btn small" data-invitecopy>Einladungstext kopieren</button>
        ${m.date ? `<button type="button" class="btn small" data-gotoweek="${iso(monday(parse(m.date)))}">Woche öffnen</button>` : ''}
        ${pres ? '' : '<button type="button" class="btn danger small" data-mdel>Termin löschen</button>'}
      </div>
      ${!cwGroup(m.group).emails ? `<p class="hint">Für die Einladung fehlen noch E-Mail-Adressen. Du erfasst sie in den <button type="button" class="link" data-go="settings">Einstellungen</button> unter «CoWork».</p>` : ''}
    </div></li>`;
}
function renderCowork(v) {
  const groups = cwGroups(), today = iso(new Date());
  const all = [...state.meetings].sort((a, b) => ((a.date || '9') + (a.time || '')).localeCompare((b.date || '9') + (b.time || '')));
  const list = all.filter(m => cwFilter === 'all' || m.group === cwFilter);
  const up = list.filter(m => !m.date || m.date >= today), past = list.filter(m => m.date && m.date < today).reverse();
  const openTasks = state.todos.filter(t => (t.meeting || todoGroupId(t)) && !t.done);
  v.innerHTML = `
  <section class="page-head"><h1>CoWork</h1><p class="hint">Termine für die Zusammenarbeit planen, Traktanden und Notizen festhalten und daraus Aufgaben erstellen. Die Sitzungen des Unterrichtsteams kommen automatisch aus den Präsenznachmittagen.</p></section>
  <div class="cw-filter">
    <button type="button" class="cw-f ${cwFilter === 'all' ? 'active' : ''}" data-cwf="all">Alle <small>${all.length}</small></button>
    ${groups.map(g => `<button type="button" class="cw-f ${cwFilter === g.id ? 'active' : ''}" data-cwf="${g.id}" style="--gc:${g.color}">${esc(g.name)} <small>${all.filter(m => m.group === g.id).length}</small></button>`).join('')}
  </div>
  <div class="cw-layout">
    <div>
      <section class="card">
        <h2>Neuer Termin</h2>
        <form class="add-form" data-addmeeting>
          <select name="group" aria-label="Gruppe">${groups.filter(g => g.id !== 'ut').map(g => `<option value="${g.id}" ${cwFilter === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="ut" ${cwFilter === 'ut' ? 'selected' : ''}>U-Team (zusätzlich)</option></select>
          <input type="date" name="date" required aria-label="Datum">
          <input type="time" name="time" aria-label="Beginn">
          <input name="title" placeholder="Thema, z. B. Planung ELO-Tag" aria-label="Thema">
          <button class="btn primary">Erstellen</button>
        </form>
      </section>
      <h4>Anstehend</h4>
      <ul class="cw-list">${up.map(meetingCard).join('') || '<li class="muted">Keine anstehenden Termine.</li>'}</ul>
      ${past.length ? `<details ${past.some(m => m.id === cwOpen) ? 'open' : ''}><summary>Vergangen (${past.length})</summary><ul class="cw-list">${past.map(meetingCard).join('')}</ul></details>` : ''}
    </div>
    <aside class="card cw-side">
      <h2>Offene Aufgaben</h2>
      <ul class="todo-list compact">${openTasks.map(t => { const m = state.meetings.find(x => x.id === t.meeting); const gid = todoGroupId(t); const g = gid ? cwGroup(gid) : null; return `<li><label><input type="checkbox" data-todo="${t.id}"><span>${esc(t.text)}</span></label>${g ? (m ? `<button type="button" class="tag cw" data-cwtoggle="${m.id}" style="--gc:${g.color}">${esc(g.name)}</button>` : `<span class="tag cw" style="--gc:${g.color}">${esc(g.name)}</span>`) : ''}</li>`; }).join('') || '<li class="muted">Keine offenen Aufgaben.</li>'}</ul>
      <h2 style="margin-top:18px">Gruppen</h2>
      <ul class="cw-groups">${groups.map(g => `<li><span class="cw-chip" style="--gc:${g.color}">${esc(g.name)}</span><small class="muted">${esc(g.long)}${g.emails ? '' : ' · keine E-Mail'}</small></li>`).join('')}</ul>
      <button type="button" class="link" data-go="settings">Gruppen und Adressen verwalten</button>
    </aside>
  </div>`;
  autosizeAll(v);
  const cur = () => state.meetings.find(m => m.id === cwOpen);
  v.onclick = async e => {
    const t = e.target.closest('[data-cwtoggle],[data-cwf],[data-agtodo],[data-agdel],[data-invite],[data-invitecopy],[data-mdel],[data-gotoweek],[data-go],[data-deltodo],[data-pres]');
    if (!t) return;
    const ds = t.dataset, m = cur();
    if (ds.cwtoggle) { cwOpen = cwOpen === ds.cwtoggle ? null : ds.cwtoggle; render(); }
    else if (ds.cwf) { cwFilter = ds.cwf; render(); }
    else if (ds.pres) openPresEdit(ds.pres);
    else if (ds.agtodo && m) {
      const a = m.agenda.find(x => x.id === ds.agtodo);
      state.todos.push({ id: uid(), text: a.text, due: '', done: false, meeting: m.id });
      save(); render();
    } else if (ds.agdel && m) { m.agenda = m.agenda.filter(x => x.id !== ds.agdel); save(); render(); }
    else if (('invite' in ds || 'invitecopy' in ds) && m) {
      const inv = inviteText(m);
      if ('invite' in ds) window.location.href = `mailto:${encodeURIComponent(inv.to).replace(/%3B/g, ';')}?subject=${encodeURIComponent(inv.subject)}&body=${encodeURIComponent(inv.body)}`;
      else { try { await navigator.clipboard.writeText(inv.subject + '\n\n' + inv.body); t.textContent = 'Kopiert ✓'; } catch { prompt('Text kopieren:', inv.body); } }
    } else if ('mdel' in ds && m) {
      if (!confirm('Diesen Termin mit Traktanden und Notizen löschen? Aufgaben bleiben in der To-do-Liste.')) return;
      state.meetings = state.meetings.filter(x => x.id !== m.id); cwOpen = null; save(); render();
    } else if (ds.gotoweek) { currentMonday = parse(ds.gotoweek); currentView = 'week'; render(); }
    else if (ds.go) { currentView = ds.go; render(); }
    else if (ds.deltodo) { state.todos = state.todos.filter(x => x.id !== ds.deltodo); save(); render(); }
  };
  v.oninput = e => {
    const ds = e.target.dataset, m = cur();
    if (!m) return;
    if (ds.mf) { m[ds.mf] = e.target.value; if (e.target.tagName === 'TEXTAREA') autosize(e.target); save(); }
    else if (ds.agtext) { const a = m.agenda.find(x => x.id === ds.agtext); if (a) { a.text = e.target.value; save(); } }
  };
  v.onchange = e => {
    const ds = e.target.dataset;
    if (ds.todo) { const t = state.todos.find(x => x.id === ds.todo); if (t) { t.done = e.target.checked; save(); render(); } }
    else if (ds.mf === 'group' || ds.mf === 'date') render();
  };
  v.onsubmit = e => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f), m = cur();
    if (f.matches('[data-addmeeting]')) {
      const nm = { id: uid(), group: fd.get('group'), date: fd.get('date'), time: fd.get('time') || '', end: '', title: fd.get('title').trim(), place: '', agenda: [], notes: '' };
      state.meetings.push(nm); cwOpen = nm.id; save(); render(); return;
    }
    if (!m) return;
    if (f.matches('[data-addag]')) { m.agenda.push({ id: uid(), text: fd.get('text').trim() }); save(); render(); $('[data-addag] input')?.focus(); }
    else if (f.matches('[data-addtask]')) { state.todos.push({ id: uid(), text: fd.get('text').trim(), due: fd.get('due') || '', done: false, meeting: m.id }); save(); render(); $('.cw-card.open [data-addtask] input')?.focus(); }
  };
}


// ----- Stoffaufteilung nach Ferienabschnitten (Jahresplanung) -----
let yearTab = 'stoff';
const STOFF_SUBJ = ['Mathematik', 'Deutsch', 'NMG'];
const STOFF_SHORT = { Mathematik: 'MA', Deutsch: 'DE', NMG: 'NMG' };
function stoffPeriods() {
  const s = state.settings, c = calYear();
  const main = c ? c.ferien.filter(f => !/Auffahrt/.test(f[0])) : [];
  const labels = ['Schulstart', 'Herbst – Weihnachten', 'Weihnachten – Sportferien', 'Sportferien – Frühling', 'Frühling – Sommer'];
  const out = [];
  let from = s.start;
  main.forEach((f, i) => { out.push({ label: labels[i] || 'Abschnitt ' + (i + 1), from, to: iso(addDays(parse(f[1]), -1)), after: f[0] }); from = iso(addDays(parse(f[2]), 1)); });
  out.push({ label: labels[main.length] || 'Abschnitt', from, to: s.end, after: c ? 'Sommerferien' : '' });
  for (const p of out) {
    let n = 0;
    for (let m = monday(parse(p.from)); iso(m) <= p.to; m = addDays(m, 7)) if (!weekHoliday(iso(m))) n++;
    p.weeks = n;
  }
  return out;
}
const SAFE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN']);
function cleanHTML(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  const walk = el => {
    for (const ch of [...el.childNodes]) {
      if (ch.nodeType === 1) {
        if (!SAFE_TAGS.has(ch.tagName)) { ch.replaceWith(document.createTextNode(ch.textContent)); continue; }
        for (const a of [...ch.attributes]) ch.removeAttribute(a.name);
        walk(ch);
      } else if (ch.nodeType !== 3) ch.remove();
    }
  };
  walk(t.content);
  return t.innerHTML;
}
function stoffCols() {
  const s = state.settings, cols = [];
  for (const name of STOFF_SUBJ) {
    const sub = s.subjects.find(x => x.name === name);
    if (!sub) continue;
    const short = STOFF_SHORT[name] || sub.short || name;
    cols.push({ key: sub.id + '|partner', label: short, who: (state.settings.partner.name || 'Stellenpartnerin').split(' ')[0], color: sub.color, partner: true });
    cols.push({ key: sub.id + '|me', label: short, who: (state.settings.me.name || 'Ich').split(' ')[0], color: sub.color });
  }
  cols.push({ key: 'over', label: 'Übergreifender Unterricht', who: '', color: '#9aa0a6' });
  return cols;
}
function yearTabsHTML() {
  return `<div class="year-tabs no-print">
    <button type="button" class="btn small ${yearTab === 'stoff' ? 'primary' : ''}" data-yeartab="stoff">Stoffaufteilung</button>
    <button type="button" class="btn small ${yearTab === 'weeks' ? 'primary' : ''}" data-yeartab="weeks">Themen pro Woche</button>
  </div>`;
}
function renderStoff(v) {
  const periods = stoffPeriods(), cols = stoffCols(), st = state.stoff || (state.stoff = {});
  const today = iso(new Date());
  const rows = periods.map((p, i) => `<tr class="${today >= p.from && today <= p.to ? 'now' : ''}">
      <th class="st-period"><b>${esc(p.label)}</b><small>${p.weeks} Wochen</small><small>${fmtShort(parse(p.from))}–${fmtShort(parse(p.to))}</small></th>
      ${cols.map(c => `<td class="${c.partner ? 'partner' : ''}" style="--c:${c.color}"><div class="st-cell" contenteditable="true" data-stoff="${i}|${c.key}" aria-label="${esc(c.label + ' ' + c.who + ', ' + p.label)}">${cleanHTML((st[i] || {})[c.key] || '')}</div></td>`).join('')}
    </tr>${p.after ? `<tr class="st-ferien"><th>${esc(p.after)}</th><td colspan="${cols.length}"></td></tr>` : ''}`).join('');
  v.innerHTML = `
  <section class="page-head">
    <h1>Jahresplanung ${sjLabel()}</h1>
    ${yearTabsHTML()}
    <p class="hint">Stoffaufteilung ${esc(state.settings.className)} pro Abschnitt zwischen den Ferien. Die Spalten von ${esc((state.settings.partner.name || 'deiner Stellenpartnerin').split(' ')[0])} sind schraffiert. Mit Ctrl+B schreibst du fett, mit Ctrl+U unterstrichen.</p>
  </section>
  <div class="table-wrap">
    <table class="stoff">
      <thead><tr><th>Jahreszeit</th>${cols.map(c => `<th class="${c.partner ? 'partner' : ''}" style="--c:${c.color}">${esc(c.label)} <b>${esc(c.who)}</b></th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  v.oninput = e => {
    const k = e.target.dataset.stoff;
    if (!k) return;
    const [i, ...rest] = k.split('|'), col = rest.join('|');
    (st[i] = st[i] || {})[col] = cleanHTML(e.target.innerHTML);
    save();
  };
  v.onclick = e => {
    const t = e.target.closest('[data-yeartab]');
    if (t) { yearTab = t.dataset.yeartab; scrollYearToNow = true; render(); }
  };
}
// Stoffaufteilung Schulstart bis Herbstferien 26/27 (Vorlage «Jahresplanung Stoffaufteilung 4. Klasse 26/27»)

// ----- Jahresplanung -----
function renderYear(v) {
  if (yearTab === 'stoff') return renderStoff(v);
  const s = state.settings;
  const nowKey = iso(thisPlanningWeek());
  let n = 0;
  const rows = schoolWeeks().map(mon => {
    const mk = iso(mon);
    const hol = weekHoliday(mk);
    const isManual = mk in (s.holidays || {});
    const notes = hol ? [] : weekOffNotes(mk);
    if (!hol) n++;
    const yp = state.yearplan[mk] || {};
    const cells = hol
      ? `<td colspan="${s.subjects.length}" class="hol-cell">${isManual ? `<input data-holname="${mk}" value="${esc(s.holidays[mk])}" aria-label="Name der Ferien">` : `<span class="hol-name">${esc(hol)}</span>`}</td>`
      : s.subjects.map(x => `<td style="--c:${x.color}"><textarea rows="1" data-yp="${mk}|${x.id}" placeholder="·" aria-label="${esc(x.name)} W-${n}">${esc(yp[x.id] || '')}</textarea></td>`).join('');
    const forced = (s.schoolForced || []).includes(mk);
    return `<tr class="${hol ? 'hol' : ''} ${mk === nowKey ? 'now' : ''} ${notes.some(x => x.type === 'feiertag') ? 'has-feiertag' : ''}">
      <th class="wk" scope="row">
        <button type="button" class="link" data-gotoweek="${mk}" title="Woche öffnen">${hol ? 'Ferien' : 'W-' + n}</button>
        <small>KW ${isoWeek(mon)} · ${fmtShort(mon)}–${fmtShort(addDays(mon, 4))}</small>
        ${notes.map(x => `<span class="off-chip ${x.type} small">${esc(x.label)}</span>`).join('')}
        <button type="button" class="mini" data-holiday="${mk}">${hol ? 'Schulwoche' : forced ? 'Ferienplan' : 'Ferien'}</button>
      </th>${cells}</tr>`;
  }).join('');

  v.innerHTML = `
  <section class="page-head">
    <h1>Jahresplanung ${sjLabel()}</h1>
    ${yearTabsHTML()}
    <p class="hint">Trage pro Schulwoche das Thema je Fach ein. Ferien und Feiertage stammen aus dem Ferienplan des Kantons Zug, rot markiert sind Feiertage an Schultagen. Zusätzliche Ferienwochen markierst du in der linken Spalte. Die Themen erscheinen automatisch auf der Wochenseite.</p>
  </section>
  <div class="table-wrap year-wrap">
    <table class="year">
      <thead><tr><th>Woche</th>${s.subjects.map(x => `<th style="--c:${x.color}"><span class="dot"></span>${esc(x.name)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  autosizeAll(v);
  if (scrollYearToNow) {
    const row = v.querySelector('tr.now'), wrap = v.querySelector('.year-wrap');
    if (row && wrap) wrap.scrollTop = row.offsetTop - 60;
    scrollYearToNow = false;
  }

  v.oninput = e => {
    const ds = e.target.dataset;
    if (ds.yp) {
      const [mk, sid] = ds.yp.split('|');
      const yp = state.yearplan[mk] || (state.yearplan[mk] = {});
      if (e.target.value.trim()) yp[sid] = e.target.value; else delete yp[sid];
      autosize(e.target); save();
    } else if (ds.holname) { state.settings.holidays[ds.holname] = e.target.value; save(); }
  };
  v.onclick = e => {
    const yt = e.target.closest('[data-yeartab]');
    if (yt) { yearTab = yt.dataset.yeartab; scrollYearToNow = true; render(); return; }
    const g = e.target.closest('[data-gotoweek]');
    if (g) { currentMonday = parse(g.dataset.gotoweek); currentView = 'week'; render(); window.scrollTo(0, 0); return; }
    const h = e.target.closest('[data-holiday]');
    if (h) {
      const k = h.dataset.holiday, st = state.settings, hs = st.holidays;
      st.schoolForced = st.schoolForced || [];
      if (k in hs) delete hs[k];
      else if (st.schoolForced.includes(k)) st.schoolForced = st.schoolForced.filter(x => x !== k);
      else if (weekHoliday(k)) st.schoolForced.push(k);
      else hs[k] = 'Ferien';
      const wrap = v.querySelector('.year-wrap'), top = wrap.scrollTop;
      save(); render();
      $('.year-wrap').scrollTop = top;
    }
  };
}

// ----- Termine & To-dos -----

// Alle Einträge für die Terminliste: eigene Termine, Feiertage, Ferien, Lernkontrollen, einmalige Kennzeichen, Geburtstage
const AG_TYPES = [['termin', 'Termine'], ['cowork', 'CoWork'], ['praesenz', 'Präsenz'], ['feiertag', 'Feiertage'], ['ferien', 'Ferien'], ['lk', 'Lernkontrollen'], ['kennzeichen', 'Kennzeichen'], ['geburtstag', 'Geburtstage']];
let agendaFilter = new Set(AG_TYPES.map(x => x[0]));
let todoFilter = '';
function agendaItems() {
  const s = state.settings, out = [], c = calYear();
  for (const e of state.events) out.push({ type: 'termin', date: e.date, time: e.time, title: e.title, note: e.note, id: e.id });
  if (c) {
    for (const [n, d] of c.feiertage) out.push({ type: 'feiertag', date: d, title: n, note: 'schulfrei' });
    for (const [n, a, b] of c.ferien) out.push({ type: 'ferien', date: a, to: b, title: n });
    out.push({ type: 'ferien', date: c.summer, title: 'Sommerferien' });
  }
  for (const [d, n] of Object.entries(s.extraOff || {})) if (d >= s.start && d <= s.end) out.push({ type: 'feiertag', date: d, title: n, note: 'schulfrei (Schule Herti)' });
  for (const p of state.presence || []) {
    if (p.cat === 'frei') continue;
    const c2 = presCat(p.cat);
    out.push({ type: 'praesenz', date: p.date, time: PRES_BLOCKS[p.block].replace('.', ':').slice(0, 5), timeLabel: PRES_BLOCKS[p.block] + ' Uhr', title: p.title, note: p.note || '',
      label: c2.name, color: c2.bg, fg: c2.fg, icon: PRES_ICONS[p.cat], pres: p.id });
  }
  for (const [k, l] of Object.entries(state.lessons)) {
    if (!l.lk) continue;
    const [di, sid] = k.split('|'), sl = s.slots.find(x => x.id === sid);
    const sub = subj(l.subjectId || s.timetable[(dayIdx(di) + 1) + '-' + sid]);
    out.push({ type: 'lk', date: di, time: sl ? sl.from : '', title: (sub ? (sub.short || sub.name) + ': ' : '') + (l.title || 'Lernkontrolle'), lesson: k, label: 'LK' });
  }
  for (const x of state.fixed || []) out.push({ type: 'kennzeichen', date: x.date, time: x.from, timeLabel: `${x.from.replace(':', '.')}–${x.to.replace(':', '.')} Uhr`, title: x.title, note: x.note || '', label: x.title, color: x.color || '#cfe8fa', fg: '#133b5c', icon: /schwimm/i.test(x.title) ? 'bilder/schwimmunterricht.jpg' : '' });
  for (const m of state.meetings || []) if (!m.presId && m.date) out.push({ label: cwGroup(m.group).name, color: cwGroup(m.group).color, type: 'cowork', date: m.date, time: m.time, title: cwGroup(m.group).name + (m.title ? ': ' + m.title : ''), note: [m.place, m.agenda.length ? m.agenda.length + ' Traktanden' : ''].filter(Boolean).join(' · '), meeting: m.id });
  for (const p of state.placements) {
    if (p.repeat) continue;
    if (p.meeting) { out.push({ type: 'kennzeichen', date: p.date, time: p.meeting.time, title: p.meeting.title, note: posLabel(p.pos), label: 'Besprechung', color: '#7030a0' }); continue; }
    const b = badge(p.badgeId);
    if (b) out.push({ type: 'kennzeichen', date: p.date, title: b.name, note: posLabel(p.pos), label: 'Kennzeichen', badgeImg: bImg(b) });
  }
  const y1 = Number(s.start.slice(0, 4)), y2 = Number(s.end.slice(0, 4));
  for (const b of s.birthdays) {
    const d = (Number(b.date.slice(0, 2)) >= 8 ? y1 : y2) + '-' + b.date;
    out.push({ type: 'geburtstag', date: d, title: b.name, label: 'Geburtstag', icon: 'bilder/geburtstag.jpg' });
  }
  return out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

function presOverviewHTML() {
  const c = calYear(), today = iso(new Date());
  const byDate = {};
  for (const p of state.presence || []) (byDate[p.date] = byDate[p.date] || []).push(p);
  const dates = Object.keys(byDate).sort();
  let prev = '', rows = '';
  for (const d of dates) {
    if (c && prev) for (const [n, a] of c.ferien) if (a > prev && a < d) rows += `<tr class="pres-ferien"><td colspan="3">${esc(n)}</td></tr>`;
    prev = d;
    const ps = byDate[d], ab = ps.filter(p => p.block === 'AB');
    const del = p => `<button type="button" class="pres-del" data-delpres="${p.id}" aria-label="Eintrag löschen">✕</button>`;
    const cell = list => list.map(p => `<div class="pres-row" role="button" tabindex="0" data-pres="${p.id}" style="--pb:${presCat(p.cat).bg};--pf:${presCat(p.cat).fg}">${esc(p.title)}${p.note ? `<small> · ${esc(p.note)}</small>` : ''}${del(p)}</div>`).join('');
    const dt = parse(d);
    rows += `<tr class="${d < today ? 'past' : ''}"><th><button type="button" class="link" data-gotoweek="${iso(monday(dt))}">${DAYS7[dt.getDay()]}, ${fmtShort(dt)}${dt.getFullYear()}</button></th>`
      + (ab.length && ab.length === ps.length ? `<td colspan="2">${cell(ab)}</td>` : `<td>${cell(ps.filter(p => p.block !== 'B'))}</td><td>${cell(ps.filter(p => p.block !== 'A'))}</td>`) + '</tr>';
  }
  return `<section class="card pres-card">
    <h2>Präsenznachmittage Herti</h2>
    <div class="pres-legend">${Object.entries(PRES_CATS).filter(([k]) => k !== 'frei').map(([k, x]) => `<span><i style="background:${x.bg}"></i>${esc(x.name)}</span>`).join('')}</div>
    <div class="table-wrap"><table class="pres-table">
      <thead><tr><th>Datum</th><th>13.30–15.00 Uhr</th><th>15.05–16.30 Uhr</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="muted">Keine Einträge.</td></tr>'}</tbody>
    </table></div>
    <form class="add-form pres-add" data-addpres>
      <input type="date" name="date" required aria-label="Datum">
      <select name="block" aria-label="Zeit">${Object.entries(PRES_BLOCKS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>
      <select name="cat" aria-label="Art">${Object.entries(PRES_CATS).map(([k, x]) => `<option value="${k}">${esc(x.name)}</option>`).join('')}</select>
      <input name="title" placeholder="Bezeichnung, z. B. Hertiteam" required aria-label="Bezeichnung">
      <button class="btn primary">Hinzufügen</button>
    </form>
    <p class="hint">Quelle: Planung Präsenznachmittage Herti, Schuljahr 26-27 (Schulleitung Herti, 05.06.2026). Der Stufenrundtisch US findet ausnahmsweise am Mittwoch, 25.11.26, im Mehrzweckraum Guthirt statt.</p>
  </section>`;
}

function renderAgenda(v) {
  const today = iso(new Date());
  const all = agendaItems().filter(x => agendaFilter.has(x.type));
  const up = all.filter(e => (e.to || e.date) >= today), past = all.filter(e => (e.to || e.date) < today).reverse();
  const label = { cowork: 'CoWork', praesenz: 'Präsenz', termin: 'Termin', feiertag: 'Feiertag', ferien: 'Ferien', lk: 'LK', kennzeichen: 'Kennzeichen', geburtstag: 'Geburtstag' };
  const dLabel = d => `${DAYS7[parse(d).getDay()]} ${fmtShort(parse(d))}${parse(d).getFullYear()}`;
  const evLi = e => `<li class="ev ag-${e.type}" ${e.color ? `style="--t:${e.color};--tf:${e.fg || '#fff'}"` : ''}>
      <div class="ev-when"><b>${dLabel(e.date)}</b>${e.to ? `<small>bis ${dLabel(e.to)}</small>` : ''}${e.timeLabel ? `<small>${esc(e.timeLabel)}</small>` : e.time ? `<small>${e.time}</small>` : ''}</div>
      ${e.icon ? `<img class="ag-icon" src="${e.icon}" alt="">` : e.badgeImg ? `<span class="ag-icon">${e.badgeImg}</span>` : ''}
      <div class="ev-what"><span class="ag-type">${esc(e.label || label[e.type])}</span> ${e.pres ? `<button type="button" class="link ag-title" data-pres="${e.pres}"><strong>${esc(e.title)}</strong></button>` : `<strong>${esc(e.title)}</strong>`}${e.note ? `<p>${esc(e.note)}</p>` : ''}</div>
      ${e.meeting ? `<button type="button" class="icon-btn" data-cwopen="${e.meeting}" aria-label="Im CoWork öffnen" title="Im CoWork öffnen">✎</button>` : ''}
      <button type="button" class="icon-btn" data-gotoweek="${iso(monday([0, 6].includes(parse(e.date).getDay()) ? addDays(parse(e.date), 2) : parse(e.date)))}" aria-label="Woche öffnen" title="Woche öffnen">→</button>
      ${e.type === 'termin' ? `<button type="button" class="icon-btn" data-delev="${e.id}" aria-label="Termin löschen">✕</button>` : ''}</li>`;
  const todoGs = cwGroups();
  const todos = [...state.todos].filter(t => !todoFilter || (todoFilter === '-' ? !todoGroupId(t) : todoGroupId(t) === todoFilter)).sort((a, b) => (a.done - b.done) || (a.due || a.week || '9').localeCompare(b.due || b.week || '9'));
  const wLabel = mk => { const n = schoolWeekNumber(mk); return n ? 'W-' + n : 'KW ' + isoWeek(parse(mk)); };

  v.innerHTML = `
  <div class="two-col">
    <section class="card">
      <h2>Termine</h2>
      <form class="add-form" data-addev>
        <input type="date" name="date" required value="${today}" aria-label="Datum">
        <input type="time" name="time" aria-label="Zeit">
        <input name="title" placeholder="Was? z. B. Elternabend" required aria-label="Titel">
        <input name="note" placeholder="Notiz (optional)" aria-label="Notiz">
        <button class="btn primary">Hinzufügen</button>
      </form>
      <div class="ag-filter">${AG_TYPES.map(([k, n]) => `<label class="ag-f ag-${k}"><input type="checkbox" data-agf="${k}" ${agendaFilter.has(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
      <h4>Anstehend</h4>
      <ul class="ev-list big">${up.map(evLi).join('') || '<li class="muted">Nichts Anstehendes.</li>'}</ul>
      ${past.length ? `<details><summary>Vergangen (${past.length})</summary><ul class="ev-list big past">${past.map(evLi).join('')}</ul></details>` : ''}
    </section>
    <div class="agenda-right">
    <section class="card">
      <h2>Aufgaben</h2>
      <form class="add-form" data-addtodo>
        <input name="text" placeholder="Neue Aufgabe" required aria-label="Aufgabe">
        <input type="date" name="due" aria-label="Fällig am">
        <select name="group" aria-label="Label"><option value="">Ohne Label</option>${todoGs.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>
        <button class="btn primary">Hinzufügen</button>
      </form>
      <div class="lbl-filter">
        <button type="button" class="tag ${!todoFilter ? 'on' : ''}" data-todofilter="">Alle</button>
        ${todoGs.map(g => `<button type="button" class="tag cw ${todoFilter === g.id ? 'on' : 'off'}" style="--gc:${g.color}" data-todofilter="${g.id}">${esc(g.name)}</button>`).join('')}
        <button type="button" class="tag ${todoFilter === '-' ? 'on' : ''}" data-todofilter="-">Ohne Label</button>
      </div>
      <ul class="todo-list">${todos.map(t => `<li class="${t.done ? 'done' : ''} ${t.due && !t.done && t.due < today ? 'overdue' : ''}">
          <label><input type="checkbox" data-todo="${t.id}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label>
          ${t.week ? `<button type="button" class="tag" data-gotoweek="${t.week}">${wLabel(t.week)}</button>` : ''}
          ${t.meetTitle ? `<span class="tag cw" style="--gc:#7030a0">${esc(t.meetTitle)}</span>` : ''}
          ${todoLabelSelect(t, todoGs)}
          ${t.meeting && state.meetings.find(m => m.id === t.meeting) ? `<button type="button" class="icon-btn" data-cwopen="${t.meeting}" title="Besprechung im CoWork öffnen" aria-label="Besprechung im CoWork öffnen">↗</button>` : ''}
          ${t.due ? `<small>bis ${fmtShort(parse(t.due))}</small>` : ''}
          <button type="button" class="icon-btn" data-deltodo="${t.id}" aria-label="Aufgabe löschen">✕</button></li>`).join('') || '<li class="muted">Nichts offen.</li>'}</ul>
      ${state.todos.some(t => t.done) ? '<button type="button" class="link" data-cleardone>Erledigte entfernen</button>' : ''}
    </section>
    <section class="card shop-card">
      <h2>Geplante Einkäufe</h2>
      <form class="add-form" data-addshop>
        <input name="text" placeholder="Was? z. B. Leim, Bastelkarton" required aria-label="Einkauf">
        <input name="where" placeholder="Wo / für (optional)" aria-label="Wo oder wofür">
        <input type="date" name="due" aria-label="Bis wann">
        <button class="btn primary">Hinzufügen</button>
      </form>
      <ul class="todo-list">${[...(state.shopping || [])].sort((a, b) => (a.done - b.done) || (a.due || '9').localeCompare(b.due || '9')).map(x => `<li class="${x.done ? 'done' : ''} ${x.due && !x.done && x.due < today ? 'overdue' : ''}">
          <label><input type="checkbox" data-shop="${x.id}" ${x.done ? 'checked' : ''}><span>${esc(x.text)}${x.where ? `<small class="muted"> · ${esc(x.where)}</small>` : ''}</span></label>
          ${x.due ? `<small>bis ${fmtShort(parse(x.due))}</small>` : ''}
          <button type="button" class="icon-btn" data-delshop="${x.id}" aria-label="Einkauf löschen">✕</button></li>`).join('') || '<li class="muted">Nichts geplant.</li>'}</ul>
      ${(state.shopping || []).some(x => x.done) ? '<button type="button" class="link" data-clearshop>Erledigte entfernen</button>' : ''}
    </section>
    ${presOverviewHTML()}
    </div>
  </div>`;

  v.onsubmit = e => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    if (f.matches('[data-addshop]')) { (state.shopping = state.shopping || []).push({ id: uid(), text: fd.get('text').trim(), where: fd.get('where').trim(), due: fd.get('due') || '', done: false }); save(); render(); $('[data-addshop] [name=text]')?.focus(); return; }
    if (f.matches('[data-addpres]')) { state.presence.push({ id: uid(), date: fd.get('date'), block: fd.get('block'), cat: fd.get('cat'), title: fd.get('title').trim() }); save(); render(); return; }
    if (f.matches('[data-addev]')) state.events.push({ id: uid(), date: fd.get('date'), time: fd.get('time') || '', title: fd.get('title').trim(), note: fd.get('note').trim() });
    else if (f.matches('[data-addtodo]')) { const g = fd.get('group') || ''; state.todos.push({ id: uid(), text: fd.get('text').trim(), due: fd.get('due') || '', done: false, ...(g ? { group: g } : {}) }); }
    const which = f.matches('[data-addev]') ? '[data-addev] [name=title]' : '[data-addtodo] [name=text]';
    save(); render();
    $(which)?.focus();
  };
  v.onclick = e => {
    const a = e.target.closest('[data-todofilter],[data-delev],[data-deltodo],[data-cleardone],[data-gotoweek],[data-delpres],[data-pres],[data-cwopen],[data-delshop],[data-clearshop]');
    if (!a) return;
    if (a.dataset.todofilter !== undefined) { todoFilter = todoFilter === a.dataset.todofilter ? '' : a.dataset.todofilter; render(); return; }
    if (a.dataset.delshop) { state.shopping = state.shopping.filter(x => x.id !== a.dataset.delshop); save(); render(); return; }
    if ('clearshop' in a.dataset) { state.shopping = state.shopping.filter(x => !x.done); save(); render(); return; }
    if (a.dataset.pres && !a.dataset.delpres) { openPresEdit(a.dataset.pres); return; }
    if (a.dataset.cwopen) { cwOpen = a.dataset.cwopen; currentView = 'cowork'; render(); return; }
    if (a.dataset.delpres) { if (!confirm('Diesen Präsenz-Eintrag löschen?')) return; state.presence = state.presence.filter(x => x.id !== a.dataset.delpres); save(); render(); return; }
    if (a.dataset.gotoweek) { currentMonday = parse(a.dataset.gotoweek); currentView = 'week'; render(); return; }
    if (a.dataset.delev) state.events = state.events.filter(x => x.id !== a.dataset.delev);
    else if (a.dataset.deltodo) state.todos = state.todos.filter(x => x.id !== a.dataset.deltodo);
    else state.todos = state.todos.filter(x => !x.done);
    save(); render();
  };
  v.onchange = e => {
    if (e.target.dataset.shop) { const x = state.shopping.find(y => y.id === e.target.dataset.shop); if (x) { x.done = e.target.checked; save(); render(); } return; }
    if (e.target.dataset.todogroup) { const t = state.todos.find(x => x.id === e.target.dataset.todogroup); if (t) { t.group = e.target.value; save(); render(); } return; }
    if (e.target.dataset.agf) { const k = e.target.dataset.agf; if (e.target.checked) agendaFilter.add(k); else agendaFilter.delete(k); render(); return; }
    const id = e.target.dataset.todo;
    if (!id) return;
    const t = state.todos.find(x => x.id === id);
    if (t) { t.done = e.target.checked; save(); render(); }
  };
}

// ----- Einstellungen -----
function renderSettings(v) {
  const s = state.settings;
  const count = { me: 0, partner: 0, both: 0 };
  const tt = s.slots.map(sl => `<tr><th scope="row">${sl.from}–${sl.to}</th>${[1, 2, 3, 4, 5].map(d => {
    const cur = s.timetable[d + '-' + sl.id] || '';
    const sub = subj(cur);
    const w = whoPlan(d, sl.id);
    if (sub) count[w]++;
    return `<td class="tt-cell who-${w}"><select data-tt="${d}-${sl.id}" class="${sub ? 'set' : ''}" ${sub ? `style="--c:${sub.color}"` : ''} aria-label="${DAYS[d - 1]} ${sl.from} Fach">
      <option value="">–</option>${s.subjects.map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <select data-who="${d}-${sl.id}" class="who-sel" aria-label="${DAYS[d - 1]} ${sl.from} unterrichtet von">
        ${['me', 'partner', 'both'].map(x => `<option value="${x}" ${x === w ? 'selected' : ''}>${esc(WHO_LABEL(x))}</option>`).join('')}</select></td>`;
  }).join('')}</tr>`).join('');
  const dayBtns = `<tr class="tt-days"><th></th>${[1, 2, 3, 4, 5].map(d => `<td><div class="seg-mini"><button type="button" data-dayall="${d}|me" title="Ganzer Tag: ${esc(myName())}">${esc(initials(myName()) || 'Ich')}</button><button type="button" data-dayall="${d}|partner" title="Ganzer Tag: ${esc(partnerName())}">${esc(initials(partnerName()))}</button></div></td>`).join('')}</tr>`;
  const p = s.partner;
  const bdays = [...s.birthdays].sort((a, b) => a.date.localeCompare(b.date));

  v.innerHTML = `
  <section class="page-head"><h1>Einstellungen</h1></section>
  <div class="settings-grid">
    <section class="card">
      <h2>Klasse und Schuljahr</h2>
      <div class="form-row col">
        <label class="field"><span>Klasse</span><input data-set="className" value="${esc(s.className)}"></label>
        <label class="field"><span>Schuljahr (Ferienplan Kanton Zug)</span><select data-calyear>
          ${Object.keys(ZG_CALENDAR).map(y => `<option value="${y}" ${s.calendarYear === y ? 'selected' : ''}>${y}</option>`).join('')}
          <option value="" ${!s.calendarYear ? 'selected' : ''}>eigene Daten, ohne Ferienplan</option></select></label>
        <label class="field"><span>Beginn Schuljahr (Montag W-1)</span><input type="date" data-set="start" value="${s.start}"></label>
        <label class="field"><span>Ende Schuljahr</span><input type="date" data-set="end" value="${s.end}"></label>
      </div>
      ${calYear() ? `<div class="cal-list">
        <h4>Ferien ${esc(s.calendarYear)}</h4>
        <ul>${calYear().ferien.map(([n, a, b]) => `<li><span>${esc(n)}</span><small>${fmtShort(parse(a))}${a.slice(2, 4)} – ${fmtShort(parse(b))}${b.slice(2, 4)}</small></li>`).join('')}<li><span>Sommerferien ab</span><small>${fmtShort(parse(calYear().summer))}${calYear().summer.slice(2, 4)}</small></li></ul>
        <h4>Feiertage an Schultagen</h4>
        <ul>${calYear().feiertage.map(([n, d]) => `<li class="ft"><span>${esc(n)}</span><small>${DAYS7[parse(d).getDay()]} ${fmtShort(parse(d))}${d.slice(2, 4)}</small></li>`).join('')}</ul>
      </div>
      <p class="hint">Quelle: Schulferien 2026/27 bis 2030/31, Amt für gemeindliche Schulen Kanton Zug (Stand 28. Mai 2026), zg.ch/schulferien.</p>` : '<p class="hint">Ohne Ferienplan markierst du die Ferienwochen selbst in der Jahresplanung.</p>'}
    </section>
    <section class="card">
      <h2>Fächer</h2>
      <p class="hint" style="margin:0 0 10px">Farbe, Name und Kürzel. Das Kürzel steht in der Wochenansicht vor dem Eintrag, z. B. «D: Start mit Perfekt».</p>
      <ul class="row-list">${s.subjects.map(x => `<li>
        <input type="color" data-subcolor="${x.id}" value="${x.color}" aria-label="Farbe ${esc(x.name)}">
        <input data-subname="${x.id}" value="${esc(x.name)}" aria-label="Fachname">
        <input class="short" data-subshort="${x.id}" value="${esc(x.short || '')}" aria-label="Kürzel" title="Kürzel, z. B. D">
        <button type="button" class="icon-btn" data-delsub="${x.id}" aria-label="Fach löschen">✕</button></li>`).join('')}</ul>
      <button type="button" class="btn small" data-addsub>+ Fach hinzufügen</button>
    </section>
    <section class="card">
      <h2>Lektionszeiten</h2>
      <ul class="row-list">${s.slots.map((sl, i) => `<li>
        <span class="muted num">${i + 1}.</span>
        <input type="time" data-slot="${sl.id}|from" value="${sl.from}" aria-label="Beginn">
        <span class="muted">bis</span>
        <input type="time" data-slot="${sl.id}|to" value="${sl.to}" aria-label="Ende">
        <button type="button" class="icon-btn" data-delslot="${sl.id}" aria-label="Lektion entfernen">✕</button></li>`).join('')}</ul>
      <button type="button" class="btn small" data-addslot>+ Lektion hinzufügen</button>
      <p class="hint">PAUSE (ab 10 Minuten Lücke) und MITTAG (ab 50 Minuten Lücke) erscheinen automatisch zwischen den Lektionen. Die Zeiten sind aus deinem OneNote-Heft übernommen.</p>
    </section>
    <section class="card wide">
      <h2>Stundenplan</h2>
      <p class="hint">Wähle pro Lektion das Fach und wer unterrichtet. Mit den Knöpfen unter dem Wochentag teilst du einen ganzen Tag zu. Der Stundenplan gilt für jede Woche. Einzelne Lektionen kannst du auf der Wochenseite abweichend festlegen, z. B. bei einem Abtausch.</p>
      <div class="tt-sum"><span><i class="lg me"></i>${esc(myName())}: <b>${count.me}</b> Lektionen</span><span><i class="lg partner"></i>${esc(partnerName())}: <b>${count.partner}</b> Lektionen</span><span><i class="lg both"></i>Beide: <b>${count.both}</b></span></div>
      <div class="tt-filter btn-row">
        <span class="muted">Anzeigen:</span>
        <button type="button" class="btn small ${ttFilter === 'all' ? 'primary' : ''}" data-ttfilter="all">Ganze Klasse</button>
        <button type="button" class="btn small ${ttFilter === 'me' ? 'primary' : ''}" data-ttfilter="me">Mein Stundenplan</button>
        <button type="button" class="btn small ${ttFilter === 'partner' ? 'primary' : ''}" data-ttfilter="partner">Stundenplan ${esc(partnerName())}</button>
      </div>
      <div class="table-wrap"><table class="tt filter-${ttFilter}"><thead><tr><th></th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr>${dayBtns}</thead><tbody>${tt}</tbody></table></div>
    </section>
    <section class="card">
      <h2>Ich</h2>
      <label class="field"><span>Mein Name</span><input data-me="name" value="${esc(s.me.name)}" placeholder="Vorname Name"></label>
      <p class="hint">Erscheint in der Legende und im Stundenplan.</p>
    </section>
    <section class="card partner-card">
      <h2>Stellenpartnerin</h2>
      <div class="form-row col">
        <label class="field"><span>Name</span><input data-partner="name" value="${esc(p.name)}" placeholder="Vorname Name"></label>
        <label class="field"><span>E-Mail</span><input type="email" data-partner="email" value="${esc(p.email)}" placeholder="name@stadtschulenzug.ch"></label>
        <label class="field"><span>Telefon</span><input type="tel" data-partner="phone" value="${esc(p.phone)}" placeholder="079 …"></label>
        <label class="field"><span>Notizen</span><textarea data-partner="note" rows="2" placeholder="z. B. Absprachen, Übergabe am Mittwoch">${esc(p.note)}</textarea></label>
        <label class="field color-field"><span>Farbe in der Wochenansicht</span><input type="color" data-partnercolor value="${esc(p.color)}"></label>
      </div>
    </section>
    <section class="card wide" id="coworkSettings">
      <h2>CoWork</h2>
      <p class="hint" style="margin:0 0 10px">Gruppen für die Seite CoWork. E-Mail-Adressen mehrerer Personen trennst du mit Strichpunkt. Sie werden für Einladungen verwendet.</p>
      <div class="cw-set">
        <label class="field"><span>U-Team: E-Mail-Adressen</span><input data-cw="utMembers" value="${esc(s.cowork.utMembers)}" placeholder="name1@stadtschulenzug.ch; name2@stadtschulenzug.ch"></label>
        <div class="form-row">
          <label class="field"><span>SHP: Name</span><input data-cwshp="name" value="${esc(s.cowork.shp.name)}" placeholder="Vorname Name"></label>
          <label class="field"><span>SHP: E-Mail</span><input type="email" data-cwshp="email" value="${esc(s.cowork.shp.email)}"></label>
        </div>
        <p class="hint" style="margin:0">Die Pensenpartnerin übernimmt Name und E-Mail aus der Karte «Stellenpartnerin».</p>
        <h4>Arbeitsgruppen</h4>
        <ul class="row-list">${s.cowork.groups.map(g => `<li class="wrap">
          <input data-cwgname="${g.id}" value="${esc(g.name)}" aria-label="Name der Arbeitsgruppe" class="grow1">
          <input data-cwgmem="${g.id}" value="${esc(g.members)}" placeholder="E-Mail-Adressen der Mitglieder" aria-label="E-Mail-Adressen" class="grow2">
          <button type="button" class="icon-btn" data-cwgdel="${g.id}" aria-label="Arbeitsgruppe löschen">✕</button></li>`).join('')}</ul>
        <button type="button" class="btn small" data-cwgadd>+ Arbeitsgruppe hinzufügen</button>
      </div>
    </section>
    <section class="card wide" id="badgeSettings">
      <h2>Kennzeichen</h2>
      <p class="hint">Bilder für wiederkehrende Dinge wie Pausenaufsicht oder Teamsitzungen. Auf der Wochenseite setzt du sie mit «+» auf einen Tag, eine Pause oder eine Lektion, einmalig oder jede Woche.</p>
      <div class="badge-grid">${s.badges.map(b => `<div class="badge-card">
        <div class="badge-img">${bImg(b)}</div>
        <input data-bname="${b.id}" value="${esc(b.name)}" aria-label="Name des Kennzeichens">
        <div class="btn-row">
          <label class="btn small">Bild ändern<input type="file" accept="image/*" hidden data-bimg="${b.id}"></label>
          <button type="button" class="icon-btn" data-delbadge="${b.id}" aria-label="Kennzeichen löschen">✕</button>
        </div></div>`).join('')}
        <label class="badge-card add">+ Neues Kennzeichen<small>Bild auswählen</small><input type="file" accept="image/*" hidden data-newbadge></label>
      </div>
    </section>
    <section class="card wide">
      <h2>Geburtstagsliste</h2>
      <p class="hint">Geburtstage erscheinen mit Ballonen auf der Wochenseite. Geburtstage am Wochenende zeigt die App am Freitag. Gespeichert werden nur Name und Tag.</p>
      <form class="add-form" data-addbday>
        <input name="name" placeholder="Vorname Name" required aria-label="Name">
        <input type="date" name="date" required aria-label="Geburtstag">
        <button class="btn primary">Hinzufügen</button>
      </form>
      <ul class="bday-list">${bdays.map(b => `<li><span class="bd-date">${b.date.slice(3)}.${b.date.slice(0, 2)}.</span><span>${esc(b.name)}</span><button type="button" class="icon-btn" data-delbday="${b.id}" aria-label="Geburtstag löschen">✕</button></li>`).join('') || '<li class="muted">Noch keine Einträge.</li>'}</ul>
    </section>
    <section class="card wide" id="syncCard"></section>
    <section class="card wide">
      <h2>Daten sichern</h2>
      <p>Die Einträge sind in diesem Browser gespeichert${typeof syncLS !== 'undefined' && syncLS.get('on', false) ? ' und werden mit dem OneDrive abgeglichen' : ''}. Lade trotzdem ab und zu eine Sicherung herunter, zum Beispiel in deinen OneDrive-Ordner.</p>
      <div class="btn-row">
        <button type="button" class="btn primary" data-export>Sicherung herunterladen</button>
        <label class="btn">Sicherung einlesen<input type="file" accept="application/json,.json" hidden data-import></label>
        <button type="button" class="btn danger" data-reset>Alle Daten löschen</button>
      </div>
      <p class="hint" id="storageInfo"></p>
    </section>
  </div>`;

  if (typeof syncMountCard === 'function') syncMountCard();
  navigator.storage?.estimate?.().then(est => {
    const el = $('#storageInfo');
    if (el && est) el.textContent = `Belegter Speicher: ${(est.usage / 1048576).toFixed(1)} MB`;
  });

  v.oninput = e => {
    const t = e.target, ds = t.dataset;
    if (ds.set) { s[ds.set] = t.value; if (ds.set === 'className') $('#brandClass').textContent = `${t.value} · ${sjLabel()}`; save(); }
    else if (ds.subname) { subj(ds.subname).name = t.value; save(); }
    else if (ds.subshort) { subj(ds.subshort).short = t.value; save(); }
    else if (ds.slot) { const [id, k] = ds.slot.split('|'); s.slots.find(x => x.id === id)[k] = t.value; save(); }
    else if (ds.bname) { badge(ds.bname).name = t.value; save(); }
    else if (ds.partner) { s.partner[ds.partner] = t.value; save(); }
    else if (ds.cw) { s.cowork[ds.cw] = t.value; save(); }
    else if (ds.cwshp) { s.cowork.shp[ds.cwshp] = t.value; save(); }
    else if (ds.cwgname) { s.cowork.groups.find(g => g.id === ds.cwgname).name = t.value; save(); }
    else if (ds.cwgmem) { s.cowork.groups.find(g => g.id === ds.cwgmem).members = t.value; save(); }
    else if (ds.me) { s.me[ds.me] = t.value; save(); }
  };
  v.onchange = async e => {
    const t = e.target, ds = t.dataset;
    if (ds.subcolor) { subj(ds.subcolor).color = t.value; save(); render(); }
    else if (ds.tt) { if (t.value) s.timetable[ds.tt] = t.value; else delete s.timetable[ds.tt]; save(); render(); }
    else if (ds.who) { if (t.value === 'me') delete s.who[ds.who]; else s.who[ds.who] = t.value; save(); render(); }
    else if ('partnercolor' in ds) { s.partner.color = t.value; save(); render(); }
    else if (ds.partner || ds.me) render();
    else if (ds.set === 'start' || ds.set === 'end') render();
    else if ('calyear' in ds) {
      s.calendarYear = t.value;
      const c = ZG_CALENDAR[t.value];
      if (c) { s.start = c.start; s.end = iso(addDays(parse(c.summer), -1)); s.holidays = {}; s.schoolForced = []; }
      currentMonday = monday(parse(s.start)) > thisPlanningWeek() || parse(s.end) < thisPlanningWeek() ? monday(parse(s.start)) : thisPlanningWeek();
      save(); render();
    }
    else if (ds.slot) render();
    else if (ds.bimg && t.files[0]) {
      const b = badge(ds.bimg), id = uid();
      await idbPut('images', id, await downscale(t.files[0], 500));
      if (b.imageId) await idbDel('images', b.imageId);
      b.imageId = id; delete b.src; save(); render();
    } else if ('newbadge' in ds && t.files[0]) {
      const id = uid();
      await idbPut('images', id, await downscale(t.files[0], 500));
      s.badges.push({ id: uid(), name: t.files[0].name.replace(/\.[^.]+$/, ''), imageId: id });
      save(); render();
    }
    else if (t.matches('[data-import]') && t.files[0]) importData(t.files[0]);
  };
  v.onsubmit = e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    s.birthdays.push({ id: uid(), name: fd.get('name').trim(), date: String(fd.get('date')).slice(5) });
    save(); render(); $('[data-addbday] [name=name]')?.focus();
  };
  v.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    const ds = t.dataset;
    if ('cwgadd' in ds) { s.cowork.groups.push({ id: uid(), name: 'Neue Arbeitsgruppe', members: '' }); save(); render(); return; }
    if (ds.cwgdel) {
      const g = s.cowork.groups.find(x => x.id === ds.cwgdel);
      if (!confirm(`Arbeitsgruppe «${g.name}» löschen? Ihre Termine bleiben erhalten, erscheinen aber ohne Gruppe.`)) return;
      s.cowork.groups = s.cowork.groups.filter(x => x.id !== ds.cwgdel); save(); render(); return;
    }
    if (ds.dayall) {
      const [d, w] = ds.dayall.split('|');
      s.slots.forEach(sl => { if (w === 'me') delete s.who[d + '-' + sl.id]; else s.who[d + '-' + sl.id] = w; });
      save(); render();
    }
    else if (ds.ttfilter) { ttFilter = ds.ttfilter; render(); }
    else if ('addsub' in ds) { s.subjects.push({ id: uid(), name: 'Neues Fach', short: 'NF', color: '#6b7280' }); save(); render(); }
    else if (ds.delsub) {
      if (!confirm(`Fach «${subj(ds.delsub).name}» löschen? Es wird auch aus dem Stundenplan entfernt.`)) return;
      s.subjects = s.subjects.filter(x => x.id !== ds.delsub);
      for (const k in s.timetable) if (s.timetable[k] === ds.delsub) delete s.timetable[k];
      save(); render();
    }
    else if ('addslot' in ds) { const last = s.slots[s.slots.length - 1]; s.slots.push({ id: uid(), from: last ? last.to : '08:00', to: '' }); save(); render(); }
    else if (ds.delslot) {
      if (!confirm('Diese Lektionszeit entfernen? Bereits geplante Lektionen zu dieser Zeit werden nicht mehr angezeigt.')) return;
      s.slots = s.slots.filter(x => x.id !== ds.delslot);
      save(); render();
    }
    else if (ds.delbadge) {
      if (!confirm(`Kennzeichen «${badge(ds.delbadge).name}» löschen? Es verschwindet auch aus allen Wochen.`)) return;
      const b = badge(ds.delbadge);
      if (b.imageId) await idbDel('images', b.imageId);
      s.badges = s.badges.filter(x => x.id !== ds.delbadge);
      state.placements = state.placements.filter(p => p.badgeId !== ds.delbadge);
      save(); render();
    }
    else if (ds.delbday) { s.birthdays = s.birthdays.filter(x => x.id !== ds.delbday); save(); render(); }
    else if ('export' in ds) exportData();
    else if ('reset' in ds) {
      if (!confirm('Wirklich alle Daten löschen? Das lässt sich nicht rückgängig machen. Lade vorher eine Sicherung herunter.')) return;
      await idbClear('images'); urlCache.clear();
      if (typeof syncLS !== 'undefined' && syncLS.get('on', false)) { ['tok', 'account', 'on', 'etag'].forEach(k => syncLS.set(k, null)); await idbDel('kv', 'syncBase').catch(() => {}); }
      if (typeof fsLS !== 'undefined' && fsLS.get('mode', null)) { ['mode', 'fileName', 'lastMod', 'dirty', 'last', 'loaded', 'saved'].forEach(k => fsLS.set(k, null)); fsHandle = null; fsGranted = false; await idbDel('kv', 'fsHandle').catch(() => {}); await idbDel('kv', 'fsBase').catch(() => {}); }
      state = defaults(); await saveNow(); resetUndo(); render();
    }
  };
}

// ---------- Sicherung ----------
async function exportData() {
  setSaveState('Sicherung wird erstellt …');
  const images = {};
  for (const k of await idbKeys('images')) {
    const b = await idbGet('images', k);
    if (b) images[k] = await blobToDataURL(b);
  }
  const blob = new Blob([JSON.stringify({ app: 'unterrichtsheft', exported: new Date().toISOString(), state, images })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Unterrichtsheft Sicherung ${iso(new Date())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  setSaveState('Gespeichert');
}
async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { alert('Die Datei konnte nicht gelesen werden.'); return; }
  if (!data || data.app !== 'unterrichtsheft' || !data.state) { alert('Das ist keine Sicherung des Unterrichtshefts.'); return; }
  if (!confirm('Sicherung einlesen? Die aktuellen Daten werden dabei ersetzt.')) return;
  await idbClear('images'); urlCache.clear();
  for (const [k, url] of Object.entries(data.images || {})) await idbPut('images', k, await (await fetch(url)).blob());
  state = migrate(data.state);
  state._mtime = Date.now();
  await saveNow(); resetUndo(); render();
  if (typeof syncSchedule === 'function') syncSchedule(500);
  alert('Sicherung eingelesen.');
}

// ---------- Start ----------
document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  currentView = b.dataset.view;
  scrollYearToNow = currentView === 'year';
  render();
  if (currentView !== 'year') window.scrollTo(0, 0);
});

(async function init() {
  try {
    db = await openDB();
    const saved = await idbGet('kv', 'state');
    state = saved ? migrate(saved) : defaults();
    // Vorlagen der Schule (nur in schuldaten.js auf dem eigenen Gerät, nicht im veröffentlichten Code)
    if (typeof importHertiOverview === 'function') importHertiOverview();
    if (typeof importStoff2627 === 'function') importStoff2627();
    if (typeof importPres2627b === 'function') importPres2627b();
    if (state._seedMeeting) {
      delete state._seedMeeting;
      const noon = state.settings.slots.find(x => x.to === '12:00');
      if (noon) state.placements.push({ id: uid(), meeting: { title: 'Besprechung SHP', time: '' }, pos: 'p:' + noon.id, repeat: true, day: 2, from: iso(monday(parse(state.settings.start))), skip: [] });
    }
    await saveNow();
    navigator.storage?.persist?.();
    render();
    resetUndo();
    window.__appReady = true;
    if (typeof syncInit === 'function') syncInit();
    if (typeof folderInit === 'function') folderInit();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = '<div class="notice">Der Speicher dieses Browsers ist nicht verfügbar. Bitte öffne die Datei in Microsoft Edge oder Google Chrome (nicht im privaten Fenster).</div>';
  }
})();
