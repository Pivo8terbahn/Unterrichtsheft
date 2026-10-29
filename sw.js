// Service Worker: hält die App-Dateien auf dem Gerät bereit, damit sie auch ohne Internet startet.
// Bei jeder neuen App-Version VERSION erhöhen.
const VERSION = 'uh-2026-10-29b';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'games.js', 'sync.js', 'foldersync.js', 'sync-config.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'bilder/geburtstag.jpg', 'bilder/meeting-herti-team.jpg', 'bilder/meeting-u-team.jpg', 'bilder/pausenaufsicht.jpg', 'bilder/schwimmunterricht.jpg', 'bilder/zaz-ip.jpg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Eigene Dateien: zuerst aus dem Netz (damit Neuerungen ankommen), ohne Netz aus dem Speicher.
// Anfragen an Microsoft (Anmeldung, OneDrive) laufen immer direkt.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
