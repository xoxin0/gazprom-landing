/**
 * Конфигурация. Читает .env (если есть), не перетирая реальные переменные окружения.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);

    // Переменные окружения имеют приоритет над файлом
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

export const config = {
  port: Number(process.env.PORT) || 5173,

  /*
     По умолчанию слушаем все интерфейсы: на любом хостинге порт, привязанный
     к localhost, снаружи недоступен, и приложение выглядит «упавшим».
     Локально адрес сужается до 127.0.0.1 через HOST в .env — он есть в .env.example.
  */
  host: process.env.HOST || '0.0.0.0',

  /** Токен от @BotFather. Пока не задан — сайт работает, заявки копятся в очереди. */
  botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),

  /**
   * Telegram ID администратора. Если задан — закрепляется навсегда и не зависит
   * от файла состояния. Нужен там, где диск сбрасывается при каждом деплое:
   * иначе после перезапуска админом стал бы первый случайный написавший.
   */
  adminId: Number(process.env.TELEGRAM_ADMIN_ID) || null,

  publicDir: ROOT,
  dataDir: path.join(ROOT, 'server', 'data'),

  /** Не больше 5 заявок с одного адреса за 10 минут */
  rateLimit: { max: 5, windowMs: 10 * 60 * 1000 },

  maxBodyBytes: 32 * 1024,
};

export const isBotConfigured = () => Boolean(config.botToken);
