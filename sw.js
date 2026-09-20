// Service worker: приложение открывается без интернета.
//
// Стратегия: сначала сеть, копия из кэша — запасной вариант.
// Приложение маленькое, поэтому при живом интернете оно всегда свежее, а без интернета
// открывается сохранённая копия. Если сеть отвечает дольше TIMEOUT, тоже берём копию:
// ждать на плохой связи не приходится.
// При изменении списка файлов увеличьте номер версии.
const VERSION = 'glaza-v2';
const TIMEOUT = 2500;

const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'music.js',
  'exercises/registry.js',
  'exercises/rule20.js',
  'exercises/blink.js',
  'exercises/horizontal.js',
  'exercises/circle.js',
  'exercises/figure8.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'backgrounds/registry.js',
  'backgrounds/host.js',
  'backgrounds/bubbles.js',
  'backgrounds/sea.js',
  'backgrounds/clouds.js',
  'backgrounds/aurora.js',
  'backgrounds/fireflies.js',
  'backgrounds/underwater.js',
  'sound/engine.js',
  'sound/bell.js',
  'sound/ladder.js',
  'sound/tone.js',
  'sound/wave.js',
];

// Музыка может отсутствовать (см. .gitignore): тогда приложение просто работает без неё.
const OPTIONAL_FILES = ['music/loop.json', 'music/loop.mp3'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // cache: 'reload' — берём файлы из сети, минуя обычный кэш браузера (иначе можно скачать старые)
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })))
        // необязательные файлы: если их нет на сервере, приложение всё равно ставится
        .then(() => Promise.all(OPTIONAL_FILES.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const ownFile = url.origin === self.location.origin;
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!ownFile && !font) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const fromCache = () => cache.match(request, { ignoreSearch: ownFile });

      // Шрифты не меняются — их достаточно взять из кэша, если они там есть.
      if (font) {
        const cached = await fromCache();
        if (cached) return cached;
      }

      // Свои файлы запрашиваем мимо обычного кэша браузера: GitHub Pages просит держать их
      // 10 минут, и без этого обновление приложения приходило бы с задержкой.
      // Запрос строим по адресу: Request с режимом navigate скопировать напрямую нельзя.
      const netRequest = ownFile ? new Request(request.url, { cache: 'reload', credentials: 'same-origin' }) : request;
      const fresh = fetch(netRequest)
        .then((response) => {
          if (response.ok || response.type === 'opaque') cache.put(request, response.clone()).catch(() => {});
          return response;
        })
        .catch(() => null);

      event.waitUntil(fresh); // не выключаемся, пока свежая копия не ляжет в кэш
      const slow = new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT));
      const response = (await Promise.race([fresh, slow])) || (await fromCache()) || (await fresh);
      if (response) return response;

      // нет сети и нет копии: для перехода на страницу отдаём главный экран
      if (request.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }),
  );
});
