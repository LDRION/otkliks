#!/usr/bin/env bash
# Пересборка и перезапуск Откликс на боевом сервере.
#
# Почему не docker compose, как в DEPLOY.md: на этой машине 3.8 ГБ памяти, из них
# свободно чуть больше гигабайта, и уже крутятся siberi-api, siberi-bot, leadbot,
# tgblog и hotwet. Демон Docker плюс отдельный контейнер MongoDB рядом с уже
# работающей на хосте MongoDB — лишний расход там, где его нечем оплатить.
# Поэтому нативно: pm2 + системная mongod, ровно как остальной парк на сервере.
#
# Node 22 лежит отдельно в /opt/node22 и НЕ является системным: системный Node 20
# обслуживает пять боевых сервисов, и обновлять его ради Откликс нельзя. Откликсу
# же 22-й обязателен — apps/marketing-site/lib/db.ts импортирует node:sqlite,
# встроенный модуль, которого в 20-м просто нет (см. engines в package.json).
set -euo pipefail

REPO=/var/www/hhpilot
NODE_BIN=/opt/node22/bin
SITE="$REPO/apps/marketing-site"
STANDALONE="$SITE/.next/standalone/apps/marketing-site"

export PATH="$NODE_BIN:$PATH"
cd "$REPO"

echo "▶ зависимости"
pnpm install --frozen-lockfile

echo "▶ сборка marketing-site"
pnpm --filter @hhpilot/marketing-site build

# Next кладёт в standalone только серверный бандл: статика, public и отдельные CLI
# в него не попадают — их переносят рядом руками. В Dockerfile это три COPY на
# runner-стадии, здесь то же самое.
echo "▶ раскладка standalone"
mkdir -p "$STANDALONE/.next/static"

# Старую статику НЕ сносим, а докладываем новую рядом. Имена файлов Next содержат
# хеш содержимого, и у открытых вкладок в уже отданном HTML зашиты ПРЕЖНИЕ имена:
# если снести старые файлы, такая вкладка получает 404 на свой css и остаётся голым
# HTML без стилей до перезагрузки. Ровно это и случилось 25.08.2026 при деплое.
cp -r "$SITE/.next/static/." "$STANDALONE/.next/static/"

# Чтобы каталог не рос бесконечно, убираем то, что старше недели: за это время все
# живые вкладки успевают обновиться.
find "$STANDALONE/.next/static" -type f -mtime +7 -delete 2>/dev/null || true
find "$STANDALONE/.next/static" -type d -empty -delete 2>/dev/null || true

# public и scripts заменяем целиком: там имена без хешей, старые версии не нужны.
rm -rf "$STANDALONE/public" "$STANDALONE/scripts"
cp -r "$SITE/public"       "$STANDALONE/public"
cp -r "$SITE/scripts"      "$STANDALONE/scripts"

# standalone-сервер читает .env из своей директории, а не из исходников. В compose
# эту роль играл env_file, здесь кладём файл рядом с server.js — иначе AUTH_SECRET
# не найдётся и сессии клиентов молча перестанут проверяться.
cp "$SITE/.env.local" "$STANDALONE/.env.local"
chmod 600 "$STANDALONE/.env.local"

# SQLite (админы сайта, счётчики просмотров, заявки на консультацию) НЕ должна жить
# внутри .next: lib/db.ts резолвит её как process.cwd()/data, а cwd сервера — это
# standalone-каталог, который `next build` сносит целиком. Проверено: файл-маркер в
# нём пересборку не переживает, база пересоздаётся пустой. В compose от этого спасал
# том marketing-data, здесь ту же роль играет симлинк на каталог вне дерева сборки.
mkdir -p "$REPO/data"
rm -rf "$STANDALONE/data"
ln -s "$REPO/data" "$STANDALONE/data"

# seed-owner.mts (единственный способ завести первого админа — публичной регистрации
# в /admin нет) в бандл не трейсится: это отдельный CLI, а не часть сайта. Его
# единственная зависимость — bcryptjs; node:sqlite встроен в Node.
if [ ! -d "$STANDALONE/node_modules/bcryptjs" ]; then
  echo "▶ bcryptjs для seed-owner"
  npm install bcryptjs --prefix "$STANDALONE" --no-save --silent
fi

echo "▶ перезапуск"
pm2 restart otkliks-api otkliks-site --update-env 2>/dev/null \
  || pm2 start "$REPO/ecosystem.config.js"
pm2 save --force >/dev/null

echo "✅ готово"
pm2 list | grep -E "otkliks|name" || true
