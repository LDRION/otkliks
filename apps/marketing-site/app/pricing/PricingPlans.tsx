'use client';

// Карточки тарифов с переключателем «Месяц / Неделя». Цифры — ровно те, что в
// core-api/src/routes/payment.js (weekly 99 ₽ / 7 дней, monthly 199 ₽ / 30 дней) и
// lib/planLimits.js (бесплатно — 100 откликов в день со всеми функциями и заданиями в
// первые дни, платно — до 200 и приоритет в очереди, lib/aiQueue.js). Меняются там —
// меняем и здесь, и в карточках на главной.

import { useState } from 'react';
import { CloudWaitlist } from '@/app/components/cloud/CloudWaitlist';
import Link from 'next/link';
import { PRICE_CLAIM, PRICE_CLAIM_NOTE } from '@/lib/priceClaim';

type Period = 'month' | 'week';

const LOCAL = {
  month: { price: '199 ₽', per: 'за 30 дней', day: '≈ 7 ₽ в день' },
  week: { price: '99 ₽', per: 'за 7 дней', day: '≈ 14 ₽ в день' },
} as const;

export function PricingPlans() {
  const [period, setPeriod] = useState<Period>('month');
  const local = LOCAL[period];

  return (
    <>
      <div className="pr-period" role="radiogroup" aria-label="Срок оплаты локального агента">
        <span className={`pr-period__thumb${period === 'week' ? ' is-week' : ''}`} aria-hidden="true" />
        <button
          type="button"
          role="radio"
          aria-checked={period === 'month'}
          className={`pr-period__opt${period === 'month' ? ' is-on' : ''}`}
          onClick={() => setPeriod('month')}
        >
          {/* 199 ₽ за 30 дней против 99 × 30/7 ≈ 424 ₽ неделями — на 53% дешевле */}
          Месяц <span className="pr-period__save">−53%</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={period === 'week'}
          className={`pr-period__opt${period === 'week' ? ' is-on' : ''}`}
          onClick={() => setPeriod('week')}
        >
          Неделя
        </button>
      </div>

      <div className="grid grid--3 pricing-cards pr-cards">
        <div id="free" className="card pricing-card reveal">
          <span className="tag">Бесплатно</span>
          <h3 className="pricing-card__name">Бесплатный тариф</h3>
          <div className="pricing-price">
            <span className="pricing-price__value">0 ₽</span>
            <span className="pricing-price__period">навсегда</span>
          </div>
          <p className="pricing-price__alt">Без карты и без даты окончания</p>
          <p className="muted pricing-card__desc">
            Полный автопилот без оплаты: подбор вакансий по резюме, письмо под каждую,
            переписка с работодателями и анкеты — до 100 откликов в день. Взамен — четыре
            простых задания в первые дни: подписаться на наши соцсети и оставить отзыв.
          </p>
          <ul className="pricing-check-list">
            <li><i>✓</i> 100 откликов в день с письмом под каждую вакансию</li>
            <li><i>✓</i> Переписка с работодателями в чате</li>
            <li><i>✓</i> Заполнение анкет и опросов по ссылкам</li>
            <li><i>✓</i> 4 задания в первые дни — дальше без них</li>
          </ul>
          <div className="pricing-card-cta">
            <Link href="/app/register" className="btn btn--ghost" style={{ width: '100%' }}>
              Начать бесплатно
            </Link>
          </div>
        </div>

        <div id="local" className="card pricing-card pricing-card--featured reveal">
          <span className="pricing-card__ribbon">Приоритет</span>
          <span className="tag">Приватный</span>
          <h3 className="pricing-card__name">Локальный агент</h3>
          <a href="#price-note" className="price-claim"><span>{PRICE_CLAIM}<sup>*</sup></span></a>
          {/* key — чтобы цена при переключении проявлялась заново, а не просто менялась */}
          <div className="pricing-price pr-price-swap" key={period}>
            <span className="pricing-price__value">{local.price}</span>
            <span className="pricing-price__period">{local.per}</span>
          </div>
          <p className="pricing-price__alt">
            {local.day}
            {period === 'week' ? '' : ' — дешевле чашки кофе'}
          </p>
          <p className="muted pricing-card__desc">
            Всё из бесплатного — плюс приоритет: в часы пик ваши отклики и ответы
            работодателям обрабатываются первыми, а лимит — до 200 в день. Работает на вашем
            компьютере — пароль и сессия hh.ru не покидают его.
          </p>
          <ul className="pricing-check-list">
            <li><i>✓</i> До 200 откликов в день</li>
            <li><i>✓</i> Приоритетная обработка</li>
            <li><i>✓</i> Без заданий</li>
            <li><i>✓</i> Без автосписаний — продлеваете сами</li>
          </ul>
          <div className="pricing-card-cta">
            <Link href="/app/register" className="btn btn--primary" style={{ width: '100%' }}>
              Подключить автопилот
            </Link>
            {/* Раньше здесь было просто «Оплата — в личном кабинете через ЮMoney»:
                непонятно, что это и почему кнопка ведёт не на оплату. Объясняем
                порядок действий, а не констатируем факт. */}
            <p className="pr-cta-note">Сначала аккаунт, оплата — внутри кабинета, картой через ЮMoney</p>
          </div>
        </div>

        <div id="cloud" className="card pricing-card pr-card--soon reveal">
          <span className="tag tag--accent">24/7 · скоро</span>
          <h3 className="pricing-card__name">Облачный тариф</h3>
          {/* Формулировки держим едиными с карточками на главной (app/page.tsx):
              это один и тот же тариф, и расхождение в подписях читается как
              разные предложения. */}
          <div className="pricing-price">
            <span className="pricing-price__value pricing-price__value--soon pricing-price__value--note">Цену объявим позже</span>
          </div>
          <p className="muted pricing-card__desc">
            Тот же движок, но на наших серверах: работает круглосуточно, даже когда ваш
            компьютер выключен. Сессия hh.ru при этом хранится у нас в зашифрованном виде.
          </p>
          <ul className="pricing-check-list">
            <li><i>✓</i> Круглосуточно</li>
            <li><i>✓</i> Компьютер держать включённым не нужно</li>
            <li><i>✓</i> Более частые проверки новых вакансий</li>
            <li><i>✓</i> Отдельный выделенный IP на аккаунт</li>
            <li className="is-excluded"><i>—</i> Сессия hh.ru хранится у нас</li>
          </ul>
          <div className="pricing-card-cta">
            <CloudWaitlist source="pricing" />
          </div>
        </div>
      </div>
      <p id="price-note" className="price-claim-note">* {PRICE_CLAIM_NOTE}</p>
    </>
  );
}
