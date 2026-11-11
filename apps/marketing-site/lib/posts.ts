// Реестр постов блога — вручную, пока их немного (см. план: без headless CMS, пока
// нет реальных читателей). Используется и для листинга /blog, и для sitemap.ts, и
// для Article JSON-LD на странице поста.
export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  tag: string;
  publishedAt: string; // ISO-дата
  updatedAt: string;
};

export const posts: BlogPost[] = [
  {
    slug: 'pochemu-na-hh-ru-otvechaet-bot',
    title: 'Почему на hh.ru всё чаще отвечает бот, а не HR',
    description:
      'Разбираем, как устроен автоматический скрининг откликов на hh.ru изнутри — на реальных примерах из переписок — и что это значит для соискателя.',
    tag: 'HR-скрининг',
    publishedAt: '2026-08-17',
    updatedAt: '2026-08-17',
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}
