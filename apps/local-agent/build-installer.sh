#!/usr/bin/env bash
# Сборка Windows-установщика лаунчера Откликс.
#
# Почему через staging, а не electron-builder прямо в рабочем дереве: local-agent
# зависит от workspace-пакета @hhpilot/automation-core, а pnpm подключает такие
# симлинком за пределы пакета (../../packages/automation-core). electron-builder
# такие ссылки не тянет принципиально — падает с «denied access to system or unsafe
# path». Поэтому собираем копию без единого симлинка: плоский node_modules, реальные
# файлы, ничего наружу.
#
# Chromium в установщик НЕ кладём: автоматизация hh.ru ходит в уже установленный у
# пользователя Edge через CDP (packages/automation-core/src/browser.js), playwright
# нужен только как клиент протокола. Отсюда PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD.
set -euo pipefail

APP=/var/www/hhpilot/apps/local-agent
CORE=/var/www/hhpilot/packages/automation-core
STAGE="$APP/.stage"
export PATH=/opt/node22/bin:$PATH
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

VERSION=$(node -p "require('$APP/package.json').version")
echo "▶ версия $VERSION"

rm -rf "$STAGE"
mkdir -p "$STAGE"

cp -r "$APP/src" "$STAGE/src"
cp -r "$APP/build" "$STAGE/build"
cp "$APP/electron-builder.yml" "$STAGE/electron-builder.yml"

# package.json для staging: те же имя и версия, но зависимость на automation-core
# убрана — пакет кладётся в node_modules физически, ниже.
node -e "
const fs = require('fs');
const src = require('$APP/package.json');
const core = require('$CORE/package.json');
fs.writeFileSync('$STAGE/package.json', JSON.stringify({
  // name задаёт имя папки установки по умолчанию (было 'local-agent' — внутреннее
  // и пользователю ничего не говорящее).
  name: 'otkliks',
  // productName ЛАТИНИЦЕЙ намеренно: из него получается имя exe, а кириллица в имени
  // исполняемого файла — известный триггер эвристик антивирусов (так маскируются
  // вредоносы). Человеку кириллическое имя показываем в ярлыках (nsis.shortcutName).
  productName: 'Otkliks',
  version: src.version,
  // Описание попадает в свойства файла и видно и пользователю, и антивирусу —
  // внутреннему жаргону там не место.
  description: 'Откликс — автопилот отклика на вакансии hh.ru',
  main: src.main,
  author: 'Otkliks (otkliks.ru)',
  homepage: 'https://otkliks.ru',
  license: 'UNLICENSED',
  private: true,
  // Зависимости самого лаунчера плюс зависимости automation-core: плоский
  // node_modules staging'а обслуживает оба. Workspace-ссылки выкидываем —
  // automation-core кладётся физически, ниже.
  dependencies: Object.fromEntries([
    ...Object.entries(src.dependencies || {}).filter(([, v]) => !String(v).startsWith('workspace:')),
    ...Object.entries(core.dependencies || {}),
    // Тарбол, а не каталог: file: на директорию npm ставит симлинком, а симлинки
    // electron-builder не тянет («denied access to system or unsafe path»).
    ['@hhpilot/automation-core', 'file:./automation-core.tgz'],
  ]),
}, null, 2));
"

echo '▶ упаковка automation-core'
(cd "$CORE" && npm pack --pack-destination "$STAGE" --silent >/dev/null)
mv "$STAGE"/hhpilot-automation-core-*.tgz "$STAGE/automation-core.tgz"

echo '▶ зависимости (плоско, без симлинков)'
(cd "$STAGE" && npm install --omit=dev --no-package-lock --no-audit --no-fund --silent)

echo '▶ проверка: симлинков наружу быть не должно'
if find "$STAGE" -type l | grep -q .; then
  echo '  найдены симлинки:'; find "$STAGE" -type l | head
else
  echo '  симлинков нет ✅'
fi

