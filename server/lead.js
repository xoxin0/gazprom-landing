/**
 * Проверка и нормализация заявки на стороне сервера.
 * Клиентская валидация — удобство, серверная — единственная, которой можно верить.
 */

const TOPICS = new Set([
  'Подключение к сети',
  'Тарифы и договор',
  'Сервисное обслуживание',
  'Другое',
]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-zA-Zа-яА-Я]{2,}$/;

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const clamp = (value, max) => (value.length > max ? value.slice(0, max) : value);

/**
 * @returns {{ ok: true, lead: object } | { ok: false, error: string }}
 */
export function validateLead(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Некорректные данные' };
  }

  // Honeypot: поле скрыто от человека, заполнить его может только бот
  if (asText(input.company)) {
    return { ok: false, error: 'spam' };
  }

  const name = clamp(asText(input.name), 80);
  if (name.length < 2) {
    return { ok: false, error: 'Укажите имя' };
  }

  const phone = clamp(asText(input.phone), 32);
  if (phone.replace(/\D/g, '').length < 11) {
    return { ok: false, error: 'Некорректный номер телефона' };
  }

  const email = clamp(asText(input.email), 120);
  if (!EMAIL.test(email)) {
    return { ok: false, error: 'Некорректный адрес электронной почты' };
  }

  const message = clamp(asText(input.message), 2000);
  if (message.length < 10) {
    return { ok: false, error: 'Слишком короткое сообщение' };
  }

  const rawTopic = asText(input.topic);
  const topic = TOPICS.has(rawTopic) ? rawTopic : 'Другое';

  return {
    ok: true,
    lead: {
      name,
      phone,
      email,
      topic,
      message,
      createdAt: new Date().toISOString(),
    },
  };
}
