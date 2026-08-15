/**
 * Тонкая обёртка над Telegram Bot API. Без зависимостей — на глобальном fetch.
 */
import { config, isBotConfigured } from './config.js';

const BASE = () => `https://api.telegram.org/bot${config.botToken}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Вызов метода Bot API.
 * @throws {Error} если Telegram вернул ok: false или сеть недоступна
 */
export async function callApi(method, payload = {}, timeoutMs = 15000) {
  if (!isBotConfigured()) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан');
  }

  const response = await fetch(`${BASE()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = await response.json().catch(() => null);

  if (!data || !data.ok) {
    const reason = data?.description || `HTTP ${response.status}`;
    throw new Error(`Telegram API ${method}: ${reason}`);
  }

  return data.result;
}

export function sendMessage(chatId, text, extra = {}) {
  return callApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

/** Экранирование под parse_mode: HTML */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Long polling. Обрабатывает только сообщения — этого достаточно для /start.
 * @param {(message: object) => Promise<void>} onMessage
 * @returns {() => void} функция остановки
 */
export function startPolling(onMessage) {
  let running = true;
  let offset = 0;

  (async () => {
    // Снимаем возможный вебхук, иначе getUpdates вернёт ошибку 409
    try {
      await callApi('deleteWebhook', { drop_pending_updates: false });
    } catch (error) {
      console.warn('[bot] не удалось снять вебхук:', error.message);
    }

    while (running) {
      try {
        const updates = await callApi(
          'getUpdates',
          { offset, timeout: 30, allowed_updates: ['message'] },
          40000
        );

        for (const update of updates) {
          offset = update.update_id + 1;
          if (!update.message) continue;

          try {
            await onMessage(update.message);
          } catch (error) {
            console.error('[bot] ошибка обработки сообщения:', error.message);
          }
        }
      } catch (error) {
        if (!running) break;
        console.error('[bot] опрос прерван:', error.message);
        await sleep(5000);
      }
    }
  })();

  return () => { running = false; };
}
