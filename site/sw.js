// Service worker for offline use (stage 5-5 B, Plan/09 sec.6). Registered by src/sw-register.js as
// "sw.js?v=<precache version>", so a new file list (scripts/55_eva_precache.py) installs a new worker.
//
// Lists: data/eva_precache.json. All URLs there are relative to this worker's scope, so the site also
// works under a GitHub Pages sub-path (…github.io/marswalk-gale/).
//   shell  (html, js, css, i18n, data/*.json, Leaflet): stored at install (first visit).
//          Served network-first, stored copy when the network fails (planning mode never sees old data
//          while online).
//   tiles  (tiles/…): stored only when the page asks (the "Offline ready" button in sw-register.js).
//          Served cache-first.
//   extras (data/*.geojson, data/grid/*.bin): stored with the tiles. Served network-first.
// Requests that are on no list (external Trek tiles, photos, other tiles) are left to the browser.

const SCOPE = new URL(self.registration.scope);
const LIST_URL = new URL('data/eva_precache.json', SCOPE).href;
const PREFIX = 'gale-offline:' + SCOPE.pathname + ':'; // one origin may host several sites (github.io)
const shellName = (v) => PREFIX + 'shell-' + v;
const offlineName = (v) => PREFIX + 'offline-' + v;

const VERSION = new URL(self.location.href).searchParams.get('v') || '';
let listsP = null;
let listsNow = null; // the same, once loaded (lets the fetch handler decide without waiting)

/** Parse the precache list into URL sets (absolute, without query string). */
function parseLists(doc) {
  const abs = (u) => new URL(u, SCOPE).href;
  const shell = new Set(doc.shell.files.map((f) => abs(f[0])));
  shell.add(LIST_URL);
  shell.add(SCOPE.href); // "…/marswalk-gale/" = index.html
  return {
    doc, shell,
    tiles: new Set(doc.tiles.files.map((f) => abs(f[0]))),
    extras: new Set(doc.extras.files.map((f) => abs(f[0]))),
    shellCache: shellName(doc.shell.version),
    offlineCache: offlineName(doc.tiles.version + '-' + doc.extras.version),
  };
}

async function fetchList() {
  const r = await fetch(LIST_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error('precache list HTTP ' + r.status);
  return { doc: await r.clone().json(), res: r };
}

/** Lists for the fetch handler: memory, else the stored copy (offline), else the network. */
function lists() {
  if (!listsP) {
    listsP = (async () => {
      let found = null;
      for (const k of (await caches.keys()).filter((n) => n.startsWith(PREFIX + 'shell-'))) {
        const r = await (await caches.open(k)).match(LIST_URL);
        if (!r) continue;
        const doc = await r.json();
        if (!found || doc.version === VERSION) found = doc;
      }
      return parseLists(found || (await fetchList()).doc);
    })();
    listsP.then((L) => { listsNow = L; }, () => { listsP = null; });
  }
  return listsP;
}
lists().catch(() => {}); // warm up when the worker starts

const key = (url) => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href === SCOPE.href ? new URL('index.html', SCOPE).href : u.href; };

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const { doc, res } = await fetchList();
    const L = parseLists(doc);
    listsP = Promise.resolve(L);
    listsNow = L;
    const cache = await caches.open(L.shellCache);
    await cache.put(LIST_URL, res);
    const urls = [...L.shell].filter((u) => u !== LIST_URL && u !== SCOPE.href);
    // one by one: a missing optional page (e.g. cuff.html before it exists) must not fail the install
    const out = await Promise.allSettled(urls.map(async (u) => {
      const r = await fetch(u, { cache: 'no-cache' });
      if (!r.ok) throw new Error(u + ' HTTP ' + r.status);
      await cache.put(u, r);
    }));
    const bad = out.filter((o) => o.status === 'rejected');
    if (bad.length) console.warn('[sw] shell files not stored:', bad.length, bad.slice(0, 3).map((o) => String(o.reason)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const L = await lists();
    const keep = new Set([L.shellCache, L.offlineCache]);
    for (const k of await caches.keys()) {
      if (k.startsWith(PREFIX) && !keep.has(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

const NET_WAIT_MS = 6000; // a hanging network (weak Wi-Fi) falls back to the stored copy after this

async function networkFirst(req, cacheName, { store }) {
  const k = key(req.url);
  try {
    const net = fetch(req);
    const r = await Promise.race([net, new Promise((res, rej) => setTimeout(async () => {
      (await caches.match(k, { cacheName })) ? rej(new Error('timeout')) : res(net);
    }, NET_WAIT_MS))]);
    if (r.ok && req.method === 'GET' && store) {
      const c = await caches.open(cacheName);
      if (store === 'always' || await c.match(k)) await c.put(k, r.clone());
    }
    return r;
  } catch (err) {
    const hit = await caches.match(k, { cacheName });
    if (!hit) throw err;
    if (req.method === 'HEAD') return new Response(null, { status: hit.status, headers: hit.headers });
    return hit;
  }
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(key(req.url), { cacheName });
  return hit || fetch(req);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const route = (L) => {
    const k = key(req.url);
    if (L.tiles.has(k)) return req.method === 'GET' ? () => cacheFirst(req, L.offlineCache) : null;
    if (L.shell.has(k)) return () => networkFirst(req, L.shellCache, { store: 'always' });
    if (L.extras.has(k)) return () => networkFirst(req, L.offlineCache, { store: 'if-present' });
    return null; // not on a list: leave it to the browser
  };
  if (listsNow) {
    const h = route(listsNow);
    if (h) event.respondWith(h());
    return;
  }
  // worker just started and the lists are not read yet: wait for them
  event.respondWith(lists().then((L) => { const h = route(L); return h ? h() : fetch(req); }, () => fetch(req)));
});

// The page asks for the cache names so it stores tiles where this worker looks for them.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'names') {
    lists().then((L) => event.source && event.source.postMessage({ type: 'names', shell: L.shellCache, offline: L.offlineCache }))
      .catch(() => {});
  }
});
