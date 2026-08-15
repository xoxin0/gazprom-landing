/**
 * Логика бота.
 *
 * Правило доступа: администратором становится первый пользователь,
 * написавший боту. Это место занимается один раз и навсегда —
 * все остальные получают отказ.
 */
import { config, isBotConfigured } from './config.js';
import { store } from './store.js';
import { escapeHtml, sendMessage, startPolling } from './telegram.js';

/* ---------- Тексты ---------- */

const TEXT = {
  claimed: (name) =>
    `✅ <b>Готово, ${escapeHtml(name)}.</b>\n\n` +
    'Вы — администратор бота. Заявки с сайта будут приходить в этот чат.\n\n' +
    'Место администратора занято и больше никому не передаётся.\n\n' +
    'Команды: /status — состояние, /help — справка.',

  alreadyAdmin: () => {
    const admin = store.getAdmin();
    return (
      '👋 Вы уже администратор этого бота.\n\n' +
      `Назначены: ${escapeHtml(formatDate(admin.claimedAt))}\n` +
      'Команды: /status — состояние, /help — справка.'
    );
  },

  denied:
    '⛔ <b>Доступ ограничен.</b>\n\n' +
    'Бот закреплён за администратором и не обслуживает других пользователей.',

  status: () => {
    const admin = store.getAdmin();
    return (
      '📊 <b>Состояние бота</b>\n\n' +
      `Администратор: ${escapeHtml(describeUser(admin))}\n` +
      `Назначен: ${escapeHtml(formatDate(admin.claimedAt))}\n` +
      `Всего заявок: ${store.totalLeads()}\n` +
      `В очереди: ${store.queueSize()}`
    );
  },

  help:
    'ℹ️ <b>Справка</b>\n\n' +
    'Бот принимает заявки с формы обратной связи на сайте и присылает их сюда.\n\n' +
    '/status — текущее состояние\n' +
    '/help — эта справка',

  unknown:
    'Команда не распознана. Доступно: /status, /help.',
};

/* ---------- Вспомогательное ---------- */

function formatDate(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeUser(user) {
  if (!user) return '—';
  const name = user.firstName || 'без имени';
  return user.username ? `${name} (@${user.username})` : `${name} (id ${user.id})`;
}

/** Заявка → сообщение в Telegram */
function renderLead(lead) {
  const lines = [
    `🔥 <b>Заявка №${lead.number}</b> — сайт «Газпром»`,
    '',
    `👤 <b>Имя:</b> ${escapeHtml(lead.name)}`,
    `📞 <b>Телефон:</b> ${escapeHtml(lead.phone)}`,
    `✉️ <b>E-mail:</b> ${escapeHtml(lead.email)}`,
    `🏷 <b>Тема:</b> ${escapeHtml(lead.topic)}`,
    '',
    '💬 <b>Сообщение:</b>',
    escapeHtml(lead.message),
    '',
    `🕒 ${escapeHtml(formatDate(lead.createdAt))}`,
  ];

  return lines.join('\n');
}

/* ---------- Доставка заявок ---------- */

/**
 * Отправляет заявку администратору.
 * Если администратора ещё нет или Telegram недоступен — кладёт в очередь.
 * @returns {Promise<{delivered: boolean, queued: boolean}>}
 */
export async function deliverLead(lead) {
  const admin = store.getAdmin();

  if (!isBotConfigured() || !admin) {
    store.enqueue(lead);
    console.warn(
      `[lead] заявка №${lead.number} в очереди ` +
      `(${!isBotConfigured() ? 'токен не задан' : 'администратор не назначен'})`
    );
    return { delivered: false, queued: true };
  }

  try {
    await sendMessage(admin.id, renderLead(lead));
    console.log(`[lead] заявка №${lead.number} доставлена администратору`);
    return { delivered: true, queued: false };
  } catch (error) {
    store.enqueue(lead);
    console.error(`[lead] не удалось доставить заявку №${lead.number}:`, error.message);
    return { delivered: false, queued: true };
  }
}

/** Отправляет всё, что накопилось до назначения администратора */
async function flushQueue(chatId) {
  const pending = store.drainQueue();
  if (!pending.length) return;

  await sendMessage(
    chatId,
    `📬 Заявок, пришедших до вашего назначения: <b>${pending.length}</b>`
  );

  for (const lead of pending) {
    try {
      await sendMessage(chatId, renderLead(lead));
    } catch (error) {
      console.error(`[lead] заявка №${lead.number} не доставлена:`, error.message);
      store.enqueue(lead);
    }
  }
}

/* ---------- Обработка сообщений ---------- */

async function handleMessage(message) {
  const from = message.from;
  if (!from || from.is_bot) return;

  const chatId = message.chat.id;
  const text = (message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();

  // Место администратора свободно — занимает тот, кто написал первым
  if (!store.hasAdmin()) {
    const claimed = store.claimAdmin({
      id: from.id,
      username: from.username,
      firstName: from.first_name,
    });

    if (claimed) {
      console.log(`[bot] администратор назначен: ${describeUser(store.getAdmin())}`);
      await sendMessage(chatId, TEXT.claimed(from.first_name || 'коллега'));
      await flushQueue(chatId);
      return;
    }
  }

  if (!store.isAdmin(from.id)) {
    await sendMessage(chatId, TEXT.denied);
    return;
  }

  switch (command) {
    case '/start':
      await sendMessage(chatId, TEXT.alreadyAdmin());
      break;
    case '/status':
      await sendMessage(chatId, TEXT.status());
      break;
    case '/help':
      await sendMessage(chatId, TEXT.help);
      break;
    default:
      await sendMessage(chatId, TEXT.unknown);
  }
}

/* ---------- Запуск ---------- */

export function startBot() {
  if (!isBotConfigured()) {
    console.warn(
      '[bot] TELEGRAM_BOT_TOKEN не задан — бот не запущен.\n' +
      '      Сайт работает, заявки сохраняются в очередь и уйдут ' +
      'администратору сразу после настройки токена.'
    );
    return null;
  }

  const stop = startPolling(handleMessage);

  console.log(
    store.hasAdmin()
      ? `[bot] запущен. Администратор: ${describeUser(store.getAdmin())}`
      : '[bot] запущен. Администратор не назначен — им станет первый написавший.'
  );

  // Если админ есть, а в очереди что-то лежит — доставим сразу
  if (store.hasAdmin() && store.queueSize() > 0) {
    flushQueue(store.getAdmin().id).catch((error) =>
      console.error('[bot] не удалось разобрать очередь:', error.message)
    );
  }

  return stop;
}
