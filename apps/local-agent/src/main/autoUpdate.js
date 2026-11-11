/**
 * autoUpdate.js — фоновое обновление лаунчера без ручного перекачивания.
 *
 * Почему не electron-updater: поставка — zip, а не NSIS-установщик (установщик убивали
 * антивирусы, см. electron-builder.yml). electron-updater на Windows умеет обновлять
 * только NSIS, zip ему не по зубам. Поэтому обновляемся своим механизмом:
 *
 *   1. Сверяем свою версию с latest.yml рядом с архивом.
 *   2. Если вышла новее — качаем zip в фон, с прогрессом в интерфейс.
 *   3. Сверяем sha512 из latest.yml: подменять файлы битым архивом нельзя.
 *   4. Когда человек нажмёт «Обновить» — распаковываем и подменяем файлы в папке
 *      установки через вспомогательный скрипт, затем перезапускаемся.
 *
 * Подмена именно через скрипт, а не из самого приложения: пока Otkliks.exe запущен,
 * его файлы залочены Windows. Скрипт ждёт выхода процесса, потом меняет файлы и
 * запускает новую версию. Всё аккуратно: если распаковка не удалась, старая версия
 * остаётся на месте и просто стартует заново — забриковать установку нельзя.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');

const LATEST_URL = 'https://otkliks.ru/download/latest.yml';
// Плоский архив (Otkliks.exe в корне) — именно его хеш публикует latest.yml. Людям
// на сайте отдаётся otkliks.zip с папкой Otkliks внутри; подменщик ниже понимает оба.
const DOWNLOAD_URL = 'https://otkliks.ru/download/Otkliks-portable.zip';
// Загрузка, по которой минуту не пришло ни байта, считается зависшей. Раньше у fetch
// не было никакого таймаута: при автозапуске сеть часто ещё нестабильна, загрузка
// замирала навсегда — и окно лаунчера висело с «Скачиваем обновление…».
const STALL_MS = 60 * 1000;
const DOWNLOAD_MAX_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;

function parseVersion(v) {
  return String(v || '').trim().split('.').map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Разбираем latest.yml без YAML-парсера — нам нужны три поля. */
function parseLatest(text) {
  const s = String(text || '');
  const version = /^version:\s*(.+)$/m.exec(s)?.[1]?.trim() || null;
  // sha512 в latest.yml идёт и в блоке files, и на верхнем уровне — берём последний
  // (верхнеуровневый относится ко всему архиву).
  const sha = [...s.matchAll(/^sha512:\s*(.+)$/gm)].map((m) => m[1].trim()).pop() || null;
  const size = Number(/^\s*size:\s*(\d+)$/m.exec(s)?.[1]) || null;
  return { version, sha512: sha, size };
}

async function fetchLatest() {
  const res = await fetch(LATEST_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`latest.yml → ${res.status}`);
  return parseLatest(await res.text());
}

/** base64-sha512 файла — в том же виде, что публикует сборка. */
function sha512File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject);
  });
}

/** Удалить, не падая: файл может держать антивирус или скрипт подмены. */
function tryRemove(file) {
  try { fs.rmSync(file, { force: true }); return true; } catch { return false; }
}

