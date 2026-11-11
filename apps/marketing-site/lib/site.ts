export const SITE_URL = 'https://otkliks.ru';
export const SITE_NAME = 'Откликс';

// Длинный заголовок главной — под то, что реально ищут: «автоотклик hh.ru», «как найти
// работу», «не получается найти работу». Он виден в выдаче и первую секунду во вкладке,
// потом вкладка сворачивается до SITE_NAME (components/TabTitle.tsx).
export const HOME_TITLE =
  'Откликс — автоотклик на вакансии hh.ru с ИИ: как найти работу быстрее, если долго не получается';
export const HOME_DESCRIPTION =
  'Не можете найти работу? Откликс сам подбирает подходящие вакансии на hh.ru, пишет сопроводительное письмо под каждую и отвечает эйчарам в чате. До 200 откликов в день: бесплатно или от 99 ₽ в неделю — дешевле аналогов.';
// Для превью ссылки в мессенджерах и соцсетях — коротко и по делу, без длинного хвоста.
export const SOCIAL_TITLE = 'Откликс — ИИ откликается на вакансии hh.ru за вас';
export const SITE_DESCRIPTION =
  'Откликс — AI-автопилот отклика на hh.ru: находит подходящие вакансии, пишет персональное сопроводительное письмо под каждую и сам отвечает на скрининговые вопросы работодателей в чате от вашего имени. Решения, которые должны оставаться за вами — оффер, время созвона — сервис не принимает сам.';

export function buildBreadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}
