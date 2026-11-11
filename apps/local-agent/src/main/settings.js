/**
 * settings.js — локально сохранённые данные лаунчера (deviceToken, кэш профиля тенанта,
 * состояние hh.ru-логина). Простой JSON-файл в userData — этого достаточно для одного
 * локального пользователя на установку; secrets (deviceToken) шифровать не стали, т.к.
 * он и так живёт только на диске пользователя (тот же уровень доверия, что and сам ПК).
 */

const path = require('node:path');
const fs = require('node:fs');

function createSettings(userDataDir) {
  const file = path.join(userDataDir, 'settings.json');

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  }

  function write(data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  function get(key) {
    return read()[key];
  }

  function set(key, value) {
    const data = read();
    data[key] = value;
    write(data);
  }

  // Выход из аккаунта стирает всё, кроме настроек самого компьютера: автозапуск
  // прописан в автозагрузке Windows и должен пережить смену пользователя.
  const DEVICE_KEYS = ['autoLaunch'];
  function clear() {
    const data = read();
    const kept = {};
    for (const k of DEVICE_KEYS) if (k in data) kept[k] = data[k];
    write(kept);
  }

  return { get, set, clear };
}

module.exports = { createSettings };
