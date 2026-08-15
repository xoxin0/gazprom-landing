/**
 * Хранилище состояния: администратор + очередь недоставленных заявок.
 * Один JSON-файл, запись атомарная (через временный файл).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = path.join(config.dataDir, 'state.json');

const EMPTY = {
  admin: null,   // { id, username, firstName, claimedAt }
  queue: [],     // заявки, пришедшие до назначения администратора
  leadCount: 0,  // сквозной номер заявки
};

function read() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY };
  }
}

let state = read();

/*
   Если администратор закреплён переменной окружения, он важнее файла:
   на хостингах с эфемерным диском файл состояния исчезает при деплое.
*/
if (config.adminId) {
  const known = state.admin && state.admin.id === config.adminId ? state.admin : null;

  state.admin = {
    id: config.adminId,
    username: known?.username ?? null,
    firstName: known?.firstName ?? null,
    claimedAt: known?.claimedAt ?? new Date().toISOString(),
    pinned: true,
  };
}

function write() {
  fs.mkdirSync(config.dataDir, { recursive: true });

  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

export const store = {
  getAdmin() {
    return state.admin;
  },

  hasAdmin() {
    return state.admin !== null;
  },

  isAdmin(userId) {
    return state.admin !== null && state.admin.id === userId;
  },

  /**
   * Первый обратившийся становится администратором.
   * Если администратор уже назначен — повторно занять место нельзя.
   * @returns {boolean} true, если место занято именно этим вызовом
   */
  claimAdmin({ id, username, firstName }) {
    if (state.admin !== null) return false;
    if (config.adminId) return false;

    state.admin = {
      id,
      username: username || null,
      firstName: firstName || null,
      claimedAt: new Date().toISOString(),
    };
    write();
    return true;
  },

  nextLeadNumber() {
    state.leadCount += 1;
    write();
    return state.leadCount;
  },

  totalLeads() {
    return state.leadCount;
  },

  /** Заявка пришла, а администратора ещё нет — придержим до его появления */
  enqueue(lead) {
    state.queue.push(lead);
    write();
    return state.queue.length;
  },

  queueSize() {
    return state.queue.length;
  },

  /** Забрать всё накопленное и очистить очередь */
  drainQueue() {
    const items = state.queue;
    state.queue = [];
    write();
    return items;
  },
};
