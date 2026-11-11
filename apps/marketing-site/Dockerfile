# Собирается из корня монорепо (см. docker-compose.yml: context: ., dockerfile: apps/
# marketing-site/Dockerfile) — Next.js standalone-трейсинг следует импортам за пределы
# apps/marketing-site (workspace-протокол pnpm), поэтому одному apps/marketing-site как
# контексту сборки взяться неоткуда.
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS builder
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @hhpilot/marketing-site build

# ── runner: только standalone-бандл (next.config.js: output: 'standalone') — без
# исходников и devDependencies. Next кладёт standalone-дерево по пути монорепо, поэтому
# server.js лежит в apps/marketing-site/, а не в корне образа. ──────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo/apps/marketing-site/.next/standalone ./
COPY --from=builder /repo/apps/marketing-site/.next/static ./apps/marketing-site/.next/static
COPY --from=builder /repo/apps/marketing-site/public ./apps/marketing-site/public

# scripts/seed-owner.mts — единственный способ создать первый owner-аккаунт админки
# (публичной регистрации в /admin нет). Next не трейсит его в standalone-бандл (это
# отдельный CLI, а не часть самого сайта) — копируем и ставим его единственную
# зависимость (bcryptjs) отдельно; node:sqlite встроен в Node, доустанавливать не нужно.
COPY --from=builder /repo/apps/marketing-site/scripts ./apps/marketing-site/scripts
RUN npm install bcryptjs --prefix ./apps/marketing-site --no-save

EXPOSE 3000
CMD ["node", "apps/marketing-site/server.js"]
