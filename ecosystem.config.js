// pm2 для Откликс. Оба процесса идут под Node 22 из /opt/node22 — системный Node 20
// обслуживает siberi-api и остальной парк, трогать его нельзя, а marketing-site без
// 22-го не поднимется вовсе (node:sqlite в lib/db.ts).
const NODE22 = '/opt/node22/bin/node';

module.exports = {
  apps: [
    {
      name: 'otkliks-api',
      cwd: '/var/www/hhpilot/apps/core-api',
      script: 'src/index.js',
      interpreter: NODE22,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
    },
    {
      name: 'otkliks-site',
      // server.js лежит НЕ в корне standalone, а по пути монорепо — Next сохраняет
      // структуру workspace внутри бандла.
      cwd: '/var/www/hhpilot/apps/marketing-site/.next/standalone/apps/marketing-site',
      script: 'server.js',
      interpreter: NODE22,
      env: {
        NODE_ENV: 'production',
        // 3000 занят siberi-api, поэтому сайт слушает 3100. Наружу оба сервиса
        // смотрят только через nginx, так что номер порта — внутренняя деталь.
        PORT: '3100',
        HOSTNAME: '127.0.0.1',
      },
      max_memory_restart: '500M',
    },
  ],
};