/** sha512 с парой повторов: антивирус держит свежий архив, пока проверяет его. */
async function sha512Retry(file, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try { return await sha512File(file); } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/**
 * Скачивает архив, сообщая прогресс. Возвращает путь к проверенному файлу.
 *
 * Живой случай 29.09.2026: «EBUSY: resource busy or locked, open …\Otkliks-1.0.6.zip»
 * модальным окном Electron у первого же пользователя. Архив всегда писался в файл с
 * одним и тем же именем, а его держал кто-то ещё — антивирус, проверяющий 130 МБ,
 * скрипт подмены от прошлого запуска или вторая копия лаунчера. Хуже того, ошибку
 * открытия поток записи отдаёт событием, а обработчика не было — и она улетала мимо
 * try/catch как «Uncaught Exception». Теперь: каждая загрузка — в свой файл, поток
 * через pipeline (ошибка любого звена — обычный reject), уже скачанный и проверенный
 * архив этой версии используем повторно, а не качаем заново.
 * @param {(pct:number)=>void} onProgress 0..100
 */
async function download(destDir, expected, onProgress, url = DOWNLOAD_URL, stallMs = STALL_MS) {
  fs.mkdirSync(destDir, { recursive: true });
  const ver = expected.version || 'new';
  const mine = (name) => name === `Otkliks-${ver}.zip` || (name.startsWith(`Otkliks-${ver}-`) && name.endsWith('.zip'));

  let names = [];
  try { names = fs.readdirSync(destDir); } catch { names = []; }
  // Архивы других версий — мусор прошлых обновлений.
  for (const name of names) if (!mine(name)) tryRemove(path.join(destDir, name));

  // Эта версия уже скачана и проверена прошлым запуском — не тянем 130 МБ заново.
  if (expected.sha512) {
    for (const name of names.filter(mine)) {
      const f = path.join(destDir, name);
      try {
        if ((await sha512File(f)) === expected.sha512) { onProgress?.(100); return f; }
      } catch { /* занят или битый — ниже скачаем в новый файл */ }
      tryRemove(f);
    }
  }

  const file = path.join(destDir, `Otkliks-${ver}-${Date.now()}.zip`);
  // Сторож: нет новых байтов дольше STALL_MS (или загрузка идёт дольше получаса) —
  // обрываем; следующая плановая проверка начнёт заново.
  const ctrl = new AbortController();
  let stalled = false;
  let idle = setTimeout(() => { stalled = true; ctrl.abort(); }, stallMs);
  const cap = setTimeout(() => { stalled = true; ctrl.abort(); }, DOWNLOAD_MAX_MS);
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => { stalled = true; ctrl.abort(); }, stallMs); };

  let total = expected.size || 0;
  let received = 0;
  const progress = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      touch();
      if (total) onProgress?.(Math.min(99, Math.round((received / total) * 100)));
      cb(null, chunk);
    },
  });

  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`архив → ${res.status}`);
    if (!total) total = Number(res.headers.get('content-length')) || 0;
    touch();
    await pipeline(Readable.fromWeb(res.body), progress, fs.createWriteStream(file), { signal: ctrl.signal });
  } catch (e) {
    tryRemove(file);
    throw stalled ? new Error('загрузка обновления зависла — попробуем позже') : e;
  } finally {
    clearTimeout(idle);
    clearTimeout(cap);
  }

  // Битым архивом ничего не подменяем.
  if (expected.sha512) {
    const actual = await sha512Retry(file);
    if (actual !== expected.sha512) {
      tryRemove(file);
      throw new Error('контрольная сумма архива не совпала');
    }
  }
  onProgress?.(100);
  return file;
}

/**
 * Готовит подмену: пишет скрипт, который после выхода приложения распакует архив
 * поверх папки установки и запустит новую версию. Возвращает функцию запуска.
 */
