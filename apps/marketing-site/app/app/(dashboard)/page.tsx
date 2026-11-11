import { TaskCard, type FreeTasksState } from './TaskCard';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';
import { createPaymentAction } from './paymentActions';
import { AutopilotStatusCard } from './AutopilotStatus';
import { getAutopilotStatus, type AutopilotDevice } from '@/lib/autopilot';
import { answerClarificationAction } from './clarificationActions';
import { tenantDisplayName } from '@/lib/tenantDisplay';
import { EmailPrompt } from './EmailPrompt';
import { AnalyticsGoals } from '@/app/components/Analytics';

export const metadata: Metadata = {
  title: 'Панель управления',
  robots: { index: false, follow: false },
};

// Тарифы для карточек оплаты. ДОЛЖНЫ совпадать с PLANS в core-api/src/routes/payment.js —
// там они и применяются, здесь только показываются. Один список на оба блока (первая
// оплата и продление), чтобы цены не разъехались между ними.
const PLANS = [
  { key: 'weekly' as const, label: 'Неделя', priceRub: 99, days: 7 },
  { key: 'monthly' as const, label: 'Месяц', priceRub: 199, days: 30 },
];

// Без хвоста «г.», который добавляет русская локаль: в интерфейсе «8 января 2036 г.»
// читается как строка из справки, а не как дата в карточке тарифа.
const fmtDate = (d: Date) =>
  d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .replace(/\s*г\.$/, '');

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);

/** «5 дней» / «2 дня» / «1 день» — без этого в кабинете было бы «1 дней». */
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

type Tenant = {
  email: string;
  emailIsPlaceholder?: boolean;
  promo?: { discountPercent: number; discountExpiresAt: string | null; trialEndsAt: string | null } | null;
  pendingEmail?: string | null;
  fullName?: string;
  resumeProfiles: { key: string; label: string; similarVacanciesUrl?: string }[];
  subscription: { status: string; priceRub: number; currentPeriodEnd?: string };
  isSubscriptionActive: boolean;
  dailyCap: number;
  dailyUsed: number;
  freeTierBlocked: boolean;
  freeTasks?: FreeTasksState | null;
  devices: AutopilotDevice[];
};

type Stats = {
  applied: { total: number; today: number };
  interviews: number;
  rejections: number;
  pending: number;
};

type ActivityEvent = {
  _id: string;
  type: 'applied' | 'reply' | 'outcome' | 'alert' | 'form' | 'interview_invite';
  title?: string;
  company?: string;
  message?: string;
  // Что именно автопилот написал от имени человека: письмо, ответ в чате,
  // ответы в анкете. Раньше в кабинете был виден только факт действия.
  details?: string;
  incoming?: string;
  fields?: { question: string; answer: string }[];
  url?: string;
  outcome?: string;
  createdAt: string;
};

type Clarification = {
  _id: string;
  negotiationId: string;
  vacancyTitle?: string;
  company?: string;
  url?: string;
  question: string;
  createdAt: string;
};

const OUTCOME_LABEL: Record<string, string> = {
  interview: 'приглашение на собеседование',
  rejection: 'отказ',
  question: 'уточняющий вопрос',
  other: 'ответ работодателя',
};

/**
 * «Вакансия — Компания», но только из того, что действительно есть.
 * Раньше собиралось шаблоном, и пустая компания превращалась в видимое «— null».
 */
function where(e: ActivityEvent): string {
  return [e.title, e.company].map((s) => (s || '').trim()).filter(Boolean).join(' — ');
}

// Машинное имя поля вместо вопроса («task_380806266_text») — так сохранены анкеты,
// заполненные до лаунчера 1.0.8. Текста вопроса в них нет — хотя бы по-людски.
function humanQuestion(q: string, i: number): string {
  const s = String(q || '').trim();
  return !s || (/^[\w-]+$/.test(s) && /\d{4,}/.test(s)) ? `Вопрос анкеты ${i + 1}` : s;
}

