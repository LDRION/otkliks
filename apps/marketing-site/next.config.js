const withMDX = require('@next/mdx')();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Блог — MDX-файлы прямо в app/blog/<slug>/page.mdx (см. план: удобное создание
  // материала под SEO без headless CMS, пока нет реальных читателей).
  pageExtensions: ['ts', 'tsx', 'mdx'],
  // Самодостаточный минимальный сервер-бандл для Docker (см. Dockerfile) — не тащит
  // весь node_modules в образ.
  output: 'standalone',
  // Обложки статей блога уходят серверным действием, а у него по умолчанию лимит 1 МБ.
  // Редактор ужимает фото до 3 МБ (PostEditor.tsx) — с запасом на остальные поля формы.
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
  // Короткие ссылки для профилей в соцсетях: в описании канала видна вся строка,
  // а длинная utm-простыня выглядит как спам. Метки те же, что в админке «Рост».
  // Не постоянный редирект (307): браузер не запомнит его навсегда, и метки
  // можно поменять, не ломая ссылки, уже стоящие в профилях.
  async redirects() {
    const social = (source, utm) => ({
      source,
      destination: `/?utm_source=${utm}&utm_medium=social&utm_campaign=profile`,
      permanent: false,
    });
    // Яндекс Бизнес: поля ссылок там короткие и режут utm-хвост — отсюда /yb и /ys1–3
    // (истории: по слайду на ссылку, чтобы видеть, с какого приходят).
    const yb = (source, destination) => ({ source, destination, permanent: false });
    const ybq = 'utm_source=yandex_business&utm_medium=stories';
    return [
      social('/tg', 'telegram'), social('/vk', 'vk'), social('/yt', 'youtube'),
      yb('/yb', '/?utm_source=yandex_business&utm_medium=card'),
      yb('/ys1', `/?${ybq}&utm_content=slide1`),
      yb('/ys2', `/?${ybq}&utm_content=slide2#how`),
      yb('/ys3', `/app/register?${ybq}&utm_content=slide3`),
    ];
  },
};

module.exports = withMDX(nextConfig);
