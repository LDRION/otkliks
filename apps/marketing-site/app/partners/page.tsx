import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_URL, SITE_NAME, buildBreadcrumbJsonLd } from '@/lib/site';

// Условия партнёрской программы. Цифры — те же, что в core-api/src/lib/affiliate.js
// (AFFILIATE_RATE, AFFILIATE_HOLD_DAYS, AFFILIATE_MIN_PAYOUT). Меняются там —
// правим и здесь.

const TITLE = 'Партнёрская программа Откликс — 30% с каждой оплаты';
const DESCRIPTION =
  'Рекомендуйте Откликс и получайте 30% с каждой оплаты приглашённых — навсегда. Условия, сроки удержания и порядок выплат.';
const PATH = '/partners';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: { type: 'website', locale: 'ru_RU', siteName: SITE_NAME, url: `${SITE_URL}${PATH}`, title: TITLE, description: DESCRIPTION },
};

const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: 'Главная', path: '/' },
  { name: 'Партнёрская программа', path: PATH },
]);

export default function PartnersTermsPage() {
  return (
    <main>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <section className="section legal-page">
        <div className="container legal-container">
          <span className="eyebrow">Партнёрам</span>
          <h1 className="legal-title">30% с каждой оплаты тех, кого вы приведёте</h1>
          <p className="legal-meta">Навсегда, а не только с первой оплаты.</p>

          <div className="post-prose legal-prose">
            <p className="legal-lead">
              Вы делитесь своей ссылкой, человек регистрируется по ней и закрепляется за вами
              навсегда. С каждой его оплаты вы получаете 30% — пока он пользуется сервисом.
              Стать партнёром можно в <Link href="/app/partners">личном кабинете</Link>.
            </p>

            <h2>1. Как это работает</h2>
            <ul>
              <li>В кабинете вы получаете личную постоянную ссылку вида <code>otkliks.ru/p/ВАШКОД</code> — её достаточно скопировать и делиться.</li>
              <li>Переход по ссылке запоминается на 60 дней: если человек зарегистрируется в этот срок, он закрепляется за вами.</li>
              <li>Закрепление бессрочное: другой партнёр перехватить человека уже не может.</li>
              <li>Если человек переходил по ссылкам разных партнёров, засчитывается последняя ссылка перед регистрацией.</li>
            </ul>

            <h2>2. Вознаграждение</h2>
            <ul>
              <li>30% от суммы каждой оплаты приглашённого — фактически заплаченной им, с учётом скидок.</li>
              <li>Комиссия начисляется автоматически и 14 дней находится на удержании: в этот срок оплату могут вернуть по условиям <Link href="/oferta">оферты</Link>. После удержания она становится доступной к выводу.</li>
              <li>Если оплата возвращена, комиссия за неё отменяется.</li>
            </ul>

            <h2>3. Выплаты</h2>
            <ul>
              <li>Вывод — от 1 000 ₽ доступного баланса, на банковскую карту или по СБП.</li>
              <li>Запрос обрабатывается вручную, обычно в течение трёх рабочих дней. Одновременно может быть один необработанный запрос.</li>
              <li>Партнёр самостоятельно отвечает за уплату налогов с полученного дохода.</li>
            </ul>

            <h2>4. Что запрещено</h2>
            <p>Нарушение любого из правил — основание приостановить выплаты и отменить начисления:</p>
            <ul>
              <li>Регистрация собственных аккаунтов по своей ссылке и любые другие способы получить комиссию за собственные оплаты.</li>
              <li>Спам: массовые рассылки, комментарии и сообщения тем, кто на них не соглашался.</li>
              <li>Обещания, которых сервис не даёт: «гарантированное трудоустройство», «оффер за неделю» и подобные.</li>
              <li>Контекстная реклама по запросам с названием «Откликс» и выдача себя за официального представителя сервиса.</li>
            </ul>

            <h2>5. Изменение условий</h2>
            <p>
              Мы можем менять условия программы, публикуя новую редакцию на этой странице. Уже
              начисленные комиссии пересчёту не подлежат. Вопросы — на{' '}
              <a href="mailto:partners@otkliks.ru">partners@otkliks.ru</a>.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
