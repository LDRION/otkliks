#!/usr/bin/env bash
# Полный деплой marketing-site (Next standalone под pm2).
#
# Почему скрипт: `next build` пересоздаёт .next/standalone С НУЛЯ, и туда НЕ попадают
# ни .next/static, ни public, ни .env.local, ни симлинк data. Если забыть хоть один
# шаг — сайт частично ломается (однажды пропал .env.local → AUTH_SECRET, и перестал
# работать вход). Этот скрипт делает всё разом и в правильном порядке.
set -euo pipefail

APP=/var/www/hhpilot/apps/marketing-site
SA="$APP/.next/standalone/apps/marketing-site"
DATA=/var/www/hhpilot/data          # стабильный каталог БД, переживает пересборку
export PATH=/opt/node22/bin:$PATH    # node 22 обязателен: node:sqlite

cd "$APP"

echo "▶ сборка (node $(node -v))"
node node_modules/next/dist/bin/next build

echo "▶ раскладываем standalone"
# rm -rf перед копированием обязателен: `cp -r src dst`, когда dst УЖЕ существует, кладёт
# копию ВНУТРЬ (dst/src), а не поверх. Next кладёт в standalone часть public сам (например,
# каталог, который читает серверный компонент через fs) — и тогда весь public уезжал в
# public/public: сайт отдавал 404 на новые картинки, хотя файлы «вроде бы скопированы».
rm -rf "$SA/.next/static" "$SA/public"
cp -r "$APP/.next/static" "$SA/.next/static"
cp -r "$APP/public" "$SA/public"
# .env.local в standalone Next не кладёт — копируем сами (в нём AUTH_SECRET, CORE_API_URL и пр.)
[ -f "$APP/.env.local" ] && cp "$APP/.env.local" "$SA/.env.local"
# data — симлинк на стабильный каталог (сборка заменяет его пустой папкой)
rm -rf "$SA/data"
ln -sfn "$DATA" "$SA/data"

echo "▶ перезапуск"
pm2 restart otkliks-site --update-env >/dev/null

sleep 3
echo "▶ проверка"
for p in / /blog /app/login; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' -H 'Host: otkliks.ru' "https://127.0.0.1$p" || echo '000')
  echo "  $p → $code"
done
echo "▶ IndexNow"
bash "$APP/scripts/indexnow.sh" || true
echo "✅ деплой завершён"
