# Деплой

Три контейнера — `mongo`, `core-api`, `marketing-site` — через `docker-compose.yml` в корне.
`local-agent` сюда не входит: это десктоп-инсталлятор для клиентов, не серверный компонент.

## 1. Переменные окружения

Скопируй и заполни на сервере (те же файлы, что и в dev, `.env` уже в `.gitignore`):

- `apps/core-api/.env` — из `apps/core-api/.env.example`
- `apps/marketing-site/.env.local` — из `apps/marketing-site/.env.example`

Обязательно:

- `AUTH_SECRET` — **одинаковый** в обоих файлах (marketing-site верифицирует токены,
  подписанные core-api, без общего секрета сессии клиентов не проверятся).
- `SITE_URL` в `core-api/.env` — публичный адрес сайта (ссылки в письмах).
- `YOOMONEY_WALLET` / `YOOMONEY_WEBHOOK_SECRET` — сейчас общий кошелёк с Siberi (см.
  комментарий в `apps/core-api/.env` и `forwardToOtkliks` в `siberiai-v5/server/routes/
  payment.js`). Как только у `core-api` появится публичный адрес — прописать его в
  `OTKLIKS_CORE_API_URL` на проде Siberi, иначе вебхукам об оплате Откликс некуда прийти.
- `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` — свой ящик на домене сайта. **Не**
  переиспользовать SMTP Siberi (`noreply@siberi.online`) — чужой домен отправителя на
  письмах другого продукта.
- `MONGODB_URI` и `CORE_API_URL` в этих файлах — dev-значения (`127.0.0.1`/`localhost`);
  `docker-compose.yml` сам подставляет правильные адреса контейнеров (`mongo`, `core-api`),
  трогать не нужно.

## 2. Запуск

```
docker compose up -d --build
```

`marketing-site` слушает `:3000`, `core-api` — `:4000`. Оба билда собраны и не
проверялись реальным `docker build` в этой среде (демон Docker тут не поднят) — первый
прогон стоит сделать руками и посмотреть на логи.

## 3. Реверс-прокси и HTTPS

Ни один из контейнеров не отдаёт HTTPS сам — нужен nginx/Caddy перед ними:

- `otkliks.ru` → `marketing-site:3000`
- `api.otkliks.ru` (или путь `/api` на том же домене) → `core-api:4000`, публично
  доступен — сюда стучится и браузер клиента, и форвард вебхука с сервера Siberi.

## 4. Данные

- `mongo-data` — тенанты, вакансии, переговоры, статистика.
- `marketing-data` — SQLite (админы сайта, счётчики просмотров, заявки на консультацию).

Бэкапить оба тома. `mongo-data` — через `mongodump` по расписанию; `marketing-data` —
обычный файловый бэкап (это один файл `otkliks.sqlite3`).

## 5. Первый owner-аккаунт админки

Публичной регистрации в `/admin` нет специально. Один раз на сервере:

```
docker compose exec -w /app/apps/marketing-site \
  -e SEED_OWNER_EMAIL=you@example.com -e SEED_OWNER_PASSWORD=... \
  marketing-site node scripts/seed-owner.mts
```

(`-w` matters: the running server's `server.js` chdir's into `apps/marketing-site` itself at
startup, so that's where its SQLite file actually lives — running the seed script from the
container's default `/app` writes into a different, unused file. See `docker-compose.yml`'s
comment on the `marketing-data` volume.)

## Известные ограничения на момент написания

- Нет настоящего автопродления подписки (ЮMoney p2p-кошелёк не умеет рекуррентные
  списания) — есть только email-напоминание за 48 часов до конца периода.
- Нет CI/автосборки образов — `docker compose up --build` собирает на самом сервере.
- `core-api` слушает как один процесс без кластеризации — для первых клиентов
  достаточно, для масштабирования потребуется PM2/несколько реплик за балансировщиком.
