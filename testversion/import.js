'use strict';
// ===================================================================
// Jahresplanung importieren (Einstellungen)
// Liest Termine aus Excel (.xlsx), Word (.docx, Tabellen oder Zeilen mit Datum) oder CSV,
// zeigt sie zur Kontrolle an und übernimmt die gewählten Einträge in einem Rückgängig-Schritt.
// .xlsx und .docx sind ZIP-Archive mit XML; entpackt wird mit DecompressionStream, ohne Zusatzbibliothek.
// ===================================================================
const JP_KINDS = {
  termin: 'Termin', woche: 'Anmerkung zur Woche', notiz: 'Tagesnotiz', praesenz: 'Präsenznachmittag',
  fenster: 'Zeitfenster (z. B. Schwimmen)', frei: 'schulfrei', ferien: 'Ferien', skip: 'nicht übernehmen'
};

// ---------- ZIP lesen ----------
async function jpUnzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let eo = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('Die Datei ist keine gültige Excel- oder Word-Datei.');
  const files = {};
  let p = dv.getUint32(eo + 16, true);
  for (let k = 0, n = dv.getUint16(eo + 10, true); k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    files[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), lo: dv.getUint32(p + 42, true) };
    p += 46 + nl + xl + cl;
  }
  return {
    async text(name) {
      const f = files[name];
      if (!f) return null;
      const start = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true);
      const raw = u8.subarray(start, start + f.size);
      if (f.method === 0) return dec.decode(raw);
      if (f.method !== 8) throw new Error('Die Datei ist auf unbekannte Art komprimiert.');
      if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser kann die Datei nicht öffnen. Bitte den Browser aktualisieren oder die Tabelle als CSV speichern.');
      const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return dec.decode(await new Response(s).arrayBuffer());
    }
  };
}
const jpXML = t => new DOMParser().parseFromString(t, 'application/xml');
const jpKids = (el, name) => [...el.children].filter(c => c.localName === name);
const jpAll = (el, name) => [...el.getElementsByTagNameNS('*', name)];
const jpSerialDate = n => { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const jpSerialTime = n => { const m = Math.round((n % 1) * 1440); return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; };

// ---------- Excel ----------
async function jpReadXlsx(zip) {
  const shared = [];
  const ss = await zip.text('xl/sharedStrings.xml');
  if (ss) for (const si of jpAll(jpXML(ss), 'si')) shared.push(jpAll(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join(''));
  // Zellformate: Datum oder Uhrzeit erkennen
  const kinds = [];
  const st = await zip.text('xl/styles.xml');
  if (st) {
    const sd = jpXML(st), codes = {};
    for (const f of jpAll(sd, 'numFmt')) codes[f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || '';
    const xfs = jpAll(sd, 'cellXfs')[0];
    for (const xf of xfs ? jpKids(xfs, 'xf') : []) {
      const id = Number(xf.getAttribute('numFmtId') || 0);
      const code = (codes[id] || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').toLowerCase();
      kinds.push((id >= 14 && id <= 17) || id === 22 || /[dy]/.test(code) ? 'date' : (id >= 18 && id <= 21) || (id >= 45 && id <= 47) || /h/.test(code) ? 'time' : '');
    }
  }
  const wb = jpXML(await zip.text('xl/workbook.xml')), rels = {};
  const rx = await zip.text('xl/_rels/workbook.xml.rels');
  if (rx) for (const r of jpAll(jpXML(rx), 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const sheets = [];
  for (const sh of jpAll(wb, 'sheet')) {
    const rid = [...sh.attributes].find(a => a.localName === 'id');
    let target = rid && rels[rid.value];
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const xml = await zip.text(target);
    if (!xml) continue;
    const rows = [];
    for (const row of jpAll(jpXML(xml), 'row')) {
      const arr = [];
      for (const c of jpKids(row, 'c')) {
        const ref = c.getAttribute('r') || '', col = [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const t = c.getAttribute('t'), v = (jpKids(c, 'v')[0] || {}).textContent || '';
        let val;
        if (t === 's') val = shared[Number(v)] || '';
        else if (t === 'inlineStr') val = jpAll(c, 't').map(x => x.textContent).join('');
        else if (t === 'str' || t === 'e' || t === 'b') val = v;
        else if (t === 'd') val = v.slice(0, 10);
        else {
          const k = kinds[Number(c.getAttribute('s') || 0)];
          val = v !== '' && k === 'date' ? jpSerialDate(Number(v)) + (Number(v) % 1 ? ' ' + jpSerialTime(Number(v)) : '') : v !== '' && k === 'time' ? jpSerialTime(Number(v)) : v;
        }
        arr[col >= 0 ? col : arr.length] = val;
      }
      rows.push(Array.from(arr, x => x ?? ''));
    }
    sheets.push(rows);
  }
  return sheets;
}

// ---------- Word ----------
async function jpReadDocx(zip) {
  const doc = jpXML(await zip.text('word/document.xml'));
  const body = jpAll(doc, 'body')[0];
  const ptext = p => jpAll(p, '*').map(n => n.localName === 't' ? n.textContent : n.localName === 'tab' && n.parentNode.localName === 'r' ? '\t' : n.localName === 'br' ? ' ' : '').join('');
  // jede Tabelle für sich, Zeilen ausserhalb von Tabellen zusammen als eigene Tabelle
  const tables = [], rows = [];
  const walk = el => {
    for (const ch of el.children) {
      if (ch.localName === 'tbl') tables.push(jpKids(ch, 'tr').map(tr => jpKids(tr, 'tc').map(tc => jpAll(tc, 'p').map(ptext).map(s => s.trim()).filter(Boolean).join('\n'))));
      else if (ch.localName === 'p') {
        // Zeilen ausserhalb einer Tabelle zählen nur, wenn sie mit einem Datum beginnen, z. B. «17.08.2026 Schulbeginn»
        const t = ptext(ch).trim();
        const m = /^((?:[A-Za-z]{2},?\s*)?\d{1,2}\.\s*(?:\d{1,2}\.|[A-Za-zä]{3,}\.?)\s*(?:\d{2,4})?(?:\s*[–—-]\s*\d{1,2}\.\s*(?:\d{1,2}\.|[A-Za-zä]{3,}\.?)\s*(?:\d{2,4})?)?)\s*[:\t–-]?\s*(.+)$/.exec(t);
        if (m) rows.push(t.includes('\t') ? t.split('\t').map(s => s.trim()) : [m[1], m[2]]);
      } else if (ch.localName === 'sdt' || ch.localName === 'sdtContent') walk(ch);
    }
  };
  walk(body);
  return rows.length ? [...tables, rows] : tables;
}

// ---------- CSV ----------
function jpReadCsv(text) {
  const first = text.split(/\r?\n/)[0] || '';
  const sep = [';', '\t', ','].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return [rows];
}

// ---------- Datum und Zeit erkennen ----------
const JP_MONTHS = { jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
function jpYear(y, m) {
  if (y) return y < 100 ? 2000 + y : y;
  const sy = Number(state.settings.start.slice(0, 4));
  return m >= 8 ? sy : sy + 1; // ohne Jahr: August bis Dezember im ersten, Januar bis Juli im zweiten Jahr des Schuljahrs
}
const jpISO = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${pad(m)}-${pad(d)}` : null;
function jpDates(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) { const d = jpSerialDate(+s); return { from: d, to: d }; }
  const toks = [];
  let m;
  const re = /(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?|(\d{1,2})\.\s*([A-Za-zäÄ]{3,})\.?\s*(\d{4})?/g;
  while ((m = re.exec(s))) {
    if (m[1]) toks.push({ y: +m[1], m: +m[2], d: +m[3], at: m.index });
    else if (m[4]) toks.push({ y: m[6] ? +m[6] : 0, m: +m[5], d: +m[4], at: m.index });
    else { const mo = JP_MONTHS[m[8].slice(0, 3).toLowerCase()]; if (mo) toks.push({ y: m[9] ? +m[9] : 0, m: mo, d: +m[7], at: m.index }); }
  }
  if (!toks.length) return null;
  // «14.–18.12.2026»: erster Tag ohne Monat vor dem ersten vollständigen Datum
  const pre = /(\d{1,2})\.?\s*(?:[–—-]|bis)\s*$/.exec(s.slice(0, toks[0].at));
  if (pre) toks.unshift({ y: toks[0].y, m: toks[0].m, d: +pre[1] });
  const last = toks[toks.length - 1];
  const fill = t => { if (!t.y && last.y && t.m <= last.m) t.y = last.y; return jpISO(jpYear(t.y, t.m), t.m, t.d); };
  const from = fill(toks[0]), to = fill(last);
  if (!from) return null;
  return { from, to: to && to > from ? to : from };
}
function jpTimes(raw) {
  const s = String(raw || '').trim();
  if (/^0?\.\d+$/.test(s)) return { from: jpSerialTime(+s) };
  const m = /(\d{1,2})[.:](\d{2})(?:\s*(?:Uhr)?\s*(?:–|—|-|bis)\s*(\d{1,2})[.:](\d{2}))?/.exec(s);
  if (!m || +m[1] > 23 || +m[2] > 59) return {};
  const out = { from: `${pad(+m[1])}:${m[2]}` };
  if (m[3] && +m[3] < 24 && +m[4] < 60) out.to = `${pad(+m[3])}:${m[4]}`;
  return out;
}
// Uhrzeit am Anfang des Anlasses, z. B. «09.30 SJ-Eröffnung» oder «18.30–20.00 Uhr Elternabend»
function jpLeadTime(title) {
  const m = /^(\d{1,2}[.:]\d{2}(?:\s*[–—-]\s*\d{1,2}[.:]\d{2})?)\s*(?:Uhr)?\s+(.+)$/.exec(title);
  return m ? { times: jpTimes(m[1]), title: m[2] } : { times: {}, title };
}

// ---------- Spalten erkennen ----------
const JP_HEAD = {
  date: /^(datum|tag|wann|von|ab|beginn|start)\b/i,
  to: /^(bis|ende|enddatum)\b/i,
  time: /^(zeit|uhrzeit|uhr)\b/i,
  title: /^(titel|anlass|anlässe|termin|termine|was|bezeichnung|veranstaltung|ereignis|thema|inhalt|beschreibung|aktivität)/i,
  kind: /^(art|kategorie|typ|bereich|ziel|rubrik)\b/i,
  note: /^(notiz|bemerkung|hinweis|ort|wo|wer|zuständig|info|details|für|klasse|stufe|teilnehmende|verantwortlich)/i
};
const jpIsTimeHead = h => /^\d{1,2}[.:]\d{2}/.test(h.trim());
function jpColumns(rows) {
  const width = Math.max(0, ...rows.map(r => r.length));
  const ratio = (c, test, from) => { const vals = rows.slice(from, from + 40).map(r => String(r[c] || '').trim()).filter(Boolean); return vals.length ? vals.filter(test).length / vals.length : 0; };
  for (let h = 0; h < Math.min(15, rows.length); h++) {
    const head = rows[h].map(x => String(x || '').trim());
    const roles = { date: [], to: -1, time: -1, title: -1, kind: -1, note: [], timeCols: [] };
    head.forEach((x, c) => {
      if (!x) return;
      if (jpIsTimeHead(x)) roles.timeCols.push({ c, times: jpTimes(x) });
      else if (JP_HEAD.to.test(x) && roles.to < 0) roles.to = c;
      else if (JP_HEAD.date.test(x)) roles.date.push(c);
      else if (JP_HEAD.time.test(x) && roles.time < 0) roles.time = c;
      else if (JP_HEAD.title.test(x) && roles.title < 0) roles.title = c;
      else if (JP_HEAD.kind.test(x) && roles.kind < 0) roles.kind = c;
      else if (JP_HEAD.note.test(x)) roles.note.push(c);
    });
    if (!roles.date.length || (roles.title < 0 && !roles.timeCols.length)) continue;
    const best = roles.date.map(c => [c, ratio(c, v => !!jpDates(v), h + 1)]).sort((a, b) => b[1] - a[1])[0];
    if (best[1] < 0.3) continue;
    return { head: h, date: best[0], to: roles.to, time: roles.time, title: roles.title, kind: roles.kind, note: roles.note, timeCols: roles.timeCols };
  }
  // ohne Kopfzeile: Spalte mit den meisten Daten, dann die Spalte mit dem meisten Text
  const dateCol = [...Array(width).keys()].map(c => [c, ratio(c, v => !!jpDates(v), 0)]).sort((a, b) => b[1] - a[1])[0];
  if (!dateCol || dateCol[1] < 0.3) return null;
  const others = [...Array(width).keys()].filter(c => c !== dateCol[0]);
  const timeCol = others.find(c => ratio(c, v => !!jpTimes(v).from && String(v).trim().length <= 20, 0) > 0.6);
  const textLen = c => rows.reduce((n, r) => n + String(r[c] || '').length, 0);
  const texts = others.filter(c => c !== timeCol).sort((a, b) => textLen(b) - textLen(a));
  if (!texts.length) return null;
  return { head: -1, date: dateCol[0], to: -1, time: timeCol ?? -1, title: texts[0], kind: -1, note: texts.slice(1).filter(c => textLen(c) > 0), timeCols: [] };
}

function jpPresBlock(t) {
  if (!t.from) return 'AB';
  const a = mins(t.from), b = t.to ? mins(t.to) : null;
  if (a < mins('15:00') && b !== null && b <= mins('15:05')) return 'A';
  if (a >= mins('15:00')) return 'B';
  return b === null && a < mins('14:30') ? 'A' : 'AB';
}
function jpPresCat(text) {
  const t = text.toLowerCase();
  if (/unterrichtsfrei/.test(t)) return 'frei';
  if (/unterrichtsteam|u-team|\but\b/.test(t)) return 'ut';
  if (/zaz|individuelle planung|\bip\b/.test(t)) return 'zaz';
  if (/stufenrundtisch/.test(t)) return 'srt';
  if (/\bwit\b|weiterbildung/.test(t)) return 'wit';
  if (/fachteam|teamsitzung|shp|daz/.test(t)) return 'team';
  if (/schulhausteam|gesamtteam|hertiteam|teamanlass/.test(t)) return 'ht';
  return 'other';
}
function jpGuessKind(kind, title, d, times, fromTimeCol) {
  const k = kind.toLowerCase(), t = title.toLowerCase(), multi = d.to > d.from;
  if (/nicht|ignor/.test(k)) return 'skip';
  if (/ferien/.test(k)) return 'ferien';
  if (/schulfrei|feiertag|unterrichtsfrei|^frei/.test(k)) return 'frei';
  if (/präsenz|praesenz/.test(k)) return 'praesenz';
  if (/zeitfenster|schwimm/.test(k)) return times.from && times.to ? 'fenster' : 'termin';
  if (/woche|mehrtägig/.test(k)) return 'woche';
  if (/notiz|aufgabe|checkliste/.test(k)) return 'notiz';
  if (/termin/.test(k)) return multi ? 'woche' : 'termin';
  if (/unterrichtsfrei|schulfrei/.test(t)) return 'frei';
  if (multi) return /ferien\b/.test(t) ? 'ferien' : 'woche';
  if (fromTimeCol && times.from && mins(times.from) >= mins('13:00')) return 'praesenz';
  return 'termin';
}

// Tabellen in Einträge umwandeln
function jpInterpret(sheets) {
  const items = [], skipped = [];
  for (const rows of sheets) {
    const col = jpColumns(rows);
    if (!col) continue; // z. B. ein Blatt mit Hinweisen
    let last = null;
    for (let i = col.head + 1; i < rows.length; i++) {
      const cells = rows[i].map(x => String(x ?? '').trim());
      if (!cells.some(Boolean)) continue;
      let d = jpDates(cells[col.date]);
      if (d) last = d;
      else if (cells[col.date]) { if (cells.filter(Boolean).length > 1) skipped.push(`Zeile ${i + 1}: Datum «${cells[col.date]}» nicht erkannt`); continue; }
      else if (last) d = last; // leeres Datumsfeld: gehört zum Datum der Zeile darüber
      else continue;
      if (col.to >= 0) { const t = jpDates(cells[col.to]); if (t && t.to > d.from) d = { from: d.from, to: t.to }; }
      const kind = (col.kind >= 0 && cells[col.kind]) || '';
      const note = col.note.map(c => cells[c]).filter(Boolean).join(' · ');
      const colTimes = col.time >= 0 ? jpTimes(cells[col.time]) : {};
      const add = (text, times, fromTimeCol) => {
        for (const line of text.split(/\n+/).map(x => x.trim()).filter(Boolean)) {
          const lead = times.from ? { times, title: line } : jpLeadTime(line);
          const k = jpGuessKind(kind, lead.title, d, lead.times, fromTimeCol);
          items.push({ id: uid(), on: k !== 'skip', kind: k, from: d.from, to: d.to, time: lead.times.from || '', end: lead.times.to || '', title: lead.title, note });
        }
      };
      if (col.title >= 0 && cells[col.title]) add(cells[col.title], colTimes, false);
      for (const tc of col.timeCols) if (cells[tc.c]) add(cells[tc.c], tc.times, true);
    }
  }
  return { items, skipped };
}

// ---------- Übernehmen ----------
const jpSchoolDays = (a, b) => { const out = []; for (let x = parse(a); x <= parse(b); x = addDays(x, 1)) if (x.getDay() % 6) out.push(iso(x)); return out.length ? out : [a]; };
function jpApply(items) {
  const n = {}, s = state.settings;
  const cnt = k => { n[k] = (n[k] || 0) + 1; };
  const range = x => x.to > x.from ? ` (${fmtShort(parse(x.from))}–${fmtShort(parse(x.to))})` : '';
  for (const x of items) {
    if (!x.on || x.kind === 'skip') continue;
    const full = x.title + (x.note ? ' · ' + x.note : '');
    let kind = x.kind;
    if (kind === 'fenster' && !(x.time && x.end)) kind = 'termin';
    if (kind === 'termin') {
      for (const d of x.to > x.from ? jpSchoolDays(x.from, x.to) : [x.from]) {
        if (state.events.some(e => e.date === d && e.title === x.title)) continue;
        state.events.push({ id: uid(), date: d, time: x.time, title: x.title, note: [x.end ? 'bis ' + x.end.replace(':', '.') + ' Uhr' : '', x.note].filter(Boolean).join(' · ') });
        cnt(kind);
      }
    } else if (kind === 'woche') {
      const text = (x.to > x.from ? '' : DAYS[dayIdx(x.from)] + ' ') + full + range(x);
      for (let mk = monday(parse(x.from)); mk <= parse(x.to); mk = addDays(mk, 7)) {
        const k = iso(mk), cur = state.weekNotes[k] || '';
        if (cur.includes(x.title)) continue;
        state.weekNotes[k] = cur ? cur + '\n' + text : text; cnt(kind);
      }
    } else if (kind === 'notiz') {
      for (const d of jpSchoolDays(x.from, x.to)) {
        const list = state.dayTasks[d] = state.dayTasks[d] || [];
        const text = (x.time ? x.time.replace(':', '.') + (x.end ? '–' + x.end.replace(':', '.') : '') + ' ' : '') + full;
        if (list.some(t => t.text === text)) continue;
        list.push({ id: uid(), text, done: false }); cnt(kind);
      }
    } else if (kind === 'praesenz') {
      const block = jpPresBlock({ from: x.time, to: x.end }), cat = jpPresCat(x.title);
      for (const d of jpSchoolDays(x.from, x.to)) {
        if (state.presence.some(p => p.date === d && p.block === block && p.title === x.title)) continue;
        state.presence.push({ id: uid(), date: d, block, cat, title: x.title, ...(x.note ? { note: x.note } : {}) }); cnt(kind);
      }
    } else if (kind === 'fenster') {
      for (const d of jpSchoolDays(x.from, x.to)) {
        if (state.fixed.some(f => f.date === d && f.from === x.time && f.title === x.title)) continue;
        state.fixed.push({ id: uid(), date: d, from: x.time, to: x.end, title: x.title, color: '#cfe8fa', ...(x.note ? { note: x.note } : {}) }); cnt(kind);
      }
    } else if (kind === 'frei' || kind === 'ferien') {
      const days = jpSchoolDays(x.from, x.to);
      s.extraOff = s.extraOff || {}; s.holidays = s.holidays || {};
      const weeks = new Set();
      let changed = false;
      for (const d of days) {
        const mk = iso(monday(parse(d)));
        if (kind === 'ferien' && [0, 1, 2, 3, 4].every(i => days.includes(iso(addDays(parse(mk), i))))) weeks.add(mk);
        else if (s.extraOff[d] !== x.title) { s.extraOff[d] = x.title; changed = true; }
      }
      for (const mk of weeks) if (s.holidays[mk] !== x.title) { s.holidays[mk] = x.title; changed = true; }
      if (changed) cnt(kind);
    }
  }
  return n;
}

// ---------- Anzeige ----------
let jpItems = [], jpFile = '';
function importMountCard() {
  const el = document.getElementById('importCard');
  if (!el) return;
  el.innerHTML = `<h2>Jahresplanung importieren</h2>
    <p>Termine für das ganze Schuljahr aus einer Excel-Tabelle, einem Word-Dokument mit Tabelle oder einer CSV-Datei übernehmen, zum Beispiel die Jahresübersicht der Schule oder die Planung der Präsenznachmittage.</p>
    <ol class="fs-steps">
      <li>Vorlage herunterladen und ausfüllen oder eine eigene Tabelle verwenden. Nötig sind eine Spalte <b>Datum</b> und eine Spalte <b>Anlass</b>. Die Spalten <b>Bis</b>, <b>Zeit</b>, <b>Art</b> und <b>Bemerkung</b> sind freiwillig.</li>
      <li>«Datei wählen» antippen und die Datei aussuchen.</li>
      <li>Die erkannten Einträge prüfen, wenn nötig anpassen und übernehmen.</li>
    </ol>
    <div class="btn-row">
      <label class="btn primary">Datei wählen …<input type="file" hidden data-jpfile accept=".xlsx,.docx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv"></label>
      <a class="btn" href="vorlagen/Vorlage-Jahresplanung.xlsx" download>Vorlage Excel</a>
      <a class="btn" href="vorlagen/Vorlage-Jahresplanung.docx" download>Vorlage Word</a>
    </div>
    <details class="jp-help"><summary>Was bedeuten die Arten?</summary>
      <ul>
        <li><b>Termin</b>: erscheint am Tag in der Wochenansicht und unter Termine &amp; To-dos (Standard für eintägige Anlässe)</li>
        <li><b>Woche</b>: Eintrag in den Anmerkungen zur Woche (Standard für mehrtägige Anlässe wie Lager oder Projektwochen)</li>
        <li><b>Notiz</b>: Eintrag in der Checkliste des Tages</li>
        <li><b>Präsenz</b>: Präsenznachmittag, z. B. Unterrichtsteam oder ZAZ / IP; die Zeit bestimmt den Block (13.30–15.00, 15.05–16.30 oder ganzer Nachmittag)</li>
        <li><b>Zeitfenster</b>: fester Block mit Beginn und Ende über dem Stundenraster, z. B. Schwimmen 08.00–08.45</li>
        <li><b>schulfrei</b> und <b>Ferien</b>: Tage werden als schulfrei markiert</li>
      </ul>
      <p class="hint">Ohne Spalte «Art» schlägt die App die Art selbst vor. Eine Tabelle mit Zeiten als Spaltentitel (z. B. «13.30–15.00» und «15.05–16.30») wird als Präsenzplanung gelesen.</p>
    </details>
    <p class="hint">Alte Formate (.xls, .doc) zuerst in Excel oder Word öffnen und als .xlsx bzw. .docx speichern. Gleiche Einträge werden nicht doppelt übernommen. Ein Import lässt sich mit ↶ in der Wochenansicht rückgängig machen, solange die Seite nicht neu geladen wurde.</p>`;
  el.onchange = e => { if (e.target.matches('[data-jpfile]') && e.target.files[0]) { jpLoad(e.target.files[0]); e.target.value = ''; } };
}
async function jpLoad(file) {
  const name = file.name.toLowerCase();
  let sheets;
  try {
    if (/\.(xls|doc)$/.test(name)) throw new Error('Dieses ältere Format kann die App nicht lesen. Bitte die Datei in Excel oder Word öffnen und als .xlsx bzw. .docx speichern.');
    if (/\.(xlsx|xlsm|docx)$/.test(name)) {
      const zip = await jpUnzip(await file.arrayBuffer());
      sheets = name.endsWith('.docx') ? await jpReadDocx(zip) : await jpReadXlsx(zip);
    } else {
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
      sheets = jpReadCsv(text.replace(/^﻿/, ''));
    }
  } catch (e) { console.error(e); alert('Die Datei konnte nicht gelesen werden.\n\n' + e.message); return; }
  const r = jpInterpret(sheets);
  if (!r.items.length) { alert('In der Datei wurden keine Einträge mit Datum gefunden.\n\nTipp: Die Vorlage herunterladen und die Spalten «Datum» und «Anlass» verwenden.' + (r.skipped.length ? '\n\n' + r.skipped.slice(0, 5).join('\n') : '')); return; }
  jpItems = r.items; jpFile = file.name;
  jpShow(r.skipped);
}
function jpDlg() {
  let d = document.getElementById('jpDlg');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'jpDlg'; d.className = 'picker wide jp-dlg';
    document.body.appendChild(d);
    d.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.jpon) { jpItems.find(x => x.id === t.dataset.jpon).on = t.checked; jpCount(); }
      else if (t.dataset.jpkind) { const x = jpItems.find(y => y.id === t.dataset.jpkind); x.kind = t.value; x.on = t.value !== 'skip'; jpRows(); }
      else if ('jpall' in t.dataset) { jpItems.forEach(x => { x.on = t.checked && x.kind !== 'skip'; }); jpRows(); }
    });
    d.addEventListener('click', e => {
      if (e.target.closest('[data-jpcancel]')) d.close();
      else if (e.target.closest('[data-jpok]')) {
        const n = jpApply(jpItems);
        d.close(); save(true); render();
        const total = Object.values(n).reduce((a, b) => a + b, 0);
        alert(total ? `Übernommen: ${Object.entries(n).map(([k, v]) => `${v} × ${JP_KINDS[k]}`).join(', ')}.` : 'Es gab nichts Neues zu übernehmen. Die Einträge sind schon vorhanden.');
      }
    });
  }
  return d;
}
const jpDayLabel = di => `${DAYS7[parse(di).getDay()]} ${fmtShort(parse(di))}${di.slice(2, 4)}`;
function jpRows() {
  const s = state.settings;
  document.querySelector('#jpDlg tbody').innerHTML = jpItems.map(x => {
    const out = x.to < s.start || x.from > s.end;
    return `<tr class="${x.on ? '' : 'off'} ${out ? 'jp-out' : ''}" ${out ? 'title="ausserhalb des eingestellten Schuljahrs"' : ''}>
      <td><input type="checkbox" data-jpon="${x.id}" ${x.on ? 'checked' : ''} aria-label="übernehmen"></td>
      <td class="jp-date">${jpDayLabel(x.from)}${x.to > x.from ? `<small>bis ${jpDayLabel(x.to)}</small>` : ''}</td>
      <td class="jp-time">${x.time ? x.time.replace(':', '.') + (x.end ? '–' + x.end.replace(':', '.') : '') : ''}</td>
      <td>${esc(x.title)}${x.note ? `<small>${esc(x.note)}</small>` : ''}</td>
      <td><select data-jpkind="${x.id}" aria-label="Übernehmen als">${Object.entries(JP_KINDS).map(([k, n]) => `<option value="${k}" ${k === x.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></td></tr>`;
  }).join('');
  jpCount();
}
function jpCount() {
  const on = jpItems.filter(x => x.on && x.kind !== 'skip');
  const by = {};
  on.forEach(x => { by[x.kind] = (by[x.kind] || 0) + 1; });
  document.querySelector('#jpDlg .jp-sum').innerHTML = Object.entries(by).map(([k, v]) => `<span>${v} × ${JP_KINDS[k]}</span>`).join('') || '<span>nichts ausgewählt</span>';
  const ok = document.querySelector('#jpDlg [data-jpok]');
  ok.textContent = `${on.length} Einträge übernehmen`; ok.disabled = !on.length;
}
function jpShow(skipped) {
  const d = jpDlg(), out = jpItems.filter(x => x.to < state.settings.start || x.from > state.settings.end).length;
  d.innerHTML = `<div class="pick">
    <h2>Import prüfen</h2>
    <p>Aus «${esc(jpFile)}» wurden <b>${jpItems.length}</b> Einträge erkannt. Pro Zeile kannst du wählen, wohin der Eintrag kommt, oder das Häkchen entfernen.</p>
    ${out ? `<p class="notice">${out} Einträge liegen ausserhalb des eingestellten Schuljahrs (${fmtShort(parse(state.settings.start))}${state.settings.start.slice(2, 4)} bis ${fmtShort(parse(state.settings.end))}${state.settings.end.slice(2, 4)}). Sie sind grau markiert. Prüfe allenfalls das Schuljahr unter «Klasse und Schuljahr».</p>` : ''}
    <div class="jp-sum"></div>
    <div class="table-wrap jp-wrap"><table class="jp-table">
      <thead><tr><th><input type="checkbox" data-jpall checked aria-label="alle"></th><th>Datum</th><th>Zeit</th><th>Eintrag</th><th>Übernehmen als</th></tr></thead>
      <tbody></tbody></table></div>
    ${skipped.length ? `<details class="jp-skip"><summary>${skipped.length} Zeilen nicht erkannt</summary><ul>${skipped.slice(0, 50).map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    <div class="pick-foot"><span></span><span class="btn-row"><button type="button" class="btn" data-jpcancel>Abbrechen</button><button type="button" class="btn primary" data-jpok>Übernehmen</button></span></div>
  </div>`;
  jpRows();
  d.showModal();
}
