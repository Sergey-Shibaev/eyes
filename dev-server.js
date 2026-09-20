// Локальный сервер для предпросмотра приложения на компьютере. Без зависимостей.
// Запуск: node dev-server.js  →  http://localhost:8137
//
// Сервер отдаёт файлы из своей папки и ничего не умеет, кроме этого, поэтому он слушает
// только свой компьютер (127.0.0.1). Открыть его для телефона в той же сети:
//   HOST=0.0.0.0 node dev-server.js
// Так делать стоит только в доверенной сети: сервер отдаёт все файлы папки всем желающим.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const port = Number(process.env.PORT) || 8138;
const host = process.env.HOST || '127.0.0.1';
const MAX_ICON = 2 * 1024 * 1024; // больше иконка быть не может

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const fail = (res, code, text) => {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text || '');
};

// Путь из запроса → файл внутри папки проекта, или null, если запрос ведёт наружу.
function resolveFile(pathname) {
  if (pathname.includes('\0')) return null;
  let rel = path.posix.normalize(pathname.endsWith('/') ? `${pathname}index.html` : pathname);
  // Служебные файлы вроде .git наружу не отдаём (пригодится, если сервер открыт в сеть).
  if (rel.split('/').some((part) => part.startsWith('.') && part !== '.')) return null;
  const file = path.resolve(root, `.${rel}`);
  // Именно с разделителем в конце: иначе подошла бы и соседняя папка с похожим именем.
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

// Сохранение иконок, нарисованных страницей tools/make-icons.html.
// Только со своего компьютера и только под именем вида icon-*.png в папку icons.
function saveIcon(req, res, name) {
  const local = req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1';
  if (!local || !/^icon-[a-z0-9-]{1,40}\.png$/.test(name)) {
    fail(res, 403);
    req.resume(); // дочитываем тело, иначе соединение повиснет
    return;
  }
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_ICON) {
      fail(res, 413, 'Слишком большой файл');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', () => {});
  req.on('end', () => {
    if (res.writableEnded) return;
    try {
      fs.mkdirSync(path.join(root, 'icons'), { recursive: true });
      fs.writeFileSync(path.join(root, 'icons', name), Buffer.concat(chunks));
      res.writeHead(204);
      res.end();
    } catch (err) {
      fail(res, 500, 'Не удалось сохранить');
    }
  });
}

const server = http.createServer((req, res) => {
  let url;
  let pathname;
  try {
    url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname); // ломается на кривых %-последовательностях
  } catch {
    fail(res, 400, 'Неверный адрес');
    return;
  }

  if (url.pathname === '/__save-icon') {
    if (req.method !== 'POST') {
      fail(res, 405);
      return;
    }
    saveIcon(req, res, url.searchParams.get('name') || '');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    fail(res, 405);
    return;
  }

  const file = resolveFile(pathname);
  if (!file) {
    fail(res, 403, 'Нельзя');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      fail(res, 404, 'Не найдено');
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// Оборвавшееся соединение или мусор вместо запроса не должны ронять сервер.
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});
process.on('uncaughtException', (err) => console.error('Ошибка:', err && err.message));

server.listen(port, host, () => console.log(`Глаза: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
