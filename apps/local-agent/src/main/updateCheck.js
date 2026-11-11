/**
 * updateCheck.js — проверка новой версии для архивной поставки.
 *
 * Установщик мы больше не собираем: без подписи кода антивирусы убивали его прямо
 * на распаковке, и он через раз не доходил до конца. Остался архив — он ставится
 * без борьбы, но вместе с установщиком ушло и автообновление: electron-updater на
 * Windows умеет обновлять только NSIS-поставку, архив ему не по зубам.
 *
 * Поэтому обновляемся честно и просто: сверяем свою версию с latest.yml, который
 * сборка публикует рядом с архивом, и если вышла новее — говорим об этом в ленте
 * лаунчера со ссылкой. Скачать и распаковать человек решает сам.
 */
const LATEST_URL = 'https://otkliks.ru/download/latest.yml';
// Ссылка для человека — архив с папкой Otkliks внутри (распаковал — и готово).
const DOWNLOAD_URL = 'https://otkliks.ru/download/otkliks.zip';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** «0.1.7» → [0,1,7]; сравнение по числам, а не по строкам (иначе 0.1.10 < 0.1.7). */
function parseVersion(v) {
  return String(v || '').trim().split('.').map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Версию берём из latest.yml простым разбором: тащить YAML-парсер ради одной строки незачем. */
function versionFromYaml(text) {
  const m = /^version:\s*(.+)$/m.exec(String(text || ''));
  return m ? m[1].trim() : null;
}

async function fetchLatestVersion() {
  const res = await fetch(LATEST_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`latest.yml → ${res.status}`);
  return versionFromYaml(await res.text());
}

/**
 * @param {object} deps
 * @param {string} deps.currentVersion   app.getVersion()
 * @param {(msg: string) => void} deps.notify  куда сказать про новую версию
 */
function startUpdateCheck({ currentVersion, notify }) {
  let told = null; // об одной и той же версии не напоминаем на каждой проверке

  async function check() {
    try {
      const latest = await fetchLatestVersion();
      if (!latest || !isNewer(latest, currentVersion)) return;
      if (told === latest) return;
      told = latest;
      notify(`Вышла версия ${latest} — у вас ${currentVersion}. Скачать: ${DOWNLOAD_URL}`);
    } catch {
      // Молчим: интернет мог моргнуть, а пугать человека из-за неудачной проверки
      // обновлений нечем — на его работу это никак не влияет.
    }
  }

  check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}

module.exports = { startUpdateCheck, isNewer, versionFromYaml, DOWNLOAD_URL };