function buildApplier({ zipPath, installDir, exeName }) {
  const stageDir = path.join(os.tmpdir(), `otkliks-update-${Date.now()}`);

  if (process.platform === 'win32') {
    const pid = process.pid;
    const cmdPath = path.join(os.tmpdir(), `otkliks-update-${Date.now()}.cmd`);
    const exe = path.join(installDir, exeName);
    // Ждём выхода нашего процесса (файлы залочены, пока он жив), распаковываем во
    // временную папку, проверяем, что новый exe на месте, копируем поверх установки
    // (robocopy с ретраями на залоченные файлы) и запускаем. Если распаковка пустая —
    // просто перезапускаем старую версию, ничего не сломав.
    const script = [
      '@echo off',
      'chcp 65001 >nul',
      // Ждём выхода нашего процесса, но НЕ вечно: если он почему-то не умер (раньше
      // из-за этого чёрное окно «find <pid>» висело бесконечно), через ~60 секунд
      // всё равно пробуем подменить — robocopy сам ретраит залоченные файлы.
      'set /a _n=0',
      ':waitloop',
      `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul`,
      'if errorlevel 1 goto swap',
      'set /a _n+=1',
      'if %_n% geq 60 goto swap',
      'timeout /t 1 /nobreak >nul',
      'goto waitloop',
      ':swap',
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${stageDir}' -Force"`,
      // Архив может быть и «плоским», и с папкой Otkliks внутри (как otkliks.zip для
      // людей) — берём ту папку, где реально лежит exe.
      `set "SRC=${stageDir}"`,
      `if not exist "%SRC%\\${exeName}" if exist "%SRC%\\Otkliks\\${exeName}" set "SRC=%SRC%\\Otkliks"`,
      `if not exist "%SRC%\\${exeName}" ( start "" "${exe}" & goto cleanup )`,
      'robocopy "%SRC%" "' + installDir + '" /E /R:8 /W:2 >nul',
      // С 1.0.0 лицензии Electron/Chromium лежат в подпапке licenses — старые копии
      // из корня папки установки убираем, чтобы там было только нужное.
      `if exist "${path.join(installDir, 'licenses', 'LICENSES.chromium.html')}" del /F /Q "${path.join(installDir, 'LICENSE.electron.txt')}" "${path.join(installDir, 'LICENSES.chromium.html')}" >nul 2>&1`,
      `start "" "${exe}"`,
      ':cleanup',
      `rmdir /S /Q "${stageDir}" >nul 2>&1`,
      `del /F /Q "${zipPath}" >nul 2>&1`,
      `del /F /Q "%~f0" >nul 2>&1`,
      '',
    ].join('\r\n');
    fs.writeFileSync(cmdPath, script, 'utf8');

    // Запускаем скрипт подмены ПОЛНОСТЬЮ СКРЫТО. detached-spawn cmd.exe на Windows всё
    // равно открывает чёрное окно консоли (CREATE_NEW_CONSOLE перебивает windowsHide) —
    // именно его человек и увидел вместо обновлённого лаунчера. Классический бесшумный
    // способ — прокинуть через wscript: Run(cmd, 0, False), где 0 = окно скрыто, а
    // процесс переживает наш выход. VBS сам себя удаляет после запуска.
    const vbsPath = path.join(os.tmpdir(), `otkliks-update-${Date.now()}.vbs`);
    fs.writeFileSync(vbsPath,
      'Set s = CreateObject("WScript.Shell")\r\n'
      + `s.Run "cmd /c ""${cmdPath}""", 0, False\r\n`
      + 'CreateObject("Scripting.FileSystemObject").DeleteFile WScript.ScriptFullName\r\n',
      'utf8');

    return () => {
      spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    };
  }

  // macOS/Linux — на них лаунчер официально не поставляется, но не оставляем заглушку
  // без поведения: распаковываем и перезапускаем через shell.
  const shPath = path.join(os.tmpdir(), `otkliks-update-${Date.now()}.sh`);
  const script = [
    '#!/usr/bin/env bash',
    `while kill -0 ${process.pid} 2>/dev/null; do sleep 1; done`,
    `mkdir -p "${stageDir}" && (command -v unzip >/dev/null && unzip -o "${zipPath}" -d "${stageDir}" || exit 0)`,
    `SRC="${stageDir}"; [ -e "$SRC/${exeName}" ] || { [ -e "$SRC/Otkliks/${exeName}" ] && SRC="$SRC/Otkliks"; }`,
    `cp -a "$SRC/." "${installDir}/"`,
    `"${path.join(installDir, exeName)}" &`,
    `rm -rf "${stageDir}" "${zipPath}" "$0"`,
    '',
  ].join('\n');
  fs.writeFileSync(shPath, script, { mode: 0o755 });
  return () => spawn('bash', [shPath], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * Управление обновлением для main-процесса.
 *
 * @param {object} deps
 * @param {string} deps.currentVersion  app.getVersion()
 * @param {string} deps.installDir      папка с Otkliks.exe (path.dirname(process.execPath))
 * @param {string} deps.exeName         имя исполняемого файла
 * @param {(e:object)=>void} deps.onEvent  события в интерфейс
 * @param {()=>void} deps.quitAndRelaunch  что сделать перед подменой (обычно app.quit)
 */
function createUpdater({
  currentVersion, installDir, exeName, onEvent, quitAndRelaunch, log,
  // Ставить обновление САМО, без нажатия — в этом весь смысл лаунчера: «запустил =
  // обновился». Возвращает true, когда можно перезапуститься прямо сейчас (обычно:
  // автопилот ещё не запущен, т.е. мы в стартовом окне и ничью работу не прервём).
  // Если сейчас нельзя (идёт автоотклик) — оставляем скачанным, применится при
  // следующем запуске.
  shouldAutoApply = () => false,
}) {
  let state = { phase: 'idle', version: null, progress: 0 };
  let applier = null;
  let inFlight = null;

  const emit = () => onEvent?.({ type: 'update', ...state });

  // Одна проверка за раз: плановая (раз в 3 часа) и ручная не должны качать
  // один и тот же архив параллельно.
  function check(opts = {}) {
    if (!inFlight) inFlight = runCheck(opts).finally(() => { inFlight = null; });
    return inFlight;
  }

  async function runCheck({ auto = true } = {}) {
    try {
      const latest = await fetchLatest();
      if (!latest.version || !isNewer(latest.version, currentVersion)) {
        if (!auto) { state = { phase: 'uptodate', version: currentVersion, progress: 0 }; emit(); }
        return;
      }

      // Уже скачано и ждёт момента (автопилот работал) — не качаем заново каждые
      // 3 часа, только пробуем поставить, если теперь можно.
      if (state.phase === 'ready' && state.version === latest.version && applier) {
        if (shouldAutoApply()) {
          log?.(`Устанавливаю обновление ${latest.version} автоматически…`);
          apply();
        }
        return;
      }

      state = { phase: 'downloading', version: latest.version, progress: 0 };
      emit();

      const destDir = path.join(os.tmpdir(), 'otkliks-updates');
      const zipPath = await download(destDir, latest, (pct) => {
        state.progress = pct;
        emit();
      });

      applier = buildApplier({ zipPath, installDir, exeName });
      state = { phase: 'ready', version: latest.version, progress: 100 };
      emit();
      log?.(`Обновление ${latest.version} загружено.`);

      // Само-применение: если момент безопасный (автопилот не работает) — ставим и
      // перезапускаемся сразу, человек ничего не делает. Если сейчас нельзя — молча
      // оставляем на следующий запуск.
      if (shouldAutoApply()) {
        log?.(`Устанавливаю обновление ${latest.version} автоматически…`);
        apply();
      }
    } catch (e) {
      // Обновление не критично: в фоне молчим, но окно об ошибке узнать ДОЛЖНО — иначе
      // плашка «Скачиваем…» оставалась висеть навсегда (интерфейс прячет её на error).
      state = { phase: 'error', version: state.version, progress: 0, message: e.message, auto };
      emit();
      log?.(`Проверка обновления не удалась: ${e.message}`);
    }
  }

  function apply() {
    if (state.phase !== 'ready' || !applier) return false;
    log?.('Устанавливаю обновление и перезапускаюсь…');
    applier();               // скрипт ждёт нашего выхода
    quitAndRelaunch?.();     // выходим, чтобы освободить файлы
    return true;
  }

  function getState() { return state; }

  function start() {
    check({ auto: true });
    return setInterval(() => check({ auto: true }), CHECK_INTERVAL_MS);
  }

  return { start, check, apply, getState };
}

module.exports = {
  createUpdater, parseLatest, isNewer, sha512File, buildApplier, parseVersion, download, DOWNLOAD_URL, STALL_MS,
};
