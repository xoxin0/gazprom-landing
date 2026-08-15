/**
 * HTTP-сервер: отдаёт лендинг и принимает заявки в Telegram.
 * Зависимостей нет — только стандартная библиотека Node.js 18+.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { config, isBotConfigured } from './config.js';
import { store } from './store.js';
import { validateLead } from './lead.js';
import { deliverLead, startBot } from './bot.js';

/* ---------- Статика ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Наружу отдаём только index.html и содержимое этих папок */
const PUBLIC_DIRS = new Set(['css', 'js', 'assets', 'pages']);

function resolveStatic(urlPath) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  if (clean === '/' || clean === '/index.html') {
    return path.join(config.publicDir, 'index.html');
  }

  const segments = clean.split('/').filter(Boolean);

  if (segments.length < 2) return null;
  if (!PUBLIC_DIRS.has(segments[0])) return null;
  if (segments.some((segment) => segment === '..' || segment.startsWith('.'))) return null;

  const filePath = path.join(config.publicDir, ...segments);

  // Защита от выхода за пределы каталога проекта
  if (!filePath.startsWith(config.publicDir + path.sep)) return null;

  return filePath;
}

function serveStatic(req, res) {
  const filePath = resolveStatic(req.url.split('?')[0]);

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Страница не найдена');
  }

  const ext = path.extname(filePath).toLowerCase();

  send(
    res,
    200,
    {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // no-cache: браузер каждый раз перепроверяет файл — правки видны сразу
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
    fs.readFileSync(filePath)
  );
}

/* ---------- Утилиты ответа ---------- */

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > config.maxBodyBytes) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------- Ограничение частоты ---------- */

const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const fresh = (hits.get(ip) || []).filter((time) => now - time < config.rateLimit.windowMs);

  if (fresh.length >= config.rateLimit.max) {
    hits.set(ip, fresh);
    return true;
  }

  fresh.push(now);
  hits.set(ip, fresh);
  return false;
}

// Периодическая уборка, чтобы карта не росла бесконечно
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) {
    const fresh = times.filter((time) => now - time < config.rateLimit.windowMs);
    if (fresh.length) hits.set(ip, fresh);
    else hits.delete(ip);
  }
}, config.rateLimit.windowMs).unref();

/* ---------- API ---------- */

async function handleLead(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';

  if (rateLimited(ip)) {
    return sendJson(res, 429, {
      ok: false,
      error: 'Слишком много заявок. Попробуйте позже',
    });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { ok: false, error: 'Некорректный запрос' });
  }

  const result = validateLead(payload);

  if (!result.ok) {
    // Ботам отвечаем как при успехе, чтобы не подсказывать логику фильтра
    if (result.error === 'spam') {
      console.warn(`[lead] отклонено по honeypot, ip ${ip}`);
      return sendJson(res, 200, { ok: true, message: 'Заявка принята.' });
    }
    return sendJson(res, 400, { ok: false, error: result.error });
  }

  const lead = { ...result.lead, number: store.nextLeadNumber() };

  await deliverLead(lead);

  // Для пользователя результат одинаков: заявка принята и не потеряется
  return sendJson(res, 200, {
    ok: true,
    message: 'Спасибо! Заявка принята — свяжемся в течение рабочего дня.',
  });
}

function handleHealth(res) {
  const admin = store.getAdmin();

  sendJson(res, 200, {
    ok: true,
    bot: {
      configured: isBotConfigured(),
      adminAssigned: Boolean(admin),
      adminSince: admin?.claimedAt || null,
    },
    leads: { total: store.totalLeads(), queued: store.queueSize() },
  });
}

/* ---------- Сервер ---------- */

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    if (url === '/api/lead') {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: 'Метод не поддерживается' });
      }
      return await handleLead(req, res);
    }

    if (url === '/api/health' && req.method === 'GET') {
      return handleHealth(res);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res);
    }

    return sendJson(res, 405, { ok: false, error: 'Метод не поддерживается' });
  } catch (error) {
    console.error('[http] необработанная ошибка:', error);
    return sendJson(res, 500, { ok: false, error: 'Внутренняя ошибка сервера' });
  }
});

const stopBot = startBot();

server.listen(config.port, config.host, () => {
  console.log(`[http] лендинг: http://${config.host}:${config.port}`);
});

/* ---------- Корректное завершение ---------- */

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[http] остановка (${signal})…`);
    if (stopBot) stopBot();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
