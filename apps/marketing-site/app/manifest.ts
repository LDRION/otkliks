import type { MetadataRoute } from 'next';
import { SITE_NAME } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — AI-автопилот откликов на hh.ru`,
    short_name: SITE_NAME,
    description: 'AI-автопилот отклика на hh.ru: подбор вакансий, письма и переписка с работодателями за вас.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#212d4e',
    lang: 'ru',
    icons: [{ src: '/icon', sizes: '32x32', type: 'image/png' }],
  };
}