echo '▶ проверка: модули резолвятся'
(cd "$STAGE" && node -e "
  require.resolve('playwright');
  require.resolve('@hhpilot/automation-core');
  console.log('  playwright и automation-core на месте ✅');
")

echo '▶ electron-builder'
(cd "$STAGE" && "$APP/node_modules/.bin/electron-builder" --win --config electron-builder.yml)

# Проверка содержимого сборки. Первый собранный установщик выглядел исправным —
# 101 МБ, валидный NSIS — но внутри не было ни одного файла automation-core, то есть
# всей логики автоотклика: electron-builder обходит node_modules по объявленным
# зависимостям, а workspace-пакет туда не попадал. Снаружи такое не видно, поэтому
# проверяем состав явно и роняем сборку, если чего-то нет.
echo '▶ проверка состава сборки'
ASAR_LIB=$(find /var/www/hhpilot/node_modules/.pnpm -maxdepth 4 -type d -name asar -path '*@electron*' | head -1)
node -e "
  const asar = require('$ASAR_LIB');
  const files = asar.listPackage('$STAGE/dist/win-unpacked/resources/app.asar');
  const need = {
    'главный процесс':  files.some((f) => f === '/src/main/index.js'),
    'automation-core':  files.filter((f) => f.includes('automation-core/src')).length > 3,
    'playwright':       files.some((f) => f.includes('node_modules/playwright')),
    'проверка версий': files.some((f) => f.includes('main/updateCheck.js')),
  };
  let bad = false;
  for (const [name, ok] of Object.entries(need)) {
    console.log(\`  \${ok ? '✅' : '❌'} \${name}\`);
    if (!ok) bad = true;
  }
  if (bad) { console.error('  сборка неполная — публиковать нельзя'); process.exit(1); }
"

# ─── Упаковка: свой архив вместо того, что собрал electron-builder ──────────
# 1) Корень папки — только нужное человеку: Otkliks.exe, LICENSE.txt и рабочие
#    файлы Chromium. Лицензии Electron/Chromium удалять нельзя (их условия требуют
#    прикладывать тексты к программе) — переносим в подпапку licenses.
# 2) Два архива из одного и того же содержимого:
#    • otkliks.zip — для людей: внутри сразу папка Otkliks, распаковал — и готово;
#    • Otkliks-<версия>-win.zip — «плоский», для автообновления. Уже установленные
#      лаунчеры (до 1.0.0) качают Otkliks-portable.zip и ищут Otkliks.exe в КОРНЕ
#      архива — заверни мы файлы в папку, они бы навсегда перестали обновляться.
echo '▶ упаковка архивов'
UNPACKED="$STAGE/dist/win-unpacked"
mkdir -p "$UNPACKED/licenses"
mv -f "$UNPACKED/LICENSE.electron.txt" "$UNPACKED/LICENSES.chromium.html" "$UNPACKED/licenses/" 2>/dev/null || true
sed "s/__VERSION__/$VERSION/" "$APP/build/LICENSE.txt" > "$UNPACKED/LICENSE.txt"

SEVENZ=$(ls /root/.cache/electron-builder/7zip*/*/bin/7za 2>/dev/null | head -1)
[ -x "$SEVENZ" ] || { echo '  нет 7za (кеш electron-builder) — собрать архивы нечем'; exit 1; }
FLAT="$STAGE/dist/Otkliks-$VERSION-win.zip"
HUMAN="$STAGE/dist/otkliks.zip"
rm -f "$FLAT" "$HUMAN"
(cd "$UNPACKED" && "$SEVENZ" a -tzip -mx=7 "$FLAT" . >/dev/null)
# Для людей — та же папка, но под именем Otkliks. Переименовываем на время
# упаковки, а не копируем: 300+ МБ второй копии незачем.
mv "$UNPACKED" "$STAGE/dist/Otkliks"
(cd "$STAGE/dist" && "$SEVENZ" a -tzip -mx=7 "$HUMAN" Otkliks >/dev/null)
mv "$STAGE/dist/Otkliks" "$UNPACKED"

# Проверка: в людском архиве всё внутри папки Otkliks, в плоском exe — в корне.
node -e "
  const { execFileSync } = require('child_process');
  const list = (f) => execFileSync('$SEVENZ', ['l', '-slt', f]).toString().split('\n')
    .filter((l) => l.startsWith('Path = ')).map((l) => l.slice(7)).slice(1);
  const human = list('$HUMAN'), flat = list('$FLAT');
  const need = {
    'otkliks.zip: всё внутри папки Otkliks': human.every((p) => p === 'Otkliks' || p.startsWith('Otkliks/')),
    'otkliks.zip: Otkliks/Otkliks.exe':      human.includes('Otkliks/Otkliks.exe'),
    'otkliks.zip: LICENSE.txt и licenses/':   human.includes('Otkliks/LICENSE.txt') && human.includes('Otkliks/licenses/LICENSES.chromium.html'),
    'плоский архив: Otkliks.exe в корне':     flat.includes('Otkliks.exe'),
  };
  let bad = false;
  for (const [k, ok] of Object.entries(need)) { console.log('  ' + (ok ? '✅' : '❌') + ' ' + k); if (!ok) bad = true; }
  if (bad) process.exit(1);
"

mkdir -p "$APP/dist"
cp "$FLAT" "$HUMAN" "$APP/dist/" 2>/dev/null || true

# Старые архивы в dist не копим: каждый по ~142 МБ, за десяток версий это гигабайты
# на диске, а нужен только последний — релизы всё равно живут в releases/.
find "$APP/dist" -maxdepth 1 -type f -name 'Otkliks-*-win.zip' ! -name "*$VERSION*" -delete

# Публикация: nginx раздаёт /var/www/hhpilot/releases по адресу /download/ — оттуда
# качают люди и туда же ходит electron-updater за latest.yml. Otkliks-Setup.exe —
# постоянная ссылка на текущую версию, чтобы кабинет не переписывать на каждый релиз.
RELEASES=/var/www/hhpilot/releases
mkdir -p "$RELEASES"

# Архив — единственная поставка. Установщик собирать перестали: без подписи кода
# антивирусы убивали его на распаковке (см. комментарий в electron-builder.yml).
cp "$FLAT" "$RELEASES/"
ln -sfn "Otkliks-$VERSION-win.zip" "$RELEASES/Otkliks-portable.zip"
# Для людей: постоянная ссылка https://otkliks.ru/download/otkliks.zip
cp "$HUMAN" "$RELEASES/otkliks.zip"

# latest.yml пишем САМИ по факту собранного архива. electron-builder генерирует его
# только для NSIS-поставки, а мы собираем zip — раньше сюда копировался файл из
# apps/local-agent/dist, оставшийся с эпохи установщика: в releases месяцами лежал
# latest.yml версии 0.1.7, ссылавшийся на давно удалённый .exe. Лаунчер сверяется
# именно с этим файлом (main/updateCheck.js), так что протухший latest.yml = молчащее
# обновление у всех клиентов.
echo '▶ latest.yml'
node -e "
const fs = require('fs'), crypto = require('crypto');
const name = 'Otkliks-$VERSION-win.zip';
const buf = fs.readFileSync('$RELEASES/' + name);
const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
fs.writeFileSync('$RELEASES/latest.yml', [
  'version: $VERSION',
  'files:',
  '  - url: ' + name,
  '    sha512: ' + sha512,
  '    size: ' + buf.length,
  'path: ' + name,
  'sha512: ' + sha512,
  \"releaseDate: '\" + new Date().toISOString() + \"'\",
  '',
].join('\n'));
console.log('  version: $VERSION, ' + (buf.length / 1048576).toFixed(0) + ' МБ');
"

# Старые версии не копим: место на диске не бесконечное, а обновления идут по
# latest.yml, которому нужна только текущая.
find "$RELEASES" -maxdepth 1 -type f \( -name 'Otkliks-Setup-*.exe*' -o -name 'Otkliks-*-win.zip' \) \
  ! -name "*$VERSION*" -delete
rm -f "$RELEASES/Otkliks-Setup.exe"

echo
echo '✅ готово, опубликовано:'
ls -lh "$RELEASES/" | grep -vE '^total'
echo
echo "   https://otkliks.ru/download/otkliks.zip"
