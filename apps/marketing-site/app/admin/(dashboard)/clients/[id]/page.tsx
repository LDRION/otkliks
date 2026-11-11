import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminFetch, requireAdmin, AdminApiError } from '@/lib/adminApi';
import { listAdmins } from '@/lib/admins';
import { SITE_URL } from '@/lib/site';
import s from '../clients.module.css';
import { STAGES, ago, fmtDate, isTeam, lookalikes, signupText, stageIndex, type UserRow } from '../shared';
import { MarkForm } from './MarkForm';

export const metadata: Metadata = { title: 'Пользователь', robots: { index: false, follow: false } };

type Detail = {
  user: UserRow;
  consent: { at?: string; source?: string; version?: string } | null;
  devices: { label: string; pairedAt?: string; lastSeenAt?: string }[];
  resumes: { label: string; key: string }[];
  payments: { plan?: string; amount?: number; paidAt?: string; provider?: string }[];
  subscription: { status?: string; plan?: string; currentPeriodEnd?: string } | null;
  promo: { code: string; redeemedAt?: string; discountPercent?: number } | null;
  referredAt: string | null;
  chats: Record<string, number>;
  events: { type: string; title?: string; company?: string; outcome?: string; at: string; url?: string }[];
};

const EVENT: Record<string, string> = {
  applied: 'Отклик', reply: 'Ответ в чате', outcome: 'Исход переписки', alert: 'Предупреждение', form: 'Анкета', interview_invite: 'Приглашение',
};
const OUTCOME: Record<string, string> = { interview: 'собеседование', rejection: 'отказ', question: 'вопрос', other: 'другое', pending: 'ждём ответа' };
const SIGNUP_WHERE: Record<string, string> = { site: 'форма на сайте', launcher: 'в лаунчере', oauth: 'Яндекс / VK на сайте' };
const rub = (n = 0) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin('admin');
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/.test(id)) notFound();
  let d: Detail;
  try {
    d = await adminFetch<Detail>(session, `/users/${id}`);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    throw e;
  }
  const u = d.user;
  const a = u.acquisition;
  const adminEmails = new Set(listAdmins().map((x) => x.email.toLowerCase()));
  const team = isTeam(u, adminEmails);
  // «Похоже, ваш» — сверяем с аккаунтами администраторов из общего списка.
  const maybeOurs = !team && !u.internal && lookalikes(
    (await adminFetch<{ users: UserRow[] }>(session, '/users')).users, adminEmails,
  ).has(u.id);
  const done = stageIndex(u.stage);
  const steps = [
    { label: 'Зарегистрировался', ok: true },
    { label: 'Резюме', ok: u.resumes > 0 },
    { label: 'Лаунчер', ok: u.devices > 0 || u.applied > 0 },
    { label: 'Отклики', ok: u.applied > 0 },
    { label: 'Приглашения', ok: u.invites > 0 },
    { label: 'Оплата', ok: u.paid > 0 },
  ];

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <p><Link href="/admin/clients" className="muted">← Все пользователи</Link></p>
      <h1 style={{ fontSize: '1.5rem', marginTop: 8, wordBreak: 'break-word' }}>
        {u.noEmail ? 'Без почты (вход через VK)' : u.email}
        {u.test && <span className={`${s.badge} ${s.badgeWarn}`}>тест</span>}
        {team && <span className={s.badge}>админ</span>}
        {u.internal && <span className={s.badge}>наш</span>}
        {maybeOurs && <span className={`${s.badge} ${s.badgeHint}`}>похоже, ваш</span>}
      </h1>
      {team && <p className="muted" style={{ marginTop: 6 }}>Почта совпадает с администратором сайта — в реальных пользователях не считается.</p>}
      {maybeOurs && <p className="muted" style={{ marginTop: 6 }}>Имя или почта как у вашего аккаунта. Если это вы — отметьте «Это наш аккаунт» ниже.</p>}
      <p className="muted" style={{ marginTop: 6 }}>
        {u.fullName || 'Имя не указано'} · зарегистрировался {fmtDate(u.createdAt, true)} · последняя активность: {ago(u.lastActivityAt)}
      </p>

      <div className={s.path}>
        {steps.map((st) => <span key={st.label} className={`${s.pathStep} ${st.ok ? s.pathDone : ''}`}>{st.ok ? '✓ ' : ''}{st.label}</span>)}
      </div>
      <p className="muted" style={{ fontSize: '0.82rem', marginTop: 6 }}>Этап: {STAGES[done]?.label}</p>

      <div className={s.grid2}>
        <div className="card">
          <b>Откуда пришёл</b>
          <dl className={s.kv}>
            <dt>Источник</dt><dd>{u.source}</dd>
            {u.partner && (<><dt>Партнёр</dt><dd>{u.partner.code}{u.partner.email ? ` (${u.partner.email})` : ''}{d.referredAt ? ` · закреплён ${fmtDate(d.referredAt)}` : ''}</dd></>)}
            {d.promo && (<><dt>Промокод</dt><dd>{d.promo.code}{d.promo.discountPercent ? ` · скидка ${d.promo.discountPercent}%` : ''}{d.promo.redeemedAt ? ` · ${fmtDate(d.promo.redeemedAt)}` : ''}</dd></>)}
            {a?.source && (<><dt>utm_source</dt><dd>{a.source}</dd></>)}
            {a?.medium && (<><dt>utm_medium</dt><dd>{a.medium}</dd></>)}
            {a?.campaign && (<><dt>utm_campaign</dt><dd>{a.campaign}</dd></>)}
            {a?.content && (<><dt>utm_content</dt><dd>{a.content}</dd></>)}
            {a?.referrerHost && (<><dt>Пришёл с сайта</dt><dd>{a.referrerHost}</dd></>)}
            {a?.landingPath && (<><dt>Страница входа</dt><dd><a href={`${SITE_URL}${a.landingPath}`} target="_blank" rel="noreferrer">{a.landingPath}</a></dd></>)}
            {a?.firstSeenAt && (<><dt>Первый заход</dt><dd>{fmtDate(a.firstSeenAt, true)}</dd></>)}
            {!a && !u.partner && !d.promo && (<><dt>Подробности</dt><dd className="muted">Не записаны: прямой заход, регистрация в лаунчере или зарегистрирован до 10.10.2026.</dd></>)}
          </dl>
        </div>

        <div className="card">
          <b>Как зарегистрировался</b>
          <dl className={s.kv}>
            <dt>Вход</dt><dd>{signupText(u)}</dd>
            <dt>Где</dt><dd>{d.consent?.source ? SIGNUP_WHERE[d.consent.source] || d.consent.source : <span className="muted">не записывалось (до 28.09.2026)</span>}</dd>
            <dt>Согласие</dt><dd>{d.consent?.at ? `${fmtDate(d.consent.at, true)} · редакция ${d.consent.version || '—'}` : '—'}</dd>
            <dt>Тариф</dt><dd>{d.subscription?.status || 'none'}{d.subscription?.currentPeriodEnd ? ` до ${fmtDate(d.subscription.currentPeriodEnd)}` : ''}</dd>
            <dt>Оплачено</dt><dd>{rub(u.paid)}{d.payments.length ? ` · ${d.payments.length} платеж.` : ''}</dd>
          </dl>
        </div>

        <div className="card">
          <b>Работа автопилота</b>
          <dl className={s.kv}>
            <dt>Откликов</dt><dd>{u.applied} · за 7 дней {u.applied7}{u.lastAppliedAt ? ` · последний ${fmtDate(u.lastAppliedAt, true)}` : ''}</dd>
            <dt>Переписки</dt><dd>{Object.keys(d.chats).length ? Object.entries(d.chats).map(([k, n]) => `${OUTCOME[k] || k}: ${n}`).join(' · ') : '—'}</dd>
            <dt>Лаунчер</dt><dd>{d.devices.length ? d.devices.map((dv) => `${dv.label} (подключён ${fmtDate(dv.pairedAt)}, был ${ago(dv.lastSeenAt)})`).join('; ') : 'не подключал'}</dd>
            <dt>Резюме</dt><dd>{d.resumes.length ? d.resumes.map((r) => r.label).join(', ') : 'не добавлял'}</dd>
          </dl>
        </div>

        <div className="card">
          <b>Заметка</b>
          <MarkForm id={u.id} internal={u.internal} note={u.note} />
        </div>
      </div>

      {d.payments.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <b>Оплаты</b>
          <table className="admin-table" style={{ marginTop: 10 }}>
            <thead><tr><th>Когда</th><th>Тариф</th><th className="num">Сумма</th></tr></thead>
            <tbody>{d.payments.map((p, i) => <tr key={i}><td>{fmtDate(p.paidAt, true)}</td><td>{p.plan || '—'}</td><td className="num">{rub(p.amount)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div className={`card ${s.scroll}`} style={{ marginTop: 16 }}>
        <b>Последние события</b>
        <table className="admin-table" style={{ marginTop: 10 }}>
          <thead><tr><th>Когда</th><th>Событие</th><th>Вакансия</th></tr></thead>
          <tbody>
            {d.events.map((e, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.at, true)}</td>
                <td>{EVENT[e.type] || e.type}{e.outcome ? `: ${OUTCOME[e.outcome] || e.outcome}` : ''}</td>
                <td>{e.title || '—'}{e.company ? <span className={s.sub}>{e.company}</span> : null}</td>
              </tr>
            ))}
            {!d.events.length && <tr><td colSpan={3} className="muted">Событий нет — автопилот у этого пользователя ещё не работал.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
