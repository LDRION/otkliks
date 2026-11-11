#!/usr/bin/env bash
# IndexNow: сообщаем Яндексу и Bing (а через Bing — ChatGPT/Copilot) обо всех
# страницах из sitemap, не дожидаясь их робота. Запускается в конце деплоя и
# вручную после публикации статьи. Ошибка здесь деплой не валит.
set -u
APP="$(cd "$(dirname "$0")/.." && pwd)"
KEY=$(grep -E '^INDEXNOW_KEY=' "$APP/.env.local" 2>/dev/null | cut -d= -f2)
[ -z "${KEY:-}" ] && { echo "  IndexNow: ключа нет — пропускаем"; exit 0; }
URLS=$(curl -s https://otkliks.ru/sitemap.xml | grep -o '<loc>[^<]*</loc>' | sed 's#</\?loc>##g')
[ -z "$URLS" ] && { echo "  IndexNow: sitemap пуст — пропускаем"; exit 0; }
JSON=$(printf '%s\n' "$URLS" | python3 -c 'import sys,json; u=[l.strip() for l in sys.stdin if l.strip()]; print(json.dumps({"host":"otkliks.ru","key":sys.argv[1],"keyLocation":f"https://otkliks.ru/{sys.argv[1]}.txt","urlList":u}))' "$KEY")
for EP in https://yandex.com/indexnow https://api.indexnow.org/indexnow; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$EP" -H 'Content-Type: application/json; charset=utf-8' -d "$JSON")
  echo "  IndexNow $EP → $code ($(printf '%s\n' "$URLS" | wc -l) стр.)"
done