function describeEvent(e: ActivityEvent): string {
  const place = where(e);
  const suffix = place ? `: ${place}` : '';
  if (e.type === 'applied') return `Отклик отправлен${suffix}`;
  if (e.type === 'reply') return `Ответили в чате${suffix}`;
  if (e.type === 'form') return `✅ Форма заполнена за вас${suffix}`;
  if (e.type === 'outcome') return `${OUTCOME_LABEL[e.outcome || 'other']}${suffix}`;
  return e.message || 'Уведомление';
}

/** Подпись у раскрытия — сразу говорит, что внутри. */
function detailLabel(e: ActivityEvent): string | null {
  if (e.type === 'form' && e.fields?.length) return `Что мы ответили (${e.fields.length})`;
  if (e.type === 'applied' && e.details) return 'Сопроводительное письмо';
  if (e.type === 'reply' && (e.details || e.incoming)) return 'Переписка';
  return null;
}

export default async function CustomerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ paymentError?: string; email?: string; promo?: string; paid?: string; welcome?: string }>;
}) {
  const session = await getCustomerSession();
  if (!session) redirect('/app/login');

  const { paymentError, email: emailFlag, promo: promoFlag, paid: paidFlag, welcome: welcomeFlag } = await searchParams;

  const [{ tenant }, stats, { events }, { events: interviews }, { clarifications }] = await Promise.all([
    coreApiFetch<{ tenant: Tenant }>('/api/auth/me', { token: session.coreApiToken }),
    coreApiFetch<Stats>('/api/stats', { token: session.coreApiToken }),
    coreApiFetch<{ events: ActivityEvent[] }>('/api/activity?limit=20', { token: session.coreApiToken }),
    // Приглашения на созвон — отдельным запросом и ВСЕ: «победный» блок не должен терять
    // приглашение, когда лента наполнится другими событиями.
    coreApiFetch<{ events: ActivityEvent[] }>('/api/activity/interviews', { token: session.coreApiToken }),
    // 🙋 Вопросы, на которые ИИ честно не может ответить сам — по той же причине отдельно.
    coreApiFetch<{ clarifications: Clarification[] }>('/api/activity/clarifications', { token: session.coreApiToken }),
  ]);

  const autopilot = getAutopilotStatus({
    resumeCount: tenant.resumeProfiles.length,
    subscriptionActive: tenant.isSubscriptionActive,
    pendingTaskTitle: tenant.freeTasks?.pending?.title ?? null,
    devices: tenant.devices || [],
  });

  // Дата окончания может отсутствовать (подписка выдана вручную без срока) —
  // тогда блок продления показывается без конкретных дат, а не падает.
  const rawEnd = tenant.subscription?.currentPeriodEnd;
  const parsedEnd = rawEnd ? new Date(rawEnd) : null;
  const subEnd = parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : null;
  const daysLeft = subEnd
    ? Math.max(0, Math.ceil((subEnd.getTime() - Date.now()) / 86400000))
    : null;

  const displayName = tenantDisplayName(tenant);
  // Скидка по промокоду на первую оплату — core-api уже учёл срок и то, что она
  // не израсходована; здесь только показываем ту же цену, что будет в ЮMoney.
  const discount = tenant.promo?.discountPercent || 0;
  const trialEnds = tenant.promo?.trialEndsAt ? new Date(tenant.promo.trialEndsAt) : null;
  const fmtDateTime = (d: Date) => d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Панель управления</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {displayName ? <>С возвращением, {displayName}.</> : 'С возвращением!'}
      </p>

      {/* Первым делом — работает ли автопилот и что мешает. Всё остальное на этой
          странице (цифры, события) бессмысленно, пока не ясен ответ на это. */}
      {/* Результат перехода по ссылке подтверждения почты (core-api редиректит сюда). */}
      {/* Цели метрик: регистрация и оплата (компонент сам решает, что отметить). */}
      <AnalyticsGoals welcome={welcomeFlag === '1'} paid={paidFlag === '1'} promo={promoFlag === 'activated'} />

      {promoFlag === 'activated' && (
        <p className="email-flash email-flash--ok">Персональное предложение активировано{trialEnds ? ' — полный автопилот уже включён' : ''}.</p>
      )}
      {promoFlag === 'unavailable' && (
        <p className="email-flash email-flash--err">Это предложение уже использовано, больше не действует или на аккаунте уже есть другое.</p>
      )}
      {paidFlag === '1' && (
        <p className="email-flash email-flash--ok">Спасибо за оплату! Подписка включится, как только ЮMoney подтвердит платёж — обычно это меньше минуты.</p>
      )}
      {trialEnds && trialEnds > new Date() && (
        <p className="email-flash email-flash--ok">
          Пробный период: полный автопилот до {fmtDateTime(trialEnds)} по Москве.
          {discount > 0 && <> Скидка {discount}% на первую оплату уже учтена в ценах ниже.</>}
        </p>
      )}

      {emailFlag === 'confirmed' && (
        <p className="email-flash email-flash--ok">Почта подтверждена — теперь уведомления и чеки будут приходить на неё.</p>
      )}
      {emailFlag === 'invalid' && (
        <p className="email-flash email-flash--err">Ссылка подтверждения устарела или уже использована. Укажите почту ещё раз.</p>
      )}
      {emailFlag === 'taken' && (
        <p className="email-flash email-flash--err">Этот адрес уже привязан к другому аккаунту. Укажите другую почту.</p>
      )}

      {tenant.emailIsPlaceholder && <EmailPrompt pendingEmail={tenant.pendingEmail ?? null} />}

      <AutopilotStatusCard status={autopilot} />

      {/* 🎉 Приглашения на созвон/собеседование, подтверждённые в чате — «победа». Зелёный
          акцент, не теряется (отдельный запрос по всем), ссылка ведёт прямо в переписку. */}
      {interviews.length > 0 && (
        <div
          className="card"
          style={{
            marginTop: 24,
            border: '1px solid #bfe6c8',
            background: 'linear-gradient(180deg, rgba(22,163,74,0.08), rgba(22,163,74,0.02))',
          }}
        >
          <h2 style={{ fontSize: '1.2rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.6 2.7c-.5 0-.9.4-.9.9C2.7 9.1 6.9 13.3 12.4 13.3c.5 0 .9-.4.9-.9v-2.1c0-.4-.3-.8-.7-.9l-2.3-.5c-.4-.1-.8.1-1 .4l-.5.9c-1.5-.7-2.7-1.9-3.4-3.4l.9-.5c.3-.2.5-.6.4-1L6.1 3.4c-.1-.4-.5-.7-.9-.7H3.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            Приглашения на созвон
          </h2>
          <p className="muted" style={{ marginTop: 6, marginBottom: 16 }}>
            Первичный этап пройден — работодатель зовёт на созвон/собеседование. Время выбираете вы:
            откройте переписку и договоритесь.
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            {interviews.map((e) => (
              <div
                key={e._id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  padding: '12px 14px',
                  background: 'var(--surface)',
                  border: '1px solid #cdead4',
                  borderRadius: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    {[e.title, e.company].filter(Boolean).join(' — ') || 'Приглашение на созвон'}
                  </div>
                  <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
                    {new Date(e.createdAt).toLocaleString('ru-RU')}
                  </div>
                </div>
                {e.url && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn--primary btn--sm"
                    style={{ background: 'var(--success)', borderColor: 'var(--success)', flex: '0 0 auto' }}
                  >
                    Открыть переписку
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 🙋 Вопросы, на которые ИИ честно не может ответить сам (важный факт вне резюме/
          стека). Работодателю в этот момент НИЧЕГО не отправляем — молчим и ждём человека
          (фразу-мостик «передаю человеку…» убрали: по ней AI-рекрутёры вычисляли автоматизацию).
          Ваш ответ уходит через ИИ (если галочка включена) на следующем круге чатов лаунчера —
          доставка требует живого браузера с сессией hh.ru. */}
      {clarifications.length > 0 && (
        <div
          className="card"
          style={{
            marginTop: 24,
            border: '1px solid #f5dfa3',
            background: 'linear-gradient(180deg, rgba(180,83,9,0.08), rgba(180,83,9,0.02))',
          }}
        >
          <h2 style={{ fontSize: '1.2rem', color: '#b45309', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2.5 3.2c0-.4.3-.7.7-.7h9.6c.4 0 .7.3.7.7v6.4c0 .4-.3.7-.7.7H6.2l-2.9 2.4c-.3.2-.8 0-.8-.4V3.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 5.1c.7 0 1.2.5 1.2 1.1 0 .5-.3.7-.7 1-.3.2-.5.4-.5.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="8" cy="9.4" r=".55" fill="currentColor" />
            </svg>
            Нужен ваш ответ
          </h2>
          <p className="muted" style={{ marginTop: 6, marginBottom: 16 }}>
            ИИ не может честно ответить сам — это факт, которого нет в резюме. Работодателю мы
            сейчас ничего не пишем и ждём именно вас: впишите ответ, и он уйдёт в переписку от
            вашего имени.
          </p>
          <div style={{ display: 'grid', gap: 14 }}>
            {clarifications.map((c) => (
              <form key={c._id} action={answerClarificationAction} style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid #f0dfb0', borderRadius: 10 }}>
                <input type="hidden" name="id" value={c._id} />
                <div style={{ fontWeight: 700 }}>
                  {[c.vacancyTitle, c.company].filter(Boolean).join(' — ') || 'Вопрос от работодателя'}
                </div>
                <div style={{ marginTop: 4, fontSize: '0.9rem' }}>{c.question}</div>
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: '0.78rem' }}>
                    Открыть переписку
                  </a>
                )}
                <textarea
                  name="answerText"
                  required
                  placeholder="Ваш ответ по существу — дальше можно оформить как естественное сообщение (см. галочку ниже) или отправить как есть"
                  style={{ width: '100%', marginTop: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', minHeight: 60, boxSizing: 'border-box', fontFamily: 'inherit' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  <label className="muted" style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      name="aiImprove"
                      defaultChecked
                      style={{ width: 14, height: 14, margin: 0, accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                    Улучшить ответ при помощи AI
                  </label>
                  <button type="submit" className="btn btn--sm" style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-contrast)', flex: '0 0 auto' }}>
                    Отправить работодателю
                  </button>
                </div>
              </form>
            ))}
          </div>
        </div>
      )}

      {/* Продление при УЖЕ активной подписке. Раньше весь блок оплаты висел на
          условии !isSubscriptionActive — у платящего клиента в кабинете не было
          ни одной кнопки оплаты вообще, то есть заплатить заранее он физически
          не мог. Время при этом складывается: вебхук ведёт отсчёт нового периода
          от текущей даты окончания, а не от «сегодня» (см. payment.js, stillActive
          → base), поэтому досрочная оплата ничего не сжигает — и мы говорим об
          этом прямо, показывая будущую дату. */}
      {tenant.isSubscriptionActive && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1.2rem' }}>{trialEnds ? 'Пробный период активен' : 'Платный тариф активен'}</h2>
          {paymentError && (
            <p className="admin-login-error" style={{ marginTop: 8 }}>
              {paymentError === 'unavailable'
                ? 'Оплата временно недоступна. Обратитесь к поддержке.'
                : 'Не получилось создать платёж. Попробуйте ещё раз.'}
            </p>
          )}
          <p className="muted" style={{ marginTop: 8, marginBottom: 20 }}>
            {subEnd
              ? <>Оплачено до <b style={{ color: 'var(--text)' }}>{fmtDate(subEnd)}</b>{daysLeft !== null && ` — это ${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')}`}. Автопродления нет, но можно продлить заранее: оплаченные дни прибавятся к текущему сроку, а не сгорят.</>
              : <>Автопродления нет — продлить можно в любой момент, оплаченные дни прибавятся к текущему сроку.</>}
          </p>

          <div className="grid grid--2" style={{ gap: 16 }}>
            {PLANS.map((p) => (
              <div key={p.key} className="card" style={{ padding: 20 }}>
                <span className={p.key === 'monthly' ? 'tag tag--accent' : 'tag'}>{p.label}</span>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: 10 }}>
                  {discount > 0 ? (
                    <>
                      {Math.round(p.priceRub * (100 - discount) / 100)} ₽{' '}
                      <s className="muted" style={{ fontSize: '1rem', fontWeight: 600 }}>{p.priceRub} ₽</s>
                    </>
                  ) : <>{p.priceRub} ₽</>}
                </div>
                {/* Было «продлит до 8 января» — и спотыкались все, включая владельца:
                    подлежащее у глагола подразумевается и стоит далеко (цена выше),
                    поэтому форма читается как опечатка в «продлить». Спор между
                    «продлит» и «продлить» тут не решается — убираем глагол совсем.
                    Заодно видна и прибавка, и итоговая дата, а не только дата. */}
                <p className="muted" style={{ marginTop: 6, marginBottom: 16 }}>
                  +{p.days} {plural(p.days, 'день', 'дня', 'дней')}
                  {subEnd && <> — до {fmtDate(addDays(subEnd, p.days))}</>}
                </p>
                <form action={createPaymentAction}>
                  <input type="hidden" name="plan" value={p.key} />
                  <button type="submit" className="btn btn--primary" style={{ width: '100%' }}>
                    Продлить на {p.key === 'weekly' ? 'неделю' : 'месяц'}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>
      )}

      {!tenant.isSubscriptionActive && !tenant.freeTierBlocked && tenant.freeTasks?.pending && (
        <TaskCard tasks={tenant.freeTasks} />
      )}

      {!tenant.isSubscriptionActive && tenant.freeTierBlocked && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1.2rem' }}>Бесплатный тариф недоступен</h2>
          <p className="muted" style={{ marginTop: 8, marginBottom: 20 }}>
            Резюме, подключённое на этом аккаунте, уже используется на другом бесплатном
            аккаунте — по одному резюме бесплатный тариф даётся только один раз. Оформите
            платный тариф, чтобы автопилот заработал на этом аккаунте, или используйте
            исходный аккаунт.
          </p>
        </div>
      )}

      {!tenant.isSubscriptionActive && !tenant.freeTierBlocked && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1.2rem' }}>Вы на бесплатном тарифе</h2>
          {paymentError && (
            <p className="admin-login-error" style={{ marginTop: 8 }}>
              {paymentError === 'unavailable'
                ? 'Оплата временно недоступна. Обратитесь к поддержке.'
                : 'Не получилось создать платёж. Попробуйте ещё раз.'}
            </p>
          )}
          <p className="muted" style={{ marginTop: 8, marginBottom: 20 }}>
            Всё включено: до {tenant.dailyCap} откликов в день с письмом под каждую вакансию,
            переписка с работодателями и заполнение анкет (сегодня использовано{' '}
            {tenant.dailyUsed}).
            {tenant.freeTasks && !tenant.freeTasks.allDone && tenant.freeTasks.next && !tenant.freeTasks.pending
              ? ` Следующее задание (${tenant.freeTasks.next.day} из ${tenant.freeTasks.total}) — ${tenant.freeTasks.nextAt ? new Date(tenant.freeTasks.nextAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'завтра'}.`
              : ''}
            {' '}Платный тариф — приоритетная обработка ваших откликов и ответов, до 200
            откликов в день и никаких заданий:
          </p>

          <div className="grid grid--2" style={{ gap: 16 }}>
            {PLANS.map((p) => (
              <div key={p.key} className="card" style={{ padding: 20 }}>
                <span className={p.key === 'monthly' ? 'tag tag--accent' : 'tag'}>{p.label}</span>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: 10 }}>
                  {discount > 0 ? (
                    <>
                      {Math.round(p.priceRub * (100 - discount) / 100)} ₽{' '}
                      <s className="muted" style={{ fontSize: '1rem', fontWeight: 600 }}>{p.priceRub} ₽</s>
                    </>
                  ) : <>{p.priceRub} ₽</>}
                </div>
                <p className="muted" style={{ marginTop: 6, marginBottom: 16 }}>
                  разовая подписка на {p.days} дней
                </p>
                <form action={createPaymentAction}>
                  <input type="hidden" name="plan" value={p.key} />
                  <button type="submit" className="btn btn--primary" style={{ width: '100%' }}>
                    Оплатить {p.key === 'weekly' ? 'неделю' : 'месяц'}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Список подключённых резюме. Пустой случай здесь не обрабатываем — о нём
          говорит карточка статуса выше, вместе со ссылкой «Добавить резюме».
          Заголовок намеренно не про работу: «Автопилот работает по резюме» читалось
          как «уже работает», хотя лаунчера может не быть вовсе. */}
      {tenant.resumeProfiles.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <b>Резюме для поиска вакансий</b>
            <a className="muted" href="/app/profile" style={{ fontSize: '0.85rem' }}>Изменить</a>
          </div>
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 10 }}>
            {tenant.resumeProfiles.map((r) => (
              <li key={r.key} style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                <span className="row-state row-state--saved" style={{ flex: 'none' }}>
                  <span className="row-state__dot" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b style={{ fontSize: '0.95rem' }}>{r.label}</b>
                  {r.similarVacanciesUrl && (
                    <span
                      className="muted"
                      style={{ display: 'block', fontSize: '0.8rem', overflowWrap: 'anywhere' }}
                    >
                      {r.similarVacanciesUrl}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid--3" style={{ marginTop: 24 }}>
        <div className="card">
          <span className="tag">Всего</span>
          <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 10 }}>
            {stats.applied.total.toLocaleString('ru-RU')}
          </div>
          <p className="muted" style={{ marginTop: 6 }}>откликов (сегодня: {stats.applied.today})</p>
        </div>
        <div className="card">
          <span className="tag tag--accent">Собеседования</span>
          {/* Цвет — только когда событие реально было: зелёный ноль приглашений
              читается как достижение, красный ноль отказов — как проблема. */}
          <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 10, color: stats.interviews > 0 ? 'var(--success)' : undefined }}>
            {stats.interviews.toLocaleString('ru-RU')}
          </div>
          <p className="muted" style={{ marginTop: 6 }}>приглашений</p>
        </div>
        <div className="card">
          <span className="tag">Отказы</span>
          <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 10, color: stats.rejections > 0 ? 'var(--danger)' : undefined }}>
            {stats.rejections.toLocaleString('ru-RU')}
          </div>
          <p className="muted" style={{ marginTop: 6 }}>{stats.pending} ждут ответа</p>
        </div>
      </div>

      <h2 style={{ fontSize: '1.1rem', marginTop: 40, marginBottom: 16 }}>Последние события</h2>
      <div className="card">
        {events.length === 0 && (
          <p className="muted">
            Пока пусто. Здесь по одному появятся отправленные отклики и ответы работодателей —
            как только автопилот заработает. Что для этого осталось, видно в карточке статуса
            вверху страницы.
          </p>
        )}
        {events.map((e) => {
          const label = detailLabel(e);
          return (
            <div key={e._id} className="activity-item">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>{describeEvent(e)}</span>
                <time className="muted" style={{ fontSize: '0.8rem', flex: 'none' }}>
                  {new Date(e.createdAt).toLocaleString('ru-RU')}
                </time>
              </div>

              {/* Содержимое действия — по клику: в ленте важен факт, текст нужен,
                  когда человек хочет проверить, что ушло от его имени. */}
              {label && (
                <details className="event-detail">
                  <summary>{label}</summary>
                  {e.type === 'form' ? (
                    <div className="qa-list">
                      {(e.fields || []).map((f, i) => (
                        <div className="qa-row" key={i}>
                          <div className="qa-q">{humanQuestion(f.question, i)}</div>
                          <div className="qa-a">{f.answer}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="event-detail__text">
                      {e.type === 'reply' && e.incoming ? `Работодатель:\n${e.incoming}\n\nМы:\n${e.details || e.message || ''}` : (e.details || e.message || '')}
                    </div>
                  )}
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
