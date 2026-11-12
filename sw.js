// Service worker: o app abre sem internet.
// Estratégia "rede primeiro": online sempre pega a versão nova (e atualiza a cópia);
// offline (ou rede lenta) usa a cópia guardada.

const CACHE = 'mzk-shell-v3';
const NETWORK_TIMEOUT_MS = 3000;

// Tudo que o app precisa para abrir offline. (test/sw.test.js confere esta lista.)
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'app/styles.css',
  'app/main.js',
  'app/store.js',
  'app/storage.js',
  'app/sync.js',
  'app/audio.js',
  'app/grid.js',
  'app/ui.js',
  'app/views/chords.js',
  'app/views/drums.js',
  'app/views/gridcommon.js',
  'app/views/pianoroll.js',
  'app/views/project.js',
  'app/icons/icon.svg',
  'app/icons/icon-192.png',
  'app/icons/icon-512.png',
  'app/icons/apple-touch-icon.png',
  'app/icons/favicon-32.png',
  'src/core/chords.js',
  'src/core/edit.js',
  'src/core/lilypond.js',
  'src/core/midi.js',
  'src/core/project.js',
  'src/core/theory.js',
  'src/core/timeline.js',
  'src/core/voicing.js',
  'examples/MZK-0001_exemplo.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  return (await cache.match(request, { ignoreSearch: true }))
    ?? (request.mode === 'navigate' ? cache.match('index.html') : undefined);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, 'timeout'));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== 'timeout') return first;
    // Rede lenta: usa a cópia se houver; senão continua esperando a rede.
    return (await fromCache(request)) ?? (await network);
  } catch {
    const cached = await fromCache(request);
    if (cached) return cached;
    return new Response('Sem conexão e sem cópia guardada.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
