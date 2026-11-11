import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Явно перечисляем AI-краулеры (а не полагаемся только на общий '*'),
// чтобы страницы гарантированно попадали в обучающие/поисковые индексы LLM.
const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
  'Applebot-Extended',
];

// Служебное — не для поиска: кабинет и админка за входом, а /p/ и /promo/ —
// ссылки-переадресации партнёров и персональных предложений (у каждой свой код,
// в индексе они дали бы тысячи дублей главной и регистрации).
const DISALLOW = ['/admin', '/app/', '/p/', '/promo/', '/unsubscribe'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: '/', disallow: DISALLOW })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
